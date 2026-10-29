# 全文搜索 实施计划

**日期**：2026-10-28  
**状态**：已完成实施与 AC-1 至 AC-10 验收；用户已授权「直接推进 全文搜索，按实施计划开始开发」，沿用本计划参数。验证范围见文末。  
**设计**：[全文搜索 设计](../specs/2026-10-28-full-text-search-design.md)。  
**基线**：留白 0.6.6，`8bf8e58`；实施前以实际 HEAD 重新核对行号。  
**方法**：dev-plan 默认模式；Planner → Architect → Critic 的单代理对照自审，两轮修订。不代表外部评审或实际测试通过。

## 交付目标

把现有侧栏“标题 + 开头摘要”搜索增强为工作区已登记文稿的标题与完整 Markdown 搜索。查询只读，结果有上下文和位置，导航复用现有保存、文稿激活和视图流程。

本计划只安排这项功能及必要验证，不包含发版、技术栈升级或笔记库功能。设计文档的 AC-1 至 AC-10 是唯一验收契约；实施时不得把“未登记目录扫描”或“渲染纯文本匹配”解释成已经授权的范围。

## Planner：原则、驱动与候选方案

### 原则

1. 依托 `Workspace.docs` 和现有侧栏，查询不改变文稿生命周期。
2. 保持 Markdown 与草稿存储格式，不增加依赖、数据库或持久索引。
3. 工作区锁内只取快照；扫描、标题本地化和片段处理在锁外完成。
4. 服务端统一匹配语义，前端只展示、校验与导航；位置使用 UTF-16。
5. 最多一个查询在途，展示结果有上限；沿用现有性能预算。

### 决策驱动

- **不丢稿**：不能用一次查询触发外部重载或覆盖操作。
- **当前代码的维护成本**：全库 Content 已在 Go 端；向前端复制会增加另一份状态。
- **可测的延迟和内存**：优先解决当前文稿规模，避免为未知规模增加索引维护。

### 可行方案

| 方案 | 实现与改动面 | 收益 | 成本和限制 |
|---|---|---|---|
| A：Go 内存快照扫描，推荐 | `search.go`、`main.go`、`src/search.ts` 等；字面匹配用标准库 | 一份后端正文；无索引维护；查询与现有服务一致 | 每次扫描 O(总文本量)，大库时存在排队延迟 |
| B：Web Worker 搜索 | 后端增加批量正文接口，前端 worker 缓存并更新文稿 | 浏览器端可控制任务取消，主线程不扫描 | 初次传输全库文本，Go/worker/编辑器重复持有内容；删除、冲突、语言和同步需新协议 |
| C：Go 内存增量索引 | 新索引模块；接入恢复、Update、Capture、Rename、Delete、Reload | 大库重复查询可更快 | 任意中文子串仍需 n-gram 或二次扫描；更新协议、额外内存和失效规则明显变多 |

B、C 都是有效的不同实现途径，但当前没有它们收益超过成本的证据。本次选择 A；标准库内部使用转义后的字面正则不表示产品支持用户正则。若性能测量推翻 A 的可行性，应回到方案评估，不能悄悄替换架构。

## 工作区与全局约束

- 实施前运行 `git status --short`、`git branch --show-current`、`git rev-parse --short HEAD`。
- 用户明确禁止 `git worktree`。后续代码实现使用同一 checkout 的 `feat/full-text-search` 分支；文档交付本身不切分支。
- 当前有其他未跟踪产物，包括设计预览和此前调研报告；不得清理、覆盖或提交无关产物。若实施时出现相关代码的并发未提交修改，先核对差异，不覆盖。
- 仅按本计划修改相关文件；不重构 `workspace.go`、`src/app.ts` 的无关内容，不统一改写旧文档。
- 不修改 `workspace.json`、draft JSON 或 `Appearance` 的 schema；不修改 `go.mod`、`package.json`、`bun.lock` 的依赖和版本号。
- `bindings.ts`、`locales.ts`、`locales/catalog_gen.go` 只通过 `go tool mygo generate` 生成；`web/` 只通过 `node scripts/build.mjs` 重建。
- TS 与 CSS 跟随周围风格，Go 使用 gofmt；注释用英文，类型契约清晰，避免把结果作为 `any` 或新增运行时类型分派。
- 使用隔离的测试数据目录；不启动或改动已安装的留白，不使用真实文稿作为测试样本。
- 每个任务的测试与实现同交付；先写关键失败用例，再实现。未建立的脚本在本计划中标为新增，不能现在就宣称已运行。
- 本次实施交付源码、构建产物与验证记录；打包、原生真机验证、提交、推送和发布单独执行。

