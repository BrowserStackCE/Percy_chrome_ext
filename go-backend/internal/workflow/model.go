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
	// Within narrows a repeated element (an "Add to cart" button on a product
	// grid) to the item that contains this exact text, e.g. the product title.
	Within    string   `json:"within,omitempty"`
	Fallbacks []Target `json:"fallbacks,omitempty"`
}

// SnapshotOptions are the per-snapshot Percy options (snapshot steps only).
type SnapshotOptions struct {
	Widths           []int  `json:"widths,omitempty"`
	MinHeight        int    `json:"minHeight,omitempty"`
	Scope            string `json:"scope,omitempty"`
	EnableJavaScript bool   `json:"enableJavaScript,omitempty"`
	PercyCSS         string `json:"percyCSS,omitempty"`
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

	// Optional interaction steps are skipped (with a warning) when their
	// target never appears, instead of failing the run.
	Optional bool `json:"optional,omitempty"`

	// Snapshot-only: intentional wait before capture and Percy options.
	WaitMs  int              `json:"waitMs,omitempty"`
	Options *SnapshotOptions `json:"options,omitempty"`
}

type Viewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Settings struct {
	DefaultTimeoutMs int      `json:"defaultTimeoutMs,omitempty"`
	AutoConsent      bool     `json:"autoConsent,omitempty"`
	Stabilize        bool     `json:"stabilize,omitempty"`
	// PageKind is what the recorder detected about the start page ("spa",
	// "cms", "static"); informational, replay re-detects the live page.
	PageKind string `json:"pageKind,omitempty"`
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
