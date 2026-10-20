# Windows 版设计

**日期**：2026-10-20
**状态**：用户请我直接决策并开发（「你直接决策吧，然后开发吧」），开发中

## 背景

MyGo 本身支持 Windows：页面在 WebView2 中显示，`mygo build` 生成按用户安装的 NSIS 安装包，更新插件支持 windows-amd64 / windows-arm64 的完整包和增量包。留白的 Go 代码不改就能交叉编译到这两个平台；前端的回归测试本来就在 Chrome 里跑，WebView2 也是 Chromium。我们在 egoist/mygo#274 公开说过会做 Windows 版。

所以这次的工作不是移植，而是让留白在 Windows 上像一个 Windows 应用：窗口按钮、菜单、快捷键、字体，以及 Windows 特有的文件占用和路径写法。

## 决定

- **平台**：Windows 10 和 11，x64 与 ARM64。安装包按用户安装到 `%LOCALAPPDATA%\Programs`，不需要管理员权限，由 MyGo 更新插件自动更新。
- **签名**：目前没有 Windows 代码签名证书。首个 Windows 版标为预览版、不签名发布，发布说明里写明 SmartScreen 的「仍要运行」。更新包另有 MyGo 的更新签名校验，不受影响。拿到证书后在 `mygo.json` 配 `windows.signCommand`。
- **标题栏**：沿用隐藏标题栏，顶栏就是标题栏。Windows 的最小化、最大化、关闭由 MyGo 画在右上角，高度与 64px 的顶栏一致（`TitleBarHeight: 64`）。
- **字体**：Windows 没有合适的系统宋体，也不内置字体（0.5.0 刚给安装包瘦身）。正文字体栈在 macOS 字体之后依次加思源宋体 / Noto Serif SC（用户装了就用）、Georgia、微软雅黑；界面字体加 Segoe UI 和微软雅黑 UI。macOS 上字体栈的前几项不变，显示不变。
- **快捷键**：Windows 上 ⌘ 换成 Ctrl，界面里的快捷键提示按平台显示（⌘⇧R / Ctrl+Shift+R）。
  - 专注模式在 Windows 上用 **F8**（与 Typora 相同）。微软拼音和搜狗输入法的「简繁切换」默认占用 Ctrl+Shift+F，按下去会切到繁体。Ctrl+Shift+F 照旧可用。
  - 随手记默认全局快捷键：macOS 不变（⌃⌥⌘N），Windows 为 **Ctrl+Alt+N**（Windows 没有 Command 键，按原样会变成 Ctrl+Alt+Win+N）。随手记里按 Ctrl+Enter 存为草稿。
  - 桌面版拦下 **F5 / Ctrl+R**：WebView2 会把它们当作刷新，重载整个编辑器。MyGo 不会就刷新询问应用，`OnWillNavigate` 拦不住。
- **菜单**：隐藏标题栏的窗口在 Windows 上没有菜单栏，按 Alt 或 F10 从左上角弹出。Windows 的菜单按习惯排成「文件 / 编辑 / 视图 / 帮助」：「退出」在文件菜单末尾，「检查更新…」「关于留白」在帮助菜单；不出现 macOS 的应用菜单和窗口菜单。命令面板（Ctrl+K）在桌面版加入「检查更新…」和「关于留白」，不知道按 Alt 也能找到。
- **写回文件**：Windows 上用 `ReplaceFileW` 写回打开的文稿，保留文件属性、权限、备用数据流和创建时间，对应 macOS 版保留 Finder 标签和创建时间。杀毒软件、搜索索引或 OneDrive 短暂占用文件时重试。留白自己的原子写入（草稿、索引、导出）在重命名遇到占用时也重试。
- **路径**：Markdown 中 `C:\…`、`C:/…`、`\\服务器\共享\…` 形式的图片和文稿链接按本地绝对路径处理。Typora 在 Windows 上会写这种路径。
- **数据目录**：沿用 `os.UserConfigDir()`，即 `%AppData%\Liubai`，与 Electron 类应用一致。
- **文案**：「在 Finder 中显示」在 Windows 上为「在资源管理器中显示」；英文的 "this Mac" 改为 "this computer"。

## 不做

- **GBK 等非 UTF-8 编码**：现代编辑器（含 2019 年后的记事本）默认 UTF-8。读 GBK 就得能原样写回 GBK，写不进的字符还要处理，留到有用户需要时再做。
- **Windows 上的文件身份**（`DiskInode`）：大小、修改时间和内容哈希已能检测外部修改。
- **`file://` 图片地址**：macOS 上也不支持，保持一致。
- **Windows PDF 文字层修正**：现有修正针对 CoreGraphics。在 Windows 上 `fontIdeographs` 返回 nil，修正原样返回 PDF；Chromium 生成的 PDF 是否需要修正要真机验证。
- **代码签名、Microsoft Store、winget、Linux。**

## 设计

### 平台判断

- **Go**：沿用现有写法，用 `runtime.GOOS` 和 `_windows.go` / `_other.go` 构建标签。
- **前端**：新增 `src/platform.ts`，按 `navigator.platform` 判断平台，与 CodeMirror 决定 `Mod-` 键的方式一致。这样在 Windows 的浏览器里跑开发版也显示 Ctrl。页面加 `windows` class 供样式使用。
- **快捷键写法**：`keyLabel('Mod+Shift+R')` 在 macOS 上写成 ⌘⇧R（命令面板里写成 ⌘ ⇧ R，与现在相同），其他平台写成 Ctrl+Shift+R。`Cmd` 在 Windows 上显示为 Win。随手记快捷键的显示也用它。

### 文案中的快捷键

