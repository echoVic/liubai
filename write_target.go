package main

import (
	"errors"
	"os"
	"path/filepath"
)

// Atomic replacement checks the directory's permissions, so user-selected
// targets must also allow writing the existing file. Internal drafts and
// workspace metadata intentionally keep using atomicWrite directly.
func checkWriteTarget(path string) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	if err := fileWriteAccess(path); err != nil {
		if errors.Is(err, os.ErrPermission) {
			return messageError("bReadOnlyTarget", map[string]any{"name": filepath.Base(path)})
		}
		return err
	}
	return nil
}
