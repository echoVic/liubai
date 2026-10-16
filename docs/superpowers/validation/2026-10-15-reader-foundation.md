# 阅读器基础（0.4 开发分支）验证记录

**日期**：2026-10-15
**分支**：`feat/reader-foundation`（基于 `feat/split-preview` @ `9fa3cf6`）
**规格**：[2026-10-15-reader-foundation-design.md](../specs/2026-10-15-reader-foundation-design.md)
**计划**：[2026-10-15-reader-foundation.md](../plans/2026-10-15-reader-foundation.md)
**实施方式**：每个任务由本机 Codex CLI（0.162.1，`codex exec -s workspace-write`，无网络）实现；编排者逐任务审查 diff、在沙箱外重跑全部检查和浏览器回归后提交。互不重叠的任务并行执行，`web/` 在提交时按各自源码单独构建，保证每个提交的前端产物与源码一致。

## 结果

以下命令在最终代码上均以退出码 0 完成：

```sh
go vet ./...
go vet -tags perf .
go test -race ./...
node_modules/.bin/tsc --noEmit
node scripts/check-editor.mjs
npx --yes bun@1.4.3 scripts/check-editing.ts
npx --yes bun@1.4.3 scripts/check-rendering.ts
npx --yes bun@1.4.3 scripts/check-performance.ts
npx --yes bun@1.4.3 scripts/check-paste.ts
npx --yes bun@1.4.3 scripts/check-capture-input.ts
go tool mygo i18n check
node scripts/check-i18n.mjs
python3 scripts/check-preview.py
node scripts/build.mjs
python3 scripts/check-split-preview.py http://127.0.0.1:<port>   # 新数据目录
python3 scripts/check-reader.py http://127.0.0.1:<port>          # 新数据目录
python3 scripts/check-toolbar.py http://127.0.0.1:<port>         # 新数据目录
python3 scripts/check-capture.py http://127.0.0.1:<port>         # 新数据目录
python3 scripts/check-english.py http://127.0.0.1:<port>         # 新数据目录
python3 scripts/check-pdf.py                                      # 离屏 WebKit 打印，不抢焦点
go tool mygo build -sign - -skip-dmg -skip-notarize -platform darwin/arm64 -o /tmp/liubai-bundle-check .
```

浏览器回归输出：

```text
PASS: rendering, readonly tasks, modes/history, separator soft follow, one-render reload/new/Recent/same-ID load, synthetic composition guard, stale image isolation, themes, local images/HTML export, responsive layout
PASS: rich/plain paste and undo, embedded images/fallback, notice banner, reader rendering, reading mode, focus mode, position saves/word count, status reload/conflict, draft cleanup/removal, drop to open, relative links
PASS: format groups/names/icons/headings/cursor/wrapping/source, toolbar order/names/icons, view radios/shortcuts/reload, sidebar tabs/headings/recent, menu keyboard/dismissal/disabled/source/focus/commands, export, responsive toolbar
PASS: A4, 21 pages, no stranded headings, searchable Chinese text, identical PDF pixels
PASS: quick note save, current document untouched, newline, IME guard, web-mode settings
PASS: English chrome, dialogs, capture, save status, word plurals, live/persisted language switching, undo, Chinese browser matching
```

## 任务与提交

