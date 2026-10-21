# Windows 支持验证记录

**日期**：2026-10-20
**基线**：`main` 的 `dfc982d`
**代码**：`feat/windows` 分支，设计见 [specs/2026-10-20-windows-support-design.md](../specs/2026-10-20-windows-support-design.md)，计划见 [plans/2026-10-20-windows-support.md](../plans/2026-10-20-windows-support.md)
**范围**：macOS 上的验证和 Windows CI。发版后补做了一次 Windows 真机测试，结果和修复见文末「Windows 真机测试」。

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
- **macOS 上能看到的变化**（有意为之）：
  - 链接提示从「⌘ / Ctrl 点击打开链接」改为「⌘ 点击打开链接」：在 macOS 上 Ctrl 点击是右键。
  - 英文的 "this Mac" 改为 "this computer"。
  - 命令面板多了「检查更新…」「关于留白」。
  - 随手记快捷键里的 Enter 显示为 ↩，如 ⌃↩。
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

## 审查

一位独立审查者通读了整个分支，并对照 MyGo 和 Go 的源码核实。指出的问题都已修复，并补上了测试，详见计划末尾的 Review fixes：

- 在 Windows 上，`filepath.VolumeName` 会把 `//host/…` 当作共享路径。这既会让 `links_test.go` 在 Windows 上失败，也会让打开文稿时就去连接文稿里写的 SMB 主机，泄露凭据。现在共享和设备路径一律拒绝。
- MyGo 在 Windows 上的编辑角色会截走 Ctrl+V，只粘贴纯文本。现在 Windows 的编辑菜单不放这些角色。
- 阅读视图里编码过的盘符链接打不开，现已修复。
- `ReplaceFileW` 返回 1176 后，如果重命名也失败，文稿会从磁盘上消失。现在会保留临时文件。
- 随手记面板里 Ctrl+Shift+R 会刷新；AltGr 与 Ctrl+/ 冲突；滚动条颜色覆盖了编辑区原有的设定。三处均已修复。

审查后重跑了 Go 测试、Windows 交叉编译、tsc、bun 检查和 `check-windows`，全部通过。暂不处理的已知限制记在设计文档的「不做」里。

## 合并后与发版

- **WebKit 检查**：`scripts/e2e.sh check-blocks-webkit` 开发时两次因显示器休眠没跑成，用 `main` 对照也一样；发版前屏幕醒着时补跑，已通过。
- **Windows CI**：合并后推送 `main`，`go vet ./...` 和 `go test ./...` 在 windows-latest（Go 1.27.1 x64）上通过，Windows 专属测试一并运行。`c9188cc` 是 run 39379317914，发版提交 `1eadb11` 是 run 39379632394。
- **0.6.0 发版**：2026-10-20 发布，`go tool mygo build -platform darwin/universal,windows/amd64,windows/arm64 -upload`，约 4 分钟。
  - **macOS**：签名、公证、钉票据和 DMG 校验全部通过；`vcs.revision` 为 `1eadb11`，`vcs.modified=false`。
  - **增量包**：从 0.5.0 约 1.1 MB，从 0.3.0、0.4.0 约 4.1 MB。

| 文件 | 大小 | SHA-256 |
|---|---|---|
| `Liubai.0.6.0.dmg` | 10.5 MB | `dd2230a2f4eb9e8a2cb3829d7e49eb6af608bdbe7e2f4e39b58e56c93b359dc1` |
| `Liubai.Setup.0.6.0.amd64.exe` | 6.4 MB | `12fa4bf257c3cf5c736fc1f1e38d17272e1e2d30c2cb99f7a00264bcc4c0fe2e` |
| `Liubai.Setup.0.6.0.arm64.exe` | 5.7 MB | `2437fd5c065ed70dc46992267fd13d8e25e1f7fdc11893708c8ce374fabfcf28` |

