package main

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSaveAsKeepsUserImageReferencesInSameFolder(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "images", "architecture.png"))
	p := filepath.Join(dir, "notes.md")
	original := "# Notes\n\n![架构图](images/architecture.png)\n"
	os.WriteFile(p, []byte(original), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, p)
	if err != nil {
		t.Fatal(err)
	}
	if r.Document.Content != original || len(r.Changes) != 0 {
		t.Fatalf("same-path save rewrote images: %q", r.Document.Content)
	}
	if _, err := os.Stat(filepath.Join(dir, "notes.assets")); !os.IsNotExist(err) {
		t.Fatal("same-path save created an assets folder")
	}
	r, err = w.SaveAs(s.Current.ID, filepath.Join(dir, "renamed.md"))
	if err != nil || r.Document.Content != original {
		t.Fatalf("same-folder save changed images: %q %v", r.Document.Content, err)
	}
}

func TestSaveAsToAnotherFolderCopiesImagesWithOriginalNames(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "images", "architecture.png"))
	p := filepath.Join(dir, "notes.md")
	os.WriteFile(p, []byte("![架构图](images/architecture.png)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "导出", "笔记.md")
	r, err := w.SaveAs(s.Current.ID, target)
	if err != nil {
		t.Fatal(err)
	}
	if r.Document.Content != "![架构图](笔记.assets/architecture.png)\n" {
		t.Fatalf("got %q", r.Document.Content)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(target), "笔记.assets", "architecture.png")); err != nil {
		t.Fatal(err)
	}
	os.RemoveAll(dir)
	if _, err := w.ReadImage(s.Current.ID, "笔记.assets/architecture.png"); err != nil {
		t.Fatal(err)
	}
}

func TestSaveAsNameCollisionKeepsBothImages(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "a", "shot.png"))
	var other bytes.Buffer
	png.Encode(&other, image.NewNRGBA(image.Rect(0, 0, 3, 3)))
	os.MkdirAll(filepath.Join(dir, "b"), 0755)
	os.WriteFile(filepath.Join(dir, "b", "shot.png"), other.Bytes(), 0644)
	p := filepath.Join(dir, "notes.md")
	os.WriteFile(p, []byte("![](a/shot.png)\n\n![](b/shot.png)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, filepath.Join(t.TempDir(), "out.md"))
	if err != nil {
		t.Fatal(err)
	}
	if r.Document.Content != "![](out.assets/shot.png)\n\n![](out.assets/shot-2.png)\n" {
		t.Fatalf("got %q", r.Document.Content)
	}
}

func TestSaveAsWithMissingImageStillSaves(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	p := filepath.Join(dir, "notes.md")
	os.WriteFile(p, []byte("![缺失](images/gone.png)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, filepath.Join(t.TempDir(), "copy.md"))
	if err != nil {
		t.Fatalf("missing image blocked save: %v", err)
	}
	if r.Document.Content != "![缺失](images/gone.png)\n" || len(r.Missing) != 1 {
		t.Fatalf("got %q missing=%v", r.Document.Content, r.Missing)
	}
}

func TestSaveAsDraftKeepsUnresolvableRelativeImages(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "![](images/a.png)\n")
	r, err := w.SaveAs(d.ID, filepath.Join(t.TempDir(), "draft.md"))
	if err != nil || r.Document.Content != "![](images/a.png)\n" {
		t.Fatalf("%q %v", r.Document.Content, err)
	}
}

func TestSaveAsKeepsReferencesThroughDirectorySymlink(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "images", "shot.png"))
	p := filepath.Join(dir, "notes.md")
	original := "![](images/shot.png)\n"
	if err := os.WriteFile(p, []byte(original), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "linked")
	if err := os.Symlink(dir, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skip("symbolic links need Developer Mode or administrator rights on Windows")
		}
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, filepath.Join(link, "copy.md"))
	if err != nil || r.Document.Content != original || len(r.Changes) != 0 {
		t.Fatalf("symlinked directory rewrote images: %+v %v", r, err)
	}
}

func TestSaveAsKeepsAbsoluteImageReferences(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	imagePath := filepath.Join(dir, "shot.png")
	writeFixture(t, imagePath)
	original := "![](" + imagePath + ")\n"
	d := edit(t, w, original)
	r, err := w.SaveAs(d.ID, filepath.Join(t.TempDir(), "copy.md"))
	if err != nil || r.Document.Content != original || len(r.Changes) != 0 {
		t.Fatalf("absolute reference changed: %+v %v", r, err)
	}
}

func TestSaveAsReportsMissingImagesInSameFolder(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	p := filepath.Join(dir, "notes.md")
	original := "![](missing.png)\n\n![](also-missing.png)\n"
	if err := os.WriteFile(p, []byte(original), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, filepath.Join(dir, "copy.md"))
	if err != nil || r.Document.Content != original || len(r.Missing) != 2 {
		t.Fatalf("missing images blocked save or were not reported: %+v %v", r, err)
	}
	if r.Missing[0] != "missing.png" || r.Missing[1] != "also-missing.png" {
		t.Fatalf("wrong missing destinations: %v", r.Missing)
	}
	if b, err := os.ReadFile(r.Path); err != nil || string(b) != original {
		t.Fatalf("saved content: %q %v", b, err)
	}
}

func TestSaveAsReusesIdenticalImageAndSkipsNameCollisions(t *testing.T) {
	for _, identical := range []bool{true, false} {
		t.Run(fmt.Sprint(identical), func(t *testing.T) {
			w := workspace(t)
			dir := t.TempDir()
			writeFixture(t, filepath.Join(dir, "images", "my shot.png"))
			p := filepath.Join(dir, "notes.md")
			if err := os.WriteFile(p, []byte("![](<images/my shot.png>)\n"), 0644); err != nil {
				t.Fatal(err)
			}
			s, err := w.Open(p)
			if err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(t.TempDir(), "out.md")
			assetDir := filepath.Join(filepath.Dir(target), "out.assets")
			writeFixture(t, filepath.Join(assetDir, "my shot.png"))
			name := "my shot.png"
			if !identical {
				for _, base := range []string{"my shot.png", "my shot-2.png"} {
					if err := os.WriteFile(filepath.Join(assetDir, base), []byte("existing content"), 0644); err != nil {
						t.Fatal(err)
					}
				}
				name = "my shot-3.png"
			}
			r, err := w.SaveAs(s.Current.ID, target)
			if err != nil {
				t.Fatal(err)
			}
			if want := "![](<out.assets/" + name + ">)\n"; r.Document.Content != want {
				t.Fatalf("got %q want %q", r.Document.Content, want)
			}
			if b, err := os.ReadFile(filepath.Join(assetDir, name)); err != nil || !bytes.Equal(b, tinyPNG()) {
				t.Fatalf("copied image: %v", err)
			}
			if !identical {
				if b, err := os.ReadFile(filepath.Join(assetDir, "my shot.png")); err != nil || string(b) != "existing content" {
					t.Fatalf("existing image overwritten: %q %v", b, err)
				}
			}
			if err := os.RemoveAll(dir); err != nil {
				t.Fatal(err)
			}
			if err := os.RemoveAll(assetDir); err != nil {
				t.Fatal(err)
			}
			for _, dest := range []string{"images/my shot.png", "out.assets/" + name} {
				p, err := w.imagePath(&r.Document, dest)
				if err != nil {
					t.Fatal(err)
				}
				if b, _, err := picture(p); err != nil || !bytes.Equal(b, tinyPNG()) {
					t.Fatalf("cached alias %q: %v", dest, err)
				}
			}
		})
	}
}
