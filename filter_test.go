package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"unicode/utf16"
	"unicode/utf8"
	"unsafe"

	"liubai/locales"

	"github.com/egoist/mygo/i18n"
)

func TestDocumentFilterIntersection(t *testing.T) {
	work := "---\ntags: [work]\n---\nA needle in the work note."
	w := searchMemoryWorkspace(
		Document{ID: "work-note", Title: "Work note", CustomTitle: true, Content: work, Updated: 2, Revision: 3},
		Document{ID: "home-note", Title: "Home note", CustomTitle: true, Content: "---\ntags: [home]\n---\nA needle in the home note.", Updated: 1},
	)
	got, err := w.FilterDocuments(DocumentFilterRequest{Query: "needle", Tag: "work"}, "en")
	if err != nil {
		t.Fatal(err)
	}
	if got.Total != 1 || len(got.Items) != 1 || got.Truncated {
		t.Fatalf("only the document with both the tag and the query may match: %+v", got)
	}
	item := got.Items[0]
	from := len(work[:strings.Index(work, "needle")])
	if item.Document.ID != "work-note" || item.Document.Revision != 3 || !reflect.DeepEqual(item.Tags, []string{"work"}) || item.Excerpt != "" {
		t.Fatalf("intersection item = %+v", item)
	}
	if len(item.Document.Hits) != 1 || item.Document.Hits[0] != (SearchHit{From: from, To: from + 6, Line: 4, Text: "needle", Before: "A ", After: " in the work note."}) {
		t.Fatalf("keyword hit = %+v", item.Document.Hits)
	}
	if !reflect.DeepEqual(got.Tags, []TagSummary{{"home", 1}, {"work", 1}}) || len(got.Recent) != 0 || got.Recent == nil {
		t.Fatalf("catalog = %+v, recent = %#v", got.Tags, got.Recent)
	}

	ids := func(request DocumentFilterRequest) []string {
		t.Helper()
		got, err := w.FilterDocuments(request, "en")
		if err != nil {
			t.Fatal(err)
		}
		if got.Items == nil || got.Total != len(got.Items) {
			t.Fatalf("%+v: items=%#v total=%d", request, got.Items, got.Total)
		}
		ids := []string{}
		for _, item := range got.Items {
			ids = append(ids, item.Document.ID)
		}
		return ids
	}
	for _, tc := range []struct {
		request DocumentFilterRequest
		want    []string
	}{
		{DocumentFilterRequest{Query: "needle", Tag: "home"}, []string{"home-note"}},
		{DocumentFilterRequest{Query: "absent", Tag: "work"}, []string{}},
		{DocumentFilterRequest{Query: "needle", Tag: "absent"}, []string{}},
		{DocumentFilterRequest{Query: "needle", Tag: "Work"}, []string{}},
		{DocumentFilterRequest{Query: "needle"}, []string{"work-note", "home-note"}},
		{DocumentFilterRequest{Tag: "work"}, []string{"work-note"}},
	} {
		if got := ids(tc.request); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%+v matched %v, want %v", tc.request, got, tc.want)
		}
	}

	tagOnly, err := w.FilterDocuments(DocumentFilterRequest{Tag: "work"}, "en")
	if err != nil {
		t.Fatal(err)
	}
	if only := tagOnly.Items[0]; only.Excerpt != "A needle in the work note." || only.Document.Hits == nil || len(only.Document.Hits) != 0 || only.Document.TitleMatch != nil || only.Document.MoreHits {
		t.Fatalf("a tag without a query has no hits but shows the excerpt: %+v", only)
	}
}

func TestDocumentFilterCachedExcerpt(t *testing.T) {
	w := searchMemoryWorkspace(Document{ID: "cache", Title: "Cache", Content: "---\ntags: [缓存]\n---\nbody", Excerpt: strings.Repeat("😀", 91)})
	for _, tag := range []string{"缓存", ""} {
		got, err := w.FilterDocuments(DocumentFilterRequest{Tag: tag}, "en")
		if err != nil {
			t.Fatal(err)
		}
		excerpt := ""
		if tag == "" {
			excerpt = got.Recent[0].Excerpt
		} else {
			excerpt = got.Items[0].Excerpt
		}
		if excerpt != strings.Repeat("😀", 90) {
			t.Fatalf("cached excerpt returned %d runes, want 90", len([]rune(excerpt)))
		}
	}
}

// docFilterCall runs FilterDocuments and checks what the front end relies on:
// every array is a nonnil JSON array and recent is newest first, with the ID
// ascending on ties.
func docFilterCall(t *testing.T, w *Workspace, request DocumentFilterRequest, locale string) DocumentFilterResponse {
	t.Helper()
	got, err := w.FilterDocuments(request, locale)
	if err != nil {
		t.Fatalf("%+v: %v", request, err)
	}
	docFilterShape(t, got)
	return got
}

func docFilterShape(t *testing.T, got DocumentFilterResponse) {
	t.Helper()
	if got.Items == nil || got.Tags == nil || got.Recent == nil {
		t.Fatalf("response arrays must be nonnil JSON arrays: %#v", got)
	}
	for _, item := range got.Items {
		if item.Tags == nil || item.Document.Hits == nil {
			t.Fatalf("item arrays must be nonnil JSON arrays: %#v", item)
		}
	}
	for i, summary := range got.Recent {
		if summary.Tags == nil {
			t.Fatalf("recent[%d].Tags must be a nonnil array: %#v", i, summary)
		}
		if i == 0 {
			continue
		}
		if prev := got.Recent[i-1]; prev.Updated < summary.Updated || prev.Updated == summary.Updated && prev.ID >= summary.ID {
			t.Fatalf("recent must be Updated desc with ascending IDs on ties: %q before %q", prev.ID, summary.ID)
		}
	}
}

func docFilterIDs(got DocumentFilterResponse) []string {
	ids := []string{}
	for _, item := range got.Items {
		ids = append(ids, item.Document.ID)
	}
	return ids
}

func docFilterRecentIDs(got DocumentFilterResponse) []string {
	ids := []string{}
	for _, summary := range got.Recent {
		ids = append(ids, summary.ID)
	}
	return ids
}

func docFilterErrorKey(err error) string {
	if e, ok := err.(*catalogError); ok {
		return e.Key
	}
	return ""
}

