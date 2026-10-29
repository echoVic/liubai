//go:build perf

package main

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func BenchmarkWorkspaceFilter(b *testing.B) {
	for _, dataset := range []struct {
		name        string
		count, size int
		large       bool
	}{
		{"300x32KiB+8MiB", 300, 32 << 10, true},
		{"1000x4KiB", 1000, 4 << 10, false},
	} {
		b.Run(dataset.name, func(b *testing.B) {
			w, sourceBytes := searchBenchmarkWorkspace(dataset.count, dataset.size, dataset.large)
			const metadata = "---\ntags: [工作, 共同]\n---\n\n"
			for _, doc := range w.docs {
				// Replace a complete prefix without growing the 8 MiB document.
				end := len(metadata)
				for !utf8.RuneStart(doc.Content[end]) {
					end++
				}
				doc.Content = metadata + strings.Repeat(" ", end-len(metadata)) + doc.Content[end:]
				if len(doc.Content) > maxDocument || !utf8.ValidString(doc.Content) {
					b.Fatal("fixture exceeds the document limit or contains invalid UTF-8")
				}
				doc.Excerpt = excerptOf(doc.Content)
			}
			for _, scenario := range []struct {
				name    string
				request DocumentFilterRequest
			}{
				{"catalog", DocumentFilterRequest{}},
				{"tag", DocumentFilterRequest{Tag: "工作"}},
				{"intersection", DocumentFilterRequest{Query: "searchtailneedle", Tag: "工作"}},
			} {
				b.Run(scenario.name, func(b *testing.B) {
					wantTotal := len(w.docs)
					if scenario.name == "catalog" {
						wantTotal = 0
					}
					got, err := w.FilterDocuments(scenario.request, "en")
					if err != nil || got.Total != wantTotal || len(got.Tags) != 2 || got.Tags[0].Count != len(w.docs) {
						b.Fatalf("fixture filter: total=%d, want %d, tags=%+v, error=%v", got.Total, wantTotal, got.Tags, err)
					}
					if scenario.name == "catalog" && len(got.Recent) != len(w.docs) {
						b.Fatal("catalog omitted registered documents")
					}
					b.ReportAllocs()
					b.SetBytes(sourceBytes)
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						got, err = w.FilterDocuments(scenario.request, "en")
						if err != nil || got.Total != wantTotal {
							b.Fatalf("filter: total=%d, want %d, error=%v", got.Total, wantTotal, err)
						}
					}
				})
			}
		})
	}
}
