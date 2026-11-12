package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf16"

	"gopkg.in/yaml.v3"
)

func TestCaptureTagsPersistInMarkdownWithoutChangingCurrent(t *testing.T) {
	root := t.TempDir()
	w, _ := openWorkspace(root)
	before := w.State().Current
	s, err := w.CaptureWithTags("中文想法 📝\n正文", []string{" 工作 ", "#灵感", "工作"})
	if err != nil {
		t.Fatal(err)
	}
	if s.Title != "中文想法 📝" || !reflect.DeepEqual(s.Tags, []string{"工作", "灵感"}) || !reflect.DeepEqual(w.State().Current, before) {
		t.Fatalf("capture = %+v", s)
	}
	w, _ = openWorkspace(root)
	d := w.docs[s.ID]
	if d.Content != "---\ntags: [\"工作\",\"灵感\"]\n---\n\n中文想法 📝\n正文" {
		t.Fatalf("markdown = %q", d.Content)
	}
	if !reflect.DeepEqual(w.snapshot().Recent[0].Tags, s.Tags) {
		t.Fatal("tags disappeared from the document list after reopen")
	}
}

func TestAppendCapturePreservesMetadataAndCurrentDocument(t *testing.T) {
	w := workspace(t)
	target, _ := w.Capture("---\ntitle: 我的文稿\n# keep this comment\nauthor: 作者\ntags:\n  - 工作\n  - 中文\n---\n\n已有正文 📝\n")
	before := w.State().Current
	result, err := w.AppendCapture(CaptureRequest{TargetID: target.ID, Revision: -1, Text: "- [ ] 新任务", Tags: []string{"工作", "灵感"}})
	if err != nil {
		t.Fatal(err)
	}
	want := "---\ntitle: 我的文稿\n# keep this comment\nauthor: 作者\ntags: [\"工作\",\"中文\",\"灵感\"]\n---\n\n已有正文 📝\n\n- [ ] 新任务"
	if result.Document.Content != want || !reflect.DeepEqual(w.State().Current, before) {
		t.Fatalf("append = %+v", result)
	}
	if result.Document.Revision != 1 || len(result.Changes) != 2 {
		t.Fatalf("revision or changes = %+v", result)
	}
}

func TestAppendCaptureRejectsStaleRevisionAndDiskConflict(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	_, _ = w.Update(Edit{ID: d.ID, Content: "未保存到文件的文字"})
	if _, err := w.AppendCapture(CaptureRequest{TargetID: d.ID, Revision: d.Revision, Text: "追加"}); err == nil {
		t.Fatal("stale append accepted")
	}
	path := filepath.Join(t.TempDir(), "note.md")
	_ = os.WriteFile(path, []byte("磁盘原文"), 0600)
	state, _ := w.Open(path)
	_ = os.WriteFile(path, []byte("另一应用的修改"), 0600)
	if _, err := w.AppendCapture(CaptureRequest{TargetID: state.Current.ID, Revision: -1, Text: "追加"}); err == nil {
		t.Fatal("conflicting append accepted")
	}
	b, _ := os.ReadFile(path)
	if string(b) != "另一应用的修改" || w.docs[state.Current.ID].Content != "磁盘原文" {
		t.Fatal("conflict overwrote text")
	}
}

func TestCaptureTagMergeRejectsAmbiguousMetadata(t *testing.T) {
	w := workspace(t)
	for _, text := range []string{
		"---\ntags: [broken\n---\n正文",
		"---\ntags: [工作]\ntags: [重复]\n---\n正文",
		"---\ntags: {nested: true}\n---\n正文",
		"---\n{title: 原标题, tags: [工作]}\n---\n正文",
	} {
		if _, err := w.CaptureWithTags(text, []string{"新增"}); err == nil {
			t.Fatalf("ambiguous tags accepted: %q", text)
		}
	}
	for _, tags := range [][]string{{"bad\nkey"}, {strings.Repeat("字", 81)}} {
		if _, err := w.CaptureWithTags("正文", tags); err == nil {
			t.Fatal("invalid tags accepted")
		}
	}
}