func docFilterJSON(t *testing.T, value any) string {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestDocumentFilterMetadataCatalog(t *testing.T) {
	front := func(yaml string) string { return "---\n" + yaml + "\n---\nbody" }
	var many []string
	for i := 0; i < 33; i++ {
		many = append(many, fmt.Sprintf("m%02d", i))
	}
	// Documents with invalid tag metadata have no tags at all, not only no bad ones.
	cases := []struct {
		id, content string
		want        []string
	}{
		{"scalar", front("tags: work"), []string{"work"}},
		{"quoted-number", front(`tags: "5"`), []string{"5"}},
		{"comma-scalar", front("tags: work, home"), []string{"work, home"}},
		{"flow-list", front("tags: [work, home]"), []string{"work", "home"}},
		{"block-list", front("tags:\n  - work\n  - 家庭\n  - 😀"), []string{"work", "家庭", "😀"}},
		{"hash-prefix", front(`tags: ["#work", "##work", " work ", "#  spaced", "", "#"]`), []string{"work", "#work", "spaced"}},
		{"case", front("tags: [Work, work, WORK]"), []string{"Work", "work", "WORK"}},
		{"duplicates", front(`tags: [dup, "#dup", dup, " dup"]`), []string{"dup"}},
		{"max-length", front(`tags: ["` + strings.Repeat("长", 80) + `"]`), []string{strings.Repeat("长", 80)}},
		{"max-count", front("tags: [" + strings.Join(many[:32], ", ") + "]"), many[:32]},
		{"null", front("tags:"), nil},
		{"tilde", front("tags: ~"), nil},
		{"comment", front("tags: # work"), nil},
		{"empty-scalar", front(`tags: ""`), nil},
		{"missing-key", front("title: Only a title"), nil},
		{"number", front("tags: 5"), nil},
		{"number-in-list", front("tags: [good, 5]"), nil},
		{"mapping", front("tags: {good: yes}"), nil},
		{"nested-list", front("tags: [[good], other]"), nil},
		{"control-character", front(`tags: [good, "bad\u0001tag"]`), nil},
		{"too-long", front(`tags: [good, "` + strings.Repeat("长", 81) + `"]`), nil},
		{"too-many", front("tags: [" + strings.Join(many, ", ") + "]"), nil},
		{"broken-yaml", front("tags: [good"), nil},
		{"invalid-utf8", "---\ntags: [good, \xff]\n---\nbody", nil},
		{"no-front-matter", "tags: [good]\nbody", nil},
		{"tags-in-body", "body\n---\ntags: [good]\n---\n", nil},
	}
	var docs []Document
	counts := map[string]int{}
	for i, tc := range cases {
		docs = append(docs, Document{ID: tc.id, Title: tc.id, CustomTitle: true, Content: tc.content, Updated: int64(len(cases) - i)})
		for _, name := range tc.want {
			counts[name]++
		}
	}
	w := searchMemoryWorkspace(docs...)
	catalog := []TagSummary{}
	for name, count := range counts {
		catalog = append(catalog, TagSummary{name, count})
	}
	sort.Slice(catalog, func(i, j int) bool { return catalog[i].Name < catalog[j].Name })

	t.Run("metadata variants", func(t *testing.T) {
		got := docFilterCall(t, w, DocumentFilterRequest{}, "en")
		if len(got.Recent) != len(cases) || len(got.Items) != 0 || got.Total != 0 || got.Truncated {
			t.Fatalf("catalog request returned %d recent, %d items, total %d", len(got.Recent), len(got.Items), got.Total)
		}
		for i, tc := range cases {
			want := tc.want
			if want == nil {
				want = []string{}
			}
			if got.Recent[i].ID != tc.id || !reflect.DeepEqual(got.Recent[i].Tags, want) {
				t.Errorf("%s: tags = %#v, want %#v", tc.id, got.Recent[i].Tags, want)
			}
		}
		if !reflect.DeepEqual(got.Tags, catalog) {
			t.Fatalf("catalog = %v\nwant      %v", got.Tags, catalog)
		}
		for name, want := range map[string]int{"work": 5, "home": 1, "work, home": 1, "Work": 1, "WORK": 1, "#work": 1, "dup": 1, "5": 1, "家庭": 1, "😀": 1, "good": 0} {
			n := 0
			for _, tag := range got.Tags {
				if tag.Name == name {
					n = tag.Count
				}
			}
			if n != want {
				t.Errorf("count of %q = %d, want %d", name, n, want)
			}
		}
	})

	t.Run("every tag selects exactly its documents", func(t *testing.T) {
		for name := range counts {
			var want []string
			for _, tc := range cases {
				if slices.Contains(tc.want, name) {
					want = append(want, tc.id)
				}
			}
			got := docFilterCall(t, w, DocumentFilterRequest{Tag: name}, "en")
			if got.Total != len(want) || !reflect.DeepEqual(docFilterIDs(got), want) {
				t.Errorf("tag %q selected %v, want %v", name, docFilterIDs(got), want)
			}
		}
	})

	t.Run("exact match keeps case and hash", func(t *testing.T) {
		work := []string{"scalar", "flow-list", "block-list", "hash-prefix", "case"}
		for _, tc := range []struct {
			tag  string
			want []string
		}{
			{"work", work},
			{"Work", []string{"case"}},
			{"WORK", []string{"case"}},
			{"wORK", []string{}},
			{"#work", []string{"hash-prefix"}},
			{"##work", []string{}},
			{"home", []string{"flow-list"}},
			{"work, home", []string{"comma-scalar"}},
			{"good", []string{}},
			// Only the ends are trimmed, with Unicode spaces included.
			{"  work\u3000", work},
			{" \twork\n ", work},
		} {
			got := docFilterCall(t, w, DocumentFilterRequest{Tag: tc.tag}, "en")
			if got.Total != len(tc.want) || !reflect.DeepEqual(docFilterIDs(got), tc.want) {
				t.Errorf("tag %q selected %v, want %v", tc.tag, docFilterIDs(got), tc.want)
			}
		}
	})

	t.Run("catalog ignores the request", func(t *testing.T) {
		for _, request := range []DocumentFilterRequest{
			{Query: "body"}, {Tag: "work"}, {Query: "body", Tag: "dup"},
			{Query: "absent"}, {Tag: "absent"}, {Query: "absent", Tag: "work"},
		} {
			if got := docFilterCall(t, w, request, "en"); !reflect.DeepEqual(got.Tags, catalog) {
				t.Errorf("%+v changed the catalog: %v", request, got.Tags)
			}
		}
	})

	t.Run("invalid tags", func(t *testing.T) {
		for _, tag := range []string{"a\tb", "a\nb", "a\x00b", "a\u007fb", "a\u0085b", "\xff", "a\xffb", " \xff ", strings.Repeat("长", 81), strings.Repeat("😀", 81)} {
			got, err := w.FilterDocuments(DocumentFilterRequest{Query: "body", Tag: tag}, "en")
			if docFilterErrorKey(err) != "bFilterInvalidTag" {
				t.Errorf("tag %q: error = %v", tag, err)
				continue
			}
			docFilterShape(t, got)
			if len(got.Items)+len(got.Tags)+len(got.Recent)+got.Total != 0 || got.Truncated {
				t.Errorf("tag %q: an error must come with an empty response, got %+v", tag, got)
			}
			if errorIn(err, "en") != locales.In("en").BFilterInvalidTag() || errorIn(err, "zh-Hans") != locales.In("zh-Hans").BFilterInvalidTag() {
				t.Errorf("tag %q: error is not localized from the catalog", tag)
			}
		}
		if en, zh := locales.In("en").BFilterInvalidTag(), locales.In("zh-Hans").BFilterInvalidTag(); en == "" || zh == "" || en == zh {
			t.Errorf("catalog texts = %q, %q", en, zh)
		}
		// 80 runes is the limit and only the ends are trimmed; an all-space tag means no tag.
		for _, tag := range []string{strings.Repeat("😀", 80), "a b", "# x", "\u3000 \u3000"} {
			if _, err := w.FilterDocuments(DocumentFilterRequest{Tag: tag}, "en"); err != nil {
				t.Errorf("tag %q rejected: %v", tag, err)
			}
		}
	})

	t.Run("query validation is Search's", func(t *testing.T) {
		for _, tc := range []struct{ query, key string }{
			{string([]byte{0xff}), "bSearchInvalidQuery"},
			{" \xff ", "bSearchInvalidQuery"},
			{strings.Repeat("😀", 129), "bSearchQueryTooLong"},
			{"a\nb", "bSearchQueryLineBreak"},
			{"a\rb", "bSearchQueryLineBreak"},
			{"a\r\nb", "bSearchQueryLineBreak"},
		} {
			_, searchErr := w.Search(tc.query, "en")
			if docFilterErrorKey(searchErr) != tc.key {
				t.Fatalf("Search(%q) error = %v, want key %s", tc.query, searchErr, tc.key)
			}
			// The query is validated before the tag, whatever the tag is.
			for _, tag := range []string{"", "work", "a\tb"} {
				got, err := w.FilterDocuments(DocumentFilterRequest{Query: tc.query, Tag: tag}, "en")
				if docFilterErrorKey(err) != tc.key {
					t.Errorf("query %q tag %q: error = %v, want key %s", tc.query, tag, err, tc.key)
				}
				docFilterShape(t, got)
				if len(got.Items)+len(got.Tags)+len(got.Recent) != 0 {
					t.Errorf("query %q tag %q: an error must come with an empty response", tc.query, tag)
				}
			}
		}
		maxQuery := strings.Repeat("😀", 128)
		if _, err := w.FilterDocuments(DocumentFilterRequest{Query: " \n" + maxQuery + "\t "}, "en"); err != nil {
			t.Errorf("128 runes after trimming must be accepted: %v", err)
		}
		blank := docFilterCall(t, w, DocumentFilterRequest{Query: " \t\r\n\u3000 ", Tag: " \t\u3000"}, "en")
		if !reflect.DeepEqual(blank, docFilterCall(t, w, DocumentFilterRequest{}, "en")) {
			t.Error("a blank query and tag must behave like an empty request")
		}
	})

	t.Run("wire format", func(t *testing.T) {
		var request DocumentFilterRequest
		if err := json.Unmarshal([]byte(`{"query":"needle","tag":"work"}`), &request); err != nil || request != (DocumentFilterRequest{Query: "needle", Tag: "work"}) {
			t.Fatalf("request = %+v, %v", request, err)
		}
		const empty = `{"items":[],"total":0,"truncated":false,"tags":[],"recent":[]}`
		none := searchMemoryWorkspace()
		for _, request := range []DocumentFilterRequest{{}, {Tag: "x"}, {Query: "x"}, {Query: "x", Tag: "y"}} {
			if got := docFilterJSON(t, docFilterCall(t, none, request, "en")); got != empty {
				t.Errorf("%+v on no documents = %s", request, got)
			}
		}
		if got, err := none.FilterDocuments(DocumentFilterRequest{Tag: "a\tb"}, "en"); err == nil || docFilterJSON(t, got) != empty {
			t.Errorf("an error must come with %s, got %s, %v", empty, docFilterJSON(t, got), err)
		}
		one := searchMemoryWorkspace(Document{ID: "a", Title: "A", CustomTitle: true, Content: "---\ntags: [x]\n---\nbody", Updated: 1})
		const catalog = `"tags":[{"name":"x","count":1}]`
		for _, tc := range []struct {
			request DocumentFilterRequest
			want    string
		}{
			{DocumentFilterRequest{}, `{"items":[],"total":0,"truncated":false,` + catalog + `,"recent":[{"id":"a","title":"A","path":"","updated":1,"excerpt":"body","tags":["x"]}]}`},
			{DocumentFilterRequest{Tag: "x"}, `{"items":[{"document":{"id":"a","title":"A","path":"","updated":1,"revision":0,"titleMatch":null,"hits":[],"moreHits":false},"tags":["x"],"excerpt":"body"}],"total":1,"truncated":false,` + catalog + `,"recent":[]}`},
			{DocumentFilterRequest{Query: "body", Tag: "x"}, `{"items":[{"document":{"id":"a","title":"A","path":"","updated":1,"revision":0,"titleMatch":null,"hits":[{"from":18,"to":22,"line":4,"text":"body","before":"","after":""}],"moreHits":false},"tags":["x"],"excerpt":""}],"total":1,"truncated":false,` + catalog + `,"recent":[]}`},
			{DocumentFilterRequest{Query: "absent"}, `{"items":[],"total":0,"truncated":false,` + catalog + `,"recent":[]}`},
		} {
			if got := docFilterJSON(t, docFilterCall(t, one, tc.request, "en")); got != tc.want {
				t.Errorf("%+v:\n got %s\nwant %s", tc.request, got, tc.want)
			}
		}
	})
}

func TestDocumentFilterRegisteredScopeAndLimits(t *testing.T) {
	const workFront = "---\ntags: [work]\n---\n"

	t.Run("recent lists every registered document", func(t *testing.T) {
		var docs []Document
		for i := 34; i >= 0; i-- {
			docs = append(docs, Document{ID: fmt.Sprintf("doc-%02d", i), Title: fmt.Sprintf("Doc %d", i), CustomTitle: true, Content: "plain", Updated: int64(i / 5)})
		}
		w := searchMemoryWorkspace(docs...)
		var want []string
		for updated := 6; updated >= 0; updated-- {
			for i := updated * 5; i < updated*5+5; i++ {
				want = append(want, fmt.Sprintf("doc-%02d", i))
			}
		}
		for i := 0; i < 3; i++ {
			got := docFilterCall(t, w, DocumentFilterRequest{}, "en")
			if len(got.Items) != 0 || got.Total != 0 || got.Truncated || !reflect.DeepEqual(docFilterRecentIDs(got), want) {
				t.Fatalf("recent = %v, want all %d documents newest first", docFilterRecentIDs(got), len(want))
			}
		}
		for _, request := range []DocumentFilterRequest{{Query: "plain"}, {Tag: "work"}, {Query: "plain", Tag: "work"}} {
			if got := docFilterCall(t, w, request, "en"); len(got.Recent) != 0 {
				t.Fatalf("%+v returned recent documents %v", request, docFilterRecentIDs(got))
			}
		}
	})

	t.Run("total, truncation and order", func(t *testing.T) {
		var docs []Document
		for i := 104; i >= 0; i-- {
			docs = append(docs, Document{ID: fmt.Sprintf("id-%03d", i), Title: "same title", CustomTitle: true, Content: workFront + "needle", Updated: 20, Revision: i})
		}
		docs = append(docs,
			Document{ID: "title-old", Title: "needle only", CustomTitle: true, Content: workFront, Updated: 1, Revision: 7},
			Document{ID: "title-new", Title: "needle new", CustomTitle: true, Content: workFront, Updated: 2},
			Document{ID: "body-new", Title: "body", CustomTitle: true, Content: workFront + "needle", Updated: 30},
			Document{ID: "other-tag", Title: "needle", CustomTitle: true, Content: "---\ntags: [home]\n---\nneedle", Updated: 99},
			Document{ID: "untagged", Title: "needle", CustomTitle: true, Content: "needle", Updated: 98},
		)
		w := searchMemoryWorkspace(docs...)
		for i := 0; i < 3; i++ {
			got := docFilterCall(t, w, DocumentFilterRequest{Query: "needle", Tag: "work"}, "en")
			if got.Total != 108 || len(got.Items) != 100 || !got.Truncated {
				t.Fatalf("limits = total:%d items:%d truncated:%v", got.Total, len(got.Items), got.Truncated)
			}
			if ids := docFilterIDs(got); ids[0] != "title-new" || ids[1] != "title-old" || ids[2] != "body-new" {
				t.Fatalf("title matches come first, then newest: %v", ids[:3])
			}
			for j := 3; j < 100; j++ {
				if item := got.Items[j].Document; item.ID != fmt.Sprintf("id-%03d", j-3) || item.Revision != j-3 {
					t.Fatalf("stable ID order or revision lost at %d: %+v", j, item)
				}
			}
			if title := got.Items[1].Document; title.TitleMatch == nil || *title.TitleMatch != (SearchRange{0, 6}) || len(title.Hits) != 0 || title.MoreHits {
				t.Fatalf("title-only result = %+v", title)
			}
			for _, item := range got.Items {
				if item.Excerpt != "" || !reflect.DeepEqual(item.Tags, []string{"work"}) {
					t.Fatalf("a keyword result has no excerpt and its own tags: %+v", item)
				}
			}
		}
		// Without a tag the query alone is Search.
		all := docFilterCall(t, w, DocumentFilterRequest{Query: "needle"}, "en")
		search := searchResult(t, w, "needle", "en")
		if all.Total != 110 || all.Total != search.Total || all.Truncated != search.Truncated || len(all.Items) != len(search.Items) {
			t.Fatalf("query only: total=%d truncated=%v items=%d, Search: %d %v %d", all.Total, all.Truncated, len(all.Items), search.Total, search.Truncated, len(search.Items))
		}
		for i, item := range all.Items {
			if !reflect.DeepEqual(item.Document, search.Items[i]) {
				t.Fatalf("item %d differs from Search:\n%+v\n%+v", i, item.Document, search.Items[i])
			}
		}
		// A tag alone has no title priority: newest first, then the ID.
		only := docFilterCall(t, w, DocumentFilterRequest{Tag: "work"}, "en")
		if only.Total != 108 || len(only.Items) != 100 || !only.Truncated || only.Items[0].Document.ID != "body-new" {
			t.Fatalf("tag only: total=%d items=%d truncated=%v first=%s", only.Total, len(only.Items), only.Truncated, only.Items[0].Document.ID)
		}
		for j := 1; j < 100; j++ {
			item := only.Items[j]
			if item.Document.ID != fmt.Sprintf("id-%03d", j-1) || item.Document.TitleMatch != nil || len(item.Document.Hits) != 0 || item.Document.MoreHits || item.Excerpt != "needle" {
				t.Fatalf("tag only item %d = %+v", j, item)
			}
		}
		for _, n := range []int{100, 101} {
			small := searchMemoryWorkspace(docs[:n]...)
			for _, request := range []DocumentFilterRequest{{Query: "needle", Tag: "work"}, {Tag: "work"}} {
				if got := docFilterCall(t, small, request, "en"); got.Total != n || len(got.Items) != 100 || got.Truncated != (n > 100) {
					t.Fatalf("%d documents, %+v: total=%d items=%d truncated=%v", n, request, got.Total, len(got.Items), got.Truncated)
				}
			}
		}
	})

	t.Run("hit limits", func(t *testing.T) {
		for _, n := range []int{1, 2, 3, 4, 5, 20} {
			w := searchMemoryWorkspace(Document{ID: "hits", Title: "neutral", CustomTitle: true, Content: workFront + strings.Repeat("needle\n", n)})
			item := docFilterCall(t, w, DocumentFilterRequest{Query: "needle", Tag: "work"}, "en").Items[0].Document
			if len(item.Hits) != min(n, 3) || item.MoreHits != (n > 3) {
				t.Fatalf("%d occurrences: %+v", n, item)
			}
			for i, hit := range item.Hits {
				if hit.From != len(workFront)+i*7 || hit.To != hit.From+6 || hit.Line != 4+i {
					t.Fatalf("hits are not the first three in ascending order: %+v", item.Hits)
				}
			}
			if only := docFilterCall(t, w, DocumentFilterRequest{Tag: "work"}, "en").Items[0].Document; len(only.Hits) != 0 || only.MoreHits {
				t.Fatalf("a tag alone has no hits: %+v", only)
			}
		}
	})

	t.Run("long Chinese and emoji documents", func(t *testing.T) {
		head := "---\ntags: [long]\n---\n"
		body := strings.Repeat("中😀", 3000)
		content := head + body + "尾Needle😀 end"
		if len(body) <= 4096 {
			t.Fatalf("fixture body is %d bytes, not beyond the excerpt window", len(body))
		}
		w := searchMemoryWorkspace(Document{ID: "long", Title: "neutral", CustomTitle: true, Content: content})
		got := docFilterCall(t, w, DocumentFilterRequest{Query: "needle", Tag: "long"}, "en")
		if got.Total != 1 || len(got.Items) != 1 {
			t.Fatalf("a match beyond the excerpt window was not found: %+v", got)
		}
		hit := got.Items[0].Document.Hits[0]
		from := len(utf16.Encode([]rune(head + body + "尾")))
		units := utf16.Encode([]rune(content))
		if hit.From != from || hit.To != from+6 || hit.Line != 4 || hit.Text != "Needle" || string(utf16.Decode(units[hit.From:hit.To])) != "Needle" {
			t.Fatalf("hit = %+v, want UTF-16 range [%d,%d)", hit, from, from+6)
		}
		if utf8.RuneCountInString(hit.Before) != 32 || !strings.HasPrefix(hit.Before, "…") || !strings.HasSuffix(hit.Before, "中😀尾") || hit.After != "😀 end" {
			t.Fatalf("context = %q … %q", hit.Before, hit.After)
		}
		item := docFilterCall(t, w, DocumentFilterRequest{Tag: "long"}, "en").Items[0]
		if item.Excerpt != strings.Repeat("中😀", 45) || len(item.Document.Hits) != 0 {
			t.Fatalf("the excerpt is the first 90 runes of the body: %q", item.Excerpt)
		}
		// Neither the excerpt window nor a Unicode case fold may hide a match.
		if got := docFilterCall(t, w, DocumentFilterRequest{Query: "尾needle😀", Tag: "long"}, "en"); got.Total != 1 {
			t.Fatalf("query spanning CJK, ASCII and emoji: %+v", got)
		}
	})

	t.Run("registered documents only", func(t *testing.T) {
		front := func(extra, body string) string { return "---\ntags: [scope" + extra + "]\n---\n" + body }
		w := workspace(t)
		for i := 0; i < 3; i++ {
			if i != 0 {
				if _, err := w.New(); err != nil {
					t.Fatal(err)
				}
			}
			edit(t, w, front("", fmt.Sprintf("# Draft %d\nscope-token", i)))
		}
		_, file := openFile(t, w, "opened.md", front(", file", "scope-token file copy"))
		// Reload keeps an edited working copy as a registered recovery draft.
		w.mu.Lock()
		w.docs[file.ID].Content = front(", recovery", "scope-token recovery copy")
		w.mu.Unlock()
		if _, err := w.Reload(file.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := w.New(); err != nil {
			t.Fatal(err)
		}
		removed := edit(t, w, front(", removed", "scope-token removed"))
		if _, err := w.Delete(removed.ID); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(w.root, "never-opened.md"), []byte(front(", unregistered", "scope-token unregistered")), 0600); err != nil {
			t.Fatal(err)
		}
		corrupt := filepath.Join(w.root, "drafts", strings.Repeat("ab", 12)+".json")
		if err := os.WriteFile(corrupt, []byte(front(", corrupt", "scope-token corrupt JSON")), 0600); err != nil {
			t.Fatal(err)
		}
		reopened, err := openWorkspace(w.root)
		if err != nil {
			t.Fatal(err)
		}
		if reopened.quarantineDir == "" {
			t.Fatal("fixture did not quarantine the corrupt draft")
		}
		wantCatalog := []TagSummary{{"file", 1}, {"recovery", 1}, {"scope", 5}}
		var scoped []string
		for _, current := range []struct {
			name string
			w    *Workspace
		}{{"live", w}, {"restarted", reopened}} {
			current.w.mu.Lock()
			var registered []string
			for id := range current.w.docs {
				registered = append(registered, id)
			}
			current.w.mu.Unlock()
			sort.Strings(registered)

			everything := docFilterCall(t, current.w, DocumentFilterRequest{}, "en")
			recent := docFilterRecentIDs(everything)
			sort.Strings(recent)
			if !reflect.DeepEqual(recent, registered) {
				t.Fatalf("%s: recent = %v, want every registered document %v", current.name, recent, registered)
			}
			if !reflect.DeepEqual(everything.Tags, wantCatalog) {
				t.Fatalf("%s: catalog = %v, want %v", current.name, everything.Tags, wantCatalog)
			}
			got := docFilterCall(t, current.w, DocumentFilterRequest{Tag: "scope"}, "en")
			ids := docFilterIDs(got)
			sort.Strings(ids)
			if got.Total != 5 || len(ids) != 5 {
				t.Fatalf("%s: tag scope matched %v", current.name, ids)
			}
			if scoped == nil {
				scoped = ids
			} else if !reflect.DeepEqual(scoped, ids) {
				t.Fatalf("restart changed the documents: %v then %v", scoped, ids)
			}
			if got := docFilterCall(t, current.w, DocumentFilterRequest{Query: "scope-token"}, "en"); got.Total != 5 {
				t.Fatalf("%s: query matched %d documents, want the 5 registered ones", current.name, got.Total)
			}
			if got := docFilterCall(t, current.w, DocumentFilterRequest{Query: "scope-token", Tag: "recovery"}, "en"); got.Total != 1 {
				t.Fatalf("%s: recovery copy matched %d documents", current.name, got.Total)
			}
			for _, tag := range []string{"removed", "unregistered", "corrupt"} {
				if got := docFilterCall(t, current.w, DocumentFilterRequest{Tag: tag}, "en"); got.Total != 0 {
					t.Fatalf("%s: tag %s of an unregistered document matched %+v", current.name, tag, got.Items)
				}
			}
			for _, query := range []string{"removed", "unregistered", "corrupt"} {
				if got := docFilterCall(t, current.w, DocumentFilterRequest{Query: query}, "en"); got.Total != 0 {
					t.Fatalf("%s: query %s found an unregistered document %+v", current.name, query, got.Items)
				}
			}
		}
	})

	t.Run("excerpts are built for displayed items only", func(t *testing.T) {
		// Stray continuation bytes make excerptOf panic, so a document whose
		// excerpt is built without being displayed cannot go unnoticed.
		poisoned := workFront + strings.Repeat("\x80", 5000)
		var docs []Document
		for i := 0; i < 100; i++ {
			docs = append(docs, Document{ID: fmt.Sprintf("shown-%03d", i), Title: "shown", CustomTitle: true, Content: workFront + "body", Updated: 10})
		}
		for i := 0; i < 5; i++ {
			docs = append(docs, Document{ID: fmt.Sprintf("hidden-%d", i), Title: "hidden", CustomTitle: true, Content: poisoned, Updated: 1})
		}
		w := searchMemoryWorkspace(docs...)
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("an excerpt was built for a document that is not displayed: %v", r)
				}
			}()
			got := docFilterCall(t, w, DocumentFilterRequest{Tag: "work"}, "en")
			if got.Total != 105 || len(got.Items) != 100 || !got.Truncated || got.Items[99].Excerpt != "body" {
				t.Errorf("total=%d items=%d truncated=%v", got.Total, len(got.Items), got.Truncated)
			}
		}()
	})
}