8 条写死了 ⌘ 的文案改用占位符 `{shortcut}`：

- 阅读模式不能编辑的提示
- 显示 Markdown 源码
- 随手记底部提示
- 链接的点击提示
- 分栏、阅读、新建文稿三个按钮的提示
- 随手记设置的说明

调用处传入 `keyLabel(…)`。在 HTML 中用 `data-i18n` 的元素加 `data-shortcut`，`localizePage` 把它按平台写好后作为参数传入；不带占位符的文案会忽略这个参数。

### 窗口与菜单

- `main.go` 新建窗口时加 `TitleBarHeight: 64`。该选项只在 Windows 和 Linux 上起作用。
- 样式：`.desktop.windows .topbar` 左边距 24px（不需要给红绿灯留 88px）。右边距让出 `--mygo-titlebar-inset-right`，全屏时这个值为 0。
- `menuTemplateFor(goos, …)`：darwin 保持现状；其他平台生成「文件 / 编辑 / 视图 / 帮助」。专注模式的菜单快捷键在 Windows 上是 F8。
- 新增绑定方法 `Desktop.CheckForUpdates` 和 `Desktop.About`，供命令面板调用。

### 字体、滚动条、随手记面板

- **字体栈**：正文为 `'Iowan Old Style','Songti SC','Noto Serif CJK SC','Source Han Serif SC','Noto Serif SC',Georgia,'Microsoft YaHei',serif`；界面在 `-apple-system,BlinkMacSystemFont` 之后加 `'Segoe UI'`、`'Microsoft YaHei UI'`、`'Microsoft YaHei'`。导出的 HTML 同样加微软雅黑，便于在 Windows 上打开。
- **滚动条**：Windows 上的 Chromium 默认是 17px 宽的浅灰滚动条，在夜墨主题里很刺眼。Windows 上改用细滚动条，颜色跟随主题（`scrollbar-width` / `scrollbar-color`）。
- **随手记面板**：Windows 上圆角改为 8px，与 Windows 11 给面板窗口画的圆角一致。

### 文件写入

- `workspace.go`：从 `atomicWriteHook` 里拆出 `atomicWriteWith(path, data, mode, commit)`，所有重命名都走 `renameFile`。
- `rename_windows.go`：遇到 `ERROR_ACCESS_DENIED`、`ERROR_SHARING_VIOLATION`、`ERROR_LOCK_VIOLATION` 时重试，总共约 1 秒。其他平台上就是 `os.Rename`。
- `replace_windows.go`：目标存在时调用 `ReplaceFileW`，参数为 `REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS`，遇到占用同样重试；目标不存在时走普通原子写入。`replace_other.go` 的构建条件改为 `!darwin && !windows`。

### 路径

- `imagePath`、`SaveAs`、`OpenLinked`：当 `filepath.VolumeName(dest)` 非空时（只有 Windows 上会非空），把它当作本地路径，不再按 URL 解析（URL 解析会把盘符当成协议）。
- 前端 `localDocumentLink`：Windows 上把 `C:\…\x.md` 视为本地文稿链接。

## 测试

- **Go**：
  - 菜单测试按 GOOS 分开。
  - Windows 专属测试放在 `_windows_test.go`：`ReplaceFileW` 保留创建时间和只读以外的属性、占用时重试、盘符路径。
  - 只适用于 Unix 的用例（`chmod 0`、符号链接）在 Windows 上跳过。
  - 在 macOS 上用 `GOOS=windows go vet` 和 `go test -c` 确认 Windows 代码和测试都能编译。
- **CI**：新增 GitHub Actions，在 windows-latest 上跑 `go vet` 和 `go test`。
- **前端**：
  - `keyLabel` 和随手记按键的单元检查（bun）。
  - `scripts/check-windows.py`：在 Chrome 里把 `navigator.platform` 模拟成 Win32，检查快捷键提示、F8、Ctrl+Enter、F5 / Ctrl+R、字体栈、滚动条和标题栏留白。
  - 现有的 Chrome 和 WebKit 回归确认 macOS 上没有变化。
- **打包**：在 macOS 上运行 `go tool mygo build -platform windows/amd64,windows/arm64`，检查产物结构（exe 和 `web` 资源）。生成安装包需要 NSIS。

## 发版

- `docs/RELEASING.md` 增加 Windows 部分：
  - 安装 NSIS；
  - 在同一条构建命令里加上 `windows/amd64,windows/arm64`，生成两个架构的安装包和 `update-windows-*.json`；
  - 未签名期间的说明。
- README、网站和 egoist/mygo#274 的回复，在发布 Windows 版时再更新。

## 需要在 Windows 真机上验证

- WebView2：
  - F5 / Ctrl+R 是否被拦下；
  - 64px 高的窗口按钮和贴靠布局；
  - Alt / F10 弹出的菜单；
  - 菜单快捷键（包括 F8）；
  - 深色模式下的标题栏。
- **文件**：在 OneDrive 同步目录里保存，确认创建时间、只读文件和占用重试。
- **输入法**：微软拼音和搜狗下的组字、斜杠菜单「、」、Ctrl+Shift+F 冲突是否已绕开。
- **打开文件**：双击 .md 打开；应用已在运行时由新实例转交路径，窗口能否到前台；跳转列表。
- **随手记**：Ctrl+Alt+N 能否注册，Windows 10 上没有亚克力背景时的外观。
- **导出**：导出 PDF 的分页和中文复制（文字层），Word、HTML、ZIP。
- **安装和更新**：安装、卸载、文件关联、自动更新和增量包、SmartScreen 提示。
- **显示**：高分屏和多显示器缩放。
