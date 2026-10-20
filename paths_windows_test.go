//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Typora and other Windows editors write absolute image paths with a drive.
func TestWindowsDrivePathImagesAreLocal(t *testing.T) {
	w := workspace(t)
	img := filepath.Join(t.TempDir(), "shot.png")
	writeFixture(t, img)
	for _, dest := range []string{img, filepath.ToSlash(img)} {
		d := edit(t, w, "![]("+dest+")\n")
		if r, err := w.ReadImage(d.ID, dest); err != nil || !strings.HasPrefix(r.URL, "data:image/png") {
			t.Errorf("ReadImage(%q) = %+v, %v", dest, r, err)
		}
		delivery, err := w.Delivery(d.ID)
		if err != nil || !strings.HasPrefix(delivery.Images[dest], "data:image/png") || len(delivery.Missing) != 0 {
			t.Errorf("Delivery with %q: %d images, missing %v, %v", dest, len(delivery.Images), delivery.Missing, err)
		}
	}
}

func TestSaveAsKeepsWindowsDrivePathImages(t *testing.T) {
	w := workspace(t)
	img := filepath.Join(t.TempDir(), "shot.png")
	writeFixture(t, img)
	original := "![](" + img + ")\n"
	_, d := openFile(t, w, "a.md", original)
	r, err := w.SaveAs(d.ID, filepath.Join(t.TempDir(), "copy.md"))
	if err != nil || r.Document.Content != original || len(r.Changes) != 0 || len(r.Missing) != 0 {
		t.Fatalf("SaveAs = %+v, %v", r, err)
	}
}

func TestOpenLinkedFollowsWindowsDrivePaths(t *testing.T) {
	w := workspace(t)
	target := filepath.Join(t.TempDir(), "b.md")
	if err := os.WriteFile(target, []byte("# B\n"), 0644); err != nil {
		t.Fatal(err)
	}
	_, from := openFile(t, w, "a.md", "[b]("+target+")\n")
	for _, href := range []string{target, filepath.ToSlash(target) + "#b"} {
		s, err := w.OpenLinked(from.ID, href)
		if err != nil || filepath.Base(s.Current.Path) != "b.md" {
			t.Errorf("OpenLinked(%q) = %q, %v", href, s.Current.Path, err)
		}
	}
}

// Opening a document must not reach the hosts it names: Windows would offer
// the user's credentials to an SMB server. liubai.invalid never resolves, so a
// regression fails rather than reaching a network.
func TestWindowsShareImagesAndLinksAreRefused(t *testing.T) {
	w := workspace(t)
	for _, dest := range []string{`\\liubai.invalid\share\x.png`, "//liubai.invalid/share/x.png", `%5C%5Cliubai.invalid%5Cshare%5Cx.png`} {
		d := edit(t, w, "![]("+dest+")\n<img src=\""+dest+"\">\n")
		if r, err := w.ReadImage(d.ID, dest); err == nil {
			t.Errorf("ReadImage(%q) = %+v", dest, r)
		}
		if delivery, err := w.Delivery(d.ID); err != nil || len(delivery.Images) != 0 {
			t.Errorf("Delivery with %q: images %v, %v", dest, delivery.Images, err)
		}
	}
	_, from := openFile(t, w, "a.md", "")
	for _, href := range []string{`\\liubai.invalid\share\b.md`, "//liubai.invalid/share/b.md", `%5C%5Cliubai.invalid%5Cshare%5Cb.md`} {
		if _, err := w.OpenLinked(from.ID, href); err == nil || err.Error() != "不支持的链接" {
			t.Errorf("OpenLinked(%q) error %v, want 不支持的链接", href, err)
		}
	}
}

// The reading view gets links from markdown-it, which escapes backslashes.
func TestOpenLinkedFollowsEscapedWindowsDrivePaths(t *testing.T) {
	w := workspace(t)
	target := filepath.Join(t.TempDir(), "b.md")
	if err := os.WriteFile(target, []byte("# B\n"), 0644); err != nil {
		t.Fatal(err)
	}
	_, from := openFile(t, w, "a.md", "[b]("+target+")\n")
	href := strings.ReplaceAll(target, `\`, "%5C") + "#b"
	if s, err := w.OpenLinked(from.ID, href); err != nil || filepath.Base(s.Current.Path) != "b.md" {
		t.Errorf("OpenLinked(%q) = %q, %v", href, s.Current.Path, err)
	}
}
