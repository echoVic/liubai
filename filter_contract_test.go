package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func filterResult(t *testing.T, w *Workspace, query, tag string) DocumentFilterResponse {
	t.Helper()
	got, err := w.FilterDocuments(DocumentFilterRequest{Query: query, Tag: tag}, "zh-Hans")
	if err != nil {
		t.Fatal(err)
	}
	if got.Items == nil || got.Tags == nil || got.Recent == nil {
		t.Fatal("response arrays must not be null")
	}
	for _, item := range got.Items {
		if item.Tags == nil || item.Document.Hits == nil {
			t.Fatal("item arrays must not be null")
		}
	}
	for _, recent := range got.Recent {
		if recent.Tags == nil {
			t.Fatal("recent tags must not be null")
		}
	}
	return got
}

func TestDocumentFilterUnicodeAndLimits(t *testing.T) {
	body := strings.Repeat("正文内容。", 1000) + "\n中文😀 独特文尾\n独特文尾\n独特文尾\n独特文尾"
	w := searchMemoryWorkspace(
		Document{ID: "work", Title: "工作", Content: "---\ntags: [工作]\n---\n\n" + body, Updated: 1, Revision: 4},
		Document{ID: "life", Title: "生活", Content: "---\ntags: [生活]\n---\n\n" + body, Updated: 2},
		Document{ID: "plain", Title: "无标签", Content: body + "\n#工作"},
	)
	if got := filterResult(t, w, "独特文尾", "工作"); got.Total != 1 || got.Items[0].Document.ID != "work" || len(got.Items[0].Document.Hits) != 3 || !got.Items[0].Document.MoreHits || got.Items[0].Excerpt != "" {
		t.Fatalf("incorrect intersection: %+v", got)
	}
	got := filterResult(t, w, "中文😀", "工作")
	hit := got.Items[0].Document.Hits[0]
	content := w.docs["work"].Content
	start := strings.Index(content, "中文😀")
	if hit.From != searchUTF16Len(content[:start]) || hit.To != hit.From+4 {
		t.Fatalf("incorrect UTF-16 range: %+v", hit)
	}
	if got := filterResult(t, w, "独特文尾", ""); got.Total != 3 {
		t.Fatalf("query scope: %+v", got)
	}
	got = filterResult(t, w, "", "工作")
	if got.Total != 1 || len(got.Items[0].Document.Hits) != 0 || got.Items[0].Excerpt == "" || utf8.RuneCountInString(got.Items[0].Excerpt) > 90 {
		t.Fatalf("tag-only result: %+v", got)
	}
	if got := filterResult(t, w, "absent", "工作"); got.Total != 0 || len(got.Tags) != 2 {
		t.Fatalf("catalog was narrowed by query: %+v", got)
	}
	sorted := searchMemoryWorkspace(
		Document{ID: "z", Updated: 1, Content: "---\ntags: [排序]\n---"},
		Document{ID: "b", Updated: 2, Content: "---\ntags: [排序]\n---"},
		Document{ID: "a", Updated: 2, Content: "---\ntags: [排序]\n---"},
	)
	got = filterResult(t, sorted, "", "排序")
	if got.Items[0].Document.ID != "a" || got.Items[1].Document.ID != "b" || got.Items[2].Document.ID != "z" {
		t.Fatalf("unstable tag-only sorting: %+v", got)
	}
}

func TestDocumentFilterCatalog(t *testing.T) {
	w := searchMemoryWorkspace(
		Document{ID: "a", Title: "A", Content: "---\ntags: [工作, 工作, Work, work, '##work']\n---"},
		Document{ID: "b", Title: "B", Content: "---\ntags: ' 工作 '\n---"},
		Document{ID: "c", Title: "C", Content: "---\ntags: [工作, 7]\n---"},
		Document{ID: "d", Title: "D", Content: "---\ntags: [\n---"},
		Document{ID: "e", Title: "E", Content: "正文 #工作"},
	)
	got := filterResult(t, w, "", "")
	want := []TagSummary{{Name: "#work", Count: 1}, {Name: "Work", Count: 1}, {Name: "work", Count: 1}, {Name: "工作", Count: 2}}
	if !reflect.DeepEqual(got.Tags, want) || got.Total != 0 || len(got.Items) != 0 || len(got.Recent) != 5 {
		t.Fatalf("catalog: %+v", got)
	}
	for _, tag := range []string{"#work", "Work", "work"} {
		if result := filterResult(t, w, "", tag); result.Total != 1 {
			t.Fatalf("canonical tag %q: %+v", tag, result)
		}
	}
	if result := filterResult(t, w, "", "  工作  "); result.Total != 2 {
		t.Fatalf("trim: %+v", result)
	}
	for _, tag := range []string{string([]byte{255}), strings.Repeat("中", 81), "a\nb", "a\x00b"} {
		if _, err := w.FilterDocuments(DocumentFilterRequest{Tag: tag}, "en"); err == nil {
			t.Fatalf("accepted invalid tag %q", tag)
		}
	}
	if _, err := w.FilterDocuments(DocumentFilterRequest{Query: strings.Repeat("a", 129)}, "en"); err == nil {
		t.Fatal("query validation was lost")
	}
}

