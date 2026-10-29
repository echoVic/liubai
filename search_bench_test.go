//go:build perf

package main

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

func searchBenchmarkWorkspace(count, size int, large bool) (*Workspace, int64) {
	w := &Workspace{docs: make(map[string]*Document, count+1)}
	var sourceBytes int64
	add := func(id string, size int) {
		const tail = "\nSearchTailNeedle"
		const paragraph = "这是一段用于搜索的中文正文，包含 English words 和标点。\n"
		body := strings.Repeat(paragraph, size/len(paragraph)+1)
		end := size - len(tail)
		for !utf8.RuneStart(body[end]) {
			end--
		}
		content := body[:end] + strings.Repeat(" ", size-len(tail)-end) + tail
		w.docs[id] = &Document{ID: id, Title: "Benchmark draft", Content: content, Updated: 1, Revision: 1}
		sourceBytes += int64(len(content))
	}
	for i := 0; i < count; i++ {
		add(fmt.Sprintf("doc-%04d", i), size)
	}
	if large {
		add("large", 8<<20)
	}
	return w, sourceBytes
}

func BenchmarkWorkspaceSearch(b *testing.B) {
	for _, dataset := range []struct {
		name        string
		count, size int
		large       bool
		singleLine  bool
	}{
		{"300x32KiB+8MiB", 300, 32 << 10, true, false},
		{"1000x4KiB", 1000, 4 << 10, false, false},
		{"8MiB", 1, 8 << 20, false, false},
		{"8MiB-single-line", 1, 8 << 20, false, true},
	} {
		b.Run(dataset.name, func(b *testing.B) {
			// Preload distinct working-copy strings; no workspace/file I/O is timed.
			w, sourceBytes := searchBenchmarkWorkspace(dataset.count, dataset.size, dataset.large)
			if dataset.singleLine {
				for _, doc := range w.docs {
					doc.Content = strings.ReplaceAll(doc.Content, "\n", " ")
				}
			}
			largest := 0
			for _, doc := range w.docs {
				if len(doc.Content) > maxDocument || !utf8.ValidString(doc.Content) {
					b.Fatal("fixture exceeds the document limit or contains invalid UTF-8")
				}
				largest = max(largest, len(doc.Content))
			}
			for _, scenario := range []struct {
				name, query string
				wantTotal   int
			}{
				{"miss", "UnfindableSearchToken", 0},
				{"tail", "searchtailneedle", len(w.docs)},
				{"frequent", "正文", len(w.docs)},
			} {
				b.Run(scenario.name, func(b *testing.B) {
					got, err := w.Search(scenario.query, "en")
					if err != nil || got.Total != scenario.wantTotal {
						b.Fatalf("fixture search: total=%d, want %d, error=%v", got.Total, scenario.wantTotal, err)
					}
					b.ReportAllocs()
					b.SetBytes(sourceBytes)
					b.ResetTimer()
					b.ReportMetric(float64(sourceBytes), "source-B")
					b.ReportMetric(float64(largest), "max-doc-B")
					for i := 0; i < b.N; i++ {
						got, err = w.Search(scenario.query, "en")
						if err != nil || got.Total != scenario.wantTotal {
							b.Fatalf("search: total=%d, want %d, error=%v", got.Total, scenario.wantTotal, err)
						}
					}
				})
			}
		})
	}
}
