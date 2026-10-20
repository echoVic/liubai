//go:build windows

package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// holdOpen opens path as indexers, scanners and cloud clients do: sharing
// reads and writes, but not deletes.
func holdOpen(t *testing.T, path string) windows.Handle {
	t.Helper()
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// releaseLater closes h after d and reports when it did, so a test can wait
// for the handle before its directory is removed.
func releaseLater(h windows.Handle, d time.Duration) <-chan struct{} {
	closed := make(chan struct{})
	time.AfterFunc(d, func() {
		windows.CloseHandle(h)
		close(closed)
	})
	return closed
}

func setCreationTime(t *testing.T, path string, created time.Time) {
	t.Helper()
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	h, err := windows.CreateFile(p, windows.FILE_WRITE_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(h)
	ft := windows.NsecToFiletime(created.UnixNano())
	if err := windows.SetFileTime(h, &ft, nil, nil); err != nil {
		t.Fatal(err)
	}
}

func creationTime(t *testing.T, path string) time.Time {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return time.Unix(0, info.Sys().(*syscall.Win32FileAttributeData).CreationTime.Nanoseconds())
}

func TestReplaceFileKeepsAttributesStreamsAndCreationTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.md")
	if err := os.WriteFile(path, []byte("one\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+":liubai", []byte("kept"), 0644); err != nil {
		t.Fatal(err)
	}
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetFileAttributes(p, windows.FILE_ATTRIBUTE_HIDDEN); err != nil {
		t.Fatal(err)
	}
	created := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	setCreationTime(t, path, created)
	if err := replaceFile(path, []byte("two\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != "two\n" {
		t.Fatalf("content %q, %v", b, err)
	}
	// A rename would bring the new file's own attributes. NTFS tunneling can
	// restore the creation time after a rename, but not the attributes.
	if attrs, err := windows.GetFileAttributes(p); err != nil || attrs&windows.FILE_ATTRIBUTE_HIDDEN == 0 {
		t.Errorf("attributes %#x, %v: the hidden attribute was lost", attrs, err)
	}
	if b, err := os.ReadFile(path + ":liubai"); err != nil || string(b) != "kept" {
		t.Errorf("alternate data stream %q, %v", b, err)
	}
	if got := creationTime(t, path); !got.Equal(created) {
		t.Errorf("creation time %v, want %v", got, created)
	}
}

func TestReplaceFileWaitsForAReaderWithoutDeleteSharing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.md")
	if err := os.WriteFile(path, []byte("one\n"), 0644); err != nil {
		t.Fatal(err)
	}
	closed := releaseLater(holdOpen(t, path), 200*time.Millisecond)
	err := replaceFile(path, []byte("two\n"), 0644)
	<-closed
	if err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != "two\n" {
		t.Fatalf("content %q, %v", b, err)
	}
}

func TestReplaceFileGivesUpWhenTheFileStaysOpen(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.md")
	if err := os.WriteFile(path, []byte("one\n"), 0644); err != nil {
		t.Fatal(err)
	}
	h := holdOpen(t, path)
	start := time.Now()
	err := replaceFile(path, []byte("two\n"), 0644)
	elapsed := time.Since(start)
	windows.CloseHandle(h)
	if err == nil {
		t.Fatal("replaced a file another program holds without sharing deletes")
	}
	if elapsed > 5*time.Second {
		t.Errorf("gave up after %v", elapsed)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != "one\n" {
		t.Errorf("content %q, %v", b, err)
	}
	if entries, err := os.ReadDir(dir); err != nil || len(entries) != 1 {
		t.Errorf("directory holds %d entries (%v), want only a.md", len(entries), err)
	}
}

func TestAtomicWriteWaitsForAReaderWithoutDeleteSharing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "workspace.json")
	if err := os.WriteFile(path, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	closed := releaseLater(holdOpen(t, path), 200*time.Millisecond)
	err := atomicWrite(path, []byte("new"), 0600)
	<-closed
	if err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != "new" {
		t.Fatalf("content %q, %v", b, err)
	}
}
