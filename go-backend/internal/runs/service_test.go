package runs

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

// ---- fakes ----

type fakePercy struct {
	mu      sync.Mutex
	started int
	stopped int
	idleErr error
	startEr error
}

func (f *fakePercy) EnsureReady() error { return nil }
func (f *fakePercy) Start(string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.started++
	return f.startEr
}
func (f *fakePercy) Stop() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stopped++
	return nil
}
func (f *fakePercy) BuildInfo() (string, string, error) { return "999", "https://percy.io/b/999", nil }
func (f *fakePercy) WaitIdle(time.Duration) error       { return f.idleErr }

type fakeRuntime struct {
	root     string
	setupErr error
}

func (r *fakeRuntime) EnsureReady(func(string)) error { return r.setupErr }
func (r *fakeRuntime) RunnerEntry() string            { return "runner.js" }
func (r *fakeRuntime) PlaywrightDir() string          { return r.root }
func (r *fakeRuntime) ArtifactDir(id string) (string, error) {
	if !ValidBuildID(id) {
		return "", ErrInvalidID
	}
	return filepath.Join(r.root, "artifacts", id), nil
}
func (r *fakeRuntime) RequestPath(id string) (string, error) {
	return filepath.Join(r.root, "artifacts", id, ".request.json"), nil
}

type fakeProc struct {
	lines   []string
	exit    int
	block   chan struct{} // if set, Wait blocks until closed or ctx done
	ctx     context.Context
	onStart func(requestPath string)
}

func (p *fakeProc) Wait() error {
	if p.block != nil {
		select {
		case <-p.block:
		case <-p.ctx.Done():
			return p.ctx.Err()
		}
	}
	if p.exit == 0 {
		return nil
	}
	// produce a real *exec.ExitError with the wanted code
	cmd := exec.Command("sh", "-c", "exit "+string(rune('0'+p.exit)))
	return cmd.Run()
}
func (p *fakeProc) Kill() error { return nil }

type harness struct {
	svc     *Service
	builds  *Store
	wfs     *workflow.Store
	percy   *fakePercy
	rt      *fakeRuntime
	wf      *workflow.Workflow
	launch  *launchCfg
	root    string
	busy    bool
	reqSeen string
}

type launchCfg struct {
	mu    sync.Mutex
	lines []string
	exit  int
	block chan struct{}
	err   error
	req   []byte
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	wfs, _ := workflow.NewStore(filepath.Join(root, "workflows"))
	builds, _ := NewStore(filepath.Join(root, "builds"))
	wf := &workflow.Workflow{
		Name: "Dash", SchemaVersion: 1, StartURL: "https://example.test/",
		Settings: workflow.Settings{Viewport: workflow.Viewport{Width: 1280, Height: 800}},
		Steps: []workflow.Step{
			{ID: "step_001", Type: "fill", Target: &workflow.Target{Role: "textbox", Name: "Password"}, ValueRef: "pw"},
			{ID: "step_002", Type: "click", Target: &workflow.Target{Role: "button", Name: "Go"}},
			{ID: "step_003", Type: "snapshot", CheckpointID: "dashboard", Name: "Dashboard"},
			{ID: "step_004", Type: "snapshot", CheckpointID: "accounts", Name: "Accounts"},
		},
	}
	if err := wfs.Create(wf); err != nil {
		t.Fatal(err)
	}
	h := &harness{builds: builds, wfs: wfs, percy: &fakePercy{}, rt: &fakeRuntime{root: root}, wf: wf, launch: &launchCfg{}, root: root}
	h.svc = NewService(Config{
		Workflows: wfs, Builds: builds, Percy: h.percy, Runtime: h.rt, PercyURL: "http://127.0.0.1:5338",
		RunTimeout: 3 * time.Second, IdleTimeout: time.Second,
		Busy: func() bool { return h.busy },
		Launch: func(ctx context.Context, entry, req, dir string, onLine, onLog func(string)) (Process, error) {
			h.launch.mu.Lock()
			defer h.launch.mu.Unlock()
			if h.launch.err != nil {
				return nil, h.launch.err
			}
			data, _ := os.ReadFile(req) // request file must exist while running
			h.launch.req = data
			for _, l := range h.launch.lines {
				onLine(l)
			}
			return &fakeProc{exit: h.launch.exit, block: h.launch.block, ctx: ctx}, nil
		},
	})
	return h
}

func ev(m map[string]any) string { b, _ := json.Marshal(m); return string(b) }

