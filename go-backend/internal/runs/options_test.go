package runs

import (
	"errors"
	"testing"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/percy"
)

func TestStartWithOptionsPassesBranchSettingsToPercy(t *testing.T) {
	h := newHarness(t)
	h.launch.lines = happyLines(h.root)

	opts := percy.Options{Branch: " staging ", TargetBranch: "production"}
	b, _, err := h.svc.StartWithOptions(h.wf.WorkflowID, "tok", "", nil, opts)
	if err != nil {
		t.Fatal(err)
	}
	h.svc.Wait()
	if _, err := h.builds.Get(b.BuildID); err != nil {
		t.Fatal(err)
	}

	h.percy.mu.Lock()
	got := h.percy.lastOpts
	h.percy.mu.Unlock()
	if got.Branch != "staging" || got.TargetBranch != "production" {
		t.Fatalf("percy got %+v, want trimmed staging/production", got)
	}
}

func TestStartWithoutOptionsUsesDefaults(t *testing.T) {
	h := newHarness(t)
	h.launch.lines = happyLines(h.root)
	h.startAndWait(t, "")

	h.percy.mu.Lock()
	got := h.percy.lastOpts
	h.percy.mu.Unlock()
	if got != (percy.Options{}) {
		t.Fatalf("expected zero options for old callers, got %+v", got)
	}
}

func TestStartWithInvalidOptionsIsRejectedBeforeAnythingStarts(t *testing.T) {
	h := newHarness(t)
	_, _, err := h.svc.StartWithOptions(h.wf.WorkflowID, "tok", "", nil, percy.Options{Branch: "bad branch"})
	if !errors.Is(err, ErrInvalidOptions) {
		t.Fatalf("err = %v, want ErrInvalidOptions", err)
	}
	if h.percy.started != 0 {
		t.Fatalf("percy must not start for invalid options, started=%d", h.percy.started)
	}
	list, err := h.builds.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("no build record should be created, got %d", len(list))
	}
}
