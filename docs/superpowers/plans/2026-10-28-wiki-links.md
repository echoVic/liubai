# 双链与反向链接 Implementation Plan

2026-10-29 发布准备补记：下文“不提交、不发布”描述开发阶段的授权范围。用户现已要求提交并准备 0.6.7，执行本地提交与正式打包；发布准备证据见 [0.6.7 验证记录](../validation/2026-10-29-release-0.6.7.md)。发布前复审将共享语法样本扩展为 60 条，统一 front matter 结束行及裸 URL 的排除规则。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking. 用户已要求继续推进下一功能，按已提出的双链路线连续实施；不增加批准流程，不提交、不发布、不创建 worktree。

**Goal:** 支持 `[[文稿名]]` 在登记工作区安全跳转，并在当前侧栏按需查看/定位反向引用。  
**Architecture:** 复用 Go 只读文稿快照，使用现有 Goldmark 识别语义引用；前端的纯语法适配 Lezer/markdown-it，反链队列与 DOM 单独成模块。候选与反链复用 SearchItem 和现有安全导航。  
**Tech Stack:** Go/MyGo、现有 Goldmark、TypeScript、CodeMirror/Lezer、markdown-it、DOMPurify、原生 details/dialog；不加依赖。

**设计**：[双链契约](../specs/2026-10-28-wiki-links-design.md)。  
**状态**：开发与验收完成；WL-1 至 WL-9 均通过。规格修复、独立质量审查、真实 API 回归与独占性能测量的最终证据见下文。

## Task 1：Go 语义解析、标题解析与反链

**Files:** 新建 `wiki_syntax.go`、`wiki_links.go`、`wiki_links_test.go`、`testdata/wiki-links.json`。复用 `searchSnapshot`、`searchHits`、`searchMemoryWorkspace`、`searchStateBytes` 和 `searchFiles`，不修改它们的现有语义。

- [x] 写共享正负样本：普通正文/中文 emoji/列表/表格/提示块/脚注为正例；front matter、代码、公式、HTML 属性/块、普通链接/图片、转义、嵌套、别名、空/超长为负例。每条含 `name`、`content` 和按源码顺序的 `references`，每个 reference 含 `target`、`raw`。
- [x] 写缺失实现会失败的 Go 测试；先运行 `go test -run '^TestWiki|^TestBacklink' -count=1 .`。

核心交集与来源检查样本：

```go
w := searchMemoryWorkspace(
    Document{ID: "source", Title: "来源", Content: "# 来源\n\n中😀 [[目标]]", Revision: 4},
    Document{ID: "target", Title: "目标", Content: "# 目标", Revision: 2},
)
resolved, err := w.ResolveWikiLink(WikiResolveRequest{SourceID: "source", Revision: 4, Target: "目标"}, "zh-Hans")
if err != nil || resolved.Total != 1 || resolved.Items[0].ID != "target" {
    t.Fatalf("resolve: %+v, %v", resolved, err)
}
back, err := w.Backlinks("target", "zh-Hans")
if err != nil || back.Total != 1 || back.Items[0].Hits[0].Text != "[[目标]]" {
    t.Fatalf("backlinks: %+v, %v", back, err)
}
```

- [x] 在 `wiki_syntax.go` 定义窄内部数据并以 Goldmark inline parser 实现；保留来源字节范围。用已有 front matter 前缀去除逻辑；跳过无 `[[` 的源文；不要正则全源统计。

```go
type wikiReference struct {
    Target string
    From, To int // original content byte offsets
}
func wikiReferences(content string) []wikiReference
```

Goldmark inline 扩展只记录 target 和原始 byte range，并将括号留给原生 Link/Image 解析。用 `text.Reader.PeekLine`/`Position` 取得来源，触发字符 `[`/`!`，原生 code/HTML/escape/link 解析器负责上下文。AST collector 在脚注裁剪前收集文本范围，不进入 Link/Image/CodeSpan/FencedCodeBlock/CodeBlock/HTMLBlock；公式节点或符合现有 displayMathBody 的段落同样排除。行内公式消费规则与 `src/math.ts:inlineMathEnd` 一致。

