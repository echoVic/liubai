# Windows Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 留白 behave like a Windows app — window buttons, menus, shortcuts, fonts, file replacement and Windows paths — while macOS stays byte-for-byte the same where it is not meant to change.

**Architecture:** Go uses `runtime.GOOS` and `_windows.go` / `_other.go` files as the repo already does; the page decides its platform from `navigator.platform` (as CodeMirror does for `Mod-`) through a new `src/platform.ts`, and names shortcuts with `keyLabel`. Catalog messages that showed ⌘ take a `{shortcut}` placeholder.

**Tech Stack:** Go 1.27.1 + MyGo 0.5.5 (WebView2 on Windows), golang.org/x/sys/windows, TypeScript + CodeMirror 6, esbuild, bun/node checks, Python Playwright with Chrome.

**Spec:** `docs/superpowers/specs/2026-10-20-windows-support-design.md`

## Global Constraints

- macOS behavior and look do not change: Mac labels stay `⌘⇧R` / `⌘ ⇧ R`, the Mac menu template is unchanged, Mac font stacks keep their first families.
- Focus mode is `F8` on Windows (menu accelerator and page); `Ctrl+Shift+F` keeps working.
- Redo is `Ctrl+Y` in Windows menus and labels; off macOS the page also redoes on `Ctrl+Shift+Z`, which CodeMirror binds only on Linux.
- Quick note default: `Ctrl+Alt+Cmd+N` on macOS, `Ctrl+Alt+N` elsewhere; save with `Ctrl+Enter` off macOS.
- Desktop pages off macOS swallow `F5` and `Ctrl+R` (any `F5`; `Ctrl+R` without Alt/Shift/Meta).
- `TitleBarHeight: 64`; `.windows .desktop .topbar` pads `24px` left and `max(24px, calc(var(--mygo-titlebar-inset-right, 0px) + 12px))` right.
- Windows menus: File / Edit / View / Help; File ends with Exit (`RoleQuit`, label `bMenuExit`); Help = Check for Updates…, separator, About Liubai. No app menu, no Window menu, no Close Window.
- Busy retries: `ERROR_ACCESS_DENIED`, `ERROR_SHARING_VIOLATION`, `ERROR_LOCK_VIOLATION`, `ERROR_UNABLE_TO_REMOVE_REPLACED`; 20 attempts, 50 ms apart.
- The repo is public: no local paths, hosts or keys in code, docs or commits. Do not push without the user's approval.
- Regenerate `locales.ts`, `locales/catalog_gen.go` and `bindings.ts` only with `go tool mygo generate .`; rebuild `web/` only with `node scripts/build.mjs`.
- Edit `locales/zh-Hans.json` with exact-text replacements (some entries are hand-compacted; a JSON round trip would reformat them).

---

### Task 1: Windows file replacement and busy retries

**Files:**
- Modify: `workspace.go` (`atomicWriteHook`, `writeQuick`, `trash`, `quarantine`)
- Modify: `assets.go` (final rename of `Export`)
- Modify: `replace_other.go` (build tag)
- Create: `rename_other.go`, `rename_windows.go`, `replace_windows.go`
- Test: `replace_windows_test.go` (runs on Windows only)

**Interfaces:**
- Produces: `atomicWriteWith(path string, data []byte, mode os.FileMode, commit func(tmp string) error) error`; `renameFile(from, to string) error`; on Windows `retryWhileBusy(op func() error) error` and `busy(err error) bool`.

- [x] **Step 1: Write the Windows tests** in `replace_windows_test.go` (`//go:build windows`):
  - `TestReplaceFileKeepsAttributesStreamsAndCreationTime`: write `a.md`, set creation time to 2020-01-02 03:04:05 UTC (`windows.SetFileTime` on a `FILE_WRITE_ATTRIBUTES` handle), set `FILE_ATTRIBUTE_HIDDEN`, write stream `a.md:liubai` = `kept`; `replaceFile(path, "two\n", 0644)`; expect new content, hidden attribute, stream content and creation time unchanged. (Hidden distinguishes `ReplaceFileW` from a rename: NTFS tunneling can restore creation time on rename but not the attribute.)
  - `TestReplaceFileWaitsForAReaderWithoutDeleteSharing`: hold `a.md` with `windows.CreateFile(GENERIC_READ, FILE_SHARE_READ|FILE_SHARE_WRITE)`, close it after 200 ms with `time.AfterFunc`; `replaceFile` succeeds with the new content.
  - `TestReplaceFileGivesUpWhenTheFileStaysOpen`: hold it for the whole test; `replaceFile` fails within 5 s, content stays `one\n`, the directory holds only `a.md`.
  - `TestAtomicWriteWaitsForAReaderWithoutDeleteSharing`: same hold on `workspace.json`-like file, closed after 200 ms; `atomicWrite` succeeds.
