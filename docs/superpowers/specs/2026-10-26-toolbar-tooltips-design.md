# 工具栏悬停提示与格式快捷键 设计

**日期**：2026-10-26
**状态**：已与用户确认快捷键范围（标题 + 常用格式）、提示内容（名称 + 快捷键）和整体做法，待写实施计划
**来源**：issue #1 希望用 Ctrl+1–5 把文字改成 1–5 级标题；用户要求「hover 到工具栏上有提示，提示里不仅要有这个工具的作用，还有对应的快捷键提示」。

## 背景与现状

- 工具栏按钮的提示只有原生 `title`：macOS 上要停一秒多才出现，样式不跟主题，Windows 上又是另一种样子，用键盘切到按钮上不显示，快捷键只能和名称挤在一行文字里。
- 格式栏 25 个图标按钮里，只有撤销、重做、加粗、下划线、链接、查找写了快捷键。标题、斜体、删除线、高亮、行内代码、列表都没有快捷键。
- ⌘I 被 CodeMirror 的默认键位占作「选中上一级语法」（`selectParentSyntax`），而表格单元格里 ⌘I 早已是斜体，正文和单元格不一致。
- 快捷键的写法散在好几处：格式栏按钮表（`src/app.ts` 的 `formatButtons`）、⌘K 列表（`commands`）、文档级按键处理（`document.addEventListener('keydown',…)`）、`src/index.html` 的 `data-shortcut` 和 `<kbd data-keys>`、原生菜单（`main.go`）。

## 决定

1. 新增 14 个格式快捷键：正文、标题 1–6、斜体、删除线、高亮、行内代码、三种列表（见「快捷键」）。
2. 工具栏的提示改为自绘：一个跟随主题的提示层，显示名称和快捷键，鼠标悬停和键盘聚焦都会出现（见「提示」）。
3. 格式快捷键集中到一张表（`src/shortcuts.ts`），提示、标题菜单、⌘K 列表和按键处理都读它。

不采用的方案：

- **沿用原生 `title`，只补快捷键文字**：改动最小，但出现慢、不跟主题、键盘聚焦不显示，平台之间样子不同。
- **纯 CSS 提示（`::after` + `attr()`）**：靠窗口边的按钮会被裁掉，做不到「延迟出现、相邻按钮立即切换」，快捷键无法单独排版。
- **全面对齐 Typora**（再加 ⌥⌘Q 引用、⌥⌘C 代码块、⌥⌘B 公式、⌥⌘T 表格、⌃⌘I 图片）：Windows 上 Ctrl+Alt 等于 AltGr，只能另配一套 Ctrl+Shift 组合；Typora 的 ⌘K 链接、⌘\ 清除格式和留白现有的 ⌘K 所有操作、⌘\ 分栏冲突；⌥⌘Q 离 ⌘Q 退出只差一个键。
- **标题用 ⌘⌥1–6**：issue 要的正是 Ctrl+数字，Typora、Bear 也用 ⌘1–6。
- **标题快捷键做成切换（再按一次回正文）**：标题菜单是「设为某一级」，两处语义要一致；回正文按 ⌘0。
- **提示里加一句话说明或 Markdown 写法**：用户选了「名称 + 快捷键」，与主流编辑器一致，提示保持一行。

## 快捷键

### 清单

键位用 `src/platform.ts` 的写法：`Mod` 在 macOS 上是 ⌘，在 Windows 上是 Ctrl，由 `keyLabel` 渲染。

