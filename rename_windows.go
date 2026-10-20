package main

import (
	"errors"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

// Indexers, antivirus scanners and cloud clients open new and changed files
// for a moment without sharing deletes, and renaming over such a file fails
// until they let go. Retry for about a second, as cmd/go's robustio does.
func renameFile(from, to string) error {
	return retryWhileBusy(func() error { return os.Rename(from, to) })
}

func retryWhileBusy(op func() error) error {
	for attempt := 0; ; attempt++ {
		err := op()
		if err == nil || attempt == 19 || !busy(err) {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func busy(err error) bool {
	for _, code := range []windows.Errno{windows.ERROR_ACCESS_DENIED, windows.ERROR_SHARING_VIOLATION, windows.ERROR_LOCK_VIOLATION, windows.ERROR_UNABLE_TO_REMOVE_REPLACED} {
		if errors.Is(err, code) {
			return true
		}
	}
	return false
}
