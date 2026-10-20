package runs

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

var (
	ErrNotFound  = errors.New("build not found")
	ErrInvalidID = errors.New("invalid build id")

	buildIDRe = regexp.MustCompile(`^build_[0-9]{8}_[a-z0-9]{1,32}$`)
)

func ValidBuildID(id string) bool { return buildIDRe.MatchString(id) }

// NewBuildID returns a unique, filesystem-safe ID like build_20261014_a1b2c3d4.
func NewBuildID(now time.Time) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("build_%s_%s", now.UTC().Format("20060102"), hex.EncodeToString(b))
}

// Store keeps one JSON file per build. All mutation goes through Update so
// concurrent writers (runner event pump, cancel, crash handler) never lose
// each other's changes.
type Store struct {
	dir string
	mu  sync.Mutex
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

func (s *Store) path(id string) (string, error) {
	if !ValidBuildID(id) {
		return "", ErrInvalidID
	}
	return filepath.Join(s.dir, id+".json"), nil
}

func (s *Store) Create(b *Build) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.writeLocked(b)
}

func (s *Store) Get(id string) (*Build, error) {
	if !ValidBuildID(id) {
		return nil, ErrInvalidID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readLocked(id)
}

// Update applies fn to the stored build under the lock and persists atomically.
// Once a build is terminal, further updates are ignored so a late runner event
// cannot overwrite a cancelled/failed final state.
func (s *Store) Update(id string, fn func(b *Build)) (*Build, error) {
	if !ValidBuildID(id) {
		return nil, ErrInvalidID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := s.readLocked(id)
	if err != nil {
		return nil, err
	}
	if b.Status.Terminal() {
		return b, nil
	}
	fn(b)
	if err := s.writeLocked(b); err != nil {
		return nil, err
	}
	return b, nil
}

// Finalize sets a terminal status exactly once (no-op if already terminal).
func (s *Store) Finalize(id string, status Status, errMsg string) (*Build, error) {
	return s.Update(id, func(b *Build) {
		now := time.Now().UTC()
		b.Status = status
		b.CompletedAt = &now
		b.CurrentStepID = ""
		if errMsg != "" {
			b.Errors = append(b.Errors, RunError{Message: errMsg})
		}
		for i := range b.Steps {
			if b.Steps[i].Status == StepRunning || b.Steps[i].Status == StepPending {
				b.Steps[i].Status = StepSkipped
			}
		}
		for i := range b.Checkpoints {
			if b.Checkpoints[i].Status == CheckpointPending {
				b.Checkpoints[i].Status = CheckpointFailed
			}
		}
	})
}

func (s *Store) List() ([]Build, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, os.ErrNotExist) {
		// The builds folder can be removed while the server runs (cleanup or
		// reinstall). That means no builds yet, not a failure.
		return []Build{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []Build{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		if !ValidBuildID(id) {
			continue
		}
		b, err := s.readLocked(id)
		if err != nil {
			continue
		}
		out = append(out, *b)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

// FindByIdempotencyKey returns an existing build created with the same key
// for the same workflow, so client retries never create a second build.
func (s *Store) FindByIdempotencyKey(workflowID, key string) (*Build, error) {
	if key == "" {
		return nil, nil
	}
	list, err := s.List()
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].IdempotencyKey == key && list[i].WorkflowID == workflowID {
			return &list[i], nil
		}
	}
	return nil, nil
}

// InterruptedBuilds returns non-terminal builds (left behind by a crash).
func (s *Store) InterruptedBuilds() ([]string, error) {
	list, err := s.List()
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, b := range list {
		if !b.Status.Terminal() {
			ids = append(ids, b.BuildID)
		}
	}
	return ids, nil
}

func (s *Store) readLocked(id string) (*Build, error) {
	p, err := s.path(id)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var b Build
	if err := json.Unmarshal(data, &b); err != nil {
		return nil, fmt.Errorf("build %s is corrupt: %w", id, err)
	}
	return &b, nil
}

func (s *Store) writeLocked(b *Build) error {
	p, err := s.path(b.BuildID)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(b, "", "  ")
	if err != nil {
		return err
	}
	// Recreate the builds folder if it was removed while the server ran.
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	return workflow.WriteFileAtomic(p, data)
}
