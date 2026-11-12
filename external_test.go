package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// chmod 0 makes a file unreadable on Unix only; Windows keeps it readable.
func requireUnreadableMode(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("chmod 0 leaves files readable on Windows")
	}
}

func openFile(t *testing.T, w *Workspace, name, content string) (string, Document) {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	return p, s.Current
}

func rewrite(t *testing.T, p, content string) {
	t.Helper()
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(2 * time.Second)
	os.Chtimes(p, later, later)
}

func TestReopenLoadsExternalChangesWhenDraftIsClean(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "README.md", "v1\n")
	rewrite(t, p, "v2 from git pull\n")
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if s.Current.ID != d.ID || s.Current.Content != "v2 from git pull\n" || s.Current.Conflict {
		t.Fatalf("got %+v", s.Current)
	}
	if s.Current.Revision <= d.Revision {
		t.Fatal("revision not bumped")
	}
	for _, r := range s.Recent {
		if strings.Contains(r.Title, "恢复副本") {
			t.Fatal("unexpected recovery copy")
		}
	}
}

func TestStatusReloadsCleanDocuments(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	rewrite(t, p, "two\n")
	st, err := w.Status(d.ID)
	if err != nil || st.Conflict || st.Revision == d.Revision {
		t.Fatalf("status %+v %v", st, err)
	}
	if got := w.State().Current.Content; got != "two\n" {
		t.Fatalf("content %q", got)
	}
}

func TestEditAfterExternalChangeIsAConflict(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	rewrite(t, p, "theirs\n")
	got, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "mine\n"})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Conflict {
		t.Fatal("conflict not detected")
	}
	if b, _ := os.ReadFile(p); string(b) != "theirs\n" {
		t.Fatal("external edit overwritten")
	}
	if st, _ := w.Status(d.ID); !st.Conflict {
		t.Fatal("status lost the conflict")
	}
	if got := w.State().Current.Content; got != "mine\n" {
		t.Fatalf("local edit replaced: %q", got)
	}
}

func TestReloadSkipsRecoveryCopyWhenDraftIsClean(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	before := len(w.State().Recent)
	rewrite(t, p, "two\n")
	s, err := w.Reload(d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Recent) != before || s.Current.Content != "two\n" {
		t.Fatalf("recent %d->%d content %q", before, len(s.Recent), s.Current.Content)
	}
}