- [x] **Step 2: Confirm they compile for Windows and fail to link** (no `atomicWriteWith` yet): `GOOS=windows GOARCH=amd64 go vet .` → errors naming the missing pieces.
- [x] **Step 3: Implement.** `workspace.go`:

```go
func atomicWriteHook(path string, data []byte, mode os.FileMode, beforeRename func(tmp string) error) error {
	return atomicWriteWith(path, data, mode, func(tmp string) error {
		if beforeRename != nil {
			if err := beforeRename(tmp); err != nil {
				return err
			}
		}
		return renameFile(tmp, path)
	})
}

// atomicWriteWith writes data to a synced file beside path; commit puts it in place.
func atomicWriteWith(path string, data []byte, mode os.FileMode, commit func(tmp string) error) error {
	// body of the old atomicWriteHook up to the rename, then:
	if err = commit(name); err != nil {
		return err
	}
	// directory sync as before
}
```

  `writeQuick`, `trash` (three renames), `quarantine` and `Export` call `renameFile` instead of `os.Rename`.

  `rename_other.go` (`//go:build !windows`): `func renameFile(from, to string) error { return os.Rename(from, to) }`.

  `rename_windows.go`:

```go
// Indexers, antivirus scanners and cloud clients open new and changed files
// for a moment without sharing deletes; renaming over such a file fails until
// they let go, so retry for about a second, as cmd/go's robustio does.
func renameFile(from, to string) error {
	return retryWhileBusy(func() error { return os.Rename(from, to) })
}

func retryWhileBusy(op func() error) error {
	for attempt := 0; ; attempt++ {
		err := op()
		if err == nil || attempt == 19 || !busy(err) {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func busy(err error) bool {
	for _, code := range []windows.Errno{windows.ERROR_ACCESS_DENIED, windows.ERROR_SHARING_VIOLATION, windows.ERROR_LOCK_VIOLATION, windows.ERROR_UNABLE_TO_REMOVE_REPLACED} {
		if errors.Is(err, code) {
			return true
		}
	}
	return false
}
```

  `replace_windows.go`: `os.Stat` the target (missing → `atomicWrite`); otherwise `atomicWriteWith` whose commit calls `kernel32!ReplaceFileW(target, tmp, nil, REPLACEFILE_IGNORE_MERGE_ERRORS|REPLACEFILE_IGNORE_ACL_ERRORS, 0, 0)` inside `retryWhileBusy`, wrapping failures as `*os.LinkError{Op: "replace"}`. When it fails with an error that is not busy, fall back to `renameFile(tmp, path)`: like `replace_darwin.go`, metadata is best effort and some network shares cannot replace files. `replace_other.go` becomes `//go:build !darwin && !windows`.
- [x] **Step 4: Verify**: `go test ./...` (macOS paths unchanged), `GOOS=windows GOARCH=amd64 go vet ./...`, `GOOS=windows GOARCH=arm64 go vet ./...`, `GOOS=windows GOARCH=amd64 go test -c -o /tmp/liubai-windows-tests.exe .` — all succeed.
- [x] **Step 5: Commit** `feat(windows): replace documents with ReplaceFileW and retry busy renames`.

### Task 2: Windows drive and share paths

**Files:**
- Modify: `images.go` (add `isVolumePath`), `assets.go` (`imagePath`, `SaveAs`), `workspace.go` (`OpenLinked` → `linkedPath`)
- Test: `paths_windows_test.go` (Windows only)

