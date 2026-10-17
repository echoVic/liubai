# Word export implementation plan

**Goal:** Export the existing delivery DOM as editable, standard OOXML using installed docx 9.8.1, offline.
**Architecture:** `src/docx-export.ts` owns DOM conversion and packaging; build emits one hashed lazy chunk. `src/app.ts` uses the existing delivery preparation flow; `Desktop.SaveDOCX` accepts binary bytes and follows SaveHTML's save policy.
**Constraints:** No dependencies, network, commits, version/changelog changes, browser/WebKit execution or desktop launch. Preserve summary.go/summary_test.go and existing performance budgets.

- [x] Add failing package/math tests, Go oversized-input test and browser DOM fixtures.
- [x] Convert inline/block structure, numbering, images, MathML and footnotes; yield during long traversals; package with docx.
- [x] Add lazy build, save/download entry points and both i18n catalogs; regenerate bindings.
- [x] Add dialog/palette/download/CSP browser regressions and offscreen WebKit coverage; update README.
- [x] Run specified non-browser verification, build twice, compare output and inspect changes.

Review focus: nested list restarts and continuations; images inside narrow tables/quotes; repeated footnote references; unsupported math must retain TeX; export snapshot survives edits while a module loads. Browser checks are authored and syntax checked here; the orchestrator executes them and validates with Word-compatible macOS tools.
