# 留白

简体中文 | [English](README.en.md)

Mac 上一页就能开始写的 Markdown 编辑器。打开就写，没保存的内容自动留成草稿；整页都是纸面，边写边看到格式；文件始终是你自己的 `.md`。免费开源。

介绍和截图见 [liubai.echovic.com](https://liubai.echovic.com/)。

## 下载

在 [Releases](https://github.com/echoVic/liubai/releases/latest) 下载 DMG，打开后把「留白」拖进「应用程序」。需要 macOS 13 或以上，支持 Apple 芯片和 Intel；安装包已用 Developer ID 签名并经 Apple 公证。

留白每 4 小时在后台检查一次更新，也可以用「留白 → 检查更新…」手动检查；从最近几个版本升级只需下载几 MB。放在「应用程序」或 `~/Applications` 里才能自行更新。各版本的变化见 [CHANGELOG](CHANGELOG.md)。

## 功能

- **写**：打开即写，标题、列表、加粗等格式即时呈现；格式工具栏、在空行输入 `/` 打开的插入菜单，以及段落左侧的块手柄（拖动排序、转换类型、复制删除）。
- **表格和图片**：表格就地编辑，Tab 在单元格间移动；图片可以拖动改大小、设置对齐和说明，写成 GitHub 上也能正常显示的 Markdown。
- **公式、图表和扩展语法**：KaTeX 公式、Mermaid 图表、GitHub 提示块、`<details>` 折叠块和脚注。
- **看**：编辑、分栏、阅读三种视图，分栏时右侧跟随光标；侧栏里有最近文稿和大纲；专注模式；四套主题，字号和行宽可调。
- **导出**：PDF、Word（.docx）、内嵌图片的 HTML、Markdown 加图片的 ZIP，以及富文本复制。PDF 里的中文可以正常复制和搜索；Word 保留标题样式、列表编号、表格、公式和脚注，可以交给用 Word、Pages 或 WPS 的人继续改。
- **粘贴**：网页、文档和 Word 的内容粘贴后转为 Markdown，图片一并保存；`⇧⌘V` 粘贴为纯文本。
- **随手记**：在任何应用里按 `⌃⌥⌘N` 记下想法，`⌘↩` 存为一篇新草稿。
- 简体中文和英文界面，默认跟随系统语言。

常用快捷键：`⌘N` 新建、`⌘O` 打开、`⌘S` 保存、`⌘⇧S` 另存、`⌘K` 所有操作、`⌘F` 查找、`⌘\` 切换分栏、`⌘⇧R` 阅读模式、`⌘⇧M` 显示 Markdown 源码、`⌘/` 块菜单、`⌘L` 编辑链接、`⌘⇧F` 专注模式、`⌘P` 导出 PDF。

## 文件和数据

- 打开的 `.md` 保存时写回原文件，保留 Finder 标签和创建时间；粘贴的图片放进同目录的 `文稿名.assets/`，用相对路径引用。
- 文件被其他应用修改时自动载入；两边都改过时先暂停，由你决定保留哪一边，另一边存成恢复副本，不会悄悄丢稿。只读文件不会被覆盖。
- 未保存的草稿在 `~/Library/Application Support/Liubai/`。从最近文稿里移除的草稿进入其中的 `trash/`，保留 30 天；读不出的草稿移到 `quarantine/`，应用照常启动。
- 文稿上限 8 MB；单张图片 20 MB、最长边 16000 像素。

没有广告、遥测和云同步；检查更新只访问 GitHub Releases，不上传文稿内容。

## 开发

需要 Go 1.27.1（可自动下载工具链）、Node 24 和 Bun；运行留白本身不需要它们。

```sh
bun install --frozen-lockfile                              # 前端依赖
node scripts/build.mjs                                     # 把 src/ 构建到 web/
go run .                                                   # 桌面版
go run . --web 127.0.0.1:4193 --data-dir /tmp/liubai-dev   # 在浏览器里运行，使用单独的数据目录
```

后端是 Go（[MyGo](https://github.com/egoist/mygo)），前端源码在 `src/`（TypeScript + CodeMirror 6）。`web/` 是提交到仓库的构建产物，打包时作为应用资源只存一份；未打包运行时读取当前目录下的 `web/`，所以要在仓库根目录运行。浏览器模式调用同一套草稿后端，只监听回环地址，系统对话框换成导入和下载。

检查：

```sh
go test ./... && go vet ./...
node_modules/.bin/tsc --noEmit
node scripts/check-i18n.mjs && node scripts/check-editor.mjs
npx --yes bun@1.4.3 scripts/check-<名称>.ts   # editing、rendering、performance、paste、capture-input、blocks、slash、tables、images、marks、math、mermaid、extras、docx
scripts/e2e.sh check-<名称>                    # Chrome 中的回归：split-preview、reader、toolbar、capture、english、blocks、tables、images、math、mermaid、extras、docx
scripts/e2e.sh check-blocks-webkit             # 桌面版引擎 WebKit 中的块操作、图片、公式、图表与 Word 转换
python3 scripts/check-preview.py               # 渲染与导出
python3 scripts/check-pdf.py                   # PDF 分页、中文文字层与画面
```

`scripts/e2e.sh` 每次编译程序，用新的数据目录启动网页服务，跑完关闭；Python 检查使用已安装的 Chrome。WebKit 检查在屏幕外的窗口里运行，不抢焦点；锁屏或显示器休眠时 WebKit 不绘制，检查会说明原因后停止。

构建通用安装包：`go tool mygo build -platform darwin/universal .`，产物在 `build/darwin-universal/`。正式发版（签名、公证、更新包）见 [docs/RELEASING.md](docs/RELEASING.md)。

## 文档

- [CHANGELOG](CHANGELOG.md)：各版本的变化
- [验证记录](docs/superpowers/validation/2026-10-15-reader-foundation.md)：每个版本的实现取舍、测试、原生应用实测和发布核对
- 设计：[阅读器与可靠性](docs/superpowers/specs/2026-10-15-reader-foundation-design.md)、[分栏预览](docs/superpowers/specs/2026-10-15-split-preview-design.md)、[块编辑](docs/superpowers/specs/2026-10-17-block-editing-design.md)；实施计划在 `docs/superpowers/plans/`
- [性能报告](docs/performance/2026-10-15-reader-foundation.md)

## 许可

[MIT](LICENSE)。第三方依赖的许可见 `web/THIRD_PARTY_NOTICES.txt`，随应用一起分发。