## 文件与接口清单

| 文件 | 修改目的 |
|---|---|
| **新增** `search.go` | 搜索 DTO、轻量快照、字面匹配、UTF-16/行号转换、排序和片段 |
| **新增** `search_test.go` | 匹配、范围、坐标、只读、并发与本地化的后端契约 |
| **新增** `search_bench_test.go`，`//go:build perf` | 预加载工作区的查询与内存基准；复用现有 perf 测试环境 |
| `summary.go`、`summary_test.go`、`i18n_backend.go` | 避免每次搜索只为判断自动标题而复制 8 MiB 单行正文；添加保持原语义的标题存在性助手与测试 |
| `main.go:71–98, 598–780` | Desktop 搜索入口与 `/api` 的 Search 分支 |
| `src/types.ts` | 与 Go 对应的 SearchResponse / SearchItem / SearchHit / SearchRange |
| **新增** `src/search.ts` | 查询生命周期、有限结果 DOM、状态、键盘与焦点 |
| `src/app.ts:102–137, 189–222, 533–580` | 侧栏、保存刷新、事件连接与受校验的结果导航 |
| `src/index.html`、`src/style.css` | 现有侧栏状态区域、结果布局与主题角色 |
| `src/preview.ts` | 新增显式 `jumpToLine(line)`，独立于普通软跟随去重 |
| `locales/zh-Hans.json`、`locales/en.json` | 搜索状态、错误、无结果、截断、来源和源码查看文案 |
| **新增** `scripts/check-search.ts` | 查询调度、失效保护、定位校验等可独立测试的逻辑 |
| **新增** `scripts/check-search.py` | Chrome 中完整交互与含正文的真实 Search API 回归 |
| `scripts/check-english.py`、`scripts/check-split-preview.py` | 对新结果节点与显式预览定位的相关回归调整 |
| `scripts/check-capture-notes.py` | 随手记标签检查改为查询 front matter 中实际存在的字面文字，并检查新搜索节点 |
| `scripts/check-outline.py`、`scripts/check-windows.py` | 大纲回归等待当前 `UpdateAppearance` 请求；平台随手记检查沿用已有的「保存」提示，保留快捷键与保存断言 |
| `README.md`、`README.en.md` | 在功能实际实现和验证后补充范围说明 |
| 生成文件与 `web/` | 与源码同步；不手工修改 |

`workspace.go`、`src/editor.ts` 作为现有行为依据，本次搜索不修改其行为；checkout 中已有的随手记和文内查找改动保留。搜索本地化复用 `documentIn`。实现中发现原 `generatedTitle` 只需要判断标题是否存在，却调用完整标题转换，单行 8 MiB 夹具每次分配约 67 MB；因此新增 `hasInferredContentTitle`：首字符是字母时直接确认，其余 Markdown 起始仍走原解析器。保留原 `inferredContentTitle`，增加语义对照及分配回归测试，不修改标题规则。

接口遵循设计文档中的精确字段。首版只接收查询文本，不开放调用方限额、任意文件路径、排序参数、模糊匹配或匹配选项。

## 实施步骤

### Task 1：后端契约和只读搜索

**目标文件**：新增 `search_test.go`、`search.go`；现有行为依据 `workspace.go:242–332, 529–661`、`summary.go`、`i18n_backend.go`。

