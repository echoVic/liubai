# 双链与反向链接设计

**日期**：2026-10-28  
**状态**：已实现并通过 WL-1 至 WL-9 验收。按用户要求继续推进下一功能，完成 `[[文稿名]]` 与当前文稿的反向链接；实测与验证边界记录在实施计划中。  
**基础**：已实现全文搜索、标签筛选、Markdown 阅读/编辑和版本安全的搜索导航。  
**实施计划**：[双链实施计划](../plans/2026-10-28-wiki-links.md)。

## 功能契约

在 Markdown 正文使用 `[[文稿名]]` 引用另一篇已登记文稿。富文本编辑中按现有链接规则使用 ⌘/Ctrl 点击，阅读及分栏预览中直接点击。源码保持原文；不要求改变源码视图的链接交互。

引用按标题解析，不写入私有文稿 ID。目标唯一时直接打开，同名时显示选择列表，缺失时提示，不自动创建文稿或扫描磁盘。反向链接位于原侧栏里的默认折叠区域，展开后显示哪些文稿引用了当前文稿，以及可点击的引用片段。

本次仅支持 `[[文稿名]]`。悬停预览、自动补全、别名 `[[目标|显示文字]]`、标题锚点、图谱、未登记目录扫描、批量改写和自动创建目标均不包含在首版。`#` 和路径字符若出现在名称中，仅按完整标题处理，不解释为锚点或文件路径。

## 引用与标题语义

- `[[` 与 `]]` 必须在同一物理行；内部去周围空白后非空，最多 256 个 Unicode 字符，不允许控制字符、`[`、`]` 或 `|`。
- 标题采用大小写敏感的完整匹配，不做关键词匹配、Unicode 大小写折叠或额外 Unicode 规范化。
- 嵌套和三重括号按普通文本保留。未闭合、空引用、超长、别名语法和被反斜杠转义的开括号不产生引用。
- 文稿名取工作副本中已经存储的标题。已有文件、显式命名或具有实际正文标题的文稿可作目标；自动生成的空白“未命名 / Untitled”不作稳定目标。标题无法写成上述引用语法时，反链区域提示先设置可引用标题。
- 名称查询只覆盖 `Workspace.docs`，包含已登记文件和草稿，排除移除、废纸篓、隔离和未登记文件。
- 重命名后，旧 `[[旧名称]]` 不再指向新标题，除非有其他文稿使用旧标题；本次不悄悄改写任何引用文稿。
- 反向链接排除当前文稿自身，每篇来源只占一行文稿结果，可有多个引用片段。目标标题同名时不把引用默认为其中任意一篇，区域显示“同名，引用无法唯一归属”。

## Markdown 解析

有效引用存在于 Markdown 正文的普通文本、标题、列表、引用、表格、提示块与脚注正文中。以下区域不产生引用：front matter、行内代码、代码围栏/缩进代码、公式、原始 HTML 块和 HTML 属性、普通 Markdown 链接的标签/目标，以及图片的替代文字/目标。

脚注正文引用按源码统计，包括尚未被正文引用的脚注定义；预览与导出沿用现有 Markdown 对未引用脚注的展示规则。名称去周围空白使用前后端一致的 ECMAScript 空白规则，控制字符始终先判无效。

利用现有 Markdown 解析器判断上下文，不能对整个源文直接用正则统计双括号。Go 使用已有 Goldmark 的 inline 扩展；前端用一个纯 `wikiAt` 谓词适配 Lezer 和 markdown-it，两个前端适配器复用相同语法。现有公式规则的排除边界需要在 Go 中保持一致。

共享 `testdata/wiki-links.json` 固定正负样本，Go、Lezer 和 markdown-it 分别核对。解析器拥有代码、链接、HTML 和块上下文；范围使用原始内容坐标，front matter 去掉的前缀仍计入 Go 的绝对字节位置。

## 方案选择

采用“已登记工作副本快照＋语法解析”。标题查找不需要私有索引；反链只有展开时才查询。无 `[[` 的文稿可以直接跳过解析。

