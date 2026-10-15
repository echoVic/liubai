package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDeleteMovesDraftToTrashAndSwitchesCurrent(t *testing.T) {
	w := workspace(t)
	first := edit(t, w, "第一篇\n")
	if _, err := w.New(); err != nil {
		t.Fatal(err)
	}
	second := edit(t, w, "第二篇\n")
	s, err := w.Delete(second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s.Current.ID != first.ID {
		t.Fatalf("current %s, want %s", s.Current.ID, first.ID)
	}
	for _, r := range s.Recent {
		if r.ID == second.ID {
			t.Fatal("deleted draft still listed")
		}
	}
	if _, err := os.Stat(filepath.Join(w.root, "drafts", second.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("draft file left behind")
	}
	if m, _ := filepath.Glob(filepath.Join(w.root, "trash", "*-"+second.ID, "draft.json")); len(m) != 1 {
		t.Fatal("draft not in trash")
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range reopened.State().Recent {
		if r.ID == second.ID {
			t.Fatal("deleted draft came back")
		}
	}
}

func TestDeleteFileBackedDocumentKeepsTheFile(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "keep.md")
	os.WriteFile(p, []byte("磁盘内容\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Delete(s.Current.ID); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(p); err != nil || string(b) != "磁盘内容\n" {
		t.Fatalf("file touched: %q %v", b, err)
	}
}

func TestDeletingTheLastDocumentCreatesAnEmptyDraft(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "唯一一篇\n")
	s, err := w.Delete(d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s.Current.ID == d.ID || s.Current.Content != "" || len(s.Recent) != 1 {
		t.Fatalf("got %+v", s)
	}
}

func TestEmptyUntitledDraftsAreCleanedWhenSwitching(t *testing.T) {
	w := workspace(t)
	empty := w.State().Current
	s, err := w.New()
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range s.Recent {
		if r.ID == empty.ID {
			t.Fatal("empty draft kept after New")
		}
	}
	edit(t, w, "有内容\n")
	if s, _ = w.New(); len(s.Recent) != 2 {
		t.Fatalf("recent=%d, want the written draft and the new one", len(s.Recent))
	}
}

func TestOldTrashIsPurgedOnStartup(t *testing.T) {
	root := t.TempDir()
	if _, err := openWorkspace(root); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(root, "trash", "20200101-000000-"+strings.Repeat("ab", 12))
	os.MkdirAll(old, 0700)
	past := time.Now().AddDate(0, 0, -31)
	os.Chtimes(old, past, past)
	if _, err := openWorkspace(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("old trash not purged")
	}
}

func TestDeletePreservesAssetsAndDropsPosition(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "带图的草稿\n")
	im, err := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	if err := w.SavePosition(d.ID, Position{Head: 2, Scroll: 42}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Delete(d.ID); err != nil {
		t.Fatal(err)
	}
	matches, _ := filepath.Glob(filepath.Join(w.root, "trash", "*-"+d.ID, "assets", im.Name))
	if len(matches) != 1 {
		t.Fatal("image not moved to trash")
	}
	if b, err := os.ReadFile(matches[0]); err != nil || !bytes.Equal(b, tinyPNG()) {
		t.Fatalf("image changed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(w.root, "assets", d.ID)); !os.IsNotExist(err) {
		t.Fatal("asset directory left behind")
	}
	b, err := os.ReadFile(filepath.Join(w.root, "positions.json"))
	if err != nil {
		t.Fatal(err)
	}
	var positions map[string]Position
	if err := json.Unmarshal(b, &positions); err != nil {
		t.Fatal(err)
	}
	if _, ok := positions[d.ID]; ok {
		t.Fatal("deleted position still on disk")
	}
	if _, ok := w.positions[d.ID]; ok {
		t.Fatal("deleted position still in memory")
	}
}

func TestDeleteSelectsMostRecentlyUpdatedAndKeepsOtherCurrent(t *testing.T) {
	w := workspace(t)
	first := edit(t, w, "第一篇")
	if _, err := w.New(); err != nil {
		t.Fatal(err)
	}
	second := edit(t, w, "第二篇")
	if _, err := w.New(); err != nil {
		t.Fatal(err)
	}
	third := edit(t, w, "第三篇")
	w.docs[first.ID].Updated = 20
	w.docs[second.ID].Updated = 10
	s, err := w.Delete(third.ID)
	if err != nil || s.Current.ID != first.ID {
		t.Fatalf("did not select most recently updated: %+v %v", s, err)
	}
	s, err = w.Delete(second.ID)
	if err != nil || s.Current.ID != first.ID || len(s.Recent) != 1 {
		t.Fatalf("non-current deletion switched document: %+v %v", s, err)
	}
	if _, err := w.Delete("missing"); err == nil || err.Error() != "文稿不存在" {
		t.Fatalf("unknown document: %v", err)
	}
}

func TestEmptyUntitledDraftsCleanedOnActivateAndOpen(t *testing.T) {
	for _, action := range []string{"Activate", "Open", "OpenExisting"} {
		t.Run(action, func(t *testing.T) {
			w := workspace(t)
			p := filepath.Join(t.TempDir(), "note.md")
			if err := os.WriteFile(p, []byte("正文"), 0644); err != nil {
				t.Fatal(err)
			}
			s, err := w.Open(p)
			if err != nil {
				t.Fatal(err)
			}
			target := s.Current.ID
			if _, err := w.New(); err != nil {
				t.Fatal(err)
			}
			empty := edit(t, w, " \n\t")
			if err := w.SavePosition(empty.ID, Position{Head: 1}); err != nil {
				t.Fatal(err)
			}
			switch action {
			case "Activate":
				s, err = w.Activate(target)
			case "OpenExisting":
				s, err = w.Open(p)
			case "Open":
				p = filepath.Join(t.TempDir(), "other.md")
				if err := os.WriteFile(p, []byte("另一篇"), 0644); err != nil {
					t.Fatal(err)
				}
				s, err = w.Open(p)
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, r := range s.Recent {
				if r.ID == empty.ID {
					t.Fatal("empty draft kept after switching")
				}
			}
			if m, _ := filepath.Glob(filepath.Join(w.root, "trash", "*-"+empty.ID, "draft.json")); len(m) != 1 {
				t.Fatal("empty draft not in trash")
			}
			if _, ok := w.positions[empty.ID]; ok {
				t.Fatal("empty draft position kept")
			}
		})
	}
}

func TestStartupCleansOnlyDisposableNonCurrentDrafts(t *testing.T) {
	w := workspace(t)
	current := w.State().Current
	empty, err := w.newLocked(" \n")
	if err != nil {
		t.Fatal(err)
	}
	named, err := w.newLocked("")
	if err != nil {
		t.Fatal(err)
	}
	named.Title, named.CustomTitle = "保留名字", true
	if err := w.persist(named); err != nil {
		t.Fatal(err)
	}
	if err := w.SavePosition(empty.ID, Position{Head: 1}); err != nil {
		t.Fatal(err)
	}
	fresh := filepath.Join(w.root, "trash", "fresh")
	if err := os.MkdirAll(fresh, 0700); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	s := reopened.State()
	if s.Current.ID != current.ID || len(s.Recent) != 2 || reopened.docs[named.ID] == nil || reopened.docs[empty.ID] != nil {
		t.Fatalf("wrong startup cleanup: %+v", s.Recent)
	}
	if _, ok := reopened.positions[empty.ID]; ok {
		t.Fatal("startup kept disposable position")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("fresh trash removed: %v", err)
	}
	if _, err := reopened.Activate(named.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.New(); err != nil {
		t.Fatal(err)
	}
	if reopened.docs[named.ID] == nil {
		t.Fatal("named empty draft removed when switching")
	}
}

func TestFailedSwitchKeepsDisposableDraft(t *testing.T) {
	w := workspace(t)
	empty := w.State().Current
	if _, err := w.Activate(empty.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Activate("missing"); err == nil {
		t.Fatal("missing document accepted")
	}
	if _, err := w.Open(filepath.Join(t.TempDir(), "missing.md")); err == nil {
		t.Fatal("missing file accepted")
	}
	if w.State().Current.ID != empty.ID || w.docs[empty.ID] == nil {
		t.Fatal("failed switch removed the current draft")
	}
}

func TestDeleteTrashFailureKeepsDocument(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "保留的正文")
	if err := os.WriteFile(filepath.Join(w.root, "trash"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Delete(d.ID); err == nil {
		t.Fatal("trash failure ignored")
	}
	if got := w.State().Current; got.ID != d.ID || got.Content != d.Content {
		t.Fatal("failed deletion lost current document")
	}
	if _, err := os.Stat(filepath.Join(w.root, "drafts", d.ID+".json")); err != nil {
		t.Fatal(err)
	}
}
