//go:build !windows

package runs

import (
	"os/exec"
	"syscall"
)

// configureProcAttr puts the runner in its own process group so the whole
// group (runner + chromium children) can be killed together.
func configureProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessTree kills the runner's whole process group.
func killProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
		return cmd.Process.Kill()
	}
	return nil
}
