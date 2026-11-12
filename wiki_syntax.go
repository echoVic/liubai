package main

import (
	"bytes"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

type wikiReference struct {
	Target   string
	From, To int
}

func wikiName(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	for _, r := range raw {
		if unicode.IsControl(r) || strings.ContainsRune("[]|", r) {
			return "", false
		}
	}
	name := strings.TrimFunc(raw, wikiMathSpace)
	return name, name != "" && utf8.RuneCountInString(name) <= 256
}

type wikiInlineParser struct {
	references   []wikiReference
	parent       ast.Node
	blockedUntil int
	// failed holds the start of every rejected candidate that blocked the rest
	// of its bracket region; native holds those found to open a native link or
	// image, which block nothing.
	failed []int
	native map[int]bool
}

func (p *wikiInlineParser) block(from, to int) {
	p.blockedUntil = to
	p.failed = append(p.failed, from)
}

func (*wikiInlineParser) Trigger() []byte { return []byte{'[', '!'} }

func (p *wikiInlineParser) Parse(parent ast.Node, reader text.Reader, _ parser.Context) ast.Node {
	if p.parent != parent {
		p.parent = parent
		p.blockedUntil = 0
	}
	line, segment := reader.PeekLine()
	if bytes.HasPrefix(line, []byte("![[")) {
		line = line[1:]
		segment.Start++
	}
	if segment.Padding != 0 || segment.Start < p.blockedUntil || !bytes.HasPrefix(line, []byte("[[")) || p.native[segment.Start] {
		return nil
	}
	source := reader.Source()
	// A third opening bracket still blocks the rest of its region, as in both TypeScript parsers.
	preceded := segment.Start > 0 && source[segment.Start-1] == '['
	end, depth, boundary := -1, 1, len(line)
	for i := 2; i < len(line); i++ {
		if line[i] == '\r' || line[i] == '\n' {
			boundary = i + 1
			break
		}
		if i+1 == len(line) {
			break
		}
		if line[i] == '[' && line[i+1] == '[' {
			depth++
			i++
		} else if line[i] == ']' && line[i+1] == ']' {
			depth--
			i++
			if depth == 0 {
				end = i + 1
				break
			}
		}
	}
	if end < 0 {
		p.block(segment.Start, segment.Start+boundary)
		return nil
	}
	// An escaped first closing bracket is literal text, so there is no closer.
	name, ok := wikiName(string(line[2 : end-2]))
	if preceded || end < len(line) && line[end] == ']' || wikiEscaped(line, end-2) || !ok {
		p.block(segment.Start, segment.Start+end)
		return nil
	}
	p.blockedUntil = segment.Start + end
	p.references = append(p.references, wikiReference{Target: name, From: segment.Start, To: segment.Start + end})
	// Leave brackets to Goldmark so a later closing label can still make a
	// native Link/Image. Candidates are accepted only after AST exclusions.
	return nil
}

func wikiReferences(content string) []wikiReference {
	if !strings.Contains(content, "[[") {
		return nil
	}
	prefix := frontMatterEnd(content)
	source := []byte(content[prefix:])
	native := map[int]bool{}
	var inline *wikiInlineParser
	var spans *wikiSpanCollector
	// A rejected "[[" whose first bracket opens a native link or image, as in
	// "[[1] Smith](url) [[Topic]]", leaves the rest of the line to that link,
	// as in both TypeScript parsers. Goldmark resolves links only after the
	// candidate was seen, so parse again without blocking there; the bound
	// only matters for images nested in link labels.
	for pass := 0; pass < 3; pass++ {
		inline, spans = &wikiInlineParser{native: native}, &wikiSpanCollector{}
		md := goldmark.New(
			goldmark.WithExtensions(extension.Table, extension.Strikethrough, extension.Footnote, extension.Linkify),
			goldmark.WithParserOptions(
				parser.WithInlineParsers(util.Prioritized(inline, 150), util.Prioritized(wikiMathInlineParser{}, 150)),
				parser.WithParagraphTransformers(util.Prioritized(wikiMathParagraphTransformer{}, 50)),
				parser.WithASTTransformers(util.Prioritized(spans, 998)),
			),
		)
		md.Parser().Parse(text.NewReader(source))
		changed := false
		for _, from := range inline.failed {
			if spans.labels[from+1] && !native[from] {
				native[from], changed = true, true
			}
		}
		if !changed {
			break
		}
	}
	allowed := spans.allowed
	sort.Slice(inline.references, func(i, j int) bool { return inline.references[i].From < inline.references[j].From })
	sort.Slice(allowed, func(i, j int) bool { return allowed[i].from < allowed[j].from })
	inText := func(at int) bool {
		i := sort.Search(len(allowed), func(i int) bool { return allowed[i].to > at })
		return i < len(allowed) && allowed[i].from <= at
	}
	references := make([]wikiReference, 0, len(inline.references))
	for _, ref := range inline.references {
		// Code, math, raw HTML and autolinks bind tighter than the brackets:
		// a closer inside one of them closes nothing.
		if !inText(ref.From) || !inText(ref.To-1) {
			continue
		}
		ref.From += prefix
		ref.To += prefix
		references = append(references, ref)
	}
	return references
}

type wikiSourceSpan struct{ from, to int }
type wikiSpanCollector struct {
	allowed []wikiSourceSpan
	// labels holds where the label text of each native link or image starts.
	labels map[int]bool
}

// Collect native text contexts after inline parsing and before Goldmark's
// footnote transformer (999) removes uncited definitions from the rendered AST.
func (p *wikiSpanCollector) Transform(root *ast.Document, _ text.Reader, _ parser.Context) {
	_ = ast.Walk(root, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n := node.(type) {
		case *ast.Link, *ast.Image:
			for child := node.FirstChild(); child != nil; child = child.FirstChild() {
				if value, ok := child.(*ast.Text); ok {
					if p.labels == nil {
						p.labels = map[int]bool{}
					}
					p.labels[value.Segment.Start] = true
					break
				}
			}
			return ast.WalkSkipChildren, nil
		case *ast.AutoLink, *ast.RawHTML, *ast.HTMLBlock, *ast.FencedCodeBlock, *ast.CodeBlock, *ast.CodeSpan, *wikiMathBlock:
			// Only text outside these is collected; a reference must start in it.
			return ast.WalkSkipChildren, nil
		case *ast.Text:
			p.allowed = append(p.allowed, wikiSourceSpan{n.Segment.Start, n.Segment.Stop})
		}
		return ast.WalkContinue, nil
	})
}