- **Windows 产物**：两个程序是 PE32+ GUI（x86-64、Aarch64），安装包是 Nullsoft Installer，`vcs.revision` 也是 `1eadb11`。它们的 `vcs.modified=true`，来自 MyGo 构建时临时写入包目录的 `mygo_windows_<架构>.syso`，源码与标签一致；`.gitignore` 现已忽略这个文件。
- **公开下载核对**：匿名下载 `update-darwin-universal.json`、`update-windows-amd64.json`、`update-windows-arm64.json` 和三个安装包，与本地构建逐字节一致。
- **Windows 真机**：发版时未测试；之后按下面的清单测了一次，见文末。

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
  - F5、Ctrl+R、Ctrl+Shift+R 不会刷新页面（随手记面板里也是）。
  - Ctrl+V 粘贴截图、网页、Word 内容会转成 Markdown；右键菜单里的剪切、拷贝、粘贴可用。
  - Ctrl+Shift+F 在没有输入法拦截时仍能进入专注模式。
- **输入法**：微软拼音和搜狗下的组字、斜杠菜单（「、」），以及 Ctrl+Shift+F 不再切到繁体。
- **文件**：
  - 双击 .md 打开；应用已在运行时由新实例转交路径，窗口能否到前台。
  - 跳转列表里的最近文稿。
  - 在 OneDrive 同步的「文档」目录里自动保存：内容、创建时间和隐藏属性保留，被占用时重试。
  - 只读文件不被覆盖。
  - `C:\…` 图片显示，`C:\…\x.md` 链接在编辑区（Ctrl 点击）和阅读视图里都能打开。
  - `\\服务器\…` 和 `//服务器/…` 图片被拒绝，没有网络访问（例如用 Wireshark 确认没有 445 端口的连接）。
- **随手记**：Ctrl+Alt+N 能否注册（含 AltGr 键盘布局）；面板在 Windows 11 上的亚克力背景和 8px 圆角，Windows 10 上的外观；Ctrl+Enter 保存；开机启动。
- **受控文件夹访问**：开启后，未签名的留白能否保存到「文档」。
- **导出**：
  - PDF 的分页和中文复制。Windows 上没有 CoreGraphics 的修正，如果复制出 ⼝ 之类的部首字，要另做修正。
  - Word、HTML、ZIP 导出；富文本复制粘贴到 Word 和微信。
- **更新**：从一个 Windows 版自动更新到下一个版本。

## Windows 真机测试

2026-10-20 至 21，在一台 Windows 11 Pro（10.0.26200，x64）上测试预装的 0.6.0，共 48 项：

- **结果**：36 项通过，3 项失败，6 项部分验证，3 项未测。
- **未测**：全新安装与卸载；Windows 10、ARM64、多显示器、OneDrive、缺少 WebView2；版本之间的自动更新。
- **通过**：中文组字、撤销重做、三种视图、F8、只读保护、外部修改与冲突副本、文件属性和创建时间保留、盘符图片与链接、PDF 中文搜索与复制、Word / HTML / ZIP 导出、富文本复制到 LibreOffice、随手记和刷新键保护。

失败的 3 项已在 `fix/windows-qa` 修复：

- **运行中再打开文稿会多开一个留白**：
  - **原因**：MyGo 用应用名给单实例锁、PathUserData 和 WebView2 配置目录命名，而留白把应用名设成界面语言里的「留白」或「Liubai」。运行中换了语言，再打开文稿时，新进程算出另一个名字，拿到另一把锁。
  - **修复**：macOS 以外，应用名固定为 Liubai，只有窗口标题随语言变化。第二次启动先调用 `AllowSetForegroundWindow`，再把文件交给已有窗口，让窗口能到前台；不带文件启动时也会把窗口带到前台。开机启动不调用 `AllowSetForegroundWindow`，因为那时没有要转交的东西。
  - **代价（有意接受）**：0.6.0 以中文启动过的用户，MyGo 的状态存在 `%AppData%\留白` 和 `%LOCALAPPDATA%\留白\WebView2`。升级后会重置一次，旧目录留在原处，文稿不受影响，因为工作区一直在 `%AppData%\Liubai`。重置的内容：
    - 窗口位置；
    - 「最近打开」列表；
    - 更新器记下的跳过版本和自动下载设置；
    - 页面的外观缓存。
  - **显示**：Windows 上，MyGo 的更新提示和没有标题的对话框会写「Liubai」，中文界面下也一样。
