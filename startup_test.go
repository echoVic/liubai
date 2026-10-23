package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInvalidDraftsArePreservedInQuarantine(t *testing.T) {
	for _, kind := range []string{"unsafe ID", "wrong filename", "too large", "unreadable"} {
		t.Run(kind, func(t *testing.T) {
			w := workspace(t)
			d := Document{ID: strings.Repeat("ab", 12), Content: "保留这份内容"}
			if kind == "unsafe ID" {
				d.ID = "../unsafe"
			}
			if kind == "too large" {
				d.Content = strings.Repeat("a", maxDocument+1)
			}
			name := strings.Repeat("ab", 12) + ".json"
			if kind == "wrong filename" {
				name = "wrong.json"
			}
			path := filepath.Join(w.root, "drafts", name)
			b, err := json.Marshal(d)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "unreadable" {
				err = os.Mkdir(path, 0700)
			} else {
				err = os.WriteFile(path, b, 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			w2, err := openWorkspace(w.root)
			if err != nil {
				t.Fatal(err)
			}
			s := w2.State()
			if len(s.Notices) != 1 || s.Notices[0] != "有 1 份草稿无法读取，已移到隔离目录" {
				t.Fatalf("missing notice: %+v", s.Notices)
			}
			paths, err := filepath.Glob(filepath.Join(w.root, "quarantine", "*"))
			if err != nil || len(paths) != 1 {
				t.Fatalf("quarantine: %v %v", paths, err)
			}
			if kind != "unreadable" {
				got, err := os.ReadFile(paths[0])
				if err != nil || string(got) != string(b) {
					t.Fatalf("draft not preserved: %v", err)
				}
			}
		})
	}
}

func TestStartupSelectsNewestDraftWithoutValidCurrent(t *testing.T) {
	for _, contents := range []string{"", `{"version":1,"current":"missing"}`} {
		w := workspace(t)
		for i, id := range []string{strings.Repeat("ab", 12), strings.Repeat("cd", 12)} {
			if err := w.persist(&Document{ID: id, Content: id, Updated: int64(i + 10)}); err != nil {
				t.Fatal(err)
			}
		}
		// Keep the automatically created draft older than both fixtures.
		d := w.State().Current
		d.Updated = 1
		if err := w.persist(&d); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(w.root, "workspace.json")
		if contents == "" {
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
		} else if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		w2, err := openWorkspace(w.root)
		if err != nil {
			t.Fatal(err)
		}
		if got := w2.State().Current.ID; got != strings.Repeat("cd", 12) {
			t.Fatalf("selected %q instead of newest draft", got)
		}
	}
}

func TestNewerIndexPreservesValidSettingsAndOriginalBytes(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	contents := `{"version":2,"current":"` + d.ID + `","appearance":{"theme":"unknown","fontSize":20,"lineWidth":"wide","layout":"split","followSystem":false,"source":true},"future":"保留"}`
	path := filepath.Join(w.root, "workspace.json")
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	w2, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	s := w2.State()
	if s.Current.ID != d.ID || s.Appearance != (Appearance{Theme: "paper", Auto: "off", LightTheme: "paper", DarkTheme: "ink", FontSize: 20, LineWidth: "wide", Layout: "split", Source: true}) {
		t.Fatalf("valid fields lost: %+v", s)
	}
	paths, _ := filepath.Glob(filepath.Join(w.root, "quarantine", "*"))
	if len(paths) != 1 {
		t.Fatalf("backup missing: %v", paths)
	}
	if got, err := os.ReadFile(paths[0]); err != nil || string(got) != contents {
		t.Fatalf("original index not preserved: %v", err)
	}
	var x index
	b, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(b, &x) != nil || x.Version != 1 {
		t.Fatalf("index not rewritten as version 1: %s %v", b, err)
	}
	if len(s.Notices) != 1 || s.Notices[0] != "工作区索引来自更新版本的留白，已备份到隔离目录" {
		t.Fatalf("missing index notice: %v", s.Notices)
	}
}

func TestStartupLineWidthValidation(t *testing.T) {
	for _, test := range []struct{ stored, want string }{{"normal", "normal"}, {"wide", "wide"}, {"full", "full"}, {"unknown", ""}} {
		t.Run(test.stored, func(t *testing.T) {
			w := workspace(t)
			contents := `{"version":2,"appearance":{"theme":"paper","lineWidth":"` + test.stored + `"}}`
			if err := os.WriteFile(filepath.Join(w.root, "workspace.json"), []byte(contents), 0600); err != nil {
				t.Fatal(err)
			}
			reopened, err := openWorkspace(w.root)
			if err != nil {
				t.Fatal(err)
			}
			if got := reopened.State().Appearance.LineWidth; got != test.want {
				t.Fatalf("line width %q, want %q", got, test.want)
			}
		})
	}
}

// The preference reaches mygo.App.SetLocale at startup, which panics on a tag
// that names no language, and the Language menu offers these three only. An
// index from a newer version keeps it too, since off macOS it decides the
// language.
func TestStartupLocalePreferenceValidation(t *testing.T) {
	for _, test := range []struct{ version, stored, want string }{
		{"1", "zh-Hans", "zh-Hans"}, {"1", "en", "en"}, {"1", "", ""}, {"1", "fr", ""}, {"1", "not a language!", ""},
		{"2", "zh-Hans", "zh-Hans"}, {"2", "not a language!", ""},
	} {
		t.Run(test.version+"/"+test.stored, func(t *testing.T) {
			w := workspace(t)
			contents := `{"version":` + test.version + `,"localePreference":"` + test.stored + `","appearance":{"theme":"paper"}}`
			if err := os.WriteFile(filepath.Join(w.root, "workspace.json"), []byte(contents), 0600); err != nil {
				t.Fatal(err)
			}
			reopened, err := openWorkspace(w.root)
			if err != nil {
				t.Fatal(err)
			}
			if got := reopened.localePreference; got != test.want {
				t.Fatalf("locale preference %q, want %q", got, test.want)
			}
		})
	}
}

func TestOnlyStateDeliversPendingNotices(t *testing.T) {
	w := workspace(t)
	w.Notify("打开失败")
	s, err := w.New()
	if err != nil || len(s.Notices) != 0 || s.QuarantineDir != "" {
		t.Fatalf("New delivered notices: %+v %v", s, err)
	}
	first := w.State()
	if len(first.Notices) != 1 || first.Notices[0] != "打开失败" || first.QuarantineDir != "" {
		t.Fatalf("notice lost: %+v", first)
	}
	w.Notify("另一次失败")
	second := w.State()
	if len(second.Notices) != 1 || second.Notices[0] != "另一次失败" || first.Notices[0] != "打开失败" {
		t.Fatal("notices were not copied")
	}
	if again := w.State(); len(again.Notices) != 0 || again.QuarantineDir != "" {
		t.Fatalf("notice repeated: %+v", again)
	}
}

func TestStartupStopsWhenQuarantineFailsOrIndexCannotBeRead(t *testing.T) {
	for _, kind := range []string{"quarantine", "index"} {
		w := workspace(t)
		if kind == "quarantine" {
			if err := os.WriteFile(filepath.Join(w.root, "quarantine"), []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(w.root, "drafts", "bad.json"), []byte("{"), 0600); err != nil {
				t.Fatal(err)
			}
		} else {
			path := filepath.Join(w.root, "workspace.json")
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(path, 0700); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := openWorkspace(w.root); err == nil {
			t.Fatalf("startup ignored %s failure", kind)
		}
	}
}

func TestOpenFailureBeforePageReadyIsDeliveredWithState(t *testing.T) {
	d := &Desktop{w: workspace(t)}
	d.openPath(filepath.Join(t.TempDir(), "不存在.md"))
	s := d.State()
	if len(s.Notices) != 1 || !strings.HasPrefix(s.Notices[0], "无法打开「不存在.md」：") {
		t.Fatalf("missing open failure: %v", s.Notices)
	}
	if !d.pageReady.Load() || len(d.State().Notices) != 0 {
		t.Fatal("page readiness or notice delivery failed")
	}
}

func TestCorruptDraftIsQuarantinedAndStartupContinues(t *testing.T) {
	root := t.TempDir()
	w, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	good := edit(t, w, "# 好草稿\n")
	bad := filepath.Join(root, "drafts", strings.Repeat("ab", 12)+".json")
	os.WriteFile(bad, []byte(`{"id":"`), 0600)
	w2, err := openWorkspace(root)
	if err != nil {
		t.Fatalf("startup failed: %v", err)
	}
	s := w2.State()
	if len(s.Notices) == 0 || s.QuarantineDir != filepath.Join(root, "quarantine") {
		t.Fatalf("missing notice: %+v %q", s.Notices, s.QuarantineDir)
	}
	if _, err := os.Stat(bad); !os.IsNotExist(err) {
		t.Fatal("corrupt draft left in drafts/")
	}
	if moved, _ := filepath.Glob(filepath.Join(root, "quarantine", "*")); len(moved) != 1 {
		t.Fatalf("quarantine has %d entries", len(moved))
	}
	found := false
	for _, r := range s.Recent {
		found = found || r.ID == good.ID
	}
	if !found {
		t.Fatal("good draft lost")
	}
	if again := w2.State(); len(again.Notices) != 0 {
		t.Fatal("notices must be delivered once")
	}
}

func TestCorruptOrNewerIndexDoesNotBlockStartup(t *testing.T) {
	for _, index := range []string{`{"version":`, `{"version":2,"current":"","appearance":{"theme":"ink","followSystem":false}}`} {
		root := t.TempDir()
		w, err := openWorkspace(root)
		if err != nil {
			t.Fatal(err)
		}
		d := edit(t, w, "正文\n")
		os.WriteFile(filepath.Join(root, "workspace.json"), []byte(index), 0600)
		w2, err := openWorkspace(root)
		if err != nil {
			t.Fatalf("index %q: %v", index, err)
		}
		s := w2.State()
		if s.Current.ID != d.ID {
			t.Fatalf("index %q: current %q, want most recent draft %q", index, s.Current.ID, d.ID)
		}
		if len(s.Notices) == 0 {
			t.Fatalf("index %q: no notice", index)
		}
	}
}