- [x] 写表驱动匹配测试：正文文尾、单汉字、混排、字面 `.*[x]`、空白、大小写、超长、内部换行、无效 UTF-8、front matter / 代码 / URL。
- [x] 用超过 30 篇的登记文稿、重启恢复、未登记文件、删除/废纸篓和隔离目录的场景验证范围；不用随机更新时间决定排序。
- [x] 精确验证 100 篇上限、同标题的 ID 稳定排序、3 + 1 命中探测、标题命中优先及仅标题命中。
- [x] 验证 `中😀AKſ尾` 等坐标：`K` 与 `k`、`ſ` 与 `s` 遵从 Go simple folding；`ß` 与 `ss` 不匹配。CRLF/BOM 样本通过现有 `Open` 解码后检查 LF 内容坐标。
- [x] 记录查询前后内容、current、revision、Updated、通知、草稿及原文件字节；外部文件改变后直接 Search 不应重载它。
- [x] 实现 `Workspace.Search(query, locale)`：锁内复制必要值，解锁后本地化标题和扫描。不得调用 `State`、`check` 或任何写入方法。
- [x] 标题匹配第一次，正文最多取四次非重叠命中；排序截取后构造最多 100 篇的片段，返回空数组而非 nil。实测后以首字符候选扫描 + 锚定字面正则替代全正文 `FindAllStringIndex` 扫描，并与原匹配器逐范围对照。
- [x] 在每篇最多三个展示位置之间顺序累计 UTF-16 与行号；片段截取沿 UTF-8 码点边界，复制小字符串，避免返回完整 Content。
- [x] 用受控快照测试和并发更新测试证明不持有 `*Document` / 共享可变 map；做 race 检查，不依赖 sleep 制造时序。

**预期测试名**：

`TestSearchScope`、`TestSearchLiteralAndUnicode`、`TestSearchUTF16Ranges`、`TestSearchLimitsAndOrder`、`TestSearchHasNoSideEffects`、`TestSearchLocalizedTitles`、`TestSearchSnapshotConcurrentUpdates`、`TestSearchMatcherMatchesRegexp`、`TestSearchSingleLineTitleAllocations`。

**完成条件**：AC-1 至 AC-5 对应后端断言通过；Race 无数据竞争；搜索入口没有文件 I/O。

### Task 2：Desktop / 浏览器 API 与生成类型

**目标文件**：`main.go`、`src/types.ts`、`search_test.go`、两份 locales，以及生成文件。

- [x] 加 `Desktop.Search(query string)`，以原生 `i18n.Locale()` 调用工作区搜索。
- [x] 在 `serveWeb` 的既有 `/api` switch 增加 Search 分支，取 `arg(0, &query)`，传 `req.Locale`。禁止通过 `SetLocale` 改全局语言。
- [x] 为中英文自动标题、恢复后缀、普通标题与自定义标题建立对照；TitleMatch 范围必须属于返回的同语言 Title。
- [x] 添加查询错误文案：无效查询、超过 128 字符、内部换行；优先用无参数文案以直接复用现有本地化错误机制。
- [x] 在 `src/types.ts` 添加等价 DTO，通过 `call<SearchResponse>` 使用现有桥接；不增添第二套 HTTP 客户端。
- [x] 用单元 API handler 或集成方式验证请求语言不会串到另一请求，返回数组、错误结构和 byte→UTF-16 契约一致。
- [x] 运行 `go tool mygo generate`，核对生成的 Search 绑定和 DTO；运行国际化检查及 TS 检查。

**完成条件**：原生与浏览器入口共用匹配器；浏览器 zh-Hans/en 请求互不污染；新字段不进入文稿存储 schema。

### Task 3：侧栏查询、结果和输入保护

**目标文件**：新增 `src/search.ts`、`scripts/check-search.ts`；`src/app.ts`、`src/index.html`、`src/style.css`、locales。

- [x] 先定义模块的窄接口：接收现有输入和结果宿主、查询函数、激活回调；暴露输入失效/内容已接受/重开等必要操作。不引入通用 controller 框架。
- [x] 独立测试 180 ms 防抖、同一页面一个在途请求、最新查询排队；通过可控制的 Promise 和时间调度测试，不写固定等待。
- [x] 每次输入/语言/内容变化立即增加查询代次。旧成功和旧错误均丢弃；清空和关闭后旧请求不重新显示结果。
- [x] 接入 `#recent-search`：空查询委托原有最近列表，非空查询展示新分组结果；不把 `state.recent` 的摘要当全文数据源。
- [x] 用文本节点生成标题、路径、片段和 `<mark>`；构造至多 100 篇、每篇 3 个正文按钮。无删稿按钮的搜索分支与空查询最近列表分支分开。
- [x] 完成 loading / ready / empty / error / retry、total 与截断提示、草稿/文件来源、中英文文案。
- [x] 完成 Tab、↑↓、Enter、Esc、焦点保留、`aria-busy` 和独立状态播报；搜索框 `compositionstart/end` 期间暂停查询与打开动作。
- [x] 连接正常内容保存成功后的重查；位置保存不重查。待保存与保存失败显示设计中的一致性状态，查询不强制调用 save。
- [x] 连接新建、移除、重命名、随手记、已加载外部更新及语言切换。`refreshRecent` / `renderDrawer` 不得绕过新查询状态覆盖结果。
- [x] 查询请求不调用 `setBusy`；关闭侧栏暂停结果更新，重开有非空查询时重查。

