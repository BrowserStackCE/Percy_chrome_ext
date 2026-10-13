package workflow

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var (
	idRe         = regexp.MustCompile(`^[a-z0-9][a-z0-9_]{0,63}$`)
	checkpointRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	stepTypes    = map[string]bool{
		"click": true, "fill": true, "select": true, "check": true, "uncheck": true,
		"navigate": true, "waitFor": true, "scroll": true, "snapshot": true,
	}
	needsTarget = map[string]bool{
		"click": true, "fill": true, "select": true, "check": true, "uncheck": true, "waitFor": true,
	}
	conditions = map[string]bool{"": true, "visible": true, "hidden": true, "attached": true, "detached": true}
)

const (
	maxSteps       = 500
	maxTimeoutMs   = 300000
	maxLiteralSize = 2000
)

// ValidationError marks an error caused by invalid user input (HTTP 400).
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

// ValidID reports whether id is a filesystem-safe workflow/build identifier.
func ValidID(id string) bool { return idRe.MatchString(id) }

func validURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return fmt.Errorf("invalid url %q", raw)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("url scheme must be http or https")
	}
	return nil
}

func hasLocator(t *Target) bool {
	return t != nil && (t.TestID != "" || t.Role != "" || t.CSS != "" || t.Text != "")
}

// Validate checks the workflow definition. It never accepts executable
// content: only the enumerated step types with structured fields.
func (w *Workflow) Validate() error {
	if err := w.validate(); err != nil {
		return &ValidationError{Msg: err.Error()}
	}
	return nil
}

func (w *Workflow) validate() error {
	if strings.TrimSpace(w.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if len(w.Name) > 200 {
		return fmt.Errorf("name too long")
	}
	if w.SchemaVersion != SchemaVersion {
		return fmt.Errorf("unsupported schemaVersion %d", w.SchemaVersion)
	}
	if err := validURL(w.StartURL); err != nil {
		return fmt.Errorf("startUrl: %w", err)
	}
	if len(w.Steps) == 0 || len(w.Steps) > maxSteps {
		return fmt.Errorf("steps must contain 1..%d entries", maxSteps)
	}
	if v := w.Settings.Viewport; v.Width < 200 || v.Width > 4000 || v.Height < 200 || v.Height > 4000 {
		return fmt.Errorf("settings.viewport must be 200..4000 in each dimension")
	}
	if w.Settings.DefaultTimeoutMs < 0 || w.Settings.DefaultTimeoutMs > maxTimeoutMs {
		return fmt.Errorf("settings.defaultTimeoutMs out of range")
	}

	stepIDs := map[string]bool{}
	checkpoints := map[string]bool{}
	for i, s := range w.Steps {
		at := fmt.Sprintf("steps[%d]", i)
		if s.ID == "" || !idRe.MatchString(s.ID) {
			return fmt.Errorf("%s: invalid id", at)
		}
		if stepIDs[s.ID] {
			return fmt.Errorf("%s: duplicate id %q", at, s.ID)
		}
		stepIDs[s.ID] = true
		if !stepTypes[s.Type] {
			return fmt.Errorf("%s: unknown step type %q", at, s.Type)
		}
		if s.TimeoutMs < 0 || s.TimeoutMs > maxTimeoutMs {
			return fmt.Errorf("%s: timeoutMs out of range", at)
		}
		if needsTarget[s.Type] && !hasLocator(s.Target) {
			return fmt.Errorf("%s: %s requires a target locator", at, s.Type)
		}
		if len(s.Value) > maxLiteralSize {
			return fmt.Errorf("%s: value too long", at)
		}
		if s.ValueRef != "" && !regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`).MatchString(s.ValueRef) {
			return fmt.Errorf("%s: invalid valueRef", at)
		}
		switch s.Type {
		case "fill":
			if s.Value == "" && s.ValueRef == "" {
				return fmt.Errorf("%s: fill requires value or valueRef", at)
			}
			if s.Value != "" && s.ValueRef != "" {
				return fmt.Errorf("%s: provide either value or valueRef, not both", at)
			}
			// Sensitive fields must never carry a literal.
			if s.Value != "" && s.Target != nil && looksSensitive(s.Target) {
				return fmt.Errorf("%s: sensitive field must use valueRef, not a literal value", at)
			}
		case "select":
			if s.Value == "" && s.ValueRef == "" {
				return fmt.Errorf("%s: select requires value or valueRef", at)
			}
		case "navigate":
			if err := validURL(s.URL); err != nil {
				return fmt.Errorf("%s: %w", at, err)
			}
		case "waitFor":
			if !conditions[s.Condition] {
				return fmt.Errorf("%s: unknown condition %q", at, s.Condition)
			}
		case "snapshot":
			if !checkpointRe.MatchString(s.CheckpointID) {
				return fmt.Errorf("%s: invalid checkpointId", at)
			}
			if checkpoints[s.CheckpointID] {
				return fmt.Errorf("%s: duplicate checkpointId %q", at, s.CheckpointID)
			}
			checkpoints[s.CheckpointID] = true
			if strings.TrimSpace(s.Name) == "" {
				return fmt.Errorf("%s: snapshot requires a name", at)
			}
		}
	}
	return nil
}

func looksSensitive(t *Target) bool {
	hay := strings.ToLower(t.Name + " " + t.TestID + " " + t.CSS + " " + t.Text)
	for _, k := range []string{"password", "passwd", "secret", "token", "otp", "cvv", "card"} {
		if strings.Contains(hay, k) {
			return true
		}
	}
	return false
}