- [x] 定义设计中的 `WikiResolveRequest`、`BacklinkStatus`、`BacklinkResponse`。实现 `wikiTitle(Document) (string,bool)`：合法非空、非自动空白标题；不对实际标题做语言转换或大小写折叠。返回展示文稿时再用 `documentIn`。
- [x] 实现 `ResolveWikiLink`：快照中的来源 ID/revision/有效引用都通过后，完整标题查候选；缺失结果为空，候选按 updated/ID 排序并使用 SearchResponse 的 100 上限。
- [x] 实现 `Backlinks`：目标缺失错误，未命名/同名为独立 status；唯一目标遍历其余全部快照，语义 target 精确匹配，最多取每篇前四个位置，前三个经 `searchHits` 构建，完整来源总数先算后限 100。

```go
item := SearchItem{
    ID: strings.Clone(d.ID), Title: strings.Clone(documentIn(d, locale).Title),
    Path: strings.Clone(d.Path), Updated: d.Updated, Revision: d.Revision,
    Hits: searchHits(d.Content, positions[:min(len(positions), 3)]),
    MoreHits: len(positions) > 3,
}
```

- [x] 补齐来源修改/移除、非法目标、同名（含大小写）、未命名/显式命名、locale、源码尾部 UTF-16、105 来源/重启/未登记/移除、自引用、只读文件字节、通道控制快照和非 null 数组测试。
- [x] 窄 Go 测试/race 通过后先做后端规格审查，修复并复查；通过后做独立质量审查。

## Task 2：共享前端语法与显示/导出边界

**Files:** 新建 `src/wiki-links.ts`、`scripts/check-wiki-links.ts`；修改 `src/editor.ts`、`src/table-ui.ts`、`src/markdown.ts`、`src/preview.ts`；必要时为一致的 front matter 排除修正 `splitFrontMatter` 的关闭行空白处理，并增加相应回归。

- [x] 先用共享样本写纯语法、URI 与 Lezer/markdown-it 的失败测试，运行 `npx --yes bun@1.4.3 scripts/check-wiki-links.ts`。Lezer 提取测试同生产代码一样跳过 front matter、Link/Image/代码/公式祖先；markdown-it 使用相同前缀/body 和链接/图片上下文排除。
- [x] 实现纯谓词和严格内部 URI helpers：

```ts
export interface WikiSyntaxMatch {target:string;end:number}
export function wikiAt(text:string,start:number):WikiSyntaxMatch|null
export function wikiURL(target:string):string
export function wikiTarget(url:string):string|null
```

`wikiAt` 仅向同一行前进，验证边界、转义、256 Unicode 字符及不允许字符；不解析别名/锚点。`wikiURL` 为 `'liubai-wiki:'+encodeURIComponent(target)`；`wikiTarget` 捕获解码失败并重复名称验证，非保留协议返回 null。

- [x] `WikiSyntax` 定义 `WikiLink`、`WikiMark`、`WikiText`，Lezer parseInline 保留原生开括号，在最终闭括号处确认 Wiki 并让有效普通链接优先接管；谓词使用 paragraph raw source 的 local offset，元素使用绝对 UTF-16 offset。

```ts
return cx.addElement(cx.elt('WikiLink',pos,cx.offset+match.end,[
 cx.elt('WikiMark',pos,pos+2),
 cx.elt('WikiText',pos+2,cx.offset+match.end-2),
 cx.elt('WikiMark',cx.offset+match.end-2,cx.offset+match.end),
]));
```

- [x] `wikiPlugin` 在 markdown-it Link 之后注册规则，普通 Link 内不启用；图片 children 中恢复 raw text，不能生成嵌套 anchor 或改变图片替代文字。token 保留原始 `[[...]]` 与 target。
- [x] 给 MarkdownOptions 加 `wikiLinks?:'interactive'|'text'`，默认 text。renderer 默认转义完整原文；interactive 才生成转义标题、固定 class 和保留协议的链接。保持含作者 HTML 的 DOMPurify 分支，协议 allowlist 仅增加该内部协议。
- [x] 预览的 renderMarkdown 调用显式传 `wikiLinks:'interactive'`。delivery 调用不传，从而默认导出 plain raw wiki；普通 URL、图片、公式、图表与标题映射保持。
- [x] 在 editor markdown extensions 中加入 WikiSyntax。可见范围装饰合法 Wiki 节点，跳过受排除祖先与 front matter；活动范围露出 raw 标记，其余可隐藏双括号并沿用 md-link 外观。现有 Mod 点击处理额外认可 `wikiTarget(href)`，调用已有 onLink，不扩展外部 safeLink。
- [x] 运行 Bun、TS、editor/theme 和构建；语法/导出/富文本源码保护先规格审查，后独立质量审查。