func TestCaptureTagsPreserveCommentsAndEmptyProperties(t *testing.T) {
	for _, text := range []string{"---\n---\n正文", "---\n# 属性说明\n---\n正文"} {
		content, _, err := captureTags(text, []string{"工作"})
		if err != nil || !strings.Contains(content, "tags: [\"工作\"]\n") {
			t.Fatalf("empty properties: %q, %v", content, err)
		}
	}
	text := "---\ntags:\n  - 工作\n# 作者说明\nauthor: 作者\n---\n正文"
	content, _, err := captureTags(text, []string{"灵感"})
	if err != nil || !strings.Contains(content, "# 作者说明\nauthor: 作者") {
		t.Fatalf("comments were removed: %q, %v", content, err)
	}
}

func TestCaptureTagsKeepCommentsOnRewrittenLines(t *testing.T) {
	for text, want := range map[string]string{
		"---\ntags: [a] # 说明\nx: 1\n---\nbody":                           "---\ntags: [\"a\",\"new\"] # 说明\nx: 1\n---\nbody",
		"---\ntags:\n  - a   # why\n  - b\n\n# about z\nz: 1\n---\nbody": "---\ntags: [\"a\",\"b\",\"new\"]\n# why\n\n# about z\nz: 1\n---\nbody",
		"---\ntags:\n  # first\n  - a\nz: 1\n---\nbody":                  "---\ntags: [\"a\",\"new\"]\n# first\nz: 1\n---\nbody",
		"---\n  x: 1\n  tags: [a] # c\n---\nbody":                        "---\n  x: 1\n  tags: [\"a\",\"new\"] # c\n---\nbody",
		"---\ntags: [\"a #b\"] # c\n---\nbody":                           "---\ntags: [\"a #b\",\"new\"] # c\n---\nbody",
		"---\ntags: |\n  #a\nz: 1\n---\nbody":                            "---\ntags: [\"a\",\"new\"]\nz: 1\n---\nbody",
		"---\n? tags\n: [a]\nz: 3\n---\nbody":                            "---\ntags: [\"a\",\"new\"]\nz: 3\n---\nbody",
		"---\n? a\n: 1\n---\nbody":                                       "---\ntags: [\"new\"]\n? a\n: 1\n---\nbody",
	} {
		got, _, err := captureTags(text, []string{"new"})
		if err != nil || got != want {
			t.Errorf("captureTags(%q) = %q, %v; want %q", text, got, err, want)
		}
	}
}

