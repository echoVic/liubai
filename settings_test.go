package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

func TestAppearanceChangesPreserveOtherPreferences(t *testing.T) {
	root := t.TempDir()
	w, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	d := &Desktop{w: w}
	before := w.State().Appearance
	before.Layout, before.Source, before.SidebarDocked = "split", true, true
	if err := w.Appearance(before); err != nil {
		t.Fatal(err)
	}
	theme, auto := "moon", "off"
	got, err := d.UpdateAppearance(AppearanceChange{Theme: &theme, Auto: &auto})
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != "moon" || got.Layout != "split" || !got.Source || !got.SidebarDocked {
		t.Fatalf("settings replaced editor preferences: %+v", got)
	}
	source := false
	got, err = d.UpdateAppearance(AppearanceChange{Source: &source})
	if err != nil || got.Source || got.Theme != "moon" {
		t.Fatalf("editor replaced settings: %+v, %v", got, err)
	}
	reopened, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.State().Appearance != got {
		t.Fatal("appearance changes were not persisted")
	}
}

func TestInvalidAppearanceChangeKeepsSavedPreferences(t *testing.T) {
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	d := &Desktop{w: w}
	before := w.State().Appearance
	font := 100
	if _, err := d.UpdateAppearance(AppearanceChange{FontSize: &font}); err == nil {
		t.Fatal("accepted invalid font size")
	}
	if w.State().Appearance != before {
		t.Fatal("invalid change modified preferences")
	}
	// A failed save must leave the in-memory value unchanged too.
	if err := w.Appearance(before); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(w.root, "workspace.json"), filepath.Join(w.root, "saved-index.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(w.root, "workspace.json"), 0700); err != nil {
		t.Fatal(err)
	}
	theme := "moon"
	if _, err := d.UpdateAppearance(AppearanceChange{Theme: &theme}); err == nil {
		t.Fatal("expected save failure")
	}
	if w.State().Appearance != before {
		t.Fatal("failed save modified preferences")
	}
}

