package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func BenchmarkSessionRecoveryDelta(b *testing.B) {
	content := strings.Repeat("a", 5<<20)
	old := stagedRecovery{content: content, length: len(content)}
	change := []RecoveryDelta{{From: len(content), To: len(content), Insert: "尾"}}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, _, err := applyRecoveryChanges(old, change); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSessionRecoveryPosition(b *testing.B) {
	content := strings.Repeat("a", 5<<20)
	old := stagedRecovery{content: content, length: len(content)}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, _, err := applyRecoveryChanges(old, nil); err != nil {
			b.Fatal(err)
		}
	}
}

func TestSessionRecoveryCopiesNewImagesAndDeduplicatesAcrossRestart(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "original")
	im, err := w.ImportImage(d.ID, "pasted.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	text := "unsaved ![image](" + im.Markdown + ")"
	if err = w.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 1, Content: &text}); err != nil {
		t.Fatal(err)
	}
	if err = w.flushRecovery(); err != nil {
		t.Fatal(err)
	}
	for id, doc := range w.docs {
		if id != d.ID {
			for _, target := range imageTargets(doc.Content) {
				if _, err = w.imagePath(doc, target); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if err = reopened.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 1, Content: &text}); err != nil {
		t.Fatal(err)
	}
	if err = reopened.flushRecovery(); err != nil {
		t.Fatal(err)
	}
	if len(reopened.docs) != 2 {
		t.Fatalf("duplicate recovery: %d", len(reopened.docs))
	}
}

func TestSessionRecoveryFlushesLastPositionOverPreviousPositionFile(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "saved text")
	if err := w.SavePosition(d.ID, Position{Anchor: 1, Head: 1}); err != nil {
		t.Fatal(err)
	}
	if err := w.flushPositions(); err != nil {
		t.Fatal(err)
	}
	text := d.Content
	position := Position{Anchor: 5, Head: 5, Scroll: 42}
	if err := w.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 1, Content: &text, Position: position}); err != nil {
		t.Fatal(err)
	}
	if err := w.flushRecovery(); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.docs[d.ID].Position != position {
		t.Fatalf("position lost: %+v", reopened.docs[d.ID].Position)
	}
}

func TestSessionRecoveryEditedCopyDoesNotSuppressNextTail(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "base")
	text := "base tail"
	stage := func() {
		t.Helper()
		if err := w.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 1, Content: &text}); err != nil {
			t.Fatal(err)
		}
		if err := w.flushRecovery(); err != nil {
			t.Fatal(err)
		}
	}
	stage()
	for id, doc := range w.docs {
		if id != d.ID {
			if _, err := w.Update(Edit{ID: id, Revision: doc.Revision, Content: "edited recovery"}); err != nil {
				t.Fatal(err)
			}
		}
	}
	stage()
	if len(w.docs) != 3 {
		t.Fatalf("fresh tail discarded: %d docs", len(w.docs))
	}
}

func TestSessionRecoveryRetainsDebounceTailWithoutReplacingNewerText(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "中😀原稿")
	seed := d.Content
	if err := w.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 1, Content: &seed}); err != nil {
		t.Fatal(err)
	}
	if err := w.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 2, Previous: 1, Changes: []RecoveryDelta{{From: 3, To: 3, Insert: "最后输入"}}}); err != nil {
		t.Fatal(err)
	}
	if err := w.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 3, Previous: 1}); err == nil {
		t.Fatal("accepted a missing delta")
	}
	if err := w.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 3, Previous: 2, Changes: []RecoveryDelta{{From: 2, To: 2, Insert: "坏"}}}); err == nil {
		t.Fatal("split a UTF-16 surrogate pair")
	}
	edit(t, w, "后端更新的正文")
	if err := w.flushRecovery(); err != nil {
		t.Fatal(err)
	}
	if err := w.flushRecovery(); err != nil {
		t.Fatal(err)
	}
	restored, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if restored.docs[d.ID].Content != "后端更新的正文" || len(restored.docs) != 2 {
		t.Fatalf("original/recovery changed: %+v", restored.docs)
	}
	for id, doc := range restored.docs {
		if id != d.ID && (doc.Content != "中😀最后输入原稿" || doc.Path != "") {
			t.Fatalf("bad recovery: %+v", doc)
		}
	}
}

func TestSessionRecoveryCompositionAndFailedDiskRetry(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "已经保存")
	text := "已经保存组合候选"
	if err := w.stageRecovery(RecoveryUpdate{Version: 1, ID: d.ID, Sequence: 1, Content: &text, Composing: true}); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(w.root, "drafts")
	backup := dir + "-saved"
	if err := os.Rename(dir, backup); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := w.flushRecovery(); err == nil {
		t.Fatal("disk failure was hidden")
	}
	if err := os.Remove(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, dir); err != nil {
		t.Fatal(err)
	}
	if err := w.flushRecovery(); err != nil {
		t.Fatal(err)
	}
	for id, doc := range w.docs {
		if id != d.ID && (!doc.CustomTitle || doc.Title[len(doc.Title)-5:] != "(IME)" || doc.Content != text) {
			t.Fatalf("composition merged or unmarked: %+v", doc)
		}
	}
}