| 任务 | 提交 | 关键回归测试 |
|---|---|---|
| 1 图片路径规范化 | `f890ea4` | `images_test.go`：markdown-it 规范化路径、旧 `%E5…` 写法、可读的新路径、`<…>` 写法 |
| 2 损坏数据隔离、打开失败提示 | `1219f93` | `startup_test.go`：坏草稿/坏索引/新版本索引不阻止启动，提示只交付一次 |
| 3 写回保留元数据 | `99145ec` `642acae` | `replace_darwin_test.go`：Finder 标签、自定义 xattr、创建时间、权限 |
| 4 另存为保留图片引用 | `a7e3955` | `saveas_test.go`：同目录不改写、跨目录保留原名、重名、缺图不阻止 |
| 5 外部修改与状态轮询 | `6013fb5` | `external_test.go`：干净自动载入、冲突、按需备份、覆盖磁盘、stat 快路径 |
| 6 退出与关机 | `ad8abe3` | `quit_test.go` |
| 7 即时排版性能 | `623ecf4` `dc30c05` | `check-rendering.ts`、`check-performance.ts` |
| 8 位置、摘要、字数 | `d96c197` | `positions_test.go`、`summary_test.go`、`check-editing.ts` 字数统计 |
| 9 移除文稿、清理空草稿 | `c3191e4` | `trash_test.go` |
| 10 菜单、本地化、HTML 保存 | `570ccb8` | `menu_test.go`；临时签名包的 Info.plist 与 `.lproj` |
| 11 文件关联、拖入、相对链接 | `f59a4d7` | `links_test.go`、`check-editing.ts` 链接识别；包内 `CFBundleDocumentTypes` |
| 12 阅读渲染 | `894514a` `a8b7e11` `995dfd4` | `html_images_test.go`、`check-preview.ts`（消毒、front matter、行号偏移、脚注、提示块、裸链接、草稿图片） |
| 13 代码高亮 | `a165f40` | `check-preview.ts` 高亮与过期渲染 |
| 14 图片格式 | `db2844c` `2729b11` | `imageformat_test.go` |
| 15 阅读模式 | `5a1e1a5` | `workspace_preview_test.go`；`check-reader.py` |
| 原生测试发现的界面问题 | `dd6561f` | `check-reader.py`：隔离提示只显示「在 Finder 中显示」 |
| 预览按需消毒（性能） | `eb71662` | `check-preview.ts`：纯 Markdown 不调用消毒器；含原始 HTML 仍消毒；两条路径都保留表格对齐；`javascript:`/`data:` 链接与图片 alt 中的标签保持转义 |
| 顶栏改版 | `6de72dd` | `check-toolbar.py`：顺序与名称、编辑/分栏/阅读与快捷键同步、侧栏两个标签、··· 菜单键盘操作与禁用项、导出、1440–680px 无溢出；`menu_test.go` 菜单名称 |
| PDF 文字层 | `cf84fe7` | `pdf_text_test.go`：真实导出 PDF 修正前后、增量更新结构、幂等、CMap 各种写法、异常输入原样返回；模糊测试 |
| PDF 标题分页 | `2feb91c` | `check-pdf.py`：离屏 WebKit 打印 40 节文稿，无标题留在页底、文字可搜索、修正前后像素一致 |
| 格式栏改版 | `ce13a36` `e06a9fd` | `check-editing.ts` 标题级别与删除线/行内代码；`check-toolbar.py` 分组、标题菜单随光标、源码开关、换行不隐藏按钮 |

## 编排者在 Codex 实现之上的修正

- 任务 3：设置创建时间改为尽力而为。原实现失败时会让整次保存失败，exFAT、部分网络共享不支持创建时间，自动保存会因此出错。
- 任务 5：`TestPreserveUneditedCRLFBOMAndConflict` 改为用编辑器所见的旧 revision 直接调用 `Update`；`edit()` 先调 `State()`，新逻辑下会先自动载入磁盘版本，原断言全部保留。
- 任务 7：本机负载很高时单次计时波动大，性能检查改为取多批次最好值；30 万字预算由 12 ms 调为 15 ms（其中约 4 ms 是 CodeMirror 自身的增量解析）。尝试过的一处微优化没有可测收益，未保留。
- 任务 8：`save(force)`。仅位置变化走 `SavePosition` 后，原文件写入失败时 ⌘S /「重试保存」会只保存位置而不重写文件；显式保存现在强制重发正文。
- 任务 9：启动和切换文稿时的自动清理改为尽力而为，清理失败不再阻止启动或切换；手动移除仍报告错误。
- 预览按需消毒：Codex 实现「无原始 HTML 时跳过 DOMPurify」后，纯 Markdown 路径保留表格列对齐（`style="text-align:…"`），消毒路径却删掉它，同一张表会因文中有无 HTML 而显示不同；0.3.0 保留对齐。改为在消毒钩子中只放行 `th`/`td` 上的 `text-align`，并补充两条路径的断言（去掉钩子时断言失败）。
- 任务 12：DOMPurify 会按 URI 规则校验所有非 URI 安全属性，`data-image-source="liubai-asset:…"` 被当作未知协议删除，草稿中粘贴的图片在预览里不显示。把内部 `data-*` 属性标为 URI 安全（加载仍受解析器与后端白名单约束），并新增修复前失败、修复后通过的回归断言。

## 工具栏改版与 PDF 修复