// These dollar predicates mirror src/math.ts, including its first-dollar
// closing rule and paragraph-only display math.
func wikiMathSpace(r rune) bool {
	return r == '\ufeff' || r != '\u0085' && unicode.IsSpace(r)
}

func wikiEscaped(source []byte, at int) bool {
	n := 0
	for at > 0 && source[at-1] == '\\' {
		n++
		at--
	}
	return n%2 != 0
}

type wikiMathInlineParser struct{}

func (wikiMathInlineParser) Trigger() []byte { return []byte{'$'} }

func (wikiMathInlineParser) Parse(_ ast.Node, reader text.Reader, _ parser.Context) ast.Node {
	line, segment := reader.PeekLine()
	if len(line) < 2 {
		return nil
	}
	if line[1] == '$' {
		end := 2
		for end < len(line) && line[end] == '$' {
			end++
		}
		reader.Advance(end)
		return ast.NewTextSegment(text.NewSegment(segment.Start, segment.Start+end))
	}
	next, _ := utf8.DecodeRune(line[1:])
	if wikiMathSpace(next) || wikiEscaped(reader.Source(), segment.Start) {
		return nil
	}
	for end := 1; end < len(line) && line[end] != '\n' && line[end] != '\r'; end++ {
		if line[end] != '$' || wikiEscaped(line, end) {
			continue
		}
		previous, _ := utf8.DecodeLastRune(line[:end])
		if end == 1 || wikiMathSpace(previous) || end+1 < len(line) && line[end+1] >= '0' && line[end+1] <= '9' {
			return nil
		}
		node := ast.NewCodeSpan()
		node.AppendChild(node, ast.NewTextSegment(text.NewSegment(segment.Start, segment.Start+end+1)))
		reader.Advance(end + 1)
		return node
	}
	return nil
}

type wikiMathBlock struct{ ast.BaseBlock }

var wikiMathBlockKind = ast.NewNodeKind("WikiMathBlock")

func (*wikiMathBlock) Kind() ast.NodeKind { return wikiMathBlockKind }
func (*wikiMathBlock) IsRaw() bool        { return true }
func (n *wikiMathBlock) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, nil, nil)
}

type wikiMathParagraphTransformer struct{}

func (wikiMathParagraphTransformer) Transform(node *ast.Paragraph, reader text.Reader, _ parser.Context) {
	lines := node.Lines()
	if lines.Len() == 0 {
		return
	}
	first := lines.At(0)
	if !bytes.HasPrefix(first.Value(reader.Source()), []byte("$$")) {
		return
	}
	var body strings.Builder
	for i := 0; i < lines.Len(); i++ {
		line := lines.At(i)
		body.Write(line.Value(reader.Source()))
	}
	raw := strings.TrimRightFunc(body.String(), wikiMathSpace)
	if len(raw) < 4 || !strings.HasSuffix(raw, "$$") || wikiEscaped([]byte(raw), len(raw)-2) {
		return
	}
	block := &wikiMathBlock{}
	block.SetLines(lines)
	node.Parent().ReplaceChild(node.Parent(), node, block)
}