## Task 3：桥接、类型与本地化

**Files:** `main.go`、`src/types.ts`、`locales/{zh-Hans,en}.json`；生成 `bindings.ts`、`locales.ts`、`locales/catalog_gen.go`。

- [x] 原生桥接与 browser handler 按现有 API 方式新增 `ResolveWikiLink(request)` 与 `Backlinks(id)`。浏览器传 req.Locale，原生传 i18n.Locale，不借查询修改语言。

```go
func (d *Desktop) ResolveWikiLink(request WikiResolveRequest) (SearchResponse, error) {
    return d.w.ResolveWikiLink(request, i18n.Locale())
}
func (d *Desktop) Backlinks(id string) (BacklinkResponse, error) {
    return d.w.Backlinks(id, i18n.Locale())
}
```

- [x] 添加等价 TS request/response，不复制 SearchItem：

```ts
export interface WikiResolveRequest {sourceID:string;revision:number;target:string}
export interface BacklinkResponse {
 documentID:string;revision:number;status:'ready'|'unnamed'|'ambiguous';
 items:SearchItem[];total:number;truncated:boolean;
}
```

- [x] 增加中英文的反向链接、无引用、先命名、同名无法归属、候选选择/取消、目标缺失、来源已更新/移除、非法名称、加载/失败/重试与保存后更新文案。数量通过既有参数格式，列表上限可复用搜索文案。
- [x] 运行 `go tool mygo generate`、MyGo i18n check、`check-i18n.mjs`、TS；验证 API JSON 数组和语言隔离。

## Task 4：按需反链队列、侧栏与安全导航

**Files:** 新建 `src/backlinks.ts`、`scripts/check-backlinks.ts`；修改 `src/app.ts`、`src/index.html`、`src/style.css`。沿用 DESIGN.md；编辑 UI 前读取 impeccable craft-floor。

- [x] 先用可控 Promise/时钟写失败用例：折叠时不请求、ID/revision 变化使旧成功/错误失效、一个在途/最新 pending、pending/组合输入暂停、位置更新不查询、关闭和语言变化、展开后重试。运行 `npx --yes bun@1.4.3 scripts/check-backlinks.ts`。
- [x] `backlinks.ts` 的 context 包含 ID/revision/pending，180 ms 队列单独维护。创建 DOM 控制器而不把语法/API/渲染全部搬进 app：

```ts
createBacklinks({
 details, list, status,
 request:(id)=>call<BacklinkResponse>('Backlinks',id),
 activate:(item,hit)=>void navigateSearch(item,hit,false),
})
// public context(id,revision,pending), refresh(), language(), dispose()
```

- [x] 用 `<details id="backlinks">`/`<summary>` 新增侧栏折叠区域，结果放其自己的容器，不操作 drawer-list。默认折叠，展开才取数据；适当 max-height+overflow，不挤出底部打开文件按钮。
- [x] pending 时保留已有结果、禁用导航并显示一致性说明。响应 ID/revision 与最新 context 相符才渲染；未命名/同名/空结果为独立状态。来源标题/片段及状态仅使用 text nodes；重复更新保留自身焦点，编辑器已获焦点时不抢回。
- [x] 将 changed/contentPending、save/accepted/failed、load、refreshRecent、随手记追加、改名/新建/移除、language、侧栏 show/close 接入 context/refresh；不因 position-only save 更新 revision 或重查。
- [x] `openLink` 优先调用 `wikiTarget` 识别保留协议，再保留原 localDocumentLink/safeLink 分支。保存前捕获来源 ID/view/generation 和导航 epoch，保存后取得 revision，再发送 WikiResolveRequest；每次等待后核对组合输入及身份。
- [x] 唯一结果在 busy 释放后调用 navigateSearch 的无 hit 路径，避免嵌套 run。零结果 toast；多结果在现有 modal 样式中显示可选标题、路径/草稿与更新时间，不自动取第一条。选择/取消保护焦点与旧意图，候选仍交给版本安全导航。
- [x] 反链标题/片段分别接入无 hit/有 hit 路径。维持三种视图、撤销与现有搜索/标签状态；Escape/键盘焦点可用。
- [x] Bun/TS/构建与前端专项验证；先规格审查，修复后复查，再做独立质量审查。

