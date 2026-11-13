package app

import (
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/library"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/runs"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/runtime"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/service"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

type App struct {
	SnapshotService *service.SnapshotService
	BuildService    *service.BuildService

	LibraryService *library.Service

	WorkflowStore *workflow.Store
	BuildStore    *runs.Store
	RunService    *runs.Service
	RuntimeDir    *runtime.Dir
}
