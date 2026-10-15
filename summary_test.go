package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestInferredTitle(t *testing.T) {
	for in, want := range map[string]string{
		"---\ntitle: \"周报 42\"\ntags: [a]\n---\n\n# 本周进展\n": "周报 42",
		"---\nlayout: post\n---\n\n# 本周进展\n":                "本周进展",
		"```go\nfunc main(){}\n```\n\n## 代码之后\n":            "代码之后",
		"![封面](a.png)\n\n**第一句**正文":                         "第一句正文",
		"- [ ] [留白](https://example.com) 的待办\n":             "留白 的待办",
		"<!-- 注释 -->\n\n> 引用开头\n":                           "引用开头",
		"\n\n   \n":                                         "未命名文稿",
	} {
		if got := inferredTitle(in); got != want {
			t.Errorf("inferredTitle(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExcerptSkipsFrontMatterAndReadsOnlyThePrefix(t *testing.T) {
	content := "---\ntitle: x\n---\n\n# 标题\n\n正文  第一段\n" + strings.Repeat("填充", 1<<19)
	got := excerptOf(content)
	if !strings.HasPrefix(got, "# 标题 正文 第一段") || len([]rune(got)) > 90 {
		t.Fatalf("%q", got)
	}
}

func TestFrontMatterEnd(t *testing.T) {
	for _, tc := range []struct {
		text string
		want int
	}{
		{"---\ntitle: x\n---\nbody", 17},
		{"---\r\ntitle: x\r\n...\r\nbody", 20},
		{"---\nmissing close", 0},
		{"\n---\ntitle: x\n---\n", 0},
		{"---\n" + strings.Repeat("x\n", 199) + "---\nbody", 0},
	} {
		if got := frontMatterEnd(tc.text); got != tc.want {
			t.Errorf("frontMatterEnd(%q) = %d, want %d", tc.text, got, tc.want)
		}
	}
}

func TestSummaryBoundariesAndMarkdown(t *testing.T) {
	for in, want := range map[string]string{
		"~~~md\nignored\n~~~\n\n---\n| :--- | ---: |\n> - [x] **文字** ![图](a.png) 和 [链接](url)": "文字  和 链接",
		strings.Repeat("字", 43):                strings.Repeat("字", 42) + "…",
		"<!-- comment -->\n![图](a.png)\n***\n": "未命名文稿",
	} {
		if got := inferredTitle(in); got != want {
			t.Errorf("inferredTitle(%q) = %q, want %q", in, got, want)
		}
	}
	if got := excerptOf(strings.Repeat(" ", 4095) + "字后"); got != "" || !utf8.ValidString(got) {
		t.Fatalf("excerpt read beyond the rune-aligned prefix: %q", got)
	}
}

func TestExcerptUpdatesAfterEditingAndDiskReload(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "旧正文")
	if d.Excerpt != "旧正文" {
		t.Fatalf("missing excerpt: %+v", d)
	}
	d = edit(t, w, "新正文")
	if d.Excerpt != "新正文" {
		t.Fatalf("stale excerpt: %+v", d)
	}
	p := filepath.Join(t.TempDir(), "note.md")
	if _, err := w.SaveAs(d.ID, p); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("磁盘正文"), 0644); err != nil {
		t.Fatal(err)
	}
	s := w.State()
	if s.Current.Excerpt != "磁盘正文" {
		t.Fatalf("reload kept stale excerpt: %+v", s.Current)
	}
	if err := os.WriteFile(p, []byte("再次载入正文"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := w.Reload(d.ID)
	if err != nil || s.Current.Excerpt != "再次载入正文" {
		t.Fatalf("explicit reload kept stale excerpt: %+v %v", s.Current, err)
	}
}
