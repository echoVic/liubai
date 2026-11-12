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

func docAtPath(t *testing.T, w *Workspace, path string) *Document {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range w.docs {
		if d.Path == resolved {
			return d
		}
	}
	t.Fatalf("no document for %s", path)
	return nil
}

// A file from Finder or a drop arrives while the page may still hold the
// draft's first keystrokes; the draft must stay until the page has saved it.
func TestOpenedFileKeepsTheDraftBeingTyped(t *testing.T) {
	d := &Desktop{w: workspace(t)}
	draft := d.State().Current
	p := filepath.Join(t.TempDir(), "other.md")
	if err := os.WriteFile(p, []byte("other\n"), 0644); err != nil {
		t.Fatal(err)
	}
	d.openPath(p)
	if _, err := d.Update(Edit{ID: draft.ID, Revision: draft.Revision, Content: "typed before the file arrived\n"}); err != nil {
		t.Fatalf("the draft on screen cannot be saved: %v", err)
	}
	if _, err := d.w.SaveRecovery(draft.ID, "typed before the file arrived\n", filepath.Join(t.TempDir(), "rescue.md")); err != nil {
		t.Fatalf("the draft on screen cannot be rescued: %v", err)
	}
	// The page activates the opened file once its draft is saved.
	s, err := d.Activate(docAtPath(t, d.w, p).ID)
	if err != nil || s.Current.Content != "other\n" {
		t.Fatalf("opened file not shown: %+v %v", s.Current, err)
	}
	if kept := d.w.docs[draft.ID]; kept == nil || kept.Content != "typed before the file arrived\n" {
		t.Fatalf("draft lost: %+v", kept)
	}
	if m, _ := filepath.Glob(filepath.Join(d.w.root, "trash", "*-"+draft.ID)); len(m) != 0 {
		t.Fatal("draft moved to the trash")
	}
}

func TestOpenedFileCleansAnEmptyDraftOnceThePageSwitches(t *testing.T) {
	d := &Desktop{w: workspace(t)}
	draft := d.State().Current
	p := filepath.Join(t.TempDir(), "other.md")
	if err := os.WriteFile(p, []byte("other\n"), 0644); err != nil {
		t.Fatal(err)
	}
	d.openPath(p)
	if d.w.docs[draft.ID] == nil {
		t.Fatal("draft removed before the page saved it")
	}
	s, err := d.Activate(docAtPath(t, d.w, p).ID)
	if err != nil {
		t.Fatal(err)
	}
	if d.w.docs[draft.ID] != nil || len(s.Recent) != 1 {
		t.Fatalf("empty draft kept: %+v", s.Recent)
	}
}

// Before the page has asked for a document it holds no input, so a file the
// app was launched with replaces the empty draft at once.
func TestFileOpenedAtLaunchReplacesTheEmptyDraft(t *testing.T) {
	d := &Desktop{w: workspace(t)}
	p := filepath.Join(t.TempDir(), "other.md")
	if err := os.WriteFile(p, []byte("other\n"), 0644); err != nil {
		t.Fatal(err)
	}
	d.openPath(p)
	if s := d.State(); s.Current.Content != "other\n" || len(s.Recent) != 1 {
		t.Fatalf("launch file not shown alone: %+v %+v", s.Current, s.Recent)
	}
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
	for _, code := range []string{"saveFailed", "fileSaveFailed", "fileReadOnly", "imageSaveFailed", "reloadRecoveryFailed", "recoveryUpdateFailed"} {
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

// The page asks to reveal the quarantine folder the backend reported; it
// cannot point Finder or Explorer anywhere else.
func TestRevealStaysInsideTheWorkspace(t *testing.T) {
	root := t.TempDir()
	for path, want := range map[string]bool{
		root:                                       true,
		filepath.Join(root, "quarantine"):          true,
		filepath.Join(root, "..", "elsewhere"):     false,
		filepath.Join(root+"-other", "quarantine"): false,
		filepath.Dir(root):                         false,
		"":                                         false,
	} {
		if got := revealable(root, path); got != want {
			t.Errorf("revealable(%q) = %v, want %v", path, got, want)
		}
	}
}

// Autosave answers with what the page reads, not the text it just sent.
func TestDesktopUpdateLeavesTheTextOut(t *testing.T) {
	d := &Desktop{w: workspace(t)}
	cur := d.State().Current
	got, err := d.Update(Edit{ID: cur.ID, Revision: cur.Revision, Content: "# 你好\n\n正文\n"})
	if err != nil || got.Content != "" || got.Title != "你好" || got.Revision != cur.Revision+1 || got.StatusCode != "draftSaved" {
		t.Fatalf("update result: %+v %v", got, err)
	}
	if d.w.docs[cur.ID].Content != "# 你好\n\n正文\n" {
		t.Fatal("text not saved")
	}
}