**完成条件**：AC-3、AC-6、AC-9 的查询与 DOM 断言通过；手动或浏览器检查结果更新不抢搜索框焦点；无正文大副本发往浏览器。

### Task 4：可靠导航与预览显式定位

**目标文件**：`src/app.ts:107–137` 与点击回调、`src/preview.ts`、`scripts/check-search.ts`、新增浏览器检查及相关分栏检查。

- [x] 编写范围校验测试：ID、revision、整型且合法的 UTF-16 范围、原文 text 任一不符时不得定位；不可只把旧范围 clamp 后使用。
- [x] 点击通过既有 `run` / `saveForAction`；正文组合输入或保存失败时不切换，Search 本身仍不参与保存。
- [x] 调 `Activate` 后用返回内容重新校验。失效结果按正常路径打开，显示提示并重查；不存在的 ID 保持当前文稿。
- [x] 同篇未变化时保留当前 view；需要 `load` 时增加一个有身份和代次校验的目标覆盖点，在默认 rAF 滚动恢复之后完成搜索定位。
- [x] CodeMirror 选择 / 滚动事务使用 `Transaction.addToHistory.of(false)`，不改 Content、不增加正文 revision；验证下一次 undo 撤销的是原输入。
- [x] 新增 `PreviewController.jumpToLine(line)`：复用映射元素选择，支持 dirty / 延迟渲染；即时滚动、展开目标 details，绕过同块去重。
- [x] 显式预览目标记录文稿身份/渲染代次，切文稿或手动滚动时清除；处理渲染恢复滚动之后的定位，不让旧渲染完成回调抢滚动。
- [x] 验证同块重复点击、分栏左右、阅读、front matter、折叠块与表格/公式源码命中的界限。
- [x] 为结果增加“在源码中查看”显式操作，复用现有 `setView('split')` 和源码偏好修改；点击前重新校验，普通结果点击不改变偏好。

**完成条件**：AC-7、AC-8 通过；正常保存/冲突/只读流程及手动预览滚动仍保持原有行为。

### Task 5：端到端、性能与完成核对

**目标文件**：新增 `scripts/check-search.py`、`search_bench_test.go`；相关旧浏览器检查、README、构建产物。

- [x] 浏览器通过真实 `/api` 准备登记文稿；首次关键用例必须搜索正文尾部，避免只有前端假数据成功。
- [x] 加受控请求拦截验证旧响应、延迟错误、删除、自动保存、语言切换和清空；在 callback 可见条件上等待并泵 Playwright 事件，不用固定 sleep 推断完成。
- [x] 对快照后外部改写、保存失败和旧 revision 做受控测试；观察导航后的实际选择 / 滚动 / 当前标题及下一次 undo。
- [x] DOM 和导航检查使用隔离数据目录与已安装 Chrome；截图、日志、临时夹具均留在临时目录。
- [x] 基准预加载 300 × 约 32 KiB + 8 MiB、1000 × 约 4 KiB、单篇 8 MiB；覆盖未命中、文尾命中和高频命中，计时排除夹具创建和文件读取。
- [x] 保留原有 perf fixture 和 TestMain；新基准单独在 `search_bench_test.go` 定义，不重复声明 TestMain。
- [x] 在 M2 Pro 运行三轮 Go benchmark，报告每场景均值的中位数、`B/op`、`allocs/op` 与文本总字节数；目标见设计文档，不将均值称作 P95。
- [x] 浏览器按 30 次不同查询测量最后输入到渲染 ready 的 P95，检查每次响应确属该查询代次；目标 ≤ 600 ms。
- [x] 运行下节静态、后端、编辑器、侧栏、阅读、分栏、国际化与主题检查；保持既有性能预算。
- [x] 验证后更新 README 的搜索能力与“仅搜索已登记工作副本”边界，生成并核对 `web/`；不在本任务中改版本或发 Release。