**Interfaces:**
- Produces: `isVolumePath(s string) bool`; `linkedPath(href string) (string, bool)`.

- [x] **Step 1: Write the Windows tests**:
  - `TestWindowsDrivePathImagesAreLocal`: fixture PNG in a temp dir; for `img` and `filepath.ToSlash(img)`, a draft `![](dest)` → `ReadImage` returns a URL and `Delivery` has `Images[dest]` starting with `data:image/png`.
  - `TestOpenLinkedFollowsWindowsDrivePaths`: `b.md` in a temp dir; from an opened `a.md`, `OpenLinked` with `target` and `filepath.ToSlash(target)+"#b"` opens `b.md`.
- [x] **Step 2: Implement.** `images.go`:

```go
// isVolumePath reports whether s starts with a drive or a share, as
// C:\notes\a.png or \\server\share\a.png do. Only Windows paths have them,
// and URL parsing would read the drive as a scheme.
func isVolumePath(s string) bool { return filepath.VolumeName(s) != "" }
```

  `imagePath`, after the alias lookup: `if isVolumePath(dest) { return url.PathUnescape(dest) }`. `SaveAs`: parse `dest` as a URL only when `!isVolumePath(dest)`, so `filepath.IsAbs` keeps absolute Windows references as they are. `OpenLinked` uses:

```go
// linkedPath returns the path a link to a local document names, without its
// query and fragment.
func linkedPath(href string) (string, bool) {
	if isVolumePath(href) {
		raw, _, _ := strings.Cut(href, "#")
		raw, _, _ = strings.Cut(raw, "?")
		p, err := url.PathUnescape(raw)
		return p, err == nil
	}
	u, err := url.Parse(href)
	if err != nil || u.Scheme != "" || u.Host != "" || u.Path == "" {
		return "", false
	}
	p, err := url.PathUnescape(u.EscapedPath())
	return p, err == nil
}
```
- [x] **Step 3: Verify** as in Task 1 Step 4 (plus `go test -run 'Link|Image|SaveAs' .`).
- [x] **Step 4: Commit** `feat(windows): treat drive and share paths in Markdown as local files`.

### Task 3: Native menus, quick note default, title bar and Unix-only tests

**Files:**
- Modify: `main.go` (`menuTemplate`, `menuTemplateFor`, `showAbout`, `Desktop.CheckForUpdates`, `Desktop.About`, `TitleBarHeight`)
- Modify: `capture.go` (`defaultCaptureShortcut()`), `locales/zh-Hans.json`, `locales/en.json` (`bMenuExit`, `bMenuHelp`)
- Regenerate: `locales/catalog_gen.go`, `locales.ts`, `bindings.ts`
- Test: `menu_test.go`, `capture_test.go`, `external_test.go`, `saveas_test.go`

**Interfaces:**
- Produces: `menuTemplateFor(goos string, msgs locales.Messages, action func(string) func(*mygo.MenuItem, *mygo.Window)) []*mygo.MenuItem`; `defaultCaptureShortcut() string`; bound `Desktop.CheckForUpdates()` and `Desktop.About()` (page calls `call('CheckForUpdates')`, `call('About')`).

- [x] **Step 1: Tests.** Every existing `menuTemplateIn(` call in `menu_test.go` becomes `menuTemplateFor("darwin", `. New:
  - `TestWindowsMenusFollowWindowsHabits` (zh-Hans and en): four menus, File first and Help last; File ends with `RoleQuit` labelled 退出 / Exit; Help = 检查更新… / Check for Updates… (with Click), separator, 关于留白 / About Liubai (with Click); nowhere `RoleHide`, `RoleHideOthers`, `RoleUnhide`, `RoleFront`, `RoleClose`, `RoleZoom`.
  - `TestWindowsFocusModeUsesF8`: 专注模式 has accelerator `F8` in the Windows template.

  `capture_test.go` expects `defaultCaptureShortcut()`, and a new `TestQuickNoteShortcutDefaultsPerPlatform` checks it is `Ctrl+Alt+Cmd+N` on darwin and `Ctrl+Alt+N` elsewhere, both valid. The two `chmod 0` tests in `external_test.go` skip on Windows (`chmod 0 leaves files readable on Windows`); `TestSaveAsKeepsReferencesThroughDirectorySymlink` skips on Windows when `os.Symlink` fails.
