package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"liubai/locales"

	"github.com/egoist/mygo/i18n"
)

type Delivery struct {
	Title    string            `json:"title"`
	Content  string            `json:"content"`
	Images   map[string]string `json:"images"`
	Missing  []string          `json:"missing"`
	External int               `json:"external"`
	// source titles the snapshot in the caller's language (deliveryIn).
	source Document
}

// deliveryIn gives the snapshot the title the document list shows in locale.
func deliveryIn(v Delivery, locale string) Delivery {
	if v.source.ID == "" {
		return v
	}
	if locale == "" {
		locale = i18n.Locale()
	}
	v.Title = documentIn(v.source, locale).Title
	return v
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
	result := Delivery{Title: d.Title, Content: d.Content, Images: map[string]string{}, Missing: []string{}, source: *d}
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

// A title is free text, so only a Markdown extension counts as a file extension
// ("Release 0.7.0 plan" keeps its dots), and a slash becomes a dash below.
func documentFilename(title, ext string) string {
	name := title
	if markdownPath(name) {
		name = strings.TrimSuffix(name, filepath.Ext(name))
	}
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
	p, e := resolvedTarget(path)
	if e != nil {
		return ExportResult{}, e
	}
	// Never onto the original, nor onto the file of another open document.
	owner := w.docFor(p)
	if owner == d {
		return ExportResult{}, messageError("bRecoveryNeedsNewName", nil)
	}
	if info, e := os.Lstat(p); e == nil && info.Mode()&os.ModeSymlink != 0 {
		return ExportResult{}, messageError("bRegularFileRequired", nil)
	}
	if err := checkWriteTarget(p); err != nil {
		return ExportResult{}, err
	}
	if owner != nil {
		return ExportResult{}, messageError("bRecoveryNeedsNewName", nil)
	}
	clone := *d
	clone.Content = content
	// The recovery copy is the last resort: pictures that cannot be converted
	// must not cost the text, which is then written as it is.
	if portable, e := w.materialize(&clone, p, true); e == nil {
		clone.Content = portable
	}
	if info, err := os.Stat(p); err == nil {
		e = replaceFile(p, diskBytes(&clone), info.Mode().Perm())
	} else {
		e = atomicWrite(p, diskBytes(&clone), 0644)
	}
	if e != nil {
		return ExportResult{}, e
	}
	return ExportResult{Path: p}, nil
}
