# 分栏预览模式设计

**日期**：2026-10-15
**状态**：已实现并验证
**范围**：留白桌面端 0.3.0 新功能
**实施计划**：[2026-10-15-split-preview.md](../plans/2026-10-15-split-preview.md)
**验证记录**：[2026-10-15-split-preview.md](../validation/2026-10-15-split-preview.md)

## 背景与目标

留白当前只有单栏视图：默认 Typora 式「即时排版」（CodeMirror 装饰渲染），⌘⇧M 可切到纯 Markdown 源码。没有独立的阅读预览，成品效果只能通过「带走文稿」导出 PDF/HTML 查看。

本设计新增「分栏预览」作为与「即时排版」并列的主模式：左侧即时排版（可选切源码），右侧只读成品阅读视图，边写边对照最终效果。

## 关键决策（已与用户确认）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 分栏左侧形态 | 即时排版（可选源码） | 贴合留白「一页写作桌」定位，源码作为分栏内子选项 |
| 主模式数量 | 两档：单栏即时排版 / 分栏预览 | 简单直接；源码收进分栏内 |
| 滚动联动 | 软联动：光标跨段时预览滚到对应块，鼠标滚轮独立 | 避免像素级映射误差抖屏，体验自然 |
| 模式持久化 | 全局偏好（存 Appearance） | 分栏是写作方式，非文稿属性 |
| 渲染来源 | 复用 markdown-it 单一渲染源 | 避免预览与导出双实现漂移 |

## 现状分析

- **即时排版**：[src/editor.ts](../../../src/editor.ts) 的 `richExtensions` 用 CodeMirror 装饰把标记渲染成样式，`mode` Compartment 控制即时排版/源码切换。
- **源码视图**：`mode.of(doc.position.source ? [] : richExtensions(...))`，按文稿存在 `Position.source`。
- **交付渲染**：[src/delivery.ts](../../../src/delivery.ts) 的 `renderDelivery` 用 markdown-it 渲染，但直接套了**打印用内联样式**，且外链图片不加载、缺失图片转提示文字——不能直接当屏幕预览。
- **图片解析**：[src/app.ts](../../../src/app.ts) 的 `resolveImage` 本地图走 `ReadImage`，外链 http(s) 直接返回原 URL。预览可复用。
- **布局**：[src/index.html](../../../src/index.html) 的 `.desk > .paper > #editor` 单栏居中，宽度由 `--paper-width` 控制，四主题全靠 CSS 变量。CSP 允许 `data:` `blob:` `https:` `http:` 图片。

## 设计

### 1. 模式与状态模型

新增**全局布局偏好** `layout: 'single' | 'split'`，存到 `Appearance`；现有 `source` 提升为全局布尔，仅在分栏内生效。

| layout | source | 效果 |
|--------|--------|------|
| single | （忽略） | 单栏即时排版（现状） |
| split | false | 左即时排版 / 右阅读 |
| split | true | 左纯源码 / 右阅读 |

`Position.source` 字段保留但忽略，保证已有文稿反序列化不报错。

### 2. 共享渲染（核心）

重构 `delivery.ts` 为两层：

**`renderMarkdown(content, { resolve, external })` — 单一渲染源**

- 用同一个 markdown-it 实例渲染，产出**带语义 class、不带打印内联样式**的 DOM（`.md-h1..h6`、`.md-p`、`.md-quote`、`.md-pre`、`.md-inline-code`、`.md-table`、`.md-ul`、`.md-ol`、`.md-task`、`.md-link`、`.md-image`）。
- 给每个块级元素加 `data-line` 与 `data-line-end` 属性：markdown-it 的 `token.map = [startLine, endLine]` 提供行号，`data-line-end` 转成 0-based **包含式**结束行。这是软联动滚动的锚点，不影响渲染语义。
- 图片：通过 `resolve(dest)` 解析（复用 `resolveImage`）。`external` 参数区分：
  - 屏幕预览：外链图片直接加载（与编辑器一致）。
  - 交付：外链转可点击链接、缺失图片显示提示（现有行为）。
- **不做任何正则预处理**，用户手写 Markdown 直接喂 markdown-it，避免强调/列表/表格互相污染。

**`applyPrintStyles(root)` — 仅交付用**

- 把现有 delivery.ts 那套内联打印样式抽到此函数，只在 PDF/HTML/富文本时调用。
- 屏幕预览吃语义 class + 四主题 CSS 变量，不套打印样式。

`renderDelivery` 改为：`const root = renderMarkdown(...); applyPrintStyles(root); return root;`。

