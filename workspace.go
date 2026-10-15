package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
	Excerpt         string            `json:"excerpt,omitempty"`
	Path            string            `json:"path"`
	Updated         int64             `json:"updated"`
	Revision        int               `json:"revision"`
	Position        Position          `json:"position"`
	DiskHash        string            `json:"diskHash"`
	DiskContentHash string            `json:"diskContentHash"`
	DiskSize        int64             `json:"diskSize,omitempty"`
	DiskModTime     int64             `json:"diskModTime,omitempty"`
	DiskInode       uint64            `json:"diskInode,omitempty"`
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
type DocStatus struct {
	ID       string `json:"id"`
	Revision int    `json:"revision"`
	Conflict bool   `json:"conflict"`
	Status   string `json:"status"`
}
type WorkspaceState struct {
	Current       Document   `json:"current"`
	Recent        []Summary  `json:"recent"`
	Appearance    Appearance `json:"appearance"`
	Notices       []string   `json:"notices,omitempty"`
	QuarantineDir string     `json:"quarantineDir,omitempty"`
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
	mu             sync.Mutex
	root           string
	docs           map[string]*Document
	positions      map[string]Position
	positionsDirty bool
	current        string
	appearance     Appearance
	notices        []string
	quarantineDir  string
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
	return atomicWriteHook(path, data, mode, nil)
}
func writeQuick(path string, data []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".liubai-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(data)
	}
	ce := f.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return err
	}
	return os.Rename(name, path)
}
func atomicWriteHook(path string, data []byte, mode os.FileMode, beforeRename func(tmp string) error) error {
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
	if beforeRename != nil {
		if err = beforeRename(name); err != nil {
			return err
		}
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
	w := &Workspace{root: root, docs: map[string]*Document{}, positions: map[string]Position{}, appearance: Appearance{Theme: "paper", FollowSystem: true, Layout: "single"}}
	if b, err := readLimited(filepath.Join(root, "positions.json"), 64<<20); err == nil {
		var positions map[string]Position
		if json.Unmarshal(b, &positions) == nil && positions != nil {
			w.positions = positions
		}
	}
	indexPath := filepath.Join(root, "workspace.json")
	if b, err := readLimited(indexPath, 1<<20); err == nil {
		var version struct {
			Version int `json:"version"`
		}
		var x index
		if json.Unmarshal(b, &version) == nil && version.Version > 1 {
			if err := w.quarantine(indexPath, b); err != nil {
				return nil, err
			}
			w.restoreIndex(b)
			w.notices = append(w.notices, "工作区索引来自更新版本的留白，已备份到隔离目录")
		} else if json.Unmarshal(b, &x) != nil || x.Version != 1 {
			if err := w.quarantine(indexPath, nil); err != nil {
				return nil, err
			}
			w.notices = append(w.notices, "工作区索引无法读取，已重建，原文件在隔离目录")
		} else {
			w.current = x.Current
			if validTheme(x.Appearance.Theme) {
				x.Appearance.Layout = normalizeLayout(x.Appearance.Layout)
				w.appearance = x.Appearance
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	paths, _ := filepath.Glob(filepath.Join(root, "drafts", "*.json"))
	corrupt := 0
	for _, p := range paths {
		b, err := readLimited(p, 64<<20)
		var d Document
		if err != nil || json.Unmarshal(b, &d) != nil || !safeID(d.ID) || filepath.Base(p) != d.ID+".json" || len(d.Content) > maxDocument {
			if err := w.quarantine(p, nil); err != nil {
				return nil, err
			}
			corrupt++
			continue
		}
		if p, ok := w.positions[d.ID]; ok {
			d.Position = clampPosition(d.Content, p)
		}
		w.docs[d.ID] = &d
	}
	if corrupt > 0 {
		w.notices = append(w.notices, fmt.Sprintf("有 %d 份草稿无法读取，已移到隔离目录", corrupt))
	}
	if len(w.docs) == 0 {
		d, err := w.newLocked("")
		if err != nil {
			return nil, err
		}
		w.current = d.ID
	}
	if w.docs[w.current] == nil {
		for id, d := range w.docs {
			if current := w.docs[w.current]; current == nil || d.Updated > current.Updated || d.Updated == current.Updated && id < current.ID {
				w.current = id
			}
		}
	}
	if err := w.saveIndex(); err != nil {
		return nil, err
	}
	return w, nil
}
func (w *Workspace) quarantine(path string, backup []byte) error {
	dir := filepath.Join(w.root, "quarantine")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	base := time.Now().Format("20060102-150405") + "-" + filepath.Base(path)
	for n := 1; ; n++ {
		name := base
		if n > 1 {
			name += fmt.Sprintf("-%d", n)
		}
		target := filepath.Join(dir, name)
		if _, err := os.Lstat(target); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		var err error
		if backup == nil {
			err = os.Rename(path, target)
		} else {
			err = atomicWrite(target, backup, 0600)
		}
		if err == nil {
			w.quarantineDir = dir
		}
		return err
	}
}
func (w *Workspace) restoreIndex(b []byte) {
	var x struct {
		Current    json.RawMessage            `json:"current"`
		Appearance map[string]json.RawMessage `json:"appearance"`
	}
	_ = json.Unmarshal(b, &x)
	_ = json.Unmarshal(x.Current, &w.current)
	p := &w.appearance
	var theme, width, layout string
	var size int
	if json.Unmarshal(x.Appearance["theme"], &theme) == nil && validTheme(theme) {
		p.Theme = theme
	}
	if json.Unmarshal(x.Appearance["fontSize"], &size) == nil && (size == 0 || size >= 15 && size <= 22) {
		p.FontSize = size
	}
	if json.Unmarshal(x.Appearance["lineWidth"], &width) == nil && (width == "" || width == "normal" || width == "wide") {
		p.LineWidth = width
	}
	if json.Unmarshal(x.Appearance["layout"], &layout) == nil && (layout == "" || layout == "single" || layout == "split") {
		p.Layout = normalizeLayout(layout)
	}
	for name, field := range map[string]*bool{"followSystem": &p.FollowSystem, "source": &p.Source} {
		_ = json.Unmarshal(x.Appearance[name], field)
	}
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
	d.Excerpt = excerptOf(d.Content)
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
func (d *Document) recordDiskInfo(info os.FileInfo) {
	d.DiskSize, d.DiskModTime, d.DiskInode = 0, 0, 0
	if info != nil {
		d.DiskSize = info.Size()
		d.DiskModTime = info.ModTime().UnixNano()
		d.DiskInode = fileIdentity(info)
	}
}
func (w *Workspace) check(d *Document, reload bool) {
	if d.Path == "" {
		return
	}
	info, err := os.Stat(d.Path)
	if err != nil {
		d.Conflict = true
		d.Status = "文件不可访问，草稿已保留"
		return
	}
	if d.DiskModTime != 0 && d.DiskSize == info.Size() && d.DiskModTime == info.ModTime().UnixNano() && d.DiskInode == fileIdentity(info) && !d.Conflict {
		return
	}
	b, err := readLimited(d.Path, maxDocument)
	if err != nil {
		d.Conflict = true
		d.Status = "文件不可访问，草稿已保留"
		return
	}
	hash := digest(b)
	if hash == d.DiskHash {
		d.recordDiskInfo(info)
		if d.Conflict {
			d.Conflict = false
			d.Status = "草稿已保存"
			if digest([]byte(d.Content)) == d.DiskContentHash {
				d.Status = "文件已保存"
			}
		}
		return
	}
	if reload && digest([]byte(d.Content)) == d.DiskContentHash {
		content, bom, crlf, err := decodeFile(b)
		if err != nil {
			d.Conflict = true
			d.Status = "磁盘文件无法读取，草稿已保留"
			return
		}
		d.Content, d.BOM, d.CRLF = content, bom, crlf
		d.Excerpt = excerptOf(content)
		d.DiskHash = hash
		d.DiskContentHash = digest([]byte(content))
		d.recordDiskInfo(info)
		d.ImageAliases = nil
		d.Conflict = false
		d.Revision++
		d.Updated = time.Now().UnixMilli()
		d.Status = "已载入磁盘上的新版本"
		if err := w.persist(d); err != nil {
			d.Status = "已载入磁盘新版本，恢复记录更新失败"
		}
		return
	}
	d.Conflict = true
	d.Status = "磁盘内容已变化，自动写入已暂停"
}
func (w *Workspace) snapshot() WorkspaceState {
	list := []Summary{}
	for _, d := range w.docs {
		if d.Excerpt == "" {
			d.Excerpt = excerptOf(d.Content)
		}
		list = append(list, Summary{d.ID, d.Title, d.Path, d.Updated, d.Excerpt})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Updated > list[j].Updated })
	return WorkspaceState{Current: *w.docs[w.current], Recent: list, Appearance: w.appearance}
}
func (w *Workspace) Notify(message string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.notices = append(w.notices, message)
}
func (w *Workspace) State() WorkspaceState {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.check(w.docs[w.current], true)
	s := w.snapshot()
	s.Notices = append([]string(nil), w.notices...)
	s.QuarantineDir = w.quarantineDir
	w.notices = nil
	w.quarantineDir = ""
	return s
}
func (w *Workspace) Status(id string) (DocStatus, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return DocStatus{}, errors.New("文稿不存在")
	}
	w.check(d, true)
	return DocStatus{d.ID, d.Revision, d.Conflict, d.Status}, nil
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
	w.check(d, true)
	err := w.saveIndex()
	return w.snapshot(), err
}
func clampPosition(content string, p Position) Position {
	length := 0
	for _, r := range content {
		length += utf16.RuneLen(r)
	}
	p.Anchor = max(0, min(length, p.Anchor))
	p.Head = max(0, min(length, p.Head))
	if math.IsNaN(p.Scroll) || math.IsInf(p.Scroll, 0) || p.Scroll < 0 {
		p.Scroll = 0
	}
	return p
}
func (w *Workspace) SavePosition(id string, p Position) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil {
		return errors.New("文稿不存在")
	}
	return w.savePosition(d, p)
}
func (w *Workspace) savePosition(d *Document, p Position) error {
	d.Position = clampPosition(d.Content, p)
	w.positions[d.ID] = d.Position
	w.positionsDirty = true
	return w.flushPositions()
}
func (w *Workspace) flushPositions() error {
	if !w.positionsDirty {
		return nil
	}
	b, err := json.Marshal(w.positions)
	if err == nil {
		err = writeQuick(filepath.Join(w.root, "positions.json"), b, 0600)
	}
	if err == nil {
		w.positionsDirty = false
	}
	return err
}
func (w *Workspace) Flush() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.flushPositions()
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
	if d.Content == e.Content && (d.Path == "" || digest([]byte(d.Content)) == d.DiskContentHash && !d.Conflict) {
		err := w.savePosition(d, e.Position)
		return *d, err
	}
	before := *d
	d.Content = e.Content
	d.Position = clampPosition(e.Content, e.Position)
	d.Revision++
	d.Updated = time.Now().UnixMilli()
	if d.Path == "" && !d.CustomTitle {
		d.Title = inferredTitle(e.Content)
	}
	d.Excerpt = excerptOf(e.Content)
	d.Status = "草稿已保存"
	savedFile := false
	if d.Path != "" {
		w.check(d, false)
		if !d.Conflict {
			if digest([]byte(d.Content)) == d.DiskContentHash {
				d.Status = "文件已保存"
			} else if portable, err := w.materialize(d, d.Path, false); err != nil {
				d.Status = "草稿已保留，图片保存失败"
			} else {
				clone := *d
				clone.Content = portable
				b := diskBytes(&clone)
				if digest(b) == d.DiskHash {
					d.Status = "文件已保存"
				} else if err := w.writeOriginal(d, b); err != nil {
					d.Status = "草稿已保留，文件保存失败"
				} else {
					savedFile = true
					d.Status = "文件已保存"
				}
			}
		}
	}
	if err := w.persist(d); err != nil {
		if !savedFile {
			*d = before
			d.Status = "保存失败，内容仍在编辑器"
			return *d, err
		}
		d.Status = "文件已保存，恢复记录更新失败"
	}
	// A prior position-only save must not override the newer position in the draft.
	if _, ok := w.positions[d.ID]; ok {
		_ = w.savePosition(d, d.Position)
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
	if err = replaceFile(d.Path, b, info.Mode().Perm()); err != nil {
		return err
	}
	d.DiskHash = digest(b)
	d.DiskContentHash = digest([]byte(d.Content))
	info, _ = os.Stat(d.Path)
	d.recordDiskInfo(info)
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
			w.check(d, true)
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
	info, _ := os.Stat(p)
	d.recordDiskInfo(info)
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
	if digest([]byte(d.Content)) != d.DiskContentHash {
		backup := *d
		backup.ID = uid()
		backup.Path = ""
		backup.Title = d.Title + " · 恢复副本"
		backup.DiskHash, backup.DiskContentHash = "", ""
		backup.recordDiskInfo(nil)
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
	}
	d.Content = content
	d.ImageAliases = nil
	d.DiskContentHash = digest([]byte(content))
	d.BOM = bom
	d.CRLF = crlf
	d.DiskHash = digest(b)
	info, _ := os.Stat(d.Path)
	d.recordDiskInfo(info)
	d.Conflict = false
	d.Status = "文件已保存"
	d.Revision++
	if err = w.persist(d); err != nil {
		return WorkspaceState{}, err
	}
	return w.snapshot(), nil
}
func (w *Workspace) Overwrite(id string) (WorkspaceState, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	d := w.docs[id]
	if d == nil || d.Path == "" {
		return WorkspaceState{}, errors.New("文稿没有对应文件")
	}
	b, err := readLimited(d.Path, maxDocument)
	if err == nil {
		content, _, _, e := decodeFile(b)
		if e != nil {
			return WorkspaceState{}, e
		}
		if digest(b) != d.DiskHash {
			disk := Document{Path: d.Path, Content: content}
			backup := Document{ID: uid(), Title: d.Title + " · 磁盘版本", Content: content, Updated: time.Now().UnixMilli(), Status: "草稿已保存"}
			if err = w.copyAssets(&disk, &backup); err != nil {
				return WorkspaceState{}, err
			}
			if err = w.persist(&backup); err != nil {
				return WorkspaceState{}, err
			}
			w.docs[backup.ID] = &backup
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return WorkspaceState{}, err
	}
	content, err := w.materialize(d, d.Path, false)
	if err != nil {
		return WorkspaceState{}, err
	}
	clone := *d
	clone.Content = content
	b = diskBytes(&clone)
	if info, e := os.Stat(d.Path); e == nil {
		err = replaceFile(d.Path, b, info.Mode().Perm())
	} else if errors.Is(e, os.ErrNotExist) {
		err = atomicWrite(d.Path, b, 0644)
	} else {
		err = e
	}
	if err != nil {
		return WorkspaceState{}, err
	}
	d.DiskHash = digest(b)
	d.DiskContentHash = digest([]byte(d.Content))
	info, _ := os.Stat(d.Path)
	d.recordDiskInfo(info)
	d.Conflict = false
	d.Status = "文件已保存"
	if err = w.persist(d); err != nil {
		d.Status = "文件已保存，恢复记录更新失败"
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
