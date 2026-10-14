package runs

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
)

// event is one line of the runner's NDJSON stdout.
type event struct {
	Type         string `json:"type"`
	StepID       string `json:"stepId"`
	Status       string `json:"status"`
	Message      string `json:"message"`
	DurationMs   int64  `json:"durationMs"`
	CheckpointID string `json:"checkpointId"`
	DomPath      string `json:"domPath"`
	MetadataPath string `json:"metadataPath"`
}

// pump applies runner events to the build record. Unknown or malformed lines
// are logged (not trusted, not applied) so a noisy runner cannot corrupt state.
type pump struct {
	store    *Store
	buildID  string
	logf     func(string)
	artifact string

	mu       sync.Mutex
	failures int
}

func newPump(store *Store, buildID string, logf func(string)) *pump {
	return &pump{store: store, buildID: buildID, logf: logf}
}

func (p *pump) uploadFailures() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.failures
}

func (p *pump) flush() {}

// relArtifact converts a runner-reported absolute path into one relative to
// the build's artifact dir ("dom/dashboard.html"); anything that does not sit
// under dom/ or metadata/ is dropped.
func relArtifact(p string) string {
	p = filepath.ToSlash(p)
	for _, marker := range []string{"/dom/", "/metadata/"} {
		if i := strings.LastIndex(p, marker); i >= 0 {
			rel := p[i+1:]
			if !strings.Contains(rel, "..") {
				return rel
			}
		}
	}
	return ""
}

func (p *pump) onLine(line string) {
	var e event
	if err := json.Unmarshal([]byte(line), &e); err != nil || e.Type == "" {
		p.logf("[runner] " + line)
		return
	}
	// Never log full event payloads: they may echo user data.
	p.logf("[event] " + e.Type + " " + e.StepID + e.CheckpointID)

	_, _ = p.store.Update(p.buildID, func(b *Build) {
		switch e.Type {
		case "stepStarted":
			b.CurrentStepID = e.StepID
			if i := stepIndex(b, e.StepID); i >= 0 {
				b.Steps[i].Status = StepRunning
			}
		case "stepFinished":
			if i := stepIndex(b, e.StepID); i >= 0 {
				if e.Status == "passed" {
					b.Steps[i].Status = StepPassed
				} else {
					b.Steps[i].Status = StepFailed
					b.Steps[i].Error = e.Message
					b.Errors = append(b.Errors, RunError{StepID: e.StepID, Message: e.Message})
				}
				b.Steps[i].DurationMs = e.DurationMs
			}
		case "checkpointCaptured":
			if i := cpIndex(b, e.CheckpointID); i >= 0 {
				b.Checkpoints[i].Status = CheckpointCaptured
				b.Checkpoints[i].DomPath = relArtifact(e.DomPath)
				b.Checkpoints[i].MetadataPath = relArtifact(e.MetadataPath)
			}
		case "checkpointUploaded":
			if i := cpIndex(b, e.CheckpointID); i >= 0 {
				b.Checkpoints[i].Status = CheckpointUploaded
			}
		case "checkpointUploadFailed":
			p.mu.Lock()
			p.failures++
			p.mu.Unlock()
			if i := cpIndex(b, e.CheckpointID); i >= 0 {
				b.Checkpoints[i].Status = CheckpointUploadFailed
				b.Checkpoints[i].Error = e.Message
			}
		case "error":
			b.Errors = append(b.Errors, RunError{Message: e.Message})
		}
	})
}

func stepIndex(b *Build, id string) int {
	for i := range b.Steps {
		if b.Steps[i].StepID == id {
			return i
		}
	}
	return -1
}

func cpIndex(b *Build, id string) int {
	for i := range b.Checkpoints {
		if b.Checkpoints[i].CheckpointID == id {
			return i
		}
	}
	return -1
}
