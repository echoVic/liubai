package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"unicode/utf16"
	"unsafe"

	"github.com/egoist/mygo/i18n"
)

func TestWikiSharedFixtures(t *testing.T) {
	var rows []struct {
		Name       string `json:"name"`
		Content    string `json:"content"`
		References []struct {
			Target string `json:"target"`
			Raw    string `json:"raw"`
		} `json:"references"`
	}
	data, err := os.ReadFile("testdata/wiki-links.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		t.Run(row.Name, func(t *testing.T) {
			got := wikiReferences(row.Content)
			if len(got) != len(row.References) {
				t.Fatalf("references = %+v, want %+v", got, row.References)
			}
			previous := 0
			for i, ref := range got {
				want := row.References[i]
				if ref.From < previous || ref.To > len(row.Content) || ref.From >= ref.To ||
					ref.Target != want.Target || row.Content[ref.From:ref.To] != want.Raw {
					t.Fatalf("reference = %+v, want %+v in %q", ref, want, row.Content)
				}
				previous = ref.To
			}
		})
	}
}

func TestWikiNameBoundaries(t *testing.T) {
	for _, name := range []string{"Name", "名字😀", strings.Repeat("😀", 256), "A*B", `A\B`, "A&B"} {
		content := "[[ " + name + " ]]"
		got := wikiReferences(content)
		if len(got) != 1 || got[0] != (wikiReference{Target: name, From: 0, To: len(content)}) {
			t.Fatalf("valid name %q: %+v", name, got)
		}
	}
	for _, name := range []string{"", " ", strings.Repeat("😀", 257), "a\nb", "a\rb", "a\tb", "a\x00b", "a\x7fb", "a\u0085b", "a[b", "a]b", "a|b", string([]byte{0xff})} {
		if got := wikiReferences("[[" + name + "]]"); len(got) != 0 {
			t.Fatalf("invalid name %q: %+v", name, got)
		}
	}
	// Controls remain invalid even when trimming would remove them.
	for _, name := range []string{"\tName", "Name\t", "\nName", "Name\r", "\u0085Name"} {
		if got := wikiReferences("[[" + name + "]]"); len(got) != 0 {
			t.Fatalf("trimmed control %q accepted: %+v", name, got)
		}
	}
}

func wikiResolveResult(t *testing.T, w *Workspace, request WikiResolveRequest, locale string) SearchResponse {
	t.Helper()
	got, err := w.ResolveWikiLink(request, locale)
	if err != nil {
		t.Fatal(err)
	}
	wikiCheckItems(t, got.Items)
	return got
}

func wikiBacklinkResult(t *testing.T, w *Workspace, id, locale string) BacklinkResponse {
	t.Helper()
	got, err := w.Backlinks(id, locale)
	if err != nil {
		t.Fatal(err)
	}
	wikiCheckItems(t, got.Items)
	return got
}

func wikiCheckItems(t *testing.T, items []SearchItem) {
	t.Helper()
	if items == nil {
		t.Fatal("items must not be null")
	}
	for _, item := range items {
		if item.Hits == nil {
			t.Fatal("hits must not be null")
		}
	}
}

func wikiErrorKey(t *testing.T, err error, key string) {
	t.Helper()
	if e, ok := err.(*catalogError); !ok || e.Key != key {
		t.Fatalf("error = %v, want catalog key %q", err, key)
	}
}

func TestWikiResolveExactStoredTitles(t *testing.T) {
	source := Document{ID: "source", Title: "Source", CustomTitle: true, Revision: 7,
		Content: "[[ Target ]] [[target]] [[Absent]] [[K]] [[K]] [[é]] [[e\u0301]]"}
	w := searchMemoryWorkspace(source,
		Document{ID: "one", Title: "Target", CustomTitle: true, Updated: 5, Revision: 3},
		Document{ID: "two", Title: "Target", CustomTitle: true, Updated: 9, Revision: 4},
		Document{ID: "lower", Title: "target", CustomTitle: true},
		Document{ID: "kelvin", Title: "K", CustomTitle: true},
		Document{ID: "composed", Title: "é", CustomTitle: true},
	)
	for _, tc := range []struct {
		name string
		ids  []string
	}{
		{"Target", []string{"two", "one"}}, {" Target ", []string{"two", "one"}},
		{"target", []string{"lower"}}, {"Absent", []string{}}, {"K", []string{}},
		{"K", []string{"kelvin"}}, {"é", []string{"composed"}}, {"e\u0301", []string{}},
	} {
		got := wikiResolveResult(t, w, WikiResolveRequest{source.ID, source.Revision, tc.name}, "en")
		ids := make([]string, 0, len(got.Items))
		for _, item := range got.Items {
			ids = append(ids, item.ID)
			if item.TitleMatch != nil || len(item.Hits) != 0 || item.MoreHits {
				t.Fatalf("resolve candidates contain search matches: %+v", item)
			}
		}
		if !reflect.DeepEqual(ids, tc.ids) || got.Total != len(tc.ids) || got.Truncated {
			t.Fatalf("%q: %+v, want IDs %v", tc.name, got, tc.ids)
		}
	}
}

