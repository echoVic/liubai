package main

import (
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"sync"
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

// frontMatter holds the properties read from a document's front matter.
type frontMatter struct {
	parsed bool
	title  string
	tags   []string
}

func parseFrontMatter(content string, end int) frontMatter {
	lines := capturePropertyLines(content, end)
	body := strings.Join(lines[1:len(lines)-1], "")
	var fields map[string]yaml.Node
	if yaml.Unmarshal([]byte(body), &fields) != nil {
		return frontMatter{}
	}
	meta := frontMatter{parsed: true}
	if title := fields["title"]; title.Kind == yaml.ScalarNode && title.Tag != "!!null" {
		meta.title = strings.Join(strings.Fields(title.Value), " ")
	}
	tags := fields["tags"]
	if values, err := captureTagValues(&tags); err == nil {
		meta.tags, _ = normalizeTags(values)
	}
	return meta
}

// State and FilterDocuments read the properties of every document on every
// call, and YAML parsing dominates their cost. Entries are keyed by document
// ID and hold the exact front matter they were parsed from, so a document
// whose text changed without a revision bump is parsed again.
var frontMatterCache = struct {
	sync.Mutex
	entries map[string]frontMatterEntry
	bytes   int
}{entries: map[string]frontMatterEntry{}}

type frontMatterEntry struct {
	text string
	meta frontMatter
}

const frontMatterCacheBytes = 16 << 20

func cachedFrontMatter(id, content string, end int) frontMatter {
	text := content[:end]
	if id == "" || len(text) > frontMatterCacheBytes/256 {
		return parseFrontMatter(content, end)
	}
	frontMatterCache.Lock()
	entry, ok := frontMatterCache.entries[id]
	frontMatterCache.Unlock()
	if !ok || entry.text != text {
		entry = frontMatterEntry{strings.Clone(text), parseFrontMatter(content, end)}
		frontMatterCache.Lock()
		if old, ok := frontMatterCache.entries[id]; ok {
			frontMatterCache.bytes -= len(old.text)
		}
		if len(frontMatterCache.entries) >= 8192 || frontMatterCache.bytes+len(text) > frontMatterCacheBytes {
			clear(frontMatterCache.entries)
			frontMatterCache.bytes = 0
		}
		frontMatterCache.entries[id] = entry
		frontMatterCache.bytes += len(text)
		frontMatterCache.Unlock()
	}
	// Callers may rewrite the tag slice in place.
	entry.meta.tags = slices.Clone(entry.meta.tags)
	return entry.meta
}

// pruneDocumentCaches drops cached properties and wiki references of
// documents that are no longer in docs.
func pruneDocumentCaches(docs map[string]*Document) {
	frontMatterCache.Lock()
	for id, entry := range frontMatterCache.entries {
		if docs[id] == nil {
			delete(frontMatterCache.entries, id)
			frontMatterCache.bytes -= len(entry.text)
		}
	}
	frontMatterCache.Unlock()
	pruneWikiReferenceCache(docs)
}

func summaryOf(d *Document) Summary {
	s := Summary{ID: d.ID, Title: d.Title, Path: d.Path, Updated: d.Updated, Excerpt: d.Excerpt}
	if end := frontMatterEnd(d.Content); end > 0 {
		if meta := cachedFrontMatter(d.ID, d.Content, end); meta.parsed {
			s.Tags = meta.tags
		}
	}
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

// captureComments collects every comment yaml.v3 found in node, one per line.
func captureComments(node *yaml.Node, comments map[string]bool) {
	for _, text := range []string{node.HeadComment, node.LineComment, node.FootComment} {
		for line := range strings.Lines(text) {
			if line = strings.TrimSpace(line); line != "" {
				comments[line] = true
			}
		}
	}
	for _, child := range node.Content {
		captureComments(child, comments)
	}
}

// captureComment returns the comment that ends a property line. Only text
// yaml.v3 reported as a comment counts, so a # inside a quoted or block
// scalar is never taken for one.
func captureComment(line string, comments map[string]bool) string {
	line = strings.TrimRight(line, " \t\r\n")
	for i := 0; i < len(line); i++ {
		if line[i] == '#' && (i == 0 || line[i-1] == ' ' || line[i-1] == '\t') && comments[line[i:]] {
			return line[i:]
		}
	}
	return ""
}

func captureIndent(line string) string {
	return line[:len(line)-len(strings.TrimLeft(line, " "))]
}

// Only the tags field is rewritten; other properties, comments and body stay verbatim.
func captureTags(content string, input []string) (string, []TextChange, error) {
	tags, err := normalizeTags(input)
	if err != nil || len(tags) == 0 {
		return content, nil, err
	}
	from, to := 0, 0
	insertPrefix, insertSuffix, trailing, after := "---\n", "\n---\n\n", "", ""
	var values map[string]any
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
			if mapping.Kind != yaml.MappingNode || mapping.Style&yaml.FlowStyle != 0 || node.Decode(&values) != nil {
				return content, nil, messageError("bCaptureTagsMetadata", nil)
			}
		}
		from = len(lines[0])
		to = from
		insertPrefix, insertSuffix = "", "\n"
		// Indent like the key's line: an explicit key ("? a") does not start it.
		if len(mapping.Content) > 0 {
			insertPrefix = captureIndent(lines[mapping.Content[0].Line])
		}
		comments := map[string]bool{}
		captureComments(&node, comments)
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
			insertPrefix = captureIndent(lines[key.Line])
			// Scalars may span multiple physical lines.
			var last int
			if i+2 < len(mapping.Content) {
				last = mapping.Content[i+2].Line - 1
			} else {
				last = len(strings.Split(strings.TrimSuffix(raw, "\n"), "\n"))
			}
			for last > value.Line {
				line := strings.TrimSpace(lines[last])
				if line != "" && captureComment(line, comments) != line {
					break
				}
				last--
			}
			to = len(strings.Join(lines[:last+1], ""))
			// Comments on the replaced lines are kept: the key line's after the
			// new value, the others on lines of their own below it.
			trailing = captureComment(lines[key.Line], comments)
			if trailing != "" {
				trailing = " " + trailing
			}
			for _, line := range lines[key.Line+1 : last+1] {
				if comment := captureComment(line, comments); comment != "" {
					after += insertPrefix + comment + "\n"
				}
			}
			break
		}
	} else if strings.HasPrefix(content, "---\n") || strings.HasPrefix(content, "---\r\n") {
		return content, nil, messageError("bCaptureTagsMetadata", nil)
	}
	// json.Marshal would write & < > as \u escapes into the user's Markdown.
	var encoded strings.Builder
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(tags)
	insert := insertPrefix + "tags: " + strings.TrimSuffix(encoded.String(), "\n") + trailing + insertSuffix + after
	result := content[:from] + insert + content[to:]
	if from > 0 && !captureKeepsProperties(values, result, tags) {
		return content, nil, messageError("bCaptureTagsMetadata", nil)
	}
	change := TextChange{len(utf16.Encode([]rune(content[:from]))), len(utf16.Encode([]rune(content[:to]))), insert}
	return result, []TextChange{change}, nil
}

// captureKeepsProperties reports whether content's front matter decodes to
// before with only its tags replaced, so that a YAML shape this rewrite does
// not foresee is refused rather than given another meaning.
func captureKeepsProperties(before map[string]any, content string, tags []string) bool {
	want := map[string]any{}
	for key, value := range before {
		want[key] = value
	}
	list := make([]any, len(tags))
	for i, tag := range tags {
		list[i] = tag
	}
	want["tags"] = list
	end := frontMatterEnd(content)
	if end == 0 {
		return false
	}
	lines := capturePropertyLines(content, end)
	got := map[string]any{}
	return yaml.Unmarshal([]byte(strings.Join(lines[1:len(lines)-1], "")), &got) == nil && reflect.DeepEqual(got, want)
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
