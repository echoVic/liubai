# Liubai

[简体中文](README.md) | English

A Markdown editor for the Mac, with a Windows beta, that you can write in as soon as it opens. Unsaved writing is kept as a draft, the whole window is the page, formatting appears as you type, and your files stay plain `.md`. Free and open source.

See [liubai.echovic.com](https://liubai.echovic.com/en/) for an introduction and screenshots.

## Download

Download the DMG from [Releases](https://github.com/echoVic/liubai/releases/latest), open it and drag Liubai into Applications. It needs macOS 13 or later and runs on Apple silicon and Intel. The installer is signed with a Developer ID and notarized by Apple.

The Windows beta is in the same release: most PCs take the `amd64` installer, and PCs with ARM processors the `arm64` one. Double-click it to install; no administrator rights are needed. It needs Windows 10 or 11. The Windows app and installer aren't signed yet, so if Windows says it protected your PC on the first run, choose More info → Run anyway. Report problems in [Issues](https://github.com/echoVic/liubai/issues), or open a new issue from Report an Issue… in the menu.

Liubai checks for updates in the background every 4 hours, and you can check yourself from Liubai → Check for Updates… (Help → Check for Updates… on Windows). Updating from a recent version downloads only a few MB. Keep Liubai in Applications or `~/Applications` so it can update itself. The [changelog](CHANGELOG.md) (in Chinese) lists the changes in each version.

## Features

- **Writing**: start typing as soon as it opens; headings, lists, bold and other formatting appear as you type. Use the formatting toolbar, the insert menu that opens when you type `/` on an empty line, or the block handle to the left of a paragraph to drag, convert, duplicate and delete blocks.
- **Tables and images**: tables are edited in place, with Tab moving between cells. Drag an image to resize it, and set its alignment and caption; in reading mode, images can be opened at full size. Wide tables, long code blocks and document properties scroll horizontally on their own. The result is Markdown that also displays correctly on GitHub.
- **Math, diagrams and extended syntax**: KaTeX math, Mermaid diagrams, GitHub alerts, foldable `<details>` blocks and footnotes.
- **Views**: edit, split and read views, with the right pane following the cursor in split view. Recent documents are in the sidebar, and the outline sits beside the text. There's a focus mode, and the font size and line width are adjustable.
- **Search and tags**: search the titles and Markdown of all registered documents; results show line numbers and jump to any view. Combine a tag with a search query to find their intersection.
- **Wiki links and backlinks**: reference registered documents with `[[Document title]]`; ⌘/Ctrl-click in the editor, or click in read and split previews. The sidebar's Backlinks section lists the referencing documents.
- **Themes**: 25, in three series: Hours, Seasons and Studio. Pick one yourself, follow the system's light and dark mode, or let the hours or the solar terms switch them. They use only the fonts your system already has.
- **Export**: PDF, Word (.docx), HTML with embedded images, a ZIP of the Markdown and its images, and rich-text copy. Chinese text in the PDFs copies and searches correctly; Word documents keep heading styles, list numbering, tables, equations and footnotes.
- **Paste and quick notes**: content from web pages, documents and Word becomes Markdown when pasted, images included; `⇧⌘V` pastes plain text. Press `⌃⌥⌘N` (`Ctrl+Alt+N` on Windows) in any app to write something down; `⌘↩` saves it as a new draft, or appends it to an existing document.
- **Settings, recovery and languages**: appearance, typography, quick notes and language share a separate settings window, with changes applied immediately. Signing out, shutting down or restarting writes unsaved edits to a recovery log, so you can carry on next time. Simplified Chinese and English interfaces follow the system language by default.

Shortcuts: `⌘N` new, `⌘O` open, `⌘S` save, `⌘K` all commands, `⌘F` find, `⌘\` toggle split view, `⌘⇧R` reading mode, `⌘P` export PDF; `⌘1`–`⌘6` headings, `⌘0` body text, `⌘B` bold, `⌘I` italic, `⌘U` underline, `⌘⇧X` strikethrough, `⌘⇧H` highlight, `⌘E` inline code. The full list is in All Commands; on Windows ⌘ is Ctrl and ⇧ is Shift.

## Performance

Long documents keep up: in a document shaped like a novel (paragraphs of tens to hundreds of characters), a keystroke takes about 8 ms at a million characters and 10–12 ms at two million, within one frame (about 16.7 ms); a million-character document shows its text about 0.1 s after it opens. Denser formatting costs more: with a table and an image every two or three hundred characters, a keystroke stays within a frame up to about 200,000 characters and takes about 20 ms at 300,000; notes as dense with math, diagrams and footnotes take about 10 ms at 100,000 characters.

The word count runs in a background thread, and only the visible part is laid out. Code block grammars, Mermaid diagrams and Word export load when first needed. These numbers were measured in WebKit, the desktop app's engine, on an M2 Pro; the [performance report](docs/performance/2026-10-24-0.6.3.md) (in Chinese) has the methods and the full data.

## Files and data

- Saving an opened `.md` writes it back to the original file, keeping its Finder tags and creation date (its attributes and creation date on Windows). Pasted images go into `<document name>.assets/` beside it, referenced by relative paths.
- When another app changes a file, Liubai loads the new version. If both sides changed, it pauses and lets you decide which to keep, saving the other as a recovery copy. Read-only files are never overwritten.
- Unsaved drafts live in `~/Library/Application Support/Liubai/` (`%AppData%\Liubai\` on Windows). Drafts removed from recent documents go to its `trash/` folder for 30 days, and drafts that can't be read are moved to `quarantine/` while the app starts as usual.
- Documents can be up to 8 MB, and images up to 20 MB and 16,000 pixels on the longest side.

There are no ads, telemetry or cloud sync. Checking for updates only contacts GitHub Releases and never uploads your writing.

## Development

You need Go 1.27.3 (it can download the toolchain itself), Node (CI uses 24, the version in `.nvmrc`) and Bun 1.4.4. Running Liubai needs none of them.

```sh
bun install --frozen-lockfile                              # frontend dependencies
node scripts/build.mjs                                     # build src/ into web/
go run .                                                   # the desktop app
go run . --web 127.0.0.1:4193 --data-dir /tmp/liubai-dev   # in the browser
```

The backend is Go ([MyGo](https://github.com/egoist/mygo)), and the frontend source is in `src/` (TypeScript and CodeMirror 6). `web/` is the committed build output; unpackaged runs read `web/` from the working directory, so start them from the repository root. Rebuild and commit `web/` whenever `src/` changes.

Checks:

```sh
go test ./... && go vet ./...
bun run check:headless                         # both tsc runs, i18n, themes and scripts/check-*.ts (except check-performance)
scripts/e2e.sh check-<name>                    # UI regressions in Chrome
scripts/e2e.sh check-blocks-webkit             # blocks, images, math, diagrams and Word conversion in WebKit
ROUNDS=3 scripts/bench/run.sh <base>           # compare performance with another version
```

`scripts/check-*.ts` are Bun checks that need no browser; `scripts/check-*.py` and `scripts/e2e.sh` use the installed Chrome, and some checks also run in Playwright's WebKit (first `python3 -m playwright install webkit`). `scripts/e2e.sh` builds the app each time, starts a web server with a fresh data directory, and stops it afterwards; see `scripts/check-*` for the full list of checks.

On pushes to `main` and `feat/**` and on pull requests, GitHub Actions runs `go vet` and `go test` on Windows. On macOS it first checks the performance budgets, the start-up bundle size and the resources, then runs `go vet`, `go test ./...` and `check:headless`, and finally rebuilds the frontend and fails if `web/` differs from what was committed.

To build the app, run `go tool mygo build -platform darwin/universal .`; the output is in `build/darwin-universal/`. The Windows beta cross-builds with `-platform windows/amd64,windows/arm64`; the installers need NSIS (`brew install makensis`). Release steps (signing, notarization and update packages) are in [docs/RELEASING.md](docs/RELEASING.md), in Chinese.

## Documents

The documents below are in Chinese.

- [Changelog](CHANGELOG.md): the changes in each version
- [Validation records](docs/superpowers/validation/): trade-offs, tests and release checks for each version
- [Performance report](docs/performance/2026-10-24-0.6.3.md): methods, data and the comparison with 0.1.0
- Design and plans: specs, implementation plans and focused validations for each feature are in `docs/superpowers/`

## License

[MIT](LICENSE). Licenses of third-party dependencies are in `web/THIRD_PARTY_NOTICES.txt`, which ships with the app.
