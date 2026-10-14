package runs

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/workflow"
)

var (
	ErrBusy         = errors.New("a workflow run is already in progress (a cancelled or finished run may still be shutting down Percy; retry in a few seconds)")
	ErrNoToken      = errors.New("a Percy token is required to create a build")
	ErrNotCancelled = errors.New("build is not running")
)

// Percy is the slice of the existing Percy controller/client a run needs.
type Percy interface {
	EnsureReady() error
	Start(token string) error
	Stop() error
	BuildInfo() (id, url string, err error)
	WaitIdle(timeout time.Duration) error
}

// Runtime prepares the Playwright runtime and describes where things live.
type Runtime interface {
	EnsureReady(progress func(string)) error
	RunnerEntry() string
	PlaywrightDir() string
	ArtifactDir(buildID string) (string, error)
	RequestPath(buildID string) (string, error)
}

// Process starts the runner. Swapped out in tests.
type Process interface {
	Wait() error
	Kill() error
}

type Launcher func(ctx context.Context, entry, requestPath, dir string, onLine func(string), onLog func(string)) (Process, error)

type Config struct {
	Workflows   *workflow.Store
	Builds      *Store
	Percy       Percy
	Runtime     Runtime
	Launch      Launcher
	PercyURL    string
	RunTimeout  time.Duration
	IdleTimeout time.Duration
	// Busy reports whether another Percy user (the snapshot-queue finalize) is active.
	Busy func() bool
}

type Service struct {
	cfg Config

	mu      sync.Mutex
	active  string // build id currently running
	cancels map[string]context.CancelFunc
	wg      sync.WaitGroup
}

func NewService(cfg Config) *Service {
	if cfg.Launch == nil {
		cfg.Launch = ExecLauncher
	}
	if cfg.RunTimeout == 0 {
		cfg.RunTimeout = 15 * time.Minute
	}
	if cfg.IdleTimeout == 0 {
		cfg.IdleTimeout = 5 * time.Minute
	}
	return &Service{cfg: cfg, cancels: map[string]context.CancelFunc{}}
}

// RecoverInterrupted finalizes builds a previous server process left running.
func (s *Service) RecoverInterrupted() {
	ids, err := s.cfg.Builds.InterruptedBuilds()
	if err != nil {
		log.Printf("[runs] recovery scan failed: %v", err)
		return
	}
	for _, id := range ids {
		if _, err := s.cfg.Builds.Finalize(id, StatusFailed, "interrupted: server restarted while the run was in progress"); err != nil {
			log.Printf("[runs] could not finalize %s: %v", id, err)
		}
	}
}

// Active reports whether a workflow run is in progress.
func (s *Service) Active() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.active != ""
}

// Wait blocks until all in-flight runs finish (used by tests and shutdown).
func (s *Service) Wait() { s.wg.Wait() }

// Start validates, persists a queued build, then runs it in the background.
// A repeated idempotency key returns the existing build instead of a new one.
func (s *Service) Start(workflowID, token, idemKey string, secrets map[string]string) (*Build, bool, error) {
	wf, err := s.cfg.Workflows.Get(workflowID)
	if err != nil {
		return nil, false, err
	}
	if existing, err := s.cfg.Builds.FindByIdempotencyKey(workflowID, idemKey); err != nil {
		return nil, false, err
	} else if existing != nil {
		return existing, true, nil
	}
	if token == "" {
		return nil, false, ErrNoToken
	}

	s.mu.Lock()
	if s.active != "" || (s.cfg.Busy != nil && s.cfg.Busy()) {
		s.mu.Unlock()
		return nil, false, ErrBusy
	}
	now := time.Now().UTC()
	b := &Build{
		BuildID:         NewBuildID(now),
		WorkflowID:      wf.WorkflowID,
		WorkflowVersion: wf.Version,
		WorkflowName:    wf.Name,
		Status:          StatusQueued,
		CreatedAt:       now,
		Steps:           []StepResult{},
		Checkpoints:     []Checkpoint{},
		Errors:          []RunError{},
		IdempotencyKey:  idemKey,
	}
	for _, st := range wf.Steps {
		b.Steps = append(b.Steps, StepResult{StepID: st.ID, Type: st.Type, Status: StepPending})
		if st.Type == "snapshot" {
			b.Checkpoints = append(b.Checkpoints, Checkpoint{CheckpointID: st.CheckpointID, Name: st.Name, Status: CheckpointPending})
		}
	}
	// Persist BEFORE starting execution, so a crash always leaves a record.
	if err := s.cfg.Builds.Create(b); err != nil {
		s.mu.Unlock()
		return nil, false, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.cfg.RunTimeout)
	s.active = b.BuildID
	s.cancels[b.BuildID] = cancel
	s.wg.Add(1)
	s.mu.Unlock()

	go func() {
		defer s.wg.Done()
		defer cancel()
		s.execute(ctx, b.BuildID, wf, token, secrets)
		s.mu.Lock()
		s.active = ""
		delete(s.cancels, b.BuildID)
		s.mu.Unlock()
	}()
	return b, false, nil
}

