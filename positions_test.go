package main

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestPositionOnlyChangesDoNotRewriteTheDraft(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "正文\n")
	draft := filepath.Join(w.root, "drafts", d.ID+".json")
	before, _ := os.ReadFile(draft)
	if err := w.SavePosition(d.ID, Position{Anchor: 1, Head: 2, Scroll: 300}); err != nil {
		t.Fatal(err)
	}
	got, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: d.Content, Position: Position{Anchor: 2, Head: 2, Scroll: 400}})
	if err != nil || got.Revision != d.Revision {
		t.Fatalf("%+v %v", got, err)
	}
	if after, _ := os.ReadFile(draft); !bytes.Equal(before, after) {
		t.Fatal("draft rewritten for a position change")
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if p := reopened.State().Current.Position; p.Scroll != 400 || p.Head != 2 {
		t.Fatalf("position not restored: %+v", p)
	}
}

func TestSavePositionClampsAndFlushRetries(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "字🌿")
	path := filepath.Join(w.root, "positions.json")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := w.SavePosition(d.ID, Position{Anchor: -1, Head: 99, Scroll: math.Inf(1), Source: true}); err == nil {
		t.Fatal("expected position write failure")
	}
	if got := w.State().Current; got.Position != (Position{Head: 3, Source: true}) || got.Revision != d.Revision || got.Updated != d.Updated {
		t.Fatalf("position not clamped or content metadata changed: %+v", got)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := w.Flush(); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil || reopened.State().Current.Position != (Position{Head: 3, Source: true}) {
		t.Fatalf("flush did not restore position: %v", err)
	}
	for _, scroll := range []float64{-1, math.NaN(), math.Inf(-1)} {
		if err := w.SavePosition(d.ID, Position{Scroll: scroll}); err != nil || w.State().Current.Position.Scroll != 0 {
			t.Fatalf("invalid scroll was not clamped: %v", err)
		}
	}
	if err := w.SavePosition("missing", Position{}); err == nil {
		t.Fatal("missing document accepted")
	}
}

func TestFilePositionChangesLeaveBothFilesUntouched(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "note.md")
	if err := os.WriteFile(p, []byte("正文\n"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	d := s.Current
	draft := filepath.Join(w.root, "drafts", d.ID+".json")
	before, err := os.Stat(draft)
	if err != nil {
		t.Fatal(err)
	}
	diskBefore, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.SavePosition(d.ID, Position{Head: 1}); err != nil {
		t.Fatal(err)
	}
	got, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: d.Content, Position: Position{Head: 2}})
	if err != nil || got.Revision != d.Revision {
		t.Fatalf("position-only update: %+v %v", got, err)
	}
	after, _ := os.Stat(draft)
	diskAfter, _ := os.Stat(p)
	if !os.SameFile(before, after) || !os.SameFile(diskBefore, diskAfter) {
		t.Fatal("position change replaced the draft or original")
	}
}

func TestFileSaveSurvivesRecoveryRecordFailure(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "note.md")
	if err := os.WriteFile(p, []byte("旧正文"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	d := s.Current
	draft := filepath.Join(w.root, "drafts", d.ID+".json")
	if err := os.Remove(draft); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(draft, 0700); err != nil {
		t.Fatal(err)
	}
	got, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "新正文"})
	if err != nil || got.Content != "新正文" || got.Revision != d.Revision+1 || got.Status != "文件已保存，恢复记录更新失败" {
		t.Fatalf("successful file save lost after draft failure: %+v %v", got, err)
	}
	if b, err := os.ReadFile(p); err != nil || string(b) != "新正文" {
		t.Fatalf("original was not saved first: %q %v", b, err)
	}
}

func TestInvalidPositionsFileKeepsLegacyPosition(t *testing.T) {
	for _, data := range []string{"{invalid", "null"} {
		w := workspace(t)
		d := w.State().Current
		if _, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "正文", Position: Position{Head: 1, Scroll: 20}}); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(w.root, "positions.json"), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		reopened, err := openWorkspace(w.root)
		if err != nil || reopened.State().Current.Position != (Position{Head: 1, Scroll: 20}) {
			t.Fatalf("invalid positions file lost legacy position: %v", err)
		}
	}
}
