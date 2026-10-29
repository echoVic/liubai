# 标签筛选 Implementation Plan

2026-10-29 发布准备补记：下文“不提交、不发布”描述开发阶段的授权范围。用户现已要求提交并准备 0.6.7，执行本地提交与正式打包；发布准备证据见 [0.6.7 验证记录](../validation/2026-10-29-release-0.6.7.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking. 用户已要求开始实施，连续执行，不增加批准流程；不提交、不发布、不创建 worktree。

**Goal:** 在已有侧栏中提供点击标签、单标签筛选和与全文搜索的交集查询。  
**Architecture:** Go 对登记工作副本取只读快照，复用标签解析和全文匹配；新增 FilterDocuments，保留 Search API。前端用同一请求队列更新标签目录、筛选结果和空筛选的最近元数据。  
**Tech Stack:** Go/MyGo、现有 yaml.v3、TypeScript/CodeMirror、现有主题和原生 select；无新依赖。

**设计**：[标签筛选契约](../specs/2026-10-28-tag-filter-design.md)。  
**状态**：已完成实施与 TF-1 至 TF-9 验收；2026-10-28 用户已授权。验证范围和实测见文末。

---

## Task 1：后端快照、标签目录与交集

**Files:** 新增 `filter.go`、`filter_test.go`、`filter_contract_test.go`；修改 `search.go` 的共用校验和空匹配器分支。保持 `capture_notes.go` 的现有标签语义。

- [x] 写 `TestDocumentFilterIntersection`、`TestDocumentFilterCatalog`、`TestDocumentFilterScopeAndLimits`、`TestDocumentFilterReadOnly`、`TestDocumentFilterSnapshot`、`TestDocumentFilterLocales`，运行确认筛选缺失导致失败。

关键交集测试使用已存在于 `search_test.go` 的真实工作副本辅助函数：

```go
w := searchMemoryWorkspace(
    Document{ID: "work", Title: "工作", Content: "---\ntags: [工作]\n---\n\n文尾独特词", Revision: 1},
    Document{ID: "life", Title: "生活", Content: "---\ntags: [生活]\n---\n\n文尾独特词", Revision: 1},
)
got, err := w.FilterDocuments(DocumentFilterRequest{Query: "独特词", Tag: "工作"}, "zh-Hans")
if err != nil || got.Total != 1 || got.Items[0].Document.ID != "work" {
    t.Fatalf("wrong intersection: %+v, %v", got, err)
}
```

目录测试包含 YAML 字符串/列表、同篇重复标签、`Work`/`work`、规范名带 `#`、无标签与非法元数据；结果总数超过 100、正文超过 4096 字节和重启恢复样本复用已有搜索测试方法。只读测试复用 `searchStateBytes` 和 `searchFiles` 对照当前 ID、通知、revision、文件字节；快照测试使用通道控制更新，不用 sleep。

- [x] 在 `filter.go` 定义设计中的五个 DTO 和 `Workspace.FilterDocuments`。
- [x] 将原 Search 查询校验提取为 `normalizeSearchQuery(query string) (string,error)`，保持 Search 空查询和错误语义；快照增加已有 `Excerpt` 字符串值，避免最近元数据重新扫描正文。
- [x] 从每个快照的 `summaryOf(&doc).Tags` 计算标签与全局计数；请求标签仅去周围空白并校验，不二次移除 `#`。
- [x] 有关键词时用 `newSearchMatcher`；只筛标签时使用零匹配器表示全部匹配，`searchDocuments` 只在匹配器存在时扫描标题和正文，沿用排序、100 篇和 3+1 命中探测。
- [x] 将结果包装为 `DocumentFilterItem`，标签和摘要复制为小字符串；只筛标签时构造摘要，关键词结果的摘要为空。空筛选只返回标签目录和原范围的最近元数据，其他请求 `recent=[]`。

核心分支保持清楚的契约：

```go
matcher := searchMatcher{}
if query != "" {
    matcher = newSearchMatcher(query)
}
// Select matching-tag snapshots first, then call searchDocuments(selected, matcher, locale).
// No filter: return empty result items plus catalog and recent metadata.
```

- [x] 运行 `go test -run '^TestDocumentFilter|^TestSearch' -count=1 .`，随后做 race 和后端规格审查，再做独立质量审查；发现问题回到实现，未通过不进入交付声明。

## Task 2：API、生成类型与本地化

**Files:** `main.go`、`src/types.ts`、`locales/{zh-Hans,en}.json`；生成 `bindings.ts`、`locales.ts`、`locales/catalog_gen.go`。

- [x] 添加原生桥接和浏览器 handler，使用请求语言，保留 Search：

```go
func (d *Desktop) FilterDocuments(request DocumentFilterRequest) (DocumentFilterResponse, error) {
    return d.w.FilterDocuments(request, i18n.Locale())
}
// /api case "FilterDocuments": arg(0, &request), then d.w.FilterDocuments(request, req.Locale).
```

- [x] 定义等价前端接口：

```ts
export interface DocumentFilterRequest {query:string;tag:string}
export interface TagSummary {name:string;count:number}
export interface DocumentFilterItem {document:SearchItem;tags:string[];excerpt:string}
export interface DocumentFilterResponse {
 items:DocumentFilterItem[];total:number;truncated:boolean;
 tags:TagSummary[];recent:Summary[];
}
```

- [x] 增加“标签筛选”“全部标签”、标签按钮筛选/清除说明、额外标签数量、仅标签零结果和无效标签文案；计数参数按既有消息格式声明。
- [x] 执行 `go tool mygo generate`、`go tool mygo i18n check`、`node scripts/check-i18n.mjs` 和 `node_modules/.bin/tsc --noEmit`。

## Task 3：统一队列与标签 DOM

**Files:** `src/search.ts`；新增 `src/tag-filter.ts`；修改 `scripts/check-search.ts`，新增 `scripts/check-tag-filter.ts`。

- [x] 先用可控 Promise/时钟证明：同关键词改变标签必须失效旧响应；空筛选立即恢复最近列表，随后只接受当前目录/最近元数据；旧错误、组合输入、关闭和语言变化受保护。
- [x] 查询任务和状态都包含 `query` 与 `tag`；保留 180 ms 防抖和一个在途。新增 `queue.filter(tag)`，清空关键词不改变它。
- [x] 请求返回 `DocumentFilterResponse`。空筛选成功为携带元数据的 recent 状态；空筛选失败保留已有最近列表并提供重试，不能把整个侧栏清空。待保存时不发目录请求，已接受后重查。
- [x] 创建原生选项和独立标签按钮，最多三个可见标签并优先包含已选标签。选择不存在的规范标签时插入 0 计数选项，保留选择；同目录不反复重建选项。

模块的窄接口：

```ts
renderTagOptions(select:HTMLSelectElement,tags:TagSummary[],selected:string):void
tagButtons(tags:string[],selected:string,choose:(tag:string)=>void,keyPrefix:string):DocumentFragment
```

- [x] `createSidebarSearch` 连接选择器和标签按钮；`active` 同时考虑关键词与标签。最近回调接收可选 `Summary[]` 和当前选择，展示新元数据时保留焦点身份。
- [x] 实现搜索框 Esc 顺序、标签结果 Enter/方向键和列表焦点；结果标签按钮仅改变筛选，选择器和搜索框保持可操作。旧结果打开按钮待保存时禁用；标签按钮可改变选择，但不绕过保存导航保护。
- [x] 运行 `npx --yes bun@1.4.3 scripts/check-search.ts` 和 `npx --yes bun@1.4.3 scripts/check-tag-filter.ts`；保持原预览旧渲染完成回归。

## Task 4：侧栏接线和安全打开

**Files:** `src/app.ts`、`src/index.html`、`src/style.css`；按需在 `src/icons.ts` 引入已有 Lucide Tag。

- [x] UI 修改前读取 impeccable `reference/craft-floor.md`；延续已读取的 DESIGN.md，不修复无关设计元数据。
- [x] 在搜索框下增加带可访问名称的原生标签选择器；使用角色色、系统字体、现有间距，原生选择可完整访问所有标签。
- [x] 改最近标签为文稿按钮外的独立按钮；使用 `tagButtons`，保留原最近移除确认和布局；有筛选时使用“文稿”标题。
- [x] 统一调用新接口：

```ts
request:(query,tag)=>call<DocumentFilterResponse>('FilterDocuments',{query,tag}),
recent:(recent,selected)=>{if(recent)state.recent=recent;renderRecent(selected)},
```

- [x] 最近列表全量元数据仅在当前空筛选响应中更新；活动筛选的外部 renderDrawer 不覆盖结果。维持 contentPending/Accepted/Failed、position-only、打开/删除/重命名/随手记/语言和侧栏可见性接线。
- [x] 标签结果复用 `navigateSearch`，携带 `SearchItem` 的 ID/revision；没有 hit 时聚焦当前内容而不设置范围，保留帧回调身份和组合输入保护。
- [x] 构建并运行浏览器失败用例，再核对绿色结果；对本次前端和接线先做规格审查，通过后做独立质量审查。

## Task 5：真实 API、回归与完成记录

**Files:** 新增 `scripts/check-tag-filter.py`、`filter_bench_test.go`；更新 `scripts/check-search.py` 的 UI 请求拦截；README 中英文、设计/计划记录和 `web/` 构建产物。

- [x] 新浏览器用例从真实 API 创建不同标签文稿；测试标签目录、文稿标签点击、交集、中文和 emoji 尾部定位、清空词/标签、100 篇上限、保存刷新、零计数选择、移除、非法元数据和 HTML 文字。
- [x] 拦截 `FilterDocuments` 的 `{query,tag}`，证明旧响应/目录/错误不覆盖新标签，一个在途；使用 bounded callback-visible 条件等待。原 Search API 断言继续使用 Search，UI 拦截改为新 method 和对象参数。
- [x] 验证选择器焦点、标签按钮焦点、用户转到编辑器后不抢焦点、三种视图、保存失败和撤销；截图仅存临时数据目录。
- [x] 完成下列检查，浏览器按明确端口串行；性能测量时不并行运行其他测试：

```sh
go test -race -run '^TestDocumentFilter|^TestSearch' -count=1 .
go test ./...
go vet ./...
GOOS=windows go vet ./...
go tool mygo i18n check
node scripts/check-i18n.mjs
node_modules/.bin/tsc --noEmit
node scripts/check-editor.mjs
node scripts/check-themes.mjs
npx --yes bun@1.4.3 scripts/check-search.ts
npx --yes bun@1.4.3 scripts/check-tag-filter.ts
npx --yes bun@1.4.3 scripts/check-performance.ts
node scripts/build.mjs
go test -run 'TestStartupBundleStaysSmall|TestFrontendShipsAsResource' -count=1 .
scripts/e2e.sh check-tag-filter 4206
scripts/e2e.sh check-search 4206
scripts/e2e.sh check-reader 4206
scripts/e2e.sh check-split-preview 4206
scripts/e2e.sh check-english 4206
scripts/e2e.sh check-toolbar 4206
scripts/e2e.sh check-outline 4206
scripts/e2e.sh check-windows 4206
scripts/e2e.sh check-themes 4206
scripts/e2e.sh check-document-find 4206
scripts/e2e.sh check-capture-notes 4206
go test -tags perf -run '^$' -bench '^BenchmarkWorkspaceSearch$' -benchmem -benchtime=20x -count=3 .
go test -tags perf -run '^$' -bench '^BenchmarkWorkspaceFilter$' -benchmem -benchtime=20x -count=3 .
LIUBAI_SEARCH_PERF=1 scripts/e2e.sh check-search 4206
```

- [x] UI 完成后一次性运行 `impeccable detect --json src/index.html src/style.css src/tag-filter.ts src/search.ts`，核对新增控件而不顺便改无关既有样式。
- [x] 依据 dev-verify 的新鲜证据对 TF-1 至 TF-9 逐项记录；更新 README、计划复选框和实测。保留现有正式包与其他未提交产物；不提交、推送或发布。

## 工作约束

当前分支为 `feat/full-text-search`，已包含设置、随手记、悬浮文内查找和全文搜索的未提交改动。保留它们，按文件所有权协作；后端 worker 可修改 `filter.go`、`filter_test.go`、`search.go`，主线程负责 API/类型/UI/脚本/文档。桥接生成在后端 DTO 完成后进行。各任务规格审查通过后才能做质量审查；最终另做汇总审查。

impeccable context 已运行，PRODUCT.md 和 DESIGN.md 已完整读取。它报告设计侧车与设计文档不同步，本次以 DESIGN.md 为准，不扩展任务去重建设计系统。

## 2026-10-28 实施验收记录

执行环境：Apple M2 Pro、macOS arm64、Go 1.27.3；浏览器使用已安装 Chrome、真实 Go API 和隔离的临时数据目录。源码与 `web/` 构建产物已更新，未新增依赖、持久化索引、存储 schema 或版本变更；保留此前未提交工作，没有提交、推送或发布。

### TF-1 至 TF-9

| 验收项 | 结果与证据 |
| --- | --- |
| TF-1 范围 | PASS；`TestDocumentFilterScopeAndLimits` 验证 105 篇草稿加 1 个已打开文件、重启恢复、移除及未登记文件；浏览器验证 105 篇交集和 110 篇全量最近文稿。 |
| TF-2 交集与限制 | PASS；`TestDocumentFilterIntersection`、`TestDocumentFilterUnicodeAndLimits` 和真实 API 验证中文、emoji、4096 字节之后的正文、100 篇展示、3+1 命中及完整总数；原搜索字面匹配回归保持。 |
| TF-3 标签读取 | PASS；`TestDocumentFilterCatalog` 和浏览器验证字符串/列表、去重、`Work`/`work`、规范名 `#work`、非法元数据和独立全局计数。 |
| TF-4 只读 | PASS；`TestDocumentFilterReadOnly` 比较工作区序列化状态和文件字节，并在外部改盘后确认筛选仍读已接受副本；`TestDocumentFilterSnapshot` 验证快照版本独立于后续更新。 |
| TF-5 生命周期 | PASS；两个 Bun 队列脚本和 Chrome 搜索/标签用例验证一个在途、最新待处理任务、旧成功/错误/目录失效、组合输入、关闭/语言变化、保存刷新与位置保存不重查。 |
| TF-6 导航 | PASS；Chrome 验证标签按钮仅筛选，标签结果在编辑/分栏/阅读视图中打开及聚焦；搜索回归覆盖 ID/revision、保存和组合输入保护、撤销、失效及移除结果。 |
| TF-7 状态 | PASS；清词保标签、清标签保词、Esc 顺序、零计数选择、空筛选恢复最近移除确认、目录失败保留最近列表与重试，以及保存失败不丢输入。 |
| TF-8 界面 | PASS；中英文、十一主题、680/800/1440 px 窗口、键盘及焦点保持、无嵌套交互控件或横向溢出；新标签字号至少 11 px。截图已人工核对。 |
| TF-9 回归与性能 | PASS；下列 Go/TS/构建和十一组浏览器检查通过；18 MB 交集查询中位数 96.857 ms，1000 篇界面 P95 275.6 ms，符合 250/600 ms 预算。 |

### 检查与审查

| 检查 | 最终结果 |
| --- | --- |
| 标签/搜索 Go 窄测试、focused race、`go test ./...` | PASS；包括缓存摘要的 91 个 emoji 样本。该样本先暴露越过 90 字符限制，修复后通过。 |
| macOS / Windows `go vet ./...` | PASS。 |
| MyGo 生成与 i18n、`check-i18n.mjs`、TS | PASS；545 条中英文消息、77 个文件的字面检查。 |
| `check-editor.mjs`、`check-themes.mjs`、两个 Bun 队列脚本、`check-performance.ts` | PASS；编辑器 30 万字每键相关更新合计约 5.23 ms。 |
| `build.mjs`、启动资源两项 Go 检查 | PASS；最终 11 px 样式已构建并用于浏览器回归。 |
| Chrome `check-tag-filter`、`check-search` | PASS；真实 API、异步拦截、导航和 105 篇上限场景。 |
| Chrome reader / split-preview / english / toolbar / outline / windows / themes / document-find / capture-notes | 全部 PASS；每组独立数据目录，在 4206 端口串行运行。 |
| 前后端规格审查、规格复查、独立质量审查与最终汇总审查 | PASS，无阻塞项；修复了加载时旧标签按钮的切换语义、重绘最近列表后丢失重试按钮，以及缓存摘要长度。 |

impeccable 检测器已运行一次，退出码 2；报告包含既有小字号和设计侧车不同步提示。本次新增标签字号已统一到 11 px，真实浏览器检查通过；不将此记录称为整个界面的检测器全绿。

### 后端性能

上文两个 Go benchmark 命令均退出 0，串行独占执行。每个场景三轮，每轮 20 次；下表各列分别取三轮中位数。耗时是单次调用均值的中位数，不是 P95；夹具创建和文件 I/O 不计时。

新增 `BenchmarkWorkspaceFilter` 使用同一搜索夹具，替换等长前缀加入 `tags: [工作, 共同]`，保持正文总字节数及 8 MiB 上限；摘要在计时前按工作区行为缓存。全部文稿携带所选标签，交集仍需覆盖整个数据集。

| 数据集 | FilterDocuments 场景 | ms/op 中位数 | B/op 中位数 | allocs/op 中位数 |
| --- | --- | ---: | ---: | ---: |
| 300 × 32 KiB + 8 MiB | 目录与最近元数据 | 1.934 | 3,343,009 | 25,611 |
| 300 × 32 KiB + 8 MiB | 纯标签 | 1.986 | 3,518,865 | 25,330 |
| 300 × 32 KiB + 8 MiB | 标签＋文尾关键词 | 96.857 | 3,434,659 | 26,106 |
| 1000 × 4 KiB | 目录与最近元数据 | 6.963 | 11,102,797 | 85,039 |
| 1000 × 4 KiB | 纯标签 | 6.880 | 12,005,726 | 83,368 |
| 1000 × 4 KiB | 标签＋文尾关键词 | 26.490 | 11,692,423 | 85,536 |

正文总字节数分别为 **18,219,008 / 4,096,000**。目录与纯标签场景没有全文匹配扫描，不能把 benchmark 打印的 MB/s 解释为全文扫描吞吐量。原 `Search` 四个数据集、未命中/文尾/高频三类场景均已重测；其文尾中位数依次为 **102.567 / 21.036 / 51.609 / 54.125 ms**，所有后端场景的耗时中位数均小于 250 ms。

原始输出及汇总：临时目录 `liubai-tag-performance-va9lz2yy` 中的 `BenchmarkWorkspaceSearch.txt`、`BenchmarkWorkspaceFilter.txt` 和 `summary.json`。

### 界面响应

`LIUBAI_SEARCH_PERF=1 scripts/e2e.sh check-search 4206` 退出 0。创建 1000 篇匹配文稿，每篇 **4,197 字节**，合计 **4,197,000 字节**；30 次不同关键词从最后输入到当前请求 DOM ready，包含 180 ms 防抖、`FilterDocuments` 请求及结果生成，最近秩 P95 为 **275.6 ms**，预算 600 ms。每次同时验证原 `Search` 的总数、100 篇 DOM 和截断说明。样本中有一次 **2710.9 ms** 的单次响应；P95 通过不表示所有单次响应都小于 600 ms，不推断该离群值的原因。

最终证据目录：标签截图与用例为 `liubai-tags-qa-uty7t3iv`；搜索与完整 `performance.json` 为 `liubai-search-qa-tj9tb9qx`，均在系统临时目录中。浏览器检查使用共享 DOM、真实 Go API 和合成组合输入事件；未外推为原生 macOS/Windows IME、正式打包、签名或公证验证。
