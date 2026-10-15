# 分栏预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现全局记忆的单栏即时排版 / 分栏阅读预览，分栏允许源码编辑，并按光标所在段落软联动。

**Architecture:** CodeMirror 是正文与撤销历史的唯一来源；共享 markdown-it 模块负责阅读与交付 DOM，交付单独应用现有打印样式。预览控制器管理刷新、异步图片与段落定位，布局和全局偏好由应用协调。

**Tech Stack:** Go、MyGo、TypeScript、CodeMirror 6、markdown-it、CSS Grid，沿用现有依赖。

**Spec:** [已确认设计](../specs/2026-10-15-split-preview-design.md)
**Validation:** [2026-10-15-split-preview.md](../validation/2026-10-15-split-preview.md)

## 执行约束

- 使用当前 checkout 的 `feat/split-preview` 分支，不创建 git worktree。
- 本轮用户已授权实现，不再询问实施方式。
- 当前 `README.md`、`mygo.json` 有之前签名任务的未提交修改，保留这些内容，提交按功能拆分。
- 不实现拖动调宽、反向滚动同步、阅读区编辑或 Markdown 文本预处理。
- 回归数据、截图和临时构建脚本写到系统临时目录；正式测试源码可以放在 `scripts/` 和仓库 Go 测试中。
- 原生中文候选、系统 PDF 对话框的验证与浏览器合成输入验证分别记录，不混称。

## 文件职责与接口

| 文件 | 职责 |
| --- | --- |
| `workspace.go`、`src/types.ts` | 全局 `Appearance.layout/source`、默认值与兼容 |
| `src/markdown.ts`（新增） | markdown-it 解析、块行号、图片策略、语义 DOM |
| `src/delivery.ts` | 共享渲染适配、原有内联打印样式、复制与等待图片 |
| `src/preview.ts`（新增） | 预览刷新、防止过期结果、软联动、资源生命周期 |
| `src/preview.css`（新增） | 两栏滚动、阅读样式、窄窗口上下布局 |
| `src/app.ts`、`src/editor.ts` | 全局模式与编辑器事件接线，保留编辑会话 |
| `src/index.html`、`src/icons.ts`、`main.go` | 模式入口、语义容器、图标与原生菜单 |
| `scripts/check-preview.ts`（新增） | 渲染与交付 DOM 回归，在真实浏览器中执行 |
| `workspace_preview_test.go`（新增） | 偏好默认值、校验与重启持久化 |

共享渲染使用显式图片策略，返回根元素及图片解析完成信号：

```ts
export interface MarkdownOptions {
  resolve: (destination: string) => string | undefined | Promise<string | undefined>;
  external: 'load' | 'link';
}
export interface MarkdownRender {
  root: HTMLElement;
  ready: Promise<void>;
  dispose: () => void;
}
export function renderMarkdown(content: string, options: MarkdownOptions): MarkdownRender;
```

`ready` 代表资源地址解析完成；图片真正完成解码仍由交付的 `waitImages` 检查。资源失败转换成明确提示；交付内嵌图片解码失败维持原有错误。预览关闭、换文稿、重新渲染必须使旧回调失效。

```ts
// 全局属性允许旧工作区没有字段；服务端对外规范化默认值。
layout?: 'single' | 'split';
source?: boolean;
// 编辑器真实形态由全局偏好派生，不读 Position.source。
const source = appearance.layout === 'split' && appearance.source === true;
```

## Task 1: 全局偏好与共享阅读渲染

**Files:** `workspace.go`, `workspace_preview_test.go`, `src/types.ts`, `src/markdown.ts`, `src/delivery.ts`, `scripts/check-preview.ts`

- [x] 写入并运行偏好回归：初次启动与缺失字段均返回 `single/false`；`split/true` 经关闭重开仍保留；非法布局请求失败且不改已有偏好；旧 `Position.source` 不改变全局模式。
- [x] 服务端新增 `Layout`、`Source`；加载空值/未知布局回退 `single`，写入空值规范化，非法非空值拒绝。保留现有原子写入失败回滚。
- [x] 写入并执行渲染回归：标题、嵌套列表、引用、围栏代码、表格、只读任务项、中文和特殊字符图片路径；块记录 0-based 起止行。断言原始 Markdown 不变。
- [x] 用 markdown-it token map 输出 `data-line`/`data-line-end`。容器与子块同起始行时，后续定位选覆盖光标的最小可见块，代码围栏以整体块定位。
- [x] 图片先输出 `data-image-source`，不创建未经策略审核的 `src`；预览允许现有 http(s) 图片，交付将外链转链接且不触发网络请求。支持同步/异步本地解析，错误显示提示，`dispose()` 防止旧图片回调生效。
- [x] 保留 `renderDelivery(data)` 调用适配及打印内联样式；如改为异步，明确更新调用方等待 `ready`。语义 class 作用域限定在屏幕阅读容器，防止泄漏进交付。
- [x] 验证 `go test ./...`、`go vet ./...`、`node_modules/.bin/tsc --noEmit` 和浏览器 DOM 回归后提交 `feat(preview): add shared rendering and global preferences`。

## Task 2: 分栏与软联动接线

**Files:** `src/preview.ts`, `src/preview.css`, `src/style.css`, `src/app.ts`, `src/editor.ts`, `src/index.html`, `src/icons.ts`, `main.go`

