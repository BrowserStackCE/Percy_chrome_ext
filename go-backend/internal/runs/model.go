// Package runs owns workflow replay: build records, their persistence, and
// the lifecycle of the Node.js Playwright runner process.
package runs

import "time"

type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusPassed    Status = "passed"
	StatusFailed    Status = "failed"
	StatusPartial   Status = "partial"
	StatusCancelled Status = "cancelled"
)

func (s Status) Terminal() bool {
	return s == StatusPassed || s == StatusFailed || s == StatusPartial || s == StatusCancelled
}

type StepStatus string

const (
	StepPending StepStatus = "pending"
	StepRunning StepStatus = "running"
	StepPassed  StepStatus = "passed"
	StepFailed  StepStatus = "failed"
	StepSkipped StepStatus = "skipped"
)

type CheckpointStatus string

const (
	CheckpointPending      CheckpointStatus = "pending"
	CheckpointCaptured     CheckpointStatus = "captured"
	CheckpointUploaded     CheckpointStatus = "uploaded"
	CheckpointUploadFailed CheckpointStatus = "uploadFailed"
	CheckpointFailed       CheckpointStatus = "failed"
)

type StepResult struct {
	StepID     string     `json:"stepId"`
	Type       string     `json:"type"`
	Status     StepStatus `json:"status"`
	DurationMs int64      `json:"durationMs,omitempty"`
	Error      string     `json:"error,omitempty"`
}

// Checkpoint paths are artifact-relative (never absolute) so the build JSON
// never leaks filesystem layout; clients fetch content via the artifact route.
type Checkpoint struct {
	CheckpointID string           `json:"checkpointId"`
	Name         string           `json:"name"`
	Status       CheckpointStatus `json:"status"`
	DomPath      string           `json:"domPath,omitempty"`
	MetadataPath string           `json:"metadataPath,omitempty"`
	Error        string           `json:"error,omitempty"`
}

type RunError struct {
	StepID  string `json:"stepId,omitempty"`
	Message string `json:"message"`
}

type Build struct {
	BuildID         string       `json:"buildId"`
	WorkflowID      string       `json:"workflowId"`
	WorkflowVersion int          `json:"workflowVersion"`
	WorkflowName    string       `json:"workflowName"`
	Status          Status       `json:"status"`
	CreatedAt       time.Time    `json:"createdAt"`
	StartedAt       *time.Time   `json:"startedAt"`
	CompletedAt     *time.Time   `json:"completedAt"`
	CurrentStepID   string       `json:"currentStepId,omitempty"`
	Steps           []StepResult `json:"steps"`
	Checkpoints     []Checkpoint `json:"checkpoints"`
	Errors          []RunError   `json:"errors"`
	PercyBuildID    string       `json:"percyBuildId,omitempty"`
	PercyBuildURL   string       `json:"percyBuildUrl,omitempty"`
	IdempotencyKey  string       `json:"idempotencyKey,omitempty"`
}
