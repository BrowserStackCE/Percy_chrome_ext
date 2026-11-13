package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

const goodBody = `{
  "name": "Dashboard",
  "schemaVersion": 1,
  "startUrl": "https://example.test/login",
  "steps": [
    {"id":"step_001","type":"fill","target":{"role":"textbox","name":"Username"},"valueRef":"username"},
    {"id":"step_002","type":"snapshot","checkpointId":"dashboard","name":"Dashboard"}
  ],
  "settings": {"viewport": {"width":1440,"height":900}}
}`

func newTestServer(t *testing.T) (*http.ServeMux, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := workflow.NewStore(filepath.Join(dir, "workflows"))
	if err != nil {
		t.Fatal(err)
	}
	h := NewWorkflowHandler(&app.App{WorkflowStore: store})
	mux := http.NewServeMux()
	mux.HandleFunc("/api/workflows", h.Collection)
	mux.HandleFunc("/api/workflows/", h.Item)
	return mux, dir
}

func do(mux http.Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestWorkflowAPIFlow(t *testing.T) {
	mux, dir := newTestServer(t)

	rec := do(mux, "POST", "/api/workflows", goodBody)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var created workflow.Workflow
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.WorkflowID == "" || created.Version != 1 {
		t.Fatalf("bad created: %+v", created)
	}
	if _, err := os.Stat(filepath.Join(dir, "workflows", created.WorkflowID+".json")); err != nil {
		t.Fatalf("file not persisted: %v", err)
	}

	if rec = do(mux, "GET", "/api/workflows", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), created.WorkflowID) {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	if rec = do(mux, "GET", "/api/workflows/"+created.WorkflowID, ""); rec.Code != 200 {
		t.Fatalf("get: %d", rec.Code)
	}

	upd := strings.Replace(goodBody, "Dashboard\",\n  \"schemaVersion", "Renamed\",\n  \"schemaVersion", 1)
	if rec = do(mux, "PUT", "/api/workflows/"+created.WorkflowID, upd); rec.Code != 200 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	var got workflow.Workflow
	_ = json.Unmarshal(do(mux, "GET", "/api/workflows/"+created.WorkflowID, "").Body.Bytes(), &got)
	if got.Name != "Renamed" || got.Version != 1 {
		t.Fatalf("update not applied: %+v", got)
	}
}

func TestWorkflowAPIRejects(t *testing.T) {
	mux, dir := newTestServer(t)
	cases := []struct {
		name, method, path, body string
		want                     int
	}{
		{"malformed json", "POST", "/api/workflows", "{not json", 400},
		{"unknown field", "POST", "/api/workflows", `{"name":"x","bogus":1}`, 400},
		{"unknown step", "POST", "/api/workflows", strings.Replace(goodBody, `"type":"fill"`, `"type":"exec"`, 1), 400},
		{"bad url scheme", "POST", "/api/workflows", strings.Replace(goodBody, "https://example.test/login", "javascript:alert(1)", 1), 400},
		{"missing workflow", "GET", "/api/workflows/wf_missing", "", 404},
		{"traversal get", "GET", "/api/workflows/..%2F..%2Fetc%2Fpasswd", "", 404},
		{"uppercase id", "GET", "/api/workflows/WF_X", "", 400},
		{"put missing", "PUT", "/api/workflows/wf_missing", goodBody, 404},
		{"bad method", "DELETE", "/api/workflows", "", 405},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if rec := do(mux, c.method, c.path, c.body); rec.Code != c.want {
				t.Fatalf("got %d want %d: %s", rec.Code, c.want, rec.Body)
			}
		})
	}
	// nothing escaped the workflows dir
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() != "workflows" {
			t.Fatalf("unexpected file outside store: %s", e.Name())
		}
	}
}

func TestWorkflowAPIBodyTooLarge(t *testing.T) {
	mux, _ := newTestServer(t)
	big := `{"name":"` + strings.Repeat("a", 2<<20) + `"}`
	if rec := do(mux, "POST", "/api/workflows", big); rec.Code != 400 {
		t.Fatalf("got %d", rec.Code)
	}
}
