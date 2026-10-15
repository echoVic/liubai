# 留白 0.4 可靠性、性能与阅读器基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this run the implementer is the local Codex CLI (`codex exec`), one task per session; the orchestrator reviews each diff, runs the verification commands and commits.

**Goal:** Fix the six verified reliability bugs, make editing and idle cost independent of document size and draft count, fix the reviewed UX bugs, and make opening and reading existing Markdown files work.

**Architecture:** Go backend (`workspace.go`, `assets.go`, `delivery.go`, `main.go`) owns storage, disk sync and image resolution; the TypeScript frontend (`src/`) owns CodeMirror editing, the shared markdown-it renderer (preview + delivery) and the UI. Every new backend method is bound on `Desktop` for MyGo and mirrored in the browser dev server's `/api` switch in `main.go`.

**Tech Stack:** Go 1.27.1, MyGo, goldmark, golang.org/x/sys/unix (new), golang.org/x/image (new direct use); TypeScript, CodeMirror 6, markdown-it 14, DOMPurify (new), markdown-it-footnote (new), esbuild, Bun for script checks, Python Playwright + Chrome for browser checks.

**Spec:** [docs/superpowers/specs/2026-10-15-reader-foundation-design.md](../specs/2026-10-15-reader-foundation-design.md)

## Global Constraints

- Read the spec's decision table before starting a task; each task implements the decisions it names, nothing more.
- Go: 1.27.1, no cgo. New Go modules only `golang.org/x/sys v0.49.0` and `golang.org/x/image v0.46.0` (the orchestrator adds them; the Codex sandbox has no network).
- npm: new packages only `dompurify` and `markdown-it-footnote` (the orchestrator adds them). New third-party code must get an entry in `web/THIRD_PARTY_NOTICES.txt` in the existing `name version` + license-text format.
- All user-facing copy is Simplified Chinese in the existing tone (short, calm, no exclamation marks). Keep existing copy unless a task says otherwise.
- Match the surrounding code style: Go is gofmt'd and terse; TypeScript in `src/` is dense one-space-indented code. New TS helpers may be multi-line but must follow the same naming and idioms.
- Never lose user content: anything destructive moves data to `quarantine/` or `trash/` under the data dir or keeps a recovery draft.
- `web/` is the committed embedded frontend: any change under `src/` must be followed by `node scripts/build.mjs` so `web/` matches.
- Every new `Desktop` method must also be handled in `serveWeb`'s `/api` switch in `main.go`, with argument decoding like the existing cases.
- Codex sandbox: no network; before Go commands run `export GOCACHE=/tmp/liubai-codex-gocache`. Do not run Playwright/Chrome scripts (`scripts/check-preview.py`, `scripts/check-split-preview.py`); the orchestrator runs them. Do not commit; the orchestrator commits after review.
- Base verification after every task (all must pass):
  ```sh
  export GOCACHE=/tmp/liubai-codex-gocache
  go test ./... && go vet ./...
  node_modules/.bin/tsc --noEmit
  node scripts/check-editor.mjs
  bun scripts/check-editing.ts
  bun scripts/check-rendering.ts
  node scripts/build.mjs   # only when src/ changed
  ```

## File Map

| File | Responsibility | Tasks |
|---|---|---|
| `assets.go` | image refs, image resolution, Save As, export | 1, 4, 12, 14 |
| `images.go` (new) | destination canonicalization and markdown target formatting | 1 |
| `imageformat.go` (new) | image sniffing (format, MIME, size) | 14 |
| `replace_darwin.go`, `replace_other.go` (new) | metadata-preserving file replacement | 3 |
| `workspace.go` | drafts, index, disk sync, positions, deletion | 2, 5, 8, 9, 15 |
| `summary.go` (new) | title inference, excerpts, front matter range in Go | 8 |
| `main.go` | MyGo bindings, menus, events, quit flow, dev `/api` | 2, 5, 6, 8, 9, 10, 11 |
| `mygo.json`, `resources/*.lproj/` | file associations, Info.plist, localized names | 10, 11 |
| `src/editor.ts` | CodeMirror setup, live preview decorations | 7, 11, 12 |
| `src/markdown.ts` | shared renderer (preview + delivery) | 12 |
| `src/highlight.ts` (new) | preview code highlighting | 13 |
| `src/stats.ts` (new) | word count | 8 |
| `src/editing.ts` | links, headings, front matter range | 11, 12 |
| `src/preview.ts` | preview controller | 11, 12, 13 |
| `src/app.ts`, `src/index.html`, `src/style.css`, `src/preview.css`, `src/types.ts` | UI | most tasks |
| `scripts/check-performance.ts` (new) | performance budget | 7 |
| `scripts/check-preview.ts` | browser renderer checks | 12, 13 |

---
## Workstream A — 可靠性（评审问题 1–6）

### Task 1: 图片路径按规范形式比对，新路径可读

Spec decision 1. Today the frontend sends markdown-it-normalized destinations (`周报.assets/x.png` → `%E5%91%A8%E6%8A%A5.assets/x.png`, `<my image.png>` → `my%20image.png`) while `ReadImage` compares them with goldmark's raw destinations, so every local image with a CJK or space path fails with 「图片未被文稿引用」.

**Files:**
- Create: `images.go`
- Modify: `assets.go` (`ImageResult`, `imagePath`, `ReadImage`, `ImportImage`, `imageReplacements`, `materialize`, `SaveAs`)
- Modify: `src/app.ts` (`insertImages`, `resolveImageFor`), `src/types.ts` (`ImageResult`)
- Test: `images_test.go` (new)

**Interfaces:**
- Produces (Go): `func canonicalDestination(dest string) string` — `url.PathUnescape(dest)`, or `dest` unchanged when unescaping fails. `func markdownDestination(path string) string` — replaces `<`/`>` with `%3C`/`%3E`, then wraps in `<…>` when the result contains a space, tab, `(` or `)`.
- Produces (Go): `ImageResult` gains `Markdown string \`json:"markdown"\`` — the destination text to put between `(` and `)` when inserting the image. `Destination` stays the raw path (`周报.assets/<name>`), or `liubai-asset:<name>` for drafts.
- Produces (TS): `ImageResult.markdown: string`; image cache keys are `documentID + ':' + normalizeImageDestination(dest)`.
- Later tasks rely on: `targets` maps passed to `rewriteImages`/`imageReplacements` hold raw paths; `imageReplacements` formats them (`markdownDestination` when the original destination was not in `<…>`, `<`/`>` escaping only when it was) and its `replacement.value` is the exact inserted text.

- [ ] **Step 1: Write the failing tests** — create `images_test.go`:

```go
package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFixture(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, tinyPNG(), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestReadImageAcceptsNormalizedDestinations(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "周报.assets", "image-20261015.png"))
	writeFixture(t, filepath.Join(dir, "my image.png"))
	p := filepath.Join(dir, "周报.md")
	os.WriteFile(p, []byte("![截屏](周报.assets/image-20261015.png)\n\n![](<my image.png>)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, dest := range []string{
		"周报.assets/image-20261015.png",
		"%E5%91%A8%E6%8A%A5.assets/image-20261015.png",
		"my image.png",
		"my%20image.png",
	} {
		if _, err := w.ReadImage(s.Current.ID, dest); err != nil {
			t.Errorf("ReadImage(%q): %v", dest, err)
		}
	}
	if _, err := w.ReadImage(s.Current.ID, "%E5%91%A8%E6%8A%A5.assets/other.png"); err == nil {
		t.Fatal("unreferenced image was readable")
	}
}

func TestLegacyPercentEncodedDestinationsStillResolve(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "周报.assets", "a.png"))
	p := filepath.Join(dir, "周报.md")
	os.WriteFile(p, []byte("![](%E5%91%A8%E6%8A%A5.assets/a.png)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, dest := range []string{"%E5%91%A8%E6%8A%A5.assets/a.png", "周报.assets/a.png"} {
		if _, err := w.ReadImage(s.Current.ID, dest); err != nil {
			t.Errorf("ReadImage(%q): %v", dest, err)
		}
	}
}

func TestImportImageUsesReadableDestination(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "我的 笔记.md")
	os.WriteFile(p, []byte("正文\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	im, err := w.ImportImage(s.Current.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	if im.Destination != "我的 笔记.assets/"+im.Name {
		t.Fatalf("destination not readable: %q", im.Destination)
	}
	if im.Markdown != "<"+im.Destination+">" {
		t.Fatalf("markdown target should be bracketed: %q", im.Markdown)
	}
	d := w.State().Current
	content := "正文\n\n![图](" + im.Markdown + ")\n"
	if _, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: content}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != content {
		t.Fatalf("saved file changed the image target: %q", b)
	}
	if _, err := w.ReadImage(d.ID, "%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0.assets/"+im.Name); err != nil {
		t.Fatal(err)
	}
}

func TestSaveAsWritesReadableAssetDestinations(t *testing.T) {
	w := workspace(t)
	d := w.State().Current
	im, err := w.ImportImage(d.ID, "a.png", base64.StdEncoding.EncodeToString(tinyPNG()))
	if err != nil {
		t.Fatal(err)
	}
	if im.Markdown != im.Destination || !strings.HasPrefix(im.Destination, "liubai-asset:") {
		t.Fatalf("draft image target: %+v", im)
	}
	edit(t, w, "![图]("+im.Markdown+")\n")
	p := filepath.Join(t.TempDir(), "我的 笔记.md")
	r, err := w.SaveAs(d.ID, p)
	if err != nil {
		t.Fatal(err)
	}
	if want := "![图](<我的 笔记.assets/" + im.Name + ">)\n"; r.Document.Content != want {
		t.Fatalf("got %q want %q", r.Document.Content, want)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(p), "我的 笔记.assets", im.Name)); err != nil {
		t.Fatal(err)
	}
}

func TestMarkdownDestination(t *testing.T) {
	for in, want := range map[string]string{
		"a.png":           "a.png",
		"周报.assets/a.png": "周报.assets/a.png",
		"my image.png":    "<my image.png>",
		"a(1).png":        "<a(1).png>",
		"a<b>.png":        "a%3Cb%3E.png",
		"x y/<c>.png":     "<x y/%3Cc%3E.png>",
	} {
		if got := markdownDestination(in); got != want {
			t.Errorf("markdownDestination(%q) = %q, want %q", in, got, want)
		}
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `export GOCACHE=/tmp/liubai-codex-gocache && go test -run 'ReadImageAccepts|LegacyPercent|ImportImageUses|SaveAsWritesReadable|MarkdownDestination' ./...`
Expected: compile failure (`markdownDestination`, `im.Markdown` undefined), then after stubbing, failures on the CJK/space cases.

- [ ] **Step 3: Implement**

`images.go`:

```go
package main

import (
	"net/url"
	"strings"
)

// canonicalDestination makes Markdown source destinations and markdown-it's
// normalized URLs comparable: both decode to the same path.
func canonicalDestination(dest string) string {
	if p, err := url.PathUnescape(dest); err == nil {
		return p
	}
	return dest
}