- [x] 先在真实页面记录现状：没有分栏入口/阅读面板。新交互回归断言分栏面板存在、可切换且全局记住；该断言应先失败。
- [x] 保留一个 EditorView；用 `mode.reconfigure` 切换源码/即时排版，禁止通过重建编辑器或重新写入全文切模式。单栏强制即时排版，分栏恢复上次 `source` 偏好。
- [x] 顶栏显示即时排版 / 分栏预览入口；分栏内显示「左侧编辑」的即时/源码开关。接入 `Cmd/Ctrl+\` 与 `Cmd/Ctrl+Shift+M`、操作搜索、原生显示菜单。单栏源码操作提示仅在分栏可用。
- [x] `.desk` 设置显式 grid areas，标题/底注跨两栏；左编辑滚动容器和右阅读滚动容器有确定高度与 `min-height:0`。列宽使用 `clamp(320px,45vw,640px) minmax(0,1fr)`；小于 820px 上下各占可用高度一半。单栏保留原有纸张布局。
- [x] 预览读取 `view.state.doc` 最新内容，不通过 `save()` 或 `Delivery` API 获取正文；约 250ms 去抖刷新，单栏停用，切回分栏立即展示最新内容。文稿 ID 与渲染代次绑定，防止旧异步结果覆盖新文稿。
- [x] 软联动约 120ms 去抖，CodeMirror 行号减一；仅跨块且目标不可见时滚动右侧内部容器。禁止使用会滚动所有祖先的无界 `scrollIntoView`；用预览容器 `scrollTo` 实现 nearest。尊重 reduced-motion，手动滚轮取消待执行定位；下一次跨块光标事件再恢复定位。
- [x] 刷新保留预览滚动锚点，避免 `replaceChildren` 将阅读跳回顶部；图片加载后不强制拉回手动阅读位置。未变化正文的选区移动不重新解析。
- [x] compositionstart 暂停刷新/软联动，compositionend 后刷新已确认文本。模式切换遵循现有组合输入保护。新文稿、最近文稿、另存后图片路径改写均触发正确预览。
- [x] 左栏位置保存从实际滚动容器读取；布局改变时迁移滚动位置并保留光标/撤销。关闭前等待偏好保存队列。偏好写入失败沿用应用错误提示。
- [x] 阅读面板只读，链接走现有安全协议/原生 `OpenLink` 路径，页内锚点在阅读区定位；任务框不可修改文稿。字号、行宽与四主题即时生效。
- [x] 验证类型、构建及浏览器交互通过后提交 `feat(editor): add split reading preview and soft follow`。

## Task 3: 验收、文档与可运行产物

**Files:** `README.md`, `web/`, `bindings.ts`, 本计划、设计状态；必要时版本文件

- [x] 执行 Go 测试与 vet、TypeScript 类型检查、现有三个编辑回归脚本、共享渲染浏览器回归。
- [x] 实际浏览器检查单/分栏反复切换、即时/源码、撤销重做、Recent 重开、重载/新文稿偏好与合成 composition 期间不重渲染。
- [x] 长文档验证跨段定位、段内不滚动、两侧手动滚动不联动、重新渲染保持阅读位置、异步图片与快速换稿无串稿。
- [x] 在 1120×820、1440×900、800×700、680×540 检查两侧尺寸、全局横向溢出、表格/代码局部滚动；检查四主题和字体变化。
- [x] 导出 HTML/共享富文本 DOM 保持打印样式、本地图片内嵌、外链无抓取、整篇输出；原生 PDF、输入法和跨应用粘贴明确列为未覆盖。
- [x] 更新使用说明、实施记录、构建 `web/` 与 bindings。版本沿设计为 0.3.0，保留已有签名配置。
- [x] 提交 Task 3 验证、文档、版本和生成产物；不推送或发布远端 Release。
- [x] Parent：最终整分支差异审查；`81185a4` 修复空白行定位与重复渲染，定向复核通过。
- [x] Parent：生成正式签名的 darwin/universal 安装包。
- [x] Parent：验证 codesign、spctl、stapler、公证与架构。

正式构建已完成签名与 Apple 公证，产物位于 `build/preview-0.3.0/darwin-universal`。应用及 DMG 的 codesign、Gatekeeper、stapler 验证均通过，同时确认双架构、版本与 DMG 完整性；原 0.2.0 产物及应用进程保持不变。未推送或发布远端版本。

## 计划核对

| 交界 | 生产与消费 | 结论 |
| --- | --- | --- |
| Task 1 → 2 | `Appearance.layout/source` → 派生编辑模式 | 单栏忽略 source，保留分栏偏好 |
| Task 1 → 2 | `MarkdownRender.root/ready/dispose` → 预览生命周期 | 同步骨架、异步图片，不等待保存 |
| Task 1 → 2 | `data-line/end` → 段落定位 | 起止行解决容器/子块同起始行歧义 |
| Task 1 → 3 | `renderDelivery` → 导出验证 | 保留离线图片策略与打印样式 |
| Task 2 → 3 | 新滚动容器 → 保存位置/软联动验证 | 验证双栏互不干扰与切换后位置 |
| 各 Task | 测试、实现文件与提交范围 | 基础逻辑、界面接线、产物验证分开 |
