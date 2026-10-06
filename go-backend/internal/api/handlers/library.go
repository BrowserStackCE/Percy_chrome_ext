package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/httpx"
)

type LibraryHandler struct {
	app *app.App
}

func NewLibraryHandler(app *app.App) *LibraryHandler {
	return &LibraryHandler{
		app: app,
	}
}

type SetTokenRequest struct {
	Token string `json:"token"`
}

func (h *LibraryHandler) SetToken(
	w http.ResponseWriter,
	r *http.Request,
) {

	var req SetTokenRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.app.LibraryService.SetToken(req.Token); err != nil {
		http.Error(w, err.Error() ,http.StatusInternalServerError)
		return
	}

	httpx.WriteJSON(
		w,
		http.StatusOK,
		map[string]string{
			"status": "token set",
		},
	)
}

func(h *LibraryHandler) Search(w http.ResponseWriter ,r *http.Request) {
	query := r.URL.Query().Get("q")

	results := h.app.LibraryService.Search(query)

	httpx.WriteJSON(
		w,
		http.StatusOK,
		results,
	)
}

func (h *LibraryHandler) GetToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"token": h.app.LibraryService.GetToken(),
	})
}

func (h *LibraryHandler) Status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	httpx.WriteJSON(
		w,
		http.StatusOK,
		h.app.LibraryService.Status(),
	)
}

// All returns the entire cached library. Used by the library browser page,
// which needs the full set up front rather than incremental search.
func (h *LibraryHandler) All(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	httpx.WriteJSON(
		w,
		http.StatusOK,
		h.app.LibraryService.All(),
	)
}