// Cancel stops a running build. The goroutine in execute finalizes it.
func (s *Service) Cancel(buildID string) error {
	// Check the persisted state first. A cancelled/finished build can still be
	// registered in s.cancels while its goroutine shuts Percy down; cancelling
	// it again must not report success.
	cur, err := s.cfg.Builds.Get(buildID)
	if err != nil {
		return err
	}
	if cur.Status.Terminal() {
		return ErrNotCancelled
	}
	s.mu.Lock()
	cancel, ok := s.cancels[buildID]
	s.mu.Unlock()
	if !ok {
		return ErrNotCancelled
	}
	// Mark cancelled first so the final status is cancelled, not failed.
	if _, err := s.cfg.Builds.Finalize(buildID, StatusCancelled, "cancelled by user"); err != nil {
		return err
	}
	cancel()
	return nil
}

func (s *Service) fail(buildID, msg string) {
	if _, err := s.cfg.Builds.Finalize(buildID, StatusFailed, msg); err != nil {
		log.Printf("[runs] finalize %s: %v", buildID, err)
	}
}

func (s *Service) execute(ctx context.Context, buildID string, wf *workflow.Workflow, token string, secrets map[string]string) {
	// Safety net: whatever happens (panic included) the build leaves "running".
	defer func() {
		if r := recover(); r != nil {
			s.fail(buildID, fmt.Sprintf("internal error: %v", r))
		}
		// no-op if already terminal
		s.fail(buildID, "run ended without a final status")
	}()

	logPath, artifactDir, err := s.prepareArtifacts(buildID)
	if err != nil {
		s.fail(buildID, "cannot prepare artifacts: "+err.Error())
		return
	}
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if logFile != nil {
		defer logFile.Close()
	}
	logf := func(line string) {
		if logFile != nil {
			fmt.Fprintln(logFile, line)
		}
	}

	if err := s.cfg.Runtime.EnsureReady(func(msg string) { logf("[setup] " + msg) }); err != nil {
		s.fail(buildID, err.Error())
		return
	}
	if err := s.cfg.Percy.EnsureReady(); err != nil {
		s.fail(buildID, err.Error())
		return
	}
	if err := s.cfg.Percy.Start(token); err != nil {
		s.fail(buildID, err.Error())
		return
	}
	defer func() { _ = s.cfg.Percy.Stop() }()

	if id, url, err := s.cfg.Percy.BuildInfo(); err == nil {
		_, _ = s.cfg.Builds.Update(buildID, func(b *Build) { b.PercyBuildID, b.PercyBuildURL = id, url })
	}

	// Request file: workflow + secrets live only here (0600), removed after the run.
	reqPath, err := s.cfg.Runtime.RequestPath(buildID)
	if err != nil {
		s.fail(buildID, err.Error())
		return
	}
	req := map[string]any{
		"buildId":     buildID,
		"workflow":    wf,
		"artifactDir": artifactDir,
		"percyUrl":    s.cfg.PercyURL,
		"secrets":     secrets,
	}
	data, _ := json.Marshal(req)
	if err := os.WriteFile(reqPath, data, 0o600); err != nil {
		s.fail(buildID, "cannot write runner request: "+err.Error())
		return
	}
	defer os.Remove(reqPath)

	_, _ = s.cfg.Builds.Update(buildID, func(b *Build) {
		now := time.Now().UTC()
		b.Status = StatusRunning
		b.StartedAt = &now
	})

	pump := newPump(s.cfg.Builds, buildID, logf)
	proc, err := s.cfg.Launch(ctx, s.cfg.Runtime.RunnerEntry(), reqPath, s.cfg.Runtime.PlaywrightDir(), pump.onLine, logf)
	if err != nil {
		s.fail(buildID, "cannot start runner: "+err.Error())
		return
	}
	waitErr := proc.Wait()
	pump.flush()

	switch {
	case ctx.Err() == context.DeadlineExceeded:
		_ = proc.Kill()
		s.fail(buildID, fmt.Sprintf("run timed out after %s", s.cfg.RunTimeout))
		return
	case ctx.Err() != nil: // cancelled; Cancel() already finalized
		return
	}

	// Let Percy finish processing uploaded snapshots before reporting.
	idleErr := s.cfg.Percy.WaitIdle(s.cfg.IdleTimeout)

	status, msg := classify(waitErr, pump, idleErr)
	if _, err := s.cfg.Builds.Finalize(buildID, status, msg); err != nil {
		log.Printf("[runs] finalize %s: %v", buildID, err)
	}
}

