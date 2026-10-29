package main

import (
	"encoding/json"
	"strings"

	"liubai/locales"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/i18n"
)

// localeMessage retains message identity until the destination language is known.
// It never rewrites document content, titles chosen by the user, or system errors.
type localeMessage struct {
	Key  string         `json:"key,omitempty"`
	Args map[string]any `json:"args,omitempty"`
	Text string         `json:"text,omitempty"`
}

func (m localeMessage) render(locale string) string {
	if m.Key == "" {
		return m.Text
	}
	if locale == "" {
		locale = i18n.Locale()
	}
	return locales.Catalog.Format(locale, m.Key, m.Args)
}

type catalogError struct{ localeMessage }

func (e *catalogError) Error() string { return e.render("") }
func messageError(key string, args map[string]any) error {
	return &catalogError{localeMessage{Key: key, Args: args}}
}
func errorIn(err error, locale string) string {
	if err == nil {
		return ""
	}
	if e, ok := err.(*catalogError); ok {
		return e.render(locale)
	}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		parts := []string{}
		for _, child := range joined.Unwrap() {
			if child != nil {
				parts = append(parts, errorIn(child, locale))
			}
		}
		return strings.Join(parts, "\n")
	}
	return err.Error()
}
func (w *Workspace) notifyMessage(message localeMessage) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.notices = append(w.notices, message)
}

// Legacy prose remains available to old clients. New clients and native state
// use StatusCode, so language changes cannot change save/conflict behavior.
func (d *Document) setStatus(code string) {
	d.StatusCode = code
	if key := statusMessageKeys[code]; key != "" {
		d.Status = locales.Catalog.Format("zh-Hans", key, nil)
	}
}
func (d *Document) UnmarshalJSON(b []byte) error {
	type plain Document
	var value plain
	if err := json.Unmarshal(b, &value); err != nil {
		return err
	}
	*d = Document(value)
	if d.StatusCode != "" {
		return nil
	}
	for code, key := range statusMessageKeys {
		if d.Status == locales.Catalog.Format("zh-Hans", key, nil) || d.Status == locales.Catalog.Format("en", key, nil) {
			d.StatusCode = code
			return nil
		}
	}
	code := "draftSaved"
	if d.Path != "" {
		code = "fileSaved"
	}
	if d.Conflict {
		code = "diskConflict"
	}
	if d.Status == "" {
		d.setStatus(code)
	} else {
		d.StatusCode = code
	}
	return nil
}
func (d Document) saveFailed() bool {
	switch d.StatusCode {
	case "imageSaveFailed", "fileSaveFailed", "fileReadOnly", "saveFailed", "recoveryUpdateFailed", "reloadRecoveryFailed":
		return true
	}
	return false
}

var statusMessageKeys = map[string]string{
	"draftSaved": "bStatusDraftSaved", "fileSaved": "bStatusFileSaved",
	"fileReadOnly":    "bStatusFileReadOnly",
	"fileUnavailable": "bStatusFileUnavailable", "diskUnreadable": "bStatusDiskUnreadable",
	"diskReloaded": "bStatusDiskReloaded", "reloadRecoveryFailed": "bStatusReloadRecoveryFailed",
	"diskConflict": "bStatusDiskConflict", "imageSaveFailed": "bStatusImageSaveFailed",
	"fileSaveFailed": "bStatusFileSaveFailed", "saveFailed": "bStatusSaveFailed",
	"recoveryUpdateFailed": "bStatusRecoveryUpdateFailed",
}

// SetLocale changes the native app's persisted preference. Browser pages keep
// their own preference and send it with each request instead of mutating App.
func (d *Desktop) SetLocale(tag string) error {
	if !knownLocale(tag) {
		return messageError("bInvalidLocale", nil)
	}
	if d.native != nil {
		if d.w != nil {
			d.w.mu.Lock()
			before := d.w.localePreference
			d.w.localePreference = tag
			err := d.w.saveIndex()
			if err != nil {
				d.w.localePreference = before
			}
			d.w.mu.Unlock()
			if err != nil {
				return err
			}
		}
		mygo.App.SetLocale(tag)
		d.refreshLocale()
	}
	return nil
}