- [x] **Step 2: Run** `go test -run 'Menu|Capture' .` → fails to compile (`menuTemplateFor` missing).
- [x] **Step 3: Implement.** Catalog: after `bMenuQuit` add `bMenuExit` (退出 / Exit, "Native menu label: Exit, the last item of the File menu on Windows") and `bMenuHelp` (帮助 / Help, "Native menu label: Help"). `go tool mygo generate .`.

  `main.go`: `menuTemplate` calls `menuTemplateFor(runtime.GOOS, …)`; `menuTemplateIn` is removed. `menuTemplateFor` builds the shared File items (New … Export PDF), Edit and View once; on darwin it returns exactly today's five menus; elsewhere File + Exit, Edit, View, Help. The focus accelerator is `F8` off darwin, with the reason in a comment: Microsoft Pinyin and Sogou use Ctrl+Shift+F to switch to Traditional Chinese. `showAbout(msgs)` holds the `ShowAboutPanel` call with the `"0.5.0"` literal (the release checklist's version spot). `func (d *Desktop) CheckForUpdates() { updater.CheckForUpdates() }`, `func (d *Desktop) About() { showAbout(locales.In(i18n.Locale())) }`. `NewWindow` gains `TitleBarHeight: 64`.

  `capture.go`:

```go
// defaultCaptureShortcut is ⌃⌥⌘N on macOS. Elsewhere Cmd would be the
// Windows key, so the default is Ctrl+Alt+N, Evernote's new-note shortcut.
func defaultCaptureShortcut() string {
	if runtime.GOOS == "darwin" {
		return "Ctrl+Alt+Cmd+N"
	}
	return "Ctrl+Alt+N"
}
```
- [x] **Step 4: Verify**: `go test ./... && go vet ./...`; Windows vet/test-compile as in Task 1; `git diff --stat` shows `bindings.ts` gaining exactly the two methods.
- [x] **Step 5: Commit** `feat(windows): Windows menus, quick note default and title bar height`.

### Task 4: Platform module and quick note keys

**Files:**
- Create: `src/platform.ts`, `scripts/check-platform.ts`
- Modify: `src/capture-input.ts`, `src/capture.ts`, `scripts/check-capture-input.ts`

**Interfaces:**
- Produces (`src/platform.ts`): `mac: boolean`, `windows: boolean`, `keyLabel(keys: string, opts?: {spaced?: boolean; macOS?: boolean}): string`, `isReloadKey(e): boolean`, `focusKeys: string` (`Mod+Shift+F` / `F8`), `redoKeys: string` (`Mod+Shift+Z` / `Mod+Y`).
- Produces (`src/capture-input.ts`): `captureKeyAction(e, composing = false, macOS = mac)`, `displayCaptureShortcut(shortcut, macOS = mac)`.

- [x] **Step 1: Write `scripts/check-platform.ts`**:

```ts
import assert from 'node:assert/strict';
import {keyLabel,isReloadKey} from '../src/platform';
for(const [keys,macCompact,macSpaced,other] of [
 ['Mod+Shift+R','⌘⇧R','⌘ ⇧ R','Ctrl+Shift+R'],['Mod+\\','⌘\\','⌘ \\','Ctrl+\\'],['Mod+Enter','⌘↩','⌘ ↩','Ctrl+Enter'],
 ['Ctrl+Alt+Cmd+N','⌃⌥⌘N','⌃ ⌥ ⌘ N','Ctrl+Alt+Win+N'],['Ctrl++','⌃+','⌃ +','Ctrl++'],['F8','F8','F8','F8'],
]){assert.equal(keyLabel(keys,{macOS:true}),macCompact);assert.equal(keyLabel(keys,{macOS:true,spaced:true}),macSpaced);assert.equal(keyLabel(keys,{macOS:false}),other);assert.equal(keyLabel(keys,{macOS:false,spaced:true}),other)}
const key=(key:string,extra:object={})=>({key,ctrlKey:false,altKey:false,shiftKey:false,metaKey:false,...extra});
for(const e of [key('F5'),key('F5',{ctrlKey:true}),key('F5',{shiftKey:true}),key('r',{ctrlKey:true}),key('R',{ctrlKey:true})])assert.ok(isReloadKey(e),JSON.stringify(e));
for(const e of [key('r'),key('R',{ctrlKey:true,shiftKey:true}),key('r',{ctrlKey:true,altKey:true}),key('r',{metaKey:true}),key('F4',{altKey:true})])assert.ok(!isReloadKey(e),JSON.stringify(e));
console.log('平台快捷键写法与刷新键检查通过');
```

  `scripts/check-capture-input.ts`: existing asserts pass `macOS=true` explicitly; add: Ctrl+Enter saves only off macOS, ⌘+Enter only on macOS; `displayCaptureShortcut('Ctrl+Alt+N',false)==='Ctrl+Alt+N'`, `displayCaptureShortcut('Ctrl+Alt+Cmd+N',false)==='Ctrl+Alt+Win+N'`.