- **重启后语言回到系统语言**：
  - **原因**：Windows 上，MyGo 把选择的语言存在 PathUserData 的 `locale` 文件里。启动时先在 `%AppData%\Liubai` 读到「简体中文」，应用名于是变成「留白」；`Run` 再去 `%AppData%\留白` 找，就找不到了。
  - **修复**：应用名固定后，路径不再变化。启动时还以 `workspace.json` 里的选择调用 `SetLocale`，0.6.0 留下的不一致会被纠正。不认识的值会被忽略，因为 `SetLocale` 遇到无效标签会崩溃。较新版本写下的 `workspace.json` 也会读出这项选择。
- **夜墨主题下右上角按钮仍是黑色**：
  - **原因**：这些按钮由 MyGo 画在页面上，颜色跟随 `Theme.SetSource`；没有设置时跟随系统。
  - **修复**：Windows 上启动和切换主题时把主题告诉 MyGo：夜墨为深色，其余为浅色，跟随系统时交给系统。菜单和页面的 `prefers-color-scheme` 也随之变化；只改字号或布局时不重设。macOS 不变。

测试报告里另有几处待核对的现象：

- **复杂网页粘贴整段变成纯文本**：
  - **原因**：Chrome 复制网页时会把计算样式写进 HTML，代码块因此带上 `white-space: pre-wrap` 和等宽字体，被当作从代码编辑器复制的代码，整段改为粘贴纯文本。各平台都有这个问题。
  - **修复**：现在只有复制的内容全是代码时才粘贴纯文本。夹在其他内容中的代码转成代码块，单行代码转成行内代码，表格单元格里的代码留在单元格里。
  - **保留原样**：代码在交给 turndown 之前先用 `<pre>` 保护，空行、缩进和不换行空格都不会丢。
  - **复测**：在 Chrome 里实际复制测试文稿导出的 HTML 再粘贴，标题、列表、表格、代码块和图片都保留了；公式和 Mermaid 图仍是文字。
  - **代码审查**：发现两处问题，均已修复并补了断言：`<pre>` 里分成几段的代码只留下了第一段，CodeMirror 的空行变成了两行。
- **命令面板搜「update」没有结果**：搜索区分了大小写，已改为不区分。帮助菜单的「Check for Updates…」点了没有出现窗口，代码里找不到原因，需要真机复测。
- **从 LibreOffice Writer 粘回的本地图片只剩说明文字**：这是设计行为。`file:` 图片不导入，`check-paste.ts` 有断言。
- **中文组字后斜杠菜单不再出现**：这也是设计行为。`check-slash.ts` 断言组字会关闭菜单，且不会重新打开；可以用「/bg」这样的拼音缩写筛选。

修复后在 macOS 上通过了以下检查：

- `go vet ./...` 和 `go test ./...`。
- Windows amd64 / arm64 的 `go vet`，以及程序和测试的交叉编译。
- `tsc`、全部 bun 检查、`check-editor.mjs`、`check-i18n.mjs`。
- `check-english`、`check-reader`、`check-docx`、`check-capture`、`check-windows`、`check-images`。

在负载 20 左右时，`check-windows` 随手记一步和 `check-images` 图片工具条一步偶尔失败：

- `check-windows` 在 `main` 上同样会失败。
- `check-images` 在负载 15 左右连续 3 次通过。

需要回到真机复测的项：

- **单实例**：
  - 先切换语言，再从资源管理器双击 .md，也从终端用 `Liubai.exe <路径>` 打开。
  - 窗口最小化时再打开一次。
  - 每次都应只有一个进程，文稿在已有窗口打开，窗口到前台。
