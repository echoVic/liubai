# 块编辑第一期实施计划

> 设计：[2026-10-17-block-editing-design.md](../specs/2026-10-17-block-editing-design.md)。实现者为本机 Codex CLI，编排者逐任务审查、在沙箱外跑全部检查与浏览器回归后提交。

**目标**：在 CodeMirror 编辑器上加入块操作（手柄、拖动、选中、块菜单、键盘移动）和斜杠插入菜单，发布 0.2.0。

**全局约束**

- Markdown 文本是唯一来源；块从语法树推算；每个操作一次事务、一步撤销；未涉及的字节不变。
- 中文组字期间（`composing` 状态字段）不推算、不显示手柄、不弹菜单。
- 手柄与插入线只在编辑视图和分栏的即时排版中出现；源码模式、阅读视图、专注模式、只读时不出现。
- 新文案进入 `locales/zh-Hans.json` 与 `locales/en.json`，`go tool mygo generate .` 后 `go tool mygo i18n check`、`node scripts/check-i18n.mjs` 通过。
- `scripts/check-performance.ts` 预算照常通过；不新增依赖。

## 任务 1：块模型与操作

**文件**：新增 `src/blocks.ts`、`scripts/check-blocks.ts`；修改 `src/editing.ts`（必要时复用 `blockFormat` / `setHeading` / `codeBlock`）。

**接口**（供任务 2、3 使用）：

```ts
export interface Block {from:number;to:number;kind:BlockType;depth:number;parent:number|null;children:number[]}
export type BlockType='paragraph'|'heading'|'quote'|'code'|'table'|'rule'|'html'|'listItem';
export function blocksOf(state:EditorState):Block[];            // 按文档顺序，列表项含嵌套关系；front matter 除外
export function blockAt(state:EditorState,pos:number):Block|null; // 最内层包含 pos 的块
export function moveBlocks(state:EditorState,range:{from:number,to:number},dir:-1|1):TransactionSpec|null;
export function moveBlocksTo(state:EditorState,range:{from:number,to:number},target:Block,place:'before'|'after'):TransactionSpec|null;
export function convertBlocks(state:EditorState,range:{from:number,to:number},to:'paragraph'|'h1'|'h2'|'h3'|'bullet'|'ordered'|'task'|'quote'|'code'):TransactionSpec;
export function duplicateBlocks(state:EditorState,range:{from:number,to:number}):TransactionSpec;
export function deleteBlocks(state:EditorState,range:{from:number,to:number}):TransactionSpec;
```

**测试**（`scripts/check-blocks.ts`，Bun）：段落、标题、引用、围栏代码、表格、分割线、HTML 块与列表项的识别；与前后块交换、拖到任意块前后、列表项带子项移动、只在同级移动、有序列表重编号、顶层块之间空行保持、紧凑列表保持紧凑；转换为各类型；复制与删除；每个操作 `undo` 一步还原；未涉及的行逐字节不变；front matter 不受影响；`check-performance` 预算不变。

## 任务 2：手柄、拖动、选中与块菜单

**文件**：新增 `src/block-ui.ts`；修改 `src/editor.ts`（挂载扩展）、`src/app.ts`（块菜单动作、⌥⇧↑↓、⌘/）、`src/index.html`（块菜单）、`src/style.css`、`src/icons.ts`（`grip-vertical`、`plus`，Lucide）、两份目录、`scripts/check-blocks.py`（新浏览器回归）。

**行为**：见设计「界面」一节。手柄定位在正文栏左外沿，跟随悬停块的第一行；拖动显示插入线、Esc 取消、靠边自动滚动；点手柄选中并打开块菜单，⇧ 点连选；块菜单的转换、复制一份、删除、上移、下移调用任务 1 的接口；⌥⇧↑↓ 移动光标所在块或所选块；⌘/ 打开块菜单。

**测试**（`scripts/check-blocks.py`）：悬停段落出现手柄且位于正文栏左侧；源码模式、阅读视图、专注模式下不出现；把第三段拖到第一段之前，内容顺序正确且 ⌘Z 一步还原；Esc 取消拖动不改内容；点手柄选中整块，⇧ 点另一块选中连续块并整体上移；块菜单把段落转成标题 2、把三行转成任务列表；⌥⇧↓ 移动列表项（带子项）；合成组字期间不显示手柄；英文界面菜单文案。

## 任务 3：斜杠菜单与「+」

**文件**：新增 `src/slash.ts`；修改 `src/editor.ts`、`src/app.ts`、`src/style.css`、两份目录、`scripts/check-blocks.py`。

**行为**：见设计「斜杠菜单」一节。触发字符「/」与「、」只在空行开头生效；菜单项带中文名、英文名、全拼、拼音首字母和英文关键词；↑↓、Enter、Tab、Esc；表格插入 2×2 模板并把光标放进第一个单元格，图片走现有的图片选择，提示块插入 `> [!NOTE]`，分割线插入 `---`；手柄「+」在块下方插入空段落并打开菜单。

**测试**：空行输入 `/` 弹出菜单，`/bt` 过滤出标题项，Enter 后该行成为 `## `（按所选级别）且「/bt」被删除；`、` 在空行开头同样触发，行中间不触发；Esc 关闭并保留文字；表格模板与光标位置；分割线；提示块；「+」插入空段落并打开菜单；组字期间不触发；英文界面菜单文案。

## 任务 4：发布 0.2.0

版本号（`mygo.json`、`package.json`、`main.go` 两处）、`CHANGELOG.md`、README、验证记录；全部检查、原生实测（隔离测试包中手柄与块菜单）、签名公证、`-upload`、发布为最新版本并核对更新源。