- [x] **Step 2: Run** `bun scripts/check-platform.ts` → fails (module missing).
- [x] **Step 3: Implement `src/platform.ts`**:

```ts
// Key names follow the platform, as CodeMirror decides what Mod- means.
const platform=typeof navigator==='undefined'?'':navigator.platform||'';
export const mac=/Mac|iPhone|iPad|iPod/.test(platform);
export const windows=/^Win/.test(platform);
const macKeys:Record<string,string>={Mod:'⌘',Cmd:'⌘',Ctrl:'⌃',Alt:'⌥',Shift:'⇧',Enter:'↩'};
const otherKeys:Record<string,string>={Mod:'Ctrl',Cmd:'Win'};
// Names a shortcut such as Mod+Shift+R, or a MyGo accelerator such as
// Ctrl+Alt+Cmd+N: ⌘⇧R on macOS (⌘ ⇧ R spaced), Ctrl+Shift+R elsewhere.
export function keyLabel(keys:string,{spaced=false,macOS=mac}:{spaced?:boolean;macOS?:boolean}={}){
 const parts=keys.endsWith('++')?[...keys.slice(0,-2).split('+'),'+']:keys.split('+');
 return macOS?parts.map(p=>macKeys[p]||p).join(spaced?' ':''):parts.map(p=>otherKeys[p]||p).join('+');
}
// Microsoft Pinyin and Sogou switch to Traditional Chinese on Ctrl+Shift+F, so
// focus mode is F8 off macOS, as in Typora. CodeMirror redoes with Ctrl+Y there.
export const focusKeys=mac?'Mod+Shift+F':'F8';
export const redoKeys=mac?'Mod+Shift+Z':'Mod+Y';
// WebView2 reloads the page, and with it the editor, on F5 and Ctrl+R.
export function isReloadKey(e:Pick<KeyboardEvent,'key'|'ctrlKey'|'altKey'|'shiftKey'|'metaKey'>){
 return e.key==='F5'||e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey&&e.key.toLowerCase()==='r';
}
```

  `capture-input.ts`: `captureKeyAction(e,composing=false,macOS=mac)` saves on `e.key==='Enter'&&(macOS?e.metaKey:e.ctrlKey)`; `displayCaptureShortcut(shortcut,macOS=mac)` returns `keyLabel(shortcut,{macOS})`. `capture.ts` line 29 uses `(mac?e.metaKey:e.ctrlKey)`.
- [x] **Step 4: Verify**: `bun scripts/check-platform.ts`, `bun scripts/check-capture-input.ts`, `node_modules/.bin/tsc --noEmit`.
- [x] **Step 5: Commit** `feat(windows): name shortcuts per platform; Ctrl+Enter saves quick notes`.

### Task 5: Shortcuts in messages, the palette and the toolbar

**Files:**
- Modify: `locales/zh-Hans.json`, `locales/en.json` (8 messages gain `{shortcut}`; en `fTextDownloadedImagesRemainOnThisMac` says "this computer"; new `fShowInFileExplorer`)
- Modify: `src/i18n.ts` (`localizePage` passes `data-shortcut`), `src/app.ts`, `src/editor.ts`, `src/capture.ts`, `src/index.html`, `src/capture.html`
- Regenerate: `locales.ts`, `locales/catalog_gen.go`