**完成条件**：AC-1 至 AC-10 有具体证据；失败项有原因和复现信息，不用“其他检查通过”替代未验证项。

## 验证命令与 AC 映射

以下命令对应已建立的源码与检查；本机执行结果记录在文末。

### 后端和类型

```sh
go test -run '^TestSearch' -count=1 .
go test -race -run '^TestSearch' -count=1 .
go test ./...
go vet ./...
GOOS=windows go vet ./...
go tool mygo i18n check
node scripts/check-i18n.mjs
node_modules/.bin/tsc --noEmit
node scripts/check-editor.mjs
```

### 前端与相关回归

```sh
bun scripts/check-search.ts
bun scripts/check-performance.ts
node scripts/build.mjs
go test -run 'TestStartupBundleStaysSmall|TestFrontendShipsAsResource' .
scripts/e2e.sh check-search
scripts/e2e.sh check-reader
scripts/e2e.sh check-split-preview
scripts/e2e.sh check-english
scripts/e2e.sh check-outline
scripts/e2e.sh check-toolbar
scripts/e2e.sh check-windows
node scripts/check-themes.mjs
scripts/e2e.sh check-themes
scripts/e2e.sh check-document-find
scripts/e2e.sh check-capture-notes
```

按顺序串行运行浏览器检查以免端口冲突；如并行则显式使用不同端口。若本机 Bun 不兼容，用仓库已记录的 `npx --yes bun@1.4.3` 替代，不改 lockfile。

### 搜索基准

```sh
go test -tags perf -run '^$' -bench '^BenchmarkWorkspaceSearch$' -benchmem -benchtime=20x -count=3 .
```

| 验收项 | 必要证据 |
|---|---|
| AC-1、AC-2 | `TestSearchScope` / `TestSearchLiteralAndUnicode`，浏览器真实 API 文尾命中 |
| AC-3 | `TestSearchLimitsAndOrder`，浏览器同名、截断、HTML 文本转义 |
| AC-4 | `TestSearchUTF16Ranges` + 浏览器 emoji 与折叠字符定位 |
| AC-5 | `TestSearchHasNoSideEffects` 的字节/状态对照，受控外部写入后不读盘 |
| AC-6 | 查询调度单元检查 + 浏览器过期响应/错误、输入法合成事件与保存刷新 |
| AC-7、AC-8 | 保存失败、删除、旧 revision、undo、rAF 顺序、三视图和手动滚动回归 |
| AC-9 | 中英文、主题、键盘、焦点、窄窗口；保留原来的文内查找和移除确认检查 |
| AC-10 | 搜索 benchmark、30 次 UI P95、既有性能与资源预算、相关回归结果 |

浏览器模拟 Windows 或 IME 只能证明共享 DOM 和合成事件逻辑。正式交付前如运行桌面真机验证，应使用独立数据目录，检查 macOS 中文输入及 Windows 中文输入/阅读导航；当前计划没有已验证的真机证据。

## 风险与处理

| 风险 | 具体处理 |
|---|---|
| 扫描锁住自动保存 | 锁内仅快照，匹配与标题推断在锁外；受控并发与 race 测试 |
| 大小写折叠改变字节长度 | 使用正则返回的原文字节范围，再从原文转换 UTF-16；不用 lowercase 偏移 |
| 自动保存时旧查询又变可点击 | 输入内容变化立即增加查询代次，保存接受后重查；位置保存不重查 |
| 语言转换使标题范围无效 | 同一快照先本地化显示标题再匹配；语言切换使所有旧结果失效 |
| 点击旧位置误跳 | Activate 后校验 revision + 原文范围；不强行 clamp 或猜测最近位置 |
| rAF / 预览渲染抢滚动 | 统一默认位置恢复与显式目标顺序；目标携带 view/文稿身份/代次 |
| 替换组件无法逐字高亮 | 片段精确高亮、所属块定位；用户显式源码查看，不改块组件编辑协议 |
| 无持久索引时大库变慢 | 记录规模和查询耗时，一在途 + 最新任务排队；测量不达标先评估匹配/片段/DOM |
| 小片段长期引用旧大文稿 | 返回片段复制为小字符串，前端不持有后端快照或完整全库内容 |
| 搜索时认为磁盘一定最新 | 明确工作副本范围；Activate 使用既有外部修改/冲突流程 |

