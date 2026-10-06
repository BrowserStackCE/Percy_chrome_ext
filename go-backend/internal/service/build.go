package service

import (
	"fmt"
	"log"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/percy"
)

type BuildService struct {
	percy    *percy.Controller
	client   *percy.Client
	snapshot *SnapshotService
}

type BuildResult struct {
	BuildID  string
	BuildURL string
}

func NewBuildService(controller *percy.Controller, client *percy.Client, snapshot *SnapshotService) *BuildService {
	return &BuildService{
		percy:    controller,
		client:   client,
		snapshot: snapshot,
	}
}

// ProgressFunc receives human-readable status lines as the build progresses.
// It is called from the goroutine running Finalize, so implementations must
// be goroutine-safe (e.g. writing to a buffered channel).
type ProgressFunc func(msg string)

// Finalize runs the full Percy build pipeline, calling progress for each
// notable step. Pass nil for progress to suppress streaming output.
func (s *BuildService) Finalize(token string, progress ProgressFunc) (*BuildResult, error) {
	emit := func(msg string) {
		log.Printf("[build] %s", msg)
		if progress != nil {
			progress(msg)
		}
	}

	snapshots := s.snapshot.List()
	if len(snapshots) == 0 {
		return nil, fmt.Errorf("no snapshots queued")
	}

	emit("Checking Percy runtime…")
	if err := s.percy.EnsureReady(); err != nil {
		return nil, err
	}

	emit("Percy runtime ready")
	emit("Starting Percy agent…")

	if err := s.percy.Start(token); err != nil {
		return nil, err
	}
	defer s.percy.Stop()

	emit("Percy agent started — fetching build info…")

	health, err := s.client.Health()
	if err != nil {
		return nil, err
	}

	emit(fmt.Sprintf("Build created (ID: %s)", health.Build.ID))
	emit(fmt.Sprintf("Uploading %d snapshot(s)…", len(snapshots)))

	for i, snap := range snapshots {
		emit(fmt.Sprintf("Uploading %d/%d: %s", i+1, len(snapshots), snap.Name))

		if err := s.client.Snapshot(snap); err != nil {
			return nil, fmt.Errorf("snapshot %q failed: %w", snap.Name, err)
		}

		if err := s.percy.WaitFor("Snapshot taken"); err != nil {
			return nil, err
		}

		emit(fmt.Sprintf("✓ %d/%d uploaded: %s", i+1, len(snapshots), snap.Name))
	}

	s.snapshot.Clear()
	emit("All snapshots uploaded — finalizing build…")

	return &BuildResult{
		BuildID:  health.Build.ID,
		BuildURL: health.Build.URL,
	}, nil
}