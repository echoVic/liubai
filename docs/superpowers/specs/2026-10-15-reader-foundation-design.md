# 留白 0.4：可靠性、性能与阅读器基础 设计

**日期**：2026-10-15
**状态**：已实现并验证（实现由本机 Codex 逐任务完成，编排审查与验证见验证记录）
**基线**：`feat/split-preview` @ `9fa3cf6`（0.3.0）
**实施计划**：[2026-10-15-reader-foundation.md](../plans/2026-10-15-reader-foundation.md)
**验证记录**：[2026-10-15-reader-foundation.md](../validation/2026-10-15-reader-foundation.md)

## 背景

2026-10-15 对 0.3.0 的评审（起因是 egoist/mygo#274 想要「markdown 阅读器和实时编辑器，界面美观简洁」）结论：写作链路完整，但「打开一个现成的 .md 来读」走不通；另有 6 个已复现的可靠性问题、长文与多草稿下的性能问题和若干体验问题。本轮按评审给出的顺序处理：可靠性 → 性能 → 体验 → 阅读器 P0。

## 目标

1. 评审中复现的 6 个问题全部修复，并转为回归测试。
2. 10 万字文稿每次按键的即时排版开销 < 5 ms，30 万字 < 15 ms（其中约 4 ms 是 CodeMirror 自身的增量解析）；空闲时不再整篇轮询，光标与滚动不再整篇重写草稿。
3. Finder 双击、拖入窗口、相对链接都能打开 Markdown；真实 README（内联 HTML、front matter、脚注、提示块、裸链接、代码块、SVG/WebP 图片）能正确阅读；文件被外部修改且本地未改时自动载入。

## 本轮不做

KaTeX/Mermaid、网页富文本粘贴转 Markdown、导出 Word、自动更新、公众号排版、图床、Quick Look、文件夹侧栏、多窗口/标签页、改用 MyGo 生成的 typed bindings、下载 Playwright WebKit。它们留到后续迭代。

## 关键决策