## Architect：对推荐方案的挑战

**最强反对意见**：A 每次扫描全库，加上“不为搜索读盘”的规则，新查询可能排队，且用户会搜到非当前文件的旧副本；若库达到数百 MiB，单请求取消缺失会明显影响体验。B 的 worker 缓存或 C 的增量索引在这种规模下可能更合适。

**实际张力**：

- 完整查询范围与延迟：100 篇展示上限只控制 DOM，不能控制全库扫描耗时。
- 搜索只读与实时磁盘状态：把 `State/check` 偷渡进查询能变得更新，却会改动通知、冲突和草稿，破坏查询契约。
- 源码精确位置与所见即所得：表格/HTML 的渲染结构不能直接复用原文字节坐标。

**合入方案的改进**：将快照范围、数据规模预算和大库排队限制写进设计；采用服务端单一匹配语义、原文 UTF-16 转换和显式源码查看；正常保存后刷新、点击时再检查磁盘。没有当前规模基准证据前，不采用索引。

## Critic：最终判定

| 维度 | 状态 | 判断依据 |
|---|---|---|
| 原则与选项一致 | 通过 | 只读快照、不迁移存储、不新增依赖 |
| 替代方案真实 | 通过 | Worker 与增量索引的收益和协议成本不同于扫描 |
| 风险处理明确 | 通过 | 每个风险对应身份校验、失效规则、测试或测量 |
| AC 可验证 | 通过 | 十条 AC 均有测试场景和证据入口 |
| 验证具体 | 通过 | 命令、数据集、精确范围、P95/均值口径明确 |
| 文件覆盖 | 通过 | 每个实施任务指定源码、测试和必要生成文件 |

**判定：APPROVED，指原方案内部对照自审通过；用户随后已明确授权按计划实施。实际实现审查和验收另见文末。**

**保留意见**：

1. 性能目标尚未实测；若标准库大小写匹配在长文未命中场景超过预算，Task 5 必须定位成本并重新比较方案，不把展示上限当解决方案。
2. `src/preview.ts` 对未映射 HTML 和重排的脚注不保证逐字渲染定位；AC-8 应按设计的“对应/最近块 + 显式源码查看”验收，不能宣称阅读 DOM 中精确高亮。

## ADR：本次架构决定

- **Decision**：由 Go 对工作区已接受内容取只读快照、锁外执行字面子串搜索，返回有限片段和原文 UTF-16 坐标；前端单请求调度，导航时校验版本。
- **Drivers**：不丢稿、现有后端唯一正文来源、维护和内存成本，以及明确的数据规模预算。
- **Alternatives considered**：选择 A；B 因全库传输与双份状态协议成本未选；C 因增量索引和任意子串维护成本未选。
- **Why chosen**：当前已有全部登记文稿的正文，直接查询不需要新存储或新同步协议。查询与导航分开，使磁盘/冲突副作用只出现在用户选择文稿的已有流程。
- **Consequences**：没有 schema 迁移，功能可通过移除入口和模块回退；代价是每次全库扫描、搜索结果不保证非当前文件实时磁盘状态、首版不支持后端取消。
- **Follow-ups**：仅当本次性能数据证明 A 不可行时重新评估扫描或索引实现；不因此增加标签、目录扫描或云服务范围。

## 自审修订记录

- Planner v1：Go 内存扫描，侧栏结果复用最近列表，按命中范围打开。
- Architect v1：指出锁内本地化可能扫描正文、字节坐标错误、显示上限不能限制扫描、load 的 rAF 与预览软跟随会覆盖定位。
- Critic v1：REVISE；要求说明尚未保存输入、搜索快照的磁盘边界、Unicode 坐标、失效行为和展示组件的真实定位能力。
- Planner v2：加入锁外本地化、原文 UTF-16 转换、立即失效与保存后刷新、导航版本校验、显式预览定位和源码查看；独立明确 100 篇上限与总数。
- Architect v2：确认方案保留了无索引下的大库排队成本，并要求实测作为实施验收。
- Critic v2：APPROVED，保留性能实测与不可见源码的两项明确边界。

