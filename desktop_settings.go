package main

import (
	"runtime"
	"strconv"
	"strings"
	"time"

	"liubai/locales"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/i18n"
	"github.com/egoist/mygo/ui"
)

var appearanceChanged = mygo.NewEvent[AppearanceChange]("liubai:appearance-changed")

type settingsWindow struct {
	desktop   *Desktop
	win       *mygo.Window
	tab       int
	recording bool
	errors    [3]error
}

// ShowSettings is also called from the WebView bridge; window state belongs
// to the main thread, including creating, reusing and closing the window.
func (d *Desktop) ShowSettings(tab string) {
	if d.native == nil || d.win == nil {
		return
	}
	d.win.Update(func() {
		if d.settings == nil {
			d.settings = &settingsWindow{desktop: d}
		}
		s := d.settings
		switch tab {
		case "appearance":
			s.tab = 0
		case "capture":
			s.tab = 1
		case "language":
			s.tab = 2
		}
		s.recording = false
		if s.win == nil {
			s.win = mygo.NewWindow(mygo.WindowOptions{
				Title: s.text("fSettingsTitle"), Content: ui.View(s.view),
				Width: 720, Height: 760, MinWidth: 640, MinHeight: 500,
			})
			s.win.OnClosed(func() { s.win = nil; s.recording = false })
		}
		s.win.Invalidate()
		s.win.Show()
		s.win.Focus()
	})
}

func (s *settingsWindow) locale() string {
	s.desktop.w.mu.Lock()
	tag := s.desktop.w.localePreference
	s.desktop.w.mu.Unlock()
	if tag == "" {
		tag = i18n.Locale()
	}
	return tag
}

func (s *settingsWindow) text(key string) string {
	return locales.Catalog.Format(s.locale(), key, nil)
}

func (s *settingsWindow) view(c *ui.Context) {
	m := locales.In(s.locale())
	s.desktop.w.mu.Lock()
	p := s.desktop.w.appearance
	s.desktop.w.mu.Unlock()
	current := resolveAppearanceTheme(p, time.Now(), c.Theme().Dark)
	palette := nativeThemes[current].withPreferences(c.Preferences())
	c.SetTheme(&palette.Theme)
	if p.Auto == "hours" || p.Auto == "seasons" {
		c.After(time.Minute)
	}
	ui.Column(c).Fill().Padding(24).Gap(20).Children(func() {
		if ui.Tabs(c, &s.tab, s.text("fAppearance"), m.FQuickNote(), m.FLanguage()).Changed() {
			s.recording = false
		}
		ui.Scroll(c).Grow(1).FillWidth().Children(func() {
			ui.Column(c).FillWidth().Gap(20).Children(func() {
				switch s.tab {
				case 0:
					s.appearanceView(c, m, p, current)
				case 1:
					s.captureView(c, m)
				case 2:
					s.languageView(c, m)
				}
				if err := s.errors[s.tab]; err != nil {
					ui.Text(c, errorIn(err, s.locale())).TextColor(c.Theme().Danger)
				}
			})
		})
		ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(12).Children(func() {
			ui.Text(c, m.FChangesApplyImmediatelyYourDocumentAndEditingPositionAre()).
				Grow(1).FontSize(12 * c.Preferences().TextScale).TextColor(c.Theme().TextMuted)
			ui.Link(c, m.FFeedback(), feedbackURL).FontSize(12 * c.Preferences().TextScale)
		})
	})
	if !s.recording && (c.Shortcut(0, ui.KeyEscape) || c.Shortcut(ui.Cmd, ui.KeyW)) && s.win != nil {
		s.win.Close()
	}
}

func (s *settingsWindow) saveAppearance(change AppearanceChange) {
	_, err := s.desktop.UpdateAppearance(change)
	s.errors[0] = err
	if err == nil && s.desktop.native != nil && s.desktop.win != nil {
		_ = appearanceChanged.Emit(s.desktop.win, change)
	}
}

type settingsOption[T comparable] struct {
	value T
	label string
}

