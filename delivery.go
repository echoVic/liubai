package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"liubai/locales"
)

type Delivery struct {
	Title    string            `json:"title"`
	Content  string            `json:"content"`
	Images   map[string]string `json:"images"`
	Missing  []string          `json:"missing"`
	External int               `json:"external"`
}

// Freeze content and image bytes together, so printing never depends on the
// editor viewport or a later workspace update. Remote images are not fetched.
func (w *Workspace) Delivery(id string) (Delivery, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return Delivery{}, messageError("bDocumentMissing", nil)
	}
	result := Delivery{Title: d.Title, Content: d.Content, Images: map[string]string{}, Missing: []string{}}
	total := len(d.Content)
	for _, dest := range imageTargets(d.Content) {
		if external(dest) {
			result.External++
			continue
		}
		path, e := w.imagePath(d, dest)
		if e != nil {
			result.Missing = append(result.Missing, dest)
			continue
		}
		b, info, e := picture(path)
		if e != nil {
			result.Missing = append(result.Missing, dest)
			continue
		}
		total += len(b) * 4 / 3
		if total > 48<<20 {
			return Delivery{}, messageError("bDeliveryTooLarge", nil)
		}
		result.Images[dest] = "data:" + info.MIME + ";base64," + base64.StdEncoding.EncodeToString(b)
	}
	return result, nil
}
func documentFilename(title, ext string) string {
	name := strings.TrimSuffix(filepath.Base(title), filepath.Ext(title))
	name = strings.Map(func(r rune) rune {
		if r < ' ' || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '-'
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." {
		name = locales.BDefaultFilename()
	}
	return name + ext
}

func (w *Workspace) SaveRecovery(id, content, path string) (ExportResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return ExportResult{}, messageError("bDocumentMissing", nil)
	}
	if len(content) > maxDocument || !utf8.ValidString(content) {
		return ExportResult{}, messageError("bInvalidRecoveryDocument", nil)
	}
	p, e := filepath.Abs(path)
	if e != nil {
		return ExportResult{}, e
	}
	if p == d.Path {
		return ExportResult{}, messageError("bRecoveryNeedsNewName", nil)
	}
	if info, e := os.Lstat(p); e == nil && info.Mode()&os.ModeSymlink != 0 {
		return ExportResult{}, messageError("bRegularFileRequired", nil)
	}
	if err := checkWriteTarget(p); err != nil {
		return ExportResult{}, err
	}
	clone := *d
	clone.Content = content
	portable, e := w.materialize(&clone, p, true)
	if e != nil {
		return ExportResult{}, e
	}
	clone.Content = portable
	if e = atomicWrite(p, diskBytes(&clone), 0600); e != nil {
		return ExportResult{}, e
	}
	return ExportResult{Path: p}, nil
}
