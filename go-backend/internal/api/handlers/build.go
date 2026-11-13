package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/httpx"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/percy"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/service"
)

type BuildHandler struct {
	app *app.App
}

type FinalizeRequest struct {
	Token string `json:"token"`
	// Branch and TargetBranch are optional PERCY_BRANCH / PERCY_TARGET_BRANCH
	// overrides. Empty means the defaults.
	Branch       string `json:"branch,omitempty"`
	TargetBranch string `json:"targetBranch,omitempty"`
}

func NewBuildHandler(app *app.App) *BuildHandler {
	return &BuildHandler{
		app: app,
	}
}

func (h *BuildHandler) Finalize(w http.ResponseWriter, r *http.Request) {
	var req FinalizeRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteJSON(w, http.StatusBadRequest ,map[string] string {
			"error":"invalid request",
		})
		return
	}

	opts := percy.Options{Branch: req.Branch, TargetBranch: req.TargetBranch}
	if err := h.app.BuildService.StartFinalize(req.Token, opts); err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, service.ErrBuildRunning) {
			code = http.StatusConflict
		} else if errors.Is(err, service.ErrInvalidOptions) {
			code = http.StatusBadRequest
		}
		httpx.WriteJSON(w, code, map[string]string{
			"error": err.Error(),
		})
		return
	}

	httpx.WriteJSON(w, http.StatusAccepted, map[string]string{
		"status": "running",
	})
}

// Status returns the current build progress and logs.
func (h *BuildHandler) Status(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, h.app.BuildService.Status())
}

// Stream pushes BuildStatus as SSE events whenever the job state changes.
// The client receives an initial snapshot immediately, then a new event on
// every mutation (log line, phase change, snapshot state change, finish).
func (h *BuildHandler) Stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering if present

	send := func() bool {
		data, err := json.Marshal(h.app.BuildService.Status())
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	// Send initial snapshot so the client doesn't wait for the first change.
	if !send() {
		return
	}

	ch := h.app.BuildService.Subscribe()
	defer h.app.BuildService.Unsubscribe(ch)

	// keepalive ticker so the connection doesn't time out on idle builds.
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case _, ok := <-ch:
			if !ok {
				return
			}
			if !send() {
				return
			}
		case <-ticker.C:
			// Send a SSE comment as a keepalive ping.
			if _, err := fmt.Fprintf(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}