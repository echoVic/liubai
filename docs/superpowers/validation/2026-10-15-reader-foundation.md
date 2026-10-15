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
python3 scripts/check-preview.py
node scripts/build.mjs
python3 scripts/check-split-preview.py http://127.0.0.1:<port>   # 新数据目录
python3 scripts/check-reader.py http://127.0.0.1:<port>          # 新数据目录
go tool mygo build -sign - -skip-dmg -skip-notarize -platform darwin/arm64 -o /tmp/liubai-bundle-check .
```

浏览器回归输出：

```text
PASS: rendering, readonly tasks, modes/history, separator soft follow, one-render reload/new/Recent/same-ID load, synthetic composition guard, stale image isolation, themes, local images/HTML export, responsive layout
PASS: notice banner, reader rendering, reading mode, focus mode, position saves/word count, status reload/conflict, draft cleanup/removal, drop to open, relative links
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

## 编排者在 Codex 实现之上的修正

- 任务 3：设置创建时间改为尽力而为。原实现失败时会让整次保存失败，exFAT、部分网络共享不支持创建时间，自动保存会因此出错。
- 任务 5：`TestPreserveUneditedCRLFBOMAndConflict` 改为用编辑器所见的旧 revision 直接调用 `Update`；`edit()` 先调 `State()`，新逻辑下会先自动载入磁盘版本，原断言全部保留。
- 任务 7：本机负载很高时单次计时波动大，性能检查改为取多批次最好值；30 万字预算由 12 ms 调为 15 ms（其中约 4 ms 是 CodeMirror 自身的增量解析）。尝试过的一处微优化没有可测收益，未保留。
- 任务 8：`save(force)`。仅位置变化走 `SavePosition` 后，原文件写入失败时 ⌘S /「重试保存」会只保存位置而不重写文件；显式保存现在强制重发正文。
- 任务 9：启动和切换文稿时的自动清理改为尽力而为，清理失败不再阻止启动或切换；手动移除仍报告错误。
- 预览按需消毒：Codex 实现「无原始 HTML 时跳过 DOMPurify」后，纯 Markdown 路径保留表格列对齐（`style="text-align:…"`），消毒路径却删掉它，同一张表会因文中有无 HTML 而显示不同；0.3.0 保留对齐。改为在消毒钩子中只放行 `th`/`td` 上的 `text-align`，并补充两条路径的断言（去掉钩子时断言失败）。
- 任务 12：DOMPurify 会按 URI 规则校验所有非 URI 安全属性，`data-image-source="liubai-asset:…"` 被当作未知协议删除，草稿中粘贴的图片在预览里不显示。把内部 `data-*` 属性标为 URI 安全（加载仍受解析器与后端白名单约束），并新增修复前失败、修复后通过的回归断言。

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
| 19 | PDF 导出 | `long.md`（18 节、对齐表格、代码块、BMP 图）→「导出 PDF → 保存 PDF」，保存面板以窗口表单（sheet）出现 | 6 页 A4（595×842 pt）；表格对齐、代码块、图片和最后一行都在；PDFKit 能提取全部文字。发现两个 0.3.0 就有的问题，见「已知限制」 |

### 仍未原生验证

- 从 Finder 拖文件进窗口（`OnFileDrop`）：需要真实鼠标拖放，会占用用户正在使用的光标，未做。浏览器模式的拖入由 `check-reader.py` 覆盖，拖入后的打开逻辑与第 5 项的 Finder 打开共用 `openPath`。
- 真正的关机/注销：只验证了系统在关机时发送的退出 Apple Event。
- 跨应用富文本粘贴。

## 已知限制与后续

- 含原始 HTML 的文稿，预览要整篇消毒，10 万字约 0.1 秒（Chrome 实测）。后续可按块增量渲染，或只对作者 HTML 所在子树消毒，见性能报告。
- PDF 导出（0.3.0 起就有）：标题可能落在页底，正文却在下一页（实测第 4、7、17 节）。原因是 `.delivery-document h1–h3{break-after:avoid}` 在 WebKit 分页中不生效。
- PDF 导出（0.3.0 起就有）：文字层里部分常用字被记成部首码位，例如「长」记为 U+2ED3「⻓」，「文」记为 U+2F42「⽂」；本次样本中还有一、用、白、工、面、行、页、片。从 PDF 复制出的文字、以及在 PDF 中搜索「长文」都会对不上。这在苹方字体经 WebKit 生成 PDF 时出现，可换字体后用 PDFKit 复查。
- 写回仍会改变文件 inode，硬链接不保留；HEIC 不支持（macOS 13 的 WebKit 无法显示）。
- 30 万字以上文稿的块级装饰仍是整篇遍历块节点；需要时可改为按修改区域增量更新。
- 本轮未做：KaTeX/Mermaid、网页富文本粘贴转 Markdown、导出 Word、自动更新、公众号排版、图床、Quick Look、文件夹侧栏、多窗口。
- 版本号仍为 0.3.0，未重新打正式签名包。