func TestWikiResolveValidatesSource(t *testing.T) {
	w := searchMemoryWorkspace(
		Document{ID: "source", Title: "Source", CustomTitle: true, Revision: 4, Content: "[[Target]] `[[Code]]`"},
		Document{ID: "target", Title: "Target", CustomTitle: true},
	)
	for _, tc := range []struct {
		request WikiResolveRequest
		key     string
	}{
		{WikiResolveRequest{"missing", 4, "Target"}, "bWikiSourceMissing"},
		{WikiResolveRequest{"source", 3, "Target"}, "bWikiSourceChanged"},
		{WikiResolveRequest{"source", 4, "Other"}, "bWikiSourceChanged"},
		{WikiResolveRequest{"source", 4, "Code"}, "bWikiSourceChanged"},
		{WikiResolveRequest{"source", 4, ""}, "bWikiInvalidName"},
		{WikiResolveRequest{"source", 4, "A|B"}, "bWikiInvalidName"},
		{WikiResolveRequest{"source", 4, "\tTarget"}, "bWikiInvalidName"},
		{WikiResolveRequest{"source", 4, strings.Repeat("😀", 257)}, "bWikiInvalidName"},
		{WikiResolveRequest{"source", 4, string([]byte{0xff})}, "bWikiInvalidName"},
	} {
		got, err := w.ResolveWikiLink(tc.request, "en")
		wikiErrorKey(t, err, tc.key)
		wikiCheckItems(t, got.Items)
		if len(got.Items) != 0 {
			t.Fatal("invalid source returned candidates")
		}
	}
	w.mu.Lock()
	w.docs["source"].Content = "removed without a revision change"
	w.mu.Unlock()
	_, err := w.ResolveWikiLink(WikiResolveRequest{"source", 4, "Target"}, "en")
	wikiErrorKey(t, err, "bWikiSourceChanged")
	w.mu.Lock()
	delete(w.docs, "source")
	w.mu.Unlock()
	_, err = w.ResolveWikiLink(WikiResolveRequest{"source", 4, "Target"}, "en")
	wikiErrorKey(t, err, "bWikiSourceMissing")
}

func TestWikiMeaningfulTitles(t *testing.T) {
	for _, tc := range []struct {
		doc  Document
		want bool
	}{
		{Document{Title: "Untitled Document"}, false},
		{Document{Title: "未命名文稿", Content: "```\ncode\n```"}, false},
		{Document{Title: "Untitled Document", CustomTitle: true}, true},
		{Document{Title: "未命名文稿", Content: "# 未命名文稿\n正文"}, true},
		{Document{Title: "Untitled Document", Path: "/missing/Untitled Document.md"}, true},
		{Document{Title: "Stored", Content: "# Different"}, true},
		{Document{Title: "", CustomTitle: true}, false},
		{Document{Title: "A|B", CustomTitle: true}, false},
		{Document{Title: "A\nB", CustomTitle: true}, false},
		{Document{Title: strings.Repeat("😀", 257), CustomTitle: true}, false},
	} {
		name, ok := wikiTitle(tc.doc)
		if ok != tc.want || ok && name != tc.doc.Title {
			t.Fatalf("wikiTitle(%+v) = %q, %v; want %v", tc.doc, name, ok, tc.want)
		}
	}
	w := searchMemoryWorkspace(
		Document{ID: "source", Title: "Source", CustomTitle: true, Content: "[[Untitled Document]]"},
		Document{ID: "generated", Title: "Untitled Document"},
		Document{ID: "explicit", Title: "Untitled Document", CustomTitle: true},
	)
	for _, locale := range []string{"en", "zh-Hans", ""} {
		got := wikiResolveResult(t, w, WikiResolveRequest{"source", 0, "Untitled Document"}, locale)
		if got.Total != 1 || got.Items[0].ID != "explicit" {
			t.Fatalf("generated title was treated as an identity: %+v", got)
		}
	}
}