func TestDocumentFilterNoSideEffects(t *testing.T) {
	w := workspace(t)
	draft := edit(t, w, "---\ntags: [work]\n---\n# Draft\nmemory-token")
	path, doc := openFile(t, w, "original.md", "---\ntags: [work, file]\n---\n# Original\nmemory-token")
	if err := w.SavePosition(doc.ID, Position{Head: 5, Scroll: 27}); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	// An empty cached excerpt tempts an implementation to fill it in place.
	w.docs[draft.ID].Excerpt = ""
	w.docs[doc.ID].Excerpt = ""
	w.notices = []localeMessage{{Key: "bCorruptDrafts", Args: map[string]any{"count": 2}}, {Text: "keep notice"}}
	w.quarantineDir = "keep quarantine"
	w.mu.Unlock()
	if err := os.WriteFile(path, []byte("---\ntags: [external]\n---\nexternal-token longer disk text"), 0600); err != nil {
		t.Fatal(err)
	}
	// The accepted working copies answer, never the changed or missing originals.
	catalog := []TagSummary{{"file", 1}, {"work", 2}}
	cases := []struct {
		request       DocumentFilterRequest
		total, recent int
	}{
		{DocumentFilterRequest{}, 0, 2},
		{DocumentFilterRequest{Query: " ", Tag: " "}, 0, 2},
		{DocumentFilterRequest{Tag: "work"}, 2, 0},
		{DocumentFilterRequest{Tag: "file"}, 1, 0},
		{DocumentFilterRequest{Tag: "external"}, 0, 0},
		{DocumentFilterRequest{Tag: "absent"}, 0, 0},
		{DocumentFilterRequest{Query: "memory-token"}, 2, 0},
		{DocumentFilterRequest{Query: "memory-token", Tag: "work"}, 2, 0},
		{DocumentFilterRequest{Query: "memory-token", Tag: "file"}, 1, 0},
		{DocumentFilterRequest{Query: "Original", Tag: "file"}, 1, 0},
		{DocumentFilterRequest{Query: "external-token"}, 0, 0},
		{DocumentFilterRequest{Query: "external-token", Tag: "external"}, 0, 0},
	}
	invalid := []DocumentFilterRequest{{Query: "x\ny"}, {Tag: "a\tb"}, {Query: "\xff"}, {Tag: "\xff"}}
	run := func(label string) {
		t.Helper()
		for _, locale := range []string{"zh-Hans", "en", ""} {
			for _, tc := range cases {
				got := docFilterCall(t, w, tc.request, locale)
				if got.Total != tc.total || len(got.Items) != tc.total || len(got.Recent) != tc.recent || !reflect.DeepEqual(got.Tags, catalog) {
					t.Fatalf("%s, %q, %+v: total=%d items=%d recent=%d tags=%v", label, locale, tc.request, got.Total, len(got.Items), len(got.Recent), got.Tags)
				}
			}
			for _, request := range invalid {
				if _, err := w.FilterDocuments(request, locale); err == nil {
					t.Fatalf("%s, %q: %+v was accepted", label, locale, request)
				}
			}
		}
	}
	beforeState := searchStateBytes(t, w)
	beforeFiles := searchFiles(t, w.root, filepath.Dir(path))
	run("changed original")
	if after := searchStateBytes(t, w); !bytes.Equal(beforeState, after) {
		t.Fatalf("filtering mutated state\nbefore=%s\nafter=%s", beforeState, after)
	}
	if after := searchFiles(t, w.root, filepath.Dir(path)); !reflect.DeepEqual(beforeFiles, after) {
		t.Fatal("filtering changed file, draft, index or position bytes or metadata")
	}
	// A registered copy stays filterable after its original disappears.
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	beforeState = searchStateBytes(t, w)
	beforeFiles = searchFiles(t, w.root, filepath.Dir(path))
	run("missing original")
	if after := searchStateBytes(t, w); !bytes.Equal(beforeState, after) {
		t.Fatalf("filtering a missing original mutated state\nbefore=%s\nafter=%s", beforeState, after)
	}
	if after := searchFiles(t, w.root, filepath.Dir(path)); !reflect.DeepEqual(beforeFiles, after) {
		t.Fatal("filtering a missing original changed file bytes or metadata")
	}
}

