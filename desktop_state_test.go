package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestDesktopQueuesFileRecentsOnlyForCurrentDocumentActions(t *testing.T) {
	w := workspace(t)
	path, doc := openFile(t, w, "a.md", "first\n")
	linked := filepath.Join(filepath.Dir(path), "b.md")
	if err := os.WriteFile(linked, []byte("linked\n"), 0600); err != nil {
		t.Fatal(err)
	}
	d := &Desktop{w: w, native: newDesktopIntegration(w)}
	defer d.native.cancel()
	if _, err := d.Activate(doc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.OpenLinked(doc.ID, "b.md"); err != nil {
		t.Fatal(err)
	}
	current := d.State().Current
	if _, err := d.Status(current.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Reload(current.ID); err != nil {
		t.Fatal(err)
	}
	draft, err := d.New()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Activate(draft.Current.ID); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(d.native.recent, []string{doc.Path, filepath.Join(filepath.Dir(doc.Path), "b.md")}) {
		t.Fatalf("system recents = %v, want only the two opened files", d.native.recent)
	}
}

func TestDesktopWorkspaceActionsAreSafeWithoutNativeApp(t *testing.T) {
	d := &Desktop{w: workspace(t)} // The -web server uses this same initialization.
	path, _ := openFile(t, d.w, "a.md", "before\n")
	d.State()
	d.openPath(path)
	current := d.State().Current
	if _, err := d.Activate(current.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Update(Edit{ID: current.ID, Revision: current.Revision, Content: "saved\n"}); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Status(current.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Reload(current.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Delete(current.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.New(); err != nil {
		t.Fatal(err)
	}
	d.SetPending(true)
	d.SetPending(false)
	d.Close()
}

func TestEditedIndicatorDelaysPendingAndClearsImmediately(t *testing.T) {
	now := time.Unix(100, 0)
	var s editedIndicator
	s.setPending(now, true)
	for _, step := range []struct {
		elapsed time.Duration
		edited  bool
		delay   time.Duration
	}{
		{0, false, 1500 * time.Millisecond},
		{500 * time.Millisecond, false, time.Second},
		{1499 * time.Millisecond, false, time.Millisecond},
		{1500 * time.Millisecond, true, 0},
		{2 * time.Second, true, 0},
	} {
		// Repeated true reports must not postpone the dot.
		s.setPending(now.Add(step.elapsed), true)
		edited, delay := s.decision(now.Add(step.elapsed), false, false)
		if edited != step.edited || delay != step.delay {
			t.Fatalf("at %v: (%v, %v), want (%v, %v)", step.elapsed, edited, delay, step.edited, step.delay)
		}
	}
	s.setPending(now.Add(2*time.Second), false)
	if edited, delay := s.decision(now.Add(2*time.Second), false, false); edited || delay != 0 {
		t.Fatalf("clean: %v %v", edited, delay)
	}
	// A normal autosave and a later edit start independent grace periods.
	s.setPending(now.Add(3*time.Second), true)
	s.setPending(now.Add(3500*time.Millisecond), false)
	s.setPending(now.Add(4*time.Second), true)
	if edited, delay := s.decision(now.Add(4500*time.Millisecond), false, false); edited || delay != time.Second {
		t.Fatalf("new edit: %v %v", edited, delay)
	}
}

func TestEditedIndicatorShowsConflictOrSaveFailureImmediately(t *testing.T) {
	now := time.Unix(100, 0)
	for _, pending := range []bool{false, true} {
		var s editedIndicator
		s.setPending(now, pending)
		for _, flags := range [][2]bool{{true, false}, {false, true}, {true, true}} {
			if edited, _ := s.decision(now, flags[0], flags[1]); !edited {
				t.Fatalf("pending=%v conflict=%v failed=%v did not mark edited", pending, flags[0], flags[1])
			}
		}
		if edited, _ := s.decision(now, false, false); edited {
			t.Fatal("resolved conflict/failure left the dot on during the grace period")
		}
	}
}

func TestNativeSaveFailureUsesStatusCodeAcrossLanguages(t *testing.T) {
	for _, code := range []string{"saveFailed", "fileSaveFailed", "imageSaveFailed", "reloadRecoveryFailed", "recoveryUpdateFailed"} {
		for _, prose := range []string{"File saved", "草稿已保存", "", "another language"} {
			doc := Document{StatusCode: code, Status: prose}
			if edited, _ := (editedIndicator{}).decision(time.Now(), false, doc.saveFailed()); !edited {
				t.Fatalf("code %s with prose %q cleared edited marker", code, prose)
			}
		}
	}
	if (Document{StatusCode: "fileSaved", Status: "保存失败"}).saveFailed() {
		t.Fatal("native state interpreted localized prose")
	}
}
