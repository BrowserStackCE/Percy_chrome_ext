package service

import (
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/percy"
)

// ErrBuildRunning is returned when a build is already in progress.
var ErrBuildRunning = errors.New("a build is already running")

type BuildService struct {
	percy    *percy.Controller
	client   *percy.Client
	snapshot *SnapshotService
	job      *BuildJob

	// externalBusy, when set, reports another user of the single Percy process
	// (e.g. a workflow run). Finalize refuses to start while it returns true.
	externalBusy func() bool
}

// SetExternalBusy registers a check for other users of the Percy process.
func (s *BuildService) SetExternalBusy(fn func() bool) { s.externalBusy = fn }

// Running reports whether a finalize build is in progress.
func (s *BuildService) Running() bool { return s.job.Snapshot().Status == StatusRunning }

func NewBuildService(controller *percy.Controller, client *percy.Client, snapshot *SnapshotService) *BuildService {
	s := &BuildService{
		percy:    controller,
		client:   client,
		snapshot: snapshot,
		job:      NewBuildJob(),
	}
	controller.SetLogSink(s.job.AddLog)
	return s
}

// Status returns the current build job state.
func (s *BuildService) Status() BuildStatus {
	return s.job.Snapshot()
}

// Subscribe returns a channel signalled on every state change.
func (s *BuildService) Subscribe() subscriber { return s.job.Subscribe() }

// Unsubscribe removes the subscriber.
func (s *BuildService) Unsubscribe(ch subscriber) { s.job.Unsubscribe(ch) }

// StartFinalize validates, then runs the build in the background.
func (s *BuildService) StartFinalize(token string) error {
	if s.externalBusy != nil && s.externalBusy() {
		return ErrBuildRunning
	}
	snapshots := s.snapshot.List()
	if len(snapshots) == 0 {
		return fmt.Errorf("no snapshots available")
	}

	progress := make([]SnapshotProgress, len(snapshots))
	for i, snap := range snapshots {
		progress[i] = SnapshotProgress{ID: snap.ID, Name: snap.Name, State: SnapPending}
	}
	if !s.job.Start(progress) {
		return ErrBuildRunning
	}

	go func() {
		if err := s.run(token); err != nil {
			log.Printf("[build] failed: %v", err)
			s.job.AddLog("Build failed: " + err.Error())
			s.job.Fail(err)
		}
	}()
	return nil
}

func (s *BuildService) run(token string) error {
	snapshots := s.snapshot.List()

	s.job.SetPhase(PhaseInstalling)
	if err := s.percy.EnsureReady(); err != nil {
		return err
	}
	log.Println("[build] Percy runtime ready")

	s.job.SetPhase(PhaseStarting)
	if err := s.percy.Start(token); err != nil {
		return err
	}

	// Always stop Percy, on success or failure.
	defer func() {
		if err := s.percy.Stop(); err != nil {
			log.Printf("[build] failed to stop Percy: %v", err)
		}
	}()

	health, err := s.client.Health()
	if err != nil {
		return err
	}

	s.job.SetPhase(PhaseUploading)
	for i, snap := range snapshots {
		s.job.SetSnapshot(i, SnapSending, "")
		s.job.AddLog(fmt.Sprintf("Uploading %d/%d: %s", i+1, len(snapshots), snap.Name))

		if err := s.client.Snapshot(snap); err != nil {
			s.job.SetSnapshot(i, SnapFailed, err.Error())
			return fmt.Errorf("snapshot %q failed: %w", snap.Name, err)
		}

		s.job.SetSnapshot(i, SnapSent, "")
		s.job.AddLog(fmt.Sprintf("Sent %d/%d", i+1, len(snapshots)))
	}

	// Wait until Percy has processed every queued snapshot (or exits/times out).
	s.job.SetPhase(PhaseProcessing)
	if err := s.client.WaitIdle(5*time.Minute, s.percy.Exited()); err != nil {
		return err
	}

	s.snapshot.Clear()
	s.job.AddLog("Percy finished processing snapshots")
	s.job.Succeed(health.Build.ID, health.Build.URL)
	return nil
}