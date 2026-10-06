package percy

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"io"
)

type Controller struct {
	binary    *Binary
	installer *Installer
	cmd       *exec.Cmd
	logs      chan string
}

func NewController(binary *Binary, installer *Installer) *Controller {
	return &Controller{
		binary:    binary,
		installer: installer,
		logs:      make(chan string, 100),
	}
}

// errorPatterns are substrings in Percy CLI output that indicate a fatal
// startup failure. When any of these appear we surface the line as an error
// rather than waiting forever for "Percy has started".
var errorPatterns = []string{
	"already running",
	"port already in use",
	"Port already in use",
	"Error:",
	"Failure:",
}

func isErrorLine(line string) bool {
	for _, p := range errorPatterns {
		if strings.Contains(line, p) {
			return true
		}
	}
	return false
}

func (c *Controller) Start(token string) error {
	log.Println("[percy] Start() called")
	log.Printf("[percy] executable: %s", c.binary.Path)

	if !c.binary.Exists() {
		return errors.New("percy cli not installed")
	}

	log.Println("[percy] Percy CLI exists")
	log.Println("[percy] launching: percy exec:start")

	c.cmd = exec.Command(c.binary.Path, "exec:start")

	c.cmd.Env = append(
		os.Environ(),
		"PERCY_TOKEN="+token,
		"PERCY_BRANCH=percy-local-manager",
	)

	stdout, err := c.cmd.StdoutPipe()
	if err != nil {
		return err
	}

	stderr, err := c.cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := c.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start Percy CLI: %w", err)
	}

	log.Println("[percy] Percy process started")

	ready := make(chan error, 1)

	readOutput := func(r io.Reader) {
		scanner := bufio.NewScanner(r)

		for scanner.Scan() {
			line := scanner.Text()

			log.Printf("[percy-cli] %s", line)

			c.logs <- line

			if strings.Contains(line, "Percy has started") {
				log.Println("[percy] Percy is ready")
				select {
				case ready <- nil:
				default:
				}
				return
			}

			if isErrorLine(line) {
				log.Printf("[percy] detected error line: %s", line)
				select {
				case ready <- fmt.Errorf("Percy CLI error: %s", line):
				default:
				}
				return
			}
		}

		if err := scanner.Err(); err != nil {
			select {
			case ready <- err:
			default:
			}
			return
		}

		// Scanner finished (EOF) without seeing a ready or error line.
		// Wait for the process exit code and surface it.
		go func() {
			exitErr := c.cmd.Wait()
			if exitErr != nil {
				select {
				case ready <- fmt.Errorf("Percy CLI exited unexpectedly: %w", exitErr):
				default:
				}
			} else {
				select {
				case ready <- errors.New("Percy CLI exited before signalling ready"):
				default:
				}
			}
		}()
	}

	go readOutput(stdout)
	go readOutput(stderr)

	return <-ready
}
func (c *Controller) WaitFor(match string) error {

	for {

		line := <-c.logs

		if strings.Contains(line, match) {
			return nil
		}

	}

}

func (c *Controller) Stop() error {

	if !c.binary.Exists() {
		return errors.New("percy cli not installed")
	}

	cmd := exec.Command(c.binary.Path, "exec:stop")

	if err := cmd.Run(); err != nil {
		return err
	}

	c.cmd = nil

	return nil
}

func (c *Controller) EnsureReady() error {
	return c.installer.EnsureReady()
}