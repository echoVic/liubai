package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFixture(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, tinyPNG(), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestReadImageAcceptsNormalizedDestinations(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "周报.assets", "image-20261015.png"))
	writeFixture(t, filepath.Join(dir, "my image.png"))
	p := filepath.Join(dir, "周报.md")
	os.WriteFile(p, []byte("![截屏](周报.assets/image-20261015.png)\n\n![](<my image.png>)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, dest := range []string{
		"周报.assets/image-20261015.png",
		"%E5%91%A8%E6%8A%A5.assets/image-20261015.png",
		"my image.png",
		"my%20image.png",
	} {
		if _, err := w.ReadImage(s.Current.ID, dest); err != nil {
			t.Errorf("ReadImage(%q): %v", dest, err)
		}
	}
	if _, err := w.ReadImage(s.Current.ID, "%E5%91%A8%E6%8A%A5.assets/other.png"); err == nil {
		t.Fatal("unreferenced image was readable")
	}
}

func TestLegacyPercentEncodedDestinationsStillResolve(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "周报.assets", "a.png"))
	p := filepath.Join(dir, "周报.md")
	os.WriteFile(p, []byte("![](%E5%91%A8%E6%8A%A5.assets/a.png)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, dest := range []string{"%E5%91%A8%E6%8A%A5.assets/a.png", "周报.assets/a.png"} {
		if _, err := w.ReadImage(s.Current.ID, dest); err != nil {
			t.Errorf("ReadImage(%q): %v", dest, err)
		}
	}
}

func TestImportImageUsesReadableDestination(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "我的 笔记.md")
	os.WriteFile(p, []byte("正文\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	im, err := w.ImportImage(s.Current.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	if im.Destination != "我的 笔记.assets/"+im.Name {
		t.Fatalf("destination not readable: %q", im.Destination)
	}
	if im.Markdown != "<"+im.Destination+">" {
		t.Fatalf("markdown target should be bracketed: %q", im.Markdown)
	}
	d := w.State().Current
	content := "正文\n\n![图](" + im.Markdown + ")\n"
	if _, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: content}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != content {
		t.Fatalf("saved file changed the image target: %q", b)
	}
	if _, err := w.ReadImage(d.ID, "%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0.assets/"+im.Name); err != nil {
		t.Fatal(err)
	}
}

func TestSaveAsWritesReadableAssetDestinations(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, err := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	if im.Markdown != im.Destination || !strings.HasPrefix(im.Destination, "liubai-asset:") {
		t.Fatalf("draft image target: %+v", im)
	}
	edit(t, w, "![图]("+im.Markdown+")\n")
	p := filepath.Join(t.TempDir(), "我的 笔记.md")
	r, err := w.SaveAs(d.ID, p)
	if err != nil {
		t.Fatal(err)
	}
	if want := "![图](<我的 笔记.assets/" + im.Name + ">)\n"; r.Document.Content != want {
		t.Fatalf("got %q want %q", r.Document.Content, want)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(p), "我的 笔记.assets", im.Name)); err != nil {
		t.Fatal(err)
	}
}

func TestMarkdownDestination(t *testing.T) {
	for in, want := range map[string]string{
		"a.png":           "a.png",
		"周报.assets/a.png": "周报.assets/a.png",
		"my image.png":    "<my image.png>",
		"a(1).png":        "<a(1).png>",
		"a<b>.png":        "a%3Cb%3E.png",
		"x y/<c>.png":     "<x y/%3Cc%3E.png>",
	} {
		if got := markdownDestination(in); got != want {
			t.Errorf("markdownDestination(%q) = %q, want %q", in, got, want)
		}
	}
}
