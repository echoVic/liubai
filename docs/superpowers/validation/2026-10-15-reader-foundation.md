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
PASS: reader rendering, reading mode, focus mode, position saves/word count, status reload/conflict, draft cleanup/removal, drop to open, relative links
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

## 编排者在 Codex 实现之上的修正

- 任务 3：设置创建时间改为尽力而为。原实现失败时会让整次保存失败，exFAT、部分网络共享不支持创建时间，自动保存会因此出错。
- 任务 5：`TestPreserveUneditedCRLFBOMAndConflict` 改为用编辑器所见的旧 revision 直接调用 `Update`；`edit()` 先调 `State()`，新逻辑下会先自动载入磁盘版本，原断言全部保留。
- 任务 7：本机负载很高时单次计时波动大，性能检查改为取多批次最好值；30 万字预算由 12 ms 调为 15 ms（其中约 4 ms 是 CodeMirror 自身的增量解析）。尝试过的一处微优化没有可测收益，未保留。
- 任务 8：`save(force)`。仅位置变化走 `SavePosition` 后，原文件写入失败时 ⌘S /「重试保存」会只保存位置而不重写文件；显式保存现在强制重发正文。
- 任务 9：启动和切换文稿时的自动清理改为尽力而为，清理失败不再阻止启动或切换；手动移除仍报告错误。
- 任务 12：DOMPurify 会按 URI 规则校验所有非 URI 安全属性，`data-image-source="liubai-asset:…"` 被当作未知协议删除，草稿中粘贴的图片在预览里不显示。把内部 `data-*` 属性标为 URI 安全（加载仍受解析器与后端白名单约束），并新增修复前失败、修复后通过的回归断言。

## 性能实测（本机 Apple Silicon，JavaScriptCore，取多批次最好值）

| 场景 | 0.3.0 | 本分支 |
|---|---|---|
| 10 万字每次按键（解析 + 即时排版装饰） | 约 40 ms | 约 3 ms |
| 30 万字每次按键 | 约 110 ms | 约 11 ms |
| 字数统计 | 每键整篇统计 | 输入停顿 400 ms 后统计一次 |
| 空闲轮询 | 每 2 秒处理全部草稿全文并回传整篇（300 份草稿约 68 ms/次） | `Status(id)`：元数据不变时只做一次 `stat`，窗口不可见时不轮询 |
| 移动光标、滚动 | 整篇草稿 JSON 带 fsync 重写 | 只写 `positions.json`（不 fsync） |
| 文件型文稿保存 | 3 次原子写 | 2 次原子写 |

前端 bundle：`web/app.js` 由 1,804,852 字节增至 1,853,440 字节（DOMPurify 与脚注插件）。

## 原生验证边界

以下项目没有在原生 WKWebView 应用中实测（本机仍在运行 0.2.0 实例，单实例锁会让新构建直接退出）：

- 系统关机/注销不再被打断：Apple Event 路径只经代码与 `quitAllowed` 单元测试覆盖。
- Finder 双击、「打开方式」、从 Finder 拖入窗口：只验证了包内 `CFBundleDocumentTypes` 和浏览器模式下的拖入；LaunchServices 注册与 `OnFileDrop` 未实测。
- 中文菜单、⌘H/⌘M/全屏、弹窗输入框内 ⌘Z、HTML 保存对话框、Finder/Dock 显示名「留白」、系统对话框语言。
- Finder 中的标签显示：xattr 层面由 Go 测试覆盖。
- WebKit 中的 WebP/SVG/AVIF 显示与代码高亮配色：浏览器回归跑在 Chrome。
- 真实中文输入法候选：仍为合成 composition 事件。

## 已知限制与后续

- 写回仍会改变文件 inode，硬链接不保留；HEIC 不支持（macOS 13 的 WebKit 无法显示）。
- 30 万字以上文稿的块级装饰仍是整篇遍历块节点；需要时可改为按修改区域增量更新。
- 本轮未做：KaTeX/Mermaid、网页富文本粘贴转 Markdown、导出 Word、自动更新、公众号排版、图床、Quick Look、文件夹侧栏、多窗口。
- 版本号仍为 0.3.0，未重新打正式签名包。
