package main

import (
	"context"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"liubai/locales"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/i18n"
	"github.com/egoist/mygo/plugins/updater"
	"github.com/egoist/mygo/transfer"
)

var desktopAction = mygo.NewEvent[string]("liubai:action")
var documentOpened = mygo.NewEvent[WorkspaceState]("liubai:opened")
var openFailed = mygo.NewEvent[OpenFailure]("liubai:open-failed")

type OpenFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type Desktop struct {
	capture      *captureController
	capturePanel *mygo.Window
	w            *Workspace
	win          *mygo.Window
	menuAction   func(string) func(*mygo.MenuItem, *mygo.Window)
	native       *desktopIntegration
	allowClose   atomic.Bool
	pending      atomic.Bool
	pageReady    atomic.Bool
}

func (d *Desktop) openPath(path string) {
	defer d.syncNative("")
	state, err := d.w.Open(path)
	if err != nil {
		if !d.pageReady.Load() || d.native == nil {
			d.w.notifyMessage(localeMessage{Key: "bOpenFailed", Args: map[string]any{"name": filepath.Base(path), "error": err.Error()}})
		} else {
			_ = openFailed.Broadcast(OpenFailure{Path: path, Error: err.Error()})
		}
	} else {
		d.syncNative(state.Current.Path)
		if d.native != nil {
			_ = documentOpened.Broadcast(state)
		}
	}
	if d.win != nil {
		d.win.Show()
		d.win.Focus()
	}
}

func (d *Desktop) State() WorkspaceState {
	d.pageReady.Store(true)
	defer d.syncNative("")
	return valueIn(d.w.State(), i18n.Locale()).(WorkspaceState)
}
func (d *Desktop) Update(e Edit) (Document, error) {
	doc, err := d.w.Update(e)
	d.savedNative(e.ID, err)
	return documentIn(doc, i18n.Locale()), err
}
func (d *Desktop) SavePosition(id string, p Position) error { return d.w.SavePosition(id, p) }
func (d *Desktop) New() (WorkspaceState, error) {
	s, err := d.w.New()
	return d.currentResult(s, err, false)
}
func (d *Desktop) Activate(id string) (WorkspaceState, error) {
	s, err := d.w.Activate(id)
	return d.currentResult(s, err, true)
}
func (d *Desktop) Delete(id string) (WorkspaceState, error) {
	s, err := d.w.Delete(id)
	return d.currentResult(s, err, false)
}
func (d *Desktop) Status(id string) (DocStatus, error) {
	defer d.syncNative("")
	status, err := d.w.Status(id)
	return valueIn(status, i18n.Locale()).(DocStatus), err
}
func (d *Desktop) Overwrite(id string) (WorkspaceState, error) {
	s, err := d.w.Overwrite(id)
	d.savedNative(id, err)
	return d.currentResult(s, err, false)
}
func (d *Desktop) Appearance(p Appearance) error {
	if err := d.w.Appearance(p); err != nil {
		return err
	}
	if d.native != nil {
		syncWindowTheme(p)
		_ = captureAppearance.Broadcast(p)
	}
	return nil
}

// themeSourceFor is the appearance the app's theme asks of native UI. Modes
// that read the system's appearance leave it to the system: a forced source
// also turns the pages' prefers-color-scheme, which could then never go back.
func themeSourceFor(p Appearance, now time.Time) mygo.ThemeSource {
	id := p.Theme
	switch p.Auto {
	case "system", "seasons":
		return mygo.ThemeSystem
	case "hours":
		id = hoursTheme(now.Hour())
	}
	if darkTheme(id) {
		return mygo.ThemeDark
	}
	return mygo.ThemeLight
}