// markdownDestination writes a path as a readable CommonMark destination:
// raw UTF-8, inside <…> when it holds spaces or parentheses.
func markdownDestination(path string) string {
	path = strings.NewReplacer("<", "%3C", ">", "%3E").Replace(path)
	if strings.ContainsAny(path, " \t()") {
		return "<" + path + ">"
	}
	return path
}
```

`assets.go`:
- `ReadImage`: find the referenced target with `v == dest || canonicalDestination(v) == canonicalDestination(dest)`; resolve the path from that target (not from `dest`); keep the error text 「图片未被文稿引用」 when none matches. Return `ImageResult{Destination: dest, URL: …, Name: filepath.Base(p), Markdown: markdownDestination(target)}` (for `liubai-asset:` targets `Markdown` is the target itself).
- `imagePath`: alias lookup tries `d.ImageAliases[dest]` first, then any alias whose key has the same `canonicalDestination`.
- `ImportImage` for a document with a path: `dest = assetDir + "/" + name` (no `url.PathEscape`); alias key is that raw `dest`; return `Markdown: markdownDestination(dest)`. For drafts `Markdown` equals `Destination`.
- `materialize` and `SaveAs`: `targets[dest] = assetDir + "/" + name` (raw). Aliases keyed by the raw new destination.
- `imageReplacements`: when the scanned destination was inside `<…>` (`angle == true`) insert `strings.NewReplacer("<", "%3C", ">", "%3E").Replace(value)`; otherwise insert `markdownDestination(value)`. Put that final text in `replacement.value` so `SaveAs`'s `TextChange.Insert` stays exact. `Export`'s `images/<hash>.<ext>` targets come out unchanged.

`src/types.ts`: add `markdown:string` to `ImageResult`.

Also delete the unused `Workspace.AssetHTTP` (assets.go) and `cleanError` (workspace.go).

`src/app.ts`:
- import `normalizeImageDestination` from `./markdown`; add `const imageKey=(id:string,dest:string)=>id+':'+normalizeImageDestination(dest);` and use it in `resolveImageFor` and in `insertImages`' `imageCache.set`.
- `insertImages` inserts `` `\n\n![${alt}](${image.markdown})\n\n` ``.

- [ ] **Step 4: Run tests**

Run: `export GOCACHE=/tmp/liubai-codex-gocache && go test ./... && go vet ./...`
Expected: PASS, including the existing `TestReferenceImageRewriteAndMissingExport` (`[p]: <new/a.png>` keeps one pair of brackets) and `TestSaveAsKeepsDestinationChangesAndUndoAssetsAcrossFolders`.

- [ ] **Step 5: Frontend checks and build**

Run: `node_modules/.bin/tsc --noEmit && bun scripts/check-rendering.ts && node scripts/build.mjs`
Expected: PASS; `web/app.js` rebuilt.

- [ ] **Step 6: Commit** — `fix(images): match normalized destinations and write readable image paths`

---

### Task 2: 损坏数据不再导致闪退，打开失败有提示

Spec decision 2. Today one truncated draft or an index with `version != 1` makes `openWorkspace` fail and `main` calls `log.Fatal`; `OnOpenFile` drops errors silently.

**Files:**
- Modify: `workspace.go` (`openWorkspace`, `WorkspaceState`, `State`, new `Notify`)
- Modify: `main.go` (startup failure dialog, `OnOpenFile`, `Desktop.State`, new event)
- Modify: `src/app.ts`, `src/index.html` (banner reveal button), `src/types.ts`
- Test: `startup_test.go` (new)

**Interfaces:**
- Produces: `WorkspaceState.Notices []string \`json:"notices,omitempty"\`` and `QuarantineDir string \`json:"quarantineDir,omitempty"\``. `State()` returns pending notices once and clears them; other methods never include them.
- Produces: `func (w *Workspace) Notify(message string)` (locks; appends a notice).
- Produces: event `liubai:open-failed` with Go type `OpenFailure{Path string \`json:"path"\`; Error string \`json:"error"\`}`.
- Produces: `func (d *Desktop) openPath(path string)` used by `OnOpenFile` (Task 11 reuses it for drops and links).

- [ ] **Step 1: Write the failing tests** — `startup_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCorruptDraftIsQuarantinedAndStartupContinues(t *testing.T) {
	root := t.TempDir()
	w, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	good := edit(t, w, "# 好草稿\n")
	bad := filepath.Join(root, "drafts", strings.Repeat("ab", 12)+".json")
	os.WriteFile(bad, []byte(`{"id":"`), 0600)
	w2, err := openWorkspace(root)
	if err != nil {
		t.Fatalf("startup failed: %v", err)
	}
	s := w2.State()
	if len(s.Notices) == 0 || s.QuarantineDir != filepath.Join(root, "quarantine") {
		t.Fatalf("missing notice: %+v %q", s.Notices, s.QuarantineDir)
	}
	if _, err := os.Stat(bad); !os.IsNotExist(err) {
		t.Fatal("corrupt draft left in drafts/")
	}
	if moved, _ := filepath.Glob(filepath.Join(root, "quarantine", "*")); len(moved) != 1 {
		t.Fatalf("quarantine has %d entries", len(moved))
	}
	found := false
	for _, r := range s.Recent {
		found = found || r.ID == good.ID
	}
	if !found {
		t.Fatal("good draft lost")
	}
	if again := w2.State(); len(again.Notices) != 0 {
		t.Fatal("notices must be delivered once")
	}
}

