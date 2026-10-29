//go:build perf

package main

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func BenchmarkWorkspaceBacklinks(b *testing.B) {
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
			const prefix = "[[目标]]\n"
			for _, doc := range w.docs {
				end := len(prefix)
				for !utf8.RuneStart(doc.Content[end]) {
					end++
				}
				doc.Content = prefix + strings.Repeat(" ", end-len(prefix)) + doc.Content[end:]
				if len(doc.Content) > maxDocument || !utf8.ValidString(doc.Content) {
					b.Fatal("invalid fixture")
				}
			}
			w.docs["target"] = &Document{ID: "target", Title: "目标", CustomTitle: true, Content: "# 目标", Revision: 1}
			got, err := w.Backlinks("target", "zh-Hans")
			if err != nil || got.Total != len(w.docs)-1 {
				b.Fatalf("fixture: %+v %v", got, err)
			}
			b.SetBytes(sourceBytes)
			b.ReportAllocs()
			b.ResetTimer()
			b.ReportMetric(float64(sourceBytes), "source-B")
			for i := 0; i < b.N; i++ {
				got, err = w.Backlinks("target", "zh-Hans")
				if err != nil || got.Total != len(w.docs)-1 {
					b.Fatalf("backlinks: total=%d error=%v", got.Total, err)
				}
			}
		})
	}
}
