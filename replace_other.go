//go:build !darwin

package main

import "os"

func replaceFile(path string, data []byte, perm os.FileMode) error {
	return atomicWrite(path, data, perm)
}