另外两种方案没有采用：仅扫描前端最近列表不能保证完整范围和跨文稿一致性；持久化私有 ID/图索引会增加迁移、删除、重命名与恢复协议，并改变 Markdown 的可移植性。当前规模先实测快照方案，有证据再优化。

## Go API

保留 `Search`、`FilterDocuments` 和普通 `OpenLinked`。新增：

```go
type WikiResolveRequest struct {
    SourceID string `json:"sourceID"`
    Revision int    `json:"revision"`
    Target   string `json:"target"`
}

type BacklinkStatus string
const (
    BacklinkReady     BacklinkStatus = "ready"
    BacklinkUnnamed   BacklinkStatus = "unnamed"
    BacklinkAmbiguous BacklinkStatus = "ambiguous"
)

type BacklinkResponse struct {
    DocumentID string         `json:"documentID"`
    Revision   int            `json:"revision"`
    Status     BacklinkStatus `json:"status"`
    Items      []SearchItem    `json:"items"`
    Total      int            `json:"total"`
    Truncated  bool           `json:"truncated"`
}

func (w *Workspace) ResolveWikiLink(request WikiResolveRequest, locale string) (SearchResponse, error)
func (w *Workspace) Backlinks(id, locale string) (BacklinkResponse, error)
```

锁内取现有 `searchSnapshot()`；锁外查找和解析，不调用 `State`，不读盘、不写工作副本、通知或当前 ID。原生使用当前语言；浏览器使用请求语言，不改变全局语言。

`ResolveWikiLink` 校验来源存在、revision 一致、请求名称合法，并确认来源已接受正文仍含有该有效引用。这样旧预览或伪造 HTML 链接不能绕过语法及来源校验。来源失效返回本地化错误；目标缺失返回空结果，由界面提示。目标结果按更新时间倒序、ID 稳定排序，最多 100 篇，`total` 为完整候选数。

`Backlinks` 返回当前目标的 ID/revision。唯一可引用标题时，统计所有来源文稿的语义引用；最多 100 篇，每篇最多三个 `SearchHit`，发现第四个时置 `moreHits`，`total` 和 `truncated` 对应完整来源文稿数。`SearchHit.text` 为原始 `[[...]]`，`from/to` 为 UTF-16，`line` 为原始 Markdown 的一基行号，复用 `searchHits` 构造小片段。目标未命名或同名时，返回对应 status、空数组、零 total。

所有对外数组始终为数组；不返回完整正文。结果 ID、标题、路径、片段复制成小字符串，不因小结果保留大源字符串。缺失 ID 返回既有文稿不存在错误。

## 前端模块与导航

- `src/wiki-links.ts`：纯语法谓词、保留的内部 URL 编解码、Lezer/markdown-it 适配。协议为 `liubai-wiki:` 加 URL 编码标题，不作为外部链接交给操作系统。
- `src/backlinks.ts`：折叠区的请求生命周期、状态/结果 DOM 和焦点。单个请求在途，保留最新待处理任务；任务包含目标 ID/revision，180 ms 防抖。折叠、内容待保存/组合输入、语言或文稿变化立即使旧响应失效。
- `src/app.ts`：已有保存保护、同名选择和 `navigateSearch` 接线；不把语法、结果渲染和队列全部追加进主文件。
- `src/markdown.ts` 与 `src/editor.ts`：加入扩展；编辑器只处理可见范围内的装饰，组合输入期间不改变装饰或导航。普通 Markdown 链接保持原行为。

点击 Wiki 链接先完成已有保存，再请求来源 revision/标题解析；等待期间保留来源编辑器、ID、generation 和导航身份。输入、组合输入或文稿变化后中止旧任务；失败保留文字。唯一目标通过现有 `navigateSearch(item, undefined, false)` 打开，维持当前视图与撤销记录。

同名选择器使用现有 modal dialog 样式，只在候选超过一篇时出现；显示标题、文件路径或“草稿”及更新时间，允许取消，不按列表首项静默选择。候选自身 revision 失效仍走已有安全导航，不用旧范围。缺失目标显示短提示，不扩大到目录扫描。

