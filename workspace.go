package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

const maxDocument = 8 << 20
const maxPicture = 20 << 20

type Appearance struct {
	Theme        string `json:"theme"`
	FontSize     int    `json:"fontSize,omitempty"`
	LineWidth    string `json:"lineWidth,omitempty"`
	FollowSystem bool   `json:"followSystem"`
	Layout       string `json:"layout"`
	Source       bool   `json:"source"`
}
type Position struct {
	Anchor int     `json:"anchor"`
	Head   int     `json:"head"`
	Scroll float64 `json:"scroll"`
	Source bool    `json:"source"`
}
type Document struct {
	ID              string            `json:"id"`
	Title           string            `json:"title"`
	CustomTitle     bool              `json:"customTitle,omitempty"`
	Content         string            `json:"content"`
	Path            string            `json:"path"`
	Updated         int64             `json:"updated"`
	Revision        int               `json:"revision"`
	Position        Position          `json:"position"`
	DiskHash        string            `json:"diskHash"`
	DiskContentHash string            `json:"diskContentHash"`
	BOM             bool              `json:"bom"`
	CRLF            bool              `json:"crlf"`
	Conflict        bool              `json:"conflict"`
	Status          string            `json:"status"`
	ImageAliases    map[string]string `json:"imageAliases,omitempty"`
}
type Summary struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Path    string `json:"path"`
	Updated int64  `json:"updated"`
	Excerpt string `json:"excerpt"`
}
type WorkspaceState struct {
	Current    Document   `json:"current"`
	Recent     []Summary  `json:"recent"`
	Appearance Appearance `json:"appearance"`
}
type index struct {
	Version    int        `json:"version"`
	Current    string     `json:"current"`
	Appearance Appearance `json:"appearance"`
}
type Edit struct {
	ID       string   `json:"id"`
	Revision int      `json:"revision"`
	Content  string   `json:"content"`
	Position Position `json:"position"`
}
type Workspace struct {
	mu         sync.Mutex
	root       string
	docs       map[string]*Document
	current    string
	appearance Appearance
}

