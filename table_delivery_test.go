package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTableDelivery(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "selected.png"))
	table := "| 模型 | 图片 |\n| --- | --- |\n| **甲** | ![选中](selected.png) |"
	content := table + "\n\n![无关](missing.png)\n\n![远程](https://example.com/outside.png)"
	path := filepath.Join(dir, "note.md")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	state, err := w.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	result, err := w.TableDelivery(state.Current.ID, table)
	if err != nil {
		t.Fatal(err)
	}
	if result.Content != table || len(result.Images) != 1 || result.Images["selected.png"] == "" || len(result.Missing) != 0 || result.External != 0 {
		t.Fatalf("wrong table snapshot: %+v", result)
	}
	missing, err := w.TableDelivery(state.Current.ID, "| 图片 |\n| --- |\n| ![无关](missing.png) |")
	if err != nil {
		t.Fatal(err)
	}
	if len(missing.Missing) != 1 || missing.Missing[0] != "missing.png" {
		t.Fatalf("missing selection not reported: %+v", missing)
	}
	if _, err := w.TableDelivery(state.Current.ID, "![未引用](secret.png)"); err == nil {
		t.Fatal("selection introduced an unreferenced image path")
	}
	if _, err := w.TableDelivery(state.Current.ID, strings.Repeat("x", maxDocument+1)); err == nil {
		t.Fatal("oversized selection accepted")
	}
	full, err := w.Delivery(state.Current.ID)
	if err != nil {
		t.Fatal(err)
	}
	if full.Content != content || len(full.Missing) != 1 || full.External != 1 {
		t.Fatalf("whole-document delivery changed: %+v", full)
	}
	if w.State().Current.Content != content {
		t.Fatal("selection mutated the document")
	}
}