// SelectBase keeps stable stored IDs separate from translated labels.
func settingsSelect[T comparable](c *ui.Context, value *T, accessibilityLabel string, options []settingsOption[T]) bool {
	before := *value
	t := c.Theme()
	label := ""
	for _, option := range options {
		if option.value == *value {
			label = option.label
			break
		}
	}
	sel := ui.SelectBase(c, value)
	sel.Trigger.Label(accessibilityLabel).Value(label).FillWidth().Padding(8, 12).Radius(t.Radius).Background(t.Surface).
		Border(1, t.Border).Children(func() {
		ui.Text(c, label).Grow(1)
		ui.Icon(c, settingsChevron).Size(14, 14).TextColor(t.TextMuted)
	})
	sel.Popup(func(panel ui.Element) {
		panel.Role(ui.RoleMenu).Padding(4).Radius(t.Radius).Background(t.Background).Border(1, t.Border)
		for _, option := range options {
			item := sel.Item(option.value).Role(ui.RoleMenuItemRadio).Label(option.label).
				Checked(option.value == *value).Padding(8, 12).Radius(t.Radius)
			if item.Highlighted() {
				item.Background(t.Accent).TextColor(t.AccentText)
			}
			item.Children(func() { ui.Text(c, option.label) })
		}
	})
	return *value != before
}

func (s *settingsWindow) captureView(c *ui.Context, m locales.Messages) {
	status := s.desktop.GetCaptureSettings()
	p := status.Settings
	ui.Form(c, func() {
		ui.Field(c, m.FEnableQuickNote(), func() {
			if ui.Switch(c, &p.Enabled).Changed() {
				s.errors[1] = s.desktop.SetCaptureSettings(p)
			}
		})
		ui.Field(c, m.FKeyboardShortcut(), func() {
			label := displaySettingsShortcut(p.Shortcut)
			if s.recording {
				label = m.FPressAShortcut()
			}
			button := ui.Button(c, label).FillWidth().OnClick(func() { s.recording = true })
			button.HandleInput(s.recordShortcut)
			if !button.Focused() {
				s.recording = false
			}
		}).Error(status.Error)
		ui.Field(c, s.text("fLaunchAtLogin"), func() {
			if ui.Switch(c, &p.OpenAtLogin).Changed() {
				s.errors[1] = s.desktop.SetCaptureSettings(p)
			}
		}).Description(m.FOpenLiubaiInTheBackgroundAtLogin())
	})
	ui.Text(c, m.FUseTheShortcutInAnyAppToWriteA(displaySettingsShortcut("CmdOrCtrl+Enter"))).
		TextColor(c.Theme().TextMuted)
}

func (s *settingsWindow) recordShortcut(ev ui.InputEvent) bool {
	if !s.recording || ev.Kind != ui.InputKeyDown {
		return false
	}
	// MyGo v0.8 sends every key to HandleInput, keys it names neither by Code
	// nor by Key too, as one an input method keeps from the application: not a
	// shortcut, and recording goes on for the one the user means to press. A
	// key of a non-US layout it names only by position (PhysicalKey) still is.
	if ev.Key == ui.KeyUnknown && ev.PhysicalKey == ui.KeyUnknown && ev.Code == ui.CodeUnknown {
		return true
	}
	if ev.Key == ui.KeyEscape {
		s.recording = false
		return true
	}
	if ev.Key == ui.KeyTab && ev.Mods&(ui.Ctrl|ui.Alt|ui.Super) == 0 {
		s.recording = false
		return false
	}
	if shortcut := settingsShortcut(ev); shortcut != "" {
		p := s.desktop.GetCaptureSettings().Settings
		p.Shortcut = shortcut
		s.errors[1] = s.desktop.SetCaptureSettings(p)
		s.recording = false
	}
	return true
}

func settingsShortcut(ev ui.InputEvent) string {
	if ev.Mods&(ui.Ctrl|ui.Alt|ui.Super) == 0 {
		return ""
	}
	// MyGo v0.8's Code names the key by its position, whatever the layout
	// types, even where PhysicalKey and Key are unknown. The older fields
	// remain for backends that report no code.
	name := shortcutCodeName(ev.Code)
	if name == "" {
		key := ev.PhysicalKey
		if key == ui.KeyUnknown {
			key = ev.Key
		}
		name = shortcutKeyName(key)
	}
	if name == "" {
		return ""
	}
	var parts []string
	for _, mod := range []struct {
		mask ui.Modifiers
		name string
	}{{ui.Ctrl, "Ctrl"}, {ui.Alt, "Alt"}, {ui.Super, "Cmd"}, {ui.Shift, "Shift"}} {
		if ev.Mods&mod.mask != 0 {
			parts = append(parts, mod.name)
		}
	}
	return strings.Join(append(parts, name), "+")
}