func TestCorruptOrNewerIndexDoesNotBlockStartup(t *testing.T) {
	for _, index := range []string{`{"version":`, `{"version":2,"current":"","appearance":{"theme":"ink","followSystem":false}}`} {
		root := t.TempDir()
		w, err := openWorkspace(root)
		if err != nil {
			t.Fatal(err)
		}
		d := edit(t, w, "正文\n")
		os.WriteFile(filepath.Join(root, "workspace.json"), []byte(index), 0600)
		w2, err := openWorkspace(root)
		if err != nil {
			t.Fatalf("index %q: %v", index, err)
		}
		s := w2.State()
		if s.Current.ID != d.ID {
			t.Fatalf("index %q: current %q, want most recent draft %q", index, s.Current.ID, d.ID)
		}
		if len(s.Notices) == 0 {
			t.Fatalf("index %q: no notice", index)
		}
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go test -run 'CorruptDraft|CorruptOrNewer' ./...` → FAIL (`openWorkspace` returns errors; `Notices` undefined).

- [ ] **Step 3: Implement**

- `openWorkspace`:
  - A draft that cannot be read, parsed or validated (bad JSON, unsafe ID, file name ≠ `<id>.json`, content > `maxDocument`) is moved with `os.Rename` to `<root>/quarantine/<20060102-150405>-<basename>` (dir mode `0700`; add `-2`, `-3`… on name clashes). If the move fails, return the error as today.
  - `workspace.json` that fails to parse is moved the same way and the workspace starts from defaults; an index with `version > 1` is copied (not moved) to quarantine and parsed leniently (`current`, valid `appearance` fields), then rewritten as version 1 by `saveIndex`. Permission errors reading the index still return an error.
  - When `current` is missing or unknown, pick the document with the largest `Updated` (not a random map entry).
  - Notices (exact copy): `有 %d 份草稿无法读取，已移到隔离目录`; `工作区索引无法读取，已重建，原文件在隔离目录`; `工作区索引来自更新版本的留白，已备份到隔离目录`. Set `QuarantineDir` whenever a notice refers to the quarantine folder.
- `State()`: copy `w.notices` (and `QuarantineDir`) into the returned state, then clear them.
- `main.go`:
  - Desktop mode, `openWorkspace` error: inside `mygo.App.WhenReady` show `mygo.Dialog.Message(mygo.MessageOptions{Type: mygo.MessageError, Title: "留白无法启动", Message: "无法打开文稿存储目录", Detail: root + "\n" + err.Error(), Buttons: []string{"退出"}})`, then `mygo.App.Quit()`; run the app loop and return. Web mode keeps `log.Fatal`.
  - `var openFailed = mygo.NewEvent[OpenFailure]("liubai:open-failed")`.
  - `Desktop` gets `pageReady atomic.Bool`; `Desktop.State()` sets it before delegating.
  - `func (d *Desktop) openPath(path string)`: `state, err := d.w.Open(path)`; on error build `无法打开「<base>」：<err>`; if `pageReady` is false call `d.w.Notify(message)`, else broadcast `openFailed`; on success broadcast `documentOpened`. Afterwards show and focus `d.win` when it exists. `OnOpenFile` becomes `go d.openPath(path)`.
- Frontend:
  - `src/types.ts`: `WorkspaceState` gets `notices?:string[];quarantineDir?:string`.
  - `src/index.html`: add `<button id="reveal-quarantine" hidden>在 Finder 中显示</button>` to `#banner`.
  - `src/app.ts`: `banner(s='',conflict=false,reveal='')` toggles `#reveal-quarantine` (desktop only) and remembers `reveal`; clicking calls `call('Reveal',reveal)`. After the initial `load(await call('State'))`, and in `refreshRecent`, show `next.notices.join('；')` with `next.quarantineDir` when notices exist. Subscribe `window.mygo.on<{path:string;error:string}>('liubai:open-failed',f=>toast('无法打开「'+(f.path.split('/').pop()||f.path)+'」：'+f.error))`.

- [ ] **Step 4: Run tests and checks** — base verification (Global Constraints). Expected: PASS.

- [ ] **Step 5: Commit** — `fix(startup): quarantine unreadable data and report open failures`

---

### Task 3: 写回原文件保留 Finder 标签与创建时间

Spec decision 3. Autosave replaces the user's file via temp file + rename, which drops extended attributes (Finder tags) and resets the creation date. Keep the atomic rename; copy metadata onto the temp file first.

**Orchestrator pre-step (needs network, done before dispatch):** `go get golang.org/x/sys@v0.49.0`, then append `sys v0.49.0` + the text of `$(go env GOMODCACHE)/golang.org/x/sys@v0.49.0/LICENSE` to `web/THIRD_PARTY_NOTICES.txt`.

**Files:**
- Create: `replace_darwin.go`, `replace_other.go` (`//go:build !darwin`)
- Modify: `workspace.go` (`atomicWrite` → shared `atomicWriteHook`; `writeOriginal` uses `replaceFile`)
- Modify: `assets.go` (`SaveAs` uses `replaceFile` when the target exists)
- Test: `replace_darwin_test.go` (new, `//go:build darwin`)

**Interfaces:**
- Produces: `func replaceFile(path string, data []byte, perm os.FileMode) error` — atomic replace; on darwin copies every readable extended attribute (best effort, per-attribute failures ignored) and the creation time of the existing file to the temp file before the rename. Missing target → plain `atomicWrite`.
- Produces: `func atomicWriteHook(path string, data []byte, mode os.FileMode, beforeRename func(tmp string) error) error`; `atomicWrite` calls it with `nil`.
- Produces (darwin): `func setCreationTime(path string, t time.Time) error` via `unix.Setattrlist` with `unix.Attrlist{Bitmapcount: unix.ATTR_BIT_MAP_COUNT, Commonattr: unix.ATTR_CMN_CRTIME}` and a `unix.Timespec` buffer; `func copyXattrs(from, to string)` via `unix.Listxattr`/`Getxattr`/`Setxattr`. Read the original creation time from `unix.Stat_t.Btim`.

- [ ] **Step 1: Write the failing tests** — `replace_darwin_test.go`:

```go
//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const finderTags = "com.apple.metadata:_kMDItemUserTags"

func xattr(t *testing.T, p, name string) string {
	t.Helper()
	buf := make([]byte, 256)
	n, err := unix.Getxattr(p, name, buf)
	if err != nil {
		t.Fatalf("xattr %s: %v", name, err)
	}
	return string(buf[:n])
}

func TestReplaceFilePreservesTagsAndCreationTime(t *testing.T) {
	p := filepath.Join(t.TempDir(), "tagged.md")
	if err := os.WriteFile(p, []byte("old\n"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := unix.Setxattr(p, finderTags, []byte("liubai-tag"), 0); err != nil {
		t.Fatal(err)
	}
	if err := unix.Setxattr(p, "com.liubai.test", []byte("keep me"), 0); err != nil {
		t.Fatal(err)
	}
	created := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := setCreationTime(p, created); err != nil {
		t.Fatal(err)
	}
	if err := replaceFile(p, []byte("new\n"), 0640); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "new\n" {
		t.Fatalf("content %q", b)
	}
	if got := xattr(t, p, finderTags); got != "liubai-tag" {
		t.Fatalf("tags %q", got)
	}
	if got := xattr(t, p, "com.liubai.test"); got != "keep me" {
		t.Fatalf("custom attribute %q", got)
	}
	var st unix.Stat_t
	if err := unix.Stat(p, &st); err != nil {
		t.Fatal(err)
	}
	if st.Btim.Sec != created.Unix() {
		t.Fatalf("creation time %v, want %v", time.Unix(st.Btim.Sec, 0).UTC(), created)
	}
	if info, _ := os.Stat(p); info.Mode().Perm() != 0640 {
		t.Fatalf("mode %v", info.Mode())
	}
}

func TestAutosaveKeepsFinderTags(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "note.md")
	os.WriteFile(p, []byte("hello\n"), 0644)
	if err := unix.Setxattr(p, finderTags, []byte("liubai-tag"), 0); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Update(Edit{ID: s.Current.ID, Revision: s.Current.Revision, Content: "hello world\n"}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "hello world\n" {
		t.Fatalf("not written: %q", b)
	}
	if got := xattr(t, p, finderTags); got != "liubai-tag" {
		t.Fatalf("tags lost: %q", got)
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go test -run 'ReplaceFilePreserves|AutosaveKeepsFinderTags' ./...` → FAIL (undefined `replaceFile`/`setCreationTime`; tags lost).

- [ ] **Step 3: Implement** per the Interfaces block. `replace_other.go` just calls `atomicWrite`. Keep the temp file in the target directory, `f.Sync()` before the hook, directory sync after rename (as today).

- [ ] **Step 4: Run tests and checks** — base verification. Expected: PASS.

- [ ] **Step 5: Commit** — `fix(files): keep Finder tags and creation time when writing back`

---

### Task 4: 另存为不再改写用户自己的图片引用

Spec decision 4. Today `SaveAs` copies every local image into `<name>.assets/<sha>.<ext>` and rewrites the reference, even when saving back to the same path; a missing image blocks the save.

**Files:**
- Modify: `assets.go` (`SaveAs`, new `uniqueAssetName`)
- Modify: `src/app.ts` (`saveAs` toast mentions missing images)
- Test: `saveas_test.go` (new)

**Interfaces:**
- Consumes: Task 1's raw `targets` convention and `markdownDestination` formatting inside `imageReplacements`.
- Produces: `ExportResult.Missing` lists local images that could not be read during Save As; Save As still succeeds and leaves those references unchanged.
- Produces: `func uniqueAssetName(dir, base string, data []byte) (string, error)` — returns `base` when free or when the existing file has identical bytes; otherwise `stem-2.ext`, `stem-3.ext`, …

Rules, applied per local (non-external) image target of the document:

| Target | New location in the same directory as the current file (incl. same path) | Different directory, or the document is a draft |
|---|---|---|
| `liubai-asset:<name>` | copy into `<newBase>.assets/<sha-name>` (today's behavior) | same |
| absolute path | keep | keep |
| relative path, document is a draft (no path) and no alias | keep | keep |
| relative path (or aliased) that resolves through `imagePath` + `picture` | keep | copy into `<newBase>.assets/<uniqueAssetName(original base name)>`, cache a copy in `assets/<docID>/` and add aliases for the old and new destination (today's alias behavior) |
| relative path that does not resolve | keep, add to `Missing` | keep, add to `Missing` |

"Same directory" compares `filepath.EvalSymlinks` of both directories (fall back to `filepath.Clean` when evaluation fails).

- [ ] **Step 1: Write the failing tests** — `saveas_test.go`:

```go
package main

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveAsKeepsUserImageReferencesInSameFolder(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "images", "architecture.png"))
	p := filepath.Join(dir, "notes.md")
	original := "# Notes\n\n![架构图](images/architecture.png)\n"
	os.WriteFile(p, []byte(original), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, p)
	if err != nil {
		t.Fatal(err)
	}
	if r.Document.Content != original || len(r.Changes) != 0 {
		t.Fatalf("same-path save rewrote images: %q", r.Document.Content)
	}
	if _, err := os.Stat(filepath.Join(dir, "notes.assets")); !os.IsNotExist(err) {
		t.Fatal("same-path save created an assets folder")
	}
	r, err = w.SaveAs(s.Current.ID, filepath.Join(dir, "renamed.md"))
	if err != nil || r.Document.Content != original {
		t.Fatalf("same-folder save changed images: %q %v", r.Document.Content, err)
	}
}

func TestSaveAsToAnotherFolderCopiesImagesWithOriginalNames(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "images", "architecture.png"))
	p := filepath.Join(dir, "notes.md")
	os.WriteFile(p, []byte("![架构图](images/architecture.png)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "导出", "笔记.md")
	r, err := w.SaveAs(s.Current.ID, target)
	if err != nil {
		t.Fatal(err)
	}
	if r.Document.Content != "![架构图](笔记.assets/architecture.png)\n" {
		t.Fatalf("got %q", r.Document.Content)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(target), "笔记.assets", "architecture.png")); err != nil {
		t.Fatal(err)
	}
	os.RemoveAll(dir)
	if _, err := w.ReadImage(s.Current.ID, "笔记.assets/architecture.png"); err != nil {
		t.Fatal(err)
	}
}

func TestSaveAsNameCollisionKeepsBothImages(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "a", "shot.png"))
	var other bytes.Buffer
	png.Encode(&other, image.NewNRGBA(image.Rect(0, 0, 3, 3)))
	os.MkdirAll(filepath.Join(dir, "b"), 0755)
	os.WriteFile(filepath.Join(dir, "b", "shot.png"), other.Bytes(), 0644)
	p := filepath.Join(dir, "notes.md")
	os.WriteFile(p, []byte("![](a/shot.png)\n\n![](b/shot.png)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, filepath.Join(t.TempDir(), "out.md"))
	if err != nil {
		t.Fatal(err)
	}
	if r.Document.Content != "![](out.assets/shot.png)\n\n![](out.assets/shot-2.png)\n" {
		t.Fatalf("got %q", r.Document.Content)
	}
}

func TestSaveAsWithMissingImageStillSaves(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	p := filepath.Join(dir, "notes.md")
	os.WriteFile(p, []byte("![缺失](images/gone.png)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.SaveAs(s.Current.ID, filepath.Join(t.TempDir(), "copy.md"))
	if err != nil {
		t.Fatalf("missing image blocked save: %v", err)
	}
	if r.Document.Content != "![缺失](images/gone.png)\n" || len(r.Missing) != 1 {
		t.Fatalf("got %q missing=%v", r.Document.Content, r.Missing)
	}
}

func TestSaveAsDraftKeepsUnresolvableRelativeImages(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "![](images/a.png)\n")
	r, err := w.SaveAs(d.ID, filepath.Join(t.TempDir(), "draft.md"))
	if err != nil || r.Document.Content != "![](images/a.png)\n" {
		t.Fatalf("%q %v", r.Document.Content, err)
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go test -run 'SaveAsKeeps|SaveAsToAnother|SaveAsName|SaveAsWithMissing|SaveAsDraftKeeps' ./...` → FAIL.

- [ ] **Step 3: Implement** the rules table in `SaveAs`; keep the existing `liubai-asset:` path (digest names, `uid()` on collisions, cache copy, aliases) untouched. Frontend `saveAs` toast: append ` · N 张图片未找到，引用保持原样` when `r.missing?.length`.

- [ ] **Step 4: Run tests and checks** — base verification. The existing `TestSaveAsKeepsDestinationChangesAndUndoAssetsAcrossFolders` must still pass unchanged.

- [ ] **Step 5: Commit** — `fix(save-as): keep user image references and tolerate missing images`

---

### Task 5: 外部修改自动载入、按需备份、可覆盖磁盘、轻量状态轮询

Spec decisions 5 and 9. Today reopening a file that changed on disk shows the stale draft and a conflict even without local edits; 「查看磁盘版本」 always creates a recovery copy; a conflict cannot be resolved by keeping the local version; the frontend polls `State()` every 2 s, which reads and hashes the file and ships the whole document.

**Files:**
- Modify: `workspace.go` (`Document` fields, `check`, `Open`, `Activate`, `State`, `Reload`, `writeOriginal`, `Update`; new `Status`, `Overwrite`)
- Create: `fileid_unix.go` (`//go:build unix`) and `fileid_other.go` (`//go:build !unix`) for the inode helper
- Modify: `assets.go` (`SaveAs` records disk metadata), `main.go` (bindings + `/api`), `src/app.ts`, `src/index.html`, `src/types.ts`
- Test: `external_test.go` (new)

**Interfaces:**
- Produces: `Document` fields `DiskSize int64 \`json:"diskSize,omitempty"\``, `DiskModTime int64 \`json:"diskModTime,omitempty"\`` (UnixNano), `DiskInode uint64 \`json:"diskInode,omitempty"\``, set whenever `DiskHash` is set (Open, Reload, writeOriginal, SaveAs, Overwrite, auto-reload).
- Produces: `func fileIdentity(info os.FileInfo) uint64` (inode on unix, 0 elsewhere).
- Produces: `func (w *Workspace) check(d *Document, reload bool)` with this exact logic:
  1. No path → return.
  2. `os.Stat` fails → `Conflict = true`, `Status = "文件不可访问，草稿已保留"`, return.
  3. `DiskModTime != 0` and size, mod time and inode all equal the recorded ones and `!Conflict` → return without reading.
  4. Read (≤ `maxDocument`); failure → same as 2.
  5. `digest(bytes) == DiskHash` → record stat values; if `Conflict` was set, clear it and set `Status` to 「文件已保存」 when `digest(Content) == DiskContentHash`, else 「草稿已保存」; return.
  6. Disk changed and `reload` and `digest(Content) == DiskContentHash` → decode (failure → `Conflict`, `Status = "磁盘文件无法读取，草稿已保留"`), replace `Content`, `BOM`, `CRLF`, `DiskHash`, `DiskContentHash`, stat values, `ImageAliases = nil`, `Conflict = false`, `Revision++`, `Updated = now`, `Status = "已载入磁盘上的新版本"`, then `persist` (on persist error keep the reload in memory and set `Status = "已载入磁盘新版本，恢复记录更新失败"`).
  7. Otherwise → `Conflict = true`, `Status = "磁盘内容已变化，自动写入已暂停"`.
  `Open`, `Activate`, `State` and `Status` call `check(d, true)`; `Update` calls `check(d, false)` after applying the new content.
- Produces: `type DocStatus struct { ID string \`json:"id"\`; Revision int \`json:"revision"\`; Conflict bool \`json:"conflict"\`; Status string \`json:"status"\` }` and `func (w *Workspace) Status(id string) (DocStatus, error)` (unknown id → 「文稿不存在」).
- Produces: `func (w *Workspace) Overwrite(id string) (WorkspaceState, error)` — requires a path (「文稿没有对应文件」); if the disk file exists, decodes and differs from `DiskHash`, first stores it as a new draft titled `<title> · 磁盘版本`; then `materialize(d, d.Path, false)`, writes with `replaceFile` (or `atomicWrite` when the file is gone), records hashes and stat values, clears `Conflict`, `Status = "文件已保存"`, persists, returns `snapshot()`.
- Changes: `Reload` only creates the 「· 恢复副本」 draft when `digest(Content) != DiskContentHash`.
- Desktop bindings `Status(id string) (DocStatus, error)`, `Overwrite(id string) (WorkspaceState, error)`, both mirrored in `/api` (`"Status"`, `"Overwrite"` take one string argument).
- TS: `export interface DocStatus {id:string;revision:number;conflict:boolean;status:string}`.

- [ ] **Step 1: Write the failing tests** — `external_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openFile(t *testing.T, w *Workspace, name, content string) (string, Document) {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	return p, s.Current
}

func rewrite(t *testing.T, p, content string) {
	t.Helper()
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(2 * time.Second)
	os.Chtimes(p, later, later)
}

func TestReopenLoadsExternalChangesWhenDraftIsClean(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "README.md", "v1\n")
	rewrite(t, p, "v2 from git pull\n")
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if s.Current.ID != d.ID || s.Current.Content != "v2 from git pull\n" || s.Current.Conflict {
		t.Fatalf("got %+v", s.Current)
	}
	if s.Current.Revision <= d.Revision {
		t.Fatal("revision not bumped")
	}
	for _, r := range s.Recent {
		if strings.Contains(r.Title, "恢复副本") {
			t.Fatal("unexpected recovery copy")
		}
	}
}

func TestStatusReloadsCleanDocuments(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	rewrite(t, p, "two\n")
	st, err := w.Status(d.ID)
	if err != nil || st.Conflict || st.Revision == d.Revision {
		t.Fatalf("status %+v %v", st, err)
	}
	if got := w.State().Current.Content; got != "two\n" {
		t.Fatalf("content %q", got)
	}
}

func TestEditAfterExternalChangeIsAConflict(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	rewrite(t, p, "theirs\n")
	got, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "mine\n"})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Conflict {
		t.Fatal("conflict not detected")
	}
	if b, _ := os.ReadFile(p); string(b) != "theirs\n" {
		t.Fatal("external edit overwritten")
	}
	if st, _ := w.Status(d.ID); !st.Conflict {
		t.Fatal("status lost the conflict")
	}
	if got := w.State().Current.Content; got != "mine\n" {
		t.Fatalf("local edit replaced: %q", got)
	}
}

func TestReloadSkipsRecoveryCopyWhenDraftIsClean(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	before := len(w.State().Recent)
	rewrite(t, p, "two\n")
	s, err := w.Reload(d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Recent) != before || s.Current.Content != "two\n" {
		t.Fatalf("recent %d->%d content %q", before, len(s.Recent), s.Current.Content)
	}
}

func TestOverwriteKeepsDiskVersionAsRecoveryDraft(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	rewrite(t, p, "theirs\n")
	if got, _ := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: "mine\n"}); !got.Conflict {
		t.Fatal("expected conflict")
	}
	s, err := w.Overwrite(d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "mine\n" {
		t.Fatalf("disk %q", b)
	}
	if s.Current.Conflict {
		t.Fatal("conflict not cleared")
	}
	kept := false
	for _, r := range s.Recent {
		kept = kept || strings.HasSuffix(r.Title, " · 磁盘版本")
	}
	if !kept {
		t.Fatal("disk version not kept")
	}
	cur := s.Current
	if _, err := w.Update(Edit{ID: cur.ID, Revision: cur.Revision, Content: "mine 2\n"}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "mine 2\n" {
		t.Fatalf("autosave did not resume: %q", b)
	}
}

func TestStatusSkipsReadingWhenMetadataIsUnchanged(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	if err := os.Chmod(p, 0); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(p, 0644)
	if st, err := w.Status(d.ID); err != nil || st.Conflict {
		t.Fatalf("status read the file: %+v %v", st, err)
	}
}

func TestTouchedButUnchangedFileIsNotAConflict(t *testing.T) {
	w := workspace(t)
	p, d := openFile(t, w, "a.md", "one\n")
	later := time.Now().Add(3 * time.Second)
	os.Chtimes(p, later, later)
	if st, _ := w.Status(d.ID); st.Conflict || st.Revision != d.Revision {
		t.Fatalf("touch caused %+v", st)
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go test -run 'ReopenLoads|StatusReloads|EditAfterExternal|ReloadSkips|OverwriteKeeps|StatusSkips|TouchedBut' ./...` → FAIL.

- [ ] **Step 3: Implement the backend** per the Interfaces block. The existing `TestPreserveUneditedCRLFBOMAndConflict` (conflict + reload creating one recovery copy) must keep passing.

- [ ] **Step 4: Implement the frontend**
  - `src/index.html`: in `#banner` add `<button id="overwrite-disk" data-action="overwrite" hidden>用当前版本覆盖</button>` next to `#reload-disk`.
  - `banner()` shows `#overwrite-disk` together with `#reload-disk` for conflicts.
  - `action('overwrite')`: `await run(async()=>{if(!await saveForAction())return;load(await call<WorkspaceState>('Overwrite',doc.id));toast('已用当前版本覆盖磁盘文件；原磁盘内容另存为「'+doc.title+' · 磁盘版本」')})` — capture the title before `load`.
  - Replace the `setInterval(... call('State') ...)` block with:

```ts
async function pollStatus(){
 if(!doc||busy||dirty||saveFlight||compositionActive||document.visibilityState!=='visible')return;
 const id=doc.id;let s:DocStatus;try{s=await call<DocStatus>('Status',id)}catch{return}
 if(!doc||doc.id!==id||dirty||busy||saveFlight)return;
 if(s.revision!==doc.revision){await run(async()=>{load(await call<WorkspaceState>('Activate',id));toast('已载入磁盘上的新版本')});return}
 if(s.conflict!==doc.conflict||s.status!==doc.status){doc.conflict=s.conflict;doc.status=s.status;header();if(s.conflict||s.status.includes('失败'))banner(s.status,s.conflict);else banner()}
}
setInterval(()=>void pollStatus(),2000);
document.addEventListener('visibilitychange',()=>void pollStatus());
window.addEventListener('focus',()=>void pollStatus());
```

- [ ] **Step 5: Run tests and checks** — base verification plus `node scripts/build.mjs`. Expected: PASS.

- [ ] **Step 6: Commit** — `feat(sync): reload clean files from disk and resolve conflicts explicitly`

---

### Task 6: 退出、关窗、关机只在确有未保存内容时拦截

Spec decision 6. Today `OnBeforeQuit` and the window `OnClose` always cancel and round-trip through the page, so macOS logout/restart/shutdown is cancelled by 留白 every time; quitting with a conflicted file shows a misleading 「放弃未保存修改并退出」 dialog although the draft is saved.

**Files:**
- Modify: `main.go` (`Desktop.pending`, `SetPending`, quit/close handlers, menu quit item, `/api`)
- Modify: `src/app.ts` (`syncPending`, `closeApp`), `src/index.html` (close dialog copy)
- Test: `quit_test.go` (new)

**Interfaces:**
- Produces: `func (d *Desktop) SetPending(pending bool)` (stores an `atomic.Bool`); `/api` `"SetPending"` decodes one bool and returns nothing.
- Produces: `func quitAllowed(allowClose, pending bool) bool { return allowClose || !pending }`, used by both `OnBeforeQuit` and `OnClose`: when allowed, the close/quit proceeds (`OnClose` also sets `allowClose`); otherwise `PreventDefault()` + `requestClose()` exactly as today.
- Menu: 「退出留白」 becomes `{Role: mygo.RoleQuit, Label: "退出留白"}`; the existing `close` action stays for the page (`requestClose`).
- TS: `let pendingSent=false;function syncPending(){const pending=dirty||compositionActive||busy||!!saveFlight;if(pending===pendingSent||!desktop)return;pendingSent=pending;void call('SetPending',pending).catch(()=>{pendingSent=!pending})}` called at the end of `changed`, `composition`, `setBusy` and after every `save()` settles (success or failure).
- `closeApp`: show `close-dialog` only when `!ok||dirty` (drop the `doc.conflict` and `status.includes('失败')` conditions — the draft is safe in those cases).
- `src/index.html` close dialog paragraph: 「最新修改还没有保存到草稿，当前内容仍在编辑器里。」 (buttons unchanged).

- [ ] **Step 1: Write the failing test** — `quit_test.go`:

```go
package main

import "testing"

func TestQuitAllowedOnlyWithoutPendingInput(t *testing.T) {
	for _, c := range []struct{ allow, pending, want bool }{
		{false, false, true},
		{false, true, false},
		{true, true, true},
	} {
		if got := quitAllowed(c.allow, c.pending); got != c.want {
			t.Fatalf("quitAllowed(%v,%v)=%v", c.allow, c.pending, got)
		}
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go test -run QuitAllowed ./...` → FAIL (undefined).

- [ ] **Step 3: Implement** per the Interfaces block.

- [ ] **Step 4: Run tests and checks** — base verification plus `node scripts/build.mjs`.

- [ ] **Step 5: Commit** — `fix(quit): stop cancelling quit and shutdown when nothing is pending`

---
## Workstream B — 性能

### Task 7: 即时排版只计算可视区

Spec decision 7. `richExtensions` rebuilds every decoration for the whole document on every transaction (≈12 ms at 20k chars, ≈40 ms at 100k, ≈110 ms at 300k on JavaScriptCore) and calls markdown-it for every link and image.

**Files:**
- Modify: `src/editor.ts`, `src/style.css` (focus mode selector)
- Modify: `scripts/check-rendering.ts`
- Create: `scripts/check-performance.ts`

**Interfaces:**
- Produces: `export function blockDecorations(state:EditorState,resolve:(dest:string)=>Promise<string>,editTable?:()=>void):DecorationSet` — block widgets only (tables; images alone on their line), walking block nodes only: descend into `Document`, `BulletList`, `OrderedList`, `ListItem`, `Blockquote`; handle `Table` and `Paragraph`; return `false` for everything else.
- Produces: `export function createBlockField(resolve,editTable?):StateField<DecorationSet>` — `update`: map during composition; return the old value when the transaction changes neither doc, selection nor syntax tree; otherwise `blockDecorations(tr.state,…)`. Provides `EditorView.decorations`.
- Produces: `export function inlineDecorations(state:EditorState,ranges:readonly {from:number;to:number}[]):DecorationSet` — line classes (`md-heading md-hN`, `md-quote`, `md-code-line`), `md-link` marks with `data-href` and title 「⌘ / Ctrl 点击打开链接」, `md-inline-code` marks, hidden `HeaderMark/EmphasisMark/CodeMark/QuoteMark/StrikethroughMark` and link `LinkMark/URL/LinkTitle` on lines without a selection, `TaskWidget` for untouched task markers. Skips nodes inside untouched `Table`s and untouched image-only paragraphs (the block field renders those). Only nodes overlapping the given ranges are visited.
- Produces: `export function richExtensions(resolve,editTable?):Extension` returning `[createBlockField(resolve,editTable), inlinePlugin]`, where `inlinePlugin` is a `ViewPlugin` that computes `inlineDecorations(view.state, view.visibleRanges)` and recomputes on `docChanged || viewportChanged || selectionSet || syntaxTree(startState)!==syntaxTree(state)`; while `composing` is true it maps the old set through the changes.
- Link `data-href` and image `dest` come from the lezer `URL` child: strip surrounding `<…>` and backslash escapes (`/\\([!-/:-@[-`{-~])/g` → `$1`). Image `alt` is the text between `![` and `]`. No `md.parseInline` on these paths; `md` remains only for `TableWidget.toDOM`.
- Focus mode: keep `focusField`/`setFocus`; decorate only the active block's lines with `focus-active` (same active-block rule as today: the top-level block containing the cursor, else the cursor line); while composing, map the previous set instead of dropping it; add the editor class `cm-focus-on` when focus is on (`EditorView.editorAttributes`). CSS: replace `.focus-mode .cm-line.focus-dim,.focus-mode .cm-line.focus-dim span{…}` with `.focus-mode .cm-focus-on .cm-line:not(.focus-active),.focus-mode .cm-focus-on .cm-line:not(.focus-active) span{…}` (same declarations). Remove the `focus-dim` class.

- [ ] **Step 1: Write the performance check** — `scripts/check-performance.ts`:

```ts
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {createBlockField,inlineDecorations,composing} from '../src/editor';

const block='这是一段普通的中文正文，用来模拟长篇写作。偶尔会有**加粗**、一个[链接](https://example.com/a)和`代码`。\n\n'
 +'另一段没有任何格式的正文内容，写作者在这里连续地输入文字，句子很长很长。\n\n'.repeat(3)
 +'## 一个小标题\n\n- 列表项一\n- [ ] 待办\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n![图](images/a.png)\n\n';
for(const [size,budget] of [[100_000,5],[300_000,12]] as const){
 const doc=block.repeat(Math.ceil(size/block.length));
 const field=createBlockField(async()=>'data:,');
 let state=EditorState.create({doc,extensions:[markdown({base:markdownLanguage,extensions:GFM}),composing,field]});
 ensureSyntaxTree(state,state.doc.length,60_000);
 const middle=()=>Math.floor(state.doc.length/2);
 for(let i=0;i<5;i++)state=state.update({changes:{from:middle(),insert:'字'}}).state;
 const N=20;let t=performance.now();
 for(let i=0;i<N;i++){const at=middle();state=state.update({changes:{from:at,insert:'字'},selection:{anchor:at+1}}).state}
 const keystroke=(performance.now()-t)/N;
 const from=Math.max(0,middle()-3000),to=Math.min(state.doc.length,middle()+3000);
 t=performance.now();for(let i=0;i<N;i++)inlineDecorations(state,[{from,to}]);
 const inline=(performance.now()-t)/N;
 console.log(`${size/10000} 万字：每键块级更新 ${keystroke.toFixed(2)} ms，可视区行内装饰 ${inline.toFixed(2)} ms`);
 assert.ok(keystroke+inline<budget,`${size/10000} 万字超过 ${budget} ms 预算`);
}
console.log('即时排版性能预算检查通过');
```

- [ ] **Step 2: Update `scripts/check-rendering.ts`** to the new API, keeping its existing assertions:

```ts
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {createBlockField,inlineDecorations,composing,setComposing} from '../src/editor';
const field=createBlockField(async()=> 'data:image/png;base64,');
let state=EditorState.create({doc:'# 标题\n\n正文 [链接](https://example.com)\n\n- [ ] 待办\n\n| 项目 | 说明 |\n| --- | --- |\n| 甲 | 乙 |\n\n![图](<图片 目录/a.png>)\n',extensions:[markdown({base:markdownLanguage,extensions:GFM}),composing,field]});
ensureSyntaxTree(state,state.doc.length,5000);
const collect=(set:any)=>{const out:any[]=[];set.between(0,state.doc.length,(from:number,to:number,value:any)=>{out.push({from,to,value})});return out};
const blocks=collect(state.field(field)),inline=collect(inlineDecorations(state,[{from:0,to:state.doc.length}]));
assert.ok(blocks.some(x=>x.value.spec.widget?.constructor.name==='TableWidget'));
assert.ok(blocks.some(x=>x.value.spec.widget?.constructor.name==='ImageWidget'&&x.value.spec.widget.dest==='图片 目录/a.png'));
assert.ok(inline.some(x=>x.value.spec.widget?.constructor.name==='TaskWidget'));
assert.ok(inline.some(x=>x.value.spec.attributes?.['data-href']==='https://example.com'));
state=state.update({effects:setComposing.of(true)}).state;
assert.equal(state.field(composing),true);
state=state.update({changes:{from:state.doc.length,insert:'拼'}}).state;
assert.equal(state.field(composing),true);assert.ok(state.doc.toString().endsWith('拼'));
state=state.update({effects:setComposing.of(false)}).state;assert.equal(state.field(composing),false);
console.log('任务与表格装饰、中文组合输入期间保留文本和暂停排版检查通过');
```

- [ ] **Step 3: Run to verify they fail** — `bun scripts/check-rendering.ts; bun scripts/check-performance.ts` → FAIL (exports missing).

- [ ] **Step 4: Implement** per the Interfaces block.

- [ ] **Step 5: Run checks** — base verification plus `bun scripts/check-performance.ts` and `node scripts/build.mjs`. Expected: PASS; the performance line for 10 万字 under 5 ms.

- [ ] **Step 6: Commit** — `perf(editor): decorate only visible ranges and walk block nodes for widgets`

---

### Task 8: 光标与滚动只记位置，保存少写一次，摘要与字数轻量化

Spec decisions 8, 10 and the summary part of 9. Moving the cursor or scrolling resends the whole document and rewrites the full draft JSON with fsync; a file-backed save does three atomic writes; every `snapshot()` re-derives excerpts from the full text of every draft; the header recounts words over the whole document on every keystroke and counts Markdown syntax and URLs.

**Files:**
- Create: `summary.go` (move `inferredTitle` here), `summary_test.go`, `positions_test.go`, `src/stats.ts`
- Modify: `workspace.go` (`Update`, `snapshot`, `openWorkspace`, new `SavePosition`, `Flush`, positions file), `main.go` (binding, `/api`, flush on quit), `src/app.ts`, `scripts/check-editing.ts`

**Interfaces:**
- Produces: `func (w *Workspace) SavePosition(id string, p Position) error` — clamps like `Update` (anchor/head to the UTF-16 length, finite non-negative scroll), stores it on the document and in `w.positions`, writes `positions.json` with `writeQuick` (temp file + rename, no fsync). Never touches the draft JSON or the disk file. Desktop binding `SavePosition(id string, p Position) error`; `/api` `"SavePosition"` decodes `(string, Position)`.
- Produces: `func writeQuick(path string, data []byte, mode os.FileMode) error` and `func (w *Workspace) Flush() error` (writes `positions.json` when dirty; `main.go` calls it from `OnWillQuit`).
- `openWorkspace` loads `positions.json` (ignore if missing or unparsable) and applies entries to loaded documents.
- `Update` behaviour:
  1. Revision, size and UTF-8 checks as today; clamp the position.
  2. Content unchanged and (no path, or `digest(Content)==DiskContentHash` and `!Conflict`) → same as `SavePosition`; return the document with its revision unchanged and no draft write.
  3. Otherwise apply content, `Revision++`, `Updated`, title (drafts without custom title) and `Excerpt`; for file-backed documents run `check(d,false)`, then (when not conflicted) materialize and `writeOriginal` exactly as today; finally `persist(d)` once. A failed `persist` for a draft without a successful file write restores the previous state and returns the error (as today); a failed `persist` after a successful file write keeps `Status = "文件已保存，恢复记录更新失败"` and returns no error.
- Produces (`summary.go`): `func frontMatterEnd(s string) int` (byte offset after a leading `---` … `---`/`...` block within the first 200 lines, else 0), `func inferredTitle(s string) string`, `func excerptOf(s string) string` (skip front matter, look at most at the first 4096 bytes on a rune boundary, collapse whitespace, first 90 runes). `Document.Excerpt string \`json:"excerpt,omitempty"\`` is set whenever content changes and filled lazily in `snapshot()` when empty.
- `inferredTitle` rules: a front matter `title:` value (quotes trimmed) wins; otherwise skip front matter, fenced code blocks, blank lines, HTML comment lines, lines that are only an image, horizontal rules and table delimiter rows; on the first remaining line strip heading `#`s, `>` quote markers, list markers, task boxes, replace `![alt](…)` with nothing and `[text](…)` with `text`, remove `**`, `__`, `` ` `` and `~~`; cap at 42 runes plus 「…」; fallback 「未命名文稿」.
- Produces (TS, `src/stats.ts`): `export function countWords(markdown:string):number` — remove front matter and fence delimiter lines, images, link destinations (keep link text), reference definitions, HTML tags/comments, bare URLs, Markdown markers (`#>*_~\`|`, list markers, task boxes, table delimiter rows); count each Han/Hiragana/Katakana/Hangul character as one and every other run of letters/digits (with inner apostrophes) as one word.
- TS: `save()` sends `SavePosition` instead of `Update` when nothing is dirty and only the position changed (failures are ignored); `header()` no longer counts words; `scheduleWordCount()` updates `#word-count` 400 ms after the last content change and immediately in `load()`.

- [ ] **Step 1: Write the failing Go tests**

`summary_test.go`:

```go
package main

import (
	"strings"
	"testing"
)

func TestInferredTitle(t *testing.T) {
	for in, want := range map[string]string{
		"---\ntitle: \"周报 42\"\ntags: [a]\n---\n\n# 本周进展\n": "周报 42",
		"---\nlayout: post\n---\n\n# 本周进展\n":              "本周进展",
		"```go\nfunc main(){}\n```\n\n## 代码之后\n":           "代码之后",
		"![封面](a.png)\n\n**第一句**正文":                       "第一句正文",
		"- [ ] [留白](https://example.com) 的待办\n":           "留白 的待办",
		"<!-- 注释 -->\n\n> 引用开头\n":                         "引用开头",
		"\n\n   \n":                                           "未命名文稿",
	} {
		if got := inferredTitle(in); got != want {
			t.Errorf("inferredTitle(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExcerptSkipsFrontMatterAndReadsOnlyThePrefix(t *testing.T) {
	content := "---\ntitle: x\n---\n\n# 标题\n\n正文  第一段\n" + strings.Repeat("填充", 1<<19)
	got := excerptOf(content)
	if !strings.HasPrefix(got, "# 标题 正文 第一段") || len([]rune(got)) > 90 {
		t.Fatalf("%q", got)
	}
}
```

`positions_test.go`:

```go
package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestPositionOnlyChangesDoNotRewriteTheDraft(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "正文\n")
	draft := filepath.Join(w.root, "drafts", d.ID+".json")
	before, _ := os.ReadFile(draft)
	if err := w.SavePosition(d.ID, Position{Anchor: 1, Head: 2, Scroll: 300}); err != nil {
		t.Fatal(err)
	}
	got, err := w.Update(Edit{ID: d.ID, Revision: d.Revision, Content: d.Content, Position: Position{Anchor: 2, Head: 2, Scroll: 400}})
	if err != nil || got.Revision != d.Revision {
		t.Fatalf("%+v %v", got, err)
	}
	if after, _ := os.ReadFile(draft); !bytes.Equal(before, after) {
		t.Fatal("draft rewritten for a position change")
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if p := reopened.State().Current.Position; p.Scroll != 400 || p.Head != 2 {
		t.Fatalf("position not restored: %+v", p)
	}
}
```

- [ ] **Step 2: Write the failing TS checks** — append to `scripts/check-editing.ts`:

```ts
const {countWords}=await import('../src/stats');
assert.equal(countWords("# 标题\n\n这是**加粗**和[链接](https://example.com/a)。Hello world, it's 2026."),13);
assert.equal(countWords('---\ntitle: 不计\n---\n\n正文'),2);
assert.equal(countWords('![图片说明](a.png)\n\n<span>内联</span>'),2);
assert.equal(countWords('```js\nconst a = 1\n```'),3);
assert.equal(countWords('- [x] 完成 https://example.com/x'),2);
console.log('字数统计检查通过');
```

- [ ] **Step 3: Run to verify they fail** — `go test -run 'InferredTitle|ExcerptSkips|PositionOnly' ./...` and `bun scripts/check-editing.ts` → FAIL.

- [ ] **Step 4: Implement** per the Interfaces block. Existing tests (`TestDiskSaveRetryAndMixedLineEndings`, `TestFailedDraftWriteCanRetryWithoutLosingRevision`, `TestPreviewAppearanceDefaultsAndLegacyPosition`) must keep passing unchanged.

- [ ] **Step 5: Run checks** — base verification, `bun scripts/check-performance.ts`, `node scripts/build.mjs`.

- [ ] **Step 6: Commit** — `perf(storage): save positions separately and derive summaries cheaply`

---

### Task 9: 最近文稿可移除，空草稿自动清理

Spec decision 11. Drafts are never deleted; every ⌘N empty draft, every opened file and every recovery copy stays in 「最近文稿」 and in memory forever.

**Files:**
- Modify: `workspace.go` (new `Delete`, trash helpers, cleanup in `openWorkspace`/`New`/`Activate`/`Open`), `main.go` (binding, `/api`)
- Modify: `src/app.ts` (recent rows, command), `src/style.css`, `src/index.html` (none or minimal)
- Modify: `workspace_test.go` (`TestPreserveUneditedCRLFBOMAndConflict` now expects 2 recent entries: the initial empty draft is cleaned when the file opens — add a comment saying so)
- Test: `trash_test.go` (new)

**Interfaces:**
- Produces: `func (w *Workspace) Delete(id string) (WorkspaceState, error)` — moves `drafts/<id>.json` to `trash/<20060102-150405>-<id>/draft.json` and `assets/<id>/` to `trash/<…>-<id>/assets/` (when present), drops the document and its position, and when it was current switches to the most recently updated remaining document or creates an empty draft. Never touches the user's file for file-backed documents. Unknown id → 「文稿不存在」. Desktop binding `Delete(id string) (WorkspaceState, error)`; `/api` `"Delete"` takes one string.
- Produces: `func disposable(d *Document) bool { return d.Path == "" && !d.CustomTitle && strings.TrimSpace(d.Content) == "" }`. When `New`, `Activate` or `Open` switches away from a disposable current document, that document is moved to trash. `openWorkspace` moves disposable non-current drafts to trash and deletes `trash/` entries whose modification time is older than 30 days.
- UI: each recent entry becomes `<div class="recent-row"><button class="recent-item">…</button><button class="recent-remove" aria-label="从最近文稿移除" title="从最近文稿移除">×</button></div>` (`.recent-item` markup and click behaviour unchanged). The first click on `.recent-remove` turns it into 「确认移除」 for 3 s; the second click calls `Delete` (via `run`, after `saveForAction()` when removing the current document), updates `state`, reloads the editor when the current document changed, re-renders the drawer and toasts 「已移除，草稿在废纸篓目录保留 30 天」 for drafts or 「已从最近文稿移除，磁盘文件未改动」 for files. Add the command `['remove','从最近文稿移除当前文稿','']`: the first invocation toasts 「3 秒内再选一次以确认移除」 and arms; a second invocation within 3 s removes the current document. Do not use `window.confirm` (WKWebView may not show it).

- [ ] **Step 1: Write the failing tests** — `trash_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDeleteMovesDraftToTrashAndSwitchesCurrent(t *testing.T) {
	w := workspace(t)
	first := edit(t, w, "第一篇\n")
	if _, err := w.New(); err != nil {
		t.Fatal(err)
	}
	second := edit(t, w, "第二篇\n")
	s, err := w.Delete(second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s.Current.ID != first.ID {
		t.Fatalf("current %s, want %s", s.Current.ID, first.ID)
	}
	for _, r := range s.Recent {
		if r.ID == second.ID {
			t.Fatal("deleted draft still listed")
		}
	}
	if _, err := os.Stat(filepath.Join(w.root, "drafts", second.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("draft file left behind")
	}
	if m, _ := filepath.Glob(filepath.Join(w.root, "trash", "*-"+second.ID, "draft.json")); len(m) != 1 {
		t.Fatal("draft not in trash")
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range reopened.State().Recent {
		if r.ID == second.ID {
			t.Fatal("deleted draft came back")
		}
	}
}

func TestDeleteFileBackedDocumentKeepsTheFile(t *testing.T) {
	w := workspace(t)
	p := filepath.Join(t.TempDir(), "keep.md")
	os.WriteFile(p, []byte("磁盘内容\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Delete(s.Current.ID); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(p); err != nil || string(b) != "磁盘内容\n" {
		t.Fatalf("file touched: %q %v", b, err)
	}
}

func TestDeletingTheLastDocumentCreatesAnEmptyDraft(t *testing.T) {
	w := workspace(t)
	d := edit(t, w, "唯一一篇\n")
	s, err := w.Delete(d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s.Current.ID == d.ID || s.Current.Content != "" || len(s.Recent) != 1 {
		t.Fatalf("got %+v", s)
	}
}

func TestEmptyUntitledDraftsAreCleanedWhenSwitching(t *testing.T) {
	w := workspace(t)
	empty := w.State().Current
	s, err := w.New()
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range s.Recent {
		if r.ID == empty.ID {
			t.Fatal("empty draft kept after New")
		}
	}
	edit(t, w, "有内容\n")
	if s, _ = w.New(); len(s.Recent) != 2 {
		t.Fatalf("recent=%d, want the written draft and the new one", len(s.Recent))
	}
}

func TestOldTrashIsPurgedOnStartup(t *testing.T) {
	root := t.TempDir()
	if _, err := openWorkspace(root); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(root, "trash", "20200101-000000-"+strings.Repeat("ab", 12))
	os.MkdirAll(old, 0700)
	past := time.Now().AddDate(0, 0, -31)
	os.Chtimes(old, past, past)
	if _, err := openWorkspace(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("old trash not purged")
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go test -run 'DeleteMoves|DeleteFileBacked|DeletingTheLast|EmptyUntitled|OldTrash' ./...` → FAIL.

- [ ] **Step 3: Implement** per the Interfaces block (backend, binding, `/api`, UI, styles: `.recent-row` is a two-column flex row; `.recent-remove` is a quiet 28 px icon button that becomes visible on row hover/focus and is always visible for keyboard focus).

- [ ] **Step 4: Run checks** — base verification and `node scripts/build.mjs`.

- [ ] **Step 5: Commit** — `feat(drafts): remove documents from recents and clean empty drafts`

---
## Workstream C — 体验

### Task 10: 菜单中文化与补齐、输入框撤销、本地化显示名、HTML 保存对话框

Spec decision 12. Role menu items show English labels (Cut/Copy/Paste/Select All); Hide/Minimize/Zoom/Full Screen/Close Window are missing; the custom 撤销/重做 items undo the document even when a dialog input has focus; the bundle declares no localization so Finder/Dock/Spotlight show "Liubai"; 「下载 HTML」 silently writes to ~/Downloads in the desktop app.

**Files:**
- Modify: `main.go` (extract `menuTemplate`, new `SaveHTML`, default file names), `mygo.json` (`macos.infoPlist`)
- Create: `resources/zh-Hans.lproj/InfoPlist.strings`, `resources/en.lproj/InfoPlist.strings`
- Modify: `src/app.ts` (undo/redo in inputs, HTML save)
- Test: `menu_test.go` (new)

**Interfaces:**
- Produces: `func menuTemplate(action func(string) func(*mygo.MenuItem, *mygo.Window)) []*mygo.MenuItem`; `main` calls `mygo.App.SetMenu(mygo.NewMenu(menuTemplate(action)))`. Layout (labels exact):
  - 留白: 关于留白 (existing click) · — · 隐藏留白 `RoleHide` · 隐藏其他 `RoleHideOthers` · 全部显示 `RoleUnhide` · — · 退出留白 `RoleQuit` (from Task 6)
  - 文件: 新建文稿 ⌘N · 打开文稿… ⌘O · — · 保存 ⌘S · 另存为… ⇧⌘S · — · 带走文稿… · 导出 PDF… ⌘P · — · 关闭窗口 `RoleClose`
  - 编辑: 撤销 ⌘Z (action `undo`) · 重做 ⇧⌘Z (action `redo`) · — · 剪切 `RoleCut` · 拷贝 `RoleCopy` · 粘贴 `RolePaste` · 全选 `RoleSelectAll` · — · 查找 ⌘F
  - 显示: existing items in the same order · — · 切换全屏 `RoleToggleFullScreen`
  - 窗口: 最小化 `RoleMinimize` · 缩放 `RoleZoom` · — · 前置全部窗口 `RoleFront`
- Produces: `func (d *Desktop) SaveHTML(ctx context.Context, title, html string) (ExportResult, error)` — rejects `len(html) > 64<<20` with 「HTML 过大，请使用 ZIP 带走文稿」; save dialog titled 「保存 HTML」 with `DefaultPath: documentFilename(title, ".html")` and an HTML filter; cancelled → `ExportResult{Cancelled: true}`; writes with `atomicWrite(path, []byte(html), 0644)`. Not exposed in `/api` (the browser keeps downloading).
- `SaveAs` dialog default name becomes `documentFilename(title, ".md")`; `Export` dialog default becomes `documentFilename(<document title>, ".zip")` (look the title up by id).
- `mygo.json` gains `"infoPlist": {"CFBundleDevelopmentRegion": "zh-Hans", "CFBundleLocalizations": ["zh-Hans", "en"], "LSHasLocalizedDisplayName": true, "LSApplicationCategoryType": "public.app-category.productivity"}` inside `macos`.
- `resources/zh-Hans.lproj/InfoPlist.strings` (UTF-8): `"CFBundleDisplayName" = "留白";` and `"CFBundleName" = "留白";`; `resources/en.lproj/InfoPlist.strings`: the same keys with `"Liubai"`.
- TS: at the top of `action()`: `if(id==='undo'||id==='redo'){const el=document.activeElement;if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){document.execCommand(id);return}}` (the existing editor undo/redo branch stays below). The ready-dialog `html` branch: desktop → `void run(async()=>{const r=await call<ExportResult>('SaveHTML',doc.title,html);if(!r.cancelled)toast('HTML 已保存：'+r.path)})`; browser → existing `download(...)`.

- [ ] **Step 1: Write the failing test** — `menu_test.go`:

```go
package main

import (
	"testing"

	"github.com/egoist/mygo"
)

func TestMenuTemplateUsesChineseLabelsAndStandardItems(t *testing.T) {
	items := menuTemplate(func(string) func(*mygo.MenuItem, *mygo.Window) { return nil })
	labels := map[mygo.MenuRole]string{}
	var walk func([]*mygo.MenuItem)
	walk = func(list []*mygo.MenuItem) {
		for _, it := range list {
			if it == nil {
				continue
			}
			if it.Role != "" {
				labels[it.Role] = it.Label
			}
			walk(it.Submenu)
		}
	}
	walk(items)
	for role, want := range map[mygo.MenuRole]string{
		mygo.RoleCut: "剪切", mygo.RoleCopy: "拷贝", mygo.RolePaste: "粘贴", mygo.RoleSelectAll: "全选",
		mygo.RoleHide: "隐藏留白", mygo.RoleHideOthers: "隐藏其他", mygo.RoleUnhide: "全部显示", mygo.RoleQuit: "退出留白",
		mygo.RoleMinimize: "最小化", mygo.RoleZoom: "缩放", mygo.RoleFront: "前置全部窗口",
		mygo.RoleToggleFullScreen: "切换全屏", mygo.RoleClose: "关闭窗口",
	} {
		if labels[role] != want {
			t.Errorf("%s label %q, want %q", role, labels[role], want)
		}
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go test -run MenuTemplate ./...` → FAIL (undefined).

- [ ] **Step 3: Implement** per the Interfaces block.

- [ ] **Step 4: Verify the bundle (orchestrator may run this if the sandbox blocks codesign)**

```sh
go tool mygo build -sign - -skip-dmg -skip-notarize -platform darwin/arm64 -o /tmp/liubai-bundle-check .
plutil -p /tmp/liubai-bundle-check/darwin-arm64/Liubai.app/Contents/Info.plist
ls /tmp/liubai-bundle-check/darwin-arm64/Liubai.app/Contents/Resources/zh-Hans.lproj
```
Expected: `CFBundleDevelopmentRegion => "zh-Hans"`, `LSHasLocalizedDisplayName => true`, and `InfoPlist.strings` present. (Adjust the `darwin-arm64` folder name to what `mygo build` prints.)

- [ ] **Step 5: Run checks** — base verification and `node scripts/build.mjs`.

- [ ] **Step 6: Commit** — `feat(macos): localized menus, standard window items and HTML save dialog`

---

## Workstream D — 阅读器 P0

### Task 11: 打开入口——文件关联、拖入打开、相对链接

Spec decision 15. `mygo.json` declares no file types, so `OnOpenFile` is unreachable from Finder; dropping a `.md` file onto the editor inserts its text into the current document (CodeMirror's default); relative `.md` links only toast 「不支持打开此类链接」.

**Files:**
- Modify: `mygo.json` (`fileAssociations`), `main.go` (`OnFileDrop`, `OpenLinked` binding, `/api`), `workspace.go` (`OpenLinked`)
- Modify: `src/editing.ts` (`localDocumentLink`), `src/editor.ts` (drop and ⌘-click), `src/app.ts` (`openLink`, drop import in the browser), `src/preview.ts` (fragment targets by id)
- Test: `links_test.go` (new), `scripts/check-editing.ts`

**Interfaces:**
- `mygo.json`: `"fileAssociations": [{"ext": ["md", "markdown", "mdown", "mkd"], "name": "Markdown 文稿", "mimeType": "text/markdown", "role": "Editor"}]`.
- Produces: `func markdownPath(path string) bool` — extension (case-insensitive) in `.md .markdown .mdown .mkd .txt`.
- Produces: `func (w *Workspace) OpenLinked(fromID, href string) (WorkspaceState, error)` — the source document must have a path (else 「草稿还没有保存位置，无法打开相对链接」); parse `href` with `url.Parse`; reject a scheme, a host or an empty path (「不支持的链接」); `url.PathUnescape` the path, join relative paths with the source directory, require `markdownPath` (「只能打开 Markdown 文稿链接」) and an existing regular file (「链接的文稿不存在」); then return `w.Open(path)` (call it without holding `w.mu`). Desktop binding `OpenLinked(id, href string) (WorkspaceState, error)`; `/api` `"OpenLinked"` takes two strings.
- Desktop: `d.win.OnFileDrop(func(e *mygo.FileDropEvent){…})` collects `markdownPath` entries and, in a goroutine, calls `d.openPath` (Task 2) for each from last to first so the first dropped file ends up active. Non-markdown, non-image drops: broadcast `openFailed` with 「仅支持打开 Markdown 文稿」 (images keep their in-editor behaviour).
- Produces (TS): `export function localDocumentLink(href:string):{path:string;fragment:string}|null` — `null` for `#…`, `//…`, any `scheme:`; otherwise split off `?…`/`#…`, decode the path with `decodeURIComponent` (keep it raw on failure) and accept when it ends with `.md .markdown .mdown .mkd .txt` (case-insensitive); `fragment` is the decoded text after `#` (empty when absent); `path` is the original undecoded path part.
- TS `openLink(url)`: when `localDocumentLink(url)` matches → `run(async()=>{if(!await saveForAction())return;load(await call<WorkspaceState>('OpenLinked',doc.id,url));if(fragment)jump to the heading whose slug or text equals fragment (reuse the existing '#' logic as a helper `jumpToHeading`)})`. The editor's ⌘-click accepts `safeLink(href)||localDocumentLink(href)`.
- Editor drop handler: files whose names pass the markdown test are handled before CodeMirror: `preventDefault`, return `true`, and call a new `onOpenFiles(files:File[])` callback (added as the last parameter of `createEditor`). In the app: desktop does nothing more (Go opens them); the browser imports the first one exactly like `#open-input` (extract that code into `importFile(file:File)`). In the browser also prevent the window's default for file drops outside the editor (`dragover`/`drop` listeners on `window` when `!desktop`).
- `src/preview.ts` click handler: for `#…` links look up `document.getElementById`-style ids inside the preview host first (footnotes in Task 12 rely on it), then headings by text as today.

- [ ] **Step 1: Write the failing tests**

`links_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenLinkedResolvesRelativeMarkdownLinks(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "docs"), 0755)
	os.WriteFile(filepath.Join(dir, "docs", "安装 指南.md"), []byte("# 安装\n"), 0644)
	os.WriteFile(filepath.Join(dir, "secret.png"), tinyPNG(), 0644)
	p := filepath.Join(dir, "README.md")
	os.WriteFile(p, []byte("[安装](docs/安装%20指南.md#安装)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, href := range []string{"docs/安装%20指南.md#安装", "./docs/安装 指南.md", "docs/%E5%AE%89%E8%A3%85%20%E6%8C%87%E5%8D%97.md"} {
		got, err := w.OpenLinked(s.Current.ID, href)
		if err != nil || filepath.Base(got.Current.Path) != "安装 指南.md" {
			t.Fatalf("%q: %q %v", href, got.Current.Path, err)
		}
	}
	for _, href := range []string{"secret.png", "https://example.com/a.md", "missing.md", "//host/a.md"} {
		if _, err := w.OpenLinked(s.Current.ID, href); err == nil {
			t.Fatalf("%q accepted", href)
		}
	}
	n, err := w.New()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.OpenLinked(n.Current.ID, "a.md"); err == nil || !strings.Contains(err.Error(), "草稿") {
		t.Fatalf("draft link: %v", err)
	}
}
```

Append to `scripts/check-editing.ts`:

```ts
const {localDocumentLink}=await import('../src/editing');
assert.deepEqual(localDocumentLink('docs/guide.md#安装'),{path:'docs/guide.md',fragment:'安装'});
assert.deepEqual(localDocumentLink('docs/%E5%AE%89%E8%A3%85.md#%E5%AE%89%E8%A3%85'),{path:'docs/%E5%AE%89%E8%A3%85.md',fragment:'安装'});
assert.deepEqual(localDocumentLink('./a b.markdown'),{path:'./a b.markdown',fragment:''});
for(const href of ['https://example.com/a.md','#标题','images/a.png','mailto:a@b.c','//cdn.example.com/a.md'])assert.equal(localDocumentLink(href),null,href);
console.log('相对文稿链接识别检查通过');
```

- [ ] **Step 2: Run to verify they fail** — `go test -run OpenLinked ./...`; `bun scripts/check-editing.ts` → FAIL.

- [ ] **Step 3: Implement** per the Interfaces block.

- [ ] **Step 4: Verify the bundle declares the file types** — rerun the Task 10 Step 4 build and check `CFBundleDocumentTypes` lists `md`, `markdown`, `mdown`, `mkd`.

- [ ] **Step 5: Run checks** — base verification and `node scripts/build.mjs`.

- [ ] **Step 6: Commit** — `feat(reader): open Markdown from Finder, drops and relative links`

---

### Task 12: 阅读渲染——front matter、安全 HTML、自动链接、脚注、提示块

Spec decision 13. The shared renderer runs markdown-it with `html:false` and `linkify:false` and no plugins, so README HTML shows as literal tags, front matter becomes an `<hr>` plus a big `<h2>`, `[^1]` becomes a bogus link, bare URLs are not clickable and GitHub alerts show `[!NOTE]`.

**Orchestrator pre-step (needs network):** `bun add dompurify markdown-it-footnote`; add `name version` + license text for both to `web/THIRD_PARTY_NOTICES.txt` (copy from `node_modules/<pkg>/LICENSE`).

**Files:**
- Modify: `src/markdown.ts` (parser options, plugins, sanitizer, front matter, image source normalization), `src/delivery.ts` (front matter hidden, heading ids, styles for new elements), `src/preview.ts` (front matter block mapping), `src/preview.css`, `src/editing.ts` (`frontMatterRange`, `headings` skip), `src/editor.ts` (front matter line styling, skip other decorations inside it)
- Create: `src/vendor.d.ts` (`declare module 'markdown-it-footnote'`)
- Modify: `assets.go` (`imageRefs` with HTML `<img>`; `Export` keeps HTML references and packs them by relative path)
- Test: `scripts/check-preview.ts`, `html_images_test.go` (new)

**Interfaces:**
- Produces (TS): `export function splitFrontMatter(content:string):{raw:string|null;body:string;lines:number}` — front matter only when the content starts with `---\n` and a closing `---` or `...` line appears within the first 200 lines; `lines` counts the lines consumed including both delimiters.
- `MarkdownOptions` gains `frontMatter?:'show'|'hide'` (default `'show'`). `renderMarkdown` renders `body` with `env.lineOffset = lines` (all `data-line`/`data-line-end` values, including fences and indented code, are shifted) and, when showing, prepends `<details class="md-front-matter" data-line="0" data-line-end="<lines-1>"><summary>文稿属性</summary><pre>…escaped raw…</pre></details>`.
- Parser: `html:true`, `linkify:true` with `parser.linkify.set({fuzzyLink:false,fuzzyEmail:false,fuzzyIP:false})`, `.use(footnote)`, plus a `githubAlerts` core rule (after `inline`): a blockquote whose first paragraph begins with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` (case-insensitive) gets `class="markdown-alert markdown-alert-<type>"`, loses the marker (and the soft break after it), and starts with `<p class="markdown-alert-title">` + 说明 / 提示 / 重要 / 警告 / 注意.
- Sanitizing: render to a string, run `DOMPurify.sanitize` with an explicit allow-list (tags: `a abbr b blockquote br caption center code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q s samp section small span strike strong sub summary sup table tbody td tfoot th thead tr u ul var`; attributes: `href src alt title width height align valign colspan rowspan open id class start reversed type checked disabled aria-label aria-hidden lang dir datetime cite scope data-line data-line-end data-image-source`; `ALLOW_DATA_ATTR:false`; `FORBID_ATTR:['style']`; default URI policy). A `uponSanitizeAttribute` hook keeps only class tokens starting with `md-`, `language-`, `task-list`, `contains-task-list`, `footnote`, `markdown-alert`. Parse the clean string into a `<template>` (inert: no image requests), then: remove `input` elements whose `type` is not `checkbox` and force `disabled` on checkboxes; for every `img` with `src` and no `data-image-source`, set `data-image-source` to `parser.normalizeLink(src)` and remove `src`. Append the template content to the `<article>` root, then run the existing image resolution loop unchanged.
- Delivery: `renderDelivery` renders with `frontMatter:'hide'`, gives `h1–h6` ids with the same slug rule as the preview (export a shared `headingSlug(text, used)` from `src/markdown.ts` and use it in `src/preview.ts` too), and adds inline styles for `.markdown-alert` (left border + tinted background), `.markdown-alert-title` (bold), `kbd`, `section.footnotes` (smaller text, top rule).
- `src/editing.ts`: `export function frontMatterRange(state:EditorState):{from:number;to:number}|null` (same detection as `splitFrontMatter`, document offsets); `headings()` ignores nodes inside it. `src/editor.ts`: inside that range `inlineDecorations` only adds the line class `md-front-matter` (muted monospace, see `style.css`) and `blockDecorations` adds nothing.
- Produces (Go): `type imageRef struct { Dest string; HTML bool }`, `func imageRefs(s string) []imageRef` in document order without duplicates — Markdown images from the goldmark AST plus `src` values of `<img>` tags found in `*ast.HTMLBlock` lines and `*ast.RawHTML` segments (regexp `(?is)<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`, values passed through `html.UnescapeString`). `imageTargets` returns the `Dest`s of `imageRefs`.
- `Export`: HTML references are never rewritten; a local, readable HTML reference whose path is relative and stays inside the document folder after `filepath.Clean` (no leading `..`) is packed at that same relative path in the ZIP; any other local HTML reference is reported in `Missing`. Markdown references keep today's `images/<sha>` behaviour. `materialize`/`SaveAs` leave HTML references alone.

- [ ] **Step 1: Write the failing Go test** — `html_images_test.go`:

```go
package main

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestImageRefsIncludeHTMLImages(t *testing.T) {
	got := imageTargets("<p align=\"center\"><img src=\"assets/logo.png\" width=\"120\"></p>\n\n文字 <img src='inline.png'> 结束\n\n![md](a.png)\n")
	if want := []string{"assets/logo.png", "inline.png", "a.png"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestHTMLImagesAreReadableDeliveredAndPacked(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, "assets", "logo.png"))
	p := filepath.Join(dir, "README.md")
	content := "<p align=\"center\"><img src=\"assets/logo.png\" width=\"120\"></p>\n\n# 标题\n"
	os.WriteFile(p, []byte(content), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.ReadImage(s.Current.ID, "assets/logo.png"); err != nil {
		t.Fatal(err)
	}
	if dl, err := w.Delivery(s.Current.ID); err != nil || dl.Images["assets/logo.png"] == "" {
		t.Fatalf("delivery %v %v", dl.Images, err)
	}
	z := filepath.Join(t.TempDir(), "out.zip")
	if r, err := w.Export(s.Current.ID, z, false); err != nil || len(r.Missing) != 0 {
		t.Fatalf("export %+v %v", r, err)
	}
	archive, err := zip.OpenReader(z)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	files := map[string]string{}
	for _, f := range archive.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		files[f.Name] = string(b)
	}
	if _, ok := files["assets/logo.png"]; !ok {
		t.Fatalf("HTML image not packed: %v", files)
	}
	if files["文稿.md"] != content {
		t.Fatalf("HTML image reference rewritten: %q", files["文稿.md"])
	}
}
```

- [ ] **Step 2: Write the failing browser checks** — in `scripts/check-preview.ts`, before the final `return`, add:

```ts
 const reader=renderMarkdown([
  '---','title: 周报','tags: [a]','---','',
  '<p align="center"><img src="logo.png" width="120" onerror="window.__xss=2"></p>','',
  '<script>window.__xss=1</script>','',
  '<a href="javascript:alert(1)">坏链接</a> <span style="position:fixed">样式</span> <kbd>⌘</kbd>','',
  '访问 https://github.com/egoist/mygo 或查看 README.md。','',
  '脚注引用[^1]。','',
  '> [!NOTE]','> 这是一条说明。','',
  '[^1]: 脚注内容',
 ].join('\n'),{resolve:destination=>destination==='logo.png'?localURL:undefined,external:'load'});
 const meta=reader.root.querySelector<HTMLElement>('details.md-front-matter');
 assert(meta?.textContent?.includes('title: 周报'),'front matter is not shown as document properties');
 equal(meta.dataset.line,'0','front matter start line');
 const logo=reader.root.querySelector<HTMLImageElement>('p[align="center"] img');
 equal(logo?.getAttribute('src'),localURL,'HTML image did not go through the image resolver');
 equal(logo?.getAttribute('width'),'120','HTML image width was dropped');
 assert(!logo?.hasAttribute('onerror'),'event handler survived sanitizing');
 assert(!reader.root.querySelector('script')&&!(window as any).__xss,'script survived sanitizing');
 assert(!reader.root.querySelector('a[href^="javascript"]'),'javascript link survived sanitizing');
 assert(!reader.root.querySelector('[style]'),'style attribute survived sanitizing');
 assert(reader.root.querySelector('kbd'),'kbd was dropped');
 const bare=reader.root.querySelector<HTMLAnchorElement>('a[href="https://github.com/egoist/mygo"]');
 assert(bare,'bare URL was not linked');
 equal(bare.closest<HTMLElement>('p')?.dataset.line,'11','line mapping ignores the front matter offset');
 assert(!reader.root.querySelector('a[href*="README.md"]'),'a file name was linked as a domain');
 assert(reader.root.querySelector('sup a[href="#fn1"]')&&reader.root.querySelector('#fn1'),'footnote did not render');
 const alertBlock=reader.root.querySelector('blockquote.markdown-alert.markdown-alert-note');
 equal(alertBlock?.querySelector('.markdown-alert-title')?.textContent,'说明','GitHub alert title missing');
 assert(!alertBlock?.textContent?.includes('[!NOTE]'),'alert marker left in the text');
 await reader.ready;
 const exported=renderDelivery({title:'t',content:'---\ntitle: 周报\n---\n\n# 正文',images:{},missing:[],external:0});
 assert(!exported.textContent?.includes('title: 周报'),'front matter leaked into delivery');
 equal(exported.querySelector('h1')?.id,'正文','delivery heading has no anchor id');
```

- [ ] **Step 3: Run to verify they fail** — `go test -run 'ImageRefsInclude|HTMLImagesAre' ./...` → FAIL. (The browser check runs in the orchestrator's `python3 scripts/check-preview.py`; Codex runs `node_modules/.bin/tsc --noEmit` and the esbuild bundle step only: `node_modules/.bin/esbuild scripts/check-preview.ts --bundle --platform=browser --format=iife --global-name=PreviewChecks --outfile=/tmp/liubai-preview-check.js`.)

- [ ] **Step 4: Implement** per the Interfaces block. All existing assertions in `scripts/check-preview.ts` must keep passing (line numbers, task checkboxes, semantic classes, synchronous image install, no request before resolution, delivery print styles).

- [ ] **Step 5: Run checks** — base verification, the esbuild bundle step above, `node scripts/build.mjs`.

- [ ] **Step 6: Commit** — `feat(reader): render safe HTML, front matter, footnotes, alerts and bare links`

---

### Task 13: 阅读视图代码高亮

Spec decision 13 (code part). Fenced code in the preview is monochrome although the bundle already ships CodeMirror's language packages.

**Files:**
- Create: `src/highlight.ts`
- Modify: `src/preview.ts` (run after each render, guarded by document id and render generation), `src/preview.css` (`tok-*` colors from theme variables)
- Test: `scripts/check-preview.ts`

**Interfaces:**
- Produces: `export async function highlightCodeBlocks(root:HTMLElement,isCurrent:()=>boolean):Promise<void>` — for each `pre > code[class*="language-"]` up to 100 000 characters: `LanguageDescription.matchLanguageName(languages,name,true)` (from `@codemirror/language` and `@codemirror/language-data`), `await description.load()`, stop if `!isCurrent()`, then `highlightCode(text, support.language.parser.parse(text), classHighlighter, putText, putBreak)` from `@lezer/highlight`, writing `<span class="tok-…">` nodes; the element's `textContent` must stay identical. Unknown languages and load failures leave the block untouched. Delivery output stays monochrome.
- CSS (preview only): `.tok-keyword,.tok-bool,.tok-atom,.tok-number{color:var(--primary)}`, `.tok-string,.tok-regexp{color:var(--quote)}`, `.tok-comment,.tok-meta{color:var(--muted-foreground);font-style:italic}`, `.tok-typeName,.tok-className,.tok-namespace{color:var(--link)}`, `.tok-propertyName,.tok-variableName2{color:var(--foreground)}` — scoped under `#preview-content`.

- [ ] **Step 1: Write the failing browser check** — in `scripts/check-preview.ts` import `highlightCodeBlocks` from `../src/highlight` and add before the final `return`:

```ts
 const code=renderMarkdown('```ts\nconst a: number = 1 // note\n```',{resolve:()=>undefined,external:'load'});
 await highlightCodeBlocks(code.root,()=>true);
 assert(code.root.querySelector('pre code .tok-keyword'),'code block was not highlighted');
 equal(code.root.querySelector('pre code')?.textContent,'const a: number = 1 // note\n','highlighting changed the code text');
 const staleCode=renderMarkdown('```ts\nconst b = 2\n```',{resolve:()=>undefined,external:'load'});
 await highlightCodeBlocks(staleCode.root,()=>false);
 assert(!staleCode.root.querySelector('.tok-keyword'),'stale render was highlighted');
```

- [ ] **Step 2: Implement** per the Interfaces block.

- [ ] **Step 3: Run checks** — base verification, the esbuild bundle step from Task 12, `node scripts/build.mjs`.

- [ ] **Step 4: Commit** — `feat(preview): highlight fenced code with bundled CodeMirror languages`

---

### Task 14: 本地图片支持 WebP、SVG、AVIF、BMP

Spec decision 14 (HEIC is left out: WebKit on macOS 13 cannot display it). `picture()` and `ImportImage` only accept PNG/JPEG/GIF.

**Orchestrator pre-step:** `go get golang.org/x/image@v0.46.0` (already listed in `web/THIRD_PARTY_NOTICES.txt` as `image@v0.46.0`).

**Files:**
- Create: `imageformat.go`, `imageformat_test.go`
- Modify: `assets.go`, `delivery.go` (`picture` callers use the MIME type), `src/index.html` (`#image-input` `accept`)

**Interfaces:**
- Produces: `type imageInfo struct { Format, MIME string; Width, Height int }` and `func sniffImage(b []byte) (imageInfo, error)`:
  - PNG/JPEG/GIF/WebP/BMP through `image.DecodeConfig` (blank-import `golang.org/x/image/webp` and `golang.org/x/image/bmp`); formats `png jpeg gif webp bmp`, MIME `image/<format>`.
  - SVG: after an optional UTF-8 BOM, whitespace, an `<?xml …?>` declaration, comments and a `<!DOCTYPE …>`, the first element within the first 4096 bytes is `<svg` → `svg`, `image/svg+xml`, size 0×0.
  - AVIF: bytes 4–8 are `ftyp` and the major or a compatible brand is `avif` or `avis` → `avif`, `image/avif`; width/height from the first `ispe` box (`…ispe` + 4 bytes version/flags + big-endian uint32 width + height) when present.
  - Anything else → error 「图片格式不受支持」; a known width or height above 16000 → 「图片尺寸超过 16000 像素」.
- Changes: `picture(path) ([]byte, imageInfo, error)`; data URLs use `info.MIME`; stored file names use `info.Format` as extension; `ImportImage` uses `sniffImage` with the error 「请选择 PNG、JPEG、GIF、WebP、SVG、AVIF 或 BMP 图片，最长边不超过 16000 像素」.
- `#image-input` `accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif,image/bmp"`.

- [ ] **Step 1: Write the failing tests** — `imageformat_test.go`:

```go
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/image/bmp"
)

func box(kind string, payload []byte) []byte {
	b := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(b, uint32(len(b)))
	copy(b[4:], kind)
	copy(b[8:], payload)
	return b
}

func TestSniffImageFormats(t *testing.T) {
	webp, _ := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	var bm bytes.Buffer
	bmp.Encode(&bm, image.NewNRGBA(image.Rect(0, 0, 3, 2)))
	size := make([]byte, 12)
	binary.BigEndian.PutUint32(size[4:], 640)
	binary.BigEndian.PutUint32(size[8:], 480)
	avif := append(box("ftyp", []byte("avif\x00\x00\x00\x00mif1avif")), box("meta", append([]byte{0, 0, 0, 0}, box("iprp", box("ipco", box("ispe", size)))...))...)
	svg := []byte("\xef\xbb\xbf<?xml version=\"1.0\"?>\n<!-- logo -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"></svg>")
	for _, c := range []struct {
		name string
		data []byte
		want imageInfo
	}{
		{"png", tinyPNG(), imageInfo{"png", "image/png", 32, 24}},
		{"webp", webp, imageInfo{"webp", "image/webp", 1, 1}},
		{"bmp", bm.Bytes(), imageInfo{"bmp", "image/bmp", 3, 2}},
		{"avif", avif, imageInfo{"avif", "image/avif", 640, 480}},
		{"svg", svg, imageInfo{"svg", "image/svg+xml", 0, 0}},
	} {
		got, err := sniffImage(c.data)
		if err != nil || got != c.want {
			t.Errorf("%s: got %+v %v, want %+v", c.name, got, err, c.want)
		}
	}
	var huge bytes.Buffer
	png.Encode(&huge, image.NewGray(image.Rect(0, 0, 16001, 1)))
	if _, err := sniffImage(huge.Bytes()); err == nil {
		t.Fatal("oversized image accepted")
	}
	if _, err := sniffImage([]byte("<html><svg></svg></html>")); err == nil {
		t.Fatal("HTML accepted as SVG")
	}
}

func TestReadImageServesSVGAndWebP(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	webp, _ := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	os.WriteFile(filepath.Join(dir, "logo.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`), 0644)
	os.WriteFile(filepath.Join(dir, "photo.webp"), webp, 0644)
	p := filepath.Join(dir, "doc.md")
	os.WriteFile(p, []byte("![logo](logo.svg)\n\n![photo](photo.webp)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	for dest, prefix := range map[string]string{"logo.svg": "data:image/svg+xml;base64,", "photo.webp": "data:image/webp;base64,"} {
		r, err := w.ReadImage(s.Current.ID, dest)
		if err != nil || !strings.HasPrefix(r.URL, prefix) {
			t.Errorf("%s: %v %q", dest, err, r.URL[:min(len(r.URL), 40)])
		}
	}
	if im, err := w.ImportImage(s.Current.ID, "a.webp", base64.StdEncoding.EncodeToString(webp)); err != nil || !strings.HasSuffix(im.Name, ".webp") {
		t.Fatalf("import webp: %+v %v", im, err)
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go test -run 'SniffImage|ReadImageServes' ./...` → FAIL.

- [ ] **Step 3: Implement** per the Interfaces block; update every `picture` caller (`ReadImage`, `copyAssets`, `materialize`, `SaveAs`, `Export`, `Delivery`).

- [ ] **Step 4: Run checks** — base verification and `node scripts/build.mjs`.

- [ ] **Step 5: Commit** — `feat(images): read and import WebP, SVG, AVIF and BMP`

---

### Task 15: 阅读模式

Spec decision 16.

**Files:**
- Modify: `workspace.go` (`normalizeLayout`, `Appearance` validation accept `"read"`), `main.go` (显示 menu item 「阅读模式」 `CmdOrCtrl+Shift+R` → action `read`)
- Modify: `src/types.ts` (`layout?:'single'|'split'|'read'`), `src/app.ts`, `src/index.html` (topbar button), `src/icons.ts` (`read` icon), `src/style.css`
- Test: `workspace_preview_test.go` (new test function)

**Interfaces:**
- Appearance `layout` accepts `read`; unknown stored values still normalize to `single`; empty requests still normalize to `single`.
- TS: `const reading=()=>appearance?.layout==='read'`; `split()` stays `layout==='split'`. `applyLayout()` toggles `.desk.read-layout`, calls `preview.setVisible(split()||reading())`, and in read mode moves focus to `.preview-scroll`. `toggleRead()`: entering stores the current layout in an in-memory `layoutBeforeRead` and sets `read`; leaving restores `layoutBeforeRead||'single'`. `⌘\` while reading switches to `split`. While reading, editing actions (`heading quote bullet ordered task bold italic code link table image undo redo find source focus`) toast 「阅读模式下不能编辑，⌘⇧R 返回编辑」 and do nothing. Header mode label shows 「阅读」 while reading.
- Keyboard: in the browser (`!desktop`) `⌘/Ctrl+Shift+R` maps to `read` in the existing keydown handler; desktop uses the menu accelerator. Command palette entry `['read','阅读模式','⌘ ⇧ R']`.
- Topbar: `<button class="tool" data-action="read" title="阅读模式 ⌘⇧R" aria-label="阅读模式" aria-pressed="false" data-icon="read"></button>` placed after the layout toggle; `aria-pressed` reflects the state. Icon path `read:'M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2z'`.
- CSS: `.desk.read-layout .editor-pane{display:none}`; `#preview` takes the editor's grid area at `max-width:var(--paper-width)` centered, same paddings as the paper; works at 680 px width.

- [ ] **Step 1: Write the failing test** — add to `workspace_preview_test.go`:

```go
func TestReadLayoutPersists(t *testing.T) {
	w := workspace(t)
	if err := w.Appearance(appearanceRequest(t, `{"theme":"paper","followSystem":true,"layout":"read","source":false}`)); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if got := appearanceValues(t, reopened)["layout"]; got != "read" {
		t.Fatalf("layout %v", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go test -run ReadLayoutPersists ./...` → FAIL.

- [ ] **Step 3: Implement** per the Interfaces block.

- [ ] **Step 4: Run checks** — base verification and `node scripts/build.mjs`.

- [ ] **Step 5: Commit** — `feat(reader): add a reading layout`

---

### Task 16: 文档与整体验收（orchestrator）

**Files:** `README.md`, `docs/superpowers/specs/2026-10-15-reader-foundation-design.md` (status), `docs/superpowers/validation/2026-10-15-reader-foundation.md` (new), `scripts/check-split-preview.py` (extend for reading mode and recent removal).

- [ ] **Step 1:** Extend `scripts/check-split-preview.py` with: ⌘⇧R enters and leaves reading mode (editor hidden, preview visible, layout persisted through `State`); removing a draft from 最近文稿 (two-step confirmation) drops it from `State().recent`.
- [ ] **Step 2:** Run every check, including `python3 scripts/check-preview.py`, `bun scripts/check-performance.ts` and the split-preview browser regression against a fresh `-data-dir`.
- [ ] **Step 3:** Build an ad hoc bundle (`go tool mygo build -sign - -skip-dmg -skip-notarize …`) and record Info.plist checks; record native-only items (IME candidates, shutdown, Finder double-click, drag from Finder, Finder tags on a real file, menus) as verified or not verified.
- [ ] **Step 4:** Update `README.md` (日常使用、文件和恢复、验证命令、已知限制: hard links are not preserved, HEIC not supported, KaTeX/Mermaid not yet supported), set the spec status to 已实现, write the validation record.
- [ ] **Step 5: Commit** — `docs(reader): record 0.4 reader foundation validation`
