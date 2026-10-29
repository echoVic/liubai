package main

import (
	_ "embed"
	"runtime"
	"strings"

	"github.com/egoist/mygo/ui"
)

// Native settings and the document use the same colour roles.
//
//go:embed src/themes.css
var themeCSS string

type nativeTheme struct {
	ui.Theme
	font string
}

func (t nativeTheme) withPreferences(p ui.Preferences) nativeTheme {
	if p.TextScale > 0 {
		t.FontSize *= p.TextScale
	}
	if p.HighContrast {
		t.Border = t.Border.Mix(t.Text, 0.45)
		t.TextMuted = t.TextMuted.Mix(t.Text, 0.4)
		t.Scrollbar = t.Scrollbar.Alpha(1.6)
	}
	return t
}

var nativeThemes = func() map[string]nativeTheme {
	result := make(map[string]nativeTheme, len(themes))
	for _, spec := range themes {
		_, block, found := strings.Cut(themeCSS, "[data-liubai-theme="+spec.ID+"]{")
		if !found {
			panic("missing theme palette: " + spec.ID)
		}
		block, _, _ = strings.Cut(block, "}")
		roles := make(map[string]string)
		for _, declaration := range strings.Split(block, ";") {
			key, value, ok := strings.Cut(declaration, ":")
			if ok {
				roles[strings.TrimSpace(key)] = strings.TrimSpace(value)
			}
		}
		colour := func(role string) ui.Color {
			value := roles["--"+role]
			if !strings.HasPrefix(value, "#") {
				panic("missing theme colour: " + spec.ID + "/" + role)
			}
			return ui.Hex(value)
		}
		t := ui.LightTheme()
		if spec.Dark {
			t = ui.DarkTheme()
		}
		t.Background, t.Surface = colour("popover"), colour("card")
		t.SurfaceHover, t.SurfacePressed = colour("muted"), colour("accent")
		t.Border, t.Text, t.TextMuted = colour("border"), colour("foreground"), colour("muted-foreground")
		t.Accent, t.AccentText = colour("primary"), colour("primary-foreground")
		t.AccentHover, t.AccentPressed = t.Accent, t.Accent
		t.Danger, t.Selection, t.Focus = colour("destructive"), colour("selection"), colour("ring")
		t.Scrollbar = t.TextMuted.Alpha(0.45)
		font := ""
		if roles["--font-body"] == "var(--font-song)" {
			font = "Songti SC"
			if runtime.GOOS != "darwin" {
				font = "Georgia"
			}
		}
		result[spec.ID] = nativeTheme{Theme: *t, font: font}
	}
	return result
}()
