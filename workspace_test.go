package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"
)

func workspace(t *testing.T) *Workspace {
	t.Helper()
	w, e := openWorkspace(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	return w
}
func edit(t *testing.T, w *Workspace, s string) Document {
	t.Helper()
	d := w.State().Current
	got, e := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: s, Position: Position{Anchor: 2, Head: 2, Scroll: 20}})
	if e != nil {
		t.Fatal(e)
	}
	return got
}
func tinyPNG() []byte {
	var b bytes.Buffer
	im := image.NewNRGBA(image.Rect(0, 0, 32, 24))
	_ = png.Encode(&b, im)
	return b.Bytes()
}
func TestDraftRecoveryRevisionAndAppearance(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "# 你好\n\n一篇草稿\n")
	if _, e := w.Update(Edit{ID: d.ID, Revision: 0, Content: "stale"}); e == nil {
		t.Fatal("stale revision accepted")
	}
	if e := w.Appearance(Appearance{"warm", false}); e != nil {
		t.Fatal(e)
	}
	recovered, e := openWorkspace(w.root)
	if e != nil {
		t.Fatal(e)
	}
	s := recovered.State()
	if s.Current.Content != d.Content || s.Current.Position.Head != 2 || s.Appearance.Theme != "warm" {
		t.Fatal("recovery lost state")
	}
}
func TestPreserveUneditedCRLFBOMAndConflict(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "note.md")
	original := []byte("\xef\xbb\xbf# 标题\r\n\r\n原文\r\n")
	os.WriteFile(p, original, 0644)
	s, e := w.Open(p)
	if e != nil {
		t.Fatal(e)
	}
	edit(t, w, s.Current.Content)
	b, _ := os.ReadFile(p)
	if !bytes.Equal(original, b) {
		t.Fatal("unchanged source rewritten")
	}
	os.WriteFile(p, []byte("external"), 0644)
	d := edit(t, w, "my changed version")
	if !d.Conflict {
		t.Fatal("conflict not detected")
	}
	b, _ = os.ReadFile(p)
	if string(b) != "external" {
		t.Fatal("external content overwritten")
	}
	r, e := w.Reload(d.ID)
	if e != nil {
		t.Fatal(e)
	}
	if r.Current.Content != "external" || len(r.Recent) != 3 {
		t.Fatalf("reload lost recovery copy %+v", r.Recent)
	}
}
func TestImagesSaveAsExportAndCodeUnchanged(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, e := w.ImportImage(d.ID, "demo.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if e != nil {
		t.Fatal(e)
	}
	content := "# 图文\n\n![测试](" + im.Destination + ")\n\n```md\n![示例](not-real.png)\n```\n"
	edit(t, w, content)
	p := filepath.Join(t.TempDir(), "中文文稿.md")
	result, e := w.SaveAs(d.ID, p)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(result.Document.Content, "liubai-asset:") || !strings.Contains(result.Document.Content, "![示例](not-real.png)") {
		t.Fatal("invalid image rewrite")
	}
	_, e = w.ReadImage(d.ID, imageTargets(result.Document.Content)[0])
	if e != nil {
		t.Fatal(e)
	}
	z := filepath.Join(t.TempDir(), "article.zip")
	r, e := w.Export(d.ID, z, false)
	if e != nil || len(r.Missing) > 0 {
		t.Fatalf("export %v %+v", e, r)
	}
	archive, e := zip.OpenReader(z)
	if e != nil {
		t.Fatal(e)
	}
	defer archive.Close()
	if len(archive.File) != 2 {
		t.Fatal("export should contain only one image and markdown")
	}
	b, _ := os.ReadFile(p)
	if string(b) != result.Document.Content {
		t.Fatal("export changed original")
	}
	for _, file := range archive.File {
		if file.Name == "文稿.md" {
			f, _ := file.Open()
			text, _ := io.ReadAll(f)
			f.Close()
			if !strings.Contains(string(text), "images/") {
				t.Fatal("relative image absent")
			}
		}
	}
	// Undo may bring the old draft destination back after Save As. It must still save portable markdown.
	d = w.State().Current
	d, e = w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: content})
	if e != nil {
		t.Fatal(e)
	}
	b, _ = os.ReadFile(p)
	if strings.Contains(string(b), "liubai-asset:") {
		t.Fatal("undo leaked internal asset URI into saved markdown")
	}
}
func TestReferenceImageRewriteAndMissingExport(t *testing.T) {
	s := "![photo][p]\n\n[p]: <images/a.png> \"caption\"\n\n`![photo](images/a.png)`\n"
	rewritten := rewriteImages(s, map[string]string{"images/a.png": "new/a.png"})
	if !strings.Contains(rewritten, "[p]: <new/a.png>") || !strings.Contains(rewritten, "`![photo](images/a.png)`") {
		t.Fatal(rewritten)
	}
	w := workspace(t)
	d := edit(t, w, "![missing](none.png)")
	p := filepath.Join(t.TempDir(), "out.zip")
	r, e := w.Export(d.ID, p, false)
	if e != nil || len(r.Missing) != 1 {
		t.Fatal("missing not reported")
	}
	if _, e = os.Stat(p); !os.IsNotExist(e) {
		t.Fatal("incomplete zip produced without permission")
	}
}
func TestImageRemovalDoesNotDeleteAsset(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, e := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if e != nil {
		t.Fatal(e)
	}
	edit(t, w, "![a]("+im.Destination+")")
	edit(t, w, "")
	edit(t, w, "![a]("+im.Destination+")")
	if _, e = w.ReadImage(d.ID, im.Destination); e != nil {
		t.Fatal(e)
	}
}