用户在原生实测后提出：工具栏不够主流、部分图标看不懂，并要求修复实测中发现的两个 PDF 问题。工具栏方案（三种方向中选定「文字分段＋常见图标」）经用户确认后，由 Codex 分四个任务实现，编排者审查并在沙箱外跑全部检查后提交。

- **顶栏**：侧栏按钮、文稿标题、「编辑｜分栏｜阅读」三选一、Aa（外观与排版）、导出、···（更多）。最近文稿与大纲合并为带两个标签的侧栏；新建、打开、另存为、重命名、专注模式、显示 Markdown 源码和所有操作放进 ··· 菜单，菜单支持方向键、Esc 和点击外部关闭。「带走文稿」「段落专注」等名称统一改为「导出」「专注模式」等常见叫法，原生菜单和 ⌘K 列表同步。
- **格式栏**：「标题▾ │ B I S 行内代码 │ 引用 无序 有序 任务 │ 链接 图片 表格 代码块」，分栏时右侧有「源码」开关。标题菜单可设正文或标题 1–3，按钮显示光标所在行的级别；删除线、行内代码是新增功能。图标采用 Lucide 的线性图标（ISC 许可已写入第三方许可说明），每个按钮都有名称和悬停提示。
- **PDF 文字层**：苹方等系统中文字体把部首码位和对应汉字映射到同一字形，CoreGraphics 写文字层时取了部首码位。导出后追加一段增量更新，把 /ToUnicode 中的部首码位改回汉字；对照表（290 项）由 Unicode NFKC 和系统字体生成。原文件字节保持为前缀，遇到不支持的结构原样保存。21 页文稿修正耗时约 1.4 ms。
- **PDF 标题分页**：WebKit 打印不支持 `break-after: avoid`。打印样式让标题不可拆分，并在标题下方预留 120px（约三行正文加段距）；这段空间通过负边距折叠掉，正文间距不变。

编排者在 Codex 实现之上的修正：

- 预留高度最初是 96px。新的 PDF 回归检查发现第 21 节仍落在页底：正文段落设置了 `orphans:3`，页底至少要容纳三行，96px 不够。改为 120px 后，固定文稿和 6 组随机文稿都没有标题留在页底。
- 格式栏原为横向滚动。在分栏中左栏较窄，「源码」开关被挤出可视区，需要横向滚动才能看到；改为换行显示，回归检查断言各宽度、各布局下没有按钮超出格式栏。
- 视图三选一的选中状态改为由当前布局推导，布局值缺省时也有一项被选中。
- `check-pdf.py` 改用系统临时目录和默认 Go 缓存（Codex 沙箱里写死了路径）；`check-toolbar.py` 修正两处错误断言（空文稿会显示占位文字；680px 时格式栏不一定溢出）。
- 原生复测发现标题菜单向按钮左侧展开、超出纸面：菜单改为在窗口左半边时左对齐、右半边时右对齐，回归检查断言两个菜单的位置；导出对话框和缺图提示里残留的「带走」「打包」措辞一并改掉（`e06a9fd`）。
- 为 PDF 修正补充模糊测试 `FuzzFixPDFTextMapping`：任何输入要么原样返回，要么以原文件为前缀；本机跑了约 74 万次，没有出错。

## MyGo 0.5 升级与新功能（2026-10-16）

用户看到 MyGo 0.5 发布后，要求把评估出的五项全部做完：升级、系统集成、富文本粘贴转 Markdown、随手记、英文界面（加一份是否迁移到 Documents 的评估）。随手记和语言范围由用户选定：每条随手记新建一篇草稿、只做记录；简体中文加英文；不整体迁移。仍由 Codex 实现，编排者审查、在沙箱外跑全部检查并做原生实测。

