package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/httpx"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/service"
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

func (h *BuildHandler) Finalize(w http.ResponseWriter, r *http.Request) {
	var req FinalizeRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteJSON(w, http.StatusBadRequest ,map[string] string {
			"error":"invalid request",
		})
		return
	}

	if err := h.app.BuildService.StartFinalize(req.Token); err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, service.ErrBuildRunning) {
			code = http.StatusConflict
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