func TestWikiResolveCandidateLimit(t *testing.T) {
	docs := []Document{{ID: "source", Title: "Source", CustomTitle: true, Content: "[[Target]]"}}
	for i := 104; i >= 0; i-- {
		docs = append(docs, Document{ID: fmt.Sprintf("id-%03d", i), Title: "Target", CustomTitle: true, Updated: 5, Revision: i})
	}
	docs = append(docs, Document{ID: "newest", Title: "Target", CustomTitle: true, Updated: 6})
	got := wikiResolveResult(t, searchMemoryWorkspace(docs...), WikiResolveRequest{"source", 0, "Target"}, "en")
	if got.Total != 106 || len(got.Items) != 100 || !got.Truncated || got.Items[0].ID != "newest" {
		t.Fatalf("candidate limit/order = %+v", got)
	}
	for i, item := range got.Items[1:] {
		if item.ID != fmt.Sprintf("id-%03d", i) || item.Revision != i {
			t.Fatalf("unstable candidate order: %+v", item)
		}
	}
}

func TestBacklinkStatusesAndExactIdentity(t *testing.T) {
	w := searchMemoryWorkspace(
		Document{ID: "target", Title: "Target", CustomTitle: true, Revision: 9, Content: "[[Target]]"},
		Document{ID: "source", Title: "Source", CustomTitle: true, Content: "[[Target]] [[target]] `[[Target]]`"},
		Document{ID: "lower", Title: "target", CustomTitle: true, Content: "[[target]]"},
		Document{ID: "unnamed", Title: "Untitled Document"},
	)
	got := wikiBacklinkResult(t, w, "target", "en")
	if got.DocumentID != "target" || got.Revision != 9 || got.Status != BacklinkReady || got.Total != 1 || got.Items[0].ID != "source" || len(got.Items[0].Hits) != 1 {
		t.Fatalf("unique backlinks = %+v", got)
	}
	lower := wikiBacklinkResult(t, w, "lower", "en")
	if lower.Total != 1 || lower.Items[0].ID != "source" || lower.Items[0].Hits[0].Text != "[[target]]" {
		t.Fatalf("case-sensitive backlinks = %+v", lower)
	}
	unnamed := wikiBacklinkResult(t, w, "unnamed", "en")
	if unnamed.Status != BacklinkUnnamed || unnamed.Total != 0 || len(unnamed.Items) != 0 || unnamed.Truncated {
		t.Fatalf("unnamed = %+v", unnamed)
	}
	w.mu.Lock()
	w.docs["duplicate"] = &Document{ID: "duplicate", Title: "Target", CustomTitle: true}
	w.mu.Unlock()
	ambiguous := wikiBacklinkResult(t, w, "target", "en")
	if ambiguous.Status != BacklinkAmbiguous || ambiguous.Total != 0 || len(ambiguous.Items) != 0 || ambiguous.Truncated {
		t.Fatalf("ambiguity not global: %+v", ambiguous)
	}
	missing, err := w.Backlinks("absent", "en")
	wikiErrorKey(t, err, "bDocumentMissing")
	wikiCheckItems(t, missing.Items)
}

func TestBacklinkLimitsAndOriginalCoordinates(t *testing.T) {
	content := "---\r\nprivate: [[Target]]\r\n---\r\n😀[[ Target ]]\n[[Target]] [[Target]]\n[[Target]]"
	docs := []Document{{ID: "target", Title: "Target", CustomTitle: true}}
	for i := 104; i >= 0; i-- {
		docs = append(docs, Document{ID: fmt.Sprintf("id-%03d", i), Title: "Source", CustomTitle: true, Content: content, Updated: 5, Revision: i})
	}
	got := wikiBacklinkResult(t, searchMemoryWorkspace(docs...), "target", "en")
	if got.Total != 105 || len(got.Items) != 100 || !got.Truncated || got.Status != BacklinkReady {
		t.Fatalf("backlink limits = %+v", got)
	}
	encoded := utf16.Encode([]rune(content))
	for i, item := range got.Items {
		if item.ID != fmt.Sprintf("id-%03d", i) || item.Revision != i || len(item.Hits) != 3 || !item.MoreHits || item.TitleMatch != nil {
			t.Fatalf("source ordering/hit cap = %+v", item)
		}
		for j, hit := range item.Hits {
			if string(utf16.Decode(encoded[hit.From:hit.To])) != hit.Text || hit.Line != []int{4, 5, 5}[j] {
				t.Fatalf("not original-source coordinates: %+v", hit)
			}
		}
		if item.Hits[0].From != searchUTF16Len(content[:strings.Index(content, "[[ Target ]]")]) || item.Hits[0].Before != "😀" {
			t.Fatalf("frontmatter/emoji offset lost: %+v", item.Hits[0])
		}
	}
	for _, n := range []int{1, 2, 3, 4, 8} {
		body := strings.Repeat("[[Target]]\n", n-1) + "😀[[Target]]"
		w := searchMemoryWorkspace(docs[0], Document{ID: "source", Title: "Source", CustomTitle: true, Content: body})
		item := wikiBacklinkResult(t, w, "target", "en").Items[0]
		if len(item.Hits) != min(n, 3) || item.MoreHits != (n > 3) {
			t.Fatalf("%d hits = %+v", n, item)
		}
		if n <= 3 && item.Hits[n-1].To != searchUTF16Len(body) {
			t.Fatal("end-of-document range is incorrect")
		}
	}
	exact := wikiBacklinkResult(t, searchMemoryWorkspace(docs[:101]...), "target", "en")
	if exact.Total != 100 || exact.Truncated {
		t.Fatal("exact cap must not truncate")
	}
}

