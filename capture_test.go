package main

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/egoist/mygo"
)

func TestCapturePreservesCurrentAndPersistsNewestDraft(t *testing.T) {
	root := t.TempDir()
	w, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	before := w.State().Current
	// Simulate an ahead-of-clock draft; each capture must still sort first.
	w.docs[before.ID].Updated = 1 << 50
	before = w.State().Current
	first, err := w.Capture("第一行想法\n第二行内容")
	if err != nil {
		t.Fatal(err)
	}
	second, err := w.Capture("另一条想法")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID || first.Path != "" || first.Title != "第一行想法" {
		t.Fatalf("capture summaries: %+v %+v", first, second)
	}
	after := w.State()
	if !reflect.DeepEqual(before, after.Current) {
		t.Fatalf("current changed: %+v", after.Current)
	}
	if after.Recent[0].ID != second.ID {
		t.Fatalf("recent = %+v", after.Recent)
	}
	reopened, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.State().Current.ID != before.ID || reopened.State().Recent[0].ID != second.ID {
		t.Fatal("capture changed current or lost recent order on reopen")
	}
	got, err := reopened.Activate(first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Current.Content != "第一行想法\n第二行内容" || got.Current.Title != "第一行想法" {
		t.Fatalf("draft = %+v", got.Current)
	}
}

func TestCaptureRejectsEmptyAndInvalidContent(t *testing.T) {
	w, _ := openWorkspace(t.TempDir())
	count := len(w.State().Recent)
	for _, text := range []string{"", " \n\t", "\u3000"} {
		if _, err := w.Capture(text); err == nil || err.Error() != "随手记是空的" {
			t.Fatalf("Capture(%q): %v", text, err)
		}
	}
	for _, text := range []string{strings.Repeat("x", maxDocument+1), string([]byte{0xff})} {
		if _, err := w.Capture(text); err == nil {
			t.Fatal("invalid content accepted")
		}
	}
	if len(w.State().Recent) != count {
		t.Fatal("rejected capture created a draft")
	}
}

func TestCaptureSettingsDefaultsValidationAndPersistence(t *testing.T) {
	root := t.TempDir()
	w, _ := openWorkspace(root)
	want := CaptureSettings{Enabled: true, Shortcut: defaultCaptureShortcut()}
	if got := w.State().Capture; got != want {
		t.Fatalf("defaults = %+v", got)
	}
	saved := CaptureSettings{Enabled: false, Shortcut: "Alt+Shift+Space", OpenAtLogin: true}
	if err := w.SetCaptureSettings(saved); err != nil {
		t.Fatal(err)
	}
	w, _ = openWorkspace(root)
	if got := w.State().Capture; got != saved {
		t.Fatalf("reopened = %+v", got)
	}
	saved.Shortcut = "Shift+Unknown"
	if err := w.SetCaptureSettings(saved); err != nil {
		t.Fatal(err)
	}
	if got := w.State().Capture.Shortcut; got != want.Shortcut {
		t.Fatalf("invalid shortcut = %q", got)
	}
	// Missing and unrecognized values in older/newer indices use per-field defaults.
	if err := os.WriteFile(filepath.Join(root, "workspace.json"), []byte(`{"version":1,"capture":{"enabled":"unknown","shortcut":"invalid","openAtLogin":"unknown"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	w, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := w.State().Capture; got != want {
		t.Fatalf("unknown settings = %+v", got)
	}
}

// Cmd would be the Windows key, so other systems default to Ctrl+Alt+N.
func TestQuickNoteShortcutDefaultsPerPlatform(t *testing.T) {
	want := "Ctrl+Alt+N"
	if runtime.GOOS == "darwin" {
		want = "Ctrl+Alt+Cmd+N"
	}
	if got := defaultCaptureShortcut(); got != want || !validCaptureShortcut(got) {
		t.Fatalf("default shortcut %q, want %q", got, want)
	}
}

func TestCaptureAcceleratorValidation(t *testing.T) {
	for _, s := range []string{"Ctrl+Alt+Cmd+N", "Cmd+N", "Alt+Shift+Space", "Ctrl+Enter", "Cmd+F12", "Ctrl+1", "Cmd+Plus", "Ctrl++"} {
		if !validCaptureShortcut(s) {
			t.Errorf("valid shortcut rejected: %q", s)
		}
	}
	for _, s := range []string{"", "N", "Shift+N", "Cmd", "Ctrl+Alt", "Ctrl+", "Cmd+Unknown", "Hyper+N", "Cmd+N+X", "Cmd+Cmd+N"} {
		if validCaptureShortcut(s) {
			t.Errorf("invalid shortcut accepted: %q", s)
		}
	}
}

type fakeCaptureRegistrar struct {
	keys  map[string]func()
	taken string
}

func (f *fakeCaptureRegistrar) Register(key string, fn func()) error {
	if key == f.taken {
		return errors.New("taken")
	}
	if f.keys == nil {
		f.keys = map[string]func(){}
	}
	f.keys[key] = fn
	return nil
}
func (f *fakeCaptureRegistrar) Unregister(key string) { delete(f.keys, key) }

func TestCaptureSettingsHandlerRegistersAndReportsTakenShortcut(t *testing.T) {
	w, _ := openWorkspace(t.TempDir())
	f := &fakeCaptureRegistrar{}
	toggles := 0
	login := false
	d := &Desktop{w: w, capture: &captureController{registrar: f, toggle: func() { toggles++ }, setOpenAtLogin: func(v bool) error { login = v; return nil }}}
	p := w.State().Capture
	if err := d.SetCaptureSettings(p); err != nil {
		t.Fatal(err)
	}
	f.keys[p.Shortcut]()
	if toggles != 1 {
		t.Fatal("shortcut did not toggle")
	}
	p.Shortcut = "Cmd+Shift+J"
	p.OpenAtLogin = true
	if err := d.SetCaptureSettings(p); err != nil {
		t.Fatal(err)
	}
	if len(f.keys) != 1 || f.keys[p.Shortcut] == nil || !login {
		t.Fatal("shortcut not replaced or login not set")
	}
	p.Enabled = false
	if err := d.SetCaptureSettings(p); err != nil {
		t.Fatal(err)
	}
	if len(f.keys) != 0 {
		t.Fatal("disabled shortcut remains registered")
	}
	p.Enabled = true
	f.taken = p.Shortcut
	if err := d.SetCaptureSettings(p); err == nil || err.Error() != "快捷键 Cmd+Shift+J 已被其他应用占用" {
		t.Fatalf("error = %v", err)
	}
	if w.State().Capture != p {
		t.Fatal("taken shortcut setting was not kept")
	}
	if got := d.GetCaptureSettings(); got.Error != "快捷键 Cmd+Shift+J 已被其他应用占用" {
		t.Fatalf("page status = %+v", got)
	}
	f.taken = ""
	if err := d.SetCaptureSettings(p); err != nil {
		t.Fatal(err)
	}
	if len(f.keys) != 1 {
		t.Fatal("failed shortcut could not be retried")
	}
}

func TestCapturePanelHidesNormallyButAllowsApprovedQuit(t *testing.T) {
	d := &Desktop{}
	closeEvent := &mygo.CloseEvent{}
	d.handleCaptureClose(closeEvent)
	if !closeEvent.DefaultPrevented() {
		t.Fatal("ordinary capture close must be prevented")
	}
	d.allowClose.Store(true)
	quitEvent := &mygo.CloseEvent{}
	d.handleCaptureClose(quitEvent)
	if quitEvent.DefaultPrevented() {
		t.Fatal("capture panel must not cancel an approved application quit")
	}
}

func TestCaptureSettingsRetriesFailedLoginChange(t *testing.T) {
	w := workspace(t)
	calls := 0
	fail := true
	d := &Desktop{w: w, capture: &captureController{registrar: &fakeCaptureRegistrar{}, toggle: func() {}, setOpenAtLogin: func(bool) error {
		calls++
		if fail {
			return errors.New("login rejected")
		}
		return nil
	}}}
	p := w.State().Capture
	p.OpenAtLogin = true
	if err := d.SetCaptureSettings(p); err == nil {
		t.Fatal("expected login error")
	}
	p.Shortcut = "Cmd+Shift+J"
	if err := d.SetCaptureSettings(p); err == nil {
		t.Fatal("unapplied login setting must be retried and failure must remain visible")
	}
	if calls != 2 || d.GetCaptureSettings().Error != "login rejected" {
		t.Fatal("login failure was forgotten")
	}
	fail = false
	if err := d.SetCaptureSettings(p); err != nil {
		t.Fatal(err)
	}
	if calls != 3 || d.GetCaptureSettings().Error != "" {
		t.Fatal("login retry did not complete")
	}
}
