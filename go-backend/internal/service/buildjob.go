package service

import (
	"strings"
	"sync"
	"time"
)

const maxLogLines = 500

// subscriber is a channel that receives a signal whenever the job state changes.
type subscriber chan struct{}

type BuildStatusValue string
type BuildPhase string
type SnapshotState string

const (
	StatusIdle    BuildStatusValue = "idle"
	StatusRunning BuildStatusValue = "running"
	StatusSuccess BuildStatusValue = "success"
	StatusFailed  BuildStatusValue = "failed"

	PhaseInstalling BuildPhase = "installing"
	PhaseStarting   BuildPhase = "starting"
	PhaseUploading  BuildPhase = "uploading"
	PhaseProcessing BuildPhase = "processing"
	PhaseDone       BuildPhase = "done"

	SnapPending SnapshotState = "pending"
	SnapSending SnapshotState = "sending"
	SnapSent    SnapshotState = "sent"
	SnapFailed  SnapshotState = "failed"
)

type BuildLogEntry struct {
	Timestamp time.Time `json:"ts"`
	Level     string    `json:"level"`
	Line      string    `json:"line"`
}

type SnapshotProgress struct {
	ID    string        `json:"id"`
	Name  string        `json:"name"`
	State SnapshotState `json:"state"`
	Error string        `json:"error,omitempty"`
}

// BuildStatus is the JSON snapshot returned by GET /build/status.
type BuildStatus struct {
	Status    BuildStatusValue   `json:"status"`
	Phase     BuildPhase         `json:"phase"`
	Total     int                `json:"total"`
	Sent      int                `json:"sent"`
	Snapshots []SnapshotProgress `json:"snapshots"`
	Logs      []BuildLogEntry    `json:"logs"`
	Error     string             `json:"error,omitempty"`
	BuildID   string             `json:"buildId,omitempty"`
	BuildURL  string             `json:"buildUrl,omitempty"`
}

// BuildJob tracks the progress of one finalize run. Safe for concurrent use.
type BuildJob struct {
	mu   sync.Mutex
	s    BuildStatus
	subs map[subscriber]struct{}
}

func NewBuildJob() *BuildJob {
	return &BuildJob{
		s: BuildStatus{
			Status:    StatusIdle,
			Snapshots: []SnapshotProgress{},
			Logs:      []BuildLogEntry{},
		},
		subs: make(map[subscriber]struct{}),
	}
}

// Subscribe returns a channel that receives a signal (non-blocking send) on
// every state change. Call Unsubscribe when done.
func (j *BuildJob) Subscribe() subscriber {
	ch := make(subscriber, 1)
	j.mu.Lock()
	j.subs[ch] = struct{}{}
	j.mu.Unlock()
	return ch
}

// Unsubscribe removes and closes the subscriber channel.
func (j *BuildJob) Unsubscribe(ch subscriber) {
	j.mu.Lock()
	delete(j.subs, ch)
	j.mu.Unlock()
	close(ch)
}

// notify sends a non-blocking signal to all subscribers. Must be called with mu held.
func (j *BuildJob) notify() {
	for ch := range j.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// Start resets the job for a new run. Returns false if one is already running.
func (j *BuildJob) Start(snaps []SnapshotProgress) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.s.Status == StatusRunning {
		return false
	}
	j.s = BuildStatus{
		Status:    StatusRunning,
		Phase:     PhaseInstalling,
		Total:     len(snaps),
		Snapshots: snaps,
		Logs:      []BuildLogEntry{},
	}
	j.notify()
	return true
}

func (j *BuildJob) SetPhase(p BuildPhase) {
	j.mu.Lock()
	j.s.Phase = p
	j.notify()
	j.mu.Unlock()
}

func (j *BuildJob) SetSnapshot(i int, state SnapshotState, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if i < 0 || i >= len(j.s.Snapshots) {
		return
	}
	j.s.Snapshots[i].State = state
	j.s.Snapshots[i].Error = errMsg
	if state == SnapSent {
		j.s.Sent++
	}
	j.notify()
}

// AddLog appends a line, detecting its level, keeping only the newest lines.
func (j *BuildJob) AddLog(line string) {
	line = strings.TrimSpace(line)
	if line == "" {
		return
	}
	entry := BuildLogEntry{Timestamp: time.Now(), Level: detectLevel(line), Line: line}
	j.mu.Lock()
	defer j.mu.Unlock()
	j.s.Logs = append(j.s.Logs, entry)
	if len(j.s.Logs) > maxLogLines {
		j.s.Logs = append([]BuildLogEntry(nil), j.s.Logs[len(j.s.Logs)-maxLogLines:]...)
	}
	j.notify()
}

func (j *BuildJob) Succeed(buildID, buildURL string) {
	j.mu.Lock()
	j.s.Status = StatusSuccess
	j.s.Phase = PhaseDone
	j.s.BuildID = buildID
	j.s.BuildURL = buildURL
	j.notify()
	j.mu.Unlock()
}

func (j *BuildJob) Fail(err error) {
	j.mu.Lock()
	j.s.Status = StatusFailed
	j.s.Error = err.Error()
	j.notify()
	j.mu.Unlock()
}

// Snapshot returns a deep copy safe to serialize.
func (j *BuildJob) Snapshot() BuildStatus {
	j.mu.Lock()
	defer j.mu.Unlock()
	out := j.s
	out.Snapshots = append([]SnapshotProgress{}, j.s.Snapshots...)
	out.Logs = append([]BuildLogEntry{}, j.s.Logs...)
	return out
}

func detectLevel(line string) string {
	l := strings.ToLower(line)
	switch {
	case strings.Contains(l, "error") || strings.Contains(l, "failed") || strings.Contains(l, "fatal"):
		return "error"
	case strings.Contains(l, "warn"):
		return "warn"
	default:
		return "info"
	}
}