func TestDocumentFilterScopeAndLimits(t *testing.T) {
	w := workspace(t)
	for i := 0; i < 105; i++ {
		if i > 0 {
			if _, err := w.New(); err != nil {
				t.Fatal(err)
			}
		}
		edit(t, w, fmt.Sprintf("---\ntags: [批量]\n---\n# 文稿 %d\nneedle", i))
	}
	_, file := openFile(t, w, "opened.md", "---\ntags: [批量]\n---\nneedle")
	if _, err := w.New(); err != nil {
		t.Fatal(err)
	}
	removed := edit(t, w, "---\ntags: [已移除]\n---\nneedle")
	if _, err := w.Delete(removed.ID); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(w.root, "unregistered.md"), []byte("---\ntags: [未登记]\n---\nneedle"), 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range []*Workspace{w, reopened} {
		got := filterResult(t, current, "needle", "批量")
		if got.Total != 106 || len(got.Items) != 100 || !got.Truncated {
			t.Fatalf("limits: total=%d items=%d truncated=%v", got.Total, len(got.Items), got.Truncated)
		}
		catalog := filterResult(t, current, "", "")
		if len(catalog.Tags) != 1 || catalog.Tags[0].Count != 106 || len(catalog.Recent) != len(current.docs) {
			t.Fatalf("scope: tags=%v recent=%d docs=%d", catalog.Tags, len(catalog.Recent), len(current.docs))
		}
	}
	if got := filterResult(t, w, "opened", "批量"); got.Total != 1 || got.Items[0].Document.ID != file.ID {
		t.Fatalf("opened file title query: %+v", got)
	}
}

func TestDocumentFilterReadOnly(t *testing.T) {
	w := workspace(t)
	dir, file := openFile(t, w, "readonly.md", "---\ntags: [工作]\n---\naccepted needle")
	w.Notify("filter notice")
	before := searchStateBytes(t, w)
	if err := os.WriteFile(file.Path, []byte("---\ntags: [磁盘]\n---\nchanged"), 0600); err != nil {
		t.Fatal(err)
	}
	files := searchFiles(t, w.root, dir)
	for _, request := range []DocumentFilterRequest{{}, {Tag: "工作"}, {Query: "needle", Tag: "工作"}} {
		if _, err := w.FilterDocuments(request, "en"); err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(before, searchStateBytes(t, w)) || !reflect.DeepEqual(files, searchFiles(t, w.root, dir)) {
		t.Fatal("filter changed workspace state or file bytes")
	}
	if got := filterResult(t, w, "", "磁盘"); got.Total != 0 {
		t.Fatal("filter reloaded disk content")
	}
}

func TestDocumentFilterSnapshot(t *testing.T) {
	w := searchMemoryWorkspace(Document{ID: "a", Title: "A", Content: "---\ntags: [旧]\n---\nold", Revision: 1})
	snapshot := w.searchSnapshot()
	start, done := make(chan struct{}), make(chan struct{})
	go func() {
		<-start
		w.mu.Lock()
		w.docs["a"].Content, w.docs["a"].Revision = "---\ntags: [新]\n---\nnew", 2
		w.mu.Unlock()
		close(done)
	}()
	close(start)
	<-done
	got := filterDocuments(snapshot, "old", "旧", "en")
	if got.Total != 1 || got.Items[0].Document.Revision != 1 {
		t.Fatalf("snapshot changed: %+v", got)
	}
	if fresh := filterResult(t, w, "new", "新"); fresh.Total != 1 || fresh.Items[0].Document.Revision != 2 {
		t.Fatalf("fresh public query: %+v", fresh)
	}
}

func TestDocumentFilterLocales(t *testing.T) {
	w := workspace(t)
	for _, locale := range []string{"zh-Hans", "en"} {
		response, err := w.FilterDocuments(DocumentFilterRequest{}, locale)
		if err != nil || len(response.Recent) != 1 {
			t.Fatalf("locale %s: %+v %v", locale, response, err)
		}
		want := "未命名"
		if locale == "en" {
			want = "Untitled"
		}
		if !strings.HasPrefix(response.Recent[0].Title, want) {
			t.Fatalf("locale %s title %q", locale, response.Recent[0].Title)
		}
	}
}