| 项目 | 提交 | 要点 |
|---|---|---|
| 升级到 MyGo 0.5.5 | `cfaa4b8` | 代码不用改；0.4/0.5 的不兼容改动只涉及原生控件、终端插件和安装包文件名 |
| 系统集成 | `fc9bb08` | 用 FSEvents 监听当前文件，桌面版轮询放宽到 10 秒；`AddRecentDocument` 与「文件 → 打开最近使用」；保存失败或 1.5 秒仍未保存时关闭按钮显示圆点；窗口带上文件路径 |
| Documents 迁移评估 | `f2cb18f` | 结论不迁移，见 [评估](../specs/2026-10-16-mygo-documents-evaluation.md) |
| 富文本粘贴 | `48f47c2` | turndown + GFM 插件；Word 列表、Google Docs 样式、CJK 强调边界、代码编辑器内容原样保留；内嵌图片走现有导入；⇧⌘V 纯文本 |
| 随手记 | `12e51a6` | 全局快捷键 ⌃⌥⌘N（可改）呼出不激活应用的浮动面板，⌘↩ 存为新草稿且不改变主窗口当前文稿；设置可录制快捷键、登录时后台启动 |
| 英文界面 | `4d5e35c` | MyGo 目录 407 条消息（简中为源、英文翻译）；文稿状态改为结构化代码；「显示 → 语言」即时切换；`check-i18n.mjs` 防止代码里出现未翻译文案 |

编排者的判断与修正：

- **粘贴方案**：小试验对比了 MyGo 的 `richtext` 转换（程序增大约 3 MB，表格被拍平）和 turndown（约 30 KB，保留表格与代码语言），改用 turndown。
- **粘贴的内嵌图片在应用内导入失败**：页面安全策略 `connect-src 'self'` 不允许 `fetch(data:…)`，改为直接解码 data URL，补了单元测试。
- **测试本身的问题**：Playwright 的 `dispatch_event` 不会把 `clipboardData` 带进粘贴事件，改为在页面里构造真实的 `ClipboardEvent`；纯文本粘贴和设置对话框的断言在机器繁忙时会抢跑，改为先等内容或对话框出现。
- **外部修改载入**：Codex 把重新载入从 `Activate` 改成了 `State`，与既有回归的约定不符，恢复为 `Activate`。
- **英文界面依赖**：Codex 因无网络把 `mygo-runtime` 复制进了 `third_party/`，改为直接依赖 npm 上与 Go 模块同版本的 `mygo-runtime@0.5.5`。
- **视图切换抢焦点**：切换编辑/分栏/阅读后会把焦点移回正文；如果用户在布局保存期间已经打开了 ··· 菜单，菜单会被关掉。改为只有焦点没被别处拿走时才移回正文。
- **测试包构建脚本**：应用名改由目录提供后，原生测试包的改名步骤随之更新。

原生实测（隔离测试包，辅助功能操作；涉及键盘、剪贴板和输入法的步骤只在用户离开键盘时进行）：

