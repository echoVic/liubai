package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

type ImageResult struct {
	Destination string `json:"destination"`
	URL         string `json:"url"`
	Name        string `json:"name"`
	Markdown    string `json:"markdown"`
}
type ExportResult struct {
	Path      string       `json:"path"`
	Missing   []string     `json:"missing"`
	External  int          `json:"external"`
	Document  Document     `json:"document"`
	Cancelled bool         `json:"cancelled"`
	Changes   []TextChange `json:"changes,omitempty"`
}
type TextChange struct {
	From   int    `json:"from"`
	To     int    `json:"to"`
	Insert string `json:"insert"`
}
type replacement struct {
	start, end int
	value      string
}

type imageRef struct {
	Dest string
	HTML bool
}

var htmlImageSource = regexp.MustCompile(`(?is)<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`)

func imageRefs(s string) []imageRef {
	b := []byte(s)
	doc := goldmark.DefaultParser().Parse(text.NewReader(b))
	seen := map[imageRef]bool{}
	out := []imageRef{}
	add := func(ref imageRef) {
		if !seen[ref] {
			seen[ref] = true
			out = append(out, ref)
		}
	}
	addHTML := func(raw []byte) {
		for _, match := range htmlImageSource.FindAllSubmatch(raw, -1) {
			for _, value := range match[1:] {
				if value != nil {
					add(imageRef{Dest: html.UnescapeString(string(value)), HTML: true})
					break
				}
			}
		}
	}
	_ = ast.Walk(doc, func(n ast.Node, enter bool) (ast.WalkStatus, error) {
		if !enter {
			return ast.WalkContinue, nil
		}
		switch node := n.(type) {
		case *ast.Image:
			add(imageRef{Dest: string(node.Destination)})
		case *ast.HTMLBlock:
			var raw []byte
			for i := 0; i < node.Lines().Len(); i++ {
				line := node.Lines().At(i)
				raw = append(raw, line.Value(b)...)
			}
			if node.HasClosure() {
				raw = append(raw, node.ClosureLine.Value(b)...)
			}
			addHTML(raw)
		case *ast.RawHTML:
			var raw []byte
			for i := 0; i < node.Segments.Len(); i++ {
				segment := node.Segments.At(i)
				raw = append(raw, segment.Value(b)...)
			}
			addHTML(raw)
		}
		return ast.WalkContinue, nil
	})
	return out
}
func imageTargets(s string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, ref := range imageRefs(s) {
		if !seen[ref.Dest] {
			seen[ref.Dest] = true
			out = append(out, ref.Dest)
		}
	}
	return out
}
func external(dest string) bool {
	u, e := url.Parse(dest)
	return e == nil && (u.Scheme == "https" || u.Scheme == "http" || strings.HasPrefix(dest, "//"))
}
func (w *Workspace) imagePath(d *Document, dest string) (string, error) {
	if alias, ok := d.ImageAliases[dest]; ok {
		dest = alias
	} else {
		for key, alias := range d.ImageAliases {
			if canonicalDestination(key) == canonicalDestination(dest) {
				dest = alias
				break
			}
		}
	}
	u, err := url.Parse(dest)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(dest, "liubai-asset:") {
		name := strings.TrimPrefix(dest, "liubai-asset:")
		if filepath.Base(name) != name || strings.ContainsAny(name, "/\\") || name == "" {
			return "", errors.New("无效图片引用")
		}
		return filepath.Join(w.root, "assets", d.ID, name), nil
	}
	if u.Scheme != "" || u.Host != "" {
		return "", errors.New("仅支持本地图片引用")
	}
	p, err := url.PathUnescape(u.Path)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(p) {
		if d.Path == "" {
			return "", errors.New("相对路径缺少文稿目录")
		}
		p = filepath.Join(filepath.Dir(d.Path), filepath.FromSlash(p))
	}
	return p, nil
}
func picture(path string) ([]byte, imageInfo, error) {
	b, err := readLimited(path, maxPicture)
	if err != nil {
		return nil, imageInfo{}, err
	}
	info, err := sniffImage(b)
	if err != nil {
		return nil, imageInfo{}, err
	}
	return b, info, nil
}
func (w *Workspace) ImportImage(id, name, encoded string) (ImageResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return ImageResult{}, errors.New("文稿不存在")
	}
	if len(encoded) > maxPicture*4/3+8 {
		return ImageResult{}, errors.New("图片超过 20 MB")
	}
	b, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ImageResult{}, err
	}
	info, err := sniffImage(b)
	if err != nil {
		return ImageResult{}, errors.New("请选择 PNG、JPEG、GIF、WebP、SVG、AVIF 或 BMP 图片，最长边不超过 16000 像素")
	}
	name = digest(b)[:24] + "." + info.Format
	dir := filepath.Join(w.root, "assets", id)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return ImageResult{}, err
	}
	if err = atomicWrite(filepath.Join(dir, name), b, 0600); err != nil {
		return ImageResult{}, err
	}
	dest := "liubai-asset:" + name
	if d.Path != "" {
		assetDir := strings.TrimSuffix(filepath.Base(d.Path), filepath.Ext(d.Path)) + ".assets"
		diskDir := filepath.Join(filepath.Dir(d.Path), assetDir)
		if err = os.MkdirAll(diskDir, 0755); err != nil {
			return ImageResult{}, err
		}
		if err = writeImageExclusive(filepath.Join(diskDir, name), b); err != nil {
			return ImageResult{}, err
		}
		dest = assetDir + "/" + name
		d.ImageAliases = maps.Clone(d.ImageAliases)
		if d.ImageAliases == nil {
			d.ImageAliases = map[string]string{}
		}
		d.ImageAliases[dest] = "liubai-asset:" + name
		if err = w.persist(d); err != nil {
			return ImageResult{}, err
		}
	}
	return ImageResult{Destination: dest, URL: "data:" + info.MIME + ";base64," + base64.StdEncoding.EncodeToString(b), Name: name, Markdown: markdownDestination(dest)}, nil
}
func (w *Workspace) ReadImage(id, dest string) (ImageResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return ImageResult{}, errors.New("文稿不存在")
	}
	allowed := false
	target := ""
	for _, v := range imageTargets(d.Content) {
		if v == dest || canonicalDestination(v) == canonicalDestination(dest) {
			allowed = true
			target = v
			break
		}
	}
	if !allowed {
		return ImageResult{}, errors.New("图片未被文稿引用")
	}
	p, err := w.imagePath(d, target)
	if err != nil {
		return ImageResult{}, err
	}
	b, info, err := picture(p)
	if err != nil {
		return ImageResult{}, err
	}
	return ImageResult{Destination: dest, URL: "data:" + info.MIME + ";base64," + base64.StdEncoding.EncodeToString(b), Name: filepath.Base(p), Markdown: markdownDestination(target)}, nil
}