// shortcutCodeName names a key by its position on the keyboard
// (InputEvent.Code), "" for one no accelerator can name.
func shortcutCodeName(code ui.KeyCode) string {
	switch {
	case code >= ui.CodeKeyA && code <= ui.CodeKeyZ:
		return string(rune('A' + code - ui.CodeKeyA))
	case code >= ui.CodeDigit1 && code <= ui.CodeDigit9:
		return strconv.Itoa(int(code-ui.CodeDigit1) + 1)
	case code == ui.CodeDigit0:
		// Codes are USB HID usages: 0 follows 9, not leads it.
		return "0"
	case code >= ui.CodeF1 && code <= ui.CodeF12:
		return "F" + strconv.Itoa(int(code-ui.CodeF1)+1)
	}
	return map[ui.KeyCode]string{
		ui.CodeSpace: "Space", ui.CodeEnter: "Enter", ui.CodeTab: "Tab",
		ui.CodeBackspace: "Backspace", ui.CodeDelete: "Delete", ui.CodeInsert: "Insert",
		ui.CodeArrowUp: "Up", ui.CodeArrowDown: "Down", ui.CodeArrowLeft: "Left", ui.CodeArrowRight: "Right",
		ui.CodeHome: "Home", ui.CodeEnd: "End", ui.CodePageUp: "PageUp", ui.CodePageDown: "PageDown",
		ui.CodeMinus: "-", ui.CodeEqual: "=", ui.CodeComma: ",", ui.CodePeriod: ".",
		ui.CodeSlash: "/", ui.CodeSemicolon: ";", ui.CodeQuote: "'", ui.CodeBracketLeft: "[",
		ui.CodeBracketRight: "]", ui.CodeBackslash: "\\", ui.CodeBackquote: "`",
	}[code]
}

// shortcutKeyName names a key by position on an ANSI US keyboard
// (InputEvent.PhysicalKey) or, where the platform reports none, by the key
// the active layout types (InputEvent.Key).
func shortcutKeyName(key ui.Key) string {
	switch {
	case key >= ui.KeyA && key <= ui.KeyZ:
		return string(rune('A' + key - ui.KeyA))
	case key >= ui.Key0 && key <= ui.Key9:
		return string(rune('0' + key - ui.Key0))
	case key >= ui.KeyF1 && key <= ui.KeyF12:
		return "F" + strconv.Itoa(int(key-ui.KeyF1)+1)
	}
	return map[ui.Key]string{
		ui.KeySpace: "Space", ui.KeyEnter: "Enter", ui.KeyTab: "Tab",
		ui.KeyBackspace: "Backspace", ui.KeyDelete: "Delete", ui.KeyInsert: "Insert",
		ui.KeyUp: "Up", ui.KeyDown: "Down", ui.KeyLeft: "Left", ui.KeyRight: "Right",
		ui.KeyHome: "Home", ui.KeyEnd: "End", ui.KeyPageUp: "PageUp", ui.KeyPageDown: "PageDown",
		ui.KeyMinus: "-", ui.KeyEqual: "=", ui.KeyComma: ",", ui.KeyPeriod: ".",
		ui.KeySlash: "/", ui.KeySemicolon: ";", ui.KeyQuote: "'", ui.KeyBracketLeft: "[",
		ui.KeyBracketRight: "]", ui.KeyBackslash: "\\", ui.KeyBackquote: "`",
	}[key]
}

func displaySettingsShortcut(shortcut string) string {
	if runtime.GOOS == "darwin" {
		return strings.NewReplacer("CmdOrCtrl", "⌘", "Ctrl", "⌃", "Alt", "⌥", "Cmd", "⌘", "Shift", "⇧", "Enter", "↵", "+", "").Replace(shortcut)
	}
	return strings.ReplaceAll(strings.ReplaceAll(shortcut, "CmdOrCtrl", "Ctrl"), "Cmd", "Win")
}

func (s *settingsWindow) languageView(c *ui.Context, m locales.Messages) {
	s.desktop.w.mu.Lock()
	tag := s.desktop.w.localePreference
	s.desktop.w.mu.Unlock()
	ui.Form(c, func() {
		ui.Field(c, m.FLanguage(), func() {
			if settingsSelect(c, &tag, m.FLanguage(), []settingsOption[string]{
				{"", m.FLanguageSystem()}, {"zh-Hans", m.FLanguageChinese()}, {"en", m.FLanguageEnglish()},
			}) {
				s.errors[2] = s.desktop.SetLocale(tag)
			}
		})
	})
}
