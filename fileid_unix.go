//go:build unix

package main

import (
	"os"
	"syscall"
)

func fileIdentity(info os.FileInfo) uint64 {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Ino)
	}
	return 0
}