- **语言**：重启后保持中文；从 0.6.0 中文界面升级后，核对哪些状态被重置。
- **主题**：夜墨主题在浅色系统下的按钮颜色和菜单颜色；开关「跟随系统」；随手记面板的颜色。
- **其他**：帮助菜单的检查更新窗口；复杂网页的粘贴。

## 0.6.1 预发布

2026-10-21 发布为 GitHub 预发布，`v0.6.1` = `49a72b1`。

- **Windows CI**：`49a72b1` 的 run 39553940552 通过了 `go vet ./...` 和 `go test ./...`。
- **构建**：同一条命令一次构建三个平台，约 4 分钟。
  - macOS 的签名、公证、钉票据和 DMG 校验全部通过。
  - 三个程序的 `vcs.revision` 都是 `49a72b1`，`vcs.modified=false`。
- **增量包**：macOS 从 0.6.0 升级约 740 KB；Windows 第一次有增量包，从 0.6.0 升级约 390 KB。
- **不推送给用户**：最新正式版仍是 0.6.0，三个平台的 `releases/latest` 更新源都还是 0.6.0，网站也不变。
- **公开下载核对**：匿名下载两个安装包、DMG 和三个更新清单，与本地构建逐字节一致。

| 文件 | 大小 | SHA-256 |
|---|---|---|
| `Liubai.0.6.1.dmg` | 10.6 MB | `9de3baadac674921a27cdfdf3b5145608a2fb5402267d44535b999f0d021c716` |
| `Liubai.Setup.0.6.1.amd64.exe` | 6.4 MB | `17a4a0e67146341f8fa0f7d0bcb25d14990e9dc2f8d7f1dbfdf53177a8eacd68` |
| `Liubai.Setup.0.6.1.arm64.exe` | 5.7 MB | `6bfb6048724dcca6fa13d68ddf9711dc63e47ed59c1da9f5fbb685f6b623d064` |

真机复测通过后，用 `gh release edit v0.6.1 --prerelease=false --latest` 转为正式版，再核对更新源。

## 0.6.1 真机复测与转正

2026-10-21 在同一台 Windows 11 Pro（10.0.26200，x64）上复测。从 GitHub 下载 `Liubai.Setup.0.6.1.amd64.exe`，SHA-256 与上表一致，覆盖安装 0.6.0。定向复测 16 项，全部通过：

- **单实例**：切换语言后，从资源管理器打开、从终端带路径打开、不带参数启动，以及窗口最小化时再打开，都只有原来的一个进程。文稿在原窗口打开，窗口回到前台。
- **语言**：选中文后完全退出再启动，仍是中文。
- **主题**：系统浅色、夜墨主题下，右上角按钮为浅色，菜单为深色；随手记面板随「跟随系统」切换。
- **检查更新**：先显示「正在检查更新…」，再显示「已是最新版本」。0.6.0 上点了没有窗口的现象没有再出现。
- **命令面板**：小写和大写的 update 都能找到「检查更新…」。
- **粘贴**：从 Chrome 复制的整页内容保留了标题、列表、表格、代码块和图片。保存后代码的缩进和空行、图片的 SHA-256 都与原文一致，重开正常。
- **数据**：升级前后 6 份文稿的 SHA-256 和 18 份草稿正文都没有变化。

另有两点观察：

- 覆盖安装后第一次双击 .md，Windows 会弹出选择打开方式的窗口，默认是留白；确认后不再出现。
- 0.6.0 留下的窗口位置等状态，按预期重置了一次。

这次没有覆盖：自动更新与增量包、卸载重装、Windows 10、ARM64、多显示器、OneDrive、缺少 WebView2。

同日用 `gh release edit v0.6.1 --prerelease=false --latest` 转为正式版。匿名下载三个平台 `releases/latest` 的更新源，都是 0.6.1，并与本地构建逐字节一致。

## 升级到 MyGo 0.6.0

