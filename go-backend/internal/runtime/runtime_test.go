package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveStaysInsideRoot(t *testing.T) {
	d := NewDirAt(t.TempDir())
	if _, err := d.Resolve("workflows", "wf_1.json"); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
	for _, bad := range []string{"../x", "workflows/../../x", "/etc/passwd"} {
		p, err := d.Resolve(bad)
		if err == nil && !isInside(d.Root, p) {
			t.Fatalf("%q escaped root: %s", bad, p)
		}
	}
	if _, err := d.Resolve("..", "other"); err == nil {
		t.Fatal("expected traversal to be rejected")
	}
}

func isInside(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	return err == nil && rel != ".." && !filepath.IsAbs(rel) && len(rel) > 0 && rel[0] != '.'
}

func TestExtractRunnerWritesEntry(t *testing.T) {
	d := NewDirAt(t.TempDir())
	if err := d.ExtractRunner(); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"index.js", "src/run.js", "src/capture.js", "src/percy.js", "src/events.js"} {
		if _, err := os.Stat(filepath.Join(d.Playwright(), "runner", f)); err != nil {
			t.Fatalf("missing %s: %v", f, err)
		}
	}
}

func TestEnsureModuleType(t *testing.T) {
	p := filepath.Join(t.TempDir(), "package.json")
	if err := os.WriteFile(p, []byte(`{"name":"x"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ensureModuleType(p); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) == `{"name":"x"}` {
		t.Fatal("package.json not updated")
	}
}
