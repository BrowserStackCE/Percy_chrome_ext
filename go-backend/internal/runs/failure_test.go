package runs

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestStepFailureFailsBuildAndNamesTheStep(t *testing.T) {
	h := newHarness(t)
	h.launch.exit = 1
	h.launch.lines = []string{
		ev(map[string]any{"type": "stepStarted", "stepId": "step_001"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_001", "status": "passed"}),
		ev(map[string]any{"type": "stepStarted", "stepId": "step_002"}),
		ev(map[string]any{"type": "stepFinished", "stepId": "step_002", "status": "failed",
			"message": `locator role=button[name="Go"] matched 2 elements`}),
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
		ev(map[string]any{"type": "checkpointCaptured", "checkpointId": "dashboard",
			"domPath": h.root + "/x/dom/dashboard.html", "metadataPath": h.root + "/x/metadata/dashboard.json"}),
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
	if b := h.startAndWait(t, ""); b.Status != StatusPartial {
		t.Fatalf("status = %s", b.Status)
	}
}

func TestRunnerCrashDoesNotLeaveBuildRunning(t *testing.T) {
	h := newHarness(t)
	h.launch.exit = 9 // killed / segfault
	h.launch.lines = []string{ev(map[string]any{"type": "stepStarted", "stepId": "step_001"})}
	b := h.startAndWait(t, "")
	if b.Status != StatusFailed || len(b.Errors) == 0 ||
		!strings.Contains(b.Errors[len(b.Errors)-1].Message, "crashed") {
		t.Fatalf("status=%s errors=%+v", b.Status, b.Errors)
	}
	if b.Steps[0].Status != StepSkipped {
		t.Fatalf("in-flight step should be finalized, got %s", b.Steps[0].Status)
	}
}

func TestSetupLaunchAndPercyStartFailuresFinalize(t *testing.T) {
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
	if got, _ := h.builds.Get(b.BuildID); got.Status != StatusCancelled {
		t.Fatalf("status = %s", got.Status)
	}
	if h.percy.stopped != 1 {
		t.Fatal("percy not stopped after cancel")
	}
	// cancelling again, even while the goroutine may still be unwinding, is a conflict
	if err := h.svc.Cancel(b.BuildID); !errors.Is(err, ErrNotCancelled) {
		t.Fatalf("second cancel should conflict, got %v", err)
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
	if b.Status != StatusPassed {
		t.Fatalf("setup: %s", b.Status)
	}
	got, err := h.builds.Update(b.BuildID, func(x *Build) { x.Status = StatusFailed })
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusPassed {
		t.Fatalf("terminal build was mutated: %s", got.Status)
	}
}

func TestRecoverInterruptedFinalizesStaleBuilds(t *testing.T) {
	h := newHarness(t)
	h.launch.block = make(chan struct{})
	b, _, err := h.svc.Start(h.wf.WorkflowID, "tok", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	// simulate a fresh server process finding the leftover non-terminal build
	svc2 := NewService(h.svc.cfg)
	svc2.RecoverInterrupted()
	got, _ := h.builds.Get(b.BuildID)
	if got.Status != StatusFailed || !strings.Contains(got.Errors[len(got.Errors)-1].Message, "interrupted") {
		t.Fatalf("status=%s errors=%+v", got.Status, got.Errors)
	}
	close(h.launch.block)
	h.svc.Wait()
}