// Every accepted rewrite keeps the other properties, the body and the change offsets.
func TestCaptureTagsKeepOtherProperties(t *testing.T) {
	fields := func(content string) (map[string]any, string, bool) {
		end := frontMatterEnd(content)
		if end == 0 {
			// New front matter is followed by a blank line before the old text.
			return map[string]any{}, "\n" + content, true
		}
		lines := capturePropertyLines(content, end)
		m := map[string]any{}
		if err := yaml.Unmarshal([]byte(strings.Join(lines[1:len(lines)-1], "")), &m); err != nil {
			return nil, "", false
		}
		delete(m, "tags")
		return m, content[end:], true
	}
	for _, text := range []string{
		"---\ntags: [a] # comment\nx: 1\n---\nbody", "---\ntags:\n- a\n- b\nx: 1\n---\nbody",
		"---\ntags:\n  - a\n\n\nx: 1\n---\nbody", "---\ntags: a\n  b\nx: 1\n---\nbody",
		"---\n\"tags\": [a]\n---\nbody", "---\ntags : [a]\n---\nbody", "---\nx:\n  tags: [inner]\ny: 2\n---\nbody",
		"---\n? tags\n: [a]\nz: 3\n---\nbody", "---\n? tags\n:\n  - a\nz: 3\n---\nbody", "---\n? a\n: 1\nz: 3\n---\nbody",
		"---\ntags: [a]\n...\nbody", "---\ntags: [a,\n  b]\nz: 1\n---\nbody",
		"---\nz: 1\ntags: [a]\n# trailing comment\n---\nbody", "---\ntags: |\n  a\nz: 1\n---\nbody",
		"---\ntags: |\n  #a\nz: 1\n---\nbody", "---\ntags: >-\n  a\n\nz: 1\n---\nbody", "---\r\ntags: [a] # c\r\nx: 1\r\n---\r\nbody",
		"---\n# c\ntags: [a]\n---\nbody", "---\ntags:\n  - a   # why\n  - b\n\n# about z\nz: 1\n---\nbody",
		"---\ntags:\n  # first\n  - a\nz: 1\n---\nbody", "---\nz: |\n  tags: [x]\n  more\ntags: [a]\n---\nbody",
		"---\nz: 1\ntags:\n---\nbody", "---\nz: 1\ntags: ~\ny: 2\n---\nbody", "---\ntags: 'a'\ny: 2\n---\nbody",
		"---\ntags: \"a\n  b\"\ny: 2\n---\nbody", "---\ntags:\n  - a\n  -\n    b\ny: 2\n---\nbody",
		"---\ntags: [a]\ny: 2\n--- \nbody", "---\ntags: [a]\ny: 2\n---", "---\ny: 2\n---", "---\n---", "---\n\n\n---\nbody",
		"---\ntitle: 中😀\ntags: [中😀] # 😀\n---\n😀 body", "---\n  a: 1\n  tags:\n    - x\n  b: 2\n---\nbody",
		"---\ntags:\n\n  - a\n---\nbody", "---\ntags: [a]   \n\n\n---\nbody", "---\ntags: [\"#a\", a]\nz: 1\n---\nbody",
		"body only", "",
	} {
		content, changes, err := captureTags(text, []string{"new"})
		if err != nil {
			continue
		}
		before, bodyBefore, _ := fields(text)
		after, bodyAfter, ok := fields(content)
		if !ok || !reflect.DeepEqual(before, after) || bodyBefore != bodyAfter {
			t.Errorf("properties or body changed:\n in=%q\nout=%q", text, content)
		}
		want, _ := normalizeTags(append(summaryOf(&Document{Content: text}).Tags, "new"))
		if tags := summaryOf(&Document{Content: content}).Tags; !reflect.DeepEqual(tags, want) {
			t.Errorf("tags of %q = %v, want %v", content, tags, want)
		}
		u := utf16.Encode([]rune(text))
		if len(changes) != 1 || string(utf16.Decode(u[:changes[0].From]))+changes[0].Insert+string(utf16.Decode(u[changes[0].To:])) != content {
			t.Errorf("change does not reproduce %q from %q: %+v", content, text, changes)
		}
	}
}

func TestAppendCapturePreservesFileEncodingAndRollback(t *testing.T) {
	w := workspace(t)
	path := filepath.Join(t.TempDir(), "note.md")
	_ = os.WriteFile(path, []byte("\xef\xbb\xbf# 正文 📝\r\n\r\n已有文字\r\n"), 0600)
	state, _ := w.Open(path)
	result, err := w.AppendCapture(CaptureRequest{TargetID: state.Current.ID, Revision: state.Current.Revision, Text: "新文字", Tags: []string{"工作"}})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	if !strings.HasPrefix(string(b), "\xef\xbb\xbf---\r\n") || !strings.HasSuffix(string(b), "已有文字\r\n\r\n新文字") {
		t.Fatalf("encoding = %q", b)
	}
	// Editor changes use UTF-16 offsets, including supplementary characters.
	if result.Changes[1].From != 14 {
		t.Fatalf("UTF-16 append offset = %+v", result.Changes)
	}
	draft, _ := w.Capture("保留草稿")
	before := w.docs[draft.ID].Content
	_ = os.Remove(filepath.Join(w.root, "drafts", draft.ID+".json"))
	_ = os.Mkdir(filepath.Join(w.root, "drafts", draft.ID+".json"), 0700)
	if _, err := w.AppendCapture(CaptureRequest{TargetID: draft.ID, Revision: -1, Text: "不应追加"}); err == nil || w.docs[draft.ID].Content != before {
		t.Fatal("failed append changed the draft")
	}
}