func classify(waitErr error, p *pump, idleErr error) (Status, string) {
	if waitErr == nil {
		if idleErr != nil {
			return StatusPartial, "snapshots captured but Percy did not finish processing: " + idleErr.Error()
		}
		if p.uploadFailures() > 0 {
			return StatusPartial, ""
		}
		return StatusPassed, ""
	}
	var ee *exec.ExitError
	if errors.As(waitErr, &ee) {
		switch ee.ExitCode() {
		case 2:
			return StatusPartial, ""
		case 3:
			return StatusFailed, "runner rejected the request as invalid"
		case 1:
			return StatusFailed, ""
		}
		return StatusFailed, fmt.Sprintf("runner crashed (exit %d)", ee.ExitCode())
	}
	return StatusFailed, "runner error: " + waitErr.Error()
}

func (s *Service) prepareArtifacts(buildID string) (logPath, artifactDir string, err error) {
	artifactDir, err = s.cfg.Runtime.ArtifactDir(buildID)
	if err != nil {
		return "", "", err
	}
	for _, d := range []string{"dom", "metadata", "logs"} {
		if err := os.MkdirAll(filepath.Join(artifactDir, d), 0o755); err != nil {
			return "", "", err
		}
	}
	return filepath.Join(artifactDir, "logs", "runner.log"), artifactDir, nil
}

// ---- real process launcher ----

type execProc struct {
	cmd *exec.Cmd
	wg  *sync.WaitGroup
}

func (p *execProc) Wait() error {
	p.wg.Wait() // drain stdout/stderr first
	return p.cmd.Wait()
}

func (p *execProc) Kill() error {
	if p.cmd.Process == nil {
		return nil
	}
	// kill the whole group so chromium children die with the runner
	if err := syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL); err != nil {
		return p.cmd.Process.Kill()
	}
	return nil
}

// ExecLauncher runs `node <entry> --request <file>` (no shell, fixed argv).
func ExecLauncher(ctx context.Context, entry, requestPath, dir string, onLine func(string), onLog func(string)) (Process, error) {
	cmd := exec.CommandContext(ctx, "node", entry, "--request", requestPath)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
			return cmd.Process.Kill()
		}
		return nil
	}
	cmd.WaitDelay = 5 * time.Second

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	wg := &sync.WaitGroup{}
	scan := func(r io.Reader, fn func(string)) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for sc.Scan() {
			fn(sc.Text())
		}
	}
	wg.Add(2)
	go scan(stdout, onLine)
	go scan(stderr, func(l string) { onLog("[stderr] " + l) })
	return &execProc{cmd: cmd, wg: wg}, nil
}