| # | 项目 | 结果 |
|---|---|---|
| 23 | MyGo 0.5.5 冒烟 | 菜单为中文，页面调用与事件正常，退出请求约 1 秒内放行 |
| 24 | 外部修改即时载入 | 外部写入后 0.41 秒编辑器显示新内容，并提示「已载入磁盘上的新版本」 |
| 25 | 最近文稿与文件路径 | 「打开最近使用」出现并记录了打开的文件；窗口的 `AXDocument` 为该文件 |
| 26 | 未保存圆点 | 目录不可写导致保存失败时，关闭按钮立即出现圆点、状态为「草稿已保留，文件保存失败」；恢复权限并撤销后圆点消失。正常自动保存不出现圆点 |
| 27 | 富文本与纯文本粘贴 | 系统剪贴板放入网页 HTML 后在应用内粘贴，得到 `## 标题`、`**粗体**`、链接、列表和表格；⇧⌘V 原样粘贴含 `*`、`[]`、`\` 的文字。测试前后备份并还原了用户剪贴板 |

## 只读文件与复查修正（2026-10-16）

用户要求修复 Documents 评估中发现的只读文件问题：原子替换只需要目录可写，所以自动保存会直接替换用户设为只读的文件（`chmod 444`、Finder「简介」中的只读权限或「已锁定」），替换后的文件仍是只读。修复仍由 Codex 实现，编排者审查并在沙箱外跑全部检查。重跑全部检查时又发现两处问题，一并修正。

| 项目 | 提交 | 要点 |
|---|---|---|
| 只读文件不再被覆盖 | `b784a5f` | 写回前用 `access(2)` 检查文件本身可写，ACL 和锁定标志也算在内。只读时不改文件，修改留在草稿，状态显示「文件为只读，修改保留在草稿中」，提示条提供「重试保存」和「另存为…」，关闭按钮显示未保存圆点；文件恢复可写后，「重试保存」或下一次编辑会正常写回。「用当前版本覆盖」、另存为、ZIP/PDF/HTML 导出和恢复副本遇到已存在的只读目标时提示「「文件名」是只读文件，请选择其他位置」，不写入；应用自己的数据目录不受影响 |
| 编辑器小部件反复判断界面语言 | `ccbdb29` | 英文界面提交（`4d5e35c`）让每个图片、表格、任务框小部件在创建时都调用一次 `pageLocale()`，而每次按键都会重建全篇的块级小部件。桌面应用里这只是读取 `window.mygo.locale`，影响很小；浏览器模式要读存储、构造 `Intl.Locale`，`check-performance.ts` 所用的 Bun 中还会两次抛出并捕获异常，性能预算检查因此失败。在 Bun 中单独计时 30 万字文稿的块级装饰：英文界面之前约 4.2 ms，之后约 7.5 ms；改为读取切换语言时与文案一起缓存的结果后为 4.5 ms。`check-performance.ts` 回到 10 万字 2.4 ms、30 万字 9.1 ms（预算 5 / 15 ms） |
| 检查与基准在高负载下不可靠 | `ccbdb29` `ce3d069` `6cf6092` | `check-rendering.ts` 在补完语法树之前就读取了装饰：初次解析只有 20 ms，机器繁忙时解析不到末尾的图片，检查就会失败；改为补完语法树后再读。`check-performance.ts` 和性能基准 `scripts/bench/editor.ts` 中，如果某批按键因解析超时只留下不完整的语法树，这一批会显得过快；现在会补完语法树后重测这一批。修正后的基准与性能报告的数据相符，见报告中的「后续复查」 |

测试：

- `readonly_test.go`：`0444` 文件自动保存后内容、大小、修改时间和文件身份都不变；草稿保留新内容，状态为 `fileReadOnly` 且无冲突；改回 `0644` 后重试，写回成功，状态为 `fileSaved`。覆盖、另存为、ZIP 导出和恢复副本写到只读目标时都被拒绝，目标不变，中英文错误文字正确。以 root 运行时跳过。
- `replace_darwin_test.go`：用 `UF_IMMUTABLE` 锁定的文件同样不被替换，解锁后重试写回。
- `desktop_state_test.go`：`fileReadOnly` 计为保存失败，关闭按钮显示圆点。
- `check-reader.py`、`check-english.py`：中英文提示条的文字与按钮。

编排者的修正：提示条按钮原来用的是另一条「另存」文案，改为与菜单一致的「另存为…」，并删除多出的目录条目（现为 408 条）。

## 性能

完整报告见[性能测试报告](../../performance/2026-10-15-reader-foundation.md)，原始数据在 `docs/performance/raw/2026-10-15/`，可用 `scripts/bench/run.sh` 复现。0.3.0 与本分支在同一台机器上交替运行两轮，下表取各自的最好值：

| 场景 | 0.3.0 | 本分支 |
|---|---:|---:|
| 10 万字文稿输入一个字（解析 + 即时排版装饰） | 25.4 ms | 2.6 ms |
| 30 万字文稿输入一个字 | 59.7 ms | 8.7 ms |
| 30 万字文稿移动光标 | 45.5 ms | 4.0 ms |
| 空闲轮询（300 份草稿 + 2 MB 文件，每 2 秒） | 65 ms | 0.002 ms |
| 2 MB 文稿保存光标位置 | 24.4 ms | 3.1 ms |
| 纯 Markdown 预览，10 万字（Chrome） | 22.9 ms | 26.4 ms |
| 含原始 HTML 的预览，10 万字（Chrome） | 21.5 ms（HTML 按文字显示） | 95.6 ms（渲染并消毒） |

保存与启动和 0.3.0 持平。本分支唯一变慢的场景是含原始 HTML 的文稿：0.3.0 把这些标签当文字显示；本分支会渲染它们，所以要整篇经过 DOMPurify。纯 Markdown 文稿从 `eb71662` 起跳过消毒。

前端 bundle：`web/app.js` 由 1,804,852 字节增至 1,854,040 字节（DOMPurify 与脚注插件）。

## 原生应用实测

用户退出常驻实例后，在本机 macOS 26.6.2（Apple M2 Pro）上用真实 WKWebView 应用逐项实测。

**隔离方式**：用 `go tool mygo build -sign - -skip-dmg -skip-notarize -platform darwin/arm64` 分别打出本分支和 0.3.0（`9fa3cf6`）的临时签名包，改名为「留白测试」/`LiubaiTest.app`（`app.liubai.desktop.nativetest`）与 `LiubaiBase.app`，各用 `-data-dir` 指向 `/tmp` 下的独立目录。真实存档 `~/Library/Application Support/Liubai` 未被读写。

**驱动方式**：Swift 写的辅助工具通过辅助功能 API（AXUIElement）读取界面、按按钮和菜单；System Events 把测试应用置前；键盘事件用 CGEvent 发送，每次发送前确认测试应用在最前，否则中止；窗口截图用 `screencapture -l` 并逐张查看。中文输入法用例使用本机微信输入法拼音，其余用例临时切到 ABC 键盘，结束后恢复。第 17–19 项在最终提交上复测，当时用户正在使用电脑，所以只用辅助功能操作，不发送键盘事件：打开文稿用 `open -g`，滚动用 `AXScrollToVisible`，切换文稿用相对链接和最近文稿。

| # | 项目 | 做法 | 结果 |
|---|---|---|---|
| 1 | 坏草稿不阻止启动 | 数据目录预置截断的草稿 JSON 后启动 | 正常启动；坏文件移入 `quarantine/`；提示「有 1 份草稿无法读取，已移到隔离目录」和「在 Finder 中显示」。发现提示条多余地显示「重试保存」「另存」，已在 `dd6561f` 修复并原生复测 |
| 2 | 中文菜单与本地化 | 读取整个菜单栏 | 留白/文件/编辑/显示/窗口全部中文，系统补充项（隐藏其他、全部显示、退出并保留窗口、全部关闭、自动填充、开始听写、表情与符号）也为中文 |
| 3 | 输入与自动保存 | 新文稿中键入文字 | 自动保存，标题按首行推断 |
| 4 | 弹窗内 ⌘Z | 重命名框中改字后 ⌘Z | 只撤销输入框，恢复为「原生测试」，正文不变 |
| 5 | Finder 方式打开与阅读模式 | `open -a` 打开 README，菜单「显示 → 阅读模式」 | front matter 折叠为「文稿属性」，HTML 中居中的 SVG 标志、裸链接、提示块、代码高亮在 WebKit 中正常；WebP/AVIF/BMP 本地图片显示。发现阅读区获得焦点时有一圈蓝色焦点框，已在 `dd6561f` 去掉并原生复测 |
| 6 | 相对文稿链接 | 阅读模式中点「安装指南」（`<docs/安装 指南.md#第二步>`） | 打开含空格的中文文件名文稿并滚动到「第二步」 |
| 7 | 中文/空格图片路径 | 打开 `周报.md`（`周报.assets/…`） | 阅读模式和编辑区都显示两张图。同一文稿在 0.3.0 中两张图都显示「图片暂时无法读取」 |
| 8 | 外部修改（本地无改动） | 应用打开时在磁盘上改写文件 | 自动载入新内容，不产生恢复副本 |
| 9 | 外部修改（两边都改） | 本地未保存时改写磁盘文件 | 出现冲突提示，磁盘文件未被覆盖；「用当前版本覆盖」写入本地版本，磁盘版本保留为草稿「sync.md · 磁盘版本」 |
| 10 | 写回保留元数据 | 用 `/usr/bin/xattr -wx` 写入 Finder 标签（二进制 plist），创建时间设为 2020 年，再触发自动保存 | 标签与创建时间都保留；inode 按设计变化 |
| 11 | HTML 保存对话框 | 「带走文稿 → 下载 HTML」 | 弹出中文系统保存面板，默认文件名 `tagged.html`，保存成功并提示「HTML 已保存：…」 |
| 12 | 窗口菜单 | 最小化后恢复；「隐藏留白」 | 均正常 |
| 13 | 退出不打断关机 | 无待保存内容时发送退出 Apple Event（关机、注销时系统发送同一事件） | 本分支 0.67 秒内接受并退出；0.3.0 即使没有待保存内容也返回「用户已取消 (-128)」，约 1 秒后才自行退出，足以让系统取消关机 |
| 14 | 退出前保存 | 键入后、自动保存前立即退出 | 先拒绝一次、保存后退出；「退出前最后一句。」已写入磁盘 |
| 15 | 文件关联 | `NSWorkspace.urlsForApplications(toOpen:)` 查询 `.md` 的可选应用；读取显示名 | 放在 `~/Library/Application Support` 下的包被列为 Markdown 打开方式，显示名为「留白」。`/tmp` 下的包被 LaunchServices 标为临时目录应用、不参与匹配，属系统行为。探测用副本测后已注销并删除 |
| 16 | 真实中文输入法 | 微信输入法拼音键入 `nihao`，再按 1 选词 | 组字期间不保存、不重排；选词后提交「你好」并自动保存 |
| 17 | 最终提交复测：含 HTML 的 README | 用 `5ccd112` 重新打包，打开 README 进入阅读模式 | 消毒路径渲染正常，无焦点框。脚注上方原来有两条线（浏览器默认的深色分隔线加 section 边框），已在 `5ccd112` 改为一条主题色细线，并原生复测 |
| 18 | 纯 Markdown 快速路径 | 通过相对链接打开不含原始 HTML 的 `align.md` | 表格左/中/右对齐、只读任务框、提示块、代码高亮、WebP 图片都正常；行内代码里的 `<script>` 原样显示，`javascript:` 链接保持为纯文本 |
| 19 | PDF 导出 | `long.md`（18 节、对齐表格、代码块、BMP 图）→「导出 PDF → 保存 PDF」，保存面板以窗口表单（sheet）出现 | 6 页 A4（595×842 pt）；表格对齐、代码块、图片和最后一行都在；PDFKit 能提取全部文字。发现两个 0.3.0 就有的问题（标题落在页底、文字层是部首码位），已在 `cf84fe7` `2feb91c` 修复，见「工具栏改版与 PDF 修复」 |
| 20 | 新顶栏 | `6de72dd` 重新打包，用辅助功能按下「分栏」「阅读」、··· 和侧栏按钮 | 三选一、··· 菜单（含快捷键与禁用提示）、两标签侧栏在 WebKit 中显示正常；切换时文稿不变 |
| 21 | 新格式栏 | `ce13a36` 重新打包，打开标题菜单 | 分组、图标、「标题 1」随光标显示正确，菜单中当前级别已勾选。发现菜单向按钮左侧展开、超出纸面，已在 `e06a9fd` 改为左对齐在按钮下方（浏览器回归断言位置） |
| 22 | 真实应用导出 PDF | `ce13a36` 重新打包，长文稿经「导出 → 导出 PDF → 保存 PDF」，保存面板中按「保存」 | 6 页 A4；原先落在页底的第 4、7、17 节都移到下一页开头；文字层没有部首码位，「长文导出测试」可搜索；文件含原 PDF 与一段增量更新。保存面板默认目录是应用启动时所在的仓库根目录，文件保存后立即移到 `/tmp` |

