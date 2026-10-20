package main

import (
	"net/url"
	"path/filepath"
	"strings"
)

// isVolumePath reports whether s starts with a drive or a share, as
// C:\notes\a.png and \\server\share\a.png do. Only Windows paths have them,
// and URL parsing would read the drive as a scheme.
func isVolumePath(s string) bool { return filepath.VolumeName(s) != "" }

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
