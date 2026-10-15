package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenLinkedResolvesRelativeMarkdownLinks(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "docs"), 0755)
	os.WriteFile(filepath.Join(dir, "docs", "安装 指南.md"), []byte("# 安装\n"), 0644)
	os.WriteFile(filepath.Join(dir, "secret.png"), tinyPNG(), 0644)
	p := filepath.Join(dir, "README.md")
	os.WriteFile(p, []byte("[安装](docs/安装%20指南.md#安装)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, href := range []string{"docs/安装%20指南.md#安装", "./docs/安装 指南.md", "docs/%E5%AE%89%E8%A3%85%20%E6%8C%87%E5%8D%97.md"} {
		got, err := w.OpenLinked(s.Current.ID, href)
		if err != nil || filepath.Base(got.Current.Path) != "安装 指南.md" || got.Current.Content != "# 安装\n" {
			t.Fatalf("%q: %q %v", href, got.Current.Path, err)
		}
	}
	for _, href := range []string{"secret.png", "https://example.com/a.md", "missing.md", "//host/a.md"} {
		if _, err := w.OpenLinked(s.Current.ID, href); err == nil {
			t.Fatalf("%q accepted", href)
		}
	}
	n, err := w.New()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.OpenLinked(n.Current.ID, "a.md"); err == nil || !strings.Contains(err.Error(), "草稿") {
		t.Fatalf("draft link: %v", err)
	}
}

func TestOpenLinkedValidatesPathsWithoutChangingCurrent(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	for _, name := range []string{"README.md", "100%.MD", "literal%20.mdown", "note.mkd", "plain.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "folder.md"), 0755); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(filepath.Join(dir, "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	for href, name := range map[string]string{
		"100%25.MD?raw=1#标题":            "100%.MD",
		"literal%2520.mdown":            "literal%20.mdown",
		"note.mkd":                      "note.mkd",
		filepath.Join(dir, "plain.txt"): "plain.txt",
	} {
		got, err := w.OpenLinked(s.Current.ID, href)
		if err != nil || filepath.Base(got.Current.Path) != name || got.Current.Content != name {
			t.Fatalf("%q: %+v %v", href, got.Current, err)
		}
	}
	current := w.State().Current.ID
	for href, message := range map[string]string{
		"":                 "不支持的链接",
		"#标题":              "不支持的链接",
		"?raw=1":           "不支持的链接",
		"file:///tmp/a.md": "不支持的链接",
		"//host/a.md":      "不支持的链接",
		"bad%ZZ.md":        "不支持的链接",
		"secret.png":       "只能打开 Markdown 文稿链接",
		"missing.md":       "链接的文稿不存在",
		"folder.md":        "链接的文稿不存在",
	} {
		if _, err := w.OpenLinked(s.Current.ID, href); err == nil || err.Error() != message {
			t.Errorf("%q: %v, want %q", href, err, message)
		}
		if w.State().Current.ID != current {
			t.Fatal("rejected link changed current document")
		}
	}
	if _, err := w.OpenLinked("missing", "note.mkd"); err == nil {
		t.Fatal("missing source accepted")
	}
}

func TestMarkdownPath(t *testing.T) {
	for _, path := range []string{"a.md", "a.MD", "a.markdown", "a.MDOWN", "a.mkd", "a.txt", "目录/安装 指南.md"} {
		if !markdownPath(path) {
			t.Errorf("rejected %q", path)
		}
	}
	for _, path := range []string{"", "a.png", "a.md.exe", "README", "a.md/"} {
		if markdownPath(path) {
			t.Errorf("accepted %q", path)
		}
	}
}
