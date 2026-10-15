package main

import (
	"context"
	"embed"
	"errors"
	"mime"
	"net/url"
	"sync"

	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

//go:embed web
var frontend embed.FS
var desktopAction = mygo.NewEvent[string]("liubai:action")
var documentOpened = mygo.NewEvent[WorkspaceState]("liubai:opened")
var openFailed = mygo.NewEvent[OpenFailure]("liubai:open-failed")

type OpenFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type Desktop struct {
	w          *Workspace
	win        *mygo.Window
	allowClose atomic.Bool
	pending    atomic.Bool
	pageReady  atomic.Bool
}

func (d *Desktop) openPath(path string) {
	state, err := d.w.Open(path)
	if err != nil {
		if !d.pageReady.Load() {
			d.w.Notify("无法打开「" + filepath.Base(path) + "」：" + err.Error())
		} else {
			_ = openFailed.Broadcast(OpenFailure{Path: path, Error: err.Error()})
		}
	} else {
		_ = documentOpened.Broadcast(state)
	}
	if d.win != nil {
		d.win.Show()
		d.win.Focus()
	}
}

func (d *Desktop) State() WorkspaceState {
	d.pageReady.Store(true)
	return d.w.State()
}
func (d *Desktop) Update(e Edit) (Document, error)             { return d.w.Update(e) }
func (d *Desktop) SavePosition(id string, p Position) error    { return d.w.SavePosition(id, p) }
func (d *Desktop) New() (WorkspaceState, error)                { return d.w.New() }
func (d *Desktop) Activate(id string) (WorkspaceState, error)  { return d.w.Activate(id) }
func (d *Desktop) Delete(id string) (WorkspaceState, error)    { return d.w.Delete(id) }
func (d *Desktop) Status(id string) (DocStatus, error)         { return d.w.Status(id) }
func (d *Desktop) Overwrite(id string) (WorkspaceState, error) { return d.w.Overwrite(id) }
func (d *Desktop) Appearance(p Appearance) error               { return d.w.Appearance(p) }
func (d *Desktop) ImportImage(id, name, data string) (ImageResult, error) {
	return d.w.ImportImage(id, name, data)
}
func (d *Desktop) ReadImage(id, dest string) (ImageResult, error)  { return d.w.ReadImage(id, dest) }
func (d *Desktop) Reload(id string) (WorkspaceState, error)        { return d.w.Reload(id) }
func (d *Desktop) Rename(id, title string) (WorkspaceState, error) { return d.w.Rename(id, title) }
func (d *Desktop) OpenLinked(id, href string) (WorkspaceState, error) {
	return d.w.OpenLinked(id, href)
}
func (d *Desktop) Open(ctx context.Context) (WorkspaceState, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "打开 Markdown 文稿", Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md", "markdown", "txt"}}}})
	if err != nil {
		return WorkspaceState{}, err
	}
	if len(paths) == 0 {
		return d.w.State(), nil
	}
	return d.w.Open(paths[0])
}
func (d *Desktop) SaveAs(ctx context.Context, id string) (ExportResult, error) {
	state := d.w.State()
	name := documentFilename(state.Current.Title, ".md")
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "保存 Markdown", DefaultPath: name, Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md"}}}})
	if err != nil {
		return ExportResult{}, err
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	return d.w.SaveAs(id, path)
}
func (d *Desktop) Export(ctx context.Context, id string, allowMissing bool) (ExportResult, error) {
	d.w.mu.Lock()
	doc := d.w.docs[id]
	if doc == nil {
		d.w.mu.Unlock()
		return ExportResult{}, errors.New("文稿不存在")
	}
	name := documentFilename(doc.Title, ".zip")
	d.w.mu.Unlock()
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "导出文稿与图片（ZIP）", DefaultPath: name, Filters: []mygo.FileFilter{{Name: "ZIP", Extensions: []string{"zip"}}}})
	if err != nil {
		return ExportResult{}, err
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	return d.w.Export(id, path, allowMissing)
}
func (d *Desktop) Delivery(id string) (Delivery, error) { return d.w.Delivery(id) }
func (d *Desktop) CopyRich(html, text string) error {
	if len(html)+len(text) > 64<<20 {
		return errors.New("复制内容过大，请导出文稿")
	}
	return mygo.Clipboard.Write(transfer.New(transfer.NewItem(transfer.Bytes(transfer.HTML, []byte(html)), transfer.Bytes(transfer.Text, []byte(text)))))
}
func (d *Desktop) OpenLink(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || (u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "mailto") {
		return errors.New("不支持的链接")
	}
	return mygo.Shell.OpenExternal(raw)
}
func (d *Desktop) Rescue(ctx context.Context, id, content string) (ExportResult, error) {
	path, e := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "保存当前恢复副本", DefaultPath: "留白恢复副本.md", Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md"}}}})
	if e != nil {
		return ExportResult{}, e
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	return d.w.SaveRecovery(id, content, path)
}
func (d *Desktop) PDF(ctx context.Context, title string) (ExportResult, error) {
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "导出 PDF", DefaultPath: documentFilename(title, ".pdf"), Filters: []mygo.FileFilter{{Name: "PDF", Extensions: []string{"pdf"}}}})
	if err != nil {
		return ExportResult{}, err
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	b, err := d.win.Page().PrintToPDF(mygo.PDFOptions{PageSize: mygo.PageA4, Background: true})
	if err != nil {
		return ExportResult{}, err
	}
	// CoreGraphics records CJK radical code points for shared glyphs; fix the text layer.
	b = fixPDFTextMapping(b)
	if err = atomicWrite(path, b, 0644); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{Path: path}, nil
}
func (d *Desktop) SaveHTML(ctx context.Context, title, html string) (ExportResult, error) {
	if len(html) > 64<<20 {
		return ExportResult{}, errors.New("HTML 过大，请改用 ZIP 导出")
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "保存 HTML", DefaultPath: documentFilename(title, ".html"), Filters: []mygo.FileFilter{{Name: "HTML", Extensions: []string{"html"}}}})
	if err != nil {
		return ExportResult{}, err
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	if err = atomicWrite(path, []byte(html), 0644); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{Path: path}, nil
}
func (d *Desktop) Close()                  { d.allowClose.Store(true); mygo.App.Quit() }
func (d *Desktop) SetPending(pending bool) { d.pending.Store(pending) }
func (d *Desktop) Reveal(path string)      { mygo.Shell.ShowItemInFolder(path) }
func (d *Desktop) requestClose()           { _ = desktopAction.Broadcast("close") }

func quitAllowed(allowClose, pending bool) bool { return allowClose || !pending }

func menuTemplate(action func(string) func(*mygo.MenuItem, *mygo.Window)) []*mygo.MenuItem {
	return []*mygo.MenuItem{
		{Label: "留白", Submenu: []*mygo.MenuItem{{Label: "关于留白", Click: func(*mygo.MenuItem, *mygo.Window) {
			mygo.App.ShowAboutPanel(mygo.AboutPanelOptions{ApplicationName: "留白", ApplicationVersion: "0.3.0"})
		}}, mygo.Separator(), {Role: mygo.RoleHide, Label: "隐藏留白"}, {Role: mygo.RoleHideOthers, Label: "隐藏其他"}, {Role: mygo.RoleUnhide, Label: "全部显示"}, mygo.Separator(), {Role: mygo.RoleQuit, Label: "退出留白"}}},
		{Label: "文件", Submenu: []*mygo.MenuItem{{Label: "新建文稿", Accelerator: "CmdOrCtrl+N", Click: action("new")}, {Label: "打开文稿…", Accelerator: "CmdOrCtrl+O", Click: action("open")}, mygo.Separator(), {Label: "保存", Accelerator: "CmdOrCtrl+S", Click: action("save")}, {Label: "另存为…", Accelerator: "CmdOrCtrl+Shift+S", Click: action("saveAs")}, mygo.Separator(), {Label: "导出…", Click: action("deliver")}, {Label: "导出 PDF…", Accelerator: "CmdOrCtrl+P", Click: action("pdf")}, mygo.Separator(), {Role: mygo.RoleClose, Label: "关闭窗口"}}},
		{Label: "编辑", Submenu: []*mygo.MenuItem{{Label: "撤销", Accelerator: "CmdOrCtrl+Z", Click: action("undo")}, {Label: "重做", Accelerator: "CmdOrCtrl+Shift+Z", Click: action("redo")}, mygo.Separator(), {Role: mygo.RoleCut, Label: "剪切"}, {Role: mygo.RoleCopy, Label: "拷贝"}, {Role: mygo.RolePaste, Label: "粘贴"}, {Role: mygo.RoleSelectAll, Label: "全选"}, mygo.Separator(), {Label: "查找", Accelerator: "CmdOrCtrl+F", Click: action("find")}}},
		{Label: "显示", Submenu: []*mygo.MenuItem{{Label: "专注模式", Accelerator: "CmdOrCtrl+Shift+F", Click: action("focus")}, {Label: "外观与排版…", Click: action("theme")}, {Label: "切换分栏", Accelerator: "CmdOrCtrl+\\", Click: action("layout")}, {Label: "阅读模式", Accelerator: "CmdOrCtrl+Shift+R", Click: action("read")}, {Label: "显示 Markdown 源码", Accelerator: "CmdOrCtrl+Shift+M", Click: action("source")}, {Label: "所有操作…", Accelerator: "CmdOrCtrl+K", Click: action("commands")}, mygo.Separator(), {Role: mygo.RoleToggleFullScreen, Label: "切换全屏"}}},
		{Label: "窗口", Submenu: []*mygo.MenuItem{{Role: mygo.RoleMinimize, Label: "最小化"}, {Role: mygo.RoleZoom, Label: "缩放"}, mygo.Separator(), {Role: mygo.RoleFront, Label: "前置全部窗口"}}},
	}
}

func main() {
	webAddr := flag.String("web", "", "仅在回环地址运行本地开发版")
	dataDir := flag.String("data-dir", "", "独立文稿存储目录")
	flag.Parse()
	mygo.App.SetName("留白")
	mygo.App.SetVersion("0.3.0")
	web, _ := fs.Sub(frontend, "web")
	if os.Getenv("MYGO_GENERATE") != "" {
		mygo.Bind(&Desktop{})
		if err := mygo.App.Run(); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *webAddr == "" && !mygo.App.RequestSingleInstanceLock() {
		return
	}
	root := *dataDir
	if root == "" {
		p, e := os.UserConfigDir()
		if e != nil {
			log.Fatal(e)
		}
		root = filepath.Join(p, "Liubai")
		if *webAddr != "" {
			root = filepath.Join(p, "Liubai-Development")
		}
	}
	w, err := openWorkspace(root)
	if err != nil {
		if *webAddr != "" {
			log.Fatal(err)
		}
		mygo.App.WhenReady(func() {
			_, _ = mygo.Dialog.Message(mygo.MessageOptions{Type: mygo.MessageError, Title: "留白无法启动", Message: "无法打开文稿存储目录", Detail: root + "\n" + err.Error(), Buttons: []string{"退出"}})
			mygo.App.Quit()
		})
		if err := mygo.App.Run(); err != nil {
			log.Fatal(err)
		}
		return
	}
	d := &Desktop{w: w}
	if *webAddr != "" {
		if err := serveWeb(*webAddr, web, d); err != nil {
			log.Fatal(err)
		}
		return
	}
	mygo.SetFrontend(web)
	mygo.Bind(d)
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		if err := w.Flush(); err != nil {
			log.Print(err)
		}
	})
	mygo.App.WhenReady(func() {
		w.mu.Lock()
		appearance := w.appearance
		w.mu.Unlock()
		dark := appearance.Theme == "ink"
		if appearance.FollowSystem {
			dark = mygo.Theme.IsDark()
		}
		bg := "#e9e9e7"
		if dark {
			bg = "#191b1a"
		}
		d.win = mygo.NewWindow(mygo.WindowOptions{Title: "留白", URL: "/", Width: 1120, Height: 820, MinWidth: 680, MinHeight: 540, Hidden: true, TitleBarStyle: mygo.TitleBarHidden, BackgroundColor: bg, StateKey: "liubai-editor"})
		d.win.OnReadyToShow(func() { d.win.Show() })
		d.win.OnFileDrop(func(e *mygo.FileDropEvent) {
			var paths []string
			for _, path := range e.Paths {
				if markdownPath(path) {
					paths = append(paths, path)
				} else if !strings.HasPrefix(mime.TypeByExtension(strings.ToLower(filepath.Ext(path))), "image/") {
					_ = openFailed.Broadcast(OpenFailure{Path: path, Error: "仅支持打开 Markdown 文稿"})
				}
			}
			go func() {
				for i := len(paths) - 1; i >= 0; i-- {
					d.openPath(paths[i])
				}
			}()
		})
		d.win.OnClose(func(e *mygo.CloseEvent) {
			if quitAllowed(d.allowClose.Load(), d.pending.Load()) {
				d.allowClose.Store(true)
				return
			}
			e.PreventDefault()
			d.requestClose()
		})
		action := func(s string) func(*mygo.MenuItem, *mygo.Window) {
			return func(*mygo.MenuItem, *mygo.Window) { _ = desktopAction.Broadcast(s) }
		}
		mygo.App.SetMenu(mygo.NewMenu(menuTemplate(action)))
		mygo.App.OnActivate(func(bool) { d.win.Show(); d.win.Focus() })
		d.win.Page().OnWillNavigate(func(e *mygo.NavigateEvent) { e.PreventDefault() })
	})
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		if !quitAllowed(d.allowClose.Load(), d.pending.Load()) {
			e.PreventDefault()
			d.requestClose()
		}
	})
	mygo.App.OnOpenFile(func(path string) {
		go d.openPath(path)
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// Development mode uses the same workspace service with an isolated data dir.
// No unrestricted file-path API is exposed; file import/export uses the browser.
func serveWeb(addr string, web fs.FS, d *Desktop) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return os.ErrInvalid
	}
	mux := http.NewServeMux()
	type ticket struct {
		path, name string
		created    time.Time
	}
	downloadDir := filepath.Join(d.w.root, "downloads")
	if err := os.MkdirAll(downloadDir, 0700); err != nil {
		return err
	}
	if files, err := os.ReadDir(downloadDir); err == nil {
		for _, f := range files {
			if info, e := f.Info(); e == nil && time.Since(info.ModTime()) > 10*time.Minute {
				_ = os.Remove(filepath.Join(downloadDir, f.Name()))
			}
		}
	}
	downloads := map[string]ticket{}
	var downloadMu sync.Mutex
	mux.HandleFunc("/download/", func(out http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Host != addr {
			http.Error(out, "invalid request", 400)
			return
		}
		token := strings.TrimPrefix(r.URL.Path, "/download/")
		downloadMu.Lock()
		t, ok := downloads[token]
		downloadMu.Unlock()
		if !ok || time.Since(t.created) > 10*time.Minute {
			http.NotFound(out, r)
			return
		}
		out.Header().Set("Content-Type", "application/zip")
		out.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": t.name}))
		out.Header().Set("Cache-Control", "no-store")
		http.ServeFile(out, r, t.path)
	})
	mux.Handle("/", http.FileServer(http.FS(web)))
	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" || r.Host != addr {
			http.Error(w, "invalid request", 400)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+addr {
			http.Error(w, "invalid origin", 400)
			return
		}
		var req struct {
			Method string            `json:"method"`
			Args   []json.RawMessage `json:"args"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20)).Decode(&req) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		arg := func(i int, v any) error {
			if i >= len(req.Args) {
				return os.ErrInvalid
			}
			return json.Unmarshal(req.Args[i], v)
		}
		var value any
		var e error
		switch req.Method {
		case "State":
			value = d.State()
		case "New":
			value, e = d.New()
		case "SetPending":
			var pending bool
			e = arg(0, &pending)
		case "Update":
			var x Edit
			e = arg(0, &x)
			if e == nil {
				value, e = d.Update(x)
			}
		case "SavePosition":
			var id string
			var p Position
			e = arg(0, &id)
			if e == nil {
				e = arg(1, &p)
			}
			if e == nil {
				e = d.SavePosition(id, p)
			}
		case "Activate", "Reload", "Status", "Overwrite", "Delete":
			var id string
			e = arg(0, &id)
			if e == nil {
				switch req.Method {
				case "Activate":
					value, e = d.Activate(id)
				case "Reload":
					value, e = d.Reload(id)
				case "Status":
					value, e = d.Status(id)
				case "Overwrite":
					value, e = d.Overwrite(id)
				case "Delete":
					value, e = d.Delete(id)
				}
			}
		case "Appearance":
			var x Appearance
			e = arg(0, &x)
			if e == nil {
				e = d.Appearance(x)
			}
		case "OpenLinked":
			var id, href string
			e = arg(0, &id)
			if e == nil {
				e = arg(1, &href)
			}
			if e == nil {
				value, e = d.OpenLinked(id, href)
			}
		case "Rename":
			var id, title string
			e = arg(0, &id)
			if e == nil {
				e = arg(1, &title)
			}
			if e == nil {
				value, e = d.Rename(id, title)
			}
		case "ReadImage":
			var id, dest string
			e = arg(0, &id)
			if e == nil {
				e = arg(1, &dest)
			}
			if e == nil {
				value, e = d.ReadImage(id, dest)
			}
		case "ImportImage":
			var id, name, b string
			e = arg(0, &id)
			if e == nil {
				e = arg(1, &name)
			}
			if e == nil {
				e = arg(2, &b)
			}
			if e == nil {
				value, e = d.ImportImage(id, name, b)
			}
		case "Delivery":
			var id string
			e = arg(0, &id)
			if e == nil {
				value, e = d.Delivery(id)
			}
		case "ExportBrowser":
			var id string
			var allow bool
			e = arg(0, &id)
			if len(req.Args) > 1 && e == nil {
				e = arg(1, &allow)
			}
			if e == nil {
				p := filepath.Join(downloadDir, "export-"+uid()+".zip")
				var result ExportResult
				result, e = d.w.Export(id, p, allow)
				if e == nil && result.Path != "" {
					token := uid()
					downloadMu.Lock()
					for key, t := range downloads {
						if time.Since(t.created) > 10*time.Minute {
							os.Remove(t.path)
							delete(downloads, key)
						}
					}
					downloads[token] = ticket{p, documentFilename(result.Document.Title, ".zip"), time.Now()}
					downloadMu.Unlock()
					value = map[string]any{"url": "/download/" + token, "missing": result.Missing, "external": result.External}
				} else if e == nil {
					value = map[string]any{"missing": result.Missing, "external": result.External}
				}
			}
		default:
			e = os.ErrInvalid
		}
		out := map[string]any{"value": value}
		if e != nil {
			out["error"] = strings.TrimSpace(e.Error())
		}
		_ = json.NewEncoder(w).Encode(out)
	})
	s := http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Print("留白本地开发版已启动，使用独立存档")
	return s.ListenAndServe()
}
