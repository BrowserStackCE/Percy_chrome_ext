package runtime

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// Heavy: downloads playwright + chromium. Run with PW_INSTALL_TEST=<dir>.
// The directory is kept so the runner PoC test can be executed against it.
func TestEnsureReadyInstallsPlaywright(t *testing.T) {
	root := os.Getenv("PW_INSTALL_TEST")
	if root == "" {
		t.Skip("set PW_INSTALL_TEST=<dir> to run the real installer")
	}
	d := NewDirAt(root)
	if err := NewPlaywrightInstaller(d).EnsureReady(func(s string) { t.Log(s) }); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(d.RunnerEntry()); err != nil {
		t.Fatal(err)
	}
	// copy PoC test + fixture next to the extracted runner and execute it
	src := filepath.Join("runnerjs", "test")
	dst := filepath.Join(d.Playwright(), "runner", "test")
	if out, err := exec.Command("cp", "-R", src, dst).CombinedOutput(); err != nil {
		t.Fatalf("copy tests: %v %s", err, out)
	}
	cmd := exec.Command("node", "--test", filepath.Join(dst, "poc.test.js"))
	cmd.Dir = d.Playwright()
	out, err := cmd.CombinedOutput()
	t.Log(string(out))
	if err != nil {
		t.Fatalf("runner PoC failed: %v", err)
	}
}