| 动作 id | 操作 | 键位 | macOS | Windows | 状态 |
|---|---|---|---|---|---|
| `paragraph` | 正文 | `Mod+0` | ⌘0 | Ctrl+0 | 新增 |
| `h1`–`h6` | 标题 1–6 | `Mod+1`–`Mod+6` | ⌘1–⌘6 | Ctrl+1–Ctrl+6 | 新增 |
| `italic` | 斜体 | `Mod+I` | ⌘I | Ctrl+I | 新增 |
| `strike` | 删除线 | `Mod+Shift+X` | ⌘⇧X | Ctrl+Shift+X | 新增 |
| `highlight` | 高亮 | `Mod+Shift+H` | ⌘⇧H | Ctrl+Shift+H | 新增 |
| `inlineCode` | 行内代码 | `Mod+E` | ⌘E | Ctrl+E | 新增 |
| `ordered` | 有序列表 | `Mod+Shift+7` | ⌘⇧7 | Ctrl+Shift+7 | 新增 |
| `bullet` | 无序列表 | `Mod+Shift+8` | ⌘⇧8 | Ctrl+Shift+8 | 新增 |
| `task` | 任务列表 | `Mod+Shift+9` | ⌘⇧9 | Ctrl+Shift+9 | 新增 |
| `bold` | 加粗 | `Mod+B` | ⌘B | Ctrl+B | 已有，并入表 |
| `underline` | 下划线 | `Mod+U` | ⌘U | Ctrl+U | 已有，并入表 |
| `link` | 链接 | `Mod+L` | ⌘L | Ctrl+L | 已有，并入表 |
| `undo` | 撤销 | `Mod+Z` | ⌘Z | Ctrl+Z | 已有，只用于显示 |
| `redo` | 重做 | `redoKeys` | ⌘⇧Z | Ctrl+Y | 已有，只用于显示 |
| `find` | 查找替换 | `Mod+F` | ⌘F | Ctrl+F | 已有，只用于显示 |
| `source` | 显示 Markdown 源码 | `Mod+Shift+M` | ⌘⇧M | Ctrl+Shift+M | 已有，只用于显示 |
| `outdent` | 减少缩进 | `Shift+Tab` | ⇧Tab | Shift+Tab | 已有（列表内），只用于显示 |
| `indent` | 增加缩进 | `Tab` | Tab | Tab | 已有（列表内），只用于显示 |

「只用于显示」的几项仍由原来的地方处理：撤销、重做和查找由 CodeMirror 与原生菜单处理，源码由原生菜单（桌面）或现有按键处理（网页）处理，缩进由编辑器的 Tab 键位处理。上标、下标、清除格式、引用和插入类工具（图片、表格、代码块、公式、图表、脚注）这次不加快捷键。

### 行为

- 快捷键与点对应的工具栏按钮完全相同，都走 `action(id)`：
  - ⌘0–⌘6 和标题菜单一样，把选区里每一行设为该级（`setHeading`），不是切换；⌘0 回正文。
  - 斜体、删除线、高亮、行内代码用 `wrapSelection` 加上或去掉 `_ _`、`~~ ~~`、`== ==`、`` ` ` ``，再按一次取消。
  - 三种列表用 `blockFormat` 切换，选区各行都已是该列表时再按一次取消。
- 沿用 `action()` 已有的限制：
  - 阅读模式下弹出现有提示「阅读模式下不能编辑，⌘⇧R 返回编辑」；
  - 输入法组字时不响应（`e.isComposing`、`compositionActive`）；
  - 选中图片时行内格式不生效，标题和列表也不生效；
  - 在表格单元格里，行内格式作用于单元格文字（`formatTableCell`），标题和列表不生效。
- 有对话框打开时不响应，与现有按键处理一致。
- 焦点在文本框里（`input`、`textarea`、`select`，例如侧栏的文稿搜索、编辑器的查找框）时，格式快捷键不响应，交给文本框自己处理。焦点在菜单里（`role=menu`，例如表格菜单、块菜单）或编辑区里的按钮上（例如表格的 ⋯ 按钮）时同样不响应：这时编辑器的选区不是用户正在操作的对象，按下去会改到表格背后的 Markdown（2026-10-26 审查发现）。这同样作用于并入表里的 ⌘B、⌘U、⌘L；以前在搜索框里按 ⌘B 会改动正文，这是顺带修掉的问题。
- 去掉 CodeMirror 默认键位里的 `Mod-i`（`selectParentSyntax`），做法和当年去掉 `Mod-u` 一样（`src/editor.ts` 的 keymap）。表格单元格里现有的 ⌘B/⌘I/⌘U/⌘L 处理（`src/table-ui.ts`）不变。

### 按键识别

- `Mod` 在 macOS 上只认 ⌘（`metaKey`，且 `ctrlKey` 为假），在 Windows 上只认 Ctrl（`ctrlKey`，且 `metaKey` 为假）。
- Shift 必须和键位一致：⌘E 是行内代码，⌘⇧E 什么也不做；Ctrl+X 仍是剪切，Ctrl+Shift+X 才是删除线。
- Alt 必须没按：Windows 上 Ctrl+Alt 等于 AltGr，用来输入字符；macOS 上 ⌥ 会改变字符。
- 字母按 `e.key`（转小写）识别，这样非 QWERTY 布局也按字母本身算。数字按 `e.code`（`Digit0`–`Digit9`）识别，因为 Shift+7 在美式键盘上打出的是 `&`；小键盘数字不算。
- 匹配在文档级按键处理里做，和现在的 ⌘B 一样。并入表里的 ⌘B、⌘U、⌘L 改用同一套匹配；新建、打开、保存、导出 PDF、所有操作、专注、分栏、阅读、源码、粘贴为纯文本、Windows 的 Ctrl+Shift+Z 重做这些现有分支不动。

