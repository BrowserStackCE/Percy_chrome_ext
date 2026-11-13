package handlers

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/percy"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/runs"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/service"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/snapshot"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

func newBranchTestApp(t *testing.T) *app.App {
	t.Helper()
	dir := t.TempDir()
	wfs, err := workflow.NewStore(filepath.Join(dir, "workflows"))
	if err != nil {
		t.Fatal(err)
	}
	builds, err := runs.NewStore(filepath.Join(dir, "builds"))
	if err != nil {
		t.Fatal(err)
	}
	snaps := service.NewSnapshotService(snapshot.NewMemoryStore())
	controller := percy.NewController(nil, nil)
	return &app.App{
		WorkflowStore:   wfs,
		BuildStore:      builds,
		RunService:      runs.NewService(runs.Config{Workflows: wfs, Builds: builds}),
		SnapshotService: snaps,
		BuildService:    service.NewBuildService(controller, percy.NewClient(), snaps),
	}
}

func branchMux(a *app.App) *http.ServeMux {
	runsH := NewRunsHandler(a)
	buildH := NewBuildHandler(a)
	mux := http.NewServeMux()
	mux.HandleFunc("/build/finalize", buildH.Finalize)
	mux.HandleFunc("/api/workflows/wf_none/runs", func(w http.ResponseWriter, r *http.Request) {
		runsH.StartRun(w, r, "wf_none")
	})
	return mux
}

func TestRunsRejectsInvalidBranchWith400(t *testing.T) {
	mux := branchMux(newBranchTestApp(t))
	for _, body := range []string{
		`{"token":"t","branch":"has space"}`,
		`{"token":"t","targetBranch":"bad` + "\\n" + `name"}`,
		`{"token":"t","branch":"` + strings.Repeat("a", 256) + `"}`,
	} {
		rec := do(mux, "POST", "/api/workflows/wf_none/runs", body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %.40q: status %d, want 400 (%s)", body, rec.Code, rec.Body)
		}
	}
}

func TestRunsAcceptsBranchFieldsAndOldBodies(t *testing.T) {
	mux := branchMux(newBranchTestApp(t))
	// Valid branch fields and old-style bodies both get past validation and
	// decoding (DisallowUnknownFields); the missing workflow then gives 404, not 400.
	for _, body := range []string{
		`{"token":"t","branch":"staging","targetBranch":"production"}`,
		`{"token":"t"}`,
	} {
		rec := do(mux, "POST", "/api/workflows/wf_none/runs", body)
		if rec.Code == http.StatusBadRequest {
			t.Fatalf("body %q was rejected as 400: %s", body, rec.Body)
		}
	}
}

func TestFinalizeRejectsInvalidBranchWith400(t *testing.T) {
	mux := branchMux(newBranchTestApp(t))
	rec := do(mux, "POST", "/build/finalize", `{"token":"t","branch":"has space"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400 (%s)", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "invalid branch") {
		t.Fatalf("error should name the problem, got %s", rec.Body)
	}
}

func TestFinalizeWithoutBranchFieldsStillValidates(t *testing.T) {
	mux := branchMux(newBranchTestApp(t))
	// No snapshots queued: an old-style body must reach the existing
	// "no snapshots" check, not fail on the new fields.
	rec := do(mux, "POST", "/build/finalize", `{"token":"t"}`)
	if rec.Code == http.StatusBadRequest {
		t.Fatalf("old-style body rejected as 400: %s", rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "no snapshots") {
		t.Fatalf("expected the no-snapshots error, got %d %s", rec.Code, rec.Body)
	}
}
