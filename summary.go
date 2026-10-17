package main

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"liubai/locales"
)

func frontMatterEnd(s string) int {
	line, rest, ok := strings.Cut(s, "\n")
	if strings.TrimSuffix(line, "\r") != "---" || !ok {
		return 0
	}
	offset := len(s) - len(rest)
	for n := 1; n < 200; n++ {
		line, tail, newline := strings.Cut(rest, "\n")
		offset += len(line)
		if newline {
			offset++
		}
		if trim := strings.TrimSpace(line); trim == "---" || trim == "..." {
			return offset
		}
		if !newline {
			break
		}
		rest = tail
	}
	return 0
}

var summaryImage = regexp.MustCompile(`!\[[^\]]*\](?:\((?:[^()\n]|\([^()\n]*\))*\)|\[[^\]]*\])`)
var summaryLink = regexp.MustCompile(`\[([^\]]+)\](?:\((?:[^()\n]|\([^()\n]*\))*\)|\[[^\]]*\])`)
var summaryPrefix = regexp.MustCompile(`^(?:#+\s*|>\s*|[-+*]\s+|\d+[.)]\s+|\[[ xX]\]\s+)`)
var summaryRule = regexp.MustCompile(`^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$`)
var summaryTable = regexp.MustCompile(`^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$`)

// GitHub 风格提示块标记 [!NOTE] / [!TIP] / [!WARNING] …，独占一行时不应成为标题。
var summaryCallout = regexp.MustCompile(`(?i)^\s*\[!?[A-Z]+\]\s*[:：-]?\s*`)

func inferredTitle(s string) string {
	if title := inferredContentTitle(s); title != "" {
		return title
	}
	return locales.BUntitled()
}

func inferredContentTitle(s string) string {
	if end := frontMatterEnd(s); end > 0 {
		for line := range strings.Lines(s[:end]) {
			if value, ok := strings.CutPrefix(strings.TrimSpace(line), "title:"); ok {
				if value = strings.Trim(strings.TrimSpace(value), `"'`); value != "" {
					return shortTitle(value)
				}
			}
		}
		s = s[end:]
	}
	var fence byte
	fenceLength := 0
	for line := range strings.Lines(s) {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "~~~") {
			n := 0
			for n < len(line) && line[n] == line[0] {
				n++
			}
			if fence == 0 {
				fence, fenceLength = line[0], n
			} else if line[0] == fence && n >= fenceLength && strings.TrimSpace(line[n:]) == "" {
				fence = 0
			}
			continue
		}
		if fence != 0 || line == "" || strings.HasPrefix(line, "<!--") || summaryRule.MatchString(line) || summaryTable.MatchString(line) {
			continue
		}
		for {
			next := summaryPrefix.ReplaceAllString(line, "")
			if next == line {
				break
			}
			line = next
		}
		line = summaryImage.ReplaceAllString(line, "")
		line = summaryLink.ReplaceAllString(line, "$1")
		line = strings.TrimSpace(strings.NewReplacer("**", "", "__", "", "`", "", "~~", "").Replace(line))
		if callout := summaryCallout.FindString(line); callout != "" {
			// 提示块标题行去掉 [!NOTE] 标记后若没有正文，就继续找下一行；
			// 若标记后还有文字（如「[!NOTE] 备注」），把文字当作标题。
			line = strings.TrimSpace(strings.TrimPrefix(line, callout))
		}
		if line != "" {
			return shortTitle(line)
		}
	}
	return ""
}

func shortTitle(s string) string {
	n := 0
	for i := range s {
		if n == 42 {
			return s[:i] + "…"
		}
		n++
	}
	return s
}

func excerptOf(s string) string {
	s = s[frontMatterEnd(s):]
	if len(s) > 4096 {
		end := 4096
		for !utf8.RuneStart(s[end]) {
			end--
		}
		s = s[:end]
	}
	s = strings.Join(strings.Fields(s), " ")
	n := 0
	for i := range s {
		if n == 90 {
			return s[:i]
		}
		n++
	}
	return s
}
