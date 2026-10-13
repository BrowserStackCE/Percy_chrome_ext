package workflow

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func valid() *Workflow {
	return &Workflow{
		Name:          "Dashboard",
		SchemaVersion: 1,
		StartURL:      "https://example.test/login",
		Settings:      Settings{Viewport: Viewport{Width: 1440, Height: 900}},
		Steps: []Step{
			{ID: "step_001", Type: "fill", Target: &Target{Role: "textbox", Name: "Username"}, ValueRef: "username"},
			{ID: "step_002", Type: "click", Target: &Target{Role: "button", Name: "Sign in"}},
			{ID: "step_003", Type: "waitFor", Condition: "visible", Target: &Target{Role: "heading", Name: "Dashboard"}, TimeoutMs: 10000},
			{ID: "step_004", Type: "snapshot", CheckpointID: "dashboard", Name: "Dashboard"},
		},
	}
}

func TestValidateOK(t *testing.T) {
	if err := valid().Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRejects(t *testing.T) {
	cases := map[string]func(w *Workflow){
		"unknown step type": func(w *Workflow) { w.Steps[1].Type = "exec" },
		"bad scheme":        func(w *Workflow) { w.StartURL = "javascript:alert(1)" },
		"file scheme":       func(w *Workflow) { w.StartURL = "file:///etc/passwd" },
		"missing target":    func(w *Workflow) { w.Steps[1].Target = nil },
		"literal in password": func(w *Workflow) {
			w.Steps[0].Target.Name = "Password"
			w.Steps[0].ValueRef = ""
			w.Steps[0].Value = "hunter2"
		},
		"both value and ref": func(w *Workflow) { w.Steps[0].Value = "x" },
		"duplicate step id":  func(w *Workflow) { w.Steps[1].ID = "step_001" },
		"duplicate checkpoint": func(w *Workflow) {
			w.Steps = append(w.Steps, Step{ID: "step_005", Type: "snapshot", CheckpointID: "dashboard", Name: "again"})
		},
		"unsafe checkpoint":     func(w *Workflow) { w.Steps[3].CheckpointID = "../evil" },
		"no steps":              func(w *Workflow) { w.Steps = nil },
		"bad schema":            func(w *Workflow) { w.SchemaVersion = 99 },
		"bad condition":         func(w *Workflow) { w.Steps[2].Condition = "sleep" },
		"timeout too large":     func(w *Workflow) { w.Steps[2].TimeoutMs = 99999999 },
		"bad valueRef":          func(w *Workflow) { w.Steps[0].ValueRef = "a b;rm -rf" },
		"navigate bad url":      func(w *Workflow) { w.Steps = append(w.Steps, Step{ID: "step_009", Type: "navigate", URL: "ftp://x"}) },
		"snapshot without name": func(w *Workflow) { w.Steps[3].Name = " " },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			w := valid()
			mutate(w)
			if err := w.Validate(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestStoreRoundTripAndUpdate(t *testing.T) {
	s, _ := NewStore(t.TempDir())
	w := valid()
	if err := s.Create(w); err != nil {
		t.Fatal(err)
	}
	if !ValidID(w.WorkflowID) || w.Version != 1 {
		t.Fatalf("bad id/version: %s %d", w.WorkflowID, w.Version)
	}
	got, err := s.Get(w.WorkflowID)
	if err != nil || got.Name != "Dashboard" || len(got.Steps) != 4 {
		t.Fatalf("round trip failed: %v %+v", err, got)
	}

	upd := valid()
	upd.Name = "Renamed"
	if err := s.Update(w.WorkflowID, upd); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Get(w.WorkflowID)
	if got.Name != "Renamed" || got.Version != 1 || !got.CreatedAt.Equal(w.CreatedAt) {
		t.Fatalf("overwrite semantics wrong: %+v", got)
	}

	list, _ := s.List()
	if len(list) != 1 {
		t.Fatalf("list = %d", len(list))
	}
}

func TestStoreErrors(t *testing.T) {
	dir := t.TempDir()
	s, _ := NewStore(dir)
	if _, err := s.Get("wf_missing"); err != ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	for _, id := range []string{"../x", "a/b", "", "WF_UP", "wf 1", "..", strings.Repeat("a", 100)} {
		if _, err := s.Get(id); err != ErrInvalidID {
			t.Fatalf("id %q: want ErrInvalidID, got %v", id, err)
		}
		if err := s.Update(id, valid()); err != ErrInvalidID {
			t.Fatalf("update id %q: want ErrInvalidID, got %v", id, err)
		}
	}
	// corrupt file is reported on Get, skipped on List
	if err := os.WriteFile(filepath.Join(dir, "wf_bad.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get("wf_bad"); err == nil || err == ErrNotFound {
		t.Fatalf("expected corrupt error, got %v", err)
	}
	if list, err := s.List(); err != nil || len(list) != 0 {
		t.Fatalf("list should skip corrupt: %v %d", err, len(list))
	}
	if err := s.Update("wf_nope", valid()); err != ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestConcurrentUpdatesLeaveValidFile(t *testing.T) {
	s, _ := NewStore(t.TempDir())
	w := valid()
	if err := s.Create(w); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u := valid()
			_ = s.Update(w.WorkflowID, u)
		}()
	}
	wg.Wait()
	if _, err := s.Get(w.WorkflowID); err != nil {
		t.Fatalf("file corrupt after concurrent writes: %v", err)
	}
	entries, _ := os.ReadDir(s.dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			t.Fatalf("leftover temp file %s", e.Name())
		}
	}
}
