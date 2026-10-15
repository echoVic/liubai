package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func appearanceValues(t *testing.T, w *Workspace) map[string]any {
	t.Helper()
	data, err := json.Marshal(w.State().Appearance)
	if err != nil {
		t.Fatal(err)
	}
	var values map[string]any
	if err := json.Unmarshal(data, &values); err != nil {
		t.Fatal(err)
	}
	return values
}

func appearanceRequest(t *testing.T, raw string) Appearance {
	t.Helper()
	var appearance Appearance
	if err := json.Unmarshal([]byte(raw), &appearance); err != nil {
		t.Fatal(err)
	}
	return appearance
}

func TestPreviewAppearanceDefaultsAndLegacyPosition(t *testing.T) {
	w := workspace(t)
	values := appearanceValues(t, w)
	if values["layout"] != "single" || values["source"] != false {
		t.Fatalf("unexpected initial preview preferences: %#v", values)
	}

	d := w.State().Current
	if _, err := w.Update(Edit{
		ID: d.ID, Revision: d.Revision, Content: d.Content,
		Position: Position{Source: true},
	}); err != nil {
		t.Fatal(err)
	}
	values = appearanceValues(t, w)
	if values["layout"] != "single" || values["source"] != false {
		t.Fatalf("legacy document source changed global preferences: %#v", values)
	}
}

func TestPreviewAppearanceNormalizesStoredValues(t *testing.T) {
	root := t.TempDir()
	w, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	indexPath := filepath.Join(root, "workspace.json")
	data, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	appearance := stored["appearance"].(map[string]any)
	delete(appearance, "layout")
	delete(appearance, "source")
	data, err = json.Marshal(stored)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(indexPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	w, err = openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	values := appearanceValues(t, w)
	if values["layout"] != "single" || values["source"] != false {
		t.Fatalf("missing fields were not normalized: %#v", values)
	}

	stored["appearance"].(map[string]any)["layout"] = "sideways"
	data, err = json.Marshal(stored)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(indexPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	w, err = openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := appearanceValues(t, w)["layout"]; got != "single" {
		t.Fatalf("unknown stored layout was not normalized: %v", got)
	}
}

func TestPreviewAppearancePersistsAndRejectsInvalidLayout(t *testing.T) {
	w := workspace(t)
	request := appearanceRequest(t, `{"theme":"paper","followSystem":true,"layout":"split","source":true}`)
	if err := w.Appearance(request); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	values := appearanceValues(t, reopened)
	if values["layout"] != "split" || values["source"] != true {
		t.Fatalf("preview preferences did not persist: %#v", values)
	}

	invalid := appearanceRequest(t, `{"theme":"paper","followSystem":true,"layout":"stacked","source":false}`)
	if err := reopened.Appearance(invalid); err == nil {
		t.Fatal("invalid non-empty layout was accepted")
	}
	values = appearanceValues(t, reopened)
	if values["layout"] != "split" || values["source"] != true {
		t.Fatalf("invalid request changed preferences: %#v", values)
	}

	empty := appearanceRequest(t, `{"theme":"paper","followSystem":true,"layout":"","source":true}`)
	if err := reopened.Appearance(empty); err != nil {
		t.Fatal(err)
	}
	if got := appearanceValues(t, reopened)["layout"]; got != "single" {
		t.Fatalf("empty requested layout was not normalized: %v", got)
	}
}
