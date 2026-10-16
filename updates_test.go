package main

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
)

func TestUpdateReleaseConfiguration(t *testing.T) {
	data, err := os.ReadFile("mygo.json")
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Version string `json:"version"`
		Updates struct {
			GitHub     string  `json:"github"`
			PublicKey  string  `json:"publicKey"`
			PrivateKey *string `json:"privateKey"`
		} `json:"updates"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if config.Updates.GitHub != "echoVic/liubai" {
		t.Errorf("updates.github = %q, want echoVic/liubai", config.Updates.GitHub)
	}
	if strings.TrimSpace(config.Updates.PublicKey) == "" {
		t.Error("updates.publicKey must not be empty")
	}
	if config.Updates.PrivateKey != nil {
		t.Error("updates.privateKey must not be configured: release builds get the key from MYGO_UPDATER_PRIVATE_KEY")
	}
	if config.Version == "" {
		t.Fatal("version must not be empty")
	}
	changelog, err := os.ReadFile("CHANGELOG.md")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(strings.Split(string(changelog), "\n"), "## "+config.Version) {
		t.Errorf("CHANGELOG.md is missing the section for version %s", config.Version)
	}
}