## Task 5：真实 API 验收、性能与交付记录

**Files:** 新建 `scripts/check-wiki-links.py`、`wiki_links_bench_test.go`；更新 `README.md`、`README.en.md`、设计/计划记录和 `web/`。

- [x] 用隔离真实 API 创建唯一/同名/未命名/缺失/中文 emoji 文稿与 105 个引用来源；验证目录范围、来源/目标 revision、全局同名、自引用排除、100/3 上限、UTF-16 文尾片段、候选选择/取消、三种视图与撤销。
- [x] 拦截 ResolveWikiLink 和 Backlinks，验证保存失败/等待时开始组合输入/切换文稿、旧响应/错误/语言、pending、折叠关闭、位置不刷新；在 callback 可见条件上有界等待并泵 Playwright 事件，不用固定 sleep 假定完成。
- [x] 检查共享语法样本的真实渲染，HTML 标题文字/XSS、普通链接/图片/公式不变、HTML/富文本/Word 不泄漏 liubai-wiki 协议，Markdown 原文保持；侧栏标签/关键词与反链列表并存。
- [x] 11 主题、中英文、680/800/1440 px、原生 details/dialog 键盘、控件焦点、无横向溢出；截图和中间文件仅写系统临时目录。
- [x] 新增 perf build-tag Go benchmark，复用 searchBenchmarkWorkspace，等长替换前缀加入 `[[目标]]`，不增长 8 MiB 文稿；三轮各 20 次，报告 mean 的中位数/B/op/allocs，不当 P95。18 MB 所有来源含引用的 Backlinks 预算 500 ms；若未达，先 profile 确认热点，再改原因。
- [x] 浏览器独占测量 1000 篇来源的 30 次首次展开/刷新至当前 ID/revision ready，记录全样本、P95 与最大值，P95 预算 800 ms；已有搜索预算保持。
- [x] 执行下面命令，浏览器明确 4206 端口串行，性能不与其他测试并行：

```sh
go test -run '^TestWiki|^TestBacklink|^TestSearch|^TestDocumentFilter' -count=1 .
go test -race -run '^TestWiki|^TestBacklink|^TestSearch|^TestDocumentFilter' -count=1 .
go test ./...
go vet ./...
GOOS=windows go vet ./...
go tool mygo i18n check
node scripts/check-i18n.mjs
node_modules/.bin/tsc --noEmit
node scripts/check-editor.mjs
node scripts/check-themes.mjs
npx --yes bun@1.4.3 scripts/check-wiki-links.ts
npx --yes bun@1.4.3 scripts/check-backlinks.ts
npx --yes bun@1.4.3 scripts/check-search.ts
npx --yes bun@1.4.3 scripts/check-tag-filter.ts
npx --yes bun@1.4.3 scripts/check-performance.ts
node scripts/build.mjs
go test -run 'TestStartupBundleStaysSmall|TestFrontendShipsAsResource' -count=1 .
scripts/e2e.sh check-wiki-links 4206
scripts/e2e.sh check-tag-filter 4206
scripts/e2e.sh check-search 4206
scripts/e2e.sh check-reader 4206
scripts/e2e.sh check-split-preview 4206
scripts/e2e.sh check-document-find 4206
scripts/e2e.sh check-capture-notes 4206
scripts/e2e.sh check-english 4206
scripts/e2e.sh check-toolbar 4206
scripts/e2e.sh check-outline 4206
scripts/e2e.sh check-windows 4206
scripts/e2e.sh check-themes 4206
go test -tags perf -run '^$' -bench '^BenchmarkWorkspaceBacklinks$' -benchmem -benchtime=20x -count=3 .
go test -tags perf -run '^$' -bench '^BenchmarkWorkspaceSearch$' -benchmem -benchtime=20x -count=3 .
LIUBAI_WIKI_PERF=1 scripts/e2e.sh check-wiki-links 4206
LIUBAI_SEARCH_PERF=1 scripts/e2e.sh check-search 4206
```

