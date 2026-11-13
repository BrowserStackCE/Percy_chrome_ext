package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/httpx"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

const maxWorkflowBody = 1 << 20 // 1 MiB

type WorkflowHandler struct {
	app *app.App
}

func NewWorkflowHandler(app *app.App) *WorkflowHandler {
	return &WorkflowHandler{app: app}
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	httpx.WriteJSON(w, status, map[string]string{"error": msg})
}

func decodeWorkflow(w http.ResponseWriter, r *http.Request) (*workflow.Workflow, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxWorkflowBody)
	var wf workflow.Workflow
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wf); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return nil, false
	}
	return &wf, true
}

// workflowStoreErr maps store errors to HTTP statuses.
func workflowStoreErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, workflow.ErrNotFound):
		writeErr(w, http.StatusNotFound, "workflow not found")
	case errors.Is(err, workflow.ErrInvalidID):
		writeErr(w, http.StatusBadRequest, "invalid workflow id")
	default:
		// validation errors are user errors; anything else is a server error
		if isValidationErr(err) {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		// Keep the real cause in the server log and show it to the (local) user;
		// a bare "internal error" made storage problems impossible to diagnose.
		log.Printf("[workflow] store error: %v", err)
		writeErr(w, http.StatusInternalServerError, "could not save workflow: "+err.Error())
	}
}

func isValidationErr(err error) bool {
	var v *workflow.ValidationError
	return errors.As(err, &v)
}

// Collection handles /api/workflows
func (h *WorkflowHandler) Collection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		wf, ok := decodeWorkflow(w, r)
		if !ok {
			return
		}
		if err := h.app.WorkflowStore.Create(wf); err != nil {
			workflowStoreErr(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, wf)
	case http.MethodGet:
		list, err := h.app.WorkflowStore.List()
		if err != nil {
			workflowStoreErr(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, list)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// Item handles /api/workflows/{workflowId}
func (h *WorkflowHandler) Item(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/workflows/"), "/")
	if wfID, ok := strings.CutSuffix(id, "/runs"); ok && wfID != "" && !strings.Contains(wfID, "/") {
		NewRunsHandler(h.app).StartRun(w, r, wfID)
		return
	}
	if id == "" || strings.Contains(id, "/") {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		wf, err := h.app.WorkflowStore.Get(id)
		if err != nil {
			workflowStoreErr(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, wf)
	case http.MethodPut:
		wf, ok := decodeWorkflow(w, r)
		if !ok {
			return
		}
		if err := h.app.WorkflowStore.Update(id, wf); err != nil {
			workflowStoreErr(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, wf)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
