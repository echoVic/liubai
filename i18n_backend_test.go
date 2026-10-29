package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"liubai/locales"

	"github.com/egoist/mygo/i18n"
)

func statusCodeOf(t *testing.T, value any) string {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(b, &fields); err != nil {
		t.Fatal(err)
	}
	code, _ := fields["statusCode"].(string)
	return code
}

func TestStatusCodesCoverDraftSaveConflictAndMissingFile(t *testing.T) {
	w := workspace(t)
	if got := statusCodeOf(t, w.State().Current); got != "draftSaved" {
		t.Fatalf("draft statusCode = %q", got)
	}
	path, doc := openFile(t, w, "status.md", "first\n")
	saved, err := w.Update(Edit{ID: doc.ID, Revision: doc.Revision, Content: "saved\n"})
	if err != nil {
		t.Fatal(err)
	}
	if got := statusCodeOf(t, saved); got != "fileSaved" {
		t.Fatalf("save statusCode = %q", got)
	}
	if err := os.WriteFile(path, []byte("external\n"), 0600); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	w.docs[doc.ID].Content = "local\n"
	w.mu.Unlock()
	st, err := w.Status(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := statusCodeOf(t, st); got != "diskConflict" {
		t.Fatalf("conflict statusCode = %q", got)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	st, err = w.Status(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := statusCodeOf(t, st); got != "fileUnavailable" {
		t.Fatalf("missing statusCode = %q", got)
	}
}

func TestLegacyDraftStatusMigrationPreservesUnknownProse(t *testing.T) {
	for _, tc := range []struct{ status, code string }{
		{"草稿已保存", "draftSaved"}, {"文件已保存", "fileSaved"},
		{"草稿已保留，文件保存失败", "fileSaveFailed"}, {"unknown historical status", "draftSaved"},
	} {
		t.Run(tc.code, func(t *testing.T) {
			w := workspace(t)
			doc := w.State().Current
			path := filepath.Join(w.root, "drafts", doc.ID+".json")
			b, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]any
			if err := json.Unmarshal(b, &fields); err != nil {
				t.Fatal(err)
			}
			fields["status"] = tc.status
			delete(fields, "statusCode")
			b, _ = json.Marshal(fields)
			if err := os.WriteFile(path, b, 0600); err != nil {
				t.Fatal(err)
			}
			reopened, err := openWorkspace(w.root)
			if err != nil {
				t.Fatal(err)
			}
			got := reopened.State().Current
			if code := statusCodeOf(t, got); code != tc.code {
				t.Fatalf("statusCode = %q, want %q", code, tc.code)
			}
			if got.Status != tc.status {
				t.Fatalf("legacy status lost: %q", got.Status)
			}
		})
	}
}

func TestSaveFailureCodeKeepsNativeEditedRegardlessOfProse(t *testing.T) {
	w := workspace(t)
	doc := w.State().Current
	drafts := filepath.Join(w.root, "drafts")
	if err := os.Rename(drafts, drafts+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(drafts, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	failed, err := w.Update(Edit{ID: doc.ID, Revision: doc.Revision, Content: "must stay in editor"})
	if err == nil {
		t.Fatal("expected persistence failure")
	}
	if failed.StatusCode != "saveFailed" {
		t.Fatalf("failure code = %q", failed.StatusCode)
	}
	failed.Status = "A localized message with no legacy failure word"
	if !failed.saveFailed() {
		t.Fatal("native failure detection depended on prose")
	}
	if edited, _ := (editedIndicator{}).decision(time.Now(), failed.Conflict, failed.saveFailed()); !edited {
		t.Fatal("failed save cleared native edited marker")
	}
}

func TestRequestLocalesTranslateErrorsIndependently(t *testing.T) {
	before := i18n.Locale()
	err := messageError("bDocumentMissing", nil)
	var wg sync.WaitGroup
	for _, tag := range []string{"en-US", "zh-CN"} {
		wg.Add(1)
		go func(tag string) {
			defer wg.Done()
			want := locales.In(tag).BDocumentMissing()
			for i := 0; i < 100; i++ {
				if got := errorIn(err, tag); got != want {
					t.Errorf("%s: error = %q, want %q", tag, got, want)
					return
				}
			}
		}(tag)
	}
	wg.Wait()
	if after := i18n.Locale(); after != before {
		t.Fatalf("request translation changed global locale %q to %q", before, after)
	}
}

func TestLocalizedStatePreservesContentAndUserTitles(t *testing.T) {
	w := workspace(t)
	original := w.State()
	english := valueIn(original, "en-US").(WorkspaceState)
	if english.Current.Title != "Untitled Document" || english.Recent[0].Title != "Untitled Document" {
		t.Fatalf("generated titles were not localized: %+v", english)
	}
	if original.Current.Title == english.Current.Title {
		t.Fatal("localization mutated stored snapshot")
	}
	for _, custom := range []bool{false, true} {
		doc := original.Current
		doc.Content = "# 未命名文稿\n用户正文"
		doc.Title = "未命名文稿"
		doc.CustomTitle = custom
		result := documentIn(doc, "en")
		if result.Content != doc.Content || result.Title != doc.Title {
			t.Fatal("localized user content or title")
		}
	}
	custom := original.Current
	custom.CustomTitle = true
	if got := documentIn(custom, "en"); got.Title != custom.Title {
		t.Fatal("localized explicitly chosen title")
	}
}

func TestUnknownLegacyStatusInfersOperationalState(t *testing.T) {
	for _, tc := range []struct {
		path     string
		conflict bool
		code     string
	}{{"", false, "draftSaved"}, {"/document.md", false, "fileSaved"}, {"/document.md", true, "diskConflict"}} {
		b, _ := json.Marshal(map[string]any{"status": "unknown historical status", "path": tc.path, "conflict": tc.conflict})
		var doc Document
		if err := json.Unmarshal(b, &doc); err != nil {
			t.Fatal(err)
		}
		if doc.StatusCode != tc.code || doc.Status != "unknown historical status" {
			t.Fatalf("migration = %+v, want %s with preserved prose", doc, tc.code)
		}
	}
}

func TestGeneratedRecoveryTitleFollowsRequestLocale(t *testing.T) {
	w := workspace(t)
	path, doc := openFile(t, w, "original.md", "disk before\n")
	w.mu.Lock()
	w.docs[doc.ID].Content = "unsaved local draft\n"
	w.mu.Unlock()
	if err := os.WriteFile(path, []byte("disk after\n"), 0600); err != nil {
		t.Fatal(err)
	}
	state, err := w.Reload(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	english := valueIn(state, "en").(WorkspaceState)
	for _, item := range english.Recent {
		if item.ID != doc.ID && item.Title == "original.md · Recovery Copy" {
			restored, err := w.Activate(item.ID)
			if err != nil {
				t.Fatal(err)
			}
			localized := valueIn(restored, "en").(WorkspaceState)
			if localized.Current.Title != item.Title || localized.Current.Content != "unsaved local draft\n" {
				t.Fatal("recovery title or content changed")
			}
			return
		}
	}
	t.Fatalf("recovery title not localized: %+v", english.Recent)
}

func TestGeneratedSuffixPreservesMatchingWordsInUserTitle(t *testing.T) {
	doc := Document{Title: "user · Recovery Copy · 恢复副本", GeneratedTitleSuffix: "recovery", Content: "retained"}
	localized := documentIn(doc, "en")
	if localized.Title != "user · Recovery Copy · Recovery Copy" {
		t.Fatalf("user title suffix was removed: %q", localized.Title)
	}
}