**Interfaces:**
- Consumes: `keyLabel`, `focusKeys`, `redoKeys` from Task 4.
- Produces: elements may carry `data-shortcut="Mod+N"`; message functions `fEditingIsUnavailableInReadingModePressRTo(shortcut)`, `fShowMarkdownSourceM(shortcut)`, `fSaveAsDraftEscClose(shortcut)`, `fCtrlClickToOpenTheLink(shortcut)`, `fShowTheEditorAndReadingViewSideBySide(shortcut)`, `fShowTheFormattedDocumentR(shortcut)`, `fNewDocumentN(shortcut)`, `fUseTheShortcutInAnyAppToWriteA(shortcut)`.

- [x] **Step 1: Catalog.** zh-Hans / en texts (each `@` entry gains `"placeholders": {"shortcut": {"type": "String"}}` and a description without ⌘):

| key | zh-Hans | en |
|---|---|---|
| fEditingIsUnavailableInReadingModePressRTo | 阅读模式下不能编辑，{shortcut} 返回编辑 | Editing is unavailable in Reading Mode. Press {shortcut} to return to editing. |
| fShowMarkdownSourceM | 显示 Markdown 源码 {shortcut} | Show Markdown Source {shortcut} |
| fSaveAsDraftEscClose | {shortcut} 存为草稿 · Esc 关闭 | {shortcut} Save as Draft · Esc Close |
| fCtrlClickToOpenTheLink | {shortcut} 点击打开链接 | {shortcut}-click to open the link |
| fShowTheEditorAndReadingViewSideBySide | 编辑区和阅读视图并排 {shortcut} | Show the editor and reading view side by side {shortcut} |
| fShowTheFormattedDocumentR | 只显示排好版的文稿 {shortcut} | Show the formatted document {shortcut} |
| fNewDocumentN | 新建文稿 {shortcut} | New Document {shortcut} |
| fUseTheShortcutInAnyAppToWriteA | 在任何应用里按快捷键，写一句话，{shortcut} 存为草稿。 | Use the shortcut in any app to write a note. Press {shortcut} to save it as a draft. |

  New `fShowInFileExplorer`: 在资源管理器中显示 / Show in File Explorer. `go tool mygo generate .`; `node_modules/.bin/tsc --noEmit` now lists every call site that lacks the argument.
- [x] **Step 2: Call sites.** `localizePage` calls each message with `keyLabel(el.dataset.shortcut)` when the element has `data-shortcut` (messages without a placeholder ignore it). `index.html`: split `data-shortcut="Mod+\"`, read `Mod+Shift+R`, new `Mod+N`, quick note note `Mod+Enter`; `capture.html` status `Mod+Enter`. `app.ts`: both reading-mode toasts pass `keyLabel('Mod+Shift+R')`; the source button sets `dataset.shortcut='Mod+Shift+M'` and its title with `keyLabel('Mod+Shift+M')`; palette labels use `const kbd=(keys:string)=>keyLabel(keys,{spaced:true})` (`'⌘ ⇧ F'` → `kbd(focusKeys)`, `'⌘ ⇧ Z'` → `kbd(redoKeys)`, others `Mod+…`); format buttons use `keyLabel('Mod+Z')`, `keyLabel(redoKeys)`, `keyLabel('Mod+B')`, `keyLabel('Mod+U')`, `keyLabel('Mod+L')`, `keyLabel('Mod+F')`. `editor.ts` link title: a module constant `keyLabel('Mod')`. `capture.ts` hint: `keyLabel('Mod+Enter')`.
- [x] **Step 3: Verify**: `tsc --noEmit`, `node scripts/check-i18n.mjs`, `go tool mygo i18n check .`, `grep -n "⌘" src/app.ts src/editor.ts src/capture.ts` shows only comments, `go test ./...`.
- [x] **Step 4: Commit** `feat(windows): show shortcuts the way each platform writes them`.

### Task 6: Windows behavior in the page

**Files:**
- Modify: `src/app.ts`, `src/capture.ts`, `src/editing.ts`, `scripts/check-editing.ts`