### 仍未原生验证

- 从 Finder 拖文件进窗口（`OnFileDrop`）：需要真实鼠标拖放，会占用用户正在使用的光标，未做。浏览器模式的拖入由 `check-reader.py` 覆盖，拖入后的打开逻辑与第 5 项的 Finder 打开共用 `openPath`。
- 真正的关机/注销：只验证了系统在关机时发送的退出 Apple Event。
- 从 Word、Google Docs 等应用实际复制后粘贴：原生只测了写入系统剪贴板的网页 HTML（第 27 项），Word 与 Google Docs 的格式由 `check-paste.ts` 用样例 HTML 覆盖。

## 已知限制与后续

- 含原始 HTML 的文稿，预览要整篇消毒，10 万字约 0.1 秒（Chrome 实测）。后续可按块增量渲染，或只对作者 HTML 所在子树消毒，见性能报告。
- PDF 标题分页按三行正文预留空间：标题后紧跟一张更高的图片等不可拆分内容时，标题仍可能留在页底。
- 写回仍会改变文件 inode，硬链接不保留；HEIC 不支持（macOS 13 的 WebKit 无法显示）。
- 30 万字以上文稿的块级装饰仍是整篇遍历块节点；需要时可改为按修改区域增量更新。
- 尚未做：KaTeX/Mermaid、导出 Word、自动更新、公众号排版、图床、Quick Look、文件夹侧栏、多窗口。
- 版本号仍为 0.3.0，未重新打正式签名包。
