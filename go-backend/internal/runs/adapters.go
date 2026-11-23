package runs

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/percy"
	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/runtime"
)

// RuntimeAdapter implements Runtime over the shared runtime directory.
type RuntimeAdapter struct {
	Dir       *runtime.Dir
	Installer *runtime.PlaywrightInstaller
}

func NewRuntimeAdapter(dir *runtime.Dir) *RuntimeAdapter {
	return &RuntimeAdapter{Dir: dir, Installer: runtime.NewPlaywrightInstaller(dir)}
}

func (r *RuntimeAdapter) EnsureReady(progress func(string)) error {
	return r.Installer.EnsureReady(progress)
}
func (r *RuntimeAdapter) RunnerEntry() string   { return r.Dir.RunnerEntry() }
func (r *RuntimeAdapter) PlaywrightDir() string { return r.Dir.Playwright() }

func (r *RuntimeAdapter) ArtifactDir(buildID string) (string, error) {
	if !ValidBuildID(buildID) {
		return "", ErrInvalidID
	}
	return r.Dir.Resolve("artifacts", buildID)
}

// RequestPath is inside the build's artifact dir but outside dom/metadata/logs,
// so it is never served and is deleted after the run.
func (r *RuntimeAdapter) RequestPath(buildID string) (string, error) {
	if !ValidBuildID(buildID) {
		return "", ErrInvalidID
	}
	p, err := r.Dir.Resolve("artifacts", buildID)
	if err != nil {
		return "", err
	}
	return filepath.Join(p, ".request.json"), nil
}

// PercyAdapter implements Percy over the existing controller and client.
type PercyAdapter struct {
	Controller *percy.Controller
	Client     *percy.Client
}

func (p *PercyAdapter) EnsureReady() error { return p.Controller.EnsureReady() }
func (p *PercyAdapter) Start(t string, opts percy.Options) error {
	return p.Controller.Start(t, opts)
}
func (p *PercyAdapter) Stop() error { return p.Controller.Stop() }
func (p *PercyAdapter) BuildInfo() (string, string, error) {
	h, err := p.Client.Health()
	if err != nil {
		return "", "", err
	}
	return h.Build.ID, h.Build.URL, nil
}
func (p *PercyAdapter) WaitIdle(timeout time.Duration) error {
	if err := p.Client.WaitIdle(timeout, p.Controller.Exited()); err != nil {
		return fmt.Errorf("%w", err)
	}
	return nil
}
