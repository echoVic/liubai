package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
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

func otherPNG() []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, 5, 7)))
	return b.Bytes()
}

// A picture pasted into a saved document lives beside it, where another
// program may edit it: saving the text leaves that file as it is.
func TestExternallyEditedPastedImageKeepsSaving(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "note.md", "text\n")
	im, err := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	got, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "text\n\n![a](" + im.Destination + ")\n"})
	if err != nil || got.StatusCode != "fileSaved" {
		t.Fatalf("first save: %s %v", got.StatusCode, err)
	}
	onDisk := filepath.Join(filepath.Dir(p), filepath.FromSlash(im.Destination))
	if err := os.WriteFile(onDisk, otherPNG(), 0644); err != nil {
		t.Fatal(err)
	}
	got, err = w.Update(Edit{ID: d.ID, Revision: got.Revision, Content: got.Content + "more\n"})
	if err != nil || got.StatusCode != "fileSaved" {
		t.Fatalf("save after the picture changed: %s %v", got.StatusCode, err)
	}
	if b, _ := os.ReadFile(p); !strings.Contains(string(b), "more") || !strings.Contains(string(b), im.Destination) {
		t.Fatalf("text not saved: %q", b)
	}
	if b, _ := os.ReadFile(onDisk); !bytes.Equal(b, otherPNG()) {
		t.Fatal("edited picture overwritten")
	}
	if r, err := w.ReadImage(d.ID, im.Destination); err != nil || r.URL != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(otherPNG()) {
		t.Fatalf("editor does not show the picture on disk: %v", err)
	}
	// Pasting the original again gives it a file of its own.
	again, err := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil || again.Destination == im.Destination {
		t.Fatalf("paste again: %+v %v", again, err)
	}
	if b, _ := os.ReadFile(filepath.Join(filepath.Dir(p), filepath.FromSlash(again.Destination))); !bytes.Equal(b, tinyPNG()) {
		t.Fatal("pasted picture not written")
	}
	got, err = w.Update(Edit{ID: d.ID, Revision: got.Revision, Content: got.Content + "![b](" + again.Destination + ")\n"})
	if err != nil || got.StatusCode != "fileSaved" {
		t.Fatalf("save with both pictures: %s %v", got.StatusCode, err)
	}
	if r, err := w.ReadImage(d.ID, again.Destination); err != nil || r.URL != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(tinyPNG()) {
		t.Fatalf("second paste shows another picture: %v", err)
	}
}

// Autosave must not read every pasted picture again once it is beside the
// file: with the cached copies gone, saving still succeeds.
func TestAutosaveSkipsPicturesAlreadyBesideTheFile(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, err := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	edit(t, w, "![a]("+im.Destination+")\n")
	p := filepath.Join(t.TempDir(), "note.md")
	if _, err := w.SaveAs(d.ID, p); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(w.root, "assets", d.ID)); err != nil {
		t.Fatal(err)
	}
	// The draft destination, as undo brings it back, and the saved one.
	for _, content := range []string{"![a](" + im.Destination + ")\nmore\n", "![a](note.assets/" + im.Name + ")\nagain\n"} {
		got, err := w.Update(Edit{ID: d.ID, Revision: w.docs[d.ID].Revision, Content: content})
		if err != nil || got.StatusCode != "fileSaved" {
			t.Fatalf("%q: %s %v", content, got.StatusCode, err)
		}
		if b, _ := os.ReadFile(p); strings.Contains(string(b), "liubai-asset:") || !strings.Contains(string(b), "note.assets/"+im.Name) {
			t.Fatalf("saved %q", b)
		}
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

// Windows paths are told apart as Windows reads them, on every system the tests run on.
func TestVolumePath(t *testing.T) {
	for _, tt := range []struct {
		goos, path   string
		drive, share bool
	}{
		{"windows", `C:\notes\a.png`, true, false},
		{"windows", "c:/notes/a.png", true, false},
		{"windows", "C:a.png", false, false},
		{"windows", "a:b.md", false, false},
		{"windows", `\\server\share\a.png`, false, true},
		{"windows", "//server/share/a.md", false, true},
		{"windows", `\/server/share/a.md`, false, true},
		{"windows", `\\?\C:\notes\a.png`, false, true},
		{"windows", `\\.\pipe\liubai`, false, true},
		{"windows", `\notes\a.png`, false, false},
		{"windows", "images/a.png", false, false},
		{"darwin", `C:\notes\a.png`, false, false},
		{"darwin", `\\server\share\a.png`, false, false},
		{"darwin", "//server/share/a.md", false, false},
	} {
		if drive, share := volumePath(tt.goos, tt.path); drive != tt.drive || share != tt.share {
			t.Errorf("volumePath(%s, %q) = drive %v, share %v; want %v, %v", tt.goos, tt.path, drive, share, tt.drive, tt.share)
		}
	}
}
