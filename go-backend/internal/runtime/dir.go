// Package runtime resolves the server-local runtime folder shared by the Percy
// CLI, the Playwright runner, and workflow/build storage.
package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ensureModuleType sets "type": "module" in a package.json so the runner's
// ESM sources load. No-op when already set.
func ensureModuleType(pkgPath string) error {
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return err
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return err
	}
	if m["type"] == "module" {
		return nil
	}
	m["type"] = "module"
	out, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(pkgPath, out, 0o644)
}

// Dir describes the <server exe dir>/runtime folder.
type Dir struct {
	Root string
}

// NewDir resolves the runtime folder next to the server executable
// (same location percy.NewBinary uses).
func NewDir() *Dir {
	exePath, err := os.Executable()
	if err != nil {
		panic(fmt.Sprintf("failed to determine server location: %v", err))
	}
	return &Dir{Root: filepath.Join(filepath.Dir(exePath), "runtime")}
}

// NewDirAt builds a Dir rooted at root (used by tests).
func NewDirAt(root string) *Dir { return &Dir{Root: root} }

func (d *Dir) Percy() string      { return filepath.Join(d.Root, "percy") }
func (d *Dir) Playwright() string { return filepath.Join(d.Root, "playwright") }
func (d *Dir) Workflows() string  { return filepath.Join(d.Root, "workflows") }
func (d *Dir) Builds() string     { return filepath.Join(d.Root, "builds") }
func (d *Dir) Artifacts() string  { return filepath.Join(d.Root, "artifacts") }

// Resolve joins parts under the runtime root and guarantees the result stays
// inside it.
func (d *Dir) Resolve(parts ...string) (string, error) {
	root := filepath.Clean(d.Root)
	p := filepath.Clean(filepath.Join(append([]string{root}, parts...)...))
	if p != root && !strings.HasPrefix(p, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes runtime directory")
	}
	return p, nil
}