### 冲突检查

- **macOS**：系统保留的 ⌘⇧3/4/5/6（截图）、⌘H、⌘M、⌘Q、⌘W、⌃⌘F 都没用到；留白的原生菜单没有这些组合；WKWebView 不占它们。
- **Windows**：
  - MyGo 只在开着开发者工具时才启用 WebView2 的浏览器按键（`AreBrowserAcceleratorKeysEnabled`），所以正式版里 Ctrl+0 不会复位缩放。
  - 微软拼音的 Ctrl+Shift+F（简繁）、Ctrl+.（中英文标点）、Ctrl+Shift+B（表情和符号）都避开了。
  - 中文输入法会不会占用 Ctrl+Shift+数字、Ctrl+Shift+X、Ctrl+Shift+H，只能在真机上确认，列为发版前待办。
- **CodeMirror**：新组合里只有 `Mod-i` 被占，去掉它。`Ctrl-e` 是 macOS 上的 emacs 式「到行尾」，⌘E 不受影响。

### 显示在哪里

- 工具栏提示（见「提示」）。标题按钮显示「标题级别 ⌘1–6」（Windows 上是 Ctrl+1–6）。
- 标题菜单每一项右侧：正文 ⌘0、标题 1 ⌘1 … 标题 6 ⌘6，写法与「更多」菜单相同。
- ⌘K 所有操作：斜体、删除线、高亮、行内代码、正文、标题 1–6、三种列表都显示快捷键。
- README 与 README.en 的常用快捷键。

不改原生菜单栏（不加「格式」菜单），也不在块菜单「转换为」里标快捷键：它作用于块手柄所在的块，而快捷键作用于光标所在的行。

## 提示

### 外观

浮在页面上的一个小层（DESIGN.md 新增 Tooltip 组件）：

- 浮起纸面 `var(--popover)`，1px 细线 `var(--border)`，圆角 6px，阴影用图片工具条那一档 `0 3px 12px #0002`。
- 界面字体 12px，内边距 5px 8px。名称用墨色 `var(--foreground)`，快捷键用铅笔色 `var(--muted-foreground)` 靠右，间距 12px，字号和写法与菜单里的快捷键相同（`.menu kbd`）。
- 没有快捷键时只显示名称。最宽 320px，名称可以折行，快捷键不折行。
- 只读颜色角色，11 套主题都不需要单独处理；打印和导出时不出现。

### 出现与消失

- 鼠标（`pointerType` 为 `mouse` 或 `pen`）停在按钮上 500ms 后出现。触摸不出现。
- 提示正在显示，或者上一个提示消失不到 800ms 时，移到另一个按钮立即显示，不再等待。
- 用 Tab、Shift+Tab、方向键、Home、End 把焦点移到按钮上（匹配 `:focus-visible`）时立即出现，焦点离开时消失。其他按键（Esc、Enter、空格、字母等，修饰键除外）都会收起提示，由它们引起的焦点变化（例如 Esc 关菜单后焦点回到按钮、Enter 打开侧栏后焦点留在按钮上）不会让提示重新出现（2026-10-26 审查发现）。
- 消失：鼠标离开按钮、按下鼠标（按下之后在同一个按钮上不再出现，直到鼠标离开再回来）、按 Esc、页面任何地方滚动、窗口缩放、窗口失去焦点、切换界面语言。Esc 只用来收起提示，不拦截它原有的用途（关侧栏、退出专注等）。
- 不出现：按钮的菜单正打开（`aria-expanded="true"`）、按钮隐藏、页面在打印。提示所指的按钮被移出页面（例如列表重新渲染）时，下一次鼠标移动就收起提示。
- 没有淡入淡出，出现和消失都是即时的（DESIGN.md：悬停即时，只有两处过渡）。
- 禁用的按钮能否出现提示取决于浏览器是否把鼠标事件交给它，不额外处理。

### 位置

- 按钮正下方 6px，水平居中。
- 下方放不下（离窗口底边不足 8px）时放到按钮上方 6px。
- 左右离窗口边至少 8px。格式栏换行时同样适用。

### 无障碍

- 提示层是一个元素：`role="tooltip"`，有固定 id。显示时，把它挂到当前按钮的 `aria-describedby` 上，消失时移除。
- 快捷键执行的就是按钮自己的动作时，按钮加 `aria-keyshortcuts`，按平台写成 `Meta+I`、`Control+Shift+X` 这样的形式。适用于格式栏有快捷键的按钮、源码按钮、分栏、阅读、侧栏的新建、标题菜单的七项。标题按钮本身不加，因为 ⌘1–6 不是打开它的菜单。
- 去掉这些按钮的 `title`，免得系统提示和自绘提示同时出现。`aria-label` 和可见文字不变。
- 标题菜单的快捷键 `<kbd>` 加 `aria-hidden="true"`，菜单项的可访问名称仍是「正文」「标题 1」……，快捷键由菜单项的 `aria-keyshortcuts` 表达。

