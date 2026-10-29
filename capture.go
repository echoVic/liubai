package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"liubai/locales"
)

// defaultCaptureShortcut is ⌃⌥⌘N on macOS. Elsewhere Cmd would be the
// Windows key, so the default is Ctrl+Alt+N, Evernote's new-note shortcut.
func defaultCaptureShortcut() string {
	if runtime.GOOS == "darwin" {
		return "Ctrl+Alt+Cmd+N"
	}
	return "Ctrl+Alt+N"
}

type CaptureSettings struct {
	Enabled     bool   `json:"enabled"`
	Shortcut    string `json:"shortcut"`
	OpenAtLogin bool   `json:"openAtLogin"`
}

func defaultCaptureSettings() CaptureSettings {
	return CaptureSettings{Enabled: true, Shortcut: defaultCaptureShortcut()}
}

// Decode fields separately so unknown settings do not discard the workspace index.
func (p *CaptureSettings) UnmarshalJSON(b []byte) error {
	*p = defaultCaptureSettings()
	var fields map[string]json.RawMessage
	if json.Unmarshal(b, &fields) != nil {
		return nil
	}
	var enabled, login bool
	if json.Unmarshal(fields["enabled"], &enabled) == nil && string(fields["enabled"]) != "null" {
		p.Enabled = enabled
	}
	if json.Unmarshal(fields["openAtLogin"], &login) == nil {
		p.OpenAtLogin = login
	}
	var shortcut string
	if json.Unmarshal(fields["shortcut"], &shortcut) == nil && validCaptureShortcut(shortcut) {
		p.Shortcut = shortcut
	}
	return nil
}

// Limit accelerators to keys MyGo can register, with a command/control/option modifier.
func validCaptureShortcut(s string) bool {
	parts := strings.Split(s, "+")
	if strings.HasSuffix(s, "++") {
		parts = append(parts[:len(parts)-2], "Plus")
	}
	if len(parts) < 2 {
		return false
	}
	seen := map[string]bool{}
	primary := false
	for _, part := range parts[:len(parts)-1] {
		mod := strings.ToLower(part)
		switch mod {
		case "ctrl", "control":
			mod = "ctrl"
		case "cmd", "command", "meta", "super", "cmdorctrl", "commandorcontrol":
			mod = "cmd"
		case "alt", "option":
			mod = "alt"
		case "shift":
		default:
			return false
		}
		if seen[mod] {
			return false
		}
		seen[mod] = true
		if mod != "shift" {
			primary = true
		}
	}
	if !primary {
		return false
	}
	key := parts[len(parts)-1]
	if len(key) == 1 && key[0] >= 33 && key[0] <= 126 {
		return true
	}
	switch strings.ToLower(key) {
	case "plus", "space", "tab", "backspace", "delete", "insert", "enter", "return", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "escape":
		return true
	}
	if strings.HasPrefix(key, "F") {
		n, e := strconv.Atoi(key[1:])
		return e == nil && n >= 1 && n <= 24 && key == fmt.Sprintf("F%d", n)
	}
	return false
}

func (w *Workspace) Capture(text string) (Summary, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if strings.TrimSpace(text) == "" {
		return Summary{}, messageError("bCaptureEmpty", nil)
	}
	if len(text) > maxDocument || !utf8.ValidString(text) {
		return Summary{}, messageError("bInvalidDocument", nil)
	}
	d := &Document{ID: uid(), Content: text, Title: inferredTitle(text), Updated: time.Now().UnixMilli(), StatusCode: "draftSaved", Status: locales.In("zh-Hans").BStatusDraftSaved()}
	// Millisecond resolution can tie during rapid captures. Keep newest-first deterministic.
	for id, other := range w.docs {
		if id != d.ID && other.Updated >= d.Updated {
			d.Updated = other.Updated + 1
		}
	}
	if err := w.persist(d); err != nil {
		return Summary{}, err
	}
	w.docs[d.ID] = d
	return summaryOf(d), nil
}

func (w *Workspace) SetCaptureSettings(p CaptureSettings) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !validCaptureShortcut(p.Shortcut) {
		p.Shortcut = defaultCaptureShortcut()
	}
	old := w.capture
	w.capture = p
	if err := w.saveIndex(); err != nil {
		w.capture = old
		return err
	}
	return nil
}

type shortcutRegistrar interface {
	Register(string, func()) error
	Unregister(string)
}

type captureController struct {
	mu             sync.Mutex
	registrar      shortcutRegistrar
	registered     string
	loginKnown     bool
	loginApplied   bool
	toggle         func()
	setOpenAtLogin func(bool) error
	errorText      string
	lastError      error
}

type CaptureStatus struct {
	Settings   CaptureSettings `json:"settings"`
	Error      string          `json:"error"`
	errorCause error
}

func (c *captureController) apply(p CaptureSettings) error {
	var shortcutErr, loginErr error
	if c.registered != "" && (!p.Enabled || c.registered != p.Shortcut) {
		c.registrar.Unregister(c.registered)
		c.registered = ""
	}
	if p.Enabled && c.registered == "" {
		if err := c.registrar.Register(p.Shortcut, c.toggle); err != nil {
			shortcutErr = messageError("bShortcutUnavailable", map[string]any{"shortcut": p.Shortcut})
		} else {
			c.registered = p.Shortcut
		}
	}
	if !c.loginKnown || c.loginApplied != p.OpenAtLogin {
		loginErr = c.setOpenAtLogin(p.OpenAtLogin)
		if loginErr == nil {
			c.loginKnown = true
			c.loginApplied = p.OpenAtLogin
		}
	}
	err := errors.Join(shortcutErr, loginErr)
	c.lastError = err
	c.errorText = ""
	if err != nil {
		c.errorText = err.Error()
	}
	return err
}
