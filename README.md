# 留白

一页就能开始写，随时回来接着写。Mac 优先的轻量 Markdown 桌面编辑器，Go + MyGo + CodeMirror 6，界面以书写为主：顶栏以下整页都是纸面，正文栏居中。

下载：在 [Releases](https://github.com/echoVic/liubai/releases/latest) 下载 DMG，打开后把「留白」拖进「应用程序」。需要 macOS 13 或以上，支持 Apple Silicon 和 Intel；安装包已用 Developer ID 签名并经 Apple 公证。更新记录见 [CHANGELOG](CHANGELOG.md)。

## 日常使用

- 打开即写，未命名内容自动保留为本地草稿。
- 在 Finder 中双击 `.md` / `.markdown` / `.mdown` / `.mkd` 文件、使用「打开方式」或把 Markdown 文件拖进窗口，都会作为文稿打开；拖入不会把内容插入当前文稿。
- 顶部「编辑 / 分栏 / 阅读」切换视图；「外观与排版」调整主题、字号和行宽（舒适、宽阔，或随窗口铺开的全宽）；格式工具栏在顶栏下方单独一行、居中，字数显示在右下角；正文右侧有空间时显示大纲，当前章节高亮，点文字下方的空白处即可接着写。`⌘⇧R` 进入阅读模式，只显示成品视图；编辑区隐藏且只读，再按一次回到原来的布局。
- 阅读视图与「导出」渲染消毒后的内联 HTML（README 常见的居中 logo、`<details>`、`<kbd>` 等），front matter 折叠为「文稿属性」（导出时省略），支持脚注、GitHub 提示块、带协议或 `www.` 的裸链接，代码块按语言高亮。`README.md` 这类文件名不会被识别成链接。
- 阅读视图点击、编辑区 ⌘ 点击相对 `.md` 链接会打开对应文稿并跳到 `#标题`；草稿还没有保存位置时会说明原因。
- 格式工具栏按常见写作应用分组：插入菜单（与斜杠菜单相同的块）、撤销、重做；正文 / 标题 1–6，随光标显示当前级别；加粗、斜体、下划线（`<u>`）、删除线、高亮（`==文字==`）、行内代码、上标（`<sup>`）、下标（`<sub>`）、清除格式；引用、无序/有序/任务列表、减少/增加缩进（列表项连同子项移动，也可用 Tab / ⇧Tab）；链接、图片、表格、代码块、公式、图表、脚注；查找替换。新增的标记在编辑区即时呈现，阅读视图和导出同样显示。图标按钮提供中文提示，窄窗口按分组整体换行；也可以从「更多」打开「所有操作…」。
- 块编辑：鼠标移到段落、标题、列表项、表格等内容左侧会出现 ⋮⋮ 和 ＋。拖动 ⋮⋮ 调整顺序（列表项连同子项一起移动）；点 ⋮⋮ 选中整块并打开块菜单，可转换类型、复制、删除、上移下移，⇧ 点击连选多块；⌥⇧↑ / ⌥⇧↓ 用键盘移动，⌘/ 打开块菜单。所有块操作都直接修改 Markdown 原文，一步即可撤销。
- 在空行开头输入「/」（中文标点下的「、」也可以）打开插入菜单：标题、列表、任务、引用、代码块、表格、图片、分割线、提示块，可用中文、拼音首字母或英文搜索；块左侧的 ＋ 也能打开。
- 链接面板可编辑文字与地址，⌘/Ctrl 点击打开；任务可直接勾选。
- 表格就地编辑：点单元格直接输入，Tab / ⇧Tab 在单元格间移动（最后一格按 Tab 新增一行），↑↓ 同列移动，从首行、末行或按 Esc 回到正文；表格右上角的 ⋯（或 ⌘/）可插入、删除行列，设置列对齐或删除表格。每次修改只改写这张表格的 Markdown，一步即可撤销；中文组字期间不提交。
- 图片就地调整：点击图片出现选中框、右下角拖动柄和工具条，可拖动改宽度（实时显示像素），左对齐、居中、右对齐、恢复原始大小、修改说明文字或删除；Esc 回到正文，Delete 删除，Enter 修改说明。未调整的图片保持 `![说明](路径)`，调整过宽度写成 `<img src alt width>`，居中或右对齐外包 `<p align>`，编辑区、阅读视图和导出显示一致。
- `⌘/Ctrl+\` 在「编辑」与「分栏」之间切换；仅在分栏中显示格式工具栏右侧的「源码」，点击或用 `⌘/Ctrl+Shift+M` 切换左侧即时排版与完整源码，与「更多」中的「显示 Markdown 源码」同步；文字和撤销记录共用。
- 分栏时左右两栏等宽，右侧是只读成品视图。光标跨段时会跟随到对应内容块，手动滚动阅读区不会反向带动编辑区；窗口窄于 820px 时两栏改为上下排列。
- 点击顶部「侧栏」打开最近文稿与大纲，窗口宽于 1180px 时停靠在左侧、不盖住正文并记住开关，两个标签可切换，最近文稿支持搜索；悬停文稿可「从最近文稿移除」（需再点一次确认）：草稿移到数据目录的 `trash/` 保留 30 天，已有文件只从列表移除、磁盘文件不动。空的未命名草稿在切走时自动清理。点击顶部草稿标题命名，「更多」提供新建、打开、另存为、重命名、专注模式、显示 Markdown 源码和所有操作…。
- 界面支持简体中文和 English，默认跟随系统语言；「显示 → 语言」可手动切换，菜单和页面立即更新。
- 文件被其他应用修改且本地没有改动时会立即载入；打开过的文件会出现在 Dock 菜单和「文件 → 打开最近使用」里；保存失败或长时间未保存时，窗口关闭按钮显示未保存圆点。
- 桌面版随手记：在任何应用里按默认快捷键 ⌃⌥⌘N，输入想法后按 ⌘↩，每次存为一篇新草稿，主窗口继续显示原来的文稿；「更多 → 随手记设置…」可改快捷键与登录后台启动。
- 自动更新：每 4 小时在后台检查一次 GitHub Releases，有新版本时显示更新说明，可选择「安装更新」「稍后提醒我」或「跳过这个版本」；「留白 → 检查更新…」随时手动检查。留白需要放在「应用程序」或 `~/Applications` 中才能自行更新。
- 粘贴网页、文档和 Word 内容会转为 Markdown，保留表格、列表、链接、代码和图片；`⇧⌘V` 粘贴为纯文本。
- 公式：行内 `$…$`、整段 `$$…$$` 和 ` ```math ` 代码块用 KaTeX 排版（规则与 GitHub 一致，金额不会被当作公式），光标移入时显示源码；阅读视图和 PDF 用同样的排版，导出的 HTML 与富文本复制使用 MathML。
- 图表：` ```mermaid ` 代码块显示为图，配色跟随主题，导出时内嵌 SVG；图表组件只在文稿含有图表时加载。
- 提示块 `> [!NOTE]` 等在编辑区按类型着色；`<details>` 折叠块可在编辑区折叠，折叠不写入文件；脚注可从工具栏插入，悬停预览，⌘ 点击跳到定义。
- 粘贴或拖入 PNG / JPEG / GIF / WebP / SVG / AVIF / BMP，图片直接显示在正文中；用键盘把光标移到图片所在行时显示原文。中文或带空格路径的本地图片（包括 Typora 生成的 `文稿名.assets/`）可以正常显示。
- 「导出」集中提供 Markdown、图片 ZIP、PDF、Word 文稿（.docx）、富文本复制和含本地图片的 HTML。交付使用整篇文稿，不受编辑器可视区域限制。
- Word 导出可交给使用 Word、Pages 或 WPS 的人继续编辑；也可从「所有操作… → 导出 Word 文稿」进入。保留 Word 标题 1–6、真实列表编号、表格、链接、图片、常见公式和脚注；正文为 Times New Roman / 宋体 11 pt、1.5 倍行距，标题用黑体。提示块保留底色与标题，任务用 ☐/☑，折叠块展开。PNG/JPEG/GIF 原样嵌入，其他图片转为 PNG，Mermaid 以 2 倍分辨率转为 PNG。常见 MathML 转为可编辑的 Word 公式，不支持的结构保留等宽 TeX 源码；本地文稿链接保留文字。Word 转换组件仅在保存或下载 Word 时加载，桌面版使用系统保存面板，网页版直接下载。
- 导出的 PDF 会将标题与后续正文保持在同一页，中文可正常复制和搜索。
- 布局、分栏左侧编辑方式、主题、字号和行宽都是全局偏好，对新文稿和最近文稿继续生效。纸白、暖纸、雾绿、夜墨四主题首次跟随系统，手动选择后记住选择。
- 专注模式突出正在写的段落，淡化其余文字与工具；按 Esc 返回。
- 字数按中文字、日文假名和韩文字逐个计、其他文字按词计，不计 Markdown 标记、链接地址、HTML 标签和 front matter，输入停顿后更新。

常用快捷键：⌘N 新建、⌘O 打开、⌘S 保存、⌘⇧S 另存、⌘K 所有操作…、⌘F 查找、⌘\ 切换分栏、⌘⇧R 阅读模式、⌘⇧M 显示 Markdown 源码、⌘B 加粗、⌘U 下划线、⌘L 编辑链接、⌘⇧F 专注模式、⌘P 导出 PDF、⌘Z 撤销（在输入框里只撤销输入框）、⌘W 关闭窗口、⌘H 隐藏、⌘M 最小化、⌃⌘F 全屏。Windows/Linux 浏览器开发时使用对应的 Ctrl 组合键。

## 文件和恢复

只读文件不会被覆盖，修改保留在草稿中，直到文件恢复可写后重试保存或另存到其他位置。

草稿保存在 `~/Library/Application Support/Liubai/` 下，索引、文稿及图片分离存储，原子写入；光标和滚动位置单独写入小文件 `positions.json`，不会因阅读或移动光标重写整篇草稿。无法读取的草稿或索引会移到 `quarantine/`，应用照常启动并提示，可在 Finder 中查看。

已保存文件继续写回原路径，写回时保留 Finder 标签等扩展属性和创建时间（文件 inode 仍会变化，硬链接不保留）；草稿保存成功与原文件写入失败会分别说明，⌘S 或「重试保存」会重新写入原文件。文件在外部被修改（如 git pull、其他编辑器）而本地没有改动时，自动载入新版本；两边都改过时暂停自动写入，可以载入磁盘版本（本地改动先存为恢复副本）或「用当前版本覆盖」（磁盘内容先存为「· 磁盘版本」草稿）。文件大小、修改时间和 inode 都没变时不读取文件，窗口不可见时不检查。

普通关闭不会删除草稿。中文组合输入期间暂缓保存和排版，候选确认后再保存；仅移动光标不会显示正文正在保存。没有未保存输入时，退出、关窗和系统关机会直接放行；仍有未保存输入时先保存，保存失败才保留编辑器，提供重试、保存当前恢复副本、继续编辑或明确放弃。文件冲突或原文件写入失败不会阻止退出（草稿已保存）。恢复副本携带可读取的本地图片，不覆盖原文稿。

粘贴的图片以内容摘要命名，先随草稿保留。保存 .md 时放入 `文稿名.assets/`，使用可读的相对路径（含空格或括号时写成 `<…>`）。另存到原目录（包括原路径）时不改动已有的图片引用；另存到其他目录时把读得到的本地图片复制到 `新文稿名.assets/` 并保留原文件名（重名依次加 `-2`、`-3`）；缺失的图片不会阻止另存，引用保持原样。打包使用独立副本与 `images/`，内联 HTML 图片按原相对路径放入 ZIP，不修改原文件。删除图片引用保留资源以支持撤销。恢复和撤销资源目前不自动清理。

支持 UTF-8、UTF-8 BOM、LF 和 CRLF 文稿。未修改的文件不会只因改变选区、主题或编辑视图而被重写。文稿上限 8 MB；单图片 20 MB、最长边 16000 像素。

## 开发

运行时无需 Node、Bun 或联网下载依赖。`web/` 是提交到源码的嵌入前端，`src/` 是可维护的原始 TypeScript/CSS。

开发依赖：Go 1.27.1（可自动获取工具链）、Node 24、Bun。安装前端依赖使用 `bun install --frozen-lockfile`；构建前端使用 `node scripts/build.mjs`；桌面运行使用 `go run .`。

本地浏览器开发：`go run . --web 127.0.0.1:4193 --data-dir /tmp/liubai-development`。这里调用同一套真实草稿后端，但浏览器通过导入/下载文件代替系统对话框。只允许回环绑定、同源 JSON 请求；使用单独存档。

可复现验证：

```sh
go test ./...
go vet ./...
node_modules/.bin/tsc --noEmit
node scripts/check-i18n.mjs
node scripts/check-editor.mjs
bun scripts/check-capture-input.ts
npx --yes bun@1.4.3 scripts/check-editing.ts
npx --yes bun@1.4.3 scripts/check-rendering.ts
npx --yes bun@1.4.3 scripts/check-performance.ts
python3 scripts/check-preview.py
python3 scripts/check-pdf.py
node scripts/build.mjs
scripts/e2e.sh check-split-preview
scripts/e2e.sh check-reader
scripts/e2e.sh check-toolbar
scripts/e2e.sh check-capture
scripts/e2e.sh check-english
scripts/e2e.sh check-blocks
scripts/e2e.sh check-tables
scripts/e2e.sh check-images
scripts/e2e.sh check-math
scripts/e2e.sh check-mermaid
scripts/e2e.sh check-extras
scripts/e2e.sh check-blocks-webkit   # 块操作、表格输入、图片拖动柄、公式字体与图表在 WebKit（桌面版引擎）中的表现
npx --yes bun@1.4.3 scripts/check-blocks.ts
npx --yes bun@1.4.3 scripts/check-slash.ts
npx --yes bun@1.4.3 scripts/check-tables.ts
npx --yes bun@1.4.3 scripts/check-images.ts
npx --yes bun@1.4.3 scripts/check-marks.ts
npx --yes bun@1.4.3 scripts/check-math.ts
npx --yes bun@1.4.3 scripts/check-mermaid.ts
npx --yes bun@1.4.3 scripts/check-extras.ts
```

`scripts/e2e.sh` 为每项浏览器回归编译一次程序，用新的数据目录启动本地网页服务，跑完后关闭。Python 浏览器回归使用已安装的 Chrome channel，不下载 Playwright Chromium。应用依赖 macOS 13 或以上。

性能对比：`ROUNDS=2 scripts/bench/run.sh 29925c3 docs/performance/raw/<日期>` 在同一台机器上交替运行 0.3.0 与当前工作区的编辑、预览、存储基准，并生成 `summary.md`，约 8 分钟。存储基准也可单独运行：`go test -tags perf -run '^$' -bench . -benchtime 20x .`，普通 `go test` 不会运行它们。

构建 Mac 通用安装包：先运行 `node scripts/build.mjs`，再运行 `go tool mygo build -platform darwin/universal .`。产物为 `build/darwin-universal/Liubai.app` 和 `build/darwin-universal/Liubai 0.4.0.dmg`，同时支持 Apple Silicon 和 Intel。`mygo.json` 已配置 Developer ID 正式签名与 Apple 公证；构建机需要对应证书及钥匙串中的 `clipnest-notary` 公证凭据，密码不写入仓库。构建会启用 hardened runtime、添加安全时间戳，并将公证票据附加到应用和 DMG。

自动更新由 `mygo.json` 的 `updates` 配置（公钥和发布仓库）。签名更新包的私钥不在仓库和配置里，发布时通过环境变量传入：`MYGO_UPDATER_PRIVATE_KEY="$(cat <私钥文件>)" go tool mygo build -platform darwin/universal -upload .`；没有私钥时照常构建，只是不生成更新包。更新说明取自 `CHANGELOG.md` 中当前版本的段落，缺少该段落时构建失败。`go tool mygo build -platform darwin/universal -upload .` 把 DMG、更新包和更新清单上传到当前版本的 GitHub Release 草稿；发布为最新版本后，已安装的应用就会检测到更新。

签名与公证验证：对应用运行 `codesign --verify --deep --strict` 和 `spctl -a -t exec -vv`，对 DMG 运行 `spctl -a -t open --context context:primary-signature -vv`；分别运行 `xcrun stapler validate` 检查应用和 DMG 的公证票据。`scripts/package-macos.sh` 仅生成未公证的临时预览 ZIP，会重新签名，不应用于正式签名的应用。

## 0.1.1

新增自动更新。0.1.0 没有更新功能，需要手动下载一次 0.1.1，之后的新版本会在应用内提示。正式通用包 `Liubai 0.1.1.dmg` 由 `v0.1.1` 标签所在的提交构建，已完成 Developer ID 签名与 Apple 公证，发布在 [GitHub Releases](https://github.com/echoVic/liubai/releases/tag/v0.1.1)。

## 0.1.0（首个公开版本）

0.1.0 是首个公开版本，在未公开的内部版本 0.3.0 之上修复评审中复现的 6 个可靠性问题（中文/空格图片路径、坏草稿导致闪退、写回丢 Finder 标签、另存为改写图片引用、外部修改处理、退出打断关机），降低长文与多草稿下的开销（10 万字文稿每输入一个字由约 25 ms 降到约 2.6 ms，300 份草稿时的空闲轮询由约 65 ms 降到约 2 µs），并补齐阅读器入口与渲染；工具栏按常见写作应用重排（编辑/分栏/阅读、侧栏、导出、更多），PDF 导出修正了标题落在页底和中文复制、搜索不匹配的问题。随后升级到 MyGo 0.5.5，接入文件监听、系统最近文稿和未保存标记，新增富文本粘贴转 Markdown、随手记和英文界面，只读文件不再被自动保存覆盖；是否整体迁移到 MyGo Documents 的评估见 [评估](docs/superpowers/specs/2026-10-16-mygo-documents-evaluation.md)。设计见 [规格](docs/superpowers/specs/2026-10-15-reader-foundation-design.md)；命令、原生应用实测与剩余边界见 [验证记录](docs/superpowers/validation/2026-10-15-reader-foundation.md)；与 0.3.0 的对比数据见 [性能测试报告](docs/performance/2026-10-15-reader-foundation.md)。

正式通用包 `Liubai 0.1.0.dmg` 由 `v0.1.0` 标签所在的提交构建，已完成 Developer ID 签名与 Apple 公证，发布在 [GitHub Releases](https://github.com/echoVic/liubai/releases/tag/v0.1.0)。签名、Gatekeeper、公证票据与 DMG 完整性检查见验证记录。

## 内部版本 0.3.0 验证边界

本轮新增全局记忆的分栏阅读预览。自动化验证覆盖共享 Markdown/交付 DOM、主模式与分栏源码切换、CodeMirror 撤销历史、跨块光标软跟随、手动阅读滚动独立、合成 composition 保护、重载/新文稿/最近文稿偏好、换稿后的过期图片结果隔离、本地图片导入与 HTML 导出、四主题/字号，以及 1440/1120/800/680px 长代码和表格布局。

最终审查及修复复核已通过，补齐了空白分隔行的前置块定位，并验证重载、新建、Recent 与同 ID 载入均只渲染一次预览。[完整验证记录](docs/superpowers/validation/2026-10-15-split-preview.md)包含命令、截图和实施取舍。

正式通用包已完成 Developer ID 签名与 Apple 公证，位于 `build/preview-0.3.0/darwin-universal/Liubai 0.3.0.dmg`（约 7.83 MiB）。应用和 DMG 的签名、Gatekeeper、公证票据与 DMG 完整性检查均通过；支持 Apple Silicon 和 Intel，最低 macOS 13。原 0.2.0 产物保持不变。

这些浏览器检查不等同于 Mac 原生中文输入法候选验证，也没有验证系统 PDF 对话框与最终分页、跨应用富文本粘贴。

即时排版使用 CodeMirror 装饰而不重序列化 Markdown。图片/表格在光标离开相关区块后预览。复杂跨行图片语法或扩展语法保留源码，无法安全转换资源时停止保存并提示。外部图片在编辑区保持原链接且可能联网加载；ZIP 保留原引用，PDF、Word、HTML 与富文本中转为可点击链接，准备交付时不抓取外部图片。缺失图片会提示处理或明确继续；图文准备上限为 48 MB，较大文稿可使用 ZIP。接收应用对富文本与内嵌图片的支持不同。

没有广告、遥测和云同步；检查更新只访问 GitHub Releases。内存、启动速度及包体大小以实测记录为准。

## 许可

留白以 [MIT 许可](LICENSE) 开源。第三方依赖的许可汇总在 `web/THIRD_PARTY_NOTICES.txt`，随应用嵌入。