- [x] 主线程独立验证实际输出，最终另做汇总审查；按 WL-1 至 WL-9 更新复选框、实测与验证边界，README 描述已实现行为。维持当前版本/依赖与已有正式包，不提交/推送/发布。

## 文件所有权与连续执行

同一 `feat/full-text-search` checkout；保留此前全部未提交工作。后端 implementer 只修改 wiki_syntax.go/wiki_links.go/wiki_links_test.go/testdata/wiki-links.json，其他文件由主线程负责，接口确定后生成绑定。前后端任务各自先规格后独立质量审查，最终汇总审查。默认使用 subagent-driven-development，不暂停询问执行方式。

## 设计与计划自检

- 语法、目标、范围、坐标、导航、生命周期、UI、可移植性与性能分别由 Task 1–5 覆盖。
- API 和 TypeScript 名称一致，候选直接使用 SearchResponse/已有 SearchItem，无额外持久化字段。
- 标题精确匹配与同名提示、源 revision 校验、默认未命名、缺失目标和重命名行为均写明；不静默扩大范围或改写原文。
- 默认导出 text、预览显式 interactive；只读快照与实际导航分开，没有从浏览器证据外推原生打包。

## 实施中的验证记录

- 共享语法样本从 34 条扩展至 49 条，包含普通链接/图片的双括号标签、嵌套、脚注续段与局部引用定义、脚注原始顺序、无效链接后缀、危险普通链接、名称内的代码/公式标点和非法 Unicode。Go 与前端窄测试已通过。
- Goldmark inline 扩展记录原始候选坐标并把括号留给原生解析器，最后按 AST 上下文排除。这使 `[[标签]](url)` 仍由普通链接接管。Lezer 仅在存在 Wiki 形状的普通链接后缀时，借现有 markdown-it 校验完整原生链接；引用定义由块解析器按需取得，不扫描正文统计 Wiki。
- `scripts/check-backlinks.ts`、搜索与标签队列检查通过；Go 全量测试、相关 race、Go/Windows vet、本地化、TypeScript、编辑器/主题检查和资源包检查已通过。后续修改后按受影响范围复测。
- 首轮真实 API 双链验收通过：唯一/同名/缺失、UTF-16 原文片段、三视图/撤销、保存失败、组合输入、单在途/语言/折叠、键盘/焦点、消毒与导出、11 主题/窄窗、100 篇/3 片段上限。证据：`/var/folders/_g/sm5403cs13jgs_94nm1b7lxh0000gn/T/liubai-wiki-qa-22q6t1ry`。后续已加入完整组合输入周期和目标切换的回归，尚待最终记录。
- HTML/富文本/Word DOM 与 OOXML 检查通过：生成的引用和作者手写的内部链接都不形成导出内部 URL；Word 保留 `[[目标😀]]`，没有内部超链接关系。
- 标签筛选与全文搜索相关回归通过；阅读器回归遇到 5 秒自动保存等待超时，需单独复测。机器存在较高后台负载；长文编辑性能检查也需在回归结束后独占复测，未调整预算。
- Chrome DevTools 插件首次调用返回 `unknown tool, not registered in ToolBox`，使用已有 Chrome/Playwright 工作流继续验证。Impeccable 检测已执行：报告主要为现有控件的 10 px 字号与已登记样式；新增反链和选择器的字号为 11–13 px，使用既有角色色。窄窗截图已人工检查。
- 尚未作为最终性能证据的反链 benchmark 试跑满足 500 ms 预算，但与其他检查有重叠；最终性能验收会独占重跑，不引用该次数据。
- 46 样本阶段的双链 API 回归（含完整组合输入周期和旧反链目标切换）再次通过，证据：`/var/folders/_g/sm5403cs13jgs_94nm1b7lxh0000gn/T/liubai-wiki-qa-oxmd6kx9`。
- 阅读器单独复测通过；分栏、文内查找、随手记、英文、工具栏、大纲、Windows 模拟与主题回归均通过。最终 49 样本语法调整后仍需构建与专项复测。
- 新增跨段落链接定义删除/恢复的真实 Lezer 增量解析回归，先复现旧节点被复用导致的错判，再通过树属性记录对原生引用定义的依赖并按需重新解析。无此类引用的文稿仍走既有增量路径。该回归与 49 个共享样本已通过。
- 最终规格审查新增四个边界：保存等待期间完整无编辑组合输入、富文本表格点击、未引用脚注与 U+FEFF 空白。均已补失败回归并修复。共享样本扩展到 51 条；Go/race/vet、TS、Bun 语法与九个导航回归通过。未引用脚注的源码引用纳入查询，展示仍沿用原有 Markdown 规则。
- 表格通过窄 `tableLink` Facet 复用编辑器 `onLink`；根据原文语法树与指针文本坐标确认引用，保护普通链接/代码/公式、未提交文字、只读与组合输入，保持单元格原有编辑 DOM。浏览器专项新增表格中的多个引用与排除区域实际点击。

