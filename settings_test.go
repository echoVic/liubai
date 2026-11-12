package main

import (
	"fmt"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"testing"
	"time"

	"liubai/locales"

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

func TestSettingsFooterOffersFeedbackLink(t *testing.T) {
	for _, tc := range []struct{ locale, label string }{
		{"zh-Hans", "问题反馈…"},
		{"en", "Report an Issue…"},
	} {
		t.Run(tc.locale, func(t *testing.T) {
			w, err := openWorkspace(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			w.localePreference = tc.locale
			s := &settingsWindow{desktop: &Desktop{w: w}}
			tt := ui.NewTester(s.view, 720, 760)
			// The footer keeps the hint that was there, beside the new link.
			if hint := s.text("fChangesApplyImmediatelyYourDocumentAndEditingPositionAre"); !tt.HasText(hint) {
				t.Fatalf("settings footer lost its hint %q: %q", hint, tt.Texts())
			}
			if !tt.HasText(tc.label) {
				t.Fatalf("settings has no feedback link %q: %q", tc.label, tt.Texts())
			}
			// The link sits in the right half of the footer, inside the window.
			r, ok := tt.Find(tc.label)
			if !ok || r.W <= 0 || r.H <= 0 || r.X < 360 || r.X+r.W > 696 || r.Y+r.H > 760 {
				t.Fatalf("feedback link is not right-aligned in the footer: %+v (found %v)", r, ok)
			}
			if err := tt.Click(tc.label); err != nil {
				t.Fatal(err)
			}
			if got := tt.OpenedURLs(); len(got) != 1 || got[0] != feedbackURL {
				t.Fatalf("feedback link opened %v, want %q", got, feedbackURL)
			}
		})
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
	tt := ui.NewTester(s.view, 720, 1080)
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

// As in the page's dialog, Studio runs four across and the check of a
// Seasons or Studio card sits on its tag row, clear of the name, which can
// run to the card's right edge (Catppuccin Latte).
func TestSettingsCheckStaysClearOfThemeNames(t *testing.T) {
	near := func(c color.RGBA, k ui.Color) bool {
		d := func(a, b uint8) int { return max(int(a), int(b)) - min(int(a), int(b)) }
		return d(c.R, k.R)+d(c.G, k.G)+d(c.B, k.B) < 30
	}
	render := func(locale, selected string, width int) (*ui.Tester, *settingsWindow) {
		w, err := openWorkspace(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		w.localePreference = locale
		w.appearance.Theme, w.appearance.Auto = selected, "off"
		s := &settingsWindow{desktop: &Desktop{w: w}}
		return ui.NewTester(s.view, width, 1000), s
	}
	for _, locale := range []string{"en", "zh-Hans"} {
		for _, width := range []int{720, 640} {
			plain, _ := render(locale, "paper", width)
			for _, theme := range themes {
				if theme.Series == "hours" {
					continue
				}
				tt, s := render(locale, theme.ID, width)
				r, ok := tt.Find(s.text(themeTextKeys[theme.ID][0]))
				if !ok {
					t.Fatalf("%s: no card", theme.ID)
				}
				if theme.ID == "github" && width == 720 {
					across := 0
					for _, other := range themes {
						if o, _ := tt.Find(s.text(themeTextKeys[other.ID][0])); other.Series == "studio" && o.Y == r.Y {
							across++
						}
					}
					if across != 4 {
						t.Errorf("%s: %d Studio cards across, want 4", locale, across)
					}
				}
				// The check is the accent the unselected card lacks, the text
				// what it showed too. The border's rounded corners are left out.
				img, before, nt := tt.Image(), plain.Image(), nativeThemes[theme.ID]
				x0, y0, x1, y1 := int(r.X)+8, int(r.Y)+6, int(r.X+r.W)-6, int(r.Y+r.H)-6
				inside := func(x, y int) bool {
					return x >= x0 && x < x1 && y >= y0 && y < y1 && !((x < x0+6 || x >= x1-6) && (y < y0+6 || y >= y1-6))
				}
				had := func(x, y int, match func(color.RGBA) bool) bool { return match(before.RGBAAt(x, y)) }
				accent := func(c color.RGBA) bool { return near(c, nt.Accent) }
				ink := func(c color.RGBA) bool { return !near(c, nt.Surface) }
				check := image.Rectangle{Min: image.Pt(1<<20, 1<<20)}
				var text []image.Point
				for y := y0; y < y1; y++ {
					for x := x0; x < x1; x++ {
						if !inside(x, y) {
							continue
						}
						if c := img.RGBAAt(x, y); accent(c) && !had(x, y, accent) {
							check = check.Union(image.Rect(x, y, x+1, y+1))
						} else if ink(c) && had(x, y, ink) {
							text = append(text, image.Pt(x, y))
						}
					}
				}
				where := fmt.Sprintf("%s %s %dpx", locale, theme.ID, width)
				if check.Dx() == 0 || check.Dx() > 16 || check.Dy() > 16 {
					t.Fatalf("%s: check not found alone: %v in %+v", where, check, r)
				}
				if float32(check.Min.Y) < r.Y+r.H/2 {
					t.Errorf("%s: check at %v is not on the tag row of %+v", where, check, r)
				}
				clear := check.Inset(-2)
				for _, p := range text {
					if p.In(clear) {
						t.Errorf("%s: text at %v touches the check at %v", where, p, check)
						break
					}
				}
			}
		}
	}
}

// The selected card's second border pixel is drawn inside the first, as the
// page's inset shadow is, so the card's name stays where it was.
func TestSettingsSelectedCardKeepsItsContentInPlace(t *testing.T) {
	render := func(selected string) *ui.Tester {
		w, err := openWorkspace(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		w.localePreference = "en"
		w.appearance.Theme, w.appearance.Auto = selected, "off"
		return ui.NewTester((&settingsWindow{desktop: &Desktop{w: w}}).view, 720, 1000)
	}
	plain := render("paper")
	for _, theme := range themes {
		if theme.Series == "hours" {
			continue // centred, so a thicker border never moved it
		}
		tt, nt := render(theme.ID), nativeThemes[theme.ID]
		r, ok := tt.Find(locales.Catalog.Format("en", themeTextKeys[theme.ID][0], nil))
		if !ok {
			t.Fatalf("%s: no card", theme.ID)
		}
		// The top half, clear of the stripe, the border and its corners.
		name := func(img *image.RGBA) image.Rectangle {
			box := image.Rectangle{}
			for y := int(r.Y) + 4; y < int(r.Y+r.H/2); y++ {
				for x := int(r.X) + 10; x < int(r.X+r.W)-10; x++ {
					c := img.RGBAAt(x, y)
					if d := colourDistance(ui.Color{R: c.R, G: c.G, B: c.B, A: 255}, nt.Surface); d > 10 {
						box = box.Union(image.Rect(x, y, x+1, y+1))
					}
				}
			}
			return box
		}
		if before, after := name(plain.Image()), name(tt.Image()); before.Empty() || before != after {
			t.Errorf("%s: name drawn at %v when selected, %v when not", theme.ID, after, before)
		}
	}
}

// The chosen segment of Switch Automatically is Background on a muted track,
// which nord, catppuccin, gruvbox and rosepine make one colour, so an accent
// ring marks it, as on the page. The ring may fall across two pixels.
func TestSettingsChosenSegmentShowsInEveryTheme(t *testing.T) {
	for _, theme := range themes {
		w, err := openWorkspace(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		w.localePreference = "en"
		w.appearance.Theme, w.appearance.Auto = theme.ID, "off"
		tt := ui.NewTester((&settingsWindow{desktop: &Desktop{w: w}}).view, 720, 1080)
		r, ok := tt.Find("Off")
		if !ok || !onScreen(r, 720, 1080) {
			t.Fatalf("%s: segment Off not on screen: %+v", theme.ID, r)
		}
		img, nt := tt.Image(), nativeThemes[theme.ID]
		ringed := func(x, y, dx, dy int) bool {
			for i := -1; i <= 1; i++ {
				c := img.RGBAAt(x+i*dx, y+i*dy)
				pixel := ui.Color{R: c.R, G: c.G, B: c.B, A: 255}
				if ring := colourDistance(pixel, nt.Accent); ring < colourDistance(pixel, nt.Background) && ring < colourDistance(pixel, nt.muted) {
					return true
				}
			}
			return false
		}
		x0, y0, x1, y1 := int(r.X+0.5), int(r.Y+0.5), int(r.X+r.W-0.5), int(r.Y+r.H-0.5)
		missing := 0
		for x := x0 + 6; x < x1-6; x++ {
			if !ringed(x, y0, 0, 1) || !ringed(x, y1, 0, 1) {
				missing++
			}
		}
		for y := y0 + 6; y < y1-6; y++ {
			if !ringed(x0, y, 1, 0) || !ringed(x1, y, 1, 0) {
				missing++
			}
		}
		if missing > 0 {
			t.Errorf("%s: %d edge points of the chosen segment %+v show no accent ring", theme.ID, missing, r)
		}
	}
}

// A button's hover and press show on its face in every theme; solare's card
// and muted are one colour.
func TestSettingsButtonHoverShowsInEveryTheme(t *testing.T) {
	for _, theme := range themes {
		w, err := openWorkspace(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		w.localePreference = "en"
		w.appearance.Theme, w.appearance.Auto = theme.ID, "off"
		tt := ui.NewTester((&settingsWindow{desktop: &Desktop{w: w}, tab: 1}).view, 640, 560)
		// The label is centred in a wider button: its face shows left of it.
		r, ok := tt.Find(displaySettingsShortcut(w.State().Capture.Shortcut))
		if !ok {
			t.Fatalf("%s: shortcut button not found: %q", theme.ID, tt.Texts())
		}
		face := func() ui.Color {
			c := tt.Image().RGBAAt(int(r.X)-8, int(r.Y+r.H/2))
			return ui.Color{R: c.R, G: c.G, B: c.B, A: 255}
		}
		rest := face()
		tt.Move(r.X+r.W/2, r.Y+r.H/2)
		hover := face()
		tt.Press(r.X+r.W/2, r.Y+r.H/2)
		pressed := face()
		tt.Release(r.X+r.W/2, r.Y+r.H/2)
		for _, pair := range []struct {
			name string
			a, b ui.Color
		}{{"hover", hover, rest}, {"press", pressed, rest}, {"press after hover", pressed, hover}} {
			if d := colourDistance(pair.a, pair.b); d < 4 {
				t.Errorf("%s: %s changes the button's face by %.1f", theme.ID, pair.name, d)
			}
		}
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
	}, 720, 1080)
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