// Rewrites destination tokens only, preserving Markdown and fenced/inline code.
// Targets come from the Markdown parser, including reference-style images.
func rewriteImages(source string, targets map[string]string) string {
	for _, r := range imageReplacements(source, targets) {
		source = source[:r.start] + r.value + source[r.end:]
	}
	return source
}
func imageReplacements(source string, targets map[string]string) []replacement {
	if len(targets) == 0 {
		return nil
	}
	reps := []replacement{}
	inFence := ""
	offset := 0
	definition := regexp.MustCompile(`^ {0,3}\[[^\]]+\]:[ \t]*`)
	for _, line := range strings.SplitAfter(source, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		if len(line)-len(trimmed) <= 3 && (strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~")) {
			ch := string(trimmed[0])
			if inFence == "" {
				inFence = ch
			} else if inFence == ch {
				inFence = ""
			}
			offset += len(line)
			continue
		}
		if inFence != "" || strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "\t") {
			offset += len(line)
			continue
		}
		starts := []int{}
		if m := definition.FindStringIndex(line); m != nil {
			starts = append(starts, m[1])
		}
		tick := 0
		for i := 0; i < len(line); i++ {
			if line[i] == '\\' {
				i++
				continue
			}
			if line[i] == '`' {
				n := 1
				for i+n < len(line) && line[i+n] == '`' {
					n++
				}
				if tick == 0 {
					tick = n
				} else if tick == n {
					tick = 0
				}
				i += n - 1
				continue
			}
			if tick > 0 {
				continue
			}
			if i+1 < len(line) && line[i] == '!' && line[i+1] == '[' {
				depth := 1
				j := i + 2
				for ; j < len(line) && depth > 0; j++ {
					if line[j] == '\\' {
						j++
						continue
					}
					if line[j] == '[' {
						depth++
					}
					if line[j] == ']' {
						depth--
					}
				}
				if j < len(line) && line[j] == '(' {
					j++
					for j < len(line) && (line[j] == ' ' || line[j] == '\t') {
						j++
					}
					starts = append(starts, j)
				}
			}
		}
		for _, start := range starts {
			if start >= len(line) {
				continue
			}
			end := start
			angle := line[start] == '<'
			if angle {
				start++
				end = start
				for end < len(line) && line[end] != '>' {
					if line[end] == '\\' {
						end++
					}
					end++
				}
			} else {
				level := 0
				for end < len(line) {
					c := line[end]
					if c == '\\' {
						end += 2
						continue
					}
					if c == '(' {
						level++
					}
					if c == ')' {
						if level == 0 {
							break
						}
						level--
					}
					if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
						break
					}
					end++
				}
			}
			if end > len(line) {
				continue
			}
			old := line[start:end]
			if value, ok := targets[old]; ok {
				if angle {
					value = strings.NewReplacer("<", "%3C", ">", "%3E").Replace(value)
				} else {
					value = markdownDestination(value)
				}
				reps = append(reps, replacement{offset + start, offset + end, value})
			}
		}
		offset += len(line)
	}
	sort.Slice(reps, func(i, j int) bool { return reps[i].start > reps[j].start })
	return reps
}

