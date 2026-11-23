package percy

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	startTimeout = 3 * time.Minute
	stopTimeout  = 30 * time.Second
)

// DefaultBranch is the Percy branch used when the user does not choose one.
const DefaultBranch = "percy-local-manager"

const maxBranchLen = 255

// Options are the per-build Percy settings a user can override.
type Options struct {
	// Branch is PERCY_BRANCH. Empty means DefaultBranch.
	Branch string `json:"branch,omitempty"`
	// TargetBranch is PERCY_TARGET_BRANCH. Empty means Percy's normal base-build selection.
	TargetBranch string `json:"targetBranch,omitempty"`
}

// Normalize trims whitespace around both values.
func (o Options) Normalize() Options {
	return Options{
		Branch:       strings.TrimSpace(o.Branch),
		TargetBranch: strings.TrimSpace(o.TargetBranch),
	}
}

func validBranchName(name string) error {
	if len(name) > maxBranchLen {
		return fmt.Errorf("must be at most %d characters", maxBranchLen)
	}
	for _, r := range name {
		if r <= ' ' || r == 0x7f {
			return errors.New("must not contain spaces or control characters")
		}
	}
	return nil
}

// Validate checks the (normalized) values. Empty values are valid.
func (o Options) Validate() error {
	n := o.Normalize()
	if err := validBranchName(n.Branch); err != nil {
		return fmt.Errorf("invalid branch: %w", err)
	}
	if err := validBranchName(n.TargetBranch); err != nil {
		return fmt.Errorf("invalid target branch: %w", err)
	}
	return nil
}

// Env returns the branch-related environment entries for the Percy process.
func (o Options) Env() []string {
	n := o.Normalize()
	branch := n.Branch
	if branch == "" {
		branch = DefaultBranch
	}
	env := []string{"PERCY_BRANCH=" + branch}
	if n.TargetBranch != "" {
		env = append(env, "PERCY_TARGET_BRANCH="+n.TargetBranch)
	}
	return env
}

type Controller struct {
	binary    *Binary
	installer *Installer

	mu    sync.Mutex
	cmd   *exec.Cmd
	token string
	// logSink, when set, receives every line of Percy CLI output.
	logSink func(line string)
	// exited is closed when the running percy process exits.
	exited chan struct{}
}

func NewController(binary *Binary, installer *Installer) *Controller {
	return &Controller{
		binary:    binary,
		installer: installer,
	}
}

// SetLogSink registers a callback that receives each Percy CLI output line.
func (c *Controller) SetLogSink(sink func(line string)) {
	c.mu.Lock()
	c.logSink = sink
	c.mu.Unlock()
}

func (c *Controller) emitLog(line string) {
	c.mu.Lock()
	sink := c.logSink
	c.mu.Unlock()
	if sink != nil {
		sink(line)
	}
}

func (c *Controller) Start(token string, opts Options) error {
	log.Println("[percy] Start() called")
	log.Printf("[percy] executable: %s", c.binary.Path)

	if !c.binary.Exists() {
		return errors.New("percy cli not installed")
	}

	// Path is derived from the server's own executable location (see NewBinary), never from user input.
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd := exec.Command(c.binary.Path, "exec:start")
	cmd.Env = append(os.Environ(), "PERCY_TOKEN="+token)
	cmd.Env = append(cmd.Env, opts.Env()...)
	log.Printf("[percy] branch settings: %v", opts.Env())

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start Percy CLI: %w", err)
	}
	log.Println("[percy] Percy process started")

	exited := make(chan struct{})

	c.mu.Lock()
	c.cmd = cmd
	c.token = token
	c.exited = exited
	c.mu.Unlock()

	ready := make(chan struct{})
	var readyOnce sync.Once

	// Continuously drain output so the CLI never blocks on a full pipe.
	var wg sync.WaitGroup
	readOutput := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("[percy-cli] %s", line)
			c.emitLog(line)
			if strings.Contains(line, "Percy has started") {
				readyOnce.Do(func() { close(ready) })
			}
		}
	}
	wg.Add(2)
	go readOutput(stdout)
	go readOutput(stderr)

	go func() {
		wg.Wait()
		err := cmd.Wait()
		log.Printf("[percy] process exited: %v", err)
		close(exited)
	}()

	select {
	case <-ready:
		log.Println("[percy] Percy is ready")
		return nil
	case <-exited:
		return errors.New("percy exited before it was ready")
	case <-time.After(startTimeout):
		c.kill()
		return errors.New("timed out waiting for Percy to start")
	}
}

// Stop asks Percy to finish uploading and exit (exec:stop), falling back to
// killing the process if it does not exit in time.
func (c *Controller) Stop() error {
	c.mu.Lock()
	cmd := c.cmd
	token := c.token
	exited := c.exited
	c.mu.Unlock()

	if cmd == nil {
		return nil
	}

	// Path is derived from the server's own executable location (see NewBinary), never from user input.
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	stop := exec.Command(c.binary.Path, "exec:stop")
	stop.Env = append(os.Environ(), "PERCY_TOKEN="+token)
	if out, err := stop.CombinedOutput(); err != nil {
		log.Printf("[percy] exec:stop failed: %v: %s", err, strings.TrimSpace(string(out)))
	}

	select {
	case <-exited:
	case <-time.After(stopTimeout):
		log.Println("[percy] did not exit after exec:stop, killing")
		c.kill()
		<-exited
	}

	c.mu.Lock()
	c.cmd = nil
	c.mu.Unlock()
	return nil
}

func (c *Controller) kill() {
	c.mu.Lock()
	cmd := c.cmd
	c.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

// Exited returns a channel closed when the Percy process has exited.
func (c *Controller) Exited() <-chan struct{} {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.exited
}

func (c *Controller) EnsureReady() error {
	return c.installer.EnsureReady()
}