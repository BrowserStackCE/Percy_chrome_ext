package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/httpx"
)

type BuildHandler struct {
	app *app.App
}

type FinalizeRequest struct {
	Token string `json:"token"`
}

func NewBuildHandler(app *app.App) *BuildHandler {
	return &BuildHandler{
		app: app,
	}
}

// Finalize is the original JSON endpoint (kept for backward compatibility).
func (h *BuildHandler) Finalize(w http.ResponseWriter, r *http.Request) {
	var req FinalizeRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteJSON(w, http.StatusBadRequest, map[string]string{
			"error": "invalid request",
		})
		return
	}

	result, err := h.app.BuildService.Finalize(req.Token, nil)
	if err != nil {
		httpx.WriteJSON(w, http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"message":  "Percy started successfully",
		"buildId":  result.BuildID,
		"buildUrl": result.BuildURL,
	})
}

// FinalizeStream runs the build and streams progress as Server-Sent Events.
// Each event is one of:
//
//	event: progress  data: <human-readable message>
//	event: done      data: {"buildId":"…","buildUrl":"…"}
//	event: error     data: <error message>
func (h *BuildHandler) FinalizeStream(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token query param required", http.StatusBadRequest)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	send := func(event, data string) {
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
		flusher.Flush()
	}

	progress := func(msg string) {
		send("progress", msg)
	}

	result, err := h.app.BuildService.Finalize(token, progress)
	if err != nil {
		send("error", err.Error())
		return
	}

	send("done", fmt.Sprintf(`{"buildId":%q,"buildUrl":%q}`, result.BuildID, result.BuildURL))
}