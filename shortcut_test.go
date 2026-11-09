package main

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

// MyGo v0.8 names a key by its position in InputEvent.Code. Keys left out of
// KeyPressed events, as a modifier on its own, arrive through HandleInput
// with Key and PhysicalKey unknown and only Code set, which is why the
// recorder reads Code first and falls back to the key by position on an ANSI
// US keyboard (PhysicalKey) and then the key the layout types (Key).

func TestSettingsShortcut(t *testing.T) {
	tests := []struct {
		name string
		ev   ui.InputEvent
		want string
	}{
		{
			name: "Cmd N by code",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeKeyN, Mods: ui.Super},
			want: "Cmd+N",
		},
		{
			name: "Shift Cmd Z by code",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeKeyZ, Mods: ui.Super | ui.Shift},
			want: "Cmd+Shift+Z",
		},
		{
			name: "F5 by code",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeF5, Mods: ui.Super},
			want: "Cmd+F5",
		},
		{
			name: "Up arrow by code",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeArrowUp, Mods: ui.Super},
			want: "Cmd+Up",
		},
		{
			name: "slash by code",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeSlash, Mods: ui.Super},
			want: "Cmd+/",
		},
		{
			name: "last digit by code",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeDigit5, Mods: ui.Ctrl},
			want: "Ctrl+5",
		},
		{
			// Codes are USB HID usages where 0 follows 9.
			name: "zero by code",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeDigit0, Mods: ui.Alt},
			want: "Alt+0",
		},
		{
			// CodeUnknown: the key by position of a non-US layout, as S
			// pressed on a Cyrillic layout, which names no Key.
			name: "code unknown falls back to the physical key",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Key: ui.KeyUnknown, PhysicalKey: ui.KeyS, Code: ui.CodeUnknown, Mods: ui.Super},
			want: "Cmd+S",
		},
		{
			// A backend that reports neither a code nor a physical key.
			name: "code and physical key unknown fall back to the typed key",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Key: ui.KeyA, PhysicalKey: ui.KeyUnknown, Code: ui.CodeUnknown, Mods: ui.Ctrl},
			want: "Ctrl+A",
		},
		{
			name: "shift alone makes no shortcut",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Key: ui.KeyUnknown, PhysicalKey: ui.KeyUnknown, Code: ui.CodeShiftLeft, Mods: ui.Shift},
			want: "",
		},
		{
			name: "no command control or option makes no shortcut",
			ev:   ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeKeyN, Mods: ui.Shift},
			want: "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := settingsShortcut(tc.ev); got != tc.want {
				t.Fatalf("settingsShortcut(%+v) = %q, want %q", tc.ev, got, tc.want)
			}
		})
	}
}

// recordingSettings returns a settings window recording a shortcut on a
// fresh workspace, whose default shortcut is left untouched until a test
// records one.
func recordingSettings(t *testing.T) *settingsWindow {
	t.Helper()
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return &settingsWindow{desktop: &Desktop{w: w}, recording: true}
}

func TestRecordShortcutByCode(t *testing.T) {
	s := recordingSettings(t)
	if taken := s.recordShortcut(ui.InputEvent{Kind: ui.InputKeyDown, Code: ui.CodeKeyN, Mods: ui.Super}); !taken {
		t.Fatal("the recorder must take the shortcut's key")
	}
	if s.recording {
		t.Fatal("recording did not end after a shortcut")
	}
	if got := s.desktop.GetCaptureSettings().Settings.Shortcut; got != "Cmd+N" {
		t.Fatalf("recorded shortcut %q, want %q", got, "Cmd+N")
	}
}

func TestRecordShortcutFallsBackToPhysicalKey(t *testing.T) {
	s := recordingSettings(t)
	ev := ui.InputEvent{Kind: ui.InputKeyDown, Key: ui.KeyUnknown, PhysicalKey: ui.KeyS, Code: ui.CodeUnknown, Mods: ui.Super}
	if taken := s.recordShortcut(ev); !taken {
		t.Fatal("the recorder must take the shortcut's key")
	}
	if got := s.desktop.GetCaptureSettings().Settings.Shortcut; got != "Cmd+S" {
		t.Fatalf("recorded shortcut %q, want %q, for a non-US layout", got, "Cmd+S")
	}
}

func TestRecordShortcutLoneModifierDoesNotRecord(t *testing.T) {
	s := recordingSettings(t)
	before := s.desktop.GetCaptureSettings().Settings.Shortcut
	ev := ui.InputEvent{Kind: ui.InputKeyDown, Key: ui.KeyUnknown, PhysicalKey: ui.KeyUnknown, Code: ui.CodeShiftLeft, Mods: ui.Shift}
	if taken := s.recordShortcut(ev); !taken {
		t.Fatal("recording must take a modifier pressed alone")
	}
	if got := s.desktop.GetCaptureSettings().Settings.Shortcut; got != before {
		t.Fatalf("a modifier pressed alone recorded %q", got)
	}
	if !s.recording {
		t.Fatal("a modifier pressed alone ended recording")
	}
}

func TestRecordShortcutIgnoresUnidentifiedKey(t *testing.T) {
	s := recordingSettings(t)
	before := s.desktop.GetCaptureSettings().Settings.Shortcut
	// Neither Key nor Code names the key, as for a key an input method keeps
	// from the application.
	ev := ui.InputEvent{Kind: ui.InputKeyDown}
	if taken := s.recordShortcut(ev); !taken {
		t.Fatal("recording must take a key it cannot name")
	}
	if got := s.desktop.GetCaptureSettings().Settings.Shortcut; got != before {
		t.Fatalf("an unidentified key recorded %q", got)
	}
	if !s.recording {
		t.Fatal("an unidentified key ended recording")
	}
}