MyGo 0.6.0 于 2026-10-21 发布，合入了我们提交的 #560、#561 和 #562。留白随之升级，`mygo-runtime` 也升到 0.6.0；后者只改了版本号。

- **两处临时做法撤掉**：
  - **刷新键**：页面自己拦 F5 和 Ctrl+R 的做法（`isReloadKey`）去掉了。MyGo 现在只在开着 DevTools 时才打开 WebView2 的浏览器快捷键，留白的正式版不开 DevTools。所以 F5、Ctrl+R、Ctrl+P、Ctrl+F 和 Ctrl+加减号都不再触发浏览器的刷新、打印、查找和缩放；Ctrl+P 和 Ctrl+F 仍是留白菜单里的导出 PDF 和查找。
  - **编辑菜单**：Windows 的编辑菜单恢复了剪切、拷贝、粘贴和全选。MyGo 现在把 Ctrl+X/C/V/A 留给页面，所以按 Ctrl+V 粘贴网页、Word 和截图，仍会转成 Markdown。
  - **菜单里点粘贴**：用鼠标点菜单里的「粘贴」时，MyGo 只插入剪贴板里的文字，网页内容不会转成 Markdown。这是 MyGo 在 WebView2 上的做法。
- **直接用上的修复**：
  - Windows 11 上的菜单换成 Windows 11 的样式。
  - 更新器的窗口跟随应用里选择的语言，启动后不久就检查一次更新。
  - 应用自己从更新器重新启动后，窗口会回到前台（#459）。
- **macOS 打印的 PDF**：MyGo 的 `PrintToPDF` 已经把部首还原为汉字，这正是 #490 的做法。留白自己的 `fixPDFTextMapping` 暂时保留，对已经修正过的 PDF 不起作用。要删掉它，得先在真机上用 MyGo 0.6 打印一次，确认中文复制和搜索都正常。
- **与我们无关**：Windows 安装脚本加了 UTF-8 BOM，这只影响在 Windows 上构建的情况。在 macOS 上，不加 BOM 的 `makensis` 也正确读出了「Markdown 文稿」。
- **单实例和语言没变**：MyGo 0.6.0 的单实例锁、语言文件和 PathUserData 仍按应用名区分，0.6.1 的修复照旧需要。第二个实例交出文件前不让出前台的问题记在 egoist/mygo#591。作者用 #592 修复并已合并；等 MyGo 发布含它的版本后，删掉留白自己的 `allowForegroundHandoff`。

需要在真机上复测：

- **编辑菜单**：在编辑区按 Ctrl+X/C/V/A，再用鼠标点菜单里的剪切、拷贝、粘贴和全选；随手记面板里也试一遍。
- **浏览器快捷键**：F5、Ctrl+R、Ctrl+Shift+R 不刷新，随手记面板里也是；Ctrl+P 打开留白的 PDF 导出，Ctrl+F 打开留白的查找；Ctrl+加减号不再缩放。
- **菜单外观**：菜单是 Windows 11 的样式，夜墨主题下是深色。
- **更新器**：「检查更新…」的窗口与界面语言一致。

## 0.6.2 预发布

2026-10-21 发布为 GitHub 预发布，`v0.6.2` = `73a3a75`，用 MyGo 0.6.0 构建。

- **Windows CI**：`73a3a75` 的 run 39576611787 通过。
- **构建**：三个平台一次构建，约 6 分钟。
  - macOS 的签名、公证、钉票据和 DMG 校验全部通过。
  - 三个程序的 `vcs.revision` 都是 `73a3a75`，`vcs.modified=false`，依赖 MyGo v0.6.0。
- **增量包**：
  - 第一次构建时，读取 Windows 两个平台上一版更新清单的请求因本机网络失败（超时，以及 `can't assign requested address`），所以没有生成 Windows 增量包。
  - 于是单独用 `-platform windows/amd64,windows/arm64 -upload` 重建 Windows 部分，输出到另一个目录。这次生成了从 0.6.1 和 0.6.0 升级的增量包，约 730 到 870 KB，并替换了草稿里的 Windows 文件。
  - macOS 有从 0.6.1、0.6.0、0.5.0 升级的增量包，1.4 到 1.6 MB。