// knownLocale reports whether tag is a choice of the language setting: the
// system's languages (""), Chinese or English.
func knownLocale(tag string) bool { return tag == "" || tag == "zh-Hans" || tag == "en" }

func (d *Desktop) refreshLocale() {
	if d.win != nil {
		d.win.SetTitle(locales.BMenuAppName())
		d.win.Update(func() {
			if d.settings != nil && d.settings.win != nil {
				d.settings.win.SetTitle(d.settings.text("fSettingsTitle"))
				d.settings.win.Invalidate()
			}
		})
	}
	if d.capturePanel != nil {
		d.capturePanel.SetTitle(locales.BCaptureWindowTitle())
	}
	if d.menuAction != nil {
		mygo.App.SetMenu(mygo.NewMenu(menuTemplate(d.menuAction)))
	}
	if d.capture != nil {
		d.capture.mu.Lock()
		d.capture.errorText = errorIn(d.capture.lastError, "")
		d.capture.mu.Unlock()
	}
}
func (d Document) generatedTitle() bool {
	return d.Path == "" && !d.CustomTitle && !hasInferredContentTitle(d.Content)
}

func generatedSuffixTitle(title, suffix, locale string) string {
	key := ""
	switch suffix {
	case "recovery":
		key = "bRecoverySuffix"
	case "diskVersion":
		key = "bDiskVersionSuffix"
	}
	if key == "" {
		return title
	}
	for _, tag := range []string{"zh-Hans", "en"} {
		suffix := locales.Catalog.Format(tag, key, nil)
		if strings.HasSuffix(title, suffix) {
			title = strings.TrimSuffix(title, suffix)
			break
		}
	}
	return title + locales.Catalog.Format(locale, key, nil)
}
func documentIn(doc Document, locale string) Document {
	if doc.GeneratedTitleSuffix != "" {
		doc.Title = generatedSuffixTitle(doc.Title, doc.GeneratedTitleSuffix, locale)
	} else if doc.generatedTitle() {
		doc.Title = locales.In(locale).BUntitled()
	}
	if key := statusMessageKeys[doc.StatusCode]; key != "" {
		doc.Status = locales.Catalog.Format(locale, key, nil)
	}
	return doc
}
func valueIn(value any, locale string) any {
	if locale == "" {
		locale = i18n.Locale()
	}
	switch v := value.(type) {
	case WorkspaceState:
		v.Current = documentIn(v.Current, locale)
		v.Recent = append([]Summary(nil), v.Recent...)
		for i := range v.Recent {
			if suffix := v.GeneratedTitleSuffixes[v.Recent[i].ID]; suffix != "" {
				v.Recent[i].Title = generatedSuffixTitle(v.Recent[i].Title, suffix, locale)
			} else if v.GeneratedTitles[v.Recent[i].ID] {
				v.Recent[i].Title = locales.In(locale).BUntitled()
			}
		}
		if len(v.NoticeMessages) > 0 {
			v.Notices = nil
			for _, message := range v.NoticeMessages {
				v.Notices = append(v.Notices, message.render(locale))
			}
		}
		return v
	case Document:
		return documentIn(v, locale)
	case DocStatus:
		if key := statusMessageKeys[v.StatusCode]; key != "" {
			v.Status = locales.Catalog.Format(locale, key, nil)
		}
		return v
	case ExportResult:
		v.Document = documentIn(v.Document, locale)
		return v
	case CaptureAppendResult:
		v.Document = documentIn(v.Document, locale)
		v.Summary.Title = v.Document.Title
		if v.Summary.Warning != "" {
			v.Summary.Warning = v.Document.Status
		}
		return v
	case CaptureStatus:
		v.Error = errorIn(v.errorCause, locale)
		return v
	case CaptureContext:
		v.titles.Recent = v.Recent
		v.Recent = valueIn(v.titles, locale).(WorkspaceState).Recent
		return v
	}
	return value
}
