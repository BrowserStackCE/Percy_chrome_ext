package runtime

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
)

// Only the runtime sources are embedded; fixtures and node:test files are not.
//
//go:embed runnerjs/index.js runnerjs/src/*.js
var runnerFS embed.FS

// ExtractRunner writes the embedded runner sources to <playwright>/runner/,
// overwriting previous copies so upgrades take effect.
func (d *Dir) ExtractRunner() error {
	return fs.WalkDir(runnerFS, "runnerjs", func(path string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel("runnerjs", path)
		dest := filepath.Join(d.Playwright(), "runner", rel)
		if e.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		data, err := runnerFS.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dest, data, 0o644)
	})
}

// RunnerEntry is the path of the extracted runner entry script.
func (d *Dir) RunnerEntry() string {
	return filepath.Join(d.Playwright(), "runner", "index.js")
}