反向链接标题与片段分别复用 `navigateSearch` 的无 hit/有 hit 路径。打开、改名、保存、随手记追加、新建、移除、语言与侧栏状态变化刷新当前展开区域；位置保存不触发解析。内容 pending 时保留列表但禁用旧导航，并显示保存后一致性说明。返回目标 ID/revision 不匹配时不能显示旧结果。

搜索与标签控件不被反链结果重绘，反链状态不会清除关键词或标签。原生 `<details>/<summary>` 支持 Tab/Enter/Space；结果按现有方向键/Enter/焦点逻辑操作，刷新不从编辑器抢回焦点。

## 展示、导出与安全

侧栏仅新增一个默认折叠区域；展开后有上限的滚动列表，不增加顶栏按钮或新的全局外观设置。使用现有角色色、系统 UI 字体和细线，正文链接沿用主题链接样式；新 UI 文案/字号不低于 11 px。同名选择器适配窄窗口和十一主题。

`renderMarkdown` 默认以普通文本保留原始 `[[...]]`；只有预览显式开启交互 Wiki 渲染。这样 HTML/PDF、富文本复制和 Word 保留可读引用，不带依赖本应用的内部 URL；Markdown/ZIP 保留原始源码。新增协议只用于应用内可点击链接，普通 URL 白名单不因此扩大。

名称与片段按文本/转义内容展示；不把标题拼接成 HTML。即使标题看似路径或 `javascript:`，也只在登记标题中精确查找。DOMPurify 的协议处理与生成链接相容，含作者 HTML 时仍进行原有消毒；不能因支持 Wiki 关闭消毒。

## 验收

- **WL-1 语法**：共享样本覆盖中文/emoji、空白、转义、嵌套、未闭合、别名、超长以及所有排除区域；Go/前端语义一致。
- **WL-2 解析目标**：唯一、同名、缺失、大小写、默认未命名、来源 revision 和来源实际引用校验正确；未登记文件不被打开。
- **WL-3 反链范围**：所有登记文稿、重启恢复、移除/未登记排除、自引用排除、全局同名、100/3 上限和完整总数正确。
- **WL-4 坐标与只读**：中文/emoji 与正文文尾坐标准确；前后状态、通知、当前 ID、revision 和文件字节不变；快照不随后续更新改变。
- **WL-5 导航**：三种视图、未保存输入、保存失败、组合输入、撤销、同名选择/取消和旧候选安全；反链片段使用原始范围定位。
- **WL-6 生命周期**：一个在途、最新待处理、旧成功/错误/ID/revision/语言失效、pending 暂停、保存更新、位置不刷新和折叠按需查询正确。
- **WL-7 界面**：中英文、十一主题、窄窗口、键盘与焦点保持，无嵌套交互/横向溢出，不覆盖搜索与标签状态。
- **WL-8 可移植性**：Markdown 原文不改；HTML/富文本/Word 不泄漏内部 URL；代码、公式、HTML 和普通链接保持原行为，无 XSS 或意外外部打开。
- **WL-9 质量与性能**：Go/race/vet/Windows vet、TS/i18n/构建与相关浏览器回归通过。18 MB 全引用反链查询三轮均值中位数目标 ≤500 ms；1000 篇反链首次展开到 ready 的 30 次查询 P95 ≤800 ms（含防抖）。已有搜索 250 ms 后端/600 ms UI 预算保持。

## 交付边界

继续在 `feat/full-text-search` 当前 checkout 中实施，不使用 worktree，不改依赖/版本，不提交、推送或发布，保留设置、随手记、文内查找、全文搜索及标签筛选的未提交工作。维护的回归测试放入仓库；临时脚本、浏览器数据、截图、profile 与日志放系统临时目录。

开发连续执行，按任务做规格审查后再做独立质量审查；实际命令及 WL-1 至 WL-9 证据写入实施计划。浏览器合成组合输入、Windows 平台模拟不外推为原生 IME、正式打包或签名公证。
