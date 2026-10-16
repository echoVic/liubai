package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func requirePermissionChecks(t *testing.T) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("root bypasses file permissions")
	}
}

func assertFileUnchanged(t *testing.T, path string, before os.FileInfo, content string) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil || string(b) != content {
		t.Fatalf("file content = %q, error %v; want %q", b, err, content)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || !os.SameFile(before, after) {
		t.Fatal("refused write changed file size, modification time or identity")
	}
}

func testAutosaveReadOnly(t *testing.T, protect func(string), unprotect func(string)) {
	t.Helper()
	requirePermissionChecks(t)
	w := workspace(t)
	path := filepath.Join(t.TempDir(), "read-only.md")
	const original = "original\n"
	const changed = "new content kept in the draft\n"
	if err := os.WriteFile(path, []byte(original), 0644); err != nil {
		t.Fatal(err)
	}
	protect(path)
	s, err := w.Open(path)
	if err != nil || s.Current.Content != original {
		t.Fatalf("opening read-only file: content %q, error %v", s.Current.Content, err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := w.Update(Edit{ID: s.Current.ID, Revision: s.Current.Revision, Content: changed})
	if err != nil {
		t.Fatal(err)
	}
	assertFileUnchanged(t, path, before, original)
	if d.StatusCode != "fileReadOnly" || d.Conflict || d.Content != changed {
		t.Fatalf("read-only update = %+v", d)
	}
	for _, tc := range []struct{ locale, want string }{
		{"zh-Hans", "文件为只读，修改保留在草稿中"},
		{"en", "The file is read-only. Your changes are kept in the draft."},
	} {
		if got := documentIn(d, tc.locale).Status; got != tc.want {
			t.Fatalf("%s status = %q, want %q", tc.locale, got, tc.want)
		}
	}
	b, err := os.ReadFile(filepath.Join(w.root, "drafts", d.ID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var draft Document
	if err := json.Unmarshal(b, &draft); err != nil {
		t.Fatal(err)
	}
	if draft.Content != changed || draft.StatusCode != "fileReadOnly" || draft.Conflict {
		t.Fatalf("durable draft = %+v", draft)
	}
	if status, err := w.Status(d.ID); err != nil || status.StatusCode != "fileReadOnly" || status.Conflict {
		t.Fatalf("polled status = %+v, error %v", status, err)
	}
	unprotect(path)
	d, err = w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: changed})
	if err != nil || d.StatusCode != "fileSaved" || d.Conflict {
		t.Fatalf("retry = %+v, error %v", d, err)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != changed {
		t.Fatalf("retry content = %q, error %v", b, err)
	}
}

func TestAutosaveReadOnlyFileKeepsDraftAndRetries(t *testing.T) {
	testAutosaveReadOnly(t, func(path string) {
		if err := os.Chmod(path, 0444); err != nil {
			t.Fatal(err)
		}
	}, func(path string) {
		if err := os.Chmod(path, 0644); err != nil {
			t.Fatal(err)
		}
	})
}

func TestExplicitWritesRefuseReadOnlyTargets(t *testing.T) {
	requirePermissionChecks(t)
	for _, action := range []string{"overwrite", "saveAs", "ZIP", "recovery"} {
		t.Run(action, func(t *testing.T) {
			w := workspace(t)
			path, d := openFile(t, w, "target.md", "original\n")
			if action != "overwrite" {
				s, err := w.New()
				if err != nil {
					t.Fatal(err)
				}
				d = s.Current
			}
			if action == "overwrite" {
				if err := os.WriteFile(path, []byte("disk version\n"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			d = edit(t, w, "replacement content\n")
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(path, 0444); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			switch action {
			case "overwrite":
				_, err = w.Overwrite(d.ID)
			case "saveAs":
				_, err = w.SaveAs(d.ID, path)
			case "ZIP":
				_, err = w.Export(d.ID, path, false)
			case "recovery":
				_, err = w.SaveRecovery(d.ID, "latest recovery content\n", path)
			}
			assertFileUnchanged(t, path, before, string(original))
			for _, tc := range []struct{ locale, want string }{
				{"zh-Hans", "「target.md」是只读文件，请选择其他位置"},
				{"en", "“target.md” is read-only. Choose another location."},
			} {
				if got := errorIn(err, tc.locale); got != tc.want {
					t.Fatalf("%s error = %q, want %q", tc.locale, got, tc.want)
				}
			}
		})
	}
}