**Interfaces:**
- Consumes: `mac`, `windows`, `isReloadKey`, `focusKeys` (Task 4); `Desktop.CheckForUpdates` / `Desktop.About` (Task 3); `fShowInFileExplorer` (Task 5).
- Produces: `<html class="windows">` on Windows; `localDocumentLink(href, drivePaths = windows)`.

- [ ] **Step 1: Test** (`scripts/check-editing.ts`): `localDocumentLink('C:\\notes\\b.md#B',true)` → `{path:'C:\\notes\\b.md',fragment:'B'}`; `localDocumentLink('C:/notes/b.md',true)` → path `C:/notes/b.md`; both `null` with `drivePaths=false`.
- [ ] **Step 2: Implement.**
  - `app.ts` at start-up: `document.documentElement.classList.toggle('windows',windows)`; on Windows `#reveal-quarantine` uses `data-i18n="fShowInFileExplorer"`; `if(desktop&&!mac)window.addEventListener('keydown',e=>{if(isReloadKey(e))e.preventDefault()},true)`.
  - Global keydown: off macOS, a bare `F8` with no dialog open runs `focus`; the Mod shortcut handler ignores `ctrlKey&&altKey` off macOS (AltGr) and maps `Ctrl+Shift+Z` to `redo`.
  - Palette (desktop only): `['checkUpdates',messages.bMenuCheckForUpdates(),'']`, `['about',messages.bMenuAbout(),'']`; `action()` handles them before needing a document: `void call(id==='about'?'About':'CheckForUpdates').catch(e=>toast(errorText(e)))`.
  - `capture.ts`: the same `windows` class and reload guard (`window.mygo&&!mac`).
  - `editing.ts`: `localDocumentLink(href,drivePaths=windows)` lets `/^[a-z]:[\\/]/i` through when `drivePaths`.
- [ ] **Step 3: Verify**: `bun scripts/check-editing.ts`, `tsc --noEmit`, `node scripts/check-i18n.mjs`.
- [ ] **Step 4: Commit** `feat(windows): F8 focus, reload guard, File Explorer label and drive links in the page`.

### Task 7: Fonts, title bar room, scrollbars and the quick note panel

**Files:**
- Modify: `src/style.css`, `src/preview.css`, `src/capture.css`, `src/delivery.ts`
- Rebuild: `web/` (`node scripts/build.mjs`)

- [ ] **Step 1: Font stacks** (exact replacements, each counted):
  - `-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans CJK SC',sans-serif` → `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei UI','Microsoft YaHei','Noto Sans CJK SC',sans-serif`
  - `-apple-system,sans-serif` → `-apple-system,'Segoe UI','Microsoft YaHei UI',sans-serif`
  - `'Iowan Old Style','Songti SC','Noto Serif CJK SC',Georgia,serif` → `'Iowan Old Style','Songti SC','Noto Serif CJK SC','Source Han Serif SC','Noto Serif SC',Georgia,'Microsoft YaHei',serif`
  - `'Iowan Old Style','Songti SC','Noto Serif CJK SC',serif` → `… 'Source Han Serif SC','Noto Serif SC','Microsoft YaHei',serif`
  - `'Iowan Old Style','Songti SC',serif` and `'Songti SC',serif` (19px / 15px) → add `'Source Han Serif SC','Noto Serif SC','Microsoft YaHei'` before `serif`
  - `capture.css`: `-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif` → add `"Segoe UI"` before and `"Microsoft YaHei UI","Microsoft YaHei"` after `"PingFang SC"`
  - `delivery.ts`: `PingFang SC,Noto Sans CJK SC` → `PingFang SC,Microsoft YaHei,Noto Sans CJK SC`
- [ ] **Step 2: Windows rules** (end of `style.css`):

```css
/* Windows: MyGo draws minimize, maximize and close at the right of the top bar. */
.windows .desktop .topbar{padding-left:24px;padding-right:max(24px,calc(var(--mygo-titlebar-inset-right,0px) + 12px))}
/* Chromium's Windows scrollbars are 17px of light gray, glaring in the ink theme. */
.windows,.windows *{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--muted-foreground) 45%,transparent) transparent}
```

  `capture.css`: `.windows .capture{border-radius:8px}` (Windows 11 rounds the panel window by 8px).