- **不推送给用户**：最新正式版仍是 0.6.1，三个平台 `releases/latest` 的更新源都还是 0.6.1。
- **公开下载核对**：匿名下载两个安装包、DMG 和三个更新清单，与本地构建逐字节一致。

| 文件 | 大小 | SHA-256 |
|---|---|---|
| `Liubai.0.6.2.dmg` | 10.6 MB | `c8a99fdf0106db8556849f05cda02728b23ce0ad69cc4306e751387a06f8172a` |
| `Liubai.Setup.0.6.2.amd64.exe` | 6.4 MB | `b8f3fe9279820a2541508df88106a318a8a0a57b00745e4b929de62e4941f09e` |
| `Liubai.Setup.0.6.2.arm64.exe` | 5.8 MB | `3d9a6f16cb0b5ec9e74d3e545abddbfbaa4be8b8a05be3de38a78f1402cbbf5d` |

需要在真机上复测的项，见上面「升级到 MyGo 0.6.0」一节。

## 0.6.2 真机复测与转正

2026-10-21 在同一台 Windows 11 Pro（10.0.26200，x64）上，从 0.6.1 手动覆盖安装 0.6.2。安装包的 SHA-256 与上表一致。共 20 项：19 项通过，1 项部分覆盖，没有确认的新缺陷。

- **编辑**：在编辑区和随手记里，Ctrl+X/C/V/A 都正常。鼠标点编辑菜单里的全选、拷贝、粘贴、剪切也正常。用 Ctrl+V 粘贴 Chrome 复制的网页，仍转成 Markdown，保存后重开正常；用菜单粘贴只得到文字，符合预期。
- **按键**：编辑区和随手记里，F5、Ctrl+R、Ctrl+Shift+R 都不刷新页面。Ctrl+P 打开留白的 PDF 导出，Ctrl+F 打开留白的查找，Ctrl+加减号不再缩放页面。
- **外观**：菜单是 Windows 11 的样式；夜墨主题下，菜单和随手记为深色，右上角按钮为浅色。
- **检查更新**：中英文切换后，窗口语言立即跟着变。
- **回归 0.6.1 的项**：双击文件不多开、窗口回到前台（包括最小化时），重启后保持中文。
- **数据**：原有的 21 份草稿正文没有变化。
- **部分覆盖**：随手记面板按 Alt 不会弹出应用菜单。这个面板是无边框的弹出窗口，0.6.1 起就没有菜单栏，它的快捷键和右键编辑菜单都正常，所以这不算缺陷。

这次没有在 Windows 上重新验证 PDF 文件本身。Windows 上 MyGo 的 `PrintToPDF` 与 0.6.1 完全一样，`pdf_text_other.go` 原样返回 PDF。

macOS 的 PDF 导出另做了核对，因为 MyGo 0.6.0 的 `PrintToPDF` 现在自己会把部首还原为汉字，留白随后还会再修正一遍：

1. 用 `scripts/check-pdf.py` 的 WebKit 打印出 `raw.pdf`。
2. 用 MyGo v0.6.0 的 `fixPrintedPDF` 处理它。
3. 再交给留白的 `fixPDFTextMapping`。

结果：

- MyGo 的结果与留白单独修正的结果逐字节一致。
- 留白的第二遍没有改动任何字节。
- 最终 PDF 共 21 页，没有部首字，要找的中文都在，像素与原始打印完全一致。

所以 0.6.2 在 macOS 上导出的 PDF 与 0.6.1 相同。留白自己的修正今后可以删掉。

同日用 `gh release edit v0.6.2 --prerelease=false --latest` 转为正式版。匿名下载三个平台 `releases/latest` 的更新源，都是 0.6.2，并与本地构建逐字节一致。