func TestOverwriteKeepsDiskVersionAsRecoveryDraft(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	rewrite(t, p, "theirs\n")
	if got, _ := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "mine\n"}); !got.Conflict {
		t.Fatal("expected conflict")
	}
	s, err := w.Overwrite(d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "mine\n" {
		t.Fatalf("disk %q", b)
	}
	if s.Current.Conflict {
		t.Fatal("conflict not cleared")
	}
	kept := false
	for _, r := range s.Recent {
		kept = kept || strings.HasSuffix(r.Title, " · 磁盘版本")
	}
	if !kept {
		t.Fatal("disk version not kept")
	}
	cur := s.Current
	if _, err := w.Update(Edit{ID: cur.ID, Revision: cur.Revision, Content: "mine 2\n"}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "mine 2\n" {
		t.Fatalf("autosave did not resume: %q", b)
	}
}

func TestStatusSkipsReadingWhenMetadataIsUnchanged(t *testing.T) {
	requireUnreadableMode(t)
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	if err := os.Chmod(p, 0); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(p, 0644)
	if st, err := w.Status(d.ID); err != nil || st.Conflict {
		t.Fatalf("status read the file: %+v %v", st, err)
	}
}

func TestStatusAfterOwnSaveIsANoop(t *testing.T) {
	requireUnreadableMode(t)
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	saved, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "our save\n"})
	if err != nil || saved.Conflict || saved.Status != "文件已保存" {
		t.Fatalf("save: %+v %v", saved, err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if saved.DiskSize != info.Size() || saved.DiskModTime != info.ModTime().UnixNano() || saved.DiskInode != fileIdentity(info) {
		t.Fatal("save did not record the metadata used by the stat fast path")
	}
	if err := os.Chmod(p, 0); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(p, 0644)
	for range 2 {
		st, err := w.Status(d.ID)
		if err != nil || st.Revision != saved.Revision || st.Conflict || st.Status != "文件已保存" {
			t.Fatalf("own write caused a reload or conflict: %+v %v", st, err)
		}
	}
}

func TestTouchedButUnchangedFileIsNotAConflict(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	later := time.Now().Add(3 * time.Second)
	os.Chtimes(p, later, later)
	if st, _ := w.Status(d.ID); st.Conflict || st.Revision != d.Revision {
		t.Fatalf("touch caused %+v", st)
	}
}

func TestStatusDetectsReplacementWithSameSizeAndModTime(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if fileIdentity(info) == 0 {
		t.Skip("file identity is unavailable")
	}
	tmp := filepath.Join(filepath.Dir(p), "replacement.md")
	if err := os.WriteFile(tmp, []byte("two\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(tmp, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tmp, p); err != nil {
		t.Fatal(err)
	}
	if st, err := w.Status(d.ID); err != nil || st.Conflict || st.Revision <= d.Revision {
		t.Fatalf("replacement not loaded: %+v %v", st, err)
	}
	if got := w.State().Current.Content; got != "two\n" {
		t.Fatalf("content %q", got)
	}
}

func TestStatusRetainsDraftOnInvalidDiskAndRecovers(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	rewrite(t, p, "\xff")
	if st, err := w.Status(d.ID); err != nil || !st.Conflict || st.Status != "磁盘文件无法读取，草稿已保留" {
		t.Fatalf("invalid disk: %+v %v", st, err)
	}
	if got := w.State().Current.Content; got != "one\n" {
		t.Fatalf("draft lost: %q", got)
	}
	rewrite(t, p, "one\n")
	if st, err := w.Status(d.ID); err != nil || st.Conflict || st.Status != "文件已保存" || st.Revision != d.Revision {
		t.Fatalf("restored disk: %+v %v", st, err)
	}
}

func TestExternalReloadPersistsEncodingAndClearsAliases(t *testing.T) {
	for _, entry := range []string{"State", "Activate", "Status", "Reload"} {
		t.Run(entry, func(t *testing.T) {
			w := workspace(t)
			p, d := openFile(t, w, "a.md", "one\n")
			w.docs[d.ID].ImageAliases = map[string]string{"a.png": "liubai-asset:old.png"}
			rewrite(t, p, "\ufefftwo\r\n")
			switch entry {
			case "State":
				w.State()
			case "Activate":
				if _, err := w.Activate(d.ID); err != nil {
					t.Fatal(err)
				}
			case "Status":
				if _, err := w.Status(d.ID); err != nil {
					t.Fatal(err)
				}
			case "Reload":
				if _, err := w.Reload(d.ID); err != nil {
					t.Fatal(err)
				}
			}
			recovered, err := openWorkspace(w.root)
			if err != nil {
				t.Fatal(err)
			}
			got := recovered.State().Current
			if got.Content != "two\n" || !got.BOM || !got.CRLF || len(got.ImageAliases) != 0 || got.DiskModTime == 0 || got.DiskSize != 8 {
				t.Fatalf("reloaded document: %+v", got)
			}
		})
	}
}

func TestOverwritePreservesDiskContentAndRequiresReadableBackup(t *testing.T) {
	for _, disk := range []string{"theirs\n", "\xff", ""} {
		t.Run(disk, func(t *testing.T) {
			w := workspace(t)
			p, d := openFile(t, w, "a.md", "one\n")
			rewrite(t, p, disk)
			if disk == "" {
				if err := os.Remove(p); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "mine\n"}); err != nil {
				t.Fatal(err)
			}
			s, err := w.Overwrite(d.ID)
			b, readErr := os.ReadFile(p)
			if disk == "\xff" {
				if err == nil || string(b) != disk {
					t.Fatalf("unreadable version overwritten: %q %v", b, err)
				}
				return
			}
			if err != nil || readErr != nil || string(b) != "mine\n" || s.Current.Conflict || s.Current.DiskModTime == 0 {
				t.Fatalf("overwrite: %+v %q %v %v", s.Current, b, err, readErr)
			}
			backups := 0
			for _, backup := range w.docs {
				if strings.HasSuffix(backup.Title, " · 磁盘版本") {
					backups++
					if backup.Path != "" || backup.Content != disk {
						t.Fatalf("backup content: %+v", backup)
					}
				}
			}
			if disk != "" && backups != 1 || disk == "" && backups != 0 {
				t.Fatalf("backup count: %d", backups)
			}
		})
	}
}

func TestExternalMethodsRejectUnknownOrPathlessDocuments(t *testing.T) {
	w := workspace(t)
	if _, err := w.Status("unknown"); err == nil || err.Error() != "文稿不存在" {
		t.Fatalf("unknown status: %v", err)
	}
	for _, id := range []string{"unknown", w.State().Current.ID} {
		if _, err := w.Overwrite(id); err == nil {
			t.Fatal("overwrite accepted a document without a file")
		}
	}
}

// A file is one document however its path is spelt: in another letter case
// on a case-insensitive volume, or through another link to the same file.
func TestOpenFindsTheDocumentUnderAnotherSpelling(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "README.md", "x\n")
	dir := filepath.Dir(p)
	from := filepath.Join(dir, "from.md")
	if err := os.WriteFile(from, []byte("[r](readme.md)\n"), 0644); err != nil {
		t.Fatal(err)
	}
	spellings := map[string]func() (WorkspaceState, error){}
	if lower := filepath.Join(dir, "readme.md"); regularFile(lower) {
		spellings["other case"] = func() (WorkspaceState, error) { return w.Open(lower) }
		spellings["link in other case"] = func() (WorkspaceState, error) {
			s, err := w.Open(from)
			if err != nil {
				return s, err
			}
			return w.OpenLinked(s.Current.ID, "readme.md")
		}
	}
	if info, err := os.Stat(p); err == nil && fileIdentity(info) != 0 {
		if err := os.Link(p, filepath.Join(dir, "alias.md")); err == nil {
			spellings["hard link"] = func() (WorkspaceState, error) { return w.Open(filepath.Join(dir, "alias.md")) }
		}
	}
	if len(spellings) == 0 {
		t.Skip("case-sensitive volume without hard links")
	}
	for name, open := range spellings {
		s, err := open()
		if err != nil || s.Current.ID != d.ID {
			t.Errorf("%s: opened %q as another document: %v", name, s.Current.Path, err)
		}
	}
	for _, other := range w.docs {
		if other.ID != d.ID && filepath.Base(other.Path) != "from.md" {
			t.Errorf("extra document %q", other.Path)
		}
	}
}

