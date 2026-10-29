package main

import (
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

type CaptureRequest struct {
	Text     string   `json:"text"`
	Tags     []string `json:"tags"`
	TargetID string   `json:"targetID"`
	Revision int      `json:"revision"`
}

type CaptureAppendResult struct {
	Document Document     `json:"document"`
	Changes  []TextChange `json:"changes"`
	Summary  Summary      `json:"summary"`
}

func capturePropertyLines(content string, end int) []string {
	lines := strings.SplitAfter(content[:end], "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func captureTagValues(tags *yaml.Node) ([]string, error) {
	values := []string{}
	switch {
	case tags.Kind == 0 || tags.Kind == yaml.ScalarNode && tags.Tag == "!!null":
	case tags.Kind == yaml.ScalarNode && tags.Tag == "!!str":
		values = append(values, tags.Value)
	case tags.Kind == yaml.SequenceNode:
		for _, tag := range tags.Content {
			if tag.Kind != yaml.ScalarNode || tag.Tag != "!!str" {
				return nil, messageError("bCaptureTagsMetadata", nil)
			}
			values = append(values, tag.Value)
		}
	default:
		return nil, messageError("bCaptureTagsMetadata", nil)
	}
	return values, nil
}

func summaryOf(d *Document) Summary {
	s := Summary{ID: d.ID, Title: d.Title, Path: d.Path, Updated: d.Updated, Excerpt: d.Excerpt}
	end := frontMatterEnd(d.Content)
	if end == 0 {
		return s
	}
	lines := capturePropertyLines(d.Content, end)
	body := strings.Join(lines[1:len(lines)-1], "")
	var fields map[string]yaml.Node
	if yaml.Unmarshal([]byte(body), &fields) != nil {
		return s
	}
	tags := fields["tags"]
	values, err := captureTagValues(&tags)
	if err != nil {
		return s
	}
	s.Tags, _ = normalizeTags(values)
	return s
}

func normalizeTags(tags []string) ([]string, error) {
	result := []string{}
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(tag), "#"))
		if tag == "" {
			continue
		}
		if !utf8.ValidString(tag) || utf8.RuneCountInString(tag) > 80 || strings.ContainsFunc(tag, unicode.IsControl) {
			return nil, messageError("bCaptureInvalidTags", nil)
		}
		if !seen[tag] {
			result = append(result, tag)
			seen[tag] = true
		}
	}
	if len(result) > 32 {
		return nil, messageError("bCaptureInvalidTags", nil)
	}
	return result, nil
}

// Only the tags field is rewritten; other properties, comments and body stay verbatim.
func captureTags(content string, input []string) (string, []TextChange, error) {
	tags, err := normalizeTags(input)
	if err != nil || len(tags) == 0 {
		return content, nil, err
	}
	from, to := 0, 0
	insertPrefix, insertSuffix := "---\n", "\n---\n\n"
	if end := frontMatterEnd(content); end > 0 {
		lines := capturePropertyLines(content, end)
		raw := strings.Join(lines[1:len(lines)-1], "")
		var node yaml.Node
		if yaml.Unmarshal([]byte(raw), &node) != nil {
			return content, nil, messageError("bCaptureTagsMetadata", nil)
		}
		mapping := &yaml.Node{Kind: yaml.MappingNode}
		if len(node.Content) > 0 {
			mapping = node.Content[0]
			var values map[string]any
			if mapping.Kind != yaml.MappingNode || mapping.Style&yaml.FlowStyle != 0 || node.Decode(&values) != nil {
				return content, nil, messageError("bCaptureTagsMetadata", nil)
			}
		}
		from = len(lines[0])
		to = from
		insertPrefix, insertSuffix = "", "\n"
		if len(mapping.Content) > 0 {
			insertPrefix = strings.Repeat(" ", mapping.Content[0].Column-1)
		}
		for i := 0; i < len(mapping.Content); i += 2 {
			key, value := mapping.Content[i], mapping.Content[i+1]
			if key.Value != "tags" {
				continue
			}
			existing, err := captureTagValues(value)
			if err != nil {
				return content, nil, err
			}
			anchored := key.Anchor != "" || value.Anchor != ""
			for _, tag := range value.Content {
				anchored = anchored || tag.Anchor != ""
			}
			if anchored {
				return content, nil, messageError("bCaptureTagsMetadata", nil)
			}
			tags, err = normalizeTags(append(existing, tags...))
			if err != nil {
				return content, nil, err
			}
			// Node line numbers are relative to the YAML body.
			from = len(strings.Join(lines[:key.Line], ""))
			insertPrefix = strings.Repeat(" ", key.Column-1)
			last := value.Line
			// Scalars may span multiple physical lines.
			if i+2 < len(mapping.Content) {
				last = mapping.Content[i+2].Line - 1
			} else {
				last = len(strings.Split(strings.TrimSuffix(raw, "\n"), "\n"))
			}
			for last > value.Line {
				line := strings.TrimSpace(lines[last])
				if line != "" && !strings.HasPrefix(line, "#") {
					break
				}
				last--
			}
			to = len(strings.Join(lines[:last+1], ""))
			break
		}
	} else if strings.HasPrefix(content, "---\n") || strings.HasPrefix(content, "---\r\n") {
		return content, nil, messageError("bCaptureTagsMetadata", nil)
	}
	b, _ := json.Marshal(tags)
	insert := insertPrefix + "tags: " + string(b) + insertSuffix
	change := TextChange{len(utf16.Encode([]rune(content[:from]))), len(utf16.Encode([]rune(content[:to]))), insert}
	return content[:from] + insert + content[to:], []TextChange{change}, nil
}

func (w *Workspace) CaptureWithTags(text string, tags []string) (Summary, error) {
	if strings.TrimSpace(text) == "" {
		return Summary{}, messageError("bCaptureEmpty", nil)
	}
	if len(text) > maxDocument || !utf8.ValidString(text) {
		return Summary{}, messageError("bInvalidDocument", nil)
	}
	content, _, err := captureTags(text, tags)
	if err != nil {
		return Summary{}, err
	}
	return w.Capture(content)
}

func (w *Workspace) AppendCapture(req CaptureRequest) (CaptureAppendResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[req.TargetID]
	if d == nil {
		return CaptureAppendResult{}, messageError("bDocumentMissing", nil)
	}
	if req.Revision >= 0 && req.Revision != d.Revision {
		return CaptureAppendResult{}, messageError("bDocumentChanged", nil)
	}
	if strings.TrimSpace(req.Text) == "" {
		return CaptureAppendResult{}, messageError("bCaptureEmpty", nil)
	}
	if len(req.Text) > maxDocument || !utf8.ValidString(req.Text) {
		return CaptureAppendResult{}, messageError("bInvalidDocument", nil)
	}
	w.check(d, false)
	if d.Conflict {
		return CaptureAppendResult{}, messageError("bDiskChanged", nil)
	}
	content, changes, err := captureTags(d.Content, req.Tags)
	if err != nil {
		return CaptureAppendResult{}, err
	}
	separator := "\n\n"
	if content == "" {
		separator = ""
	} else if strings.HasSuffix(content, "\n\n") {
		separator = ""
	} else if strings.HasSuffix(content, "\n") {
		separator = "\n"
	}
	insert := separator + req.Text
	length := len(utf16.Encode([]rune(d.Content)))
	changes = append(changes, TextChange{length, length, insert})
	result, err := w.updateLocked(Edit{ID: d.ID, Revision: d.Revision, Content: content + insert, Position: d.Position})
	return CaptureAppendResult{result, changes, summaryOf(&result)}, err
}
