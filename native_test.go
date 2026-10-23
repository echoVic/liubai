package main

import (
	"testing"
	"time"

	"liubai/locales"

	"github.com/egoist/mygo"
)

// MyGo draws the Windows window buttons black or white by its theme source,
// which must follow the app's theme rather than the system's.
func TestWindowsThemeSourceFollowsTheAppTheme(t *testing.T) {
	noon, night := time.Date(2026, 10, 22, 12, 0, 0, 0, time.Local), time.Date(2026, 10, 22, 22, 0, 0, 0, time.Local)
	for _, c := range []struct {
		appearance Appearance
		now        time.Time
		want       mygo.ThemeSource
	}{
		{Appearance{Theme: "ink", Auto: "off"}, noon, mygo.ThemeDark},
		{Appearance{Theme: "paper", Auto: "off"}, night, mygo.ThemeLight},
		{Appearance{Theme: "lamp", Auto: "off"}, noon, mygo.ThemeDark},
		{Appearance{Theme: "indigo", Auto: "off"}, noon, mygo.ThemeDark},
		{Appearance{Theme: "lotus", Auto: "off"}, night, mygo.ThemeLight},
		{Appearance{Theme: "ink", Auto: "hours"}, noon, mygo.ThemeLight},
		{Appearance{Theme: "paper", Auto: "hours"}, night, mygo.ThemeDark},
		// Both read the system's appearance, which a forced source would replace.
		{Appearance{Theme: "ink", Auto: "system"}, noon, mygo.ThemeSystem},
		{Appearance{Theme: "paper", Auto: "seasons"}, night, mygo.ThemeSystem},
	} {
		if got := themeSourceFor(c.appearance, c.now); got != c.want {
			t.Errorf("themeSourceFor(%+v, %s) = %q, want %q", c.appearance, c.now.Format("15:04"), got, c.want)
		}
	}
}

// Off macOS, MyGo keys the single-instance lock, PathUserData (which keeps the
// chosen language) and the WebView2 profile by the app's name, so it must not
// change with the language. macOS shows the localized name.
func TestAppNameIsTheSameInEveryLanguageOffMacOS(t *testing.T) {
	for _, c := range []struct{ goos, locale, want string }{
		{"windows", "zh-Hans", "Liubai"},
		{"windows", "en", "Liubai"},
		{"linux", "zh-Hans", "Liubai"},
		{"darwin", "zh-Hans", "留白"},
		{"darwin", "en", "Liubai"},
	} {
		if got := appNameFor(c.goos, locales.In(c.locale)); got != c.want {
			t.Errorf("appNameFor(%q, %s) = %q, want %q", c.goos, c.locale, got, c.want)
		}
	}
}
