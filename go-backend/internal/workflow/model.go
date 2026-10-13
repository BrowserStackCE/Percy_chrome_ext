// Package workflow defines the recorded-workflow schema, its validation and
// its JSON persistence under runtime/workflows.
package workflow

import "time"

const SchemaVersion = 1

type Target struct {
	TestID    string   `json:"testId,omitempty"`
	Role      string   `json:"role,omitempty"`
	Name      string   `json:"name,omitempty"`
	CSS       string   `json:"css,omitempty"`
	Text      string   `json:"text,omitempty"`
	Fallbacks []Target `json:"fallbacks,omitempty"`
}

type Step struct {
	ID           string  `json:"id"`
	Type         string  `json:"type"`
	Label        string  `json:"label,omitempty"`
	Target       *Target `json:"target,omitempty"`
	Value        string  `json:"value,omitempty"`    // literal, non-sensitive only
	ValueRef     string  `json:"valueRef,omitempty"` // secret / run-time variable name
	URL          string  `json:"url,omitempty"`      // navigate
	Condition    string  `json:"condition,omitempty"`
	TimeoutMs    int     `json:"timeoutMs,omitempty"`
	CheckpointID string  `json:"checkpointId,omitempty"` // snapshot
	Name         string  `json:"name,omitempty"`         // snapshot display name
	ScrollX      int     `json:"scrollX,omitempty"`
	ScrollY      int     `json:"scrollY,omitempty"`
}

type Viewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Settings struct {
	DefaultTimeoutMs int      `json:"defaultTimeoutMs,omitempty"`
	Viewport         Viewport `json:"viewport"`
}

type Workflow struct {
	WorkflowID    string    `json:"workflowId"`
	Name          string    `json:"name"`
	SchemaVersion int       `json:"schemaVersion"`
	Version       int       `json:"version"`
	StartURL      string    `json:"startUrl"`
	Steps         []Step    `json:"steps"`
	Settings      Settings  `json:"settings"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
