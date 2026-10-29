package main

import (
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/egoist/mygo/i18n"
)

type DocumentFilterRequest struct {
	Query string `json:"query"`
	Tag   string `json:"tag"`
}

type TagSummary struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type DocumentFilterItem struct {
	Document SearchItem `json:"document"`
	Tags     []string   `json:"tags"`
	Excerpt  string     `json:"excerpt"`
}

type DocumentFilterResponse struct {
	Items     []DocumentFilterItem `json:"items"`
	Total     int                  `json:"total"`
	Truncated bool                 `json:"truncated"`
	Tags      []TagSummary         `json:"tags"`
	Recent    []Summary            `json:"recent"`
}

func (w *Workspace) FilterDocuments(request DocumentFilterRequest, locale string) (DocumentFilterResponse, error) {
	empty := DocumentFilterResponse{Items: []DocumentFilterItem{}, Tags: []TagSummary{}, Recent: []Summary{}}
	query, err := normalizeSearchQuery(request.Query)
	if err != nil {
		return empty, err
	}
	tag := strings.TrimSpace(request.Tag)
	if !utf8.ValidString(tag) || utf8.RuneCountInString(tag) > 80 || strings.ContainsFunc(tag, unicode.IsControl) {
		return empty, messageError("bFilterInvalidTag", nil)
	}
	if locale == "" {
		locale = i18n.Locale()
	}
	return filterDocuments(w.searchSnapshot(), query, tag, locale), nil
}

func filterDocuments(docs []Document, query, tag, locale string) DocumentFilterResponse {
	result := DocumentFilterResponse{Items: []DocumentFilterItem{}, Tags: []TagSummary{}, Recent: []Summary{}}
	tagsByID := make(map[string][]string, len(docs))
	counts := map[string]int{}
	selected := make([]Document, 0, len(docs))
	for _, doc := range docs {
		tags := summaryOf(&doc).Tags
		if tags == nil {
			tags = []string{}
		}
		for i, name := range tags {
			tags[i] = strings.Clone(name)
			counts[name]++
		}
		tagsByID[doc.ID] = tags
		if tag == "" || slices.Contains(tags, tag) {
			selected = append(selected, doc)
		}
	}
	for name, count := range counts {
		result.Tags = append(result.Tags, TagSummary{Name: strings.Clone(name), Count: count})
	}
	sort.Slice(result.Tags, func(i, j int) bool { return result.Tags[i].Name < result.Tags[j].Name })
	if query == "" && tag == "" {
		sort.Slice(docs, func(i, j int) bool {
			if docs[i].Updated != docs[j].Updated {
				return docs[i].Updated > docs[j].Updated
			}
			return docs[i].ID < docs[j].ID
		})
		for _, doc := range docs {
			doc = documentIn(doc, locale)
			result.Recent = append(result.Recent, Summary{
				ID: strings.Clone(doc.ID), Title: strings.Clone(doc.Title), Path: strings.Clone(doc.Path),
				Updated: doc.Updated, Excerpt: filterExcerpt(doc), Tags: tagsByID[doc.ID],
			})
		}
		return result
	}
	matcher := searchMatcher{}
	if query != "" {
		matcher = newSearchMatcher(query)
	}
	found := searchDocuments(selected, matcher, locale)
	result.Total, result.Truncated = found.Total, found.Truncated
	byID := map[string]Document{}
	if query == "" {
		for _, doc := range selected {
			byID[doc.ID] = doc
		}
	}
	for _, item := range found.Items {
		excerpt := ""
		if query == "" {
			excerpt = filterExcerpt(byID[item.ID])
		}
		result.Items = append(result.Items, DocumentFilterItem{Document: item, Tags: tagsByID[item.ID], Excerpt: excerpt})
	}
	return result
}

func filterExcerpt(doc Document) string {
	excerpt := doc.Excerpt
	if excerpt == "" {
		excerpt = excerptOf(doc.Content)
	}
	n := 0
	for i := range excerpt {
		if n == 90 {
			return strings.Clone(excerpt[:i])
		}
		n++
	}
	return strings.Clone(excerpt)
}
