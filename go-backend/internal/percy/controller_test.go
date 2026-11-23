package percy

import (
	"strings"
	"testing"
)

func hasEnv(env []string, key string) (string, bool) {
	prefix := key + "="
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return strings.TrimPrefix(e, prefix), true
		}
	}
	return "", false
}

func TestOptionsEnvDefaults(t *testing.T) {
	env := Options{}.Env()
	if v, ok := hasEnv(env, "PERCY_BRANCH"); !ok || v != DefaultBranch {
		t.Fatalf("PERCY_BRANCH = %q (set=%v), want %q", v, ok, DefaultBranch)
	}
	if _, ok := hasEnv(env, "PERCY_TARGET_BRANCH"); ok {
		t.Fatalf("PERCY_TARGET_BRANCH must not be set by default, got %v", env)
	}
}

func TestOptionsEnvOverrides(t *testing.T) {
	env := Options{Branch: "staging", TargetBranch: "production"}.Env()
	if v, _ := hasEnv(env, "PERCY_BRANCH"); v != "staging" {
		t.Fatalf("PERCY_BRANCH = %q, want staging", v)
	}
	if v, _ := hasEnv(env, "PERCY_TARGET_BRANCH"); v != "production" {
		t.Fatalf("PERCY_TARGET_BRANCH = %q, want production", v)
	}
}

func TestOptionsWhitespaceOnlyTreatedAsDefault(t *testing.T) {
	env := Options{Branch: "   ", TargetBranch: "\t "}.Env()
	if v, _ := hasEnv(env, "PERCY_BRANCH"); v != DefaultBranch {
		t.Fatalf("PERCY_BRANCH = %q, want default %q", v, DefaultBranch)
	}
	if _, ok := hasEnv(env, "PERCY_TARGET_BRANCH"); ok {
		t.Fatalf("whitespace target must be treated as unset, got %v", env)
	}
}

func TestOptionsTrimsSurroundingWhitespace(t *testing.T) {
	env := Options{Branch: "  staging ", TargetBranch: " production  "}.Env()
	if v, _ := hasEnv(env, "PERCY_BRANCH"); v != "staging" {
		t.Fatalf("PERCY_BRANCH = %q, want staging", v)
	}
	if v, _ := hasEnv(env, "PERCY_TARGET_BRANCH"); v != "production" {
		t.Fatalf("PERCY_TARGET_BRANCH = %q, want production", v)
	}
}

func TestOptionsValidate(t *testing.T) {
	long := strings.Repeat("a", maxBranchLen+1)
	cases := []struct {
		name    string
		opts    Options
		wantErr bool
	}{
		{"empty is valid", Options{}, false},
		{"simple names", Options{Branch: "staging", TargetBranch: "production"}, false},
		{"slashes and dots allowed", Options{Branch: "release/1.2.3"}, false},
		{"exactly max length", Options{Branch: strings.Repeat("a", maxBranchLen)}, false},
		{"inner space in branch", Options{Branch: "my branch"}, true},
		{"inner space in target", Options{TargetBranch: "my branch"}, true},
		{"newline in branch", Options{Branch: "a\nb"}, true},
		{"control char in target", Options{TargetBranch: "a\x00b"}, true},
		{"DEL char", Options{Branch: "a\x7fb"}, true},
		{"branch too long", Options{Branch: long}, true},
		{"target too long", Options{TargetBranch: long}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.opts.Validate()
			if (err != nil) != c.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, c.wantErr)
			}
		})
	}
}
