package main

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestImageRefsIncludeHTMLImages(t *testing.T) {
	got := imageTargets("<p align=\"center\"><img src=\"assets/logo.png\" width=\"120\"></p>\n\n文字 <img src='inline.png'> 结束\n\n![md](a.png)\n")
	if want := []string{"assets/logo.png", "inline.png", "a.png"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestHTMLImagesAreReadableDeliveredAndPacked(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "assets", "logo.png"))
	p := filepath.Join(dir, "README.md")
	content := "<p align=\"center\"><img src=\"assets/logo.png\" width=\"120\"></p>\n\n# 标题\n"
	os.WriteFile(p, []byte(content), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.ReadImage(s.Current.ID, "assets/logo.png"); err != nil {
		t.Fatal(err)
	}
	if dl, err := w.Delivery(s.Current.ID); err != nil || dl.Images["assets/logo.png"] == "" {
		t.Fatalf("delivery %v %v", dl.Images, err)
	}
	z := filepath.Join(t.TempDir(), "out.zip")
	if r, err := w.Export(s.Current.ID, z, false); err != nil || len(r.Missing) != 0 {
		t.Fatalf("export %+v %v", r, err)
	}
	archive, err := zip.OpenReader(z)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	files := map[string]string{}
	for _, f := range archive.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		files[f.Name] = string(b)
	}
	if _, ok := files["assets/logo.png"]; !ok {
		t.Fatalf("HTML image not packed: %v", files)
	}
	if files["文稿.md"] != content {
		t.Fatalf("HTML image reference rewritten: %q", files["文稿.md"])
	}
}

func TestImageRefsHTMLOrderEntitiesAndCode(t *testing.T) {
	source := "![first](a.png) <img src='a.png'> <img src=inline.png>\n\n<div>\n<img src=\"a&amp;b.png\">\n<img src='inline.png'>\n</div>\n\n`<img src=code.png>`\n\n```html\n<img src=fenced.png>\n```\n"
	want := []string{"a.png", "inline.png", "a&b.png"}
	if got := imageTargets(source); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestHTMLExportPreservesPathsAndMixedReferences(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "logo.png"))
	writeFixture(t, filepath.Join(dir, "图 片.png"))
	outside := filepath.Join(t.TempDir(), "outside.png")
	writeFixture(t, outside)
	content := "<img src=\"logo.png\"><img src=\"%E5%9B%BE%20%E7%89%87.png\"><img src=\"" + outside + "\"><img src=\"../outside.png\"><img src=\"%2e%2e/outside.png\"><img src=\"https://example.com/a.png\">\n\n![md](logo.png)\n"
	p := filepath.Join(dir, "README.md")
	os.WriteFile(p, []byte(content), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	z := filepath.Join(t.TempDir(), "out.zip")
	r, err := w.Export(s.Current.ID, z, true)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{outside, "../outside.png", "%2e%2e/outside.png"}; !reflect.DeepEqual(r.Missing, want) || r.External != 1 {
		t.Fatalf("export %+v", r)
	}
	archive, err := zip.OpenReader(z)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	files := map[string]string{}
	for _, f := range archive.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[f.Name] = string(b)
	}
	if files["logo.png"] == "" || files["图 片.png"] == "" || len(files) != 4 {
		t.Fatalf("packed files: %v", files)
	}
	if !strings.HasPrefix(files["文稿.md"], strings.Split(content, "\n\n")[0]) || !strings.Contains(files["文稿.md"], "![md](images/") {
		t.Fatalf("rewritten document: %q", files["文稿.md"])
	}
}

func TestHTMLImagesStayUnchangedOnSaveAs(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "logo.png"))
	p := filepath.Join(dir, "README.md")
	content := "<img src=\"logo.png\"><img src=\"missing.png\">\n"
	os.WriteFile(p, []byte(content), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "copy.md")
	r, err := w.SaveAs(s.Current.ID, target)
	if err != nil || r.Document.Content != content || len(r.Missing) != 0 {
		t.Fatalf("save as %+v %v", r, err)
	}
	if got, err := w.materialize(&r.Document, target, true); err != nil || got != content {
		t.Fatalf("materialize %q %v", got, err)
	}
}