func validateRewrittenImages(source string, targets map[string]string) error {
	for _, ref := range imageRefs(source) {
		if ref.HTML {
			continue
		}
		dest := ref.Dest
		if replacement, ok := targets[dest]; ok && replacement != dest {
			return errors.New("图片引用无法转换，请将图片放在独立段落")
		}
	}
	return nil
}
func (w *Workspace) copyAssets(from, to *Document) error {
	to.ImageAliases = map[string]string{}
	targets := map[string]string{}
	for _, dest := range imageTargets(from.Content) {
		if external(dest) {
			continue
		}
		p, err := w.imagePath(from, dest)
		if err != nil {
			continue
		}
		b, info, err := picture(p)
		if err != nil {
			continue
		}
		name := digest(b)[:24] + "." + info.Format
		dir := filepath.Join(w.root, "assets", to.ID)
		if err = os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		if err = atomicWrite(filepath.Join(dir, name), b, 0600); err != nil {
			return err
		}
		targets[dest] = "liubai-asset:" + name
	}
	to.Content = rewriteImages(to.Content, targets)
	return nil
}

func writeImageExclusive(path string, b []byte) error {
	if old, err := os.ReadFile(path); err == nil {
		if bytes.Equal(old, b) {
			return nil
		}
		return errors.New("同名图片已存在且内容不同")
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	return err
}

// Always write portable image destinations to disk, including old draft
// destinations restored by undo after the first Save As.
func (w *Workspace) materialize(d *Document, path string, all bool) (string, error) {
	targets := map[string]string{}
	assetDir := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)) + ".assets"
	for _, ref := range imageRefs(d.Content) {
		if ref.HTML {
			continue
		}
		dest := ref.Dest
		if external(dest) {
			continue
		}
		if !all && !strings.HasPrefix(dest, "liubai-asset:") && d.ImageAliases[dest] == "" {
			continue
		}
		source, err := w.imagePath(d, dest)
		if err != nil {
			return "", err
		}
		b, info, err := picture(source)
		if err != nil {
			return "", fmt.Errorf("图片缺失或无法读取：%s", dest)
		}
		dir := filepath.Join(filepath.Dir(path), assetDir)
		if err = os.MkdirAll(dir, 0755); err != nil {
			return "", err
		}
		name := digest(b)[:24] + "." + info.Format
		if err = writeImageExclusive(filepath.Join(dir, name), b); err != nil {
			return "", err
		}
		targets[dest] = assetDir + "/" + name
	}
	out := rewriteImages(d.Content, targets)
	if err := validateRewrittenImages(out, targets); err != nil {
		return "", err
	}
	for _, ref := range imageRefs(out) {
		if ref.HTML {
			continue
		}
		dest := ref.Dest
		if strings.HasPrefix(dest, "liubai-asset:") {
			return "", errors.New("图片引用无法转换，请将图片放在独立段落")
		}
	}
	return out, nil
}
func uniqueAssetName(dir, base string, data []byte) (string, error) {
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for n := 1; ; n++ {
		name := base
		if n > 1 {
			name = fmt.Sprintf("%s-%d%s", stem, n, ext)
		}
		old, err := os.ReadFile(filepath.Join(dir, name))
		if os.IsNotExist(err) || err == nil && bytes.Equal(old, data) {
			return name, nil
		}
		if err != nil {
			return "", err
		}
	}
}

