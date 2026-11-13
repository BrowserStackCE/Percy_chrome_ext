package runs

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

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

	// the runner did get the secret via the 0600 request file...
	if !strings.Contains(string(h.launch.req), "hunter2-SECRET") {
		t.Fatal("runner request should carry the secret")
	}
	// ...which is deleted afterwards and never lands in build JSON or logs
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
		t.Fatalf("retry should return existing build: %v dup=%v", err, dup2)
	}
	if list, _ := h.builds.List(); len(list) != 1 {
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
	if list, _ := h.builds.List(); len(list) != 1 {
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
