package service

import (
	"fmt"
	"log"
	"time"

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

func (s *BuildService) Finalize(token string) (*BuildResult, error) {

	snapshots := s.snapshot.List()

	if len(snapshots) == 0 {
		return nil, fmt.Errorf("no snapshots available")
	}

	if err := s.percy.EnsureReady(); err != nil {
		return nil, err
	}

	log.Println("[build] Percy runtime ready")
	log.Println("[build] Starting Percy exec:start...")

	if err := s.percy.Start(token); err != nil {
		return nil, err
	}

	// Always stop Percy, on success or failure.
	defer func() {
		if err := s.percy.Stop(); err != nil {
			log.Printf("[build] failed to stop Percy: %v", err)
		}
	}()

	health, err := s.client.Health()
	if err != nil {
		return nil, err
	}

	for i, snap := range snapshots {

		fmt.Printf(
			"Uploading %d/%d: %s\n",
			i+1,
			len(snapshots),
			snap.Name,
		)

		if err := s.client.Snapshot(snap); err != nil {
			return nil, err
		}

		fmt.Printf(
			"✓ Sent %d/%d\n",
			i+1,
			len(snapshots),
		)
	}

	// Wait until Percy has processed every queued snapshot (or exits/times out).
	if err := s.client.WaitIdle(5*time.Minute, s.percy.Exited()); err != nil {
		return nil, err
	}

	s.snapshot.Clear()

	fmt.Println("Percy finished processing snapshots")

	return &BuildResult{
		BuildID:  health.Build.ID,
		BuildURL: health.Build.URL,
	}, nil
}