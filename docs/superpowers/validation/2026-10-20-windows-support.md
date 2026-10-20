# Windows 支持验证记录

**日期**：2026-10-20
**基线**：`main` 的 `dfc982d`
**代码**：`feat/windows` 分支，设计见 [specs/2026-10-20-windows-support-design.md](../specs/2026-10-20-windows-support-design.md)，计划见 [plans/2026-10-20-windows-support.md](../plans/2026-10-20-windows-support.md)
**范围**：只在 macOS 上能做的验证。还没有在 Windows 真机或 Windows CI 上运行过。

## 在 macOS 上通过的检查

以下命令均以退出码 0 完成：

```sh
go test ./... && go vet ./...
GOOS=windows GOARCH=amd64 go vet ./... && GOOS=windows GOARCH=amd64 go test -c -o /tmp/tests-amd64.exe .
GOOS=windows GOARCH=arm64 go vet ./... && GOOS=windows GOARCH=arm64 go test -c -o /tmp/tests-arm64.exe .
node_modules/.bin/tsc --noEmit
node scripts/check-i18n.mjs && go tool mygo i18n check . && node scripts/check-editor.mjs
bun scripts/check-<名称>.ts   # platform、capture-input、editing、rendering、performance、paste、slash、blocks、tables、images、marks、math、mermaid、extras、docx
scripts/e2e.sh check-windows
scripts/e2e.sh check-english && scripts/e2e.sh check-toolbar && scripts/e2e.sh check-capture
scripts/e2e.sh check-reader && scripts/e2e.sh check-split-preview && scripts/e2e.sh check-blocks
```

- **Go 测试**：Windows 专属测试（`replace_windows_test.go`、`paths_windows_test.go`）在 macOS 上只确认能编译，要到 Windows 上才会运行。新的菜单测试显式传入 GOOS，所以 Windows 的菜单结构在 macOS 上也测到了。
- **`check-windows`**：在 Chrome 里把 `navigator.platform` 模拟成 Win32，检查以下各项：
  - 快捷键提示：按钮、格式栏、菜单提示、命令面板、链接提示；页面里没有任何 ⌘⇧⌥⌃↩。
  - F8 进入专注模式。
  - Ctrl+Y 和 Ctrl+Shift+Z 都能重做。
  - 随手记用 Ctrl+Enter 保存，⌘↩ 无效；设置里的快捷键显示为 Ctrl+Alt+Win+N。
  - 微软雅黑和 Segoe UI 在字体栈里，滚动条是细款，顶栏右侧给窗口按钮留了 150px。
  - 同一检查在 macOS 平台下确认原有写法、88px 留白和 ⌘↩ 保存都没有变。
- **`check-extras` 性能预算**：第一次跑出超出 15ms，当时 load average 约 12。与 `main` 交替各跑三次：main 是 16.37 / 14.17 / 11.36ms，本分支是 12.08 / 11.87 / 11.12ms，没有回退，是负载噪声。之后的完整运行通过。
- **前端构建**：`node scripts/build.mjs` 连续两次产物相同。
- **生成文件**：`go tool mygo generate .` 无变化。

## 交叉构建

`go tool mygo build -platform windows/amd64,windows/arm64 -o /tmp/liubai-windows-build .` 用时约 8 秒：

| 平台 | `Liubai.exe` | `file` | 目录大小 |
|---|---|---|---|
| windows-amd64 | 14.0 MB | PE32+ executable (GUI) x86-64 | 22 MB |
| windows-arm64 | 12.9 MB | PE32+ executable (GUI) Aarch64 | 21 MB |

- `web/` 放在 exe 旁边，与仓库里的 `web/` 完全一致，打包后 `frontendFiles()` 从这里读取。
- 没有生成安装包：本机没装 NSIS，构建提示跳过。生成安装包要先 `brew install makensis`。
- 产物里多了 macOS 专用的 `en.lproj/`、`zh-Hans.lproj/`（各一个 `InfoPlist.strings`），这是因为它们放在 `resources/` 根目录，没有放进 `resources/darwin/`。它们对 Windows 版没有影响。挪到 `resources/darwin/` 会改变 macOS 正式包的输入，要等下次 macOS 正式构建时一起验证，这次没有挪。

## 未能运行

- **`scripts/e2e.sh check-blocks-webkit`**：两次都报「no animation frames」（显示器休眠或锁屏时 WKWebView 不出帧）。用 `main` 的代码跑同一检查也是同样的结果，说明是环境原因。这次对 macOS 的改动都在 Chrome 回归里覆盖了：快捷键写法、菜单提示、字体栈前几项不变。等屏幕醒着时应再跑一次。
- **Windows CI**（`.github/workflows/windows.yml`）：分支推到 GitHub 后才会运行，还没有推。
- **Windows 真机**：见下面的清单。

## Windows 真机清单

- **安装**：
  - 用 NSIS 生成的安装包安装、卸载；开始菜单和桌面快捷方式。
  - 未签名时 SmartScreen 的提示和「仍要运行」。
  - 精简版系统缺少 WebView2 时的报错。
- **窗口**：
  - 64px 高的最小化、最大化、关闭按钮，以及悬停最大化时的贴靠布局。
  - 顶栏拖动、双击最大化，右侧按钮不被遮挡。
  - 深色模式下的标题栏。
  - 高分屏和多显示器缩放。
- **菜单与按键**：
  - Alt / F10 弹出菜单：文件…退出、编辑、视图、帮助（检查更新…、关于留白）。
  - 菜单快捷键生效：Ctrl+N/O/S/P/K，F8，Ctrl+Y。
  - F5、Ctrl+R 不会刷新页面。
  - Ctrl+Shift+F 在没有输入法拦截时仍能进入专注模式。
- **输入法**：微软拼音和搜狗下的组字、斜杠菜单（「、」），以及 Ctrl+Shift+F 不再切到繁体。
- **文件**：
  - 双击 .md 打开；应用已在运行时由新实例转交路径，窗口能否到前台。
  - 跳转列表里的最近文稿。
  - 在 OneDrive 同步的「文档」目录里自动保存：内容、创建时间和隐藏属性保留，被占用时重试。
  - 只读文件不被覆盖。
  - `C:\…` 图片显示，`C:\…\x.md` 链接能打开。
- **随手记**：Ctrl+Alt+N 能否注册；面板在 Windows 11 上的亚克力背景和 8px 圆角，Windows 10 上的外观；Ctrl+Enter 保存；开机启动。
- **导出**：
  - PDF 的分页和中文复制。Windows 上没有 CoreGraphics 的修正，如果复制出 ⼝ 之类的部首字，要另做修正。
  - Word、HTML、ZIP 导出；富文本复制粘贴到 Word 和微信。
- **更新**：从一个 Windows 版自动更新到下一个版本。
