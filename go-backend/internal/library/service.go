package library

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Service struct {
	mu          sync.Mutex
	client      *Client
	cache       *Cache
	persistPath string // where the read token is saved between runs
}

func NewService() *Service {
	return &Service{
		cache:       NewCache(),
		persistPath: defaultTokenPath(),
	}
}

// defaultTokenPath puts the token in the OS user-config dir, e.g.
// ~/.config/percy-local-manager/library-token on Linux. This is a local-only
// backend, but the token is still stored in plaintext — worth revisiting if
// that ever matters for your threat model.
func defaultTokenPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "" // persistence disabled if we can't resolve a config dir
	}
	return filepath.Join(dir, "percy-local-manager", "library-token")
}

// LoadPersistedToken re-hydrates the service from a previously saved token,
// if one exists. Call this once at startup. A missing file is not an error —
// it just means no library has been connected yet.
func (s *Service) LoadPersistedToken() {
	if s.persistPath == "" {
		return
	}
	data, err := os.ReadFile(s.persistPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[library] failed to read persisted token: %v", err)
		}
		return
	}
	token := strings.TrimSpace(string(data))
	if token == "" {
		return
	}
	if err := s.SetToken(token); err != nil {
		log.Printf("[library] persisted token failed to load: %v", err)
	}
}

func (s *Service) SetToken(token string) error {
	client := NewClient(token)

	s.mu.Lock()
	s.client = client
	s.mu.Unlock()

	library, err := client.LoadLibrary()
	if err != nil {
		log.Printf("[library] SetToken failed: %v", err)
		return err
	}

	s.cache.Set(library)
	s.persistToken(token)
	log.Printf("[library] cache updated: %d snapshots ready to search", len(library))
	return nil
}

// persistToken saves best-effort; a failure to persist shouldn't fail the
// SetToken call itself, since the in-memory cache is already good.
func (s *Service) persistToken(token string) {
	if s.persistPath == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.persistPath), 0o700); err != nil {
		log.Printf("[library] failed to create config dir: %v", err)
		return
	}
	if err := os.WriteFile(s.persistPath, []byte(token), 0o600); err != nil {
		log.Printf("[library] failed to persist token: %v", err)
	}
}

func (s *Service) Search(query string) []SnapshotReference {
	needle := strings.ToLower(query)
	all := s.cache.All()
	results := make([]SnapshotReference, 0, len(all))
	for _, ref := range all {
		if strings.Contains(strings.ToLower(ref.Name), needle) {
			results = append(results, ref)
		}
	}
	return results
}

// All returns the full cached library, unfiltered — used by the library
// page to render everything and filter client-side.
func (s *Service) All() []SnapshotReference {
	return s.cache.All()
}

// Status reports whether a library is loaded and how big it is, so the
// popup can render "connected" state without re-submitting a token.
type Status struct {
	Connected bool `json:"connected"`
	Count     int  `json:"count"`
}

// GetToken returns the currently stored token, or an empty string if none is set.
func (s *Service) GetToken() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client == nil {
		return ""
	}
	return s.client.token
}

func (s *Service) Status() Status {
	all := s.cache.All()
	s.mu.Lock()
	connected := s.client != nil
	s.mu.Unlock()
	return Status{Connected: connected, Count: len(all)}
}