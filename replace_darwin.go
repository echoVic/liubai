package main

import (
	"bytes"
	"os"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

func replaceFile(path string, data []byte, perm os.FileMode) error {
	var st unix.Stat_t
	if err := unix.Stat(path, &st); os.IsNotExist(err) {
		return atomicWrite(path, data, perm)
	} else if err != nil {
		return err
	}
	// Metadata is best effort: volumes without creation dates (exFAT, some
	// network shares) must still save.
	return atomicWriteHook(path, data, perm, func(tmp string) error {
		copyXattrs(path, tmp)
		_ = setCreationTime(tmp, time.Unix(st.Btim.Sec, st.Btim.Nsec))
		return nil
	})
}

func setCreationTime(path string, t time.Time) error {
	attrs := unix.Attrlist{Bitmapcount: unix.ATTR_BIT_MAP_COUNT, Commonattr: unix.ATTR_CMN_CRTIME}
	ts := unix.Timespec{Sec: t.Unix(), Nsec: int64(t.Nanosecond())}
	buf := unsafe.Slice((*byte)(unsafe.Pointer(&ts)), int(unsafe.Sizeof(ts)))
	return unix.Setattrlist(path, &attrs, buf, 0)
}

func copyXattrs(from, to string) {
	size, err := unix.Listxattr(from, nil)
	if err != nil || size == 0 {
		return
	}
	names := make([]byte, size)
	n, err := unix.Listxattr(from, names)
	if err != nil {
		return
	}
	for _, name := range bytes.Split(names[:n], []byte{0}) {
		if len(name) == 0 {
			continue
		}
		attr := string(name)
		size, err := unix.Getxattr(from, attr, nil)
		if err != nil {
			continue
		}
		value := make([]byte, size)
		n, err := unix.Getxattr(from, attr, value)
		if err != nil {
			continue
		}
		_ = unix.Setxattr(to, attr, value[:n], 0)
	}
}