// syncWindowTheme has Windows draw the window buttons, which sit on the page,
// and the menus in the app's theme rather than the system's; the pages'
// prefers-color-scheme follows it too. macOS draws traffic lights alike in
// either, and its menus and sheets keep the system's.
func syncWindowTheme(p Appearance) {
	if s := themeSourceFor(p, time.Now()); runtime.GOOS == "windows" && mygo.Theme.Source() != s {
		mygo.Theme.SetSource(s)
	}
}
func (d *Desktop) ImportImage(id, name, data string) (ImageResult, error) {
	return d.w.ImportImage(id, name, data)
}
func (d *Desktop) ReadImage(id, dest string) (ImageResult, error) { return d.w.ReadImage(id, dest) }
func (d *Desktop) Reload(id string) (WorkspaceState, error) {
	s, err := d.w.Reload(id)
	if err == nil {
		d.savedNative(id, nil)
	}
	return d.currentResult(s, err, false)
}
func (d *Desktop) Rename(id, title string) (WorkspaceState, error) {
	s, err := d.w.Rename(id, title)
	return d.currentResult(s, err, false)
}
func (d *Desktop) OpenLinked(id, href string) (WorkspaceState, error) {
	s, err := d.w.OpenLinked(id, href)
	return d.currentResult(s, err, true)
}
func (d *Desktop) Open(ctx context.Context) (WorkspaceState, error) {
	defer d.syncNative("")
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: locales.BOpenMarkdown(), Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md", "markdown", "txt"}}}})
	if err != nil {
		return WorkspaceState{}, err
	}
	if len(paths) == 0 {
		return d.w.State(), nil
	}
	s, err := d.w.Open(paths[0])
	return d.currentResult(s, err, true)
}
func (d *Desktop) SaveAs(ctx context.Context, id string) (ExportResult, error) {
	defer d.syncNative("")
	state := d.w.State()
	name := documentFilename(documentIn(state.Current, i18n.Locale()).Title, ".md")
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: locales.BSaveMarkdown(), DefaultPath: name, Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md"}}}})
	if err != nil {
		return ExportResult{}, err
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	result, err := d.w.SaveAs(id, path)
	d.savedNative(id, err)
	d.w.mu.Lock()
	current := d.w.current
	d.w.mu.Unlock()
	if err == nil && result.Document.ID == current {
		d.syncNative(result.Document.Path)
	}
	return result, err
}
func (d *Desktop) Export(ctx context.Context, id string, allowMissing bool) (ExportResult, error) {
	d.w.mu.Lock()
	doc := d.w.docs[id]
	if doc == nil {
		d.w.mu.Unlock()
		return ExportResult{}, messageError("bDocumentMissing", nil)
	}
	name := documentFilename(documentIn(*doc, i18n.Locale()).Title, ".zip")
	d.w.mu.Unlock()
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: locales.BExportZIP(), DefaultPath: name, Filters: []mygo.FileFilter{{Name: "ZIP", Extensions: []string{"zip"}}}})
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
		return messageError("bCopyTooLarge", nil)
	}
	return mygo.Clipboard.Write(transfer.New(transfer.NewItem(transfer.Bytes(transfer.HTML, []byte(html)), transfer.Bytes(transfer.Text, []byte(text)))))
}
func (d *Desktop) ClipboardText() (string, error) {
	text, err := mygo.Clipboard.ReadFormat(transfer.Text)
	return string(text), err
}
func (d *Desktop) OpenLink(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || (u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "mailto") {
		return messageError("bUnsupportedLink", nil)
	}
	return mygo.Shell.OpenExternal(raw)
}
func (d *Desktop) Rescue(ctx context.Context, id, content string) (ExportResult, error) {
	path, e := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: locales.BSaveRecovery(), DefaultPath: locales.BRecoveryFilename(), Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md"}}}})
	if e != nil {
		return ExportResult{}, e
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	return d.w.SaveRecovery(id, content, path)
}
func (d *Desktop) PDF(ctx context.Context, title string) (ExportResult, error) {
	if d.native == nil || d.win == nil {
		return ExportResult{}, messageError("bDesktopPDFOnly", nil)
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: locales.BExportPDF(), DefaultPath: documentFilename(title, ".pdf"), Filters: []mygo.FileFilter{{Name: "PDF", Extensions: []string{"pdf"}}}})
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
	if err = checkWriteTarget(path); err != nil {
		return ExportResult{}, err
	}
	if err = atomicWrite(path, b, 0644); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{Path: path}, nil
}
func (d *Desktop) SaveHTML(ctx context.Context, title, html string) (ExportResult, error) {
	if len(html) > 64<<20 {
		return ExportResult{}, messageError("bHTMLTooLarge", nil)
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: locales.BSaveHTML(), DefaultPath: documentFilename(title, ".html"), Filters: []mygo.FileFilter{{Name: "HTML", Extensions: []string{"html"}}}})
	if err != nil {
		return ExportResult{}, err
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	if err = checkWriteTarget(path); err != nil {
		return ExportResult{}, err
	}
	if err = atomicWrite(path, []byte(html), 0644); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{Path: path}, nil
}
func (d *Desktop) SaveDOCX(ctx context.Context, title string, data []byte) (ExportResult, error) {
	if len(data) > 64<<20 {
		return ExportResult{}, messageError("bWordTooLarge", nil)
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: locales.BSaveWordDocument(), DefaultPath: documentFilename(title, ".docx"), Filters: []mygo.FileFilter{{Name: "Word", Extensions: []string{"docx"}}}})
	if err != nil {
		return ExportResult{}, err
	}
	if path == "" {
		return ExportResult{Cancelled: true}, nil
	}
	if err = checkWriteTarget(path); err != nil {
		return ExportResult{}, err
	}
	if err = atomicWrite(path, data, 0644); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{Path: path}, nil
}
func (d *Desktop) Close() {
	d.allowClose.Store(true)
	if d.native != nil {
		mygo.App.Quit()
	}
}
func (d *Desktop) SetPending(pending bool) {
	d.pending.Store(pending)
	if d.native != nil {
		d.native.mu.Lock()
		d.native.edited.setPending(time.Now(), pending)
		d.native.mu.Unlock()
		d.native.signal()
	}
}
func (d *Desktop) Reveal(path string) { mygo.Shell.ShowItemInFolder(path) }
func (d *Desktop) CheckForUpdates()   { updater.CheckForUpdates() }
func (d *Desktop) About()             { showAbout(locales.In(i18n.Locale())) }
func (d *Desktop) requestClose()      { _ = desktopAction.Broadcast("close") }