## 建议的实现提交划分

进入实施后按可验证的逻辑拆分，提交和发布另按用户当时授权执行：

1. `feat: search registered documents without changing workspace state`：Task 1–2，后端契约与接口。
2. `feat: show full-text search results in the sidebar`：Task 3，查询调度、分组结果和文案。
3. `feat: navigate safely to search matches in all views`：Task 4–5，可靠导航、回归、基准及实际功能说明。

每个提交带对应测试和当次生成产物。当前实施的验证证据如下；提交和发版另行执行。

## 2026-10-28 实施验收记录

执行环境：Apple M2 Pro，macOS arm64；Go 1.27.3、Node 22.23.1、Bun 1.4.3。开发与验证使用 `feat/full-text-search`、同一 checkout，以及隔离的临时数据目录。保留实施前的设置窗口、随手记、悬浮文内查找和依赖变更；本次搜索未新增依赖、存储 schema 或版本变更。

### 搜索基准

命令：`go test -tags perf -run '^$' -bench '^BenchmarkWorkspaceSearch$' -benchmem -benchtime=20x -count=3 .`，退出码 0。每轮每场景运行 20 次，表中各列分别取三轮的中位数。耗时是单次查询均值的中位数，**不是 P95**；夹具建立、文件读取不计时。

| 预加载工作区 | 查询 | 毫秒/次 | B/op | allocs/op |
|---|---|---:|---:|---:|
| 300 × 32 KiB + 8 MiB | 未命中 | 5.901 | 89,616 | 102 |
| 300 × 32 KiB + 8 MiB | 文尾 | 96.027 | 318,993 | 1,402 |
| 300 × 32 KiB + 8 MiB | 高频 | 1.584 | 423,344 | 4,252 |
| 1000 × 4 KiB | 未命中 | 1.499 | 269,841 | 102 |
| 1000 × 4 KiB | 文尾 | 19.725 | 1,423,575 | 3,503 |
| 1000 × 4 KiB | 高频 | 1.761 | 1,679,011 | 11,246 |
| 单篇 8 MiB | 未命中 | 2.636 | 7,952 | 102 |
| 单篇 8 MiB | 文尾 | 49.292 | 7,454 | 96 |
| 单篇 8 MiB | 高频 | 0.005 | 3,456 | 54 |
| 单篇 8 MiB 单行 | 未命中 | 2.586 | 7,952 | 102 |
| 单篇 8 MiB 单行 | 文尾 | 50.616 | 7,596 | 98 |
| 单篇 8 MiB 单行 | 高频 | 0.004 | 4,048 | 59 |

实际正文总字节数依次为 **18,219,008 / 4,096,000 / 8,388,608 / 8,388,608**；每篇夹具均验证 UTF-8 合法且不超过 8 MiB。高频场景在取得每篇第四个命中后停止，不把正文总字节数换算成完整扫描吞吐量。

第一次三轮实测中，大工作区文尾查询为 298.271 / 349.340 / 282.659 ms，中位数 298.271 ms，未达 250 ms 预算。CPU profile 显示 `regexp.(*machine).match` 累计占 86.78%；在原有大小写与字面规则下改用首字符候选过滤和锚定正则，最终三轮为 124.369 / 87.961 / 96.027 ms，中位数 96.027 ms。`TestSearchMatcherMatchesRegexp` 对照原正则验证首字符折叠、原文范围和非重叠上限；独立规格复审通过。

### 界面响应与验证结果

最终命令 `LIUBAI_SEARCH_PERF=1 scripts/e2e.sh check-search 4206` 退出码 0。Chrome 中创建 1000 篇含完整正文的文稿，每篇 **4,197 字节**，总计 **4,197,000 字节**；连续 30 次不同查询，从最后输入至当前查询的 DOM ready（包括 180 ms 防抖、HTTP 和结果生成），最近秩 P95 为 **275.7 ms**，预算 600 ms。每次均验证真实 API `total=1000`、100 篇展示上限和截断文案。