| # | 决策点 | 选择 | 理由 |
|---|--------|------|------|
| 1 | 图片路径比对 | 后端按 percent-decode 后的规范形式比对引用；新写入的图片路径用可读 UTF-8，含空格或括号时写成 `<…>`，`<`、`>` 转义为 `%3C`、`%3E` | 前端 markdown-it 会规范化路径，后端 goldmark 保留原文，两边必须按同一规范比对；旧文稿里的 `%E5…` 写法继续可用 |
| 2 | 损坏数据 | 无法读取的草稿或索引移到 `<数据目录>/quarantine/` 后继续启动，首次 `State()` 返回提示，界面横幅可在 Finder 中显示；数据目录本身不可用时弹原生错误框再退出 | 一个坏文件不应让应用无法启动 |
| 3 | 写回元数据 | macOS 上写回前把原文件的扩展属性（含 Finder 标签）和创建时间复制到临时文件，再原子 rename；用 `golang.org/x/sys/unix` | 保留原子写的安全性，同时不丢元数据；inode 仍会变化（硬链接不保留），记为已知限制 |
| 4 | 另存为 | 新位置与原文稿同目录（含原路径）时不改用户图片引用；换目录时把读得到的本地图片复制到 `新文稿名.assets/`，保留原文件名（重名依次加 `-2`、`-3`），粘贴图仍用摘要名；缺失图片不再阻止另存 | 保留「另存的文稿能带着图片走」的既有设计（已有测试覆盖），同时不再无故改写用户路径和文件名 |
| 5 | 外部修改 | 草稿自上次与磁盘同步后没有改动 → 自动载入磁盘新版本，不生成恢复副本；双方都改 → 冲突，横幅新增「用当前版本覆盖」，覆盖前把磁盘版本存成「· 磁盘版本」草稿；文件大小、修改时间、inode 都没变时不读文件 | git pull、AI 生成文档等场景要能边看边刷新；只有真冲突才打扰用户 |
| 6 | 退出与关机 | 前端把「有未落盘内容」同步给 Go（`SetPending`）；干净时直接放行退出、关窗和系统关机，只有确有未保存内容才拦截；冲突或原文件写入失败不再阻止退出（草稿已保存） | 现在每次关机都会被留白打断 |
| 7 | 即时排版 | 行内装饰改为只计算可视区的 ViewPlugin；图片、表格块级组件留在 StateField，但只遍历块级节点；热路径不再调用 markdown-it | 现在每次按键全文重建，10 万字约 40 ms |
| 8 | 位置与保存 | 光标/滚动只写 `positions.json`（小文件、不 fsync），不重写草稿；文件型文稿正文保存先写原文件、再写一次草稿（3 次原子写降为 2 次） | 阅读时滚动不应触发整篇写盘 |
| 9 | 轮询 | 改为 `Status(id)`，只返回状态、不含正文；窗口不可见时不轮询，重新可见或聚焦时立即检查一次 | 现在每 2 秒处理全部草稿全文并经 IPC 送回整篇 |
| 10 | 字数 | 汉字/假名/谚文按字、其他按词，不计 Markdown 标记、链接地址、HTML 标签和 front matter；输入停顿 400 ms 后更新 | 现在每键全文统计，且把语法和 URL 算进字数 |
| 11 | 草稿删除 | 最近文稿可移除；草稿与图片移到 `<数据目录>/trash/` 保留 30 天；文件型文稿只从列表移除、不碰磁盘文件；空的未命名草稿在切走或启动时自动清理（同样进 trash） | 草稿目前只增不减 |
| 12 | 菜单与本地化 | 角色菜单项用中文标签；补齐隐藏、最小化、缩放、全屏、关闭窗口；撤销/重做在输入框内作用于输入框本身；Info.plist 声明中文本地化与本地化显示名「留白」 | Mac 原生习惯；避免在弹窗里按 ⌘Z 撤销正文 |
| 13 | 阅读渲染 | 内联 HTML 经 DOMPurify 白名单消毒后渲染（禁止 style、脚本、事件属性、`javascript:`）；front matter 在阅读视图折叠显示、导出时省略；只把带协议或 `www.` 的地址自动链接（避免 `README.md` 被识别成域名）；脚注；GitHub 提示块；阅读视图代码高亮（复用已打包的 CodeMirror 语言包） | 让真实 README 读起来正确，同时不降低安全边界 |
| 14 | 图片格式 | 新增 WebP、SVG、AVIF、BMP；能读出尺寸的格式仍限制最长边 16000 px；HEIC 不支持（macOS 13 的 WebKit 无法显示） | README 里大量 SVG/WebP |
| 15 | 打开入口 | 声明 `.md/.markdown/.mdown/.mkd` 文件关联；拖入 Markdown 文件即打开；阅读视图点击或编辑区 ⌘ 点击相对 `.md` 链接时打开对应文稿并跳到 `#标题` | 评审的阅读器 P0 |
| 16 | 阅读模式 | 新增布局 `read`（只显示阅读视图），⌘⇧R 进出，与其他布局一样是全局偏好 | 只读不编辑的场景 |

## 数据与接口变更

### 存储（均向后兼容）

- `drafts/<id>.json`：`Document` 新增 `diskSize`、`diskModTime`、`diskInode`、`excerpt`，旧草稿缺省时按需补算。
- 新增 `positions.json`：`{id: Position}`，加载时覆盖草稿内的 position。
- 新增 `quarantine/`（损坏数据）与 `trash/`（删除的草稿，启动时清理 30 天前的条目）。

### Go 绑定（Desktop）

新增：`Status(id) DocStatus`、`Overwrite(id) WorkspaceState`、`SavePosition(id, position)`、`Delete(id) WorkspaceState`、`OpenLinked(id, href) WorkspaceState`、`SetPending(pending)`、`SaveHTML(title, html) ExportResult`。浏览器开发模式的 `/api` 同步支持这些方法（`OpenLinked`、`Overwrite` 在没有文件路径时返回错误，`SetPending` 为空操作，`SaveHTML` 不提供，浏览器继续用下载）。

### 事件

新增 `liubai:open-failed`，载荷 `{path, error}`。

### 结构

`ImageResult.markdown`（插入正文时使用的目标写法）、`WorkspaceState.notices` 与 `quarantineDir`、`Appearance.layout` 新增 `read`、`DocStatus{id, revision, conflict, status}`。

## 验收

- `go test ./...`、`go vet ./...`、`tsc --noEmit`、全部 `scripts/check-*` 与浏览器分栏回归通过。
- 新增 `scripts/check-performance.ts`：10 万字每键 < 5 ms、30 万字 < 15 ms（块级字段更新 + 可视区行内构建，取多批次最好值）。
- 评审中的复现用例全部转为回归测试。
- 原生验证（输入法候选、关机、菜单、拖入、文件关联、Finder 标签）单独记录在验证文档；无法自动化的项目明确标注。
