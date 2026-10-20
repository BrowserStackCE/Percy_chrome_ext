package main

import (
	"log"
	"path/filepath"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/api"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/app"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/library"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/percy"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/runs"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/runtime"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/service"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/snapshot"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

func main() {
	store := snapshot.NewMemoryStore()

	snapshotService := service.NewSnapshotService(store)

	binary := percy.NewBinary()
	installer := percy.NewInstaller(binary)
	controller := percy.NewController(binary, installer)
	client := percy.NewClient()

	buildService := service.NewBuildService(
		controller,
		client,
		snapshotService,
	)

	libraryService := library.NewService()

	runtimeDir := runtime.NewDir()
	workflowStore, err := workflow.NewStore(runtimeDir.Workflows())
	if err != nil {
		log.Fatalf("failed to initialise workflow store: %v", err)
	}
	buildStore, err := runs.NewStore(runtimeDir.Builds())
	if err != nil {
		log.Fatalf("failed to initialise build store: %v", err)
	}
	if err := runtimeDirsReady(runtimeDir); err != nil {
		log.Fatalf("failed to prepare runtime directory: %v", err)
	}

	runService := runs.NewService(runs.Config{
		Workflows: workflowStore,
		Builds:    buildStore,
		Percy:     &runs.PercyAdapter{Controller: controller, Client: client},
		Runtime:   runs.NewRuntimeAdapter(runtimeDir),
		PercyURL:  "http://localhost:5338",
		// Workflow runs and snapshot-queue finalize share one Percy process.
		Busy: buildService.Running,
	})
	buildService.SetExternalBusy(runService.Active)
	// A crash or restart must never leave a build permanently "running".
	runService.RecoverInterrupted()

	application := &app.App{
		SnapshotService: snapshotService,
		BuildService:    buildService,
		LibraryService:  libraryService,
		WorkflowStore:   workflowStore,
		BuildStore:      buildStore,
		RunService:      runService,
		RuntimeDir:      runtimeDir,
	}

	server := api.NewServer(":4321", application)

	log.Println("Starting server on port http://localhost:4321")

	if err := server.Start(); err != nil {
		log.Fatal(err)
	}
}

// runtimeDirsReady creates the artifacts root so artifact listing never
// depends on a run having happened first.
func runtimeDirsReady(d *runtime.Dir) error {
	return mkdirAll(filepath.Clean(d.Artifacts()))
}
