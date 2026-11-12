package main

import (
	"os"
	"path/filepath"
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

// MyGo keeps window positions, Open Recent and the update choices in a folder
// named after the app, which on macOS follows the language. The folder is
// pinned, and whichever copy was written last comes over without deleting
// the other.
func TestUserDataStaysPutAcrossLanguages(t *testing.T) {
	config := t.TempDir()
	zh, en := filepath.Join(config, "留白"), filepath.Join(config, "Liubai")
	write := func(dir, name, text string, age time.Duration) {
		t.Helper()
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
		when := time.Now().Add(-age)
		if err := os.Chtimes(p, when, when); err != nil {
			t.Fatal(err)
		}
	}
	read := func(dir, name string) string {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return "missing"
		}
		return string(b)
	}
	write(zh, "window-state.json", "zh newer", time.Hour)
	write(en, "window-state.json", "en older", 2*time.Hour)
	write(zh, "recent-documents.json", "zh older", 2*time.Hour)
	write(en, "recent-documents.json", "en newer", time.Hour)
	write(zh, "updater.json", "zh only", time.Hour)
	write(zh, "locale", "not MyGo state on macOS", time.Hour)
	var names []string
	for _, l := range locales.Catalog.Languages() {
		names = append(names, appNameFor("darwin", locales.In(l)))
	}
	for range 2 { // a second launch changes nothing
		dir, err := pinUserData(config, names)
		if err != nil || dir != en {
			t.Fatalf("pinUserData = %q, %v", dir, err)
		}
		for _, c := range []struct{ dir, name, want string }{
			{en, "window-state.json", "zh newer"},
			{zh, "window-state.json", "en older"},
			{en, "recent-documents.json", "en newer"},
			{zh, "recent-documents.json", "zh older"},
			{en, "updater.json", "zh only"},
			{zh, "updater.json", "missing"},
			{zh, "locale", "not MyGo state on macOS"},
			{en, "locale", "missing"},
		} {
			if got := read(c.dir, c.name); got != c.want {
				t.Errorf("%s/%s = %q, want %q", filepath.Base(c.dir), c.name, got, c.want)
			}
		}
	}
	if m, _ := filepath.Glob(filepath.Join(zh, "*.moving")); len(m) != 0 {
		t.Fatalf("left over: %v", m)
	}
}

// A launch cut short between the renames finishes or undoes the move.
func TestUserDataMoveRecoversFromAnInterruptedLaunch(t *testing.T) {
	for _, c := range []struct {
		name           string
		zh, en, held   string
		wantZh, wantEn string
	}{
		{"after the first rename", "", "en older", "zh newer", "en older", "zh newer"},
		{"after the second rename", "en older", "", "zh newer", "en older", "zh newer"},
	} {
		t.Run(c.name, func(t *testing.T) {
			config := t.TempDir()
			zh, en := filepath.Join(config, "留白"), filepath.Join(config, "Liubai")
			for dir, files := range map[string]map[string]string{zh: {"window-state.json": c.zh, "window-state.json.moving": c.held}, en: {"window-state.json": c.en}} {
				if err := os.MkdirAll(dir, 0o755); err != nil {
					t.Fatal(err)
				}
				for name, text := range files {
					if text == "" {
						continue
					}
					if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
						t.Fatal(err)
					}
				}
			}
			old := time.Now().Add(-2 * time.Hour)
			_ = os.Chtimes(filepath.Join(zh, "window-state.json"), old, old)
			_ = os.Chtimes(filepath.Join(en, "window-state.json"), old, old)
			if _, err := pinUserData(config, []string{"留白", "Liubai"}); err != nil {
				t.Fatal(err)
			}
			gotZh, _ := os.ReadFile(filepath.Join(zh, "window-state.json"))
			gotEn, _ := os.ReadFile(filepath.Join(en, "window-state.json"))
			if string(gotZh) != c.wantZh || string(gotEn) != c.wantEn {
				t.Fatalf("留白 %q, Liubai %q", gotZh, gotEn)
			}
			if _, err := os.Stat(filepath.Join(zh, "window-state.json.moving")); err == nil {
				t.Fatal("held copy left over")
			}
		})
	}
}