func (w *Workspace) SaveAs(id, path string) (ExportResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return ExportResult{}, errors.New("文稿不存在")
	}
	p, err := filepath.Abs(path)
	if err != nil {
		return ExportResult{}, err
	}
	if filepath.Ext(p) == "" {
		p += ".md"
	}
	if info, e := os.Lstat(p); e == nil && info.Mode()&os.ModeSymlink != 0 {
		return ExportResult{}, errors.New("请选择普通文件路径，避免替换符号链接")
	}
	if p == d.Path {
		w.check(d, false)
		if d.Conflict {
			return ExportResult{}, errors.New("文件存在外部冲突，请选择新文件名")
		}
	}
	if err = os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return ExportResult{}, err
	}
	sameDir := false
	if d.Path != "" {
		oldDir, newDir := filepath.Dir(d.Path), filepath.Dir(p)
		if resolved, e := filepath.EvalSymlinks(oldDir); e == nil {
			oldDir = resolved
		}
		if resolved, e := filepath.EvalSymlinks(newDir); e == nil {
			newDir = resolved
		}
		sameDir = filepath.Clean(oldDir) == filepath.Clean(newDir)
	}
	targets := map[string]string{}
	missing := []string{}
	aliases := maps.Clone(d.ImageAliases)
	if aliases == nil {
		aliases = map[string]string{}
	}
	assetDir := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p)) + ".assets"
	for _, ref := range imageRefs(d.Content) {
		if ref.HTML {
			continue
		}
		dest := ref.Dest
		if external(dest) {
			continue
		}
		internal := strings.HasPrefix(dest, "liubai-asset:")
		originalPath := canonicalDestination(dest)
		if u, e := url.Parse(dest); e == nil {
			originalPath = canonicalDestination(u.Path)
		}
		if !internal {
			if filepath.IsAbs(originalPath) {
				continue
			}
			aliased := false
			for key := range d.ImageAliases {
				if canonicalDestination(key) == canonicalDestination(dest) {
					aliased = true
					break
				}
			}
			if d.Path == "" && !aliased {
				continue
			}
		}
		source, e := w.imagePath(d, dest)
		if e != nil {
			missing = append(missing, dest)
			continue
		}
		b, info, e := picture(source)
		if e != nil {
			missing = append(missing, dest)
			continue
		}
		if sameDir && !internal {
			continue
		}
		dir := filepath.Join(filepath.Dir(p), assetDir)
		if e = os.MkdirAll(dir, 0755); e != nil {
			return ExportResult{}, e
		}
		name := digest(b)[:24] + "." + info.Format
		if internal {
			if existing, e := os.ReadFile(filepath.Join(dir, name)); e == nil {
				if !bytes.Equal(existing, b) {
					name = uid() + "." + info.Format
				}
			}
		} else {
			name, e = uniqueAssetName(dir, filepath.Base(originalPath), b)
			if e != nil {
				return ExportResult{}, e
			}
		}
		if e = writeImageExclusive(filepath.Join(dir, name), b); e != nil {
			return ExportResult{}, e
		}
		targets[dest] = assetDir + "/" + name
		cacheDir := filepath.Join(w.root, "assets", d.ID)
		if e = os.MkdirAll(cacheDir, 0700); e != nil {
			return ExportResult{}, e
		}
		cacheName := digest(b)[:24] + "." + info.Format
		if e = atomicWrite(filepath.Join(cacheDir, cacheName), b, 0600); e != nil {
			return ExportResult{}, e
		}
		aliases[dest] = "liubai-asset:" + cacheName
		aliases[targets[dest]] = "liubai-asset:" + cacheName
	}
	clone := *d
	clone.Content = rewriteImages(d.Content, targets)
	if err := validateRewrittenImages(clone.Content, targets); err != nil {
		return ExportResult{}, err
	}
	changes := []TextChange{}
	for _, change := range imageReplacements(d.Content, targets) {
		changes = append(changes, TextChange{len(utf16.Encode([]rune(d.Content[:change.start]))), len(utf16.Encode([]rune(d.Content[:change.end]))), change.value})
	}
	clone.Path = p
	clone.Title = filepath.Base(p)
	clone.Conflict = false
	clone.Status = "文件已保存"
	clone.Revision++
	content := diskBytes(&clone)
	for _, ref := range imageRefs(clone.Content) {
		if ref.HTML {
			continue
		}
		dest := ref.Dest
		if strings.HasPrefix(dest, "liubai-asset:") {
			return ExportResult{}, errors.New("存在无法转换的图片语法，请将图片引用单独放在一行后再保存")
		}
	}
	if info, e := os.Stat(p); e == nil {
		err = replaceFile(p, content, info.Mode().Perm())
	} else {
		err = atomicWrite(p, content, 0644)
	}
	if err != nil {
		return ExportResult{}, err
	}
	clone.DiskHash = digest(content)
	clone.DiskContentHash = digest([]byte(clone.Content))
	info, _ := os.Stat(p)
	clone.recordDiskInfo(info)
	clone.ImageAliases = aliases
	*d = clone
	if err = w.persist(d); err != nil {
		d.Status = "文件已保存，恢复记录更新失败"
	}
	return ExportResult{Path: p, Missing: missing, Document: *d, Changes: changes}, err
}
func (w *Workspace) Export(id, path string, allowMissing bool) (ExportResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return ExportResult{}, errors.New("文稿不存在")
	}
	r := ExportResult{Missing: []string{}, Document: *d}
	targets := map[string]string{}
	assets := map[string][]byte{}
	for _, ref := range imageRefs(d.Content) {
		dest := ref.Dest
		if external(dest) {
			r.External++
			continue
		}
		name := ""
		if ref.HTML {
			u, err := url.Parse(dest)
			if err == nil && u.Scheme == "" && u.Host == "" {
				name = filepath.Clean(filepath.FromSlash(u.Path))
			}
			if name == "" || name == "." || filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) || name == "文稿.md" {
				r.Missing = append(r.Missing, dest)
				continue
			}
		}
		p, err := w.imagePath(d, dest)
		if err != nil {
			r.Missing = append(r.Missing, dest)
			continue
		}
		b, info, err := picture(p)
		if err != nil {
			r.Missing = append(r.Missing, dest)
			continue
		}
		if !ref.HTML {
			name = "images/" + digest(b)[:24] + "." + info.Format
			targets[dest] = name
		}
		name = filepath.ToSlash(name)
		assets[name] = b
	}
	if len(r.Missing) > 0 && !allowMissing {
		return r, nil
	}
	body := rewriteImages(d.Content, targets)
	if err := validateRewrittenImages(body, targets); err != nil {
		return r, err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".liubai-export-*")
	if err != nil {
		return r, err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	z := zip.NewWriter(f)
	write := func(name string, b []byte) error {
		item, e := z.Create(name)
		if e != nil {
			return e
		}
		_, e = item.Write(b)
		return e
	}
	if err = write("文稿.md", []byte(body)); err == nil {
		for name, b := range assets {
			if err = write(name, b); err != nil {
				break
			}
		}
	}
	ce := z.Close()
	if err == nil {
		err = ce
	}
	if err == nil {
		err = f.Sync()
	}
	ce = f.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return r, err
	}
	if err = os.Rename(tmp, path); err != nil {
		return r, err
	}
	r.Path = path
	return r, nil
}
