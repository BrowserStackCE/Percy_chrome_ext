package workflow

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound  = errors.New("workflow not found")
	ErrInvalidID = errors.New("invalid workflow id")
)

// Store persists one JSON file per workflow in a single directory.
type Store struct {
	dir string
	mu  sync.Mutex // serialises writes; workflows are small and writes rare
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

// NewID returns a unique, filesystem-safe workflow ID.
func NewID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("wf_%d_%s", time.Now().Unix(), hex.EncodeToString(b))
}

func (s *Store) path(id string) (string, error) {
	if !ValidID(id) {
		return "", ErrInvalidID
	}
	p := filepath.Join(s.dir, id+".json")
	// belt and braces: stay inside dir
	if filepath.Dir(p) != filepath.Clean(s.dir) {
		return "", ErrInvalidID
	}
	return p, nil
}

// WriteFileAtomic writes data to path via a temp file + rename.
func WriteFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	cleanup := func() { _ = os.Remove(name) }
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(name, path); err != nil {
		cleanup()
		return err
	}
	return nil
}

// Create validates and stores a new workflow, assigning its ID and version 1.
func (s *Store) Create(w *Workflow) error {
	w.WorkflowID = NewID()
	w.Version = 1
	w.SchemaVersion = orDefault(w.SchemaVersion)
	if err := w.Validate(); err != nil {
		return err
	}
	now := time.Now().UTC()
	w.CreatedAt, w.UpdatedAt = now, now
	return s.write(w)
}

// Update overwrites an existing workflow in place (same version), keeping
// its ID and creation time.
func (s *Store) Update(id string, w *Workflow) error {
	if !ValidID(id) {
		return ErrInvalidID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	old, err := s.read(id)
	if err != nil {
		return err
	}
	w.WorkflowID = id
	w.Version = old.Version
	w.CreatedAt = old.CreatedAt
	w.SchemaVersion = orDefault(w.SchemaVersion)
	if err := w.Validate(); err != nil {
		return err
	}
	w.UpdatedAt = time.Now().UTC()
	return s.writeLocked(w)
}

func orDefault(v int) int {
	if v == 0 {
		return SchemaVersion
	}
	return v
}

func (s *Store) Get(id string) (*Workflow, error) {
	if !ValidID(id) {
		return nil, ErrInvalidID
	}
	return s.read(id)
}

func (s *Store) List() ([]Workflow, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	out := []Workflow{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		if !ValidID(id) {
			continue
		}
		w, err := s.read(id)
		if err != nil {
			continue // skip unreadable/corrupt files rather than failing the list
		}
		out = append(out, *w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (s *Store) read(id string) (*Workflow, error) {
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
	var w Workflow
	if err := json.Unmarshal(data, &w); err != nil {
		return nil, fmt.Errorf("workflow %s is corrupt: %w", id, err)
	}
	return &w, nil
}

func (s *Store) write(w *Workflow) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.writeLocked(w)
}

func (s *Store) writeLocked(w *Workflow) error {
	p, err := s.path(w.WorkflowID)
	if err != nil {
		return err
	}
	// The runtime folder can be removed while the server is running (cleanup,
	// reinstall). Recreate it instead of failing every save until a restart.
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return fmt.Errorf("cannot create workflows folder %s: %w", s.dir, err)
	}
	data, err := json.MarshalIndent(w, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(p, data)
}
