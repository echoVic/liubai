//go:build darwin

package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const finderTags = "com.apple.metadata:_kMDItemUserTags"

func TestAutosaveLockedFileKeepsDraftAndRetries(t *testing.T) {
	testAutosaveReadOnly(t, func(path string) {
		t.Cleanup(func() {
			if err := unix.Chflags(path, 0); err != nil {
				t.Error(err)
			}
		})
		if err := unix.Chflags(path, unix.UF_IMMUTABLE); err != nil {
			t.Fatal(err)
		}
	}, func(path string) {
		if err := unix.Chflags(path, 0); err != nil {
			t.Fatal(err)
		}
	})
}

func xattr(t *testing.T, p, name string) string {
	t.Helper()
	buf := make([]byte, 256)
	n, err := unix.Getxattr(p, name, buf)
	if err != nil {
		t.Fatalf("xattr %s: %v", name, err)
	}
	return string(buf[:n])
}

func TestReplaceFilePreservesTagsAndCreationTime(t *testing.T) {
	p := filepath.Join(t.TempDir(), "tagged.md")
	if err := os.WriteFile(p, []byte("old\n"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := unix.Setxattr(p, finderTags, []byte("liubai-tag"), 0); err != nil {
		t.Fatal(err)
	}
	if err := unix.Setxattr(p, "com.liubai.test", []byte("keep me"), 0); err != nil {
		t.Fatal(err)
	}
	created := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := setCreationTime(p, created); err != nil {
		t.Fatal(err)
	}
	if err := replaceFile(p, []byte("new\n"), 0640); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "new\n" {
		t.Fatalf("content %q", b)
	}
	if got := xattr(t, p, finderTags); got != "liubai-tag" {
		t.Fatalf("tags %q", got)
	}
	if got := xattr(t, p, "com.liubai.test"); got != "keep me" {
		t.Fatalf("custom attribute %q", got)
	}
	var st unix.Stat_t
	if err := unix.Stat(p, &st); err != nil {
		t.Fatal(err)
	}
	if st.Btim.Sec != created.Unix() {
		t.Fatalf("creation time %v, want %v", time.Unix(st.Btim.Sec, 0).UTC(), created)
	}
	if info, _ := os.Stat(p); info.Mode().Perm() != 0640 {
		t.Fatalf("mode %v", info.Mode())
	}
}

func TestAutosaveKeepsFinderTags(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "note.md")
	os.WriteFile(p, []byte("hello\n"), 0644)
	if err := unix.Setxattr(p, finderTags, []byte("liubai-tag"), 0); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Update(Edit{ID: s.Current.ID, Revision: s.Current.Revision, Content: "hello world\n"}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "hello world\n" {
		t.Fatalf("not written: %q", b)
	}
	if got := xattr(t, p, finderTags); got != "liubai-tag" {
		t.Fatalf("tags lost: %q", got)
	}
}

func TestSaveAsKeepsFinderTags(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "new\n")
	p := filepath.Join(t.TempDir(), "note.md")
	if err := os.WriteFile(p, []byte("old\n"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := unix.Setxattr(p, finderTags, []byte("liubai-tag"), 0); err != nil {
		t.Fatal(err)
	}
	if _, err := w.SaveAs(d.ID, p); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "new\n" {
		t.Fatalf("not written: %q", b)
	}
	if got := xattr(t, p, finderTags); got != "liubai-tag" {
		t.Fatalf("tags lost: %q", got)
	}
}

func TestReplaceFileCreatesMissingTarget(t *testing.T) {
	p := filepath.Join(t.TempDir(), "new.md")
	if err := replaceFile(p, []byte("new\n"), 0640); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(p); err != nil || string(b) != "new\n" {
		t.Fatalf("content %q, error %v", b, err)
	}
	if info, err := os.Stat(p); err != nil || info.Mode().Perm() != 0640 {
		t.Fatalf("mode %v, error %v", info, err)
	}
}

func TestAtomicWriteHookFailureKeepsOriginal(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "note.md")
	if err := os.WriteFile(p, []byte("old\n"), 0644); err != nil {
		t.Fatal(err)
	}
	want := errors.New("metadata failed")
	err := atomicWriteHook(p, []byte("new\n"), 0644, func(tmp string) error {
		if filepath.Dir(tmp) != dir {
			t.Fatalf("temporary file outside target directory: %s", tmp)
		}
		if b, err := os.ReadFile(tmp); err != nil || string(b) != "new\n" {
			t.Fatalf("temporary content %q, error %v", b, err)
		}
		if b, _ := os.ReadFile(p); string(b) != "old\n" {
			t.Fatalf("original changed before hook: %q", b)
		}
		return want
	})
	if !errors.Is(err, want) {
		t.Fatalf("error %v, want %v", err, want)
	}
	if b, _ := os.ReadFile(p); string(b) != "old\n" {
		t.Fatalf("original overwritten: %q", b)
	}
	if entries, err := os.ReadDir(dir); err != nil || len(entries) != 1 {
		t.Fatalf("temporary file not removed: %v, error %v", entries, err)
	}
}
