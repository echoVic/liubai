# 工具栏提示与格式快捷键：验证记录

对应[设计](../specs/2026-10-26-toolbar-tooltips-design.md)和[实施计划](../plans/2026-10-26-toolbar-tooltips.md)，随 0.6.5 发布。

## 开发与审查

- Task 1–4 由本机的 traecli 按计划实现。每个任务都先运行测试，确认它会失败，再实现。
- Claude 逐行审查，并重跑了全部检查。
- Codex 做了一次只读的独立审查，发现三个问题：
  - 表格的操作菜单获得焦点后，按 ⌘1 会把表格的第一行改成标题；
  - Enter 打开侧栏后提示不消失，Esc 关菜单后提示又出现；
  - 计时断言依赖机器负载。
- 计划里的 Task 5 记下了这些修正，分两部分：
  - 5A 是提示层的键盘规则和测试，由 traecli 做；
  - 5B 是菜单和编辑区按钮里不响应格式快捷键、补表格菜单的测试，并把 `check-math`、`check-mermaid` 里对 `title` 的旧断言改为 `data-tip`，由 Codex 在另一个 worktree 里做。
  - 两边改的文件不重叠，由 Claude 合并。

## 自动检查

发布前在合并后的代码上运行，即 `9aa5585`。`39d73fc` 只改了版本号和 CHANGELOG。

- **静态检查：** `go vet ./...`、`go test ./...`、`tsc --noEmit`、`go tool mygo i18n check`（496 条消息）、`check-i18n` 和 `check-editor` 全部通过。
- **单元检查：** 17 项 bun 单元检查全部通过。新增的 `check-shortcuts` 分 macOS 和 Windows 两套，检查按键识别：
  - Shift+7 在键盘上打出的是 `&`；
  - 法语键盘不按 Shift 时，数字 1 那个键打出的也是 `&`；
  - AltGr、小键盘数字、Ctrl+X（剪切）、⌘⇧E，以及另一个平台的修饰键。
- **性能：** `check-performance` 按默认预算通过。30 万字的富文稿上，移动光标 2.77 ms，在行中间输入 5.67 ms，在段落末尾输入 5.83 ms。
- **浏览器回归：** Chrome 回归 17 项，其中 `check-english` 跑了两遍，共 18 次运行，17 次通过。`check-mermaid` 只有最后一条 CSP 断言失败：Chrome 156 对样例里的 `<svg onload>` 报告 `script-src-attr`，0.6.4 时一样失败。这次改动涉及的 `data-tip` 断言在它前面，已经通过。各项检查新增的内容：
  - `check-toolbar`：
    - 提示的名称和快捷键、在相邻按钮间立即切换、各种收起时机；
    - 键盘把焦点移到按钮上时出现，Enter 或 Esc 交还焦点后不再出现；
    - 所指的按钮被移出页面时提示一起消失；
    - 窄窗口里不出界，靠近窗口底部时翻到按钮上方，夜墨主题下用该主题的浮层颜色。
    - 计时在 Playwright 的可控时钟上验证：499 ms 时还没出现、500 ms 时出现；收起后 799 ms 内立即出现、800 ms 后重新等待。
    - 逐个按新快捷键，核对写出的 Markdown；文本框里、阅读模式下这些键都不改动正文。
  - `check-tables`：
    - 单元格里的新行内快捷键只作用于这个单元格，标题和列表快捷键不改动表格；
    - 在表格菜单和 ⋯ 按钮上按格式快捷键，也不改动表格。
  - `check-images`：选中图片时，新快捷键都不生效。
  - `check-windows`：
    - 模拟 Windows 时，提示写成 Ctrl+Shift+X、Ctrl+1–6；
    - Ctrl+1、Ctrl+Shift+7、Ctrl+I 生效，Ctrl+Alt（AltGr）和 Windows 键都不生效。
- **偶发失败：** traecli 在它的环境里两次遇到 `check-english` 保存状态那一步失败：按 ⌘S 后仍显示 Draft saved。在有和没有 5A 改动的两份代码上对照重跑，都通过；合并后又连跑两遍，也都通过。判断为环境相关的偶发失败。
- **CI：** Windows（`go vet`、`go test`）和 Performance 工作流在 `39d73fc` 上都通过。

## 没有做的

- **桌面应用实测：** 没有在原生应用（WKWebView）里试提示和快捷键，浏览器回归只在 Chrome 里跑。提示只用了标准的指针、焦点事件和 `:focus-visible`，这些在 macOS 13 的 WebKit 里都可用。
- **Windows 真机：** 没有，只有 CI。微软拼音和搜狗会不会占用 Ctrl+Shift+7/8/9、Ctrl+Shift+X、Ctrl+Shift+H，仍待在 Windows 上验证。
- **提示不能悬停：** 提示层不接收鼠标，移到提示上它就消失，达不到 WCAG 1.4.13 的「可悬停」。这是有意的：它因此永远不会挡住格式栏换行后的下一排按钮。

## 0.6.5 发布

- 标签 `v0.6.5` 是 `39d73fc`。构建命令同 [RELEASING.md](../../RELEASING.md)，三个平台一次构建。
- 增量包齐全，每个平台都有从 0.6.4、0.6.3、0.6.2 升级的增量包：

  | 平台 | 从 0.6.4 | 从 0.6.3 | 从 0.6.2 |
  |---|---:|---:|---:|
  | macOS | 488 KB | 1.1 MB | 1.9 MB |
  | Windows amd64 | 202 KB | 820 KB | 1.3 MB |
  | Windows arm64 | 189 KB | 807 KB | 1.2 MB |

- **检查全部通过。**
  - `codesign`、`spctl`（Notarized Developer ID）、`stapler validate` 和 `hdiutil verify`。
  - macOS 的 arm64 部分和两个 Windows 程序，`vcs.revision` 都是 `39d73fc`，`vcs.modified=false`。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Liubai.0.6.5.dmg` | 11,086,582 | `1cd4e7bba9f474097122c321125ebd06ea77e7778c3360f33329fcb81c02c150` |
| `Liubai.Setup.0.6.5.amd64.exe` | 6,736,023 | `6b2bdd1b0f7b75ee463388d677728744b0e343c272d4f59362f1ac93d290548f` |
| `Liubai.Setup.0.6.5.arm64.exe` | 6,036,321 | `698ade0482d6eea4cf6c34cfc608a4be04d8c9dfa6cb01b9d8da5125d8275140` |

- 已发布为最新版。匿名下载三份更新清单和三个安装包，都与本地构建的文件一致，清单里的版本是 0.6.5。
- **网站：** echovic-apps `5abd2f4` 把备用版本改为 v0.6.5，并在「拖块、敲斜杠」一节加上标题、列表快捷键和工具栏提示的介绍。安装包仍是 11、7、6 MB，线上中英文页面都已更新。