func TestCaptureContextDoesNotReloadTheEditorBehindPendingText(t *testing.T) {
	w := workspace(t)
	path := filepath.Join(t.TempDir(), "note.md")
	_ = os.WriteFile(path, []byte("原文"), 0600)
	state, _ := w.Open(path)
	_ = os.WriteFile(path, []byte("外部修改的长正文"), 0600)
	context := (&Desktop{w: w}).GetCaptureContext()
	if len(context.Recent) == 0 || w.docs[state.Current.ID].Revision != state.Current.Revision || w.docs[state.Current.ID].Content != "原文" {
		t.Fatal("opening capture silently reloaded the active document")
	}
}

func TestCaptureTagsKeepIndentedRootPropertiesValid(t *testing.T) {
	for _, text := range []string{
		"---\n  title: 标题\n  tags: [工作]\n---\n正文",
		"---\n  title: 标题\n---\n正文",
	} {
		content, _, err := captureTags(text, []string{"灵感"})
		if err != nil || !strings.Contains(content, "\n  tags:") {
			t.Fatalf("indented metadata = %q, %v", content, err)
		}
		if tags := summaryOf(&Document{Content: content}).Tags; len(tags) == 0 {
			t.Fatalf("invalid metadata after merge: %q", content)
		}
	}
}

func TestAppendCaptureKeepsAnchoredMetadataUnchanged(t *testing.T) {
	for _, metadata := range []string{
		"tags: [&shared work]\ncategory: *shared",
		"tags:\n  - &shared work\ncategory: *shared",
		"&shared tags: [work]\ncategory: *shared",
		"tags: &shared [work]\ncategory: *shared",
		"tags: &shared work\ncategory: *shared",
	} {
		t.Run(metadata, func(t *testing.T) {
			w := workspace(t)
			content := "---\n" + metadata + "\n---\n正文"
			target, err := w.Capture(content)
			if err != nil {
				t.Fatal(err)
			}
			before := *w.docs[target.ID]
			_, err = w.AppendCapture(CaptureRequest{TargetID: target.ID, Revision: -1, Text: "追加", Tags: []string{"new"}})
			if err == nil || !reflect.DeepEqual(*w.docs[target.ID], before) {
				t.Fatalf("anchored metadata changed: %q, %v", w.docs[target.ID].Content, err)
			}
		})
	}
}

func TestAppendCaptureReportsReadOnlyRecoveryWithoutLosingText(t *testing.T) {
	requirePermissionChecks(t)
	w := workspace(t)
	path := filepath.Join(t.TempDir(), "read-only.md")
	_ = os.WriteFile(path, []byte("文件原文"), 0400)
	state, _ := w.Open(path)
	result, err := (&Desktop{w: w}).AppendCapture(CaptureRequest{TargetID: state.Current.ID, Revision: -1, Text: "新想法"})
	if err != nil || result.Summary.Warning == "" || result.Document.Content != "文件原文\n\n新想法" {
		t.Fatalf("read-only capture: %+v, %v", result, err)
	}
	b, _ := os.ReadFile(path)
	if string(b) != "文件原文" {
		t.Fatal("read-only file was overwritten")
	}
}

func TestCaptureDestinationTitlesFollowRequestLocale(t *testing.T) {
	w := workspace(t)
	context := (&Desktop{w: w}).GetCaptureContext()
	english := valueIn(context, "en").(CaptureContext)
	if english.Recent[0].Title != "Untitled Document" {
		t.Fatalf("English destination = %+v", english.Recent)
	}
}

func TestCaptureTagsKeepAmpersandsAndAngleBrackets(t *testing.T) {
	content, _, err := captureTags("正文", []string{"R&D", "a<b>"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(content, `tags: ["R&D","a<b>"]`) {
		t.Fatalf("tags were escaped in the Markdown: %q", content)
	}
}
