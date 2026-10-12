package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
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

func imageTargets(s string) []string {
	b := []byte(s)
	doc := goldmark.DefaultParser().Parse(text.NewReader(b))
	seen := map[string]bool{}
	out := []string{}
	_ = ast.Walk(doc, func(n ast.Node, enter bool) (ast.WalkStatus, error) {
		if enter {
			if im, ok := n.(*ast.Image); ok {
				dest := string(im.Destination)
				if !seen[dest] {
					seen[dest] = true
					out = append(out, dest)
				}
			}
		}
		return ast.WalkContinue, nil
	})
	return out
}
func external(dest string) bool {
	u, e := url.Parse(dest)
	return e == nil && (u.Scheme == "https" || u.Scheme == "http" || strings.HasPrefix(dest, "//"))
}
func (w *Workspace) imagePath(d *Document, dest string) (string, error) {
	if alias, ok := d.ImageAliases[dest]; ok {
		dest = alias
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
func picture(path string) ([]byte, string, error) {
	b, err := readLimited(path, maxPicture)
	if err != nil {
		return nil, "", err
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || config.Width > 16000 || config.Height > 16000 {
		return nil, "", errors.New("图片格式或尺寸不受支持")
	}
	return b, format, nil
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
	c, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || c.Width > 16000 || c.Height > 16000 {
		return ImageResult{}, errors.New("请选择 PNG、JPEG 或 GIF 图片，最长边不超过 16000 像素")
	}
	name = digest(b)[:24] + "." + format
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
		dest = url.PathEscape(assetDir) + "/" + name
		d.ImageAliases = maps.Clone(d.ImageAliases)
		if d.ImageAliases == nil {
			d.ImageAliases = map[string]string{}
		}
		d.ImageAliases[dest] = "liubai-asset:" + name
		if err = w.persist(d); err != nil {
			return ImageResult{}, err
		}
	}
	return ImageResult{dest, "data:image/" + format + ";base64," + base64.StdEncoding.EncodeToString(b), name}, nil
}
func (w *Workspace) ReadImage(id, dest string) (ImageResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return ImageResult{}, errors.New("文稿不存在")
	}
	allowed := false
	for _, v := range imageTargets(d.Content) {
		if v == dest {
			allowed = true
			break
		}
	}
	if !allowed {
		return ImageResult{}, errors.New("图片未被文稿引用")
	}
	p, err := w.imagePath(d, dest)
	if err != nil {
		return ImageResult{}, err
	}
	b, format, err := picture(p)
	if err != nil {
		return ImageResult{}, err
	}
	return ImageResult{dest, "data:image/" + format + ";base64," + base64.StdEncoding.EncodeToString(b), filepath.Base(p)}, nil
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
				reps = append(reps, replacement{offset + start, offset + end, value})
			}
		}
		offset += len(line)
	}
	sort.Slice(reps, func(i, j int) bool { return reps[i].start > reps[j].start })
	return reps
}

func validateRewrittenImages(source string, targets map[string]string) error {
	for _, dest := range imageTargets(source) {
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
		b, format, err := picture(p)
		if err != nil {
			continue
		}
		name := digest(b)[:24] + "." + format
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
	for _, dest := range imageTargets(d.Content) {
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
		b, format, err := picture(source)
		if err != nil {
			return "", fmt.Errorf("图片缺失或无法读取：%s", dest)
		}
		dir := filepath.Join(filepath.Dir(path), assetDir)
		if err = os.MkdirAll(dir, 0755); err != nil {
			return "", err
		}
		name := digest(b)[:24] + "." + format
		if err = writeImageExclusive(filepath.Join(dir, name), b); err != nil {
			return "", err
		}
		targets[dest] = url.PathEscape(assetDir) + "/" + name
	}
	out := rewriteImages(d.Content, targets)
	if err := validateRewrittenImages(out, targets); err != nil {
		return "", err
	}
	for _, dest := range imageTargets(out) {
		if strings.HasPrefix(dest, "liubai-asset:") {
			return "", errors.New("图片引用无法转换，请将图片放在独立段落")
		}
	}
	return out, nil
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
		w.check(d)
		if d.Conflict {
			return ExportResult{}, errors.New("文件存在外部冲突，请选择新文件名")
		}
	}
	if err = os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return ExportResult{}, err
	}
	targets := map[string]string{}
	aliases := maps.Clone(d.ImageAliases)
	if aliases == nil {
		aliases = map[string]string{}
	}
	assetDir := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p)) + ".assets"
	for _, dest := range imageTargets(d.Content) {
		if external(dest) {
			continue
		}
		source, e := w.imagePath(d, dest)
		if e != nil {
			return ExportResult{}, e
		}
		b, format, e := picture(source)
		if e != nil {
			return ExportResult{Missing: []string{dest}}, fmt.Errorf("图片缺失或无法读取：%s", dest)
		}
		dir := filepath.Join(filepath.Dir(p), assetDir)
		if e = os.MkdirAll(dir, 0755); e != nil {
			return ExportResult{}, e
		}
		name := digest(b)[:24] + "." + format
		target := filepath.Join(dir, name)
		if existing, e := os.ReadFile(target); e == nil {
			if !bytes.Equal(existing, b) {
				name = uid() + "." + format
				target = filepath.Join(dir, name)
			}
		}
		if e = writeImageExclusive(target, b); e != nil {
			return ExportResult{}, e
		}
		targets[dest] = url.PathEscape(assetDir) + "/" + name
		cacheDir := filepath.Join(w.root, "assets", d.ID)
		if e = os.MkdirAll(cacheDir, 0700); e != nil {
			return ExportResult{}, e
		}
		cacheName := digest(b)[:24] + "." + format
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
	for _, dest := range imageTargets(clone.Content) {
		if strings.HasPrefix(dest, "liubai-asset:") {
			return ExportResult{}, errors.New("存在无法转换的图片语法，请将图片引用单独放在一行后再保存")
		}
	}
	mode := os.FileMode(0644)
	if info, e := os.Stat(p); e == nil {
		mode = info.Mode().Perm()
	}
	if err = atomicWrite(p, content, mode); err != nil {
		return ExportResult{}, err
	}
	clone.DiskHash = digest(content)
	clone.DiskContentHash = digest([]byte(clone.Content))
	clone.ImageAliases = aliases
	*d = clone
	if err = w.persist(d); err != nil {
		d.Status = "文件已保存，恢复记录更新失败"
	}
	return ExportResult{Path: p, Document: *d, Changes: changes}, err
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
	for _, dest := range imageTargets(d.Content) {
		if external(dest) {
			r.External++
			continue
		}
		p, err := w.imagePath(d, dest)
		if err != nil {
			r.Missing = append(r.Missing, dest)
			continue
		}
		b, format, err := picture(p)
		if err != nil {
			r.Missing = append(r.Missing, dest)
			continue
		}
		name := "images/" + digest(b)[:24] + "." + format
		targets[dest] = name
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
func (w *Workspace) AssetHTTP(id, dest string) ([]byte, string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return nil, "", os.ErrNotExist
	}
	p, err := w.imagePath(d, dest)
	if err != nil {
		return nil, "", err
	}
	return picture(p)
}
