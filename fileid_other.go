//go:build !unix

package main

import "os"

func fileIdentity(info os.FileInfo) uint64 { return 0 }
