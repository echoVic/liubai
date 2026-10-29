package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
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
