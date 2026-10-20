package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
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
	if e := w.Appearance(Appearance{Theme: "warm", FollowSystem: false}); e != nil {
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
func TestLineWidthAppearancePersistsAndRejectsUnknown(t *testing.T) {
	for _, width := range []string{"normal", "wide", "full"} {
		t.Run(width, func(t *testing.T) {
			w := workspace(t)
			p := w.State().Appearance
			p.LineWidth = width
			if err := w.Appearance(p); err != nil {
				t.Fatal(err)
			}
			reopened, err := openWorkspace(w.root)
			if err != nil {
				t.Fatal(err)
			}
			if got := reopened.State().Appearance; got != p {
				t.Fatalf("appearance did not persist: %+v, want %+v", got, p)
			}
			invalid := p
			invalid.LineWidth = "unknown"
			err = reopened.Appearance(invalid)
			if e, ok := err.(*catalogError); !ok || e.Key != "bUnknownLineWidth" {
				t.Fatalf("unknown line width error: %v", err)
			}
			if got := reopened.State().Appearance; got != p {
				t.Fatalf("invalid request changed appearance: %+v", got)
			}
		})
	}
}
func TestDockedSidebarAppearancePersists(t *testing.T) {
	w := workspace(t)
	for _, open := range []bool{true, false} {
		p := w.State().Appearance
		p.SidebarDocked = open
		if err := w.Appearance(p); err != nil {
			t.Fatal(err)
		}
		reopened, err := openWorkspace(w.root)
		if err != nil {
			t.Fatal(err)
		}
		for _, current := range []*Workspace{w, reopened} {
			if got := current.State().Appearance; got != p {
				t.Fatalf("appearance = %+v, want %+v", got, p)
			}
		}
		w = reopened
	}
}

func TestOldWorkspaceDefaultsToClosedSidebar(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(w.root, "workspace.json")
	if err := os.WriteFile(p, []byte(`{"version":1,"appearance":{"theme":"warm","layout":"split","followSystem":false}}`), 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.State().Appearance; got.SidebarDocked || got.Theme != "warm" || got.Layout != "split" {
		t.Fatalf("old appearance not preserved with closed sidebar: %+v", got)
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
	before := edit(t, w, s.Current.Content)
	b, _ := os.ReadFile(p)
	if !bytes.Equal(original, b) {
		t.Fatal("unchanged source rewritten")
	}
	os.WriteFile(p, []byte("external"), 0644)
	// Edit from the revision the editor still shows; edit() would call State(),
	// which now reloads a clean draft from disk before the edit lands.
	d, e := w.Update(Edit{ID: before.ID, Revision: before.Revision, Content: "my changed version"})
	if e != nil {
		t.Fatal(e)
	}
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
	// Opening the file cleans the initial empty draft, leaving the file and recovery copy.
	if r.Current.Content != "external" || len(r.Recent) != 2 {
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

func TestFailedDraftWriteCanRetryWithoutLosingRevision(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "原始内容")
	file := filepath.Join(w.root, "drafts", d.ID+".json")
	old, e := os.ReadFile(file)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.Remove(file); e != nil {
		t.Fatal(e)
	}
	if e = os.Mkdir(file, 0700); e != nil {
		t.Fatal(e)
	}
	if _, e = w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "最新修改"}); e == nil {
		t.Fatal("expected write failure")
	}
	if got := w.State().Current; got.Revision != d.Revision || got.Content != d.Content {
		t.Fatal("failed transaction changed durable state")
	}
	if e = os.Remove(file); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(file, old, 0600); e != nil {
		t.Fatal(e)
	}
	got, e := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "最新修改"})
	if e != nil || got.Content != "最新修改" {
		t.Fatal(e)
	}
	recovered, e := openWorkspace(w.root)
	if e != nil || recovered.State().Current.Content != "最新修改" {
		t.Fatal("retry recovery", e)
	}
}
func TestDeliverySnapshotEmbedsLocalImagesAndReportsMissing(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, e := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if e != nil {
		t.Fatal(e)
	}
	s := "# 图文\n\n![图](" + im.Destination + ")\n\n![不存在](missing.png)\n\n![联网](https://example.com/p.png)\n\n最后一段"
	edit(t, w, s)
	r, e := w.Delivery(d.ID)
	if e != nil {
		t.Fatal(e)
	}
	if r.Content != s || len(r.Images) != 1 || len(r.Missing) != 1 || r.External != 1 {
		t.Fatal("incomplete delivery")
	}
	if !strings.HasPrefix(r.Images[im.Destination], "data:image/png;base64,") {
		t.Fatal("image not embedded")
	}
	edit(t, w, "后续编辑")
	if r.Content != s {
		t.Fatal("delivery snapshot mutated")
	}
}
func TestRecoverySavesLatestContentAndImagesWithoutOverwritingOriginal(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, e := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if e != nil {
		t.Fatal(e)
	}
	original := filepath.Join(t.TempDir(), "original.md")
	edit(t, w, "已保存正文")
	if _, e = w.SaveAs(d.ID, original); e != nil {
		t.Fatal(e)
	}
	latest := "# 尚未保存的文字\n\n![图](" + im.Destination + ")"
	path := filepath.Join(t.TempDir(), "recovery.md")
	if _, e = w.SaveRecovery(d.ID, latest, path); e != nil {
		t.Fatal(e)
	}
	b, e := os.ReadFile(path)
	if e != nil || !strings.Contains(string(b), "尚未保存的文字") || strings.Contains(string(b), "liubai-asset:") {
		t.Fatal("recovery not portable", e)
	}
	b, e = os.ReadFile(original)
	if e != nil || string(b) != "已保存正文" {
		t.Fatal("original overwritten")
	}
	if _, e = w.SaveRecovery(d.ID, latest, original); e == nil {
		t.Fatal("recovery may overwrite original")
	}
}

// A commit that lost the document (ReplaceFileW's ERROR_UNABLE_TO_MOVE_REPLACEMENT
// followed by a failed rename) leaves the only copy on disk in the temporary file.
func TestAtomicWriteKeepsTheTemporaryFileWhenCommitLostTheDocument(t *testing.T) {
	for _, tt := range []struct {
		err  error
		kept bool
	}{
		{errors.New("busy"), false},
		{fmt.Errorf("%w: rename failed", errKeptTemp), true},
	} {
		dir := t.TempDir()
		err := atomicWriteWith(filepath.Join(dir, "a.md"), []byte("text"), 0644, func(string) error { return tt.err })
		entries, _ := os.ReadDir(dir)
		if !errors.Is(err, tt.err) || (len(entries) == 1) != tt.kept {
			t.Errorf("commit error %q: atomicWriteWith = %v with %d files left, want kept %v", tt.err, err, len(entries), tt.kept)
		}
	}
}