## 最终验收

主线程已检查实际代码、测试输出与截图。独立质量审查确认上述四项规格缺口均已关闭，未发现剩余 Critical/Important 缺陷。所有性能命令在功能回归结束后串行执行，保持原预算，退出码均为 0。

| 验收项 | 结果与证据 |
| --- | --- |
| WL-1 语法 | 51 条共享样本通过 Go、Lezer、markdown-it；包括增量引用定义变更、未引用脚注的源码语义与 Unicode 空白。 |
| WL-2 目标 | 精确标题、同名选择/取消、缺失与来源 ID/revision/实际引用验证通过。 |
| WL-3 范围 | 登记/重启/移除范围、自引用排除、全局同名、105 来源及 100 文稿/3 片段上限通过。 |
| WL-4 只读与坐标 | 状态/文件字节/通知/当前 ID 保持测试、快照并发与中文 emoji UTF-16 原文定位通过。 |
| WL-5 导航 | 三视图/撤销、保存失败、保存/解析/选择等待期间完整组合输入周期、表格真实指针点击通过。 |
| WL-6 生命周期 | 单在途/最新 pending、旧成功与错误、语言/目标/关闭失效、内容 pending 与位置不刷新通过。 |
| WL-7 界面 | 中英文、11 主题、680/800/1440 px、details/dialog 键盘与焦点、无横向溢出通过；截图已人工检查。 |
| WL-8 可移植性 | Markdown 原文、消毒、HTML/富文本 delivery DOM、Word DOM/OOXML 内部链接清理通过。 |
| WL-9 质量与性能 | Go 全量/race/vet/Windows vet、TS/i18n、编辑器/主题/资源、构建、相关回归与以下性能预算通过。 |

最终命令包括上方全部检查，并额外执行 `scripts/e2e.sh check-tables 4206` 与 `python3 scripts/check-preview.py`。51 样本与最后导航/表格修复后再次执行双链、全文搜索、表格、阅读、分栏、文内查找和共享渲染/Word 检查；标签筛选、随手记、英文、工具栏、大纲、Windows 模拟与主题回归也已通过。早期阅读器等待超时已由后续独立及最终回归排除；早期并行长文性能失败不用于最终性能结论。

