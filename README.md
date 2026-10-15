# 留白

一页就能开始写，随时回来接着写。Mac 优先的轻量 Markdown 桌面编辑器，Go + MyGo + CodeMirror 6，界面基于确认过的「一页写作桌」原型。

## 日常使用

- 打开即写，未命名内容自动保留为本地草稿。
- 格式工具栏支持标题、强调、引用、列表、任务、代码、链接、图片和表格；也可以使用操作搜索。
- 链接面板可编辑文字与地址，⌘/Ctrl 点击打开；任务可直接勾选，表格面板支持编辑单元格、增加行列与整次撤销。
- `⌘/Ctrl+\` 在单栏即时排版与分栏预览之间切换；分栏左侧可用 `⌘/Ctrl+Shift+M` 切换即时排版与完整源码，文字和撤销记录共用。
- 分栏右侧是只读成品视图。光标跨段时会跟随到对应内容块，手动滚动阅读区不会反向带动编辑区；窗口窄于 820px 时两栏改为上下排列。
- 点击「留白」打开最近文稿，支持搜索；点击顶部草稿标题命名，大纲和操作搜索按需展开。
- 粘贴或拖入 PNG / JPEG / GIF，光标移开后显示图片预览。
- 「带走文稿」集中提供 Markdown、图片 ZIP、PDF、富文本复制和含本地图片的 HTML。交付使用整篇文稿，不受编辑器可视区域限制。
- 布局、分栏左侧编辑方式、主题、字号和行宽都是全局偏好，对新文稿和最近文稿继续生效。纸白、暖纸、雾绿、夜墨四主题首次跟随系统，手动选择后记住选择。
- 段落专注突出正在写的段落，淡化其余文字与工具；按 Esc 返回。

常用快捷键：⌘N 新建、⌘O 打开、⌘S 保存、⌘⇧S 另存、⌘K 操作搜索、⌘F 查找、⌘\ 切换主布局、⌘⇧M 切换分栏左侧源码、⌘B 加粗、⌘L 编辑链接、⌘⇧F 段落专注、⌘P 导出 PDF、⌘Z 撤销。Windows/Linux 浏览器开发时使用对应的 Ctrl 组合键。

## 文件和恢复

草稿保存在 `~/Library/Application Support/Liubai/` 下，索引、文稿及图片分离存储，原子写入。已保存文件继续写回原路径；草稿保存成功与原文件写入失败会分别说明。外部文件变化会暂停自动覆盖，允许将当前文稿另存或载入磁盘版本，载入前保存恢复副本。

普通关闭不会删除草稿。中文组合输入期间暂缓保存和排版，候选确认后再保存；仅移动光标不会显示正文正在保存。退出前先保存最新内容；保存失败时保留编辑器，提供重试、保存当前恢复副本、继续编辑或明确放弃。恢复副本携带可读取的本地图片，不覆盖原文稿。

图片以内容摘要命名，先随草稿保留。保存 .md 时放入 `文稿名.assets/`，使用相对路径；打包使用独立副本与 `images/`，不修改原文件。删除图片引用保留资源以支持撤销。恢复和撤销资源目前不自动清理。

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
node scripts/check-editor.mjs
npx --yes bun@1.4.3 scripts/check-editing.ts
npx --yes bun@1.4.3 scripts/check-rendering.ts
python3 scripts/check-preview.py
node scripts/build.mjs
go build -o /tmp/liubai-preview-acceptance .
data_dir="$(mktemp -d /tmp/liubai-preview-data.XXXXXX)"
python3 $WEBAPP_TESTING/scripts/with_server.py \
  --server "/tmp/liubai-preview-acceptance -web 127.0.0.1:4195 -data-dir $data_dir" \
  --port 4195 -- python3 scripts/check-split-preview.py http://127.0.0.1:4195
```

Python 浏览器回归使用已安装的 Chrome channel，不下载 Playwright Chromium。应用依赖 macOS 13 或以上。

构建 Mac 通用安装包：先运行 `node scripts/build.mjs`，再运行 `go tool mygo build -platform darwin/universal .`。产物为 `build/darwin-universal/Liubai.app` 和 `build/darwin-universal/Liubai 0.3.0.dmg`，同时支持 Apple Silicon 和 Intel。`mygo.json` 已配置 Developer ID 正式签名与 Apple 公证；构建机需要对应证书及钥匙串中的 `clipnest-notary` 公证凭据，密码不写入仓库。构建会启用 hardened runtime、添加安全时间戳，并将公证票据附加到应用和 DMG。

签名与公证验证：对应用运行 `codesign --verify --deep --strict` 和 `spctl -a -t exec -vv`，对 DMG 运行 `spctl -a -t open --context context:primary-signature -vv`；分别运行 `xcrun stapler validate` 检查应用和 DMG 的公证票据。`scripts/package-macos.sh` 仅生成未公证的临时预览 ZIP，会重新签名，不应用于正式签名的应用。

## 0.3.0 验证边界

本轮新增全局记忆的分栏阅读预览。自动化验证覆盖共享 Markdown/交付 DOM、主模式与分栏源码切换、CodeMirror 撤销历史、跨块光标软跟随、手动阅读滚动独立、合成 composition 保护、重载/新文稿/最近文稿偏好、换稿后的过期图片结果隔离、本地图片导入与 HTML 导出、四主题/字号，以及 1440/1120/800/680px 长代码和表格布局。

最终审查及修复复核已通过，补齐了空白分隔行的前置块定位，并验证重载、新建、Recent 与同 ID 载入均只渲染一次预览。[完整验证记录](docs/superpowers/validation/2026-10-15-split-preview.md)包含命令、截图和实施取舍。

这些浏览器检查不等同于 Mac 原生中文输入法候选验证，也没有验证系统 PDF 对话框与最终分页、跨应用富文本粘贴。正式通用包已完成双架构编译，当前在独立目录 `build/preview-0.3.0` 等待 macOS 钥匙串签名授权；签名、公证、Gatekeeper 与票据验证尚未完成。

即时排版使用 CodeMirror 装饰而不重序列化 Markdown。图片/表格在光标离开相关区块后预览。复杂跨行图片语法或扩展语法保留源码，无法安全转换资源时停止保存并提示。外部图片在编辑区保持原链接且可能联网加载；ZIP 保留原引用，PDF、HTML 与富文本中转为可点击链接，准备交付时不抓取外部图片。缺失图片会提示处理或明确继续；图文准备上限为 48 MB，较大文稿可使用 ZIP。接收应用对富文本与内嵌图片的支持不同。

第三方依赖许可汇总在 `web/THIRD_PARTY_NOTICES.txt`，随应用嵌入。没有广告、遥测和云同步。内存、启动速度及包体大小以实测记录为准。