- [ ] **Step 3: Build and inspect**: `node scripts/build.mjs` twice; the second run leaves `git status` unchanged; `git diff --stat web/` lists `app.js`, `capture.js`, `style.css`, `capture.css`, `index.html`, `capture.html` (and the docx chunk only if `delivery.ts` lands in it).
- [ ] **Step 4: Commit** `feat(windows): Windows fonts, title bar room, thin scrollbars`.

### Task 8: Chrome regression with a Windows platform

**Files:**
- Create: `scripts/check-windows.py`

- [ ] **Step 1: Write the check** (run with `scripts/e2e.sh check-windows`). Two contexts, `zh-CN`, 1120×820: one with `add_init_script("Object.defineProperty(Navigator.prototype,'platform',{get:()=>'Win32'})")`, one without.
  - Windows context: `html` has class `windows`; new / split / read titles end in `Ctrl+N`, `Ctrl+\`, `Ctrl+Shift+R`; bold `加粗 Ctrl+B`, redo `重做 Ctrl+Y`; `Control+k` opens the palette, whose shortcut column has `Ctrl+N` and `F8` (focus) and no ⌘⇧⌥⌃ anywhere; no visible text, `title`, `aria-label` or `placeholder` holds ⌘⇧⌥⌃; `F8` toggles `body.focus-mode` and Escape leaves it; a link's title starts `Ctrl `; `.cm-content` font-family contains `Microsoft YaHei`, `body` contains `Segoe UI`; `.cm-scroller` has `scrollbar-width: thin`; with `body.desktop` and `--mygo-titlebar-inset-right:138px` set, `.topbar` pads 24px / 150px; the quick-note settings shortcut reads `Ctrl+Alt+Win+N` (the web server runs on macOS); `capture.html` saves with `Control+Enter` and not `Meta+Enter`, and its status reads `Ctrl+Enter 存为草稿 · Esc 关闭`.
  - macOS context: new title `新建文稿 ⌘N`, palette `⌘ N`, `scrollbar-width: auto`, `.desktop .topbar` pads 88px left, `capture.html` saves with `Meta+Enter`.
- [ ] **Step 2: Run** `scripts/e2e.sh check-windows` → PASS; then the existing `scripts/e2e.sh check-english`, `check-toolbar`, `check-capture`, `check-reader` → PASS; bun checks `editing`, `capture-input`, `rendering`, `paste`, `slash` → PASS.
- [ ] **Step 3: Commit** `test(windows): Chrome regression with a Windows platform`.

### Task 9: CI, packaging check and docs

**Files:**
- Create: `.github/workflows/windows.yml`, `docs/superpowers/validation/2026-10-20-windows-support.md`
- Modify: `docs/RELEASING.md`, `README.md`, `README.en.md` (development section only)

- [ ] **Step 1: CI** — `windows-latest`, `actions/checkout@v7`, `actions/setup-go@v7` with `go-version-file: go.mod`, then `go vet ./...` and `go test ./...`; on pushes to `main` and `feat/**` and on pull requests.
- [ ] **Step 2: Packaging** — `go tool mygo build -platform windows/amd64,windows/arm64 -o /tmp/liubai-windows-build .`; record the tree (`Liubai.exe` beside `web/`), sizes, `file` output, and that the installer step was skipped for want of NSIS.
- [ ] **Step 3: Docs** — `RELEASING.md` gains a Windows section (NSIS via `brew install makensis`, the build platforms, the two `Liubai Setup <版本> <arch>.exe` installers and `update-windows-*.json`, unsigned preview wording for the notes, the SmartScreen path), README development sections add the Windows build line; the validation record lists what was checked on macOS and the device checklist from the spec.
- [ ] **Step 4: Full verification** — `go test ./... && go vet ./...`, Windows vet/test-compile for amd64 and arm64, `tsc --noEmit`, `check-i18n`, `check-editor`, the bun checks, the Chrome checks above, `scripts/e2e.sh check-blocks-webkit` if the display is awake.
- [ ] **Step 5: Commit** `docs(windows): CI, release steps and validation record`.
