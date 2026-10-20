package runs

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/percy"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

type fakePercy struct {
	mu      sync.Mutex
	started int
	stopped int
	idleErr error
	startEr error
	// lastOpts records the branch settings of the most recent Start.
	lastOpts percy.Options
}

func (f *fakePercy) EnsureReady() error { return nil }
func (f *fakePercy) Start(_ string, opts percy.Options) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.started++
	f.lastOpts = opts
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
	exit  int
	block chan struct{} // if set, Wait blocks until closed or ctx is done
	ctx   context.Context
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
	// a real *exec.ExitError carrying the wanted exit code
	return exec.Command("sh", "-c", "exit "+strconv.Itoa(p.exit)).Run()
}
func (p *fakeProc) Kill() error { return nil }

type launchCfg struct {
	mu    sync.Mutex
	lines []string
	exit  int
	block chan struct{}
	err   error
	req   []byte
}

type harness struct {
	svc    *Service
	builds *Store
	wfs    *workflow.Store
	percy  *fakePercy
	rt     *fakeRuntime
	wf     *workflow.Workflow
	launch *launchCfg
	root   string
	busy   bool
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	wfs, err := workflow.NewStore(filepath.Join(root, "workflows"))
	if err != nil {
		t.Fatal(err)
	}
	builds, err := NewStore(filepath.Join(root, "builds"))
	if err != nil {
		t.Fatal(err)
	}
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
			h.launch.req, _ = os.ReadFile(req) // request file must exist while running
			for _, l := range h.launch.lines {
				onLine(l)
			}
			return &fakeProc{exit: h.launch.exit, block: h.launch.block, ctx: ctx}, nil
		},
	})
	return h
}

func ev(m map[string]any) string {
	b, _ := json.Marshal(m)
	return string(b)
}

func happyLines(root string) []string {
	cp := func(id string) string {
		return ev(map[string]any{"type": "checkpointCaptured", "checkpointId": id,
			"domPath":      root + "/artifacts/b/dom/" + id + ".html",
			"metadataPath": root + "/artifacts/b/metadata/" + id + ".json"})
	}
	up := func(id string) string { return ev(map[string]any{"type": "checkpointUploaded", "checkpointId": id}) }
	st := func(id string) string { return ev(map[string]any{"type": "stepStarted", "stepId": id}) }
	fin := func(id string) string {
		return ev(map[string]any{"type": "stepFinished", "stepId": id, "status": "passed", "durationMs": 12})
	}
	return []string{
		st("step_001"), fin("step_001"), st("step_002"), fin("step_002"),
		st("step_003"), cp("dashboard"), up("dashboard"), fin("step_003"),
		st("step_004"), cp("accounts"), up("accounts"), fin("step_004"),
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