func TestBacklinkCloneAndLocalizedDisplay(t *testing.T) {
	body := strings.Repeat("x", 4000) + " [[Target]]"
	title := "中😀.md · 恢复副本"
	w := searchMemoryWorkspace(
		Document{ID: "target", Title: "Target", CustomTitle: true},
		Document{ID: "source", Title: title, GeneratedTitleSuffix: "recovery", Content: body},
	)
	before, global := searchStateBytes(t, w), i18n.Locale()
	for _, locale := range []string{"en", "zh-Hans", ""} {
		item := wikiBacklinkResult(t, w, "target", locale).Items[0]
		actualLocale := locale
		if actualLocale == "" {
			actualLocale = global
		}
		wantTitle := documentIn(Document{Title: title, GeneratedTitleSuffix: "recovery", Content: body}, actualLocale).Title
		if item.Title != wantTitle {
			t.Fatalf("display title = %q, want %q", item.Title, wantTitle)
		}
		start := uintptr(unsafe.Pointer(unsafe.StringData(body)))
		end := start + uintptr(len(body))
		for _, value := range []string{item.ID, item.Title, item.Path, item.Hits[0].Text, item.Hits[0].Before, item.Hits[0].After} {
			ptr := uintptr(unsafe.Pointer(unsafe.StringData(value)))
			if ptr >= start && ptr < end {
				t.Fatal("returned string retains source content")
			}
		}
	}
	if !bytes.Equal(before, searchStateBytes(t, w)) || global != i18n.Locale() {
		t.Fatal("localization mutated stored title or global locale")
	}
}