func uid() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func digest(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func readLimited(path string, n int64) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, n+1))
	if e == nil && int64(len(b)) > n {
		e = errors.New("文件超过支持大小")
	}
	return b, e
}
func atomicWrite(path string, data []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".liubai-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	ce := f.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, path); err != nil {
		return err
	}
	if dir, e := os.Open(filepath.Dir(path)); e == nil {
		_ = dir.Sync()
		dir.Close()
	}
	return nil
}
func decodeFile(data []byte) (content string, bom, crlf bool, err error) {
	bom = strings.HasPrefix(string(data), "\ufeff")
	if bom {
		data = data[3:]
	}
	if !utf8.Valid(data) || strings.IndexByte(string(data), 0) >= 0 {
		return "", false, false, errors.New("仅支持 UTF-8 文本文件")
	}
	crlf = strings.Contains(string(data), "\r\n")
	content = strings.ReplaceAll(string(data), "\r\n", "\n")
	return
}
func diskBytes(d *Document) []byte {
	s := d.Content
	if d.CRLF {
		s = strings.ReplaceAll(s, "\n", "\r\n")
	}
	if d.BOM {
		s = "\ufeff" + s
	}
	return []byte(s)
}
func inferredTitle(s string) string {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "# "))
		if line != "" {
			r := []rune(line)
			if len(r) > 42 {
				line = string(r[:42]) + "…"
			}
			return line
		}
	}
	return "未命名文稿"
}
func validTheme(s string) bool { return s == "paper" || s == "warm" || s == "mist" || s == "ink" }
func normalizeLayout(s string) string {
	if s == "split" {
		return s
	}
	return "single"
}
func openWorkspace(root string) (*Workspace, error) {
	if err := os.MkdirAll(filepath.Join(root, "drafts"), 0700); err != nil {
		return nil, err
	}
	w := &Workspace{root: root, docs: map[string]*Document{}, appearance: Appearance{Theme: "paper", FollowSystem: true, Layout: "single"}}
	if b, err := readLimited(filepath.Join(root, "workspace.json"), 1<<20); err == nil {
		var x index
		if json.Unmarshal(b, &x) != nil || x.Version != 1 {
			return nil, errors.New("工作区索引损坏，原文件已保留")
		}
		w.current = x.Current
		if validTheme(x.Appearance.Theme) {
			x.Appearance.Layout = normalizeLayout(x.Appearance.Layout)
			w.appearance = x.Appearance
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	paths, _ := filepath.Glob(filepath.Join(root, "drafts", "*.json"))
	for _, p := range paths {
		b, err := readLimited(p, 64<<20)
		if err != nil {
			return nil, err
		}
		var d Document
		if json.Unmarshal(b, &d) != nil || !safeID(d.ID) || filepath.Base(p) != d.ID+".json" {
			return nil, errors.New("草稿无法读取，原文件已保留")
		}
		if len(d.Content) > maxDocument {
			return nil, errors.New("草稿超过支持大小")
		}
		w.docs[d.ID] = &d
	}
	if len(w.docs) == 0 {
		d, err := w.newLocked("")
		if err != nil {
			return nil, err
		}
		w.current = d.ID
	}
	if w.docs[w.current] == nil {
		for id := range w.docs {
			w.current = id
			break
		}
	}
	if err := w.saveIndex(); err != nil {
		return nil, err
	}
	return w, nil
}
func safeID(s string) bool {
	if len(s) != 24 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}
func (w *Workspace) saveIndex() error {
	b, err := json.Marshal(index{1, w.current, w.appearance})
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(w.root, "workspace.json"), b, 0600)
}
func (w *Workspace) persist(d *Document) error {
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(w.root, "drafts", d.ID+".json"), b, 0600)
}
func (w *Workspace) newLocked(content string) (*Document, error) {
	d := &Document{ID: uid(), Content: content, Title: inferredTitle(content), Updated: time.Now().UnixMilli(), Status: "草稿已保存"}
	if err := w.persist(d); err != nil {
		return nil, err
	}
	w.docs[d.ID] = d
	return d, nil
}
func (w *Workspace) check(d *Document) {
	if d.Path == "" {
		return
	}
	b, err := readLimited(d.Path, maxDocument)
	if err != nil {
		d.Conflict = true
		d.Status = "文件不可访问，草稿已保留"
		return
	}
	if digest(b) != d.DiskHash {
		d.Conflict = true
		d.Status = "磁盘内容已变化，自动写入已暂停"
	}
}
func (w *Workspace) snapshot() WorkspaceState {
	list := []Summary{}
	for _, d := range w.docs {
		excerpt := strings.Join(strings.Fields(d.Content), " ")
		r := []rune(excerpt)
		if len(r) > 90 {
			excerpt = string(r[:90])
		}
		list = append(list, Summary{d.ID, d.Title, d.Path, d.Updated, excerpt})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Updated > list[j].Updated })
	return WorkspaceState{*w.docs[w.current], list, w.appearance}
}
func (w *Workspace) State() WorkspaceState {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.check(w.docs[w.current])
	return w.snapshot()
}
func (w *Workspace) New() (WorkspaceState, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d, err := w.newLocked("")
	if err != nil {
		return WorkspaceState{}, err
	}
	w.current = d.ID
	err = w.saveIndex()
	return w.snapshot(), err
}
func (w *Workspace) Activate(id string) (WorkspaceState, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return WorkspaceState{}, errors.New("文稿不存在")
	}
	w.current = id
	w.check(d)
	err := w.saveIndex()
	return w.snapshot(), err
}
func (w *Workspace) Update(e Edit) (Document, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[e.ID]
	if d == nil {
		return Document{}, errors.New("文稿不存在")
	}
	if e.Revision != d.Revision {
		return *d, errors.New("文稿已变化，请重新载入，当前输入尚未保存")
	}
	if len(e.Content) > maxDocument || !utf8.ValidString(e.Content) {
		return *d, errors.New("文稿超过 8 MB 或编码无效")
	}
	before := *d
	changed := d.Content != e.Content
	d.Content = e.Content
	length := len(utf16.Encode([]rune(e.Content)))
	e.Position.Anchor = max(0, min(length, e.Position.Anchor))
	e.Position.Head = max(0, min(length, e.Position.Head))
	if math.IsNaN(e.Position.Scroll) || math.IsInf(e.Position.Scroll, 0) || e.Position.Scroll < 0 {
		e.Position.Scroll = 0
	}
	d.Position = e.Position
	d.Revision++
	if changed {
		d.Updated = time.Now().UnixMilli()
		if d.Path == "" && !d.CustomTitle {
			d.Title = inferredTitle(e.Content)
		}
	}
	d.Status = "草稿已保存"
	if err := w.persist(d); err != nil {
		*d = before
		d.Status = "保存失败，内容仍在编辑器"
		return *d, err
	}
	w.check(d)
	if d.Path == "" || d.Conflict {
		return *d, nil
	}
	if digest([]byte(d.Content)) == d.DiskContentHash {
		d.Status = "文件已保存"
		return *d, nil
	}
	portable, err := w.materialize(d, d.Path, false)
	if err != nil {
		d.Status = "草稿已保留，图片保存失败"
		return *d, nil
	}
	clone := *d
	clone.Content = portable
	bytes := diskBytes(&clone)
	if digest(bytes) == d.DiskHash {
		d.Status = "文件已保存"
		return *d, nil
	}
	if err := w.writeOriginal(d, bytes); err != nil {
		d.Status = "草稿已保留，文件保存失败"
		return *d, nil
	}
	d.Status = "文件已保存"
	if err := w.persist(d); err != nil {
		d.Status = "文件已保存，恢复记录更新失败"
	}
	return *d, nil
}
func (w *Workspace) writeOriginal(d *Document, b []byte) error {
	current, err := readLimited(d.Path, maxDocument)
	if err != nil {
		return err
	}
	if digest(current) != d.DiskHash {
		d.Conflict = true
		return errors.New("磁盘文件已变化")
	}
	info, err := os.Stat(d.Path)
	if err != nil {
		return err
	}
	if err = atomicWrite(d.Path, b, info.Mode().Perm()); err != nil {
		return err
	}
	d.DiskHash = digest(b)
	d.DiskContentHash = digest([]byte(d.Content))
	d.Conflict = false
	return nil
}
func (w *Workspace) Open(path string) (WorkspaceState, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	p, err := filepath.Abs(path)
	if err != nil {
		return WorkspaceState{}, err
	}
	p, err = filepath.EvalSymlinks(p)
	if err != nil {
		return WorkspaceState{}, err
	}
	for id, d := range w.docs {
		if d.Path == p {
			w.current = id
			w.check(d)
			return w.snapshot(), w.saveIndex()
		}
	}
	b, err := readLimited(p, maxDocument)
	if err != nil {
		return WorkspaceState{}, err
	}
	s, bom, crlf, err := decodeFile(b)
	if err != nil {
		return WorkspaceState{}, err
	}
	d := &Document{ID: uid(), Title: filepath.Base(p), Content: s, Path: p, Updated: time.Now().UnixMilli(), DiskHash: digest(b), DiskContentHash: digest([]byte(s)), BOM: bom, CRLF: crlf, Status: "文件已保存"}
	if err = w.persist(d); err != nil {
		return WorkspaceState{}, err
	}
	w.docs[d.ID] = d
	w.current = d.ID
	return w.snapshot(), w.saveIndex()
}
func (w *Workspace) Appearance(p Appearance) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !validTheme(p.Theme) {
		return errors.New("未知主题")
	}
	if p.FontSize != 0 && (p.FontSize < 15 || p.FontSize > 22) {
		return errors.New("字号应为 15 至 22")
	}
	if p.LineWidth != "" && p.LineWidth != "normal" && p.LineWidth != "wide" {
		return errors.New("未知行宽")
	}
	if p.Layout != "" && p.Layout != "single" && p.Layout != "split" {
		return errors.New("未知布局")
	}
	p.Layout = normalizeLayout(p.Layout)
	old := w.appearance
	w.appearance = p
	if err := w.saveIndex(); err != nil {
		w.appearance = old
		return err
	}
	return nil
}
func (w *Workspace) Reload(id string) (WorkspaceState, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil || d.Path == "" {
		return WorkspaceState{}, errors.New("文稿没有对应文件")
	}
	b, err := readLimited(d.Path, maxDocument)
	if err != nil {
		return WorkspaceState{}, err
	}
	content, bom, crlf, err := decodeFile(b)
	if err != nil {
		return WorkspaceState{}, err
	}
	backup := *d
	backup.ID = uid()
	backup.Path = ""
	backup.Title = d.Title + " · 恢复副本"
	backup.DiskHash = ""
	backup.Conflict = false
	backup.Status = "草稿已保存"
	backup.Updated = time.Now().UnixMilli()
	if err = w.copyAssets(d, &backup); err != nil {
		return WorkspaceState{}, err
	}
	if err = w.persist(&backup); err != nil {
		return WorkspaceState{}, err
	}
	w.docs[backup.ID] = &backup
	d.Content = content
	d.ImageAliases = nil
	d.DiskContentHash = digest([]byte(content))
	d.BOM = bom
	d.CRLF = crlf
	d.DiskHash = digest(b)
	d.Conflict = false
	d.Status = "文件已保存"
	d.Revision++
	if err = w.persist(d); err != nil {
		return WorkspaceState{}, err
	}
	return w.snapshot(), nil
}
func (w *Workspace) Rename(id, title string) (WorkspaceState, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return WorkspaceState{}, errors.New("文稿不存在")
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return WorkspaceState{}, errors.New("请输入名称")
	}
	if d.Path != "" {
		return WorkspaceState{}, errors.New("已有文件请通过另存命名")
	}
	old := *d
	d.Title = title
	d.CustomTitle = true
	if err := w.persist(d); err != nil {
		*d = old
		return w.snapshot(), err
	}
	return w.snapshot(), nil
}
