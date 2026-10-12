package main

import (
	"context"
	"embed"
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
)

//go:embed web
var frontend embed.FS
var desktopAction = mygo.NewEvent[string]("liubai:action")
var documentOpened = mygo.NewEvent[WorkspaceState]("liubai:opened")

type Desktop struct {
	w          *Workspace
	win        *mygo.Window
	allowClose atomic.Bool
}

func (d *Desktop) State() WorkspaceState                      { return d.w.State() }
func (d *Desktop) Update(e Edit) (Document, error)            { return d.w.Update(e) }
func (d *Desktop) New() (WorkspaceState, error)               { return d.w.New() }
func (d *Desktop) Activate(id string) (WorkspaceState, error) { return d.w.Activate(id) }
func (d *Desktop) Appearance(p Appearance) error              { return d.w.Appearance(p) }
func (d *Desktop) ImportImage(id, name, data string) (ImageResult, error) {
	return d.w.ImportImage(id, name, data)
}
func (d *Desktop) ReadImage(id, dest string) (ImageResult, error)  { return d.w.ReadImage(id, dest) }
func (d *Desktop) Reload(id string) (WorkspaceState, error)        { return d.w.Reload(id) }
func (d *Desktop) Rename(id, title string) (WorkspaceState, error) { return d.w.Rename(id, title) }
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
	name := state.Current.Title
	if filepath.Ext(name) != ".md" {
		name += ".md"
	}
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
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "文稿与图片一起带走", DefaultPath: "文稿.zip", Filters: []mygo.FileFilter{{Name: "ZIP", Extensions: []string{"zip"}}}})
	if err != nil {
		return ExportResult{}, err
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	return d.w.Export(id, path, allowMissing)
}
func (d *Desktop) Close()             { d.allowClose.Store(true); mygo.App.Quit() }
func (d *Desktop) Reveal(path string) { mygo.Shell.ShowItemInFolder(path) }
func (d *Desktop) requestClose()      { _ = desktopAction.Broadcast("close") }

func main() {
	webAddr := flag.String("web", "", "仅在回环地址运行本地开发版")
	dataDir := flag.String("data-dir", "", "独立文稿存储目录")
	flag.Parse()
	mygo.App.SetName("留白")
	mygo.App.SetVersion("0.1.0")
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
		log.Fatal(err)
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
	mygo.App.WhenReady(func() {
		appearance := w.State().Appearance
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
		d.win.OnClose(func(e *mygo.CloseEvent) {
			if !d.allowClose.Load() {
				e.PreventDefault()
				d.requestClose()
			}
		})
		action := func(s string) func(*mygo.MenuItem, *mygo.Window) {
			return func(*mygo.MenuItem, *mygo.Window) { _ = desktopAction.Broadcast(s) }
		}
		mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
			{Label: "留白", Submenu: []*mygo.MenuItem{{Label: "关于留白", Click: func(*mygo.MenuItem, *mygo.Window) {
				mygo.App.ShowAboutPanel(mygo.AboutPanelOptions{ApplicationName: "留白", ApplicationVersion: "0.1.0"})
			}}, mygo.Separator(), {Label: "退出留白", Accelerator: "CmdOrCtrl+Q", Click: action("close")}}},
			{Label: "文件", Submenu: []*mygo.MenuItem{{Label: "新建文稿", Accelerator: "CmdOrCtrl+N", Click: action("new")}, {Label: "打开文稿…", Accelerator: "CmdOrCtrl+O", Click: action("open")}, {Label: "保存", Accelerator: "CmdOrCtrl+S", Click: action("save")}, {Label: "另存为…", Accelerator: "CmdOrCtrl+Shift+S", Click: action("saveAs")}, {Label: "带走文稿…", Click: action("export")}}},
			{Label: "编辑", Submenu: []*mygo.MenuItem{{Label: "撤销", Accelerator: "CmdOrCtrl+Z", Click: action("undo")}, {Label: "重做", Accelerator: "CmdOrCtrl+Shift+Z", Click: action("redo")}, mygo.Separator(), {Role: mygo.RoleCut}, {Role: mygo.RoleCopy}, {Role: mygo.RolePaste}, {Role: mygo.RoleSelectAll}, {Label: "查找", Accelerator: "CmdOrCtrl+F", Click: action("find")}}},
			{Label: "显示", Submenu: []*mygo.MenuItem{{Label: "外观", Click: action("theme")}, {Label: "源码 / 即时排版", Accelerator: "CmdOrCtrl+Shift+M", Click: action("source")}, {Label: "操作搜索", Accelerator: "CmdOrCtrl+K", Click: action("commands")}}},
		}))
		mygo.App.OnActivate(func(bool) { d.win.Show(); d.win.Focus() })
		d.win.Page().OnWillNavigate(func(e *mygo.NavigateEvent) { e.PreventDefault() })
	})
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		if !d.allowClose.Load() {
			e.PreventDefault()
			d.requestClose()
		}
	})
	mygo.App.OnOpenFile(func(path string) {
		go func() {
			state, e := w.Open(path)
			if e == nil {
				_ = documentOpened.Broadcast(state)
			}
		}()
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
		case "Update":
			var x Edit
			e = arg(0, &x)
			if e == nil {
				value, e = d.Update(x)
			}
		case "Activate", "Reload":
			var id string
			e = arg(0, &id)
			if e == nil {
				if req.Method == "Activate" {
					value, e = d.Activate(id)
				} else {
					value, e = d.Reload(id)
				}
			}
		case "Appearance":
			var x Appearance
			e = arg(0, &x)
			if e == nil {
				e = d.Appearance(x)
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
		case "ExportBrowser":
			var id string
			e = arg(0, &id)
			if e == nil {
				p := filepath.Join(d.w.root, "export-"+uid()+".zip")
				var result ExportResult
				result, e = d.w.Export(id, p, false)
				defer os.Remove(p)
				if e == nil && len(result.Missing) == 0 {
					b, er := os.ReadFile(p)
					e = er
					value = map[string]any{"data": b, "external": result.External}
				} else if e == nil {
					e = os.ErrNotExist
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
