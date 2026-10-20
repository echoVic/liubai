package main

import (
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

var procReplaceFileW = windows.NewLazySystemDLL("kernel32.dll").NewProc("ReplaceFileW")

const (
	replaceFileIgnoreMergeErrors = 0x2
	replaceFileIgnoreACLErrors   = 0x4
)

// replaceFile writes over an existing document with ReplaceFileW, which keeps
// its attributes, security descriptor, alternate data streams and creation
// time, as the macOS version keeps Finder tags and the creation date.
func replaceFile(path string, data []byte, perm os.FileMode) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return atomicWrite(path, data, perm)
	} else if err != nil {
		return err
	}
	target, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	return atomicWriteWith(path, data, perm, func(tmp string) error {
		replacement, err := windows.UTF16PtrFromString(tmp)
		if err != nil {
			return err
		}
		err = retryWhileBusy(func() error {
			ok, _, callErr := procReplaceFileW.Call(uintptr(unsafe.Pointer(target)), uintptr(unsafe.Pointer(replacement)), 0, replaceFileIgnoreMergeErrors|replaceFileIgnoreACLErrors, 0, 0)
			if ok != 0 {
				return nil
			}
			return &os.LinkError{Op: "replace", Old: tmp, New: path, Err: callErr}
		})
		if err == nil {
			return nil
		}
		// Metadata is best effort. Some shares refuse ReplaceFileW, and after
		// ERROR_UNABLE_TO_MOVE_REPLACEMENT the document is gone while ours
		// keeps its temporary name: a rename saves it. A document that stayed
		// busy gets one plain rename before the save fails.
		rename := renameFile
		if busy(err) {
			rename = os.Rename
		}
		if renameErr := rename(tmp, path); renameErr != nil {
			if _, statErr := os.Lstat(path); os.IsNotExist(statErr) {
				return fmt.Errorf("%w as %s: %w", errKeptTemp, tmp, renameErr)
			}
			return err
		}
		return nil
	})
}
