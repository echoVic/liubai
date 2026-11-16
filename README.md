# 留白

简体中文 | [English](README.en.md)

Mac 上一页就能开始写的 Markdown 编辑器，另有 Windows 内测版。打开就写，没保存的内容自动留成草稿；整页都是纸面，边写边看到格式；文件始终是你自己的 `.md`。免费开源。

介绍和截图见 [liubai.echovic.com](https://liubai.echovic.com/)。

## 下载

在 [Releases](https://github.com/echoVic/liubai/releases/latest) 下载 DMG，打开后把「留白」拖进「应用程序」。需要 macOS 13 或以上，支持 Apple 芯片和 Intel；安装包已用 Developer ID 签名并经 Apple 公证。

Windows 内测版在同一个 Release 里：多数电脑下载 `amd64` 安装包，ARM 处理器的电脑下载 `arm64` 安装包，双击即可安装，不需要管理员权限，Windows 10 或 11 都能用。Windows 程序和安装包暂未签名，首次运行时如果提示「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。遇到问题可以在 [Issues](https://github.com/echoVic/liubai/issues) 反馈，或从菜单里的「问题反馈…」新建 Issue。

留白每 4 小时在后台检查更新，也可以「留白 → 检查更新…」手动检查（Windows 上是「帮助 → 检查更新…」）；从最近几个版本升级只需下载几 MB。放在「应用程序」或 `~/Applications` 里才能自行更新。各版本变化见 [CHANGELOG](CHANGELOG.md)。

## 功能

- **写**：打开即写，标题、列表、加粗等格式即时呈现；有格式工具栏、在空行输入 `/` 打开的插入菜单，以及能拖动排序、转换类型、复制和删除段落的块手柄。
- **表格和图片**：表格就地编辑，Tab 在单元格间移动；图片可以拖动改大小、设置对齐和说明，阅读时能打开大图。宽表、长代码和文稿属性可以单独横向滚动；写出的 Markdown 在 GitHub 上也正常显示。
- **公式、图表和扩展语法**：KaTeX 公式、Mermaid 图表、GitHub 提示块、`<details>` 折叠块和脚注。
- **视图**：编辑、分栏、阅读三种视图，分栏时右侧跟随光标；最近文稿在侧栏，大纲在正文右侧；有专注模式，字号和行宽可调。
- **搜索和标签**：搜索全部文稿的标题与 Markdown，结果带行号，可以跳到任一视图；标签筛选和关键词一起使用时取交集。
- **双链与反向链接**：`[[文稿名]]` 引用已登记文稿，编辑时 ⌘/Ctrl 点击、阅读和分栏预览中直接点击；侧栏的「反向链接」列出引用来源。
- **主题**：25 套，分「天光」「四时」「工作坊」三个系列；可以自己挑，也可以跟随系统的浅色和深色，或按时辰、节气自动切换。只用系统自带的字体。
- **导出**：PDF、Word（.docx）、内嵌图片的 HTML、Markdown 加图片的 ZIP，以及富文本复制；PDF 里的中文可以正常复制和搜索，Word 保留标题样式、列表编号、表格、公式和脚注。
- **粘贴和随手记**：网页、文档和 Word 的内容粘贴后转为 Markdown，图片一并保存，`⇧⌘V` 粘贴为纯文本；在任何应用里按 `⌃⌥⌘N`（Windows 上是 `Ctrl+Alt+N`）记下想法，`⌘↩` 存为新草稿，也可以追加到已有文稿。
- **设置、恢复和语言**：外观与排版、随手记和语言在独立设置窗口里，改完立即生效；注销、关机或重启时，未保存的编辑写进恢复日志，下次打开接着写；界面有简体中文和英文，默认跟随系统。

常用快捷键：`⌘N` 新建、`⌘O` 打开、`⌘S` 保存、`⌘K` 所有操作、`⌘F` 查找、`⌘\` 切换分栏、`⌘⇧R` 阅读模式、`⌘P` 导出 PDF；`⌘1`–`⌘6` 标题、`⌘0` 正文、`⌘B` 加粗、`⌘I` 斜体、`⌘U` 下划线、`⌘⇧X` 删除线、`⌘⇧H` 高亮、`⌘E` 行内代码。完整列表在「所有操作」里；Windows 上 ⌘ 换成 Ctrl、⇧ 即 Shift。

## 性能

长文也跟手：结构像小说的文稿（段落几十到几百字），100 万字时输入一个字约 8 毫秒，200 万字约 10–12 毫秒，都在一帧（约 16.7 毫秒）以内；100 万字的文稿打开约 0.1 秒就能看到正文。格式越密开销越大：每两三百字就有一处表格和图片时，20 万字以内输入仍在一帧以内，30 万字约 20 毫秒；公式、图表和脚注同样密集的笔记，10 万字约 10 毫秒。

字数统计在后台线程里进行，只排版屏幕上看得见的部分；代码块各语言的语法、Mermaid 图表和 Word 导出，用到时才加载。这些数字测自 M2 Pro 上的 WebKit，也就是桌面版的引擎；测法和完整数据见[性能报告](docs/performance/2026-10-24-0.6.3.md)。

## 文件和数据

- 打开的 `.md` 保存时写回原文件，保留 Finder 标签和创建时间（Windows 上保留文件属性和创建时间）；粘贴的图片放进同目录的 `文稿名.assets/`，用相对路径引用。
- 文件被其他应用修改时自动载入；两边都改过时先暂停，由你决定保留哪一边，另一边存成恢复副本，不会悄悄丢稿。只读文件不会被覆盖。
- 未保存的草稿在 `~/Library/Application Support/Liubai/`（Windows 上在 `%AppData%\Liubai\`）；从最近文稿里移除的草稿进入 `trash/`，保留 30 天；读不出的草稿移到 `quarantine/`，应用照常启动。
- 文稿上限 8 MB；单张图片 20 MB、最长边 16000 像素。

没有广告、遥测和云同步；检查更新只访问 GitHub Releases，不上传文稿内容。

## 开发

需要 Go 1.27.3（可自动下载工具链）、Node（CI 用 `.nvmrc` 里的 24）和 Bun 1.4.4；运行留白本身不需要它们。

```sh
bun install --frozen-lockfile                              # 前端依赖
node scripts/build.mjs                                     # 把 src/ 构建到 web/
go run .                                                   # 桌面版
go run . --web 127.0.0.1:4193 --data-dir /tmp/liubai-dev   # 在浏览器里运行
```

后端是 Go（[MyGo](https://github.com/egoist/mygo)），前端源码在 `src/`（TypeScript + CodeMirror 6）。`web/` 是提交到仓库的构建产物；未打包运行时读取当前目录下的 `web/`，所以要在仓库根目录运行。改了 `src/` 要重新构建并提交 `web/`。

检查：

```sh
go test ./... && go vet ./...
bun run check:headless                         # 两个 tsc、i18n、主题和 scripts/check-*.ts（check-performance 除外）
scripts/e2e.sh check-<名称>                    # 在 Chrome 里跑界面回归
scripts/e2e.sh check-blocks-webkit             # 桌面版引擎 WebKit 里的块操作、图片、公式、图表与 Word 转换
ROUNDS=3 scripts/bench/run.sh <基准版本>       # 与某个版本对比性能，结果写入 docs/performance/raw/<日期>/
```

`scripts/check-*.ts` 是不需要浏览器的 Bun 检查；`scripts/check-*.py` 和 `scripts/e2e.sh` 使用已安装的 Chrome，部分检查还会在 Playwright 的 WebKit 里运行（先 `python3 -m playwright install webkit`）。`scripts/e2e.sh` 每次编译程序、用新的数据目录启动网页服务，跑完关闭；完整的检查列表见 `scripts/check-*`。

推送到 `main`、`feat/**` 或提交 PR 时，GitHub Actions 在 Windows 上运行 `go vet` 和 `go test`；在 macOS 上先跑性能预算、启动包大小和资源检查，再跑 `go vet`、`go test ./...` 和 `check:headless`，最后重新构建前端并检查 `web/` 与提交的一致。

构建安装包：`go tool mygo build -platform darwin/universal .`，产物在 `build/darwin-universal/`；Windows 内测版在 macOS 上交叉构建，用 `-platform windows/amd64,windows/arm64`，安装了 NSIS（`brew install makensis`）才会生成安装包。正式发版（签名、公证、更新包）见 [docs/RELEASING.md](docs/RELEASING.md)。

## 文档

- [CHANGELOG](CHANGELOG.md)：各版本的变化
- [验证记录](docs/superpowers/validation/)：各版本的实现取舍、测试和发布核对
- [性能报告](docs/performance/2026-10-24-0.6.3.md)：测法、数据和与 0.1.0 的对比
- 设计与计划：各功能的规格、实施计划和专项验证在 `docs/superpowers/`

## 许可

[MIT](LICENSE)。第三方依赖的许可见 `web/THIRD_PARTY_NOTICES.txt`，随应用一起分发。