func quitAllowed(allowClose, pending bool) bool { return allowClose || !pending }

func menuTemplate(action func(string) func(*mygo.MenuItem, *mygo.Window)) []*mygo.MenuItem {
	return menuTemplateFor(runtime.GOOS, locales.In(i18n.Locale()), action)
}

func showAbout(msgs locales.Messages) {
	mygo.App.ShowAboutPanel(mygo.AboutPanelOptions{ApplicationName: msgs.BMenuAppName(), ApplicationVersion: "0.6.5"})
}

// appNameFor is the name MyGo knows the app by: it keys the single-instance
// lock, PathUserData (window state, recent documents, the updater's state)
// and on Windows the WebView2 profile. Windows also keeps the chosen language
// in PathUserData, and a second launch finds the first by the lock, so there
// the name is mygo.json's in every language and only the window title is
// localized. macOS keeps the language in the app's defaults and hands
// documents to the running app.
func appNameFor(goos string, msgs locales.Messages) string {
	if goos == "darwin" {
		return msgs.BMenuAppName()
	}
	return "Liubai"
}

// menuTemplateFor follows the habits of each system. macOS has the app menu
// and the Window menu. Windows has neither: Exit ends File, and Help holds the
// update check and About. Its menus open with Alt or F10, since the window has
// no menu bar under its hidden title bar.
func menuTemplateFor(goos string, msgs locales.Messages, action func(string) func(*mygo.MenuItem, *mygo.Window)) []*mygo.MenuItem {
	mac := goos == "darwin"
	about := &mygo.MenuItem{Label: msgs.BMenuAbout(), Click: func(*mygo.MenuItem, *mygo.Window) { showAbout(msgs) }}
	updates := &mygo.MenuItem{Label: msgs.BMenuCheckForUpdates(), Click: func(*mygo.MenuItem, *mygo.Window) { updater.CheckForUpdates() }}
	// Microsoft Pinyin and Sogou switch to Traditional Chinese on Ctrl+Shift+F,
	// so Windows has Typora's F8 for focus mode, and its Ctrl+Y for redo.
	focus, redo := "CmdOrCtrl+Shift+F", "CmdOrCtrl+Shift+Z"
	if !mac {
		focus, redo = "F8", "Ctrl+Y"
	}
	file := []*mygo.MenuItem{{Label: msgs.BMenuNew(), Accelerator: "CmdOrCtrl+N", Click: action("new")}, {Label: msgs.BMenuOpen(), Accelerator: "CmdOrCtrl+O", Click: action("open")}, {Role: mygo.RoleOpenRecent, Label: msgs.BMenuOpenRecent()}, {Label: msgs.BMenuCapture(), Click: action("capture")}, mygo.Separator(), {Label: msgs.BMenuSave(), Accelerator: "CmdOrCtrl+S", Click: action("save")}, {Label: msgs.BMenuSaveAs(), Accelerator: "CmdOrCtrl+Shift+S", Click: action("saveAs")}, mygo.Separator(), {Label: msgs.BMenuExport(), Click: action("deliver")}, {Label: msgs.BMenuExportPDF(), Accelerator: "CmdOrCtrl+P", Click: action("pdf")}, mygo.Separator()}
	editItems := []*mygo.MenuItem{{Label: msgs.BMenuUndo(), Accelerator: "CmdOrCtrl+Z", Click: action("undo")}, {Label: msgs.BMenuRedo(), Accelerator: redo, Click: action("redo")}, mygo.Separator(), {Role: mygo.RoleCut, Label: msgs.BMenuCut()}, {Role: mygo.RoleCopy, Label: msgs.BMenuCopy()}, {Role: mygo.RolePaste, Label: msgs.BMenuPaste()}, {Label: msgs.BMenuPastePlain(), Accelerator: "CmdOrCtrl+Shift+V", Click: action("pastePlain")}, {Role: mygo.RoleSelectAll, Label: msgs.BMenuSelectAll()}, mygo.Separator(), {Label: msgs.BMenuFind(), Accelerator: "CmdOrCtrl+F", Click: action("find")}}
	edit := &mygo.MenuItem{Label: msgs.BMenuEdit(), Submenu: editItems}
	view := &mygo.MenuItem{Label: msgs.BMenuView(), Submenu: []*mygo.MenuItem{{Label: msgs.BMenuFocus(), Accelerator: focus, Click: action("focus")}, {Label: msgs.BMenuAppearance(), Click: action("theme")}, {Label: msgs.BMenuLayout(), Accelerator: "CmdOrCtrl+\\", Click: action("layout")}, {Label: msgs.BMenuRead(), Accelerator: "CmdOrCtrl+Shift+R", Click: action("read")}, {Label: msgs.BMenuSource(), Accelerator: "CmdOrCtrl+Shift+M", Click: action("source")}, {Label: msgs.BMenuCommands(), Accelerator: "CmdOrCtrl+K", Click: action("commands")}, mygo.Separator(), {Role: mygo.RoleToggleFullScreen, Label: msgs.BMenuFullscreen()}, mygo.Separator(), {Label: msgs.BMenuLanguage(), Submenu: languageMenu(msgs, action)}}}
	if !mac {
		return []*mygo.MenuItem{
			{Label: msgs.BMenuFile(), Submenu: append(file, &mygo.MenuItem{Role: mygo.RoleQuit, Label: msgs.BMenuExit()})},
			edit, view,
			{Label: msgs.BMenuHelp(), Submenu: []*mygo.MenuItem{updates, mygo.Separator(), about}},
		}
	}
	return []*mygo.MenuItem{
		{Label: msgs.BMenuAppName(), Submenu: []*mygo.MenuItem{about, updates, mygo.Separator(), {Role: mygo.RoleHide, Label: msgs.BMenuHide()}, {Role: mygo.RoleHideOthers, Label: msgs.BMenuHideOthers()}, {Role: mygo.RoleUnhide, Label: msgs.BMenuShowAll()}, mygo.Separator(), {Role: mygo.RoleQuit, Label: msgs.BMenuQuit()}}},
		{Label: msgs.BMenuFile(), Submenu: append(file, &mygo.MenuItem{Role: mygo.RoleClose, Label: msgs.BMenuCloseWindow()})},
		edit, view,
		{Label: msgs.BMenuWindow(), Submenu: []*mygo.MenuItem{{Role: mygo.RoleMinimize, Label: msgs.BMenuMinimize()}, {Role: mygo.RoleZoom, Label: msgs.BMenuZoom()}, mygo.Separator(), {Role: mygo.RoleFront, Label: msgs.BMenuFront()}}},
	}
}

