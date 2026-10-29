package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"unicode/utf16"
	"unicode/utf8"
	"unsafe"

	"liubai/locales"

	"github.com/egoist/mygo/i18n"
)

func searchMemoryWorkspace(docs ...Document) *Workspace {
	w := &Workspace{docs: make(map[string]*Document)}
	for _, doc := range docs {
		w.docs[doc.ID] = &doc
	}
	return w
}

func searchResult(t *testing.T, w *Workspace, query, locale string) SearchResponse {
	t.Helper()
	got, err := w.Search(query, locale)
	if err != nil {
		t.Fatal(err)
	}
	if got.Items == nil {
		t.Fatal("items must be a nonnil JSON array")
	}
	for _, item := range got.Items {
		if item.Hits == nil {
			t.Fatal("hits must be a nonnil JSON array")
		}
	}
	return got
}

func TestSearchScope(t *testing.T) {
	w := workspace(t)
	want := map[string]bool{}
	for i := 0; i < 35; i++ {
		if i != 0 {
			if _, err := w.New(); err != nil {
				t.Fatal(err)
			}
		}
		doc := edit(t, w, fmt.Sprintf("# Draft %d\nscope-token", i))
		want[doc.ID] = true
	}
	_, file := openFile(t, w, "opened.md", "scope-token file copy")
	want[file.ID] = true
	// Reload preserves an edited working copy as a registered recovery draft.
	w.mu.Lock()
	w.docs[file.ID].Content = "scope-token recovery copy"
	w.mu.Unlock()
	state, err := w.Reload(file.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, doc := range state.Recent {
		want[doc.ID] = true
	}
	if len(want) != 37 {
		t.Fatalf("fixture has %d registered documents, want 37", len(want))
	}
	if _, err := w.New(); err != nil {
		t.Fatal(err)
	}
	deleted := edit(t, w, "scope-token deleted")
	if _, err := w.Delete(deleted.ID); err != nil {
		t.Fatal(err)
	}
	trash, err := filepath.Glob(filepath.Join(w.root, "trash", "*-"+deleted.ID, "draft.json"))
	if err != nil || len(trash) != 1 {
		t.Fatalf("deleted document not in trash: %v %v", trash, err)
	}
	unregistered := filepath.Join(w.root, "never-opened.md")
	if err := os.WriteFile(unregistered, []byte("scope-token unregistered"), 0600); err != nil {
		t.Fatal(err)
	}
	corrupt := filepath.Join(w.root, "drafts", strings.Repeat("ab", 12)+".json")
	if err := os.WriteFile(corrupt, []byte("scope-token corrupt JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.quarantineDir == "" {
		t.Fatal("fixture did not quarantine the corrupt draft")
	}
	for _, current := range []*Workspace{w, reopened} {
		got := searchResult(t, current, "scope-token", "en")
		if got.Total != len(want) || len(got.Items) != len(want) || got.Truncated {
			t.Fatalf("scope: total=%d items=%d truncated=%v", got.Total, len(got.Items), got.Truncated)
		}
		seen := map[string]bool{}
		for _, item := range got.Items {
			if !want[item.ID] || seen[item.ID] {
				t.Fatalf("unexpected or duplicate registered ID %q", item.ID)
			}
			seen[item.ID] = true
		}
	}
}

func TestSearchLiteralAndUnicode(t *testing.T) {
	content := "---\nprivate: frontmatter-token\n---\n# Neutral\n" + strings.Repeat("padding ", 700) + `
TailNeedle 汉 English 汉English
.*[x] a+b $^()[]{}|?+\
white  space white space tab	inside
K ſ ß café aaaa
` + "```go\ncode-token := true\n```\nhttps://example.test/url-token?q=1"
	w := searchMemoryWorkspace(Document{ID: "one", Title: "Neutral", CustomTitle: true, Content: content})
	for _, tc := range []struct {
		query string
		texts []string
	}{
		{"tailneedle", []string{"TailNeedle"}},
		{"汉", []string{"汉", "汉"}},
		{"汉english", []string{"汉English"}},
		{".*[x]", []string{".*[x]"}},
		{"a+b", []string{"a+b"}},
		{`$^()[]{}|?+\`, []string{`$^()[]{}|?+\`}},
		{" \twhite  space \n", []string{"white  space"}},
		{"tab\tinside", []string{"tab\tinside"}},
		{"k", []string{"k", "K", "k"}},
		{"k s", []string{"K ſ"}},
		{"ss", nil},
		{"ß", []string{"ß"}},
		{"cafe\u0301", nil},
		{"aa", []string{"aa", "aa"}},
		{"frontmatter-token", []string{"frontmatter-token"}},
		{"code-token", []string{"code-token"}},
		{"url-token?q=1", []string{"url-token?q=1"}},
		{"absent-token", nil},
	} {
		t.Run(tc.query, func(t *testing.T) {
			got := searchResult(t, w, tc.query, "en")
			if len(tc.texts) == 0 {
				if got.Total != 0 || len(got.Items) != 0 {
					t.Fatalf("unexpected match: %+v", got)
				}
				return
			}
			if got.Total != 1 || len(got.Items) != 1 {
				t.Fatalf("missing literal match: %+v", got)
			}
			var texts []string
			for _, hit := range got.Items[0].Hits {
				texts = append(texts, hit.Text)
			}
			if !reflect.DeepEqual(texts, tc.texts) {
				t.Fatalf("matched source text = %q, want %q", texts, tc.texts)
			}
		})
	}
	for _, query := range []string{"", " \t\r\n\u3000 ", "not-found"} {
		got := searchResult(t, w, query, "en")
		b, err := json.Marshal(got)
		if err != nil || string(b) != `{"items":[],"total":0,"truncated":false}` {
			t.Fatalf("empty response = %s, %v", b, err)
		}
	}
	for _, tc := range []struct{ query, key string }{
		{string([]byte{0xff}), "bSearchInvalidQuery"},
		{" \xff ", "bSearchInvalidQuery"},
		{strings.Repeat("😀", 129), "bSearchQueryTooLong"},
		{"a\nb", "bSearchQueryLineBreak"},
		{"a\rb", "bSearchQueryLineBreak"},
		{"a\r\nb", "bSearchQueryLineBreak"},
	} {
		got, err := w.Search(tc.query, "en")
		if e, ok := err.(*catalogError); !ok || e.Key != tc.key {
			t.Fatalf("query %q: error=%v, want key %s", tc.query, err, tc.key)
		}
		if got.Items == nil || len(got.Items) != 0 {
			t.Fatalf("invalid query returned nil or nonempty items: %+v", got)
		}
	}
	maxQuery := strings.Repeat("😀", 128)
	maxW := searchMemoryWorkspace(Document{ID: "max", Title: "neutral", CustomTitle: true, Content: maxQuery})
	if got := searchResult(t, maxW, " \n"+maxQuery+"\t ", "en"); got.Total != 1 {
		t.Fatal("128 Unicode runes after trimming must be accepted")
	}
}

func TestSearchUTF16Ranges(t *testing.T) {
	content := "中😀AKſ尾\n第二😀AKſ尾"
	w := searchMemoryWorkspace(Document{ID: "one", Title: "中😀AKſ尾", CustomTitle: true, Content: content})
	for _, tc := range []struct {
		query string
		title SearchRange
		hits  []SearchHit
	}{
		{"😀", SearchRange{1, 3}, []SearchHit{{From: 1, To: 3, Line: 1, Text: "😀"}, {From: 10, To: 12, Line: 2, Text: "😀"}}},
		{"a", SearchRange{3, 4}, []SearchHit{{From: 3, To: 4, Line: 1, Text: "A"}, {From: 12, To: 13, Line: 2, Text: "A"}}},
		{"k", SearchRange{4, 5}, []SearchHit{{From: 4, To: 5, Line: 1, Text: "K"}, {From: 13, To: 14, Line: 2, Text: "K"}}},
		{"s", SearchRange{5, 6}, []SearchHit{{From: 5, To: 6, Line: 1, Text: "ſ"}, {From: 14, To: 15, Line: 2, Text: "ſ"}}},
		{"尾", SearchRange{6, 7}, []SearchHit{{From: 6, To: 7, Line: 1, Text: "尾"}, {From: 15, To: 16, Line: 2, Text: "尾"}}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			got := searchResult(t, w, tc.query, "en").Items[0]
			if got.TitleMatch == nil || *got.TitleMatch != tc.title || len(got.Hits) != len(tc.hits) {
				t.Fatalf("ranges = %+v, want title=%+v hits=%+v", got, tc.title, tc.hits)
			}
			encoded := utf16.Encode([]rune(content))
			for i, hit := range got.Hits {
				want := tc.hits[i]
				if hit.From != want.From || hit.To != want.To || hit.Line != want.Line || hit.Text != want.Text {
					t.Fatalf("hit=%+v, want %+v", hit, want)
				}
				if string(utf16.Decode(encoded[hit.From:hit.To])) != hit.Text {
					t.Fatal("UTF-16 range does not address original matching text")
				}
			}
		})
	}
	t.Run("imported BOM and CRLF", func(t *testing.T) {
		disk := workspace(t)
		path, doc := openFile(t, disk, "crlf.md", "\ufeff中😀AKſ尾\r\n第二😀AKſ尾")
		if !doc.BOM || !doc.CRLF || doc.Content != content {
			t.Fatal("Open fixture did not normalize BOM/CRLF")
		}
		before, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		got := searchResult(t, disk, "s", "en").Items[0]
		if got.Hits[1].From != 14 || got.Hits[1].To != 15 || got.Hits[1].Line != 2 {
			t.Fatalf("imported coordinates = %+v", got.Hits)
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("search rewrote imported file")
		}
	})
	t.Run("bounded cloned snippets", func(t *testing.T) {
		body := "previous line\n" + strings.Repeat("中", 34) + "😀K" + strings.Repeat("尾", 42) + "\nnext line"
		doc := Document{ID: "snippet", Title: "neutral", CustomTitle: true, Content: body}
		got := searchResult(t, searchMemoryWorkspace(doc), "k", "en").Items[0].Hits[0]
		if utf8.RuneCountInString(got.Before) > 32 || utf8.RuneCountInString(got.After) > 40 {
			t.Fatalf("snippet fields exceed rune limits: %+v", got)
		}
		if got.Line != 2 || got.Text != "K" || got.Before != "…"+strings.Repeat("中", 30)+"😀" || got.After != strings.Repeat("尾", 39)+"…" {
			t.Fatalf("snippet = %+v", got)
		}
		start := uintptr(unsafe.Pointer(unsafe.StringData(body)))
		end := start + uintptr(len(body))
		for _, text := range []string{got.Text, got.Before, got.After} {
			ptr := uintptr(unsafe.Pointer(unsafe.StringData(text)))
			if ptr >= start && ptr < end {
				t.Fatal("tiny returned string retains the original body")
			}
		}
		edge := searchMemoryWorkspace(Document{ID: "edge", Title: "neutral", CustomTitle: true, Content: "not context\nK\nnot context"})
		hit := searchResult(t, edge, "k", "en").Items[0].Hits[0]
		if hit.Before != "" || hit.After != "" || hit.Line != 2 {
			t.Fatalf("snippet crossed a line: %+v", hit)
		}
	})
}

func TestSearchLimitsAndOrder(t *testing.T) {
	var docs []Document
	for i := 104; i >= 0; i-- {
		docs = append(docs, Document{ID: fmt.Sprintf("id-%03d", i), Title: "same title", CustomTitle: true, Content: "needle", Updated: 20, Revision: i})
	}
	docs = append(docs,
		Document{ID: "title-old", Title: "needle only", CustomTitle: true, Updated: 1, Revision: 7},
		Document{ID: "title-new", Title: "needle new", CustomTitle: true, Updated: 2},
		Document{ID: "body-new", Title: "body", CustomTitle: true, Content: "needle", Updated: 30},
	)
	w := searchMemoryWorkspace(docs...)
	for i := 0; i < 5; i++ {
		got := searchResult(t, w, "needle", "en")
		if got.Total != 108 || len(got.Items) != 100 || !got.Truncated {
			t.Fatalf("limits = total:%d items:%d truncated:%v", got.Total, len(got.Items), got.Truncated)
		}
		if got.Items[0].ID != "title-new" || got.Items[1].ID != "title-old" || got.Items[2].ID != "body-new" {
			t.Fatalf("title/updated priority = %+v", got.Items[:3])
		}
		for j := 3; j < 100; j++ {
			if got.Items[j].ID != fmt.Sprintf("id-%03d", j-3) || got.Items[j].Revision != j-3 {
				t.Fatalf("stable ID order or revision lost: %+v", got.Items[j])
			}
		}
		onlyTitle := got.Items[1]
		if onlyTitle.TitleMatch == nil || *onlyTitle.TitleMatch != (SearchRange{0, 6}) || len(onlyTitle.Hits) != 0 || onlyTitle.MoreHits {
			t.Fatalf("title-only result = %+v", onlyTitle)
		}
		b, err := json.Marshal(onlyTitle)
		if err != nil || !bytes.Contains(b, []byte(`"hits":[]`)) || bytes.Contains(b, []byte(`"content"`)) {
			t.Fatalf("DTO leaked content or null hits: %s %v", b, err)
		}
	}
	exactLimit := searchResult(t, searchMemoryWorkspace(docs[:100]...), "needle", "en")
	if exactLimit.Total != 100 || len(exactLimit.Items) != 100 || exactLimit.Truncated {
		t.Fatal("exactly 100 results must not be truncated")
	}
	for _, n := range []int{1, 2, 3, 4, 20} {
		body := strings.Repeat("needle\n", n)
		got := searchResult(t, searchMemoryWorkspace(Document{ID: "hits", Title: "neutral", CustomTitle: true, Content: body}), "needle", "en").Items[0]
		if len(got.Hits) != min(n, 3) || got.MoreHits != (n > 3) {
			t.Fatalf("%d occurrences: %+v", n, got)
		}
		for i, hit := range got.Hits {
			if hit.From != i*7 || hit.To != i*7+6 || hit.Line != i+1 {
				t.Fatalf("hits not first three in ascending order: %+v", got.Hits)
			}
		}
	}
}

func searchStateBytes(t *testing.T, w *Workspace) []byte {
	t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()
	value := struct {
		Docs           map[string]*Document
		Positions      map[string]Position
		PositionsDirty bool
		Current        string
		Appearance     Appearance
		Capture        CaptureSettings
		Notices        []localeMessage
		Locale         string
		Quarantine     string
	}{w.docs, w.positions, w.positionsDirty, w.current, w.appearance, w.capture, w.notices, w.localePreference, w.quarantineDir}
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type searchFileSnapshot struct {
	Data    string
	Mode    fs.FileMode
	ModTime int64
}

func searchFiles(t *testing.T, roots ...string) map[string]searchFileSnapshot {
	t.Helper()
	files := map[string]searchFileSnapshot{}
	for _, root := range roots {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			var data []byte
			if !entry.IsDir() {
				data, err = os.ReadFile(path)
				if err != nil {
					return err
				}
			}
			files[path] = searchFileSnapshot{string(data), info.Mode(), info.ModTime().UnixNano()}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return files
}

func TestSearchHasNoSideEffects(t *testing.T) {
	w := workspace(t)
	draft := edit(t, w, "# Draft\nmemory-token")
	path, doc := openFile(t, w, "original.md", "# Original\nmemory-token")
	if err := w.SavePosition(doc.ID, Position{Head: 5, Scroll: 27}); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	w.docs[draft.ID].Excerpt = ""
	w.notices = []localeMessage{{Key: "bCorruptDrafts", Args: map[string]any{"count": 2}}, {Text: "keep notice"}}
	w.quarantineDir = "keep quarantine"
	w.mu.Unlock()
	if err := os.WriteFile(path, []byte("external-token longer disk text"), 0600); err != nil {
		t.Fatal(err)
	}
	beforeState := searchStateBytes(t, w)
	beforeFiles := searchFiles(t, w.root, filepath.Dir(path))
	for _, locale := range []string{"zh-Hans", "en", ""} {
		for _, query := range []string{"memory-token", "external-token", "Original", "", "absent", "x\ny"} {
			got, err := w.Search(query, locale)
			if query == "x\ny" {
				if err == nil {
					t.Fatal("line break query must fail")
				}
				continue
			}
			if err != nil {
				t.Fatal(err)
			}
			if query == "memory-token" && got.Total != 2 || query == "external-token" && got.Total != 0 {
				t.Fatal("search did not use accepted in-memory working copies")
			}
		}
	}
	if after := searchStateBytes(t, w); !bytes.Equal(beforeState, after) {
		t.Fatalf("search mutated state\nbefore=%s\nafter=%s", beforeState, after)
	}
	if after := searchFiles(t, w.root, filepath.Dir(path)); !reflect.DeepEqual(beforeFiles, after) {
		t.Fatal("search changed file/draft/index/position bytes or metadata")
	}
	// A registered copy stays searchable even when its original disappears.
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	beforeState = searchStateBytes(t, w)
	if got := searchResult(t, w, "memory-token", "en"); got.Total != 2 {
		t.Fatal("search tried to stat/read a missing original")
	}
	if !bytes.Equal(beforeState, searchStateBytes(t, w)) {
		t.Fatal("search changed status after original removal")
	}
}

func TestSearchLocalizedTitles(t *testing.T) {
	w := searchMemoryWorkspace(
		Document{ID: "generated", Title: "未命名文稿", Content: "```\ncode only\n```"},
		Document{ID: "recovery", Title: "中😀.md · 恢复副本", GeneratedTitleSuffix: "recovery", Content: "body"},
		Document{ID: "disk", Title: "中😀.md · 磁盘版本", GeneratedTitleSuffix: "diskVersion", Content: "body"},
		Document{ID: "custom", Title: "未命名文稿", CustomTitle: true},
		Document{ID: "inferred", Title: "未命名文稿", Content: "# 未命名文稿\n正文"},
	)
	before := searchStateBytes(t, w)
	globalLocale := i18n.Locale()
	for _, tc := range []struct {
		locale, query, id, title string
	}{
		{"en", "Untitled", "generated", "Untitled Document"},
		{"zh-Hans", "未命名", "generated", "未命名文稿"},
		{"en", "Recovery", "recovery", "中😀.md · Recovery Copy"},
		{"zh-Hans", "恢复", "recovery", "中😀.md · 恢复副本"},
		{"en", "Disk Version", "disk", "中😀.md · Disk Version"},
		{"zh-Hans", "磁盘版本", "disk", "中😀.md · 磁盘版本"},
		{"en", "未命名", "custom", "未命名文稿"},
		{"en", "未命名", "inferred", "未命名文稿"},
		{"", locales.BUntitled(), "generated", locales.BUntitled()},
	} {
		got := searchResult(t, w, tc.query, tc.locale)
		found := false
		for _, item := range got.Items {
			if item.ID != tc.id {
				continue
			}
			found = true
			if item.Title != tc.title || item.TitleMatch == nil {
				t.Fatalf("localized title = %+v, want %q", item, tc.title)
			}
			encoded := utf16.Encode([]rune(item.Title))
			match := string(utf16.Decode(encoded[item.TitleMatch.From:item.TitleMatch.To]))
			if match != tc.query {
				t.Fatalf("range belongs to wrong title language: %q, want %q", match, tc.query)
			}
		}
		if !found {
			t.Fatalf("%s %q: missing %s", tc.locale, tc.query, tc.id)
		}
	}
	if got := searchResult(t, w, "Untitled", "zh-Hans"); got.Total != 0 {
		t.Fatal("title matched before request localization")
	}
	if !bytes.Equal(before, searchStateBytes(t, w)) || globalLocale != i18n.Locale() {
		t.Fatal("request localization mutated document or global language")
	}
}

func TestSearchSnapshotConcurrentUpdates(t *testing.T) {
	w := workspace(t)
	original := edit(t, w, "# Original\nsnapshot-token")
	w.mu.Lock()
	w.docs[original.ID].ImageAliases = map[string]string{"one": "original"}
	w.mu.Unlock()
	taken := make(chan []Document)
	updated := make(chan struct{})
	results := make(chan SearchResponse)
	go func() {
		docs := w.searchSnapshot()
		taken <- docs
		<-updated
		results <- searchDocuments(docs, newSearchMatcher("snapshot-token"), "en")
	}()
	snapshot := <-taken
	if len(snapshot) != 1 || snapshot[0].ImageAliases != nil {
		t.Fatal("snapshot copied shared mutable maps")
	}
	changed, err := w.Update(Edit{ID: original.ID, Revision: original.Revision, Content: "# Changed\nnew-token"})
	if err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	w.docs[original.ID].ImageAliases["one"] = "changed"
	w.mu.Unlock()
	close(updated)
	got := <-results
	if got.Total != 1 || len(got.Items) != 1 {
		t.Fatalf("snapshot observed later content: %+v", got)
	}
	item := got.Items[0]
	if item.Title != original.Title || item.Revision != original.Revision || item.Updated != original.Updated || item.Hits[0].Text != "snapshot-token" {
		t.Fatalf("snapshot retained live Document fields: %+v", item)
	}
	if snapshot[0].Title != original.Title || snapshot[0].Content != original.Content || snapshot[0].Revision != original.Revision {
		t.Fatal("snapshot changed after updating the registered Document")
	}
	if got := searchResult(t, w, "snapshot-token", "en"); got.Total != 0 {
		t.Fatal("a fresh query used stale cached content")
	}

	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(3)
	for _, locale := range []string{"zh-Hans", "en"} {
		go func(locale string) {
			defer wg.Done()
			<-start
			for i := 0; i < 30; i++ {
				got, err := w.Search("token", locale)
				if err != nil || got.Total != 1 || len(got.Items) != 1 {
					t.Errorf("concurrent Search: %+v %v", got, err)
					return
				}
				item := got.Items[0]
				if len(item.Hits) != 1 || item.Hits[0].Text != "token" || item.Revision < changed.Revision {
					t.Errorf("inconsistent snapshot: %+v", item)
					return
				}
			}
		}(locale)
	}
	go func() {
		defer wg.Done()
		<-start
		doc := changed
		for i := 0; i < 30; i++ {
			var err error
			doc, err = w.Update(Edit{ID: doc.ID, Revision: doc.Revision, Content: fmt.Sprintf("# Version %d\nnew-token", i)})
			if err != nil {
				t.Errorf("concurrent Update: %v", err)
				return
			}
			w.mu.Lock()
			w.docs[doc.ID].ImageAliases["one"] = fmt.Sprint(i)
			w.mu.Unlock()
		}
	}()
	close(start)
	wg.Wait()
}

func TestSearchMatcherMatchesRegexp(t *testing.T) {
	texts := []string{
		"", "aaaaa aAaA", "中😀AKſ尾 中😀akS尾",
		"SSſsssSsS KKkＫk", "Σσς µΜμ İiIı ßss",
		`.*[x] \^$()+?{}|`, "e\u0301 éÉ", "中\n尾\r\n中",
	}
	alphabet := []rune("aAsSſkKKΣσςµΜμ中😀.*[x]")
	var mixed strings.Builder
	for i := range 2000 {
		mixed.WriteRune(alphabet[(i*i+7*i+3)%len(alphabet)])
	}
	texts = append(texts, mixed.String())
	queries := []string{"aa", "aAa", "中😀a", "kſ", ".*[x]", "\\", "ss", "é", "e\u0301"}
	for _, a := range alphabet {
		queries = append(queries, string(a))
		for _, b := range alphabet {
			queries = append(queries, string([]rune{a, b}))
		}
	}
	for _, query := range queries {
		matcher := newSearchMatcher(query)
		oracle := regexp.MustCompile("(?i)" + regexp.QuoteMeta(query))
		for _, text := range texts {
			for _, limit := range []int{1, 4} {
				got, want := matcher.findAll(text, limit), oracle.FindAllStringIndex(text, limit)
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("query=%q, limit=%d: got %v, want %v", query, limit, got, want)
				}
			}
		}
	}
}

func TestSearchSingleLineTitleAllocations(t *testing.T) {
	const phrase = "单行正文 English words 和标点。"
	content := strings.Repeat(phrase, (8<<20)/len(phrase))
	w := searchMemoryWorkspace(Document{ID: "long", Title: "单行正文", Content: content})
	result := testing.Benchmark(func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			response, err := w.Search("正文", "en")
			if err != nil || response.Total != 1 || response.Items[0].Title != "单行正文" {
				b.Fatalf("plain-line title changed: %+v, %v", response, err)
			}
		}
	})
	if result.AllocedBytesPerOp() > 1<<20 {
		t.Fatalf("search allocated %d bytes/query for a first-line hit; title inference copied the large working copy", result.AllocedBytesPerOp())
	}
}