### 数据

- 按钮用 `data-tip` 写提示文字，用 `data-shortcut` 写键位（如 `Mod+Shift+X`）；显示时用 `keyLabel` 按平台渲染。
- 格式栏（含插入、源码按钮）和最近文稿的移除按钮由脚本生成，`data-tip` 在生成时写入，切换语言时由 `refreshLanguage` 更新。
- `index.html` 里的静态按钮用 `data-i18n-tip="消息键"`，由 `localizePage` 写入 `data-tip`（与现有的 `data-i18n-title` 同理）。

## 覆盖范围

| 位置 | 按钮 | 提示文字（中文） | 快捷键 |
|---|---|---|---|
| 顶栏 | 侧栏 | 侧栏：最近文稿 | — |
| 顶栏 | 文稿名 | 重命名 | — |
| 顶栏 | 编辑 | 只显示编辑区 | — |
| 顶栏 | 分栏 | 编辑区和阅读视图并排 | ⌘\ |
| 顶栏 | 阅读 | 只显示排好版的文稿 | ⌘⇧R |
| 顶栏 | 外观 | 外观与排版 | — |
| 顶栏 | 导出 | 导出 PDF、HTML、ZIP 或复制富文本 | — |
| 顶栏 | 更多 | 更多 | — |
| 顶栏 | 大纲 | 大纲 | — |
| 格式栏 | 插入 | 插入 | — |
| 格式栏 | 撤销、重做 | 撤销、重做 | ⌘Z、⌘⇧Z |
| 格式栏 | 标题级别 | 标题级别 | ⌘1–6 |
| 格式栏 | 加粗 … 清除格式 | 各自名称 | 见清单 |
| 格式栏 | 引用 … 增加缩进 | 各自名称 | 见清单 |
| 格式栏 | 链接 … 脚注 | 各自名称 | 链接 ⌘L |
| 格式栏 | 查找 | 查找替换 | ⌘F |
| 格式栏 | 源码 | 显示 Markdown 源码 | ⌘⇧M |
| 侧栏 | 新建 | 新建文稿 | ⌘N |
| 侧栏 | 关闭 | 关闭侧栏 | — |
| 侧栏 | 最近文稿的移除（×） | 从最近文稿移除 | — |

这次不改：编辑区里的块手柄、图片工具条、折叠块按钮，以后可以直接接入同一个组件；Markdown 图片自己的 `title` 是文稿内容，不能动。

## 代码结构

- **新增 `src/shortcuts.ts`**
  - `shortcuts`：动作 id → 键位，即上面的清单，`redo` 取 `redoKeys`。
  - `shortcutAction(e, {macOS})`：返回按键对应的动作 id，只认「并入表」的那些项（新增 14 项和 ⌘B、⌘U、⌘L），按「按键识别」的规则匹配。`macOS` 默认取 `platform.ts` 的 `mac`，便于单元检查。
  - `ariaKeys(keys, {macOS})`：把键位转成 `aria-keyshortcuts` 的写法。
- **新增 `src/tooltip.ts`**：`attachTooltips()` 建一个提示层，在 `document` 上委托监听 `pointerover`/`pointerout`/`pointerdown`/`focusin`/`focusout`/`keydown`，以及捕获阶段的 `scroll` 和窗口的 `resize`/`blur`。凡是带 `data-tip` 的元素都能出提示，内容在显示时读取，所以切换语言后不必刷新。
- **修改 `src/app.ts`**
  - `formatButtons` 的快捷键改为从 `shortcuts` 取键位，生成按钮时写 `data-tip`、`data-shortcut`、`aria-keyshortcuts`，不再写 `title`；`refreshLanguage` 同步。
  - 插入按钮、源码按钮、最近文稿的移除按钮改用 `data-tip`。
  - 文档级按键处理先问 `shortcutAction(e)`，删掉原来的 b、u、l 三个分支。
  - ⌘K 列表从 `shortcuts` 取键位。
  - 启动时调用 `attachTooltips()`，并设置标题菜单项的 `aria-keyshortcuts`。