func TestDocumentFilterSnapshotIsolation(t *testing.T) {
	w := workspace(t)
	original := edit(t, w, "---\ntags: [old]\n---\n# Original\nsnapshot-token")
	w.mu.Lock()
	w.docs[original.ID].ImageAliases = map[string]string{"one": "original"}
	w.docs[original.ID].Excerpt = "cached excerpt"
	w.mu.Unlock()

	snapshot := w.searchSnapshot()
	if len(snapshot) != 1 || snapshot[0].ImageAliases != nil || snapshot[0].Excerpt != "cached excerpt" {
		t.Fatalf("a snapshot copies scalars, the excerpt included, and no maps: %+v", snapshot)
	}
	copied := searchMemoryWorkspace(snapshot...)
	requests := []DocumentFilterRequest{{Query: "snapshot-token", Tag: "old"}, {Tag: "old"}, {}}
	type outcome struct {
		got DocumentFilterResponse
		err error
	}
	updated := make(chan struct{})
	results := make(chan []outcome, 1)
	go func() {
		<-updated
		var out []outcome
		for _, request := range requests {
			got, err := copied.FilterDocuments(request, "en")
			out = append(out, outcome{got, err})
		}
		results <- out
	}()
	changed, err := w.Update(Edit{ID: original.ID, Revision: original.Revision, Content: "---\ntags: [new]\n---\n# Changed\nnew-token"})
	w.mu.Lock()
	if aliases := w.docs[original.ID].ImageAliases; aliases != nil {
		aliases["one"] = "changed"
	}
	w.mu.Unlock()
	close(updated)
	if err != nil {
		t.Fatal(err)
	}

	// The copied Workspace is frozen: the live update, made before these calls
	// start, is invisible to it.
	outcomes := <-results
	for _, out := range outcomes {
		if out.err != nil {
			t.Fatal(out.err)
		}
		docFilterShape(t, out.got)
	}
	if got := outcomes[0].got; got.Total != 1 || len(got.Items) != 1 {
		t.Fatalf("the copy observed the later update: %+v", got)
	} else if item := got.Items[0]; item.Document.Title != original.Title || item.Document.Revision != original.Revision || item.Document.Updated != original.Updated || !reflect.DeepEqual(item.Tags, []string{"old"}) || item.Document.Hits[0].Text != "snapshot-token" {
		t.Fatalf("the copy changed with the live document: %+v", item)
	}
	if got := outcomes[1].got; got.Total != 1 || got.Items[0].Excerpt != "cached excerpt" {
		t.Fatalf("the copy keeps the cached excerpt: %+v", got)
	}
	if got := outcomes[2].got; len(got.Recent) != 1 || got.Recent[0].Title != original.Title || got.Recent[0].Updated != original.Updated || !reflect.DeepEqual(got.Tags, []TagSummary{{"old", 1}}) {
		t.Fatalf("the copy's catalog or recent changed: %+v", got)
	}

	// The live Workspace answers from the accepted update.
	if got := docFilterCall(t, w, DocumentFilterRequest{Query: "snapshot-token", Tag: "old"}, "en"); got.Total != 0 {
		t.Fatalf("a fresh query used stale content: %+v", got)
	}
	if got := docFilterCall(t, w, DocumentFilterRequest{Tag: "old"}, "en"); got.Total != 0 || !reflect.DeepEqual(got.Tags, []TagSummary{{"new", 1}}) {
		t.Fatalf("a fresh query used a stale tag: %+v", got)
	}
	live := docFilterCall(t, w, DocumentFilterRequest{Query: "new-token", Tag: "new"}, "en")
	if live.Total != 1 || live.Items[0].Document.Revision != changed.Revision || live.Items[0].Document.Title != changed.Title {
		t.Fatalf("the live workspace lost the update: %+v", live)
	}
	if again := docFilterCall(t, copied, DocumentFilterRequest{Tag: "old"}, "en"); again.Total != 1 {
		t.Fatalf("the copy changed after the live update: %+v", again)
	}

	// Concurrent calls and updates: every response describes one version.
	const versions = 40
	content := func(i int) string {
		return fmt.Sprintf("---\ntags: [t%d]\n---\n# Version %d\nnew-token v%d", i, i, i)
	}
	current, err := w.Update(Edit{ID: changed.ID, Revision: changed.Revision, Content: content(0)})
	if err != nil {
		t.Fatal(err)
	}
	consistent := func(title string, tags []string, excerpt string, keyword bool, catalog []TagSummary) bool {
		k := strings.TrimPrefix(title, "Version ")
		wantExcerpt := fmt.Sprintf("# Version %s new-token v%s", k, k)
		if keyword {
			wantExcerpt = ""
		}
		return k != title && reflect.DeepEqual(tags, []string{"t" + k}) && excerpt == wantExcerpt && reflect.DeepEqual(catalog, []TagSummary{{"t" + k, 1}})
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, locale := range []string{"zh-Hans", "en"} {
		wg.Add(1)
		go func(locale string) {
			defer wg.Done()
			<-start
			lastRevision := 0
			for i := 0; i < versions; i++ {
				keyword, err := w.FilterDocuments(DocumentFilterRequest{Query: "new-token v"}, locale)
				if err != nil || keyword.Total != 1 || len(keyword.Items) != 1 {
					t.Errorf("concurrent keyword filter: %+v %v", keyword, err)
					return
				}
				item := keyword.Items[0]
				if !consistent(item.Document.Title, item.Tags, item.Excerpt, true, keyword.Tags) || len(item.Document.Hits) != 1 ||
					item.Document.Hits[0].After != strings.TrimPrefix(item.Document.Title, "Version ") || item.Document.Revision < lastRevision {
					t.Errorf("inconsistent keyword snapshot: %+v, catalog %v", item, keyword.Tags)
					return
				}
				lastRevision = item.Document.Revision

				recent, err := w.FilterDocuments(DocumentFilterRequest{}, locale)
				if err != nil || len(recent.Recent) != 1 || !consistent(recent.Recent[0].Title, recent.Recent[0].Tags, recent.Recent[0].Excerpt, false, recent.Tags) {
					t.Errorf("inconsistent recent snapshot: %+v %v", recent, err)
					return
				}

				tag := fmt.Sprintf("t%d", i)
				tagged, err := w.FilterDocuments(DocumentFilterRequest{Tag: tag}, locale)
				if err != nil || tagged.Total > 1 || len(tagged.Items) != tagged.Total {
					t.Errorf("concurrent tag filter: %+v %v", tagged, err)
					return
				}
				if tagged.Total == 1 {
					item := tagged.Items[0]
					if !consistent(item.Document.Title, item.Tags, item.Excerpt, false, tagged.Tags) || item.Tags[0] != tag {
						t.Errorf("inconsistent tag snapshot for %s: %+v, catalog %v", tag, item, tagged.Tags)
						return
					}
				}
			}
		}(locale)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-start
		doc := current
		for i := 1; i <= versions; i++ {
			var err error
			doc, err = w.Update(Edit{ID: doc.ID, Revision: doc.Revision, Content: content(i)})
			if err != nil {
				t.Errorf("concurrent Update: %v", err)
				return
			}
			w.mu.Lock()
			if w.docs[doc.ID].ImageAliases == nil {
				w.docs[doc.ID].ImageAliases = map[string]string{}
			}
			w.docs[doc.ID].ImageAliases["one"] = fmt.Sprint(i)
			w.mu.Unlock()
		}
	}()
	close(start)
	wg.Wait()
	if got := docFilterCall(t, w, DocumentFilterRequest{Tag: fmt.Sprintf("t%d", versions)}, "en"); got.Total != 1 {
		t.Fatalf("the last update is not visible: %+v", got)
	}

	t.Run("responses do not retain document content", func(t *testing.T) {
		content := "---\ntags: [clone]\n---\nIDxx Titlexx Pathxx Excerptxx needle " + strings.Repeat("filler ", 2000)
		part := func(s string) string {
			i := strings.Index(content, s)
			return content[i : i+len(s)]
		}
		tail := len(content) - 1000
		docs := []Document{
			{ID: part("IDxx"), Title: part("Titlexx"), CustomTitle: true, Path: part("Pathxx"), Excerpt: part("Excerptxx"), Content: content, Updated: 1},
			// A cached excerpt over 90 runes is cut, and the cut must not keep the content alive either.
			{ID: content[tail : tail+6], Title: content[tail+6 : tail+12], CustomTitle: true, Path: content[tail+12 : tail+18], Excerpt: content[tail+18 : tail+318], Content: content, Updated: 2},
		}
		start := uintptr(unsafe.Pointer(unsafe.StringData(content)))
		end := start + uintptr(len(content))
		retains := func(s string) bool {
			p := uintptr(unsafe.Pointer(unsafe.StringData(s)))
			return s != "" && p >= start && p < end
		}
		for _, doc := range docs {
			for _, field := range []string{doc.ID, doc.Title, doc.Path, doc.Excerpt} {
				if !retains(field) {
					t.Fatalf("fixture field %q does not alias the content", field)
				}
			}
		}
		if utf8.RuneCountInString(docs[1].Excerpt) <= 90 {
			t.Fatal("fixture excerpt must be longer than 90 runes")
		}
		w := searchMemoryWorkspace(docs...)
		for _, item := range docFilterCall(t, w, DocumentFilterRequest{Tag: "clone"}, "en").Items {
			if item.Document.ID == docs[1].ID && item.Excerpt != docs[1].Excerpt[:90] {
				t.Errorf("cached excerpt = %d bytes, want its first 90 runes", len(item.Excerpt))
			}
		}
		checked := 0
		for _, request := range []DocumentFilterRequest{{}, {Tag: "clone"}, {Query: "needle"}, {Query: "needle", Tag: "clone"}} {
			got := docFilterCall(t, w, request, "en")
			var texts []string
			for _, tag := range got.Tags {
				texts = append(texts, tag.Name)
			}
			for _, summary := range got.Recent {
				texts = append(texts, summary.ID, summary.Title, summary.Path, summary.Excerpt)
				texts = append(texts, summary.Tags...)
			}
			for _, item := range got.Items {
				d := item.Document
				texts = append(texts, d.ID, d.Title, d.Path, item.Excerpt)
				texts = append(texts, item.Tags...)
				for _, hit := range d.Hits {
					texts = append(texts, hit.Text, hit.Before, hit.After)
				}
			}
			for _, text := range texts {
				if retains(text) {
					t.Errorf("%+v: %q still points into the document content", request, text)
				}
			}
			checked += len(texts)
		}
		if checked < 20 {
			t.Fatalf("only %d strings were checked", checked)
		}
	})
}

func TestDocumentFilterLocalizedTitles(t *testing.T) {
	front := func(body string) string { return "---\ntags: [loc]\n---\n" + body }
	w := searchMemoryWorkspace(
		Document{ID: "generated", Title: "未命名文稿", Content: front("```\ncode only\n```"), Updated: 5},
		Document{ID: "recovery", Title: "中😀.md · 恢复副本", GeneratedTitleSuffix: "recovery", Content: front("body"), Updated: 4},
		Document{ID: "disk", Title: "中😀.md · 磁盘版本", GeneratedTitleSuffix: "diskVersion", Content: front("body"), Updated: 3},
		Document{ID: "custom", Title: "未命名文稿", CustomTitle: true, Content: front("body"), Updated: 2},
		Document{ID: "inferred", Title: "未命名文稿", Content: front("# 未命名文稿\n正文"), Updated: 1},
	)
	order := []string{"generated", "recovery", "disk", "custom", "inferred"}
	want := map[string][]string{
		"en":      {"Untitled Document", "中😀.md · Recovery Copy", "中😀.md · Disk Version", "未命名文稿", "未命名文稿"},
		"zh-Hans": {"未命名文稿", "中😀.md · 恢复副本", "中😀.md · 磁盘版本", "未命名文稿", "未命名文稿"},
	}
	idsAndTitles := func(got DocumentFilterResponse) (ids, titles []string) {
		for _, summary := range got.Recent {
			ids, titles = append(ids, summary.ID), append(titles, summary.Title)
		}
		for _, item := range got.Items {
			ids, titles = append(ids, item.Document.ID), append(titles, item.Document.Title)
		}
		return ids, titles
	}
	before := searchStateBytes(t, w)
	globalLocale := i18n.Locale()
	for _, request := range []DocumentFilterRequest{{}, {Tag: "loc"}} {
		for locale, titles := range want {
			ids, got := idsAndTitles(docFilterCall(t, w, request, locale))
			if !reflect.DeepEqual(ids, order) || !reflect.DeepEqual(got, titles) {
				t.Errorf("%q %+v: titles = %q (%v), want %q", locale, request, got, ids, titles)
			}
		}
		// The default language is the process's, read without changing it.
		ids, def := idsAndTitles(docFilterCall(t, w, request, ""))
		_, explicit := idsAndTitles(docFilterCall(t, w, request, i18n.Locale()))
		if !reflect.DeepEqual(ids, order) || !reflect.DeepEqual(def, explicit) || def[0] != locales.BUntitled() {
			t.Errorf("default language %+v: titles = %q, explicit %q, global untitled %q", request, def, explicit, locales.BUntitled())
		}
	}
	for _, tc := range []struct {
		locale, query string
		ids           []string
	}{
		{"en", "Untitled", []string{"generated"}},
		{"zh-Hans", "Untitled", []string{}},
		{"en", "未命名", []string{"custom", "inferred"}},
		{"zh-Hans", "未命名", []string{"generated", "custom", "inferred"}},
		{"en", "Recovery", []string{"recovery"}},
		{"zh-Hans", "Recovery", []string{}},
		{"zh-Hans", "恢复", []string{"recovery"}},
		{"en", "恢复", []string{}},
		{"en", "Disk Version", []string{"disk"}},
		{"en", "磁盘版本", []string{}},
		{"zh-Hans", "磁盘版本", []string{"disk"}},
	} {
		got := docFilterCall(t, w, DocumentFilterRequest{Query: tc.query, Tag: "loc"}, tc.locale)
		if got.Total != len(tc.ids) || !reflect.DeepEqual(docFilterIDs(got), tc.ids) {
			t.Errorf("%q query %q matched %v, want %v", tc.locale, tc.query, docFilterIDs(got), tc.ids)
		}
		for _, item := range got.Items {
			d := item.Document
			if d.TitleMatch == nil {
				t.Errorf("%q query %q: %s has no title range", tc.locale, tc.query, d.ID)
				continue
			}
			encoded := utf16.Encode([]rune(d.Title))
			if match := string(utf16.Decode(encoded[d.TitleMatch.From:d.TitleMatch.To])); match != tc.query {
				t.Errorf("%q query %q: range selects %q of %q, the title language is wrong", tc.locale, tc.query, match, d.Title)
			}
		}
	}
	got := docFilterCall(t, w, DocumentFilterRequest{Query: locales.BUntitled(), Tag: "loc"}, "")
	found := false
	for _, item := range got.Items {
		if item.Document.ID == "generated" {
			found = true
			if item.Document.Title != locales.BUntitled() || item.Document.TitleMatch == nil {
				t.Errorf("default language title = %+v", item.Document)
			}
		}
	}
	if !found {
		t.Errorf("default language query %q missed the generated title", locales.BUntitled())
	}
	if !bytes.Equal(before, searchStateBytes(t, w)) || globalLocale != i18n.Locale() {
		t.Fatal("request localization mutated a document or the global language")
	}
}