// Each failed Overwrite would otherwise add another disk-version copy.
func TestFailedOverwriteLeavesNoBackup(t *testing.T) {
	for _, failure := range []string{"picture", "folder"} {
		t.Run(failure, func(t *testing.T) {
			if failure == "folder" {
				requireUnreadableMode(t)
				requirePermissionChecks(t)
			}
			w := workspace(t)
			p, d := openFile(t, w, "a.md", "one\n")
			rewrite(t, p, "theirs\n")
			content := "mine\n"
			if failure == "picture" {
				content = "mine ![x](liubai-asset:missing.png)\n"
			}
			if got, _ := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: content}); !got.Conflict {
				t.Fatal("expected conflict")
			}
			if failure == "folder" {
				if err := os.Chmod(filepath.Dir(p), 0555); err != nil {
					t.Fatal(err)
				}
				defer os.Chmod(filepath.Dir(p), 0755)
			}
			drafts, _ := filepath.Glob(filepath.Join(w.root, "drafts", "*.json"))
			for range 3 {
				if _, err := w.Overwrite(d.ID); err == nil {
					t.Fatal("overwrite succeeded")
				}
			}
			after, _ := filepath.Glob(filepath.Join(w.root, "drafts", "*.json"))
			if len(w.docs) != 1 || len(after) != len(drafts) {
				t.Fatalf("documents %d, drafts %d -> %d", len(w.docs), len(drafts), len(after))
			}
			if b, _ := os.ReadFile(p); string(b) != "theirs\n" {
				t.Fatalf("disk version lost: %q", b)
			}
		})
	}
}
