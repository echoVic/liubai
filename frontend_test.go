package main

import (
	"encoding/json"
	"io/fs"
	"os"
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
