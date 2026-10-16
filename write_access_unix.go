//go:build unix

package main

import "golang.org/x/sys/unix"

func fileWriteAccess(path string) error {
	return unix.Access(path, unix.W_OK)
}
