package main

import (
	"net/url"
	"strings"
)

// volumePath tells how Windows reads s: drive is an absolute path on a drive,
// as C:\notes\a.png or C:/notes/a.png, which URL parsing would read as the
// scheme c; share starts with two slashes or backslashes, as
// \\server\share\a.png, //server/share/a.md and \\?\ device paths do. Other
// systems have neither.
func volumePath(goos, s string) (drive, share bool) {
	if goos != "windows" {
		return false, false
	}
	slash := func(c byte) bool { return c == '\\' || c == '/' }
	if len(s) >= 3 && 'a' <= s[0]|0x20 && s[0]|0x20 <= 'z' && s[1] == ':' && slash(s[2]) {
		return true, false
	}
	return false, len(s) >= 2 && slash(s[0]) && slash(s[1])
}

// canonicalDestination makes Markdown source destinations and markdown-it's
// normalized URLs comparable: both decode to the same path.
func canonicalDestination(dest string) string {
	if p, err := url.PathUnescape(dest); err == nil {
		return p
	}
	return dest
}

// markdownDestination writes a path as a readable CommonMark destination:
// raw UTF-8, inside <…> when it holds spaces or parentheses.
func markdownDestination(path string) string {
	path = strings.NewReplacer("<", "%3C", ">", "%3E").Replace(path)
	if strings.ContainsAny(path, " \t()") {
		return "<" + path + ">"
	}
	return path
}