func TestDiskSaveRetryAndMixedLineEndings(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "mixed.md")
	original := []byte("first\r\nsecond\nthird\r\n")
	os.WriteFile(p, original, 0644)
	s, e := w.Open(p)
	if e != nil {
		t.Fatal(e)
	}
	edit(t, w, s.Current.Content)
	b, _ := os.ReadFile(p)
	if !bytes.Equal(b, original) {
		t.Fatal("selection save rewrote mixed newlines")
	}
	d := w.State().Current
	d.Content = "pending"
	d.DiskContentHash = ""
	w.mu.Lock()
	w.docs[d.ID] = &d
	w.mu.Unlock()
	edit(t, w, "pending")
	b, _ = os.ReadFile(p)
	if string(b) != "pending" {
		t.Fatal("unchanged pending content was not retried")
	}
}

func TestImageInsertionIntoSavedDocumentUsesPortablePath(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "正文\n")
	p := filepath.Join(t.TempDir(), "note.md")
	if _, e := w.SaveAs(d.ID, p); e != nil {
		t.Fatal(e)
	}
	im, e := w.ImportImage(d.ID, "fixture.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if e != nil {
		t.Fatal(e)
	}
	if strings.HasPrefix(im.Destination, "liubai-asset:") {
		t.Fatal("saved file image still uses draft URI")
	}
	edit(t, w, "正文\n\n![图]("+im.Destination+")\n")
	if _, e = w.ReadImage(d.ID, im.Destination); e != nil {
		t.Fatal(e)
	}
	recovered, e := openWorkspace(w.root)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = recovered.ReadImage(d.ID, im.Destination); e != nil {
		t.Fatal(e)
	}
}

func TestSaveAsKeepsDestinationChangesAndUndoAssetsAcrossFolders(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, e := w.ImportImage(d.ID, "fixture.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if e != nil {
		t.Fatal(e)
	}
	original := "# 🌿 留白\n\n![图](" + im.Destination + ")\n\n继续写。"
	edit(t, w, original)
	first := filepath.Join(t.TempDir(), "第一篇.md")
	r, e := w.SaveAs(d.ID, first)
	if e != nil {
		t.Fatal(e)
	}
	u := utf16.Encode([]rune(original))
	for _, c := range r.Changes {
		u = append(append(append([]uint16{}, u[:c.From]...), utf16.Encode([]rune(c.Insert))...), u[c.To:]...)
	}
	if string(utf16.Decode(u)) != r.Document.Content || len(r.Changes) != 1 {
		t.Fatal("destination changes do not reproduce saved content")
	}
	saved := r.Document.Content
	second := filepath.Join(t.TempDir(), "第二篇.md")
	if _, e = w.SaveAs(d.ID, second); e != nil {
		t.Fatal(e)
	}
	// The original folder can be gone; undo must recover its old destination.
	if e = os.RemoveAll(filepath.Dir(first)); e != nil {
		t.Fatal(e)
	}
	d = edit(t, w, saved)
	if d.Status != "文件已保存" {
		t.Fatal(d.Status)
	}
	b, e := os.ReadFile(second)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(b), "liubai-asset:") {
		t.Fatal("internal URI leaked")
	}
	for _, dest := range imageTargets(string(b)) {
		plain := d
		plain.Content = string(b)
		plain.ImageAliases = nil
		p, e := w.imagePath(&plain, dest)
		if e != nil {
			t.Fatal(e)
		}
		if _, _, e = picture(p); e != nil {
			t.Fatal("saved image cannot travel", e)
		}
	}
}

func TestComplexImageExportFailsBeforeWritingBrokenArchive(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, e := w.ImportImage(d.ID, "fixture.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if e != nil {
		t.Fatal(e)
	}
	content := "![图](\n" + im.Destination + "\n)\n"
	if len(imageTargets(content)) != 1 {
		t.Fatal("invalid test image syntax")
	}
	edit(t, w, content)
	p := filepath.Join(t.TempDir(), "out.zip")
	if _, e = w.Export(d.ID, p, false); e == nil {
		t.Fatal("unsupported rewrite reported success")
	}
	if _, e = os.Stat(p); !os.IsNotExist(e) {
		t.Fatal("broken archive produced")
	}
}
