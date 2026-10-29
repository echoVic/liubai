package main

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/egoist/mygo/i18n"
)

type SearchRange struct {
	From int `json:"from"`
	To   int `json:"to"`
}

type SearchHit struct {
	From   int    `json:"from"`
	To     int    `json:"to"`
	Line   int    `json:"line"`
	Text   string `json:"text"`
	Before string `json:"before"`
	After  string `json:"after"`
}

type SearchItem struct {
	ID         string       `json:"id"`
	Title      string       `json:"title"`
	Path       string       `json:"path"`
	Updated    int64        `json:"updated"`
	Revision   int          `json:"revision"`
	TitleMatch *SearchRange `json:"titleMatch"`
	Hits       []SearchHit  `json:"hits"`
	MoreHits   bool         `json:"moreHits"`
}

type SearchResponse struct {
	Items     []SearchItem `json:"items"`
	Total     int          `json:"total"`
	Truncated bool         `json:"truncated"`
}

func (w *Workspace) Search(query, locale string) (SearchResponse, error) {
	empty := SearchResponse{Items: []SearchItem{}}
	query, err := normalizeSearchQuery(query)
	if err != nil || query == "" {
		return empty, err
	}
	matcher := newSearchMatcher(query)
	docs := w.searchSnapshot()
	if locale == "" {
		locale = i18n.Locale()
	}
	return searchDocuments(docs, matcher, locale), nil
}

func normalizeSearchQuery(query string) (string, error) {
	if !utf8.ValidString(query) {
		return "", messageError("bSearchInvalidQuery", nil)
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return "", nil
	}
	if utf8.RuneCountInString(query) > 128 {
		return "", messageError("bSearchQueryTooLong", nil)
	}
	if strings.ContainsAny(query, "\r\n") {
		return "", messageError("bSearchQueryLineBreak", nil)
	}
	return query, nil
}

func (w *Workspace) searchSnapshot() []Document {
	w.mu.Lock()
	defer w.mu.Unlock()
	docs := make([]Document, 0, len(w.docs))
	for _, d := range w.docs {
		docs = append(docs, Document{
			ID: d.ID, Title: d.Title, CustomTitle: d.CustomTitle,
			GeneratedTitleSuffix: d.GeneratedTitleSuffix, Path: d.Path,
			Updated: d.Updated, Revision: d.Revision, Content: d.Content, Excerpt: d.Excerpt,
		})
	}
	return docs
}

type searchMatcher struct {
	starts string
	at     *regexp.Regexp
}

func newSearchMatcher(query string) searchMatcher {
	first, _ := utf8.DecodeRuneInString(query)
	starts := string(first)
	for next := unicode.SimpleFold(first); next != first; next = unicode.SimpleFold(next) {
		starts += string(next)
	}
	return searchMatcher{starts: starts, at: regexp.MustCompile("(?i)^" + regexp.QuoteMeta(query))}
}

func (m searchMatcher) findAll(text string, limit int) [][]int {
	var positions [][]int
	for offset := 0; offset < len(text) && len(positions) < limit; {
		// Skip to a possible first rune before invoking the anchored matcher.
		next := strings.IndexAny(text[offset:], m.starts)
		if next < 0 {
			break
		}
		offset += next
		if at := m.at.FindStringIndex(text[offset:]); at != nil {
			end := offset + at[1]
			positions = append(positions, []int{offset, end})
			offset = end
		} else {
			_, size := utf8.DecodeRuneInString(text[offset:])
			offset += size
		}
	}
	return positions
}

func searchDocuments(docs []Document, matcher searchMatcher, locale string) SearchResponse {
	type match struct {
		doc   Document
		title *SearchRange
		body  [][]int
	}
	matches := make([]match, 0)
	for _, doc := range docs {
		doc = documentIn(doc, locale)
		var title *SearchRange
		var body [][]int
		if matcher.at != nil {
			if positions := matcher.findAll(doc.Title, 1); len(positions) != 0 {
				at := positions[0]
				from := searchUTF16Len(doc.Title[:at[0]])
				title = &SearchRange{From: from, To: from + searchUTF16Len(doc.Title[at[0]:at[1]])}
			}
			body = matcher.findAll(doc.Content, 4)
		}
		if matcher.at == nil || title != nil || len(body) != 0 {
			matches = append(matches, match{doc: doc, title: title, body: body})
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		a, b := matches[i], matches[j]
		if (a.title != nil) != (b.title != nil) {
			return a.title != nil
		}
		if a.doc.Updated != b.doc.Updated {
			return a.doc.Updated > b.doc.Updated
		}
		return a.doc.ID < b.doc.ID
	})
	response := SearchResponse{
		Items: make([]SearchItem, 0, min(len(matches), 100)),
		Total: len(matches), Truncated: len(matches) > 100,
	}
	for _, match := range matches[:min(len(matches), 100)] {
		d := match.doc
		response.Items = append(response.Items, SearchItem{
			ID: strings.Clone(d.ID), Title: strings.Clone(d.Title), Path: strings.Clone(d.Path),
			Updated: d.Updated, Revision: d.Revision, TitleMatch: match.title,
			Hits:     searchHits(d.Content, match.body[:min(len(match.body), 3)]),
			MoreHits: len(match.body) > 3,
		})
	}
	return response
}

func searchUTF16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

func searchHits(content string, positions [][]int) []SearchHit {
	hits := make([]SearchHit, 0, len(positions))
	offset, line, cursor := 0, 1, 0
	for _, at := range positions {
		// Accumulate coordinates once across the ascending original byte ranges.
		for cursor < at[0] {
			r, size := utf8.DecodeRuneInString(content[cursor:])
			offset += utf16.RuneLen(r)
			if r == '\n' {
				line++
			}
			cursor += size
		}
		from := offset
		text := content[at[0]:at[1]]
		offset += searchUTF16Len(text)
		cursor = at[1]
		before := at[0]
		for n := 0; n < 32 && before > 0 && content[before-1] != '\n'; n++ {
			_, size := utf8.DecodeLastRuneInString(content[:before])
			before -= size
		}
		after := at[1]
		for n := 0; n < 40 && after < len(content) && content[after] != '\n'; n++ {
			_, size := utf8.DecodeRuneInString(content[after:])
			after += size
		}
		prefix := strings.Clone(content[before:at[0]])
		suffix := strings.Clone(content[at[1]:after])
		if before > 0 && content[before-1] != '\n' {
			_, size := utf8.DecodeRuneInString(prefix)
			prefix = "…" + prefix[size:]
		}
		if after < len(content) && content[after] != '\n' {
			_, size := utf8.DecodeLastRuneInString(suffix)
			suffix = suffix[:len(suffix)-size] + "…"
		}
		hits = append(hits, SearchHit{
			From: from, To: offset, Line: line, Text: strings.Clone(text),
			Before: prefix, After: suffix,
		})
	}
	return hits
}