### 3. 分栏布局

- `index.html` 的 `.desk` 内，在 `.paper` 旁新增 `<section id="preview" class="preview-pane" hidden></section>`。
- CSS：`.desk.split-mode` 时 `.desk` 变 grid：
  ```css
  grid-template-columns: clamp(320px, 45vw, 640px) minmax(0, 1fr);
  ```
  - 左侧 `.paper` 的 `max-width` 覆盖为 `100%`，吃满左栏。
  - 右侧 `.preview-pane`：`min-width: 0` + `overflow: auto`，保证预览优先不被挤压。
- 响应式降级：视口 < 820px 时 grid 切为上下两行（`grid-template-rows: 1fr 1fr`），两栏全宽。

### 4. 软联动滚动

- 预览每个块有 `data-line`。
- 编辑器 `selectionSet` 时 debounce ~120ms：取光标行号 N，在预览里优先选择包含 N 的最小可见块；没有包含块时回退到最近的前置块。
- 只在光标跨进新块时触发（记录上次同步的 `data-line`，相同则跳过）。
- 只计算阅读滚动容器内的 nearest 位置并调用该容器的 `scrollTo`，不使用可能滚动祖先的 `scrollIntoView`。
- 鼠标滚轮互不干扰，预览独立滚动不反向同步编辑器。

### 5. 模式切换 UI 与快捷键

- 顶栏：现有 `data-action="source"` 按钮改为 **布局切换按钮** `data-action="layout"`（分栏图标），切换 `single ↔ split`，快捷键 **⌘\**。
- 分栏内左侧源码切换：预览 pane 顶部放 pill「源码 / 即时」，复用 **⌘⇧M**；单栏下 ⌘⇧M 提示「分栏模式下可用」。
- 实时刷新：`docChanged` 时 debounce ~250ms 重渲染预览。

### 6. 持久化

- `workspace.go` 的 `Appearance` 加 `Layout string`（默认 `"single"`）和 `Source bool`（默认 `false`）。
- `Appearance()` 方法存盘，加载时兜底默认值。
- 切换布局/源码时调 `call('Appearance', ...)` 持久化。

## 实现步骤

1. **后端**：`Appearance` 加 `Layout`/`Source` 字段与默认值，`Appearance()` 存盘。
2. **渲染重构**：`delivery.ts` 抽出 `renderMarkdown`（语义 class + `data-line` + 可配置外链策略）与 `applyPrintStyles`；更新 `renderDelivery`。
3. **HTML**：加 `#preview` 容器。
4. **CSS**：`.split-mode` grid 布局、`.preview-pane` 阅读样式（吃主题变量）、响应式降级。
5. **app.ts**：
   - `layout`/`source` 全局状态，从 Appearance 加载。
   - `toggleLayout()`：切 `.split-mode`、显隐预览、持久化。
   - `renderPreview()`：debounce 调 `renderMarkdown` 替换 `#preview`。
   - `syncPreviewScroll()`：selection 时按 `data-line` 软联动。
   - `toggleSourceInSplit()`：分栏内切左侧即时排版/源码。
   - 快捷键 ⌘\ 与 ⌘⇧M、顶栏按钮接线。
6. **验证**：`tsc --noEmit`、`go test ./...`、`go vet ./...`；手工分栏切换、左右滚动、源码切换、图片/表格/外链渲染、窄屏降级。

## 实施结果

- `.desk` 使用固定 grid 行区，`.editor-pane` 与 `.preview-scroll` 是独立且有确定高度的滚动容器；低于 820px 改为上下排列。
- 块映射采用包含式 `data-line-end`，软联动选择覆盖光标的最小可见块；空白分隔行回退到最近的前置块，并只对阅读容器执行 `scrollTo`。
- 预览按文稿 ID、渲染代次和保存 epoch 隔离异步图片结果。新引用在保存后可重试一次；即使 `ReadImage` 在换稿后才结束，也不能刷新或污染当前文稿。
- 每次载入只渲染一次预览；同 ID 文稿重新载入与另存后的图片路径改写仍显式刷新。
- 回归使用真实 Go 工作区后端验证重载、新文稿、Recent 重开、本地图片导入与 HTML 下载；完整命令和原生验证边界见上述验证记录。

## 边界与不做

- 不做像素级左右同步滚动（软联动已满足需求）。
- 不做左右拖拽调宽（首版用 clamp 固定比例，后续可加）。
- 不改导出 PDF/HTML 的输出样式（`applyPrintStyles` 保持原样）。
- 不处理预览内的编辑交互（只读阅读视图）。