- **修改 `src/index.html`**：顶栏、侧栏头部的 `title`/`data-i18n-title` 改为 `data-tip`/`data-i18n-tip`；标题按钮去掉 `title`，加 `data-tip`、`data-i18n-tip="fHeadingLevel"`、`data-shortcut="Mod+1–6"`；标题菜单七项改为 `<span data-i18n>` 加 `<kbd data-keys aria-hidden="true">`（「更多」菜单的结构）。
- **修改 `src/i18n.ts`**：`localizePage` 支持 `data-i18n-tip`。
- **修改 `src/editor.ts`**：keymap 里过滤掉 `defaultKeymap` 的 `Mod-i`，并在注释里写明原因。
- **修改 `src/style.css`**：加 `#tooltip` 样式。
- **修改文案**（`locales/zh-Hans.json`、`locales/en.json`，再运行 `go tool mygo generate`）：
  - 侧栏新建按钮改用 `fNewDocument`，源码按钮改用 `fShowMarkdownSource`，删掉不再使用的 `fNewDocumentN`、`fShowMarkdownSourceM`；
  - `fShowTheEditorAndReadingViewSideBySide`、`fShowTheFormattedDocumentR` 去掉 `{shortcut}`，快捷键改由提示右侧显示；
  - 不需要新文案：各工具的名称都已有。
- **修改文档**：README、README.en 的常用快捷键；DESIGN.md 增加 Tooltip 组件，并在 Shadow Vocabulary 的 Image Tools 一项注明提示层也用这一档。

## 测试

- **新增 `scripts/check-shortcuts.ts`**（bun 单元检查），分 macOS 和 Windows 两套：
  - 新增 14 项和 ⌘B、⌘U、⌘L 都能识别，包括 `Shift+7` 报告 `&` 的情况；
  - 不该识别的组合：macOS 上的 Ctrl+数字、Windows 上的 Ctrl+Alt+数字（AltGr）、Ctrl+X（剪切）、⌘⇧E、⌥⌘1、小键盘数字；
  - `ariaKeys` 的输出；
  - 清单里每一项的 `keyLabel` 写法。
- **修改 `scripts/check-toolbar.py`**
  - 计时用 Playwright 的可控时钟在单独的页面里验证：499ms 时还没出现、500ms 出现，沿工具栏移动立即切换，收起后 799ms 内立即出现、800ms 后重新等待。
  - 原来断言 `title` 的地方改成断言提示：文字和快捷键正确、离开/按下/Esc 后消失、按下后停在原处不再出现、Tab 聚焦立即出现、提示在按钮下方且不超出窗口（含 500px 宽的窄窗口）、夜墨主题下背景是该主题的 `--popover`。
  - 顶栏、格式栏、侧栏的按钮都有 `data-tip`，且都没有 `title`。
  - 标题菜单的快捷键写法；⌘K 列表里新增的快捷键。
  - 逐个按新快捷键，核对编辑器内容和存下来的草稿；每个可切换的项再按一次能取消。另外核对表格单元格（⌘E 生效，⌘1、⌘⇧7 不生效）、阅读模式（弹出提示，内容不变）、选中图片（⌘I 不生效）、侧栏搜索框里按 ⌘1（正文不变）。
- **修改 `scripts/check-windows.py`**
  - `title` 断言改成提示断言：Ctrl+B、Ctrl+Y、Ctrl+\、Ctrl+Shift+R、Ctrl+N、Ctrl+1–6；
  - 标题菜单显示 Ctrl+0–Ctrl+6；
  - Ctrl+1、Ctrl+Shift+7 生效，Ctrl+Alt+1 不生效；
  - `mac_symbols_outside_documents` 也检查 `data-tip`。
- **修改 `scripts/check-english.py`**：扫描的属性加上 `data-tip`。
- **其余**：`go tool mygo i18n check`、`node scripts/check-i18n.mjs`、`tsc --noEmit`、`go test ./...`（含启动包体积）、`node scripts/build.mjs`、全部 bun 单元检查、`scripts/check-performance.ts`，以及会受影响的浏览器回归（toolbar、windows、english、blocks、tables、images、split-preview）。

## 不在这次范围

- 上标、下标、清除格式、引用、代码块、表格、图片、公式、图表、脚注的快捷键。
- 原生菜单栏的「格式」菜单；块菜单「转换为」和插入菜单里的快捷键标注。
- 自定义快捷键；标题快捷键的切换行为。
- 编辑区里浮动控件（块手柄、图片工具条、折叠块按钮）的提示。

## 发版前待办

- Windows 真机或虚拟机：在微软拼音和搜狗输入法开着的情况下，逐个按新组合键，确认没有被输入法占用。
- 在 issue #1 回复上线版本（等用户点头）。
