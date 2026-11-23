package runtime

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
)

// pinned so replay behaviour is stable; bump deliberately.
const playwrightVersion = "1.49.1"

type PlaywrightInstaller struct {
	dir *Dir
}

func NewPlaywrightInstaller(dir *Dir) *PlaywrightInstaller {
	return &PlaywrightInstaller{dir: dir}
}

func (i *PlaywrightInstaller) installed() bool {
	_, err := os.Stat(filepath.Join(i.dir.Playwright(), "node_modules", "playwright", "package.json"))
	return err == nil
}

func (i *PlaywrightInstaller) browserMarker() string {
	return filepath.Join(i.dir.Playwright(), ".chromium-installed")
}

// EnsureReady installs Playwright + chromium once into runtime/playwright and
// always refreshes the extracted runner sources. progress may be nil.
func (i *PlaywrightInstaller) EnsureReady(progress func(string)) error {
	say := func(s string) {
		log.Printf("[playwright] %s", s)
		if progress != nil {
			progress(s)
		}
	}

	if _, err := exec.LookPath("node"); err != nil {
		return fmt.Errorf("Node.js is required to run workflows. Install Node.js and try again")
	}
	if _, err := exec.LookPath("npm"); err != nil {
		return fmt.Errorf("npm is required to install Playwright. Install npm and try again")
	}

	if err := os.MkdirAll(i.dir.Playwright(), 0o755); err != nil {
		return fmt.Errorf("failed to create Playwright runtime directory: %w", err)
	}

	if !i.installed() {
		say("initializing npm project")
		if err := i.run("npm", "init", "-y"); err != nil {
			return err
		}
		say("installing playwright@" + playwrightVersion)
		if err := i.run("npm", "install", "--save-exact", "playwright@"+playwrightVersion); err != nil {
			return err
		}
	}

	if _, err := os.Stat(i.browserMarker()); err != nil {
		say("downloading chromium (first run only)")
		if err := i.run("npx", "playwright", "install", "chromium"); err != nil {
			return err
		}
		if err := os.WriteFile(i.browserMarker(), []byte(playwrightVersion), 0o644); err != nil {
			return err
		}
	}

	if err := i.dir.ExtractRunner(); err != nil {
		return fmt.Errorf("failed to extract workflow runner: %w", err)
	}
	// runner uses ESM
	pj := filepath.Join(i.dir.Playwright(), "package.json")
	if err := ensureModuleType(pj); err != nil {
		return err
	}
	say("playwright runtime ready")
	return nil
}

func (i *PlaywrightInstaller) run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = i.dir.Playwright()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v failed: %w\n%s", name, args, err, string(out))
	}
	return nil
}