真实 API 双链最终证据：[浏览器产物](file:///var/folders/_g/sm5403cs13jgs_94nm1b7lxh0000gn/T/liubai-wiki-qa-7bkc9jkf)，包含窄窗反链与桌面表格截图。测试流为正文/表格 Wiki 点击 → 目标/同名选择 → 展开反链 → 原文片段定位；保存与组合输入中途打断时保持来源。环境为隔离工作区、`http://127.0.0.1:4206`、Chrome/Playwright；页面内容、交互状态及 `pageerror` 检查通过。Chrome DevTools MCP 的 `unknown tool, not registered in ToolBox` 失败与允许使用现有 Playwright 的决定见前文。

### 独占性能

环境：macOS arm64，Apple M2 Pro。Go 每项三轮，每轮 20 次；下表是每轮平均值的中位数，B/op/allocs/op 也取三轮中位数，不能解释为 P95。18 MB 数据集实际为 18,219,008 字节，包含一篇 8 MiB 文稿，所有来源均有引用。

| 数据集与查询 | 三轮均值中位数 ms | B/op | allocs/op |
| --- | ---: | ---: | ---: |
| 18 MB 反链 | 90.928 | 128343776 | 322230 |
| 1000 × 4 KiB 反链 | 31.048 | 44147458 | 313736 |
| 18 MB 搜索未命中 | 5.998 | 89616 | 102 |
| 18 MB 搜索文尾 | 100.064 | 318985 | 1402 |
| 18 MB 搜索高频 | 0.560 | 423344 | 4252 |
| 1000 × 4 KiB 搜索未命中 | 1.491 | 269841 | 102 |
| 1000 × 4 KiB 搜索文尾 | 19.811 | 1423564 | 3503 |
| 1000 × 4 KiB 搜索高频 | 1.952 | 1679016 | 11246 |
| 8 MiB 搜索未命中 | 2.643 | 7952 | 102 |
| 8 MiB 搜索文尾 | 53.162 | 7460 | 96 |
| 8 MiB 搜索高频 | 0.004 | 3456 | 54 |
| 8 MiB 单行搜索未命中 | 2.962 | 7952 | 102 |
| 8 MiB 单行搜索文尾 | 53.215 | 7576 | 98 |
| 8 MiB 单行搜索高频 | 0.004 | 4048 | 59 |

18 MB 反链三轮均值为 99.425292/90.928092/86.183665 ms，低于 500 ms；已有搜索所有均值低于 250 ms。完整均值、B/op 与 allocs/op 原始结果见[性能日志与汇总](file:///var/folders/_g/sm5403cs13jgs_94nm1b7lxh0000gn/T/liubai-wiki-final-perf-vrw9xnm5)。

| UI 测量 | 样本 | P95 ms | 最大 ms | 预算 ms |
| --- | ---: | ---: | ---: | ---: |
| 1000 篇反链，4364 字节/篇 | 30 次展开至匹配当前 ID/revision 的 ready，含 180 ms 防抖 | 264.3 | 390.9 | 800 |
| 1000 篇搜索，4197 字节/篇 | 30 个不同查询，含 180 ms 防抖 | 205.3 | 212.9 | 600 |

反链 UI 全样本（ms，保留一位小数）：217.5, 219.6, 229.9, 219.6, 216.2, 221.4, 219.6, 220.2, 215.8, 232.2, 216.5, 390.9, 226.6, 244.0, 216.7, 225.9, 218.0, 223.4, 225.4, 229.3, 264.3, 227.4, 217.6, 217.8, 222.5, 235.9, 221.1, 218.7, 233.3, 237.9。原始精度见[反链性能 JSON](file:///var/folders/_g/sm5403cs13jgs_94nm1b7lxh0000gn/T/liubai-wiki-qa-2_utcrqu/performance.json)。

搜索 UI 全样本（ms，保留一位小数）：202.9, 203.9, 197.4, 203.5, 205.3, 203.6, 203.0, 203.0, 199.7, 202.0, 202.9, 202.0, 199.1, 199.2, 198.2, 212.9, 197.7, 199.2, 200.4, 196.9, 196.2, 196.4, 203.0, 203.0, 197.7, 205.1, 201.4, 197.4, 199.7, 197.2。原始精度见[搜索性能 JSON](file:///var/folders/_g/sm5403cs13jgs_94nm1b7lxh0000gn/T/liubai-search-qa-wi009iy0/performance.json)。

长文编辑沿用既有最佳批次算法和预算：10 万字每键/行内装饰 1.31/0.42 ms，30 万字 5.02/0.31 ms；30 万字富文稿光标/输入/段末输入 2.02/5.16/5.02 ms，全部达标。Word 10 万中文字符 DOM/OOXML 转换检查为 28 ms，8 次事件循环让出，最大间隔 8 ms。

本次验证限于 Go 后端、前端语法、Chrome DOM/OOXML 和合成组合输入。未把浏览器证据外推为原生 macOS IME、最终 PDF 分页、跨应用富文本粘贴或正式签名公证。Wiki 功能未增加依赖或版本变更；README 与 `web/` 已更新，保留当前未提交 checkout，未提交、推送或发布。
