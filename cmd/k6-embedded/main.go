// Package embed registers the k6/x/embedded extension and exposes the
// embedded script filesystem to the k6 binary entrypoint.
//
// Build flow (orchestrated by build-binary.sh):
//
//  1. webpack compiles TypeScript → dist/{client}/**/*.js
//  2. build-binary.sh copies dist/{client}/ → cmd/k6-embedded/scripts/
//  3. build-binary.sh copies data/ → cmd/k6-embedded/data/
//  4. build-binary.sh generates cmd/k6-embedded/entrypoint/main.go
//  5. go build compiles the final self-contained binary
//
// Usage of the resulting binary:
//
//	k6-{client} run embedded://api/01-auth-bearer
//	k6-{client} list-scripts
package embed

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"go.k6.io/k6/js/modules"
)

// scripts holds all compiled JS bundles copied here by build-binary.sh.
//
//go:embed scripts
var scripts embed.FS

// dataFiles holds test data files (CSV, JSON, TXT, b64) needed by open() at runtime.
//
//go:embed data
var dataFiles embed.FS

func init() {
	modules.Register("k6/x/embedded", &embeddedModule{})
}

// embeddedModule is the xk6 extension that exposes embedded script metadata
// to k6 test scripts (e.g. for self-inspection or dynamic dispatch).
type embeddedModule struct{}

func (m *embeddedModule) NewModuleInstance(vu modules.VU) modules.Instance {
	return &embeddedInstance{}
}

type embeddedInstance struct{}

func (i *embeddedInstance) Exports() modules.Exports {
	return modules.Exports{
		Named: map[string]interface{}{
			// list() → string[] of all embedded script paths
			"list": func() []string { return ListScripts() },
			// has(path) → bool
			"has": func(path string) bool {
				_, err := resolveScript(path)
				return err == nil
			},
		},
	}
}

// ListScripts returns all embedded script paths (relative, e.g. "api/01-auth-bearer.js").
func ListScripts() []string {
	root, err := fs.Sub(scripts, "scripts")
	if err != nil {
		return nil
	}
	var paths []string
	_ = fs.WalkDir(root, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || path == "." || path == ".keep" {
			return err
		}
		paths = append(paths, path)
		return nil
	})
	return paths
}

// WriteScript extracts the embedded script at relPath to a temporary directory
// structure that preserves relative paths for k6 open() calls.
//
// Scripts use open("../../data/file") which means we need:
//
//	{tmpDir}/
//	  dummy/{type}/script.js    ← script here
//	  data/plates.txt           ← data files here
//
// So ../../data/ from dummy/{type}/ resolves to {tmpDir}/data/.
//
// relPath examples: "api/01-auth-bearer.js", "integration/12-websocket.js"
func WriteScript(relPath string) (string, error) {
	data, err := resolveScript(relPath)
	if err != nil {
		return "", err
	}

	// Create a deterministic temp directory for this run
	tmpBase := filepath.Join(os.TempDir(), "k6-embedded-run")
	if err := os.MkdirAll(tmpBase, 0o755); err != nil {
		return "", fmt.Errorf("embedded: cannot create temp dir: %w", err)
	}

	// Write the script preserving its subdirectory structure inside dummy/
	// so that ../../data/ resolves correctly from dummy/{type}/script.js
	scriptPath := filepath.Join(tmpBase, "dummy", filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(scriptPath), 0o755); err != nil {
		return "", fmt.Errorf("embedded: cannot create script dir: %w", err)
	}
	if err := os.WriteFile(scriptPath, data, 0o600); err != nil {
		return "", fmt.Errorf("embedded: cannot write script to tmpfile: %w", err)
	}

	// Extract data files so open() calls work
	if err := extractDataFiles(tmpBase); err != nil {
		return "", fmt.Errorf("embedded: cannot extract data files: %w", err)
	}

	return scriptPath, nil
}

// extractDataFiles writes all embedded data/ files to the target directory.
func extractDataFiles(targetDir string) error {
	dataDir := filepath.Join(targetDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	return fs.WalkDir(dataFiles, "data", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		// Skip sentinel files
		if d.Name() == ".keep" {
			return nil
		}
		content, err := dataFiles.ReadFile(path)
		if err != nil {
			return err
		}
		outPath := filepath.Join(targetDir, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			return err
		}
		return os.WriteFile(outPath, content, 0o600)
	})
}

// CleanupTempFiles removes the temporary directory used for script extraction.
func CleanupTempFiles() {
	tmpBase := filepath.Join(os.TempDir(), "k6-embedded-run")
	_ = os.RemoveAll(tmpBase)
}

// resolveScript reads an embedded script by its relative path.
func resolveScript(relPath string) ([]byte, error) {
	clean := filepath.ToSlash(filepath.Clean(relPath))

	// Prevent path traversal
	if strings.HasPrefix(clean, "..") || strings.Contains(clean, "/../") {
		return nil, errors.New("embedded: path traversal detected")
	}

	data, err := scripts.ReadFile("scripts/" + clean)
	if err != nil {
		return nil, fmt.Errorf("embedded: script %q not found (run 'k6-{client} list-scripts' to see available scripts)", relPath)
	}
	return data, nil
}
