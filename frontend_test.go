package main

import (
	"encoding/json"
	"io/fs"
	"os"
	"path"
	"regexp"
	"slices"
	"testing"
)

// The frontend ships once in the app's resources; embedding it again (frontendDist)
// would put a copy in each architecture of the universal executable.
func TestFrontendShipsAsResource(t *testing.T) {
	var config struct {
		FrontendDist string   `json:"frontendDist"`
		Resources    []string `json:"resources"`
	}
	data, err := os.ReadFile("mygo.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if config.FrontendDist != "" || !slices.Contains(config.Resources, "web") {
		t.Fatalf("mygo.json: frontendDist %q, resources %v", config.FrontendDist, config.Resources)
	}
	web := frontendFiles()
	for _, name := range []string{"index.html", "app.js", "style.css"} {
		if _, err := fs.Stat(web, name); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	if chunks, _ := fs.Glob(web, "mermaid-runtime-*.js"); len(chunks) != 1 {
		t.Errorf("mermaid chunks %v", chunks)
	}
}

// What the editor loads before it can show a document: app.js and the chunks it imports
// statically. Language grammars and other rarely used code load on demand.
func TestStartupBundleStaysSmall(t *testing.T) {
	web := frontendFiles()
	static := regexp.MustCompile(`(?:^|[;}])\s*import\s*(?:[^"';()]*?from\s*)?"(\./[^"]+)"`)
	seen, total := map[string]bool{}, 0
	var visit func(name string)
	visit = func(name string) {
		if seen[name] {
			return
		}
		seen[name] = true
		data, err := fs.ReadFile(web, name)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		total += len(data)
		for _, m := range static.FindAllStringSubmatch(string(data), -1) {
			visit(path.Join(path.Dir(name), m[1]))
		}
	}
	visit("app.js")
	if total > 1536<<10 {
		t.Errorf("start-up code is %d KB in %d files, over the 1536 KB budget", total>>10, len(seen))
	}
	lazy, _ := fs.Glob(web, "chunks/*.js")
	if len(lazy) <= len(seen) {
		t.Errorf("%d chunks, %d of them loaded at start-up: nothing loads on demand", len(lazy), len(seen)-1)
	}
}