func happyLines(root string) []string {
	return []string{
		ev(map[string]any{"type": "stepStarted", "stepId": "step_001"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_001", "status": "passed", "durationMs": 12}),
		ev(map[string]any{"type": "stepStarted", "stepId": "step_002"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_002", "status": "passed"}),
		ev(map[string]any{"type": "stepStarted", "stepId": "step_003"}),
		ev(map[string]any{"type": "checkpointCaptured", "checkpointId": "dashboard", "domPath": root + "/artifacts/b/dom/dashboard.html", "metadataPath": root + "/artifacts/b/metadata/dashboard.json"}),
		ev(map[string]any{"type": "checkpointUploaded", "checkpointId": "dashboard"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_003", "status": "passed"}),
		ev(map[string]any{"type": "stepStarted", "stepId": "step_004"}),
		ev(map[string]any{"type": "checkpointCaptured", "checkpointId": "accounts", "domPath": root + "/artifacts/b/dom/accounts.html", "metadataPath": root + "/artifacts/b/metadata/accounts.json"}),
		ev(map[string]any{"type": "checkpointUploaded", "checkpointId": "accounts"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_004", "status": "passed"}),
	}
}

func (h *harness) startAndWait(t *testing.T, key string) *Build {
	t.Helper()
	b, _, err := h.svc.Start(h.wf.WorkflowID, "tok", key, map[string]string{"pw": "hunter2-SECRET"})
	if err != nil {
		t.Fatal(err)
	}
	h.svc.Wait()
	got, err := h.builds.Get(b.BuildID)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// ---- tests ----

func TestHappyPathPassesAndRecordsVersionAndCheckpoints(t *testing.T) {
	h := newHarness(t)
	h.launch.lines = happyLines(h.root)
	b := h.startAndWait(t, "")

	if b.Status != StatusPassed {
		t.Fatalf("status = %s errors=%v", b.Status, b.Errors)
	}
	if b.WorkflowID != h.wf.WorkflowID || b.WorkflowVersion != h.wf.Version {
		t.Fatalf("workflow ref wrong: %s v%d", b.WorkflowID, b.WorkflowVersion)
	}
	if b.StartedAt == nil || b.CompletedAt == nil {
		t.Fatal("timestamps missing")
	}
	if b.PercyBuildID != "999" || b.PercyBuildURL == "" {
		t.Fatalf("percy ref missing: %+v", b)
	}
	if len(b.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %d", len(b.Checkpoints))
	}
	for _, c := range b.Checkpoints {
		if c.Status != CheckpointUploaded {
			t.Fatalf("checkpoint %s = %s", c.CheckpointID, c.Status)
		}
		// artifact-relative, never absolute
		if filepath.IsAbs(c.DomPath) || !strings.HasPrefix(c.DomPath, "dom/") || !strings.HasPrefix(c.MetadataPath, "metadata/") {
			t.Fatalf("bad paths: %q %q", c.DomPath, c.MetadataPath)
		}
	}
	if b.Checkpoints[0].CheckpointID != "dashboard" || b.Checkpoints[1].CheckpointID != "accounts" {
		t.Fatal("checkpoint order changed")
	}
	for _, s := range b.Steps {
		if s.Status != StepPassed {
			t.Fatalf("step %s = %s", s.StepID, s.Status)
		}
	}
	if h.percy.started != 1 || h.percy.stopped != 1 {
		t.Fatalf("percy start/stop = %d/%d", h.percy.started, h.percy.stopped)
	}
}

func TestBuildRecordPersistedBeforeRunnerStarts(t *testing.T) {
	h := newHarness(t)
	h.launch.block = make(chan struct{})
	b, _, err := h.svc.Start(h.wf.WorkflowID, "tok", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	// returned immediately (202 semantics) and already on disk
	if _, err := os.Stat(filepath.Join(h.root, "builds", b.BuildID+".json")); err != nil {
		t.Fatalf("build file missing while run in progress: %v", err)
	}
	if b.Status != StatusQueued {
		t.Fatalf("initial status = %s", b.Status)
	}
	close(h.launch.block)
	h.svc.Wait()
}

func TestSecretsNeverPersistedOrLogged(t *testing.T) {
	h := newHarness(t)
	h.launch.lines = happyLines(h.root)
	b := h.startAndWait(t, "")

	// the runner did get the secret (via the 0600 request file)...
	if !strings.Contains(string(h.launch.req), "hunter2-SECRET") {
		t.Fatal("runner request should carry the secret")
	}
	// ...but it is removed afterwards and never lands in build JSON or logs
	if _, err := os.Stat(filepath.Join(h.root, "artifacts", b.BuildID, ".request.json")); !os.IsNotExist(err) {
		t.Fatalf("request file should be deleted, err=%v", err)
	}
	err := filepath.Walk(h.root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		data, _ := os.ReadFile(p)
		if strings.Contains(string(data), "hunter2-SECRET") {
			t.Errorf("secret leaked into %s", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestIdempotencyKeyReturnsSameBuild(t *testing.T) {
	h := newHarness(t)
	h.launch.lines = happyLines(h.root)
	b1, dup1, err := h.svc.Start(h.wf.WorkflowID, "tok", "key-1", nil)
	if err != nil || dup1 {
		t.Fatalf("first: %v dup=%v", err, dup1)
	}
	h.svc.Wait()
	b2, dup2, err := h.svc.Start(h.wf.WorkflowID, "tok", "key-1", nil)
	if err != nil || !dup2 || b2.BuildID != b1.BuildID {
		t.Fatalf("retry should return existing build: %v dup=%v %s vs %s", err, dup2, b2.BuildID, b1.BuildID)
	}
	list, _ := h.builds.List()
	if len(list) != 1 {
		t.Fatalf("builds = %d, want 1", len(list))
	}
}

func TestConcurrentRunsRejected(t *testing.T) {
	h := newHarness(t)
	h.launch.block = make(chan struct{})
	if _, _, err := h.svc.Start(h.wf.WorkflowID, "tok", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.svc.Start(h.wf.WorkflowID, "tok", "", nil); !errors.Is(err, ErrBusy) {
		t.Fatalf("want ErrBusy, got %v", err)
	}
	close(h.launch.block)
	h.svc.Wait()
	list, _ := h.builds.List()
	if len(list) != 1 {
		t.Fatalf("rejected run must not leave a build: %d", len(list))
	}
}

func TestBusyWhenSnapshotFinalizeRunning(t *testing.T) {
	h := newHarness(t)
	h.busy = true
	if _, _, err := h.svc.Start(h.wf.WorkflowID, "tok", "", nil); !errors.Is(err, ErrBusy) {
		t.Fatalf("want ErrBusy, got %v", err)
	}
}

func TestMissingTokenAndMissingWorkflow(t *testing.T) {
	h := newHarness(t)
	if _, _, err := h.svc.Start(h.wf.WorkflowID, "", "", nil); !errors.Is(err, ErrNoToken) {
		t.Fatalf("want ErrNoToken, got %v", err)
	}
	if _, _, err := h.svc.Start("wf_missing", "tok", "", nil); !errors.Is(err, workflow.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if _, _, err := h.svc.Start("../x", "tok", "", nil); !errors.Is(err, workflow.ErrInvalidID) {
		t.Fatalf("want ErrInvalidID, got %v", err)
	}
}

func TestStepFailureFailsBuildAndNamesTheStep(t *testing.T) {
	h := newHarness(t)
	h.launch.exit = 1
	h.launch.lines = []string{
		ev(map[string]any{"type": "stepStarted", "stepId": "step_001"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_001", "status": "passed"}),
		ev(map[string]any{"type": "stepStarted", "stepId": "step_002"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_002", "status": "failed", "message": `locator role=button[name="Go"] matched 2 elements`}),
	}
	b := h.startAndWait(t, "")
	if b.Status != StatusFailed {
		t.Fatalf("status = %s", b.Status)
	}
	if len(b.Errors) == 0 || b.Errors[0].StepID != "step_002" || !strings.Contains(b.Errors[0].Message, "matched 2") {
		t.Fatalf("errors = %+v", b.Errors)
	}
	// later steps never ran: skipped, not left pending/running
	if b.Steps[2].Status != StepSkipped || b.Steps[3].Status != StepSkipped {
		t.Fatalf("remaining steps = %s %s", b.Steps[2].Status, b.Steps[3].Status)
	}
	for _, c := range b.Checkpoints {
		if c.Status == CheckpointPending {
			t.Fatalf("checkpoint %s left pending", c.CheckpointID)
		}
	}
	if h.percy.stopped != 1 {
		t.Fatal("percy must be stopped after a failed run")
	}
}

func TestUploadFailureMakesBuildPartialAndKeepsDom(t *testing.T) {
	h := newHarness(t)
	h.launch.exit = 2
	h.launch.lines = []string{
		ev(map[string]any{"type": "stepStarted", "stepId": "step_003"}),
		ev(map[string]any{"type": "checkpointCaptured", "checkpointId": "dashboard", "domPath": h.root + "/x/dom/dashboard.html", "metadataPath": h.root + "/x/metadata/dashboard.json"}),
		ev(map[string]any{"type": "checkpointUploadFailed", "checkpointId": "dashboard", "message": "percy returned 500"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_003", "status": "passed"}),
	}
	b := h.startAndWait(t, "")
	if b.Status != StatusPartial {
		t.Fatalf("status = %s", b.Status)
	}
	c := b.Checkpoints[0]
	if c.Status != CheckpointUploadFailed || c.DomPath != "dom/dashboard.html" || !strings.Contains(c.Error, "500") {
		t.Fatalf("checkpoint = %+v", c)
	}
}

func TestPercyNotIdleMakesBuildPartial(t *testing.T) {
	h := newHarness(t)
	h.percy.idleErr = errors.New("timed out waiting for Percy")
	h.launch.lines = happyLines(h.root)
	b := h.startAndWait(t, "")
	if b.Status != StatusPartial {
		t.Fatalf("status = %s", b.Status)
	}
}

func TestRunnerCrashDoesNotLeaveBuildRunning(t *testing.T) {
	h := newHarness(t)
	h.launch.exit = 9 // e.g. killed / segfault
	h.launch.lines = []string{ev(map[string]any{"type": "stepStarted", "stepId": "step_001"})}
	b := h.startAndWait(t, "")
	if b.Status != StatusFailed || len(b.Errors) == 0 || !strings.Contains(b.Errors[len(b.Errors)-1].Message, "crashed") {
		t.Fatalf("status=%s errors=%+v", b.Status, b.Errors)
	}
	if b.Steps[0].Status != StepSkipped {
		t.Fatalf("in-flight step should be finalized, got %s", b.Steps[0].Status)
	}
}

func TestLaunchFailureAndSetupFailureFinalize(t *testing.T) {
	h := newHarness(t)
	h.launch.err = errors.New("node not found")
	if b := h.startAndWait(t, ""); b.Status != StatusFailed || !strings.Contains(b.Errors[0].Message, "node not found") {
		t.Fatalf("launch failure: %s %+v", b.Status, b.Errors)
	}
	h2 := newHarness(t)
	h2.rt.setupErr = errors.New("npm install failed")
	if b := h2.startAndWait(t, ""); b.Status != StatusFailed || !strings.Contains(b.Errors[0].Message, "npm install") {
		t.Fatalf("setup failure: %s %+v", b.Status, b.Errors)
	}
	h3 := newHarness(t)
	h3.percy.startEr = errors.New("percy exited before it was ready")
	if b := h3.startAndWait(t, ""); b.Status != StatusFailed {
		t.Fatalf("percy start failure: %s", b.Status)
	}
}

func TestTimeoutFinalizesAsFailed(t *testing.T) {
	h := newHarness(t)
	h.svc.cfg.RunTimeout = 150 * time.Millisecond
	h.launch.block = make(chan struct{}) // never released
	b := h.startAndWait(t, "")
	if b.Status != StatusFailed || !strings.Contains(b.Errors[len(b.Errors)-1].Message, "timed out") {
		t.Fatalf("status=%s errors=%+v", b.Status, b.Errors)
	}
}

func TestCancelFinalizesAsCancelledAndFreesTheSlot(t *testing.T) {
	h := newHarness(t)
	h.launch.block = make(chan struct{})
	b, _, err := h.svc.Start(h.wf.WorkflowID, "tok", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	// wait until the runner is actually running
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cur, _ := h.builds.Get(b.BuildID); cur != nil && cur.Status == StatusRunning {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := h.svc.Cancel(b.BuildID); err != nil {
		t.Fatal(err)
	}
	h.svc.Wait()
	got, _ := h.builds.Get(b.BuildID)
	if got.Status != StatusCancelled {
		t.Fatalf("status = %s", got.Status)
	}
	if h.percy.stopped != 1 {
		t.Fatal("percy not stopped after cancel")
	}
	// slot is free again
	h.launch.block = nil
	h.launch.lines = happyLines(h.root)
	if _, _, err := h.svc.Start(h.wf.WorkflowID, "tok", "", nil); err != nil {
		t.Fatalf("new run after cancel: %v", err)
	}
	h.svc.Wait()
	if err := h.svc.Cancel(b.BuildID); !errors.Is(err, ErrNotCancelled) {
		t.Fatalf("cancelling a finished build: %v", err)
	}
}

func TestLateRunnerEventsCannotOverwriteTerminalState(t *testing.T) {
	h := newHarness(t)
	h.launch.lines = happyLines(h.root)
	b := h.startAndWait(t, "")
	_, err := h.builds.Update(b.BuildID, func(