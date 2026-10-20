//go:build !windows

package main

import "os"

func renameFile(from, to string) error { return os.Rename(from, to) }