30 次样本（ms，保留一位小数）：203.1、199.0、198.5、217.9、284.0、256.8、200.6、205.2、197.8、202.5、197.1、274.7、200.9、198.1、198.1、198.5、199.3、198.6、203.8、197.9、199.1、198.8、196.8、198.8、201.4、199.1、199.4、197.7、197.3、275.7。截图和原始 `performance.json` 在临时证据目录 `/var/folders/_g/sm5403cs13jgs_94nm1b7lxh0000gn/T/liubai-search-qa-4nxb05bi/`。

| 验证 | 最终结果 |
|---|---|
| `go test -run '^TestSearch' -count=1 .`；`go test -race -run '^TestSearch' -count=1 .` | PASS；含只读/范围/排序/Unicode/快照/匹配器对照及分配检查 |
| `go test ./...`；macOS / Windows `go vet ./...` | PASS |
| MyGo i18n、`check-i18n.mjs`、TS、`check-editor.mjs`、`check-themes.mjs` | PASS；536 条中英文消息，75 个文件字面检查，十一主题 |
| Bun `check-search.ts` | PASS；可控查询调度、坐标校验、旧渲染完成竞态 |
| Bun `check-performance.ts` | PASS；10 / 30 万字每键更新与行内装饰合计 1.84 / 5.53 ms；富文稿光标 2.54 ms，输入 5.40 ms，段尾输入 5.03 ms |
| `node scripts/build.mjs`；启动资源两项 Go 检查 | PASS；生成产物与源码同步 |
| Chrome `check-search` | PASS；正文文尾、折叠字符、撤销、过期/失效结果、保存/组合输入、键盘/焦点、中英文、窄窗口、十一主题，以及属性/表格/公式导航 |
| Chrome `check-reader` / `check-split-preview` / `check-english` / `check-outline` / `check-toolbar` / `check-windows` / `check-themes` | 全部 PASS |
| Chrome `check-document-find` / `check-capture-notes` | 全部 PASS；文内替换撤销、阅读高亮、随手记追加/模板/标签保持 |
| 规格与独立质量审查 | 已完成；发现的导航/预览/模式问题经失败复现、修复与复审关闭 |

AC-1 / AC-2 / AC-3 / AC-4 / AC-5 由对应 `TestSearch*` 和真实 API 回归覆盖；AC-6 / AC-7 / AC-8 / AC-9 由可控异步测试、最终 Chrome 搜索及相关回归覆盖；AC-10 由上述两类性能测量、静态/后端/资源与浏览器检查覆盖。

### 实施中修复的回归

- 8 MiB 单行文稿的自动标题存在性判断原先每次搜索分配约 67 MB；新增保持语义的判断助手，分配回归测试限定每查询不超过 1 MiB。
- 结果刷新先禁用旧按钮，可能导致焦点掉到页面；保留原按钮身份，同时尊重用户已经转移的焦点。
- 在保存、文稿激活或源码偏好请求等待期间开始组合输入，不能继续旧导航；浏览器分别拦截这三类请求验证实时保护。
- 源码模式在等待偏好保存前同步生效，避免第二次偏好请求期间开始组合输入后，设置已经改为源码而编辑器仍停留在即时排版模式。
- 旧预览渲染完成可能清掉新渲染的待定位目标；受控双渲染用例先失败（88，期望 988），补充渲染代次校验后通过。
- 普通文件导入紧接着 `load` 写入正文，不能因搜索的内容代次保护而跳过默认聚焦；代次保护限定于携带搜索命中的回调，普通导入仍用原有聚焦路径。
- 大纲回归仍在等待旧 `Appearance` 请求，导致已生效的侧栏操作超时；只更新请求匹配到已有的 `UpdateAppearance` 接口，保留界面和持久化断言。
- 平台随手记回归使用旧的「存为草稿」提示，而已有随手记功能改为「保存」；同步两平台的提示断言，继续检查错误平台快捷键不保存、正确快捷键保存并清空输入。

### 验证边界

浏览器使用真实 Go Search API、已安装 Chrome 和临时文稿；组合输入采用合成事件，Windows 检查采用浏览器平台模拟。没有将这些证据外推为原生 macOS/Windows IME、PDF 最终分页、跨应用富文本粘贴或正式签名/公证验证。