func TestWikiRegisteredScopeRestartAndReadOnly(t *testing.T) {
	w := workspace(t)
	target := edit(t, w, "# Target\n[[Target]]")
	if _, err := w.New(); err != nil {
		t.Fatal(err)
	}
	source := edit(t, w, "# Source\n[[Target]]")
	path, disk := openFile(t, w, "source.md", "# File\n[[Target]]")
	if _, err := w.New(); err != nil {
		t.Fatal(err)
	}
	deleted := edit(t, w, "# Deleted\n[[Target]]")
	if _, err := w.Delete(deleted.ID); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(w.root, "unregistered.md"), []byte("[[Target]]"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(w.root, "drafts", strings.Repeat("ab", 12)+".json"), []byte("[[Target]]"), 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.quarantineDir == "" {
		t.Fatal("corrupt fixture was not quarantined")
	}
	if err := os.WriteFile(path, []byte("# External\n[[Other]]"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, current := range []*Workspace{w, reopened} {
		current.mu.Lock()
		current.notices = []localeMessage{{Text: "preserve notice"}}
		current.docs[source.ID].Excerpt = ""
		current.mu.Unlock()
		before := searchStateBytes(t, current)
		files := searchFiles(t, current.root, filepath.Dir(path))
		global := i18n.Locale()
		for _, locale := range []string{"en", "zh-Hans", ""} {
			got := wikiBacklinkResult(t, current, target.ID, locale)
			if got.Total != 2 {
				t.Fatalf("unregistered/trash/quarantine/self in scope: %+v", got)
			}
			for _, item := range got.Items {
				if item.ID != source.ID && item.ID != disk.ID {
					t.Fatalf("unexpected registered source: %+v", item)
				}
			}
			resolved := wikiResolveResult(t, current, WikiResolveRequest{disk.ID, disk.Revision, "Target"}, locale)
			if resolved.Total != 1 || resolved.Items[0].ID != target.ID {
				t.Fatalf("resolve read changed disk content: %+v", resolved)
			}
			_, err := current.ResolveWikiLink(WikiResolveRequest{source.ID, source.Revision - 1, "Target"}, locale)
			wikiErrorKey(t, err, "bWikiSourceChanged")
			_, err = current.Backlinks("absent", locale)
			wikiErrorKey(t, err, "bDocumentMissing")
		}
		if !bytes.Equal(before, searchStateBytes(t, current)) || global != i18n.Locale() ||
			!reflect.DeepEqual(files, searchFiles(t, current.root, filepath.Dir(path))) {
			t.Fatal("wiki query changed state, notices, locale, file bytes, or metadata")
		}
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if got := wikiBacklinkResult(t, reopened, target.ID, "en"); got.Total != 2 {
		t.Fatal("backlinks read a missing original file")
	}
	if _, err := reopened.Delete(source.ID); err != nil {
		t.Fatal(err)
	}
	if got := wikiBacklinkResult(t, reopened, target.ID, "en"); got.Total != 1 || got.Items[0].ID != disk.ID {
		t.Fatalf("removed source retained: %+v", got)
	}
}

func TestWikiSnapshotStableAndConcurrent(t *testing.T) {
	w := searchMemoryWorkspace(
		Document{ID: "target", Title: "Target", CustomTitle: true, Revision: 2},
		Document{ID: "source", Title: "Source", CustomTitle: true, Revision: 3, Content: "[[Target]]", Updated: 4},
	)
	taken, proceed := make(chan struct{}), make(chan struct{})
	result := make(chan BacklinkResponse)
	go func() {
		docs := w.searchSnapshot()
		close(taken)
		<-proceed
		got, err := wikiBacklinkDocuments(docs, "target", "en")
		if err != nil {
			t.Error(err)
		}
		resolved, err := wikiResolveDocuments(docs, WikiResolveRequest{"source", 3, "Target"}, "en")
		if err != nil || resolved.Total != 1 || resolved.Items[0].Revision != 2 {
			t.Errorf("resolve snapshot changed: %+v %v", resolved, err)
		}
		result <- got
	}()
	<-taken
	w.mu.Lock()
	w.docs["source"].Content = "removed"
	w.docs["source"].Revision = 4
	w.docs["target"].Title = "Changed"
	w.mu.Unlock()
	close(proceed)
	got := <-result
	if got.Revision != 2 || got.Total != 1 || got.Items[0].Revision != 3 || got.Items[0].Updated != 4 || got.Items[0].Hits[0].Text != "[[Target]]" {
		t.Fatalf("captured snapshot observed later changes: %+v", got)
	}
	w.mu.Lock()
	w.docs["target"].Title = "Target"
	w.docs["source"].Content = "[[Target]]"
	w.mu.Unlock()
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, locale := range []string{"en", "zh-Hans"} {
		wg.Add(1)
		go func(locale string) {
			defer wg.Done()
			<-start
			for range 30 {
				got, err := w.Backlinks("target", locale)
				if err != nil || got.Total != 1 || got.Items[0].Hits[0].Text != "[[Target]]" {
					t.Errorf("concurrent backlinks: %+v %v", got, err)
					return
				}
			}
		}(locale)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-start
		for range 30 {
			w.mu.Lock()
			w.docs["source"].Revision++
			w.docs["source"].Content = "😀[[Target]]"
			w.mu.Unlock()
		}
	}()
	close(start)
	wg.Wait()
}

func TestWikiEmptyJSONArrays(t *testing.T) {
	w := searchMemoryWorkspace(Document{ID: "target", Title: "Target", CustomTitle: true},
		Document{ID: "source", Content: "[[Missing]]"})
	for _, value := range []any{
		wikiResolveResult(t, w, WikiResolveRequest{"source", 0, "Missing"}, "en"),
		wikiBacklinkResult(t, w, "target", "en"),
		wikiBacklinkResult(t, w, "source", "en"),
	} {
		data, err := json.Marshal(value)
		if err != nil || !bytes.Contains(data, []byte(`"items":[]`)) || bytes.Contains(data, []byte(`"content"`)) {
			t.Fatalf("empty DTO = %s, %v", data, err)
		}
	}
	data, err := json.Marshal(WikiResolveRequest{"source", 2, "Target"})
	if err != nil || string(data) != `{"sourceID":"source","revision":2,"target":"Target"}` {
		t.Fatalf("request JSON = %s, %v", data, err)
	}
}
