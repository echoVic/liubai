package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"liubai/locales"
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

func TestDocumentFilenameKeepsDotsAndSlashesOfTitles(t *testing.T) {
	for title, want := range map[string]string{
		"Release 0.7.0 plan": "Release 0.7.0 plan.md",
		"v1.2":               "v1.2.md",
		"2026.11.11 日记":      "2026.11.11 日记.md",
		"Dr. Strange":        "Dr. Strange.md",
		"A/B testing":        "A-B testing.md",
		"notes.md":           "notes.md",
		"NOTES.Markdown":     "NOTES.md",
		"draft.txt":          "draft.md",
		"  ":                 locales.BDefaultFilename() + ".md",
	} {
		if got := documentFilename(title, ".md"); got != want {
			t.Errorf("documentFilename(%q) = %q, want %q", title, got, want)
		}
	}
}

// A picture inside a list item is indented like code but is not code; the
// Markdown parser, not the indentation, tells the two apart.
func TestPicturesInListItemsTravel(t *testing.T) {
	for _, shape := range []string{"- a\n  - b\n    ![x](%s)\n", "1. step\n\n    ![x](%s)\n", "- a\n\t![x](%s)\n"} {
		w := workspace(t)
		d := w.State().Current
		im, err := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
		if err != nil {
			t.Fatal(err)
		}
		content := fmt.Sprintf(shape, im.Destination)
		edit(t, w, content)
		if _, err := w.Export(d.ID, filepath.Join(t.TempDir(), "out.zip"), false); err != nil {
			t.Errorf("%q: export: %v", content, err)
		}
		if _, err := w.SaveRecovery(d.ID, content, filepath.Join(t.TempDir(), "rescue.md")); err != nil {
			t.Errorf("%q: recovery: %v", content, err)
		}
		r, err := w.SaveAs(d.ID, filepath.Join(t.TempDir(), "out.md"))
		if err != nil || strings.Contains(r.Document.Content, "liubai-asset:") {
			t.Errorf("%q: save as: %q %v", content, r.Document.Content, err)
		}
	}
}

func TestCodeInListItemsKeepsItsText(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "images", "shot.png"))
	code := "- a\n  - b\n    ```\n    ![](images/shot.png)\n    ```\n\n<!-- -->\n\n    ![](images/shot.png)\n\n> ```\n> ![](images/shot.png)\n> ```\n"
	p := filepath.Join(dir, "notes.md")
	if err := os.WriteFile(p, []byte("- a\n  - b\n    ![](images/shot.png)\n\n"+code), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, filepath.Join(t.TempDir(), "copy.md"))
	if err != nil {
		t.Fatal(err)
	}
	if want := "- a\n  - b\n    ![](copy.assets/shot.png)\n\n" + code; r.Document.Content != want {
		t.Fatalf("got %q\nwant %q", r.Document.Content, want)
	}
	if _, err := w.Export(s.Current.ID, filepath.Join(t.TempDir(), "copy.zip"), false); err != nil {
		t.Fatal(err)
	}
}

// The recovery copy is the last resort: when pictures cannot be converted it
// still keeps the text, as it is.
func TestRecoveryKeepsTextWhenPicturesCannotBeConverted(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, err := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	content := "正文\n\n![图](\n" + im.Destination + "\n)\n"
	p := filepath.Join(t.TempDir(), "rescue.md")
	if _, err := w.SaveRecovery(d.ID, content, p); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(p); err != nil || string(b) != content {
		t.Fatalf("recovery %q %v", b, err)
	}
}

// One file, one document: Save As onto a file another document has open
// would leave two documents writing to it.
func TestSaveAsRefusesTheFileOfAnotherDocument(t *testing.T) {
	w := workspace(t)
	p, b := openFile(t, w, "b.md", "B content\n")
	s, err := w.New()
	if err != nil {
		t.Fatal(err)
	}
	a, err := w.Update(Edit{ID: s.Current.ID, Revision: s.Current.Revision, Content: "A content\n"})
	if err != nil {
		t.Fatal(err)
	}
	spellings := []string{p}
	if upper := filepath.Join(filepath.Dir(p), "B.md"); regularFile(upper) {
		spellings = append(spellings, upper)
	}
	for _, target := range spellings {
		_, err := w.SaveAs(a.ID, target)
		if e, ok := err.(*catalogError); !ok || e.Key != "bFileOpenInAnotherDocument" {
			t.Fatalf("Save As onto %s: %v", target, err)
		}
	}
	if disk, _ := os.ReadFile(p); string(disk) != "B content\n" {
		t.Fatalf("file overwritten: %q", disk)
	}
	if w.docs[a.ID].Path != "" || w.docs[b.ID].Content != "B content\n" {
		t.Fatal("documents changed")
	}
	if _, err := w.SaveAs(b.ID, p); err != nil {
		t.Fatalf("Save As onto its own file: %v", err)
	}
}

// Save As stores the path as Open does, so reopening the file through any
// symbolic link finds the same document.
func TestSaveAsStoresThePathOpenWouldStore(t *testing.T) {
	real := t.TempDir()
	link := filepath.Join(t.TempDir(), "linked")
	if err := os.Symlink(real, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skip("symbolic links need Developer Mode or administrator rights on Windows")
		}
		t.Fatal(err)
	}
	for _, dir := range []string{link, t.TempDir()} {
		w := workspace(t)
		d := edit(t, w, "hello\n")
		p := filepath.Join(dir, "note.md")
		if _, err := w.SaveAs(d.ID, p); err != nil {
			t.Fatal(err)
		}
		s, err := w.Open(p)
		if err != nil {
			t.Fatal(err)
		}
		if s.Current.ID != d.ID || len(w.docs) != 1 {
			t.Fatalf("%s: reopened as another document (%d documents)", dir, len(w.docs))
		}
	}
}

func TestRecoveryRefusesTheOriginalThroughASymlink(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "original.md", "saved\n")
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(filepath.Dir(p), link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skip("symbolic links need Developer Mode or administrator rights on Windows")
		}
		t.Fatal(err)
	}
	for _, target := range []string{p, filepath.Join(link, "original.md")} {
		if _, err := w.SaveRecovery(d.ID, "latest\n", target); err == nil {
			t.Fatalf("recovery copy written onto the original through %s", target)
		}
	}
	if b, _ := os.ReadFile(p); string(b) != "saved\n" {
		t.Fatalf("original overwritten: %q", b)
	}
	other, _ := openFile(t, w, "other.md", "other\n")
	if _, err := w.SaveRecovery(d.ID, "latest\n", other); err == nil {
		t.Fatal("recovery copy written onto another open document")
	}
	if b, _ := os.ReadFile(other); string(b) != "other\n" {
		t.Fatalf("other document overwritten: %q", b)
	}
}

// A recovery copy is an ordinary file the user chose, written as Save As
// writes one: readable by others when new, keeping the mode it replaces.
func TestRecoveryCopyIsWrittenLikeSaveAs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no permission bits")
	}
	w := workspace(t)
	d := w.State().Current
	fresh := filepath.Join(t.TempDir(), "fresh.md")
	existing := filepath.Join(t.TempDir(), "existing.md")
	if err := os.WriteFile(existing, []byte("old\n"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(existing, 0640); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]os.FileMode{fresh: 0644, existing: 0640} {
		if _, err := w.SaveRecovery(d.ID, "text\n", path); err != nil {
			t.Fatal(err)
		}
		if info, err := os.Stat(path); err != nil || info.Mode().Perm() != want {
			t.Errorf("%s: mode %v, want %v (%v)", filepath.Base(path), info.Mode().Perm(), want, err)
		}
	}
}