func TestSettingsTabsAndThemeSelection(t *testing.T) {
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.localePreference = "en"
	s := &settingsWindow{desktop: &Desktop{w: w}}
	tt := ui.NewTester(s.view, 720, 590)
	for _, name := range []string{"Dawn", "Paper", "Warm", "Lamplight", "Ink", "Moonlight", "Mist", "Lotus", "Harvest", "Moon White", "Indigo"} {
		if !tt.HasText(name) {
			t.Fatalf("theme card %q is not visible: %q", name, tt.Texts())
		}
	}
	if err := tt.Click("Indigo"); err != nil {
		t.Fatal(err)
	}
	if w.State().Appearance.Theme != "indigo" {
		t.Fatalf("theme picker failed: %+v, %q", w.State().Appearance, tt.Texts())
	}
	tt.Key(0, ui.KeyHome)
	if w.State().Appearance.Theme != "dawn" {
		t.Fatal("theme cards must support keyboard navigation across both series")
	}
	if err := tt.Click("Quick Note"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("Enable Quick Note"); err != nil {
		t.Fatal(err)
	}
	if w.State().Capture.Enabled {
		t.Fatal("switch did not save Quick Note preference")
	}
	if err := tt.Click("Language"); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText("English") {
		t.Fatalf("language preference was not shown: %q", tt.Texts())
	}
	tt.Key(0, ui.KeyHome)
	if s.tab != 0 || !tt.HasText("Font Size") {
		t.Fatal("tab keyboard navigation failed")
	}
}

func TestSettingsShortcutRecordsAndCancels(t *testing.T) {
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.localePreference = "en"
	s := &settingsWindow{desktop: &Desktop{w: w}, tab: 1}
	tt := ui.NewTester(s.view, 640, 560)
	if err := tt.Click("Keyboard Shortcut"); err != nil {
		t.Fatal(err)
	}
	tt.Key(ui.Ctrl|ui.Alt, ui.KeyK)
	if w.State().Capture.Shortcut != "Ctrl+Alt+K" {
		t.Fatalf("shortcut = %q", w.State().Capture.Shortcut)
	}
	if err := tt.Click("Keyboard Shortcut"); err != nil {
		t.Fatal(err)
	}
	tt.Key(0, ui.KeyEscape)
	if s.recording || w.State().Capture.Shortcut != "Ctrl+Alt+K" {
		t.Fatal("Escape must cancel recording and retain the shortcut")
	}
}

func TestSettingsStopsAutomaticSwitchingAtDisplayedTheme(t *testing.T) {
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.localePreference = "en"
	w.appearance.Auto = "system"
	s := &settingsWindow{desktop: &Desktop{w: w}}
	tt := ui.NewTester(s.view, 720, 960)
	tt.SetDark(true)
	if err := tt.Click("Off"); err != nil {
		t.Fatal(err)
	}
	got := w.State().Appearance
	if got.Auto != "off" || got.Theme != "ink" {
		t.Fatalf("stopping automation changed the displayed theme: %+v", got)
	}
}

func TestSelectingDisplayedThemeStopsAutomation(t *testing.T) {
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.localePreference = "en"
	w.appearance.Auto = "system"
	s := &settingsWindow{desktop: &Desktop{w: w}}
	tt := ui.NewTester(s.view, 720, 650)
	if err := tt.Click("Paper"); err != nil {
		t.Fatal(err)
	}
	if got := w.State().Appearance; got.Auto != "off" || got.Theme != "paper" {
		t.Fatalf("selecting the displayed card must stop automation: %+v", got)
	}
}

func TestSettingsThemeCardsAcrossLocales(t *testing.T) {
	for _, locale := range []string{"en", "zh-Hans"} {
		t.Run(locale, func(t *testing.T) {
			w, err := openWorkspace(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			w.localePreference = locale
			w.appearance.Auto = "off"
			s := &settingsWindow{desktop: &Desktop{w: w}}
			tt := ui.NewTester(s.view, 640, 920)
			for _, theme := range themes {
				name := s.text(themeTextKeys[theme.ID][0])
				r, ok := tt.Find(name)
				if !ok || r.X < 24 || r.X+r.W > 616 || r.Y < 0 || r.Y+r.H > 870 {
					t.Fatalf("theme %s does not fit the small window: %+v", name, r)
				}
				if err := tt.Click(name); err != nil {
					t.Fatal(err)
				}
				if got := w.State().Appearance; got.Theme != theme.ID || got.Auto != "off" {
					t.Fatalf("theme card %s did not save: %+v", theme.ID, got)
				}
			}
		})
	}
}

func TestSettingsSystemThemeDoesNotFollowSelectedCardDarkness(t *testing.T) {
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.localePreference = "en"
	w.appearance.Theme, w.appearance.Auto = "moon", "off"
	s := &settingsWindow{desktop: &Desktop{w: w}}
	var displayed ui.Color
	tt := ui.NewTester(func(c *ui.Context) {
		s.view(c)
		displayed = c.Theme().Background
	}, 720, 960)
	if displayed != nativeThemes["moon"].Background {
		t.Fatal("settings did not adopt the document's palette")
	}
	if err := tt.Click("Follow System"); err != nil {
		t.Fatal(err)
	}
	if displayed != nativeThemes["paper"].Background {
		t.Fatal("a selected dark theme changed the system's light appearance")
	}
	tt.SetDark(true)
	if displayed != nativeThemes["ink"].Background {
		t.Fatal("settings did not follow the system's dark appearance")
	}
	tt.Key(0, ui.KeyHome)
	if got := w.State().Appearance; got.Auto != "off" || got.Theme != "ink" {
		t.Fatalf("keyboard automation controls changed the displayed theme: %+v", got)
	}
}

// revealControl scrolls the window a little at a time until the element
// labeled label is on screen, then clicks it and checks that it opened its
// menu. It scrolls to the control rather than a fixed distance because the
// heights of the texts come from the desktop's fonts: the same fixed
// distance can reach the bottom with one platform's text metrics and stop
// short with another's. The Tester's Find walks labels without checking
// geometry, so a control clipped out of view has an empty box whose center
// Click can still take for a click on the control.
func revealControl(t *testing.T, tt *ui.Tester, width, height int, label, option string) {
	t.Helper()
	const step, tries = 80, 30
	seen := false
	for i := 0; i < tries; i++ {
		if r, ok := tt.Find(label); ok && onScreen(r, width, height) {
			seen = true
			if err := tt.Click(label); err != nil {
				t.Fatalf("click %q: %v", label, err)
			}
			if _, ok := tt.Find(option); ok {
				return
			}
		}
		tt.Scroll(float32(width)/2, float32(height)/2, 0, step)
	}
	if seen {
		t.Fatalf("clicking %q did not open its menu: %q", label, tt.Texts())
	}
	t.Fatalf("settings did not scroll %q into view: %q", label, tt.Texts())
}

// onScreen reports whether r is a box with an area that lies wholly inside a
// window of the given size.
func onScreen(r ui.Rect, width, height int) bool {
	return r.W > 0 && r.H > 0 && r.X >= 0 && r.Y >= 0 &&
		r.X+r.W <= float32(width) && r.Y+r.H <= float32(height)
}

func TestSettingsSmallWindowCanScrollToTypography(t *testing.T) {
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.localePreference = "en"
	w.appearance.Layout, w.appearance.Source = "split", true
	s := &settingsWindow{desktop: &Desktop{w: w}}
	tt := ui.NewTester(s.view, 640, 500)
	// The typography row starts below the fold: the settings window at its
	// minimum size exists to prove the user can scroll to it.
	if r, ok := tt.Find("Body Font Size"); ok && onScreen(r, 640, 500) {
		t.Fatalf("typography is visible at 640x500 before scrolling: %+v", r)
	}
	revealControl(t, tt, 640, 500, "Body Font Size", "15")
	if !tt.Focused("Body Font Size") {
		t.Fatalf("typography select did not take the focus: %q", tt.Texts())
	}
	for _, size := range []string{"15", "16", "17", "18", "19", "20", "21", "22"} {
		if _, ok := tt.Find(size); !ok {
			t.Fatalf("font size menu does not offer %q: %q", size, tt.Texts())
		}
	}
	tt.Key(0, ui.KeyDown)
	tt.Key(0, ui.KeyEnd)
	tt.Key(0, ui.KeyEnter)
	got := w.State().Appearance
	if got.FontSize != 22 || got.Layout != "split" || !got.Source {
		t.Fatalf("scrolled typography control did not preserve editor preferences: %+v", got)
	}
}

func TestSettingsRespectDesktopAccessibilityPreferences(t *testing.T) {
	w, err := openWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.localePreference = "en"
	w.appearance.Auto = "off"
	s := &settingsWindow{desktop: &Desktop{w: w}}
	var displayed ui.Theme
	tt := ui.NewTester(func(c *ui.Context) {
		s.view(c)
		displayed = *c.Theme()
	}, 720, 860)
	before := displayed
	card, _ := tt.Find("Dawn")
	tt.SetPreferences(ui.Preferences{TextScale: 1.5, HighContrast: true})
	if displayed.FontSize != before.FontSize*1.5 || displayed.Border == before.Border || displayed.TextMuted == before.TextMuted {
		t.Fatalf("custom settings discarded desktop accessibility preferences: before=%+v, after=%+v", before, displayed)
	}
	scaled, _ := tt.Find("Dawn")
	if scaled.H < card.H*1.5 || scaled.X+scaled.W > 696 {
		t.Fatalf("theme preview did not make room for larger text: %+v", scaled)
	}
	if err := tt.Click("Quick Note"); err != nil {
		t.Fatal(err)
	}
	if displayed.FontSize != before.FontSize*1.5 || displayed.TextMuted == before.TextMuted {
		t.Fatal("accessibility preferences were lost on another settings tab")
	}
	if err := tt.Click("Appearance"); err != nil {
		t.Fatal(err)
	}
	tt.Scroll(600, 600, 0, 1800)
	if err := tt.Click("Body Font Size"); err != nil {
		t.Fatal(err)
	}
	tt.Key(0, ui.KeyDown)
	tt.Key(0, ui.KeyEnd)
	tt.Key(0, ui.KeyEnter)
	if w.State().Appearance.FontSize != 22 {
		t.Fatal("large-text layout hid the typography controls")
	}
}

func TestNativeDisplayedThemeMatchesAutomaticModes(t *testing.T) {
	for _, tc := range []struct {
		auto, date string
		dark       bool
		want       string
	}{
		{"off", "2026-10-28T19:00:00", false, "lotus"},
		{"system", "2026-10-28T19:00:00", false, "warm"},
		{"system", "2026-10-28T19:00:00", true, "moon"},
		{"hours", "2026-10-28T19:00:00", false, "lamp"},
		{"seasons", "2026-01-01T00:00:00", false, "moonwhite"},
		{"seasons", "2026-02-03T23:59:59", false, "moonwhite"},
		{"seasons", "2026-02-04T00:00:00", false, "mist"},
		{"seasons", "2026-05-05T00:00:00", false, "lotus"},
		{"seasons", "2026-08-07T00:00:00", false, "autumn"},
		{"seasons", "2026-11-07T00:00:00", false, "moonwhite"},
		{"seasons", "2026-08-07T00:00:00", true, "indigo"},
	} {
		now, err := time.Parse("2006-01-02T15:04:05", tc.date)
		if err != nil {
			t.Fatal(err)
		}
		p := Appearance{Theme: "lotus", Auto: tc.auto, LightTheme: "warm", DarkTheme: "moon"}
		if got := resolveAppearanceTheme(p, now, tc.dark); got != tc.want {
			t.Errorf("%s at %s (dark %v): %s, want %s", tc.auto, tc.date, tc.dark, got, tc.want)
		}
	}
}