func main() {
	webAddr := flag.String("web", "", locales.BWebHelp())
	dataDir := flag.String("data-dir", "", locales.BDataDirHelp())
	flag.Parse()
	if *webAddr == "" {
		mygo.App.SetName(appNameFor(runtime.GOOS, locales.In(i18n.Locale())))
		mygo.App.SetVersion("0.6.5")
	}
	web := frontendFiles()
	if *webAddr == "" && os.Getenv("MYGO_GENERATE") != "" {
		mygo.Bind(&Desktop{})
		if err := mygo.App.Run(); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *webAddr == "" {
		// A second launch hands its files to the first instance, whose window
		// then comes to the front, as only the process the user started allows.
		allowForegroundHandoff()
		if !mygo.App.RequestSingleInstanceLock() {
			return
		}
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
			_, _ = mygo.Dialog.Message(mygo.MessageOptions{Type: mygo.MessageError, Title: locales.BStartupFailed(), Message: locales.BStorageUnavailable(), Detail: root + "\n" + err.Error(), Buttons: []string{locales.BExit()}})
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
	// Check every 4 hours instead of the default day, so a new release shows up the same day.
	mygo.Use(updater.New(updater.Options{Interval: 4 * time.Hour}))
	nativeLocaleChoice.Store(w.localePreference)
	if runtime.GOOS != "darwin" {
		// Off macOS MyGo keeps the chosen language in a file of PathUserData,
		// which 0.6.0 looked for under the localized app name. The workspace's
		// choice, the one the Language menu shows, decides.
		mygo.App.SetLocale(w.localePreference)
	}
	d.native = newDesktopIntegration(w)
	defer d.native.cancel()
	mygo.SetFrontend(web)
	mygo.Bind(d)
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		mygo.GlobalShortcut.UnregisterAll()
		d.native.cancel()
		if err := w.Flush(); err != nil {
			log.Print(err)
		}
	})
	mygo.App.WhenReady(func() {
		w.mu.Lock()
		appearance := w.appearance
		w.mu.Unlock()
		syncWindowTheme(appearance)
		if runtime.GOOS == "windows" {
			// The hours change the theme on the clock, with no Appearance call.
			go func() {
				for range time.Tick(time.Minute) {
					w.mu.Lock()
					p := w.appearance
					w.mu.Unlock()
					syncWindowTheme(p)
				}
			}()
		}
		dark := darkTheme(appearance.Theme)
		switch appearance.Auto {
		case "system", "seasons":
			dark = mygo.Theme.IsDark()
		case "hours":
			dark = darkTheme(hoursTheme(time.Now().Hour()))
		}
		bg := "#e9e9e7"
		if dark {
			bg = "#191b1a"
		}
		// On Windows the window buttons are as tall as the 64px top bar; macOS ignores TitleBarHeight.
		d.win = mygo.NewWindow(mygo.WindowOptions{Title: locales.BMenuAppName(), URL: "/", Width: 1120, Height: 820, MinWidth: 680, MinHeight: 540, Hidden: true, TitleBarStyle: mygo.TitleBarHidden, TitleBarHeight: 64, BackgroundColor: bg, StateKey: "liubai-editor"})
		go d.native.run(d.win)
		openedAtLogin := mygo.App.WasOpenedAtLogin()
		d.win.OnReadyToShow(func() {
			if !openedAtLogin {
				d.win.Show()
			}
		})
		d.initCapture()
		// The hidden capture panel outlives the editor window, so close the app explicitly.
		d.win.OnClosed(func() { mygo.App.Quit() })
		d.win.OnFileDrop(func(e *mygo.FileDropEvent) {
			var paths []string
			for _, path := range e.Paths {
				if markdownPath(path) {
					paths = append(paths, path)
				} else if !strings.HasPrefix(mime.TypeByExtension(strings.ToLower(filepath.Ext(path))), "image/") {
					_ = openFailed.Broadcast(OpenFailure{Path: path, Error: locales.BMarkdownOnly()})
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
			return func(*mygo.MenuItem, *mygo.Window) {
				if strings.HasPrefix(s, "locale:") {
					_ = d.SetLocale(strings.TrimPrefix(s, "locale:"))
					d.refreshLocale()
					return
				}
				if s == "capture" {
					d.ShowCapture()
					return
				}
				_ = desktopAction.Emit(d.win, s)
			}
		}
		d.menuAction = action
		d.refreshLocale()
		mygo.App.OnLocaleChanged(func(string) { d.refreshLocale() })
		mygo.App.OnActivate(func(bool) { d.win.Show(); d.win.Focus() })
		d.win.Page().OnWillNavigate(func(e *mygo.NavigateEvent) { e.PreventDefault() })
	})
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		if !quitAllowed(d.allowClose.Load(), d.pending.Load()) {
			e.PreventDefault()
			d.requestClose()
		} else {
			d.allowClose.Store(true)
		}
	})
	mygo.App.OnOpenFile(func(path string) {
		go d.openPath(path)
	})
	// A second launch hands its files to OnOpenFile; without any, it still asks for the window.
	mygo.App.OnSecondInstance(func([]string, string) {
		if d.win != nil {
			d.win.Show()
			d.win.Focus()
		}
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
			Locale string            `json:"locale"`
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
		case "SetLocale":
			var tag string
			e = arg(0, &tag)
			if e == nil {
				e = d.SetLocale(tag)
			}
		case "Capture":
			var text string
			e = arg(0, &text)
			if e == nil {
				value, e = d.Capture(text)
			}
		case "HideCapture":
			d.HideCapture()
		case "ShowCapture":
			d.ShowCapture()
		case "GetCaptureSettings":
			value = d.GetCaptureSettings()
		case "SetCaptureSettings":
			var p CaptureSettings
			e = arg(0, &p)
			if e == nil {
				e = d.SetCaptureSettings(p)
			}
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
					downloads[token] = ticket{p, documentFilename(documentIn(result.Document, req.Locale).Title, ".zip"), time.Now()}
					downloadMu.Unlock()
					value = map[string]any{"url": "/download/" + token, "missing": result.Missing, "external": result.External}
				} else if e == nil {
					value = map[string]any{"missing": result.Missing, "external": result.External}
				}
			}
		default:
			e = os.ErrInvalid
		}
		out := map[string]any{"value": valueIn(value, req.Locale)}
		if e != nil {
			out["error"] = strings.TrimSpace(errorIn(e, req.Locale))
			if catalog, ok := e.(*catalogError); ok {
				out["errorCode"] = catalog.Key
				out["errorArgs"] = catalog.Args
			}
		}
		_ = json.NewEncoder(w).Encode(out)
	})
	s := http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Print("留白本地开发版已启动，使用独立存档") // i18n-ignore: diagnostic log, not interface text
	return s.ListenAndServe()
}
