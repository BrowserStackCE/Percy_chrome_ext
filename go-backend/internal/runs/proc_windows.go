//go:build windows

package runs

import (
	"os/exec"
	"strconv"
)

// configureProcAttr is a no-op on Windows; the tree is killed via taskkill.
func configureProcAttr(cmd *exec.Cmd) {}

// killProcessTree kills the runner and all of its children.
func killProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	if err := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run(); err != nil {
		return cmd.Process.Kill()
	}
	return nil
}
