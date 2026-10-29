package main

import (
	"sort"
	"strings"

	"github.com/egoist/mygo/i18n"
)

type WikiResolveRequest struct {
	SourceID string `json:"sourceID"`
	Revision int    `json:"revision"`
	Target   string `json:"target"`
}

type BacklinkStatus string

const (
	BacklinkReady     BacklinkStatus = "ready"
	BacklinkUnnamed   BacklinkStatus = "unnamed"
	BacklinkAmbiguous BacklinkStatus = "ambiguous"
)

type BacklinkResponse struct {
	DocumentID string         `json:"documentID"`
	Revision   int            `json:"revision"`
	Status     BacklinkStatus `json:"status"`
	Items      []SearchItem   `json:"items"`
	Total      int            `json:"total"`
	Truncated  bool           `json:"truncated"`
}

func wikiTitle(d Document) (string, bool) {
	title, ok := wikiName(d.Title)
	if !ok || title != d.Title || d.GeneratedTitleSuffix == "" && d.generatedTitle() {
		return "", false
	}
	return d.Title, true
}

func (w *Workspace) ResolveWikiLink(request WikiResolveRequest, locale string) (SearchResponse, error) {
	docs := w.searchSnapshot()
	if locale == "" {
		locale = i18n.Locale()
	}
	return wikiResolveDocuments(docs, request, locale)
}

func wikiResolveDocuments(docs []Document, request WikiResolveRequest, locale string) (SearchResponse, error) {
	empty := SearchResponse{Items: []SearchItem{}}
	var source *Document
	for i := range docs {
		if docs[i].ID == request.SourceID {
			source = &docs[i]
			break
		}
	}
	if source == nil {
		return empty, messageError("bWikiSourceMissing", nil)
	}
	if source.Revision != request.Revision {
		return empty, messageError("bWikiSourceChanged", nil)
	}
	target, ok := wikiName(request.Target)
	if !ok {
		return empty, messageError("bWikiInvalidName", nil)
	}
	present := false
	for _, ref := range wikiReferences(source.Content) {
		if ref.Target == target {
			present = true
			break
		}
	}
	if !present {
		return empty, messageError("bWikiSourceChanged", nil)
	}
	candidates := make([]Document, 0)
	for _, doc := range docs {
		if title, ok := wikiTitle(doc); ok && title == target {
			candidates = append(candidates, doc)
		}
	}
	wikiSortDocuments(candidates)
	result := SearchResponse{Items: make([]SearchItem, 0, min(len(candidates), 100)), Total: len(candidates), Truncated: len(candidates) > 100}
	for _, doc := range candidates[:min(len(candidates), 100)] {
		result.Items = append(result.Items, wikiSearchItem(doc, nil, locale))
	}
	return result, nil
}

func (w *Workspace) Backlinks(id, locale string) (BacklinkResponse, error) {
	docs := w.searchSnapshot()
	if locale == "" {
		locale = i18n.Locale()
	}
	return wikiBacklinkDocuments(docs, id, locale)
}

func wikiBacklinkDocuments(docs []Document, id, locale string) (BacklinkResponse, error) {
	result := BacklinkResponse{DocumentID: strings.Clone(id), Status: BacklinkReady, Items: []SearchItem{}}
	var target *Document
	for i := range docs {
		if docs[i].ID == id {
			target = &docs[i]
			break
		}
	}
	if target == nil {
		return result, messageError("bDocumentMissing", nil)
	}
	result.Revision = target.Revision
	title, ok := wikiTitle(*target)
	if !ok {
		result.Status = BacklinkUnnamed
		return result, nil
	}
	for _, doc := range docs {
		if doc.ID != id {
			if other, ok := wikiTitle(doc); ok && other == title {
				result.Status = BacklinkAmbiguous
				return result, nil
			}
		}
	}
	// Sorting the private snapshot lets us count all sources while retaining
	// only the first 100 rows and the fourth-hit probe for each retained row.
	wikiSortDocuments(docs)
	for _, doc := range docs {
		if doc.ID == id {
			continue
		}
		var positions [][]int
		for _, ref := range wikiReferences(doc.Content) {
			if ref.Target == title {
				positions = append(positions, []int{ref.From, ref.To})
				if len(positions) == 4 {
					break
				}
			}
		}
		if len(positions) == 0 {
			continue
		}
		result.Total++
		if len(result.Items) < 100 {
			result.Items = append(result.Items, wikiSearchItem(doc, positions, locale))
		}
	}
	result.Truncated = result.Total > 100
	return result, nil
}

func wikiSortDocuments(docs []Document) {
	sort.Slice(docs, func(i, j int) bool {
		if docs[i].Updated != docs[j].Updated {
			return docs[i].Updated > docs[j].Updated
		}
		return docs[i].ID < docs[j].ID
	})
}

func wikiSearchItem(doc Document, positions [][]int, locale string) SearchItem {
	doc = documentIn(doc, locale)
	return SearchItem{
		ID: strings.Clone(doc.ID), Title: strings.Clone(doc.Title), Path: strings.Clone(doc.Path),
		Updated: doc.Updated, Revision: doc.Revision,
		Hits: searchHits(doc.Content, positions[:min(len(positions), 3)]), MoreHits: len(positions) > 3,
	}
}
