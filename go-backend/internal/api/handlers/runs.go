package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/httpx"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/runs"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

const maxRunBody = 64 << 10 // 64 KiB: token + a few secrets

var artifactNameRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}\.(html|json|log)$`)

type RunsHandler struct {
	app *app.App
}

func NewRunsHandler(a *app.App) *RunsHandler { return &RunsHandler{app: a} }

type runRequest struct {
	// Token is the Percy project token; used for this run only and never stored.
	Token string `json:"token"`
	// Secrets resolves workflow valueRef names for this run only.
	Secrets map[string]string `json:"secrets,omitempty"`
}

// StartRun handles POST /api/workflows/{workflowId}/runs
func (h *RunsHandler) StartRun(w http.ResponseWriter, r *http.Request, workflowID string) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRunBody)
	var req runRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(key) > 128 {
		writeErr(w, http.StatusBadRequest, "Idempotency-Key too long")
		return
	}
	b, dup, err := h.app.RunService.Start(workflowID, req.Token, key, req.Secrets)
	if err != nil {
		switch {
		case errors.Is(err, workflow.ErrNotFound):
			writeErr(w, http.StatusNotFound, "workflow not found")
		case errors.Is(err, workflow.ErrInvalidID):
			writeErr(w, http.StatusBadRequest, "invalid workflow id")
		case errors.Is(err, runs.ErrBusy):
			writeErr(w, http.StatusConflict, err.Error())
		case errors.Is(err, runs.ErrNoToken):
			writeErr(w, http.StatusBadRequest, err.Error())
		default:
			// Keep the real cause visible: a bare message made start failures undiagnosable.
			log.Printf("[runs] start failed for %s: %v", workflowID, err)
			writeErr(w, http.StatusInternalServerError, "could not start run: "+err.Error())
		}
		return
	}
	status := http.StatusAccepted
	if dup {
		status = http.StatusOK // retry of an already-created build
	}
	httpx.WriteJSON(w, status, map[string]any{"buildId": b.BuildID, "status": b.Status, "duplicate": dup})
}

// Builds handles GET /api/builds
func (h *RunsHandler) Builds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	list, err := h.app.BuildStore.List()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

// Build handles /api/builds/{id}, /api/builds/{id}/artifacts[/{kind}/{name}], /api/builds/{id}/cancel
func (h *RunsHandler) Build(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/builds/"), "/")
	parts := strings.Split(rest, "/")
	id := parts[0]
	if !runs.ValidBuildID(id) {
		writeErr(w, http.StatusBadRequest, "invalid build id")
		return
	}
	switch {
	case len(parts) == 1:
		h.getBuild(w, r, id)
	case len(parts) == 2 && parts[1] == "artifacts":
		h.listArtifacts(w, r, id)
	case len(parts) == 4 && parts[1] == "artifacts":
		h.serveArtifact(w, r, id, parts[2], parts[3])
	case len(parts) == 2 && parts[1] == "cancel":
		h.cancel(w, r, id)
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func (h *RunsHandler) getBuild(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	b, err := h.app.BuildStore.Get(id)
	if errors.Is(err, runs.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "build not found")
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, b)
}

func (h *RunsHandler) cancel(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	switch err := h.app.RunService.Cancel(id); {
	case err == nil:
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
	case errors.Is(err, runs.ErrNotFound):
		writeErr(w, http.StatusNotFound, "build not found")
	case errors.Is(err, runs.ErrNotCancelled):
		writeErr(w, http.StatusConflict, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "internal error")
	}
}

type artifactRef struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// listArtifacts returns controlled URLs, never filesystem paths.
func (h *RunsHandler) listArtifacts(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if _, err := h.app.BuildStore.Get(id); err != nil {
		if errors.Is(err, runs.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "build not found")
		} else {
			writeErr(w, http.StatusInternalServerError, "internal error")
		}
		return
	}
	dir, err := h.app.RuntimeDir.Resolve("artifacts", id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid build id")
		return
	}
	refs := []artifactRef{}
	for _, kind := range []string{"dom", "metadata", "logs"} {
		entries, err := os.ReadDir(filepath.Join(dir, kind))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !artifactNameRe.MatchString(e.Name()) {
				continue
			}
			refs = append(refs, artifactRef{Kind: kind, Name: e.Name(),
				URL: "/api/builds/" + id + "/artifacts/" + kind + "/" + e.Name()})
		}
	}
	httpx.WriteJSON(w, http.StatusOK, refs)
}

func (h *RunsHandler) serveArtifact(w http.ResponseWriter, r *http.Request, id, kind, name string) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if (kind != "dom" && kind != "metadata" && kind != "logs") || !artifactNameRe.MatchString(name) {
		writeErr(w, http.StatusBadRequest, "invalid artifact")
		return
	}
	p, err := h.app.RuntimeDir.Resolve("artifacts", id, kind, name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid artifact")
		return
	}
	// refuse symlinks so an artifact can never point outside the runtime dir
	if fi, err := os.Lstat(p); err != nil || !fi.Mode().IsRegular() {
		writeErr(w, http.StatusNotFound, "artifact not found")
		return
	}
	// DOM files may hold user data: force download-as-text, never render/execute.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	http.ServeFile(w, r, p)
}
