# Liubai

[简体中文](README.md) | English

A Markdown editor for the Mac, with a Windows beta, that you can write in as soon as it opens. Unsaved writing is kept as a draft, the whole window is the page, formatting appears as you type, and your files stay plain `.md`. Free and open source.

See [liubai.echovic.com](https://liubai.echovic.com/en/) for an introduction and screenshots.

## Download

Download the DMG from [Releases](https://github.com/echoVic/liubai/releases/latest), open it and drag Liubai into Applications. It needs macOS 13 or later and runs on Apple silicon and Intel. The installer is signed with a Developer ID and notarized by Apple.

The Windows beta is in the same release: most PCs take the `amd64` installer, and PCs with ARM processors the `arm64` one. Double-click it to install; no administrator rights are needed. It needs Windows 10 or 11. The installer isn't signed yet, so if Windows says it protected your PC on the first run, choose More info → Run anyway. The Windows version is a beta: give it a try, and please report problems in [Issues](https://github.com/echoVic/liubai/issues).

Liubai checks for updates in the background every 4 hours, and you can check yourself from Liubai → Check for Updates… (Help → Check for Updates… on Windows). Updating from a recent version downloads only a few MB. Keep Liubai in Applications or `~/Applications` so it can update itself. The [changelog](CHANGELOG.md) (in Chinese) lists the changes in each version.

## Features

- **Writing**: start typing as soon as it opens, with headings, lists, bold and other formatting appearing as you type. Use the formatting toolbar, the insert menu that opens when you type `/` on an empty line, or the block handle to the left of a paragraph, which can drag, convert, duplicate and delete blocks.
- **Tables and images**: tables are edited in place, with Tab moving between cells. Drag an image to resize it, and set its alignment and caption; the result is Markdown that also displays correctly on GitHub.
- **Math, diagrams and extended syntax**: KaTeX math, Mermaid diagrams, GitHub alerts, foldable `<details>` blocks and footnotes.
- **Reading**: edit, split and read views, with the right pane following the cursor in split view. The sidebar has recent documents; the outline sits beside the text on the right, with an outline button in the top bar. There's a focus mode; eleven themes in two series, Hours (the light through a day) and Seasons (the colours of the year), which can switch automatically; and adjustable font size and line width.
- **Export**: PDF, Word (.docx), HTML with embedded images, a ZIP of the Markdown and its images, and rich-text copy. Chinese text in the PDFs copies and searches correctly. Word documents keep heading styles, list numbering, tables, equations and footnotes, ready for anyone working in Word, Pages or WPS.
- **Paste**: content from web pages, documents and Word becomes Markdown when pasted, images included; `⇧⌘V` pastes plain text.
- **Quick notes**: press `⌃⌥⌘N` (`Ctrl+Alt+N` on Windows) in any app to write something down, and `⌘↩` (`Ctrl+Enter`) saves it as a new draft.
- Simplified Chinese and English interfaces, following the system language by default.

Shortcuts: `⌘N` new, `⌘O` open, `⌘S` save, `⌘⇧S` save as, `⌘K` all commands, `⌘F` find, `⌘\` toggle split view, `⌘⇧R` reading mode, `⌘⇧M` show Markdown source, `⌘/` block menu, `⌘L` edit link, `⌘⇧F` focus mode, `⌘P` export PDF. On Windows ⌘ is Ctrl and ⇧ is Shift; focus mode is F8 and redo is Ctrl+Y.

## Files and data

- Saving an opened `.md` writes it back to the original file, keeping its Finder tags and creation date (its attributes and creation date on Windows). Pasted images go into `<document name>.assets/` beside it, referenced by relative paths.
- When another app changes a file, Liubai loads the new version. If both sides changed, it pauses and lets you decide which to keep, saving the other as a recovery copy, so nothing is lost quietly. Read-only files are never overwritten.
- Unsaved drafts live in `~/Library/Application Support/Liubai/` (`%AppData%\Liubai\` on Windows). Drafts removed from recent documents go to its `trash/` folder for 30 days, and drafts that can't be read are moved to `quarantine/` while the app starts as usual.
- Documents can be up to 8 MB, and images up to 20 MB and 16,000 pixels on the longest side.

There are no ads, telemetry or cloud sync. Checking for updates only contacts GitHub Releases and never uploads your writing.

## Development

You need Go 1.27.1 (it can download the toolchain itself), Node 24 and Bun. Running Liubai needs none of them.

```sh
bun install --frozen-lockfile                              # frontend dependencies
node scripts/build.mjs                                     # build src/ into web/
go run .                                                   # the desktop app
go run . --web 127.0.0.1:4193 --data-dir /tmp/liubai-dev   # in the browser, with its own data directory
```

The backend is Go ([MyGo](https://github.com/egoist/mygo)), and the frontend source is in `src/` (TypeScript and CodeMirror 6). `web/` is the committed build output, which the app bundle carries once as a resource. Unpackaged runs read `web/` from the working directory, so start them from the repository root. Browser mode uses the same draft backend, listens on the loopback address only, and replaces system dialogs with imports and downloads.

Checks:

```sh
go test ./... && go vet ./...
node_modules/.bin/tsc --noEmit
node scripts/check-i18n.mjs && node scripts/check-editor.mjs
node scripts/check-themes.mjs                  # contrast floors and the theme list
npx --yes bun@1.4.3 scripts/check-<name>.ts   # editing, rendering, performance, paste, capture-input, platform, blocks, slash, tables, images, marks, math, mermaid, extras, docx, theme
scripts/e2e.sh check-<name>                    # regressions in Chrome: split-preview, reader, toolbar, capture, english, windows, blocks, tables, images, math, mermaid, extras, docx, themes, outline
scripts/e2e.sh check-blocks-webkit             # blocks, images, math, diagrams and Word conversion in WebKit, the desktop app's engine
scripts/e2e.sh shoot-themes                    # screenshots of every theme in the edit, split and read views, in /tmp/liubai-theme-shots/
python3 scripts/check-preview.py               # rendering and export
python3 scripts/check-pdf.py                   # PDF pagination, Chinese text layer and rendering
```

`scripts/e2e.sh` builds the app each time, starts a web server with a fresh data directory, and stops it afterwards. The Python checks use the installed Chrome. The WebKit check runs in an off-screen window and never takes focus; WebKit stops drawing while the screen is locked or the display is asleep, and the check then stops and says why.

To build the universal app, run `go tool mygo build -platform darwin/universal .`; the output is in `build/darwin-universal/`. The Windows version (a beta) cross-builds on macOS with `go tool mygo build -platform windows/amd64,windows/arm64 .` into `build/windows-amd64/` and `build/windows-arm64/`; the installers need NSIS (`brew install makensis`). `check-windows` checks shortcuts, fonts and the title bar in Chrome with a Windows platform, and GitHub Actions runs `go test` on Windows. Release steps (signing, notarization and update packages) are in [docs/RELEASING.md](docs/RELEASING.md), in Chinese.

## Documents

The documents below are in Chinese.

- [Changelog](CHANGELOG.md): the changes in each version
- [Validation record](docs/superpowers/validation/2026-10-15-reader-foundation.md): trade-offs, tests, native app checks and release checks for each version
- Designs: [reader and reliability](docs/superpowers/specs/2026-10-15-reader-foundation-design.md), [split preview](docs/superpowers/specs/2026-10-15-split-preview-design.md) and [block editing](docs/superpowers/specs/2026-10-17-block-editing-design.md); implementation plans are in `docs/superpowers/plans/`
- [Performance report](docs/performance/2026-10-15-reader-foundation.md)

## License

[MIT](LICENSE). Licenses of third-party dependencies are in `web/THIRD_PARTY_NOTICES.txt`, which ships with the app.
