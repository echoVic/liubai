package main

import (
	"testing"

	"liubai/locales"

	"github.com/egoist/mygo"
)

// MyGo draws the Windows window buttons black or white by its theme source,
// which must follow the app's theme rather than the system's.
func TestWindowsThemeSourceFollowsTheAppTheme(t *testing.T) {
	for _, c := range []struct {
		appearance Appearance
		want       mygo.ThemeSource
	}{
		{Appearance{Theme: "ink"}, mygo.ThemeDark},
		{Appearance{Theme: "paper"}, mygo.ThemeLight},
		{Appearance{Theme: "warm"}, mygo.ThemeLight},
		{Appearance{Theme: "mist"}, mygo.ThemeLight},
		{Appearance{Theme: "ink", FollowSystem: true}, mygo.ThemeSystem},
		{Appearance{Theme: "paper", FollowSystem: true}, mygo.ThemeSystem},
	} {
		if got := themeSourceFor(c.appearance); got != c.want {
			t.Errorf("themeSourceFor(%+v) = %q, want %q", c.appearance, got, c.want)
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
