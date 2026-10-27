# 工具栏悬停提示与格式快捷键 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工具栏按钮悬停或键盘聚焦时显示一个跟随主题的提示（名称 + 快捷键），并新增 14 个格式快捷键（⌘0–⌘6、⌘I、⌘⇧X、⌘⇧H、⌘E、⌘⇧7/8/9），回应 issue #1。

**Architecture:** `src/shortcuts.ts` 是格式快捷键的唯一来源：一张「动作 → 键位」表和一个按键识别函数。工具栏提示、标题菜单、⌘K 列表和文档级按键处理都读它。`src/tooltip.ts` 在页面上放一个提示层，靠事件委托为所有带 `data-tip` 的元素显示提示；键位写在 `data-shortcut`，显示时由 `keyLabel` 按平台渲染。原生 `title` 从这些按钮上去掉。

**Tech Stack:** Go 1.27 + MyGo 0.6.0，TypeScript + CodeMirror 6，esbuild，bun（单元检查），Python Playwright + Chrome（浏览器回归）。

**Spec:** `docs/superpowers/specs/2026-10-26-toolbar-tooltips-design.md`

## Global Constraints

- **不提交、不推送。** 所有改动留在 worktree 里，由 Claude 审阅后交给用户决定。计划里没有 commit 步骤。
- 不改 `main.go` 和原生菜单，不改「更多」菜单、块菜单「转换为」和插入菜单，不改 `src/table-ui.ts` 里单元格自己的 ⌘B/⌘I/⌘U/⌘L 处理。
- 不加依赖。`web/` 是提交到仓库的构建产物，只能用 `node scripts/build.mjs` 重建，不手改。`locales.ts`、`locales/catalog_gen.go`、`bindings.ts` 只能用 `go tool mygo generate` 重新生成。
- 代码风格跟随周围代码：TS 和 CSS 是紧凑的单行写法，注释少而且用英文，命名沿用现有习惯。
- 文案：`locales/zh-Hans.json` 是模板，每条带 `@key` 描述；`locales/en.json` 只有译文。改完运行 `go tool mygo generate`，再跑 `go tool mygo i18n check` 和 `node scripts/check-i18n.mjs`。
- 只读颜色角色（`var(--popover)`、`var(--border)` 等），不写主题的十六进制色值。悬停即时，不加任何过渡或淡入淡出（DESIGN.md）。
- 仓库是公开的：不写本机路径、内部域名；公开文字里不提语雀、飞书文档。
- 平台：macOS 的 Mod 是 ⌘（`metaKey`），Windows 是 Ctrl（`ctrlKey`）；Windows 上 Ctrl+Alt 等于 AltGr。
- 浏览器回归用 `scripts/e2e.sh <check>`，每次都会编译并用新的数据目录起服务；跑之前先 `node scripts/build.mjs`。这台机器负载常在 15–25：偶发超时先单独重跑一次；仍失败时，到干净的 `main` 上跑同一个检查对比，再判断是不是这次的回归。
- 已知和这次无关的失败：`check-mermaid` 最后一条断言（Chrome 156 起 CSP 报 `script-src-attr`）；负载高时 `check-windows` 的随手记一步和 `check-images` 的图片工具条一步偶发失败。
- 不跑任何原生 GUI 测试，不碰 /Applications 里的留白和用户的数据目录。WebKit 离屏检查（`check-blocks-webkit`、`check-pdf`）这次不用跑。

## 文件清单

- 新建 `src/shortcuts.ts`（快捷键表、按键识别、ARIA 写法），`scripts/check-shortcuts.ts`（单元检查）。
- 新建 `src/tooltip.ts`（提示层）。
- 修改 `src/app.ts`、`src/index.html`、`src/i18n.ts`、`src/editor.ts`、`src/style.css`。
- 修改 `locales/zh-Hans.json`、`locales/en.json`，以及由它们生成的 `locales.ts`、`locales/catalog_gen.go`、`bindings.ts`。
- 修改 `scripts/check-toolbar.py`、`scripts/check-windows.py`、`scripts/check-english.py`、`scripts/check-tables.py`、`scripts/check-images.py`。
- 修改 `README.md`、`README.en.md`、`DESIGN.md`。
- 重新构建 `web/`。

---

### Task 1: 快捷键表与按键识别

**Files:**
- Create: `src/shortcuts.ts`
- Test: `scripts/check-shortcuts.ts`

**Interfaces:**
- Consumes: `src/platform.ts` 的 `mac: boolean`、`redoKeys: string`、`keyLabel(keys, {spaced?, macOS?})`。
- Produces:
  - `shortcuts: Record<string,string>`：动作 id → 键位（`'Mod+Shift+X'` 这种写法）。
  - `shortcutAction(e: Pick<KeyboardEvent,'key'|'code'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'>, opts?: {macOS?: boolean}): string|undefined`：返回动作 id，只认 `paragraph`、`h1`–`h6`、`bold`、`italic`、`underline`、`strike`、`highlight`、`inlineCode`、`ordered`、`bullet`、`task`、`link`。
  - `ariaKeys(keys: string, opts?: {macOS?: boolean}): string`：把 `Mod` 换成 `Meta`（macOS）或 `Control`（其他平台）。

- [ ] **Step 1: 写单元检查** `scripts/check-shortcuts.ts`

```ts
import assert from 'node:assert/strict';
import {shortcuts,shortcutAction,ariaKeys} from '../src/shortcuts';
import {keyLabel,redoKeys} from '../src/platform';
type Mods={metaKey?:boolean;ctrlKey?:boolean;altKey?:boolean;shiftKey?:boolean};
const press=(key:string,code:string,mods:Mods={})=>({key,code,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,...mods});
for(const macOS of [true,false]){
 const mod:Mods=macOS?{metaKey:true}:{ctrlKey:true},name=macOS?'macOS':'Windows',on=(e:ReturnType<typeof press>)=>shortcutAction(e,{macOS});
 for(const [id,key,code,shiftKey] of [['paragraph','0','Digit0',false],['h1','1','Digit1',false],['h2','2','Digit2',false],['h3','3','Digit3',false],['h4','4','Digit4',false],['h5','5','Digit5',false],['h6','6','Digit6',false],['bold','b','KeyB',false],['italic','i','KeyI',false],['underline','u','KeyU',false],['inlineCode','e','KeyE',false],['link','l','KeyL',false],['strike','X','KeyX',true],['highlight','H','KeyH',true],['ordered','&','Digit7',true],['bullet','*','Digit8',true],['task','(','Digit9',true]] as const)
  assert.equal(on(press(key,code,{...mod,shiftKey})),id,`${name} ${id}`);
 // Caps Lock, Playwright's lowercase Shift+x, and a French keyboard's unshifted & on the 1 key.
 assert.equal(on(press('I','KeyI',mod)),'italic',name);
 assert.equal(on(press('x','KeyX',{...mod,shiftKey:true})),'strike',name);
 assert.equal(on(press('&','Digit1',mod)),'h1',name);
 for(const [label,e] of [
  ['cut',press('x','KeyX',mod)],['Shift+E',press('E','KeyE',{...mod,shiftKey:true})],['Shift+I',press('I','KeyI',{...mod,shiftKey:true})],['Shift+1',press('!','Digit1',{...mod,shiftKey:true})],
  ['Alt+1',press('1','Digit1',{...mod,altKey:true})],['keypad 1',press('1','Numpad1',mod)],['no modifier',press('1','Digit1')],['Shift only',press('X','KeyX',{shiftKey:true})],
  ['both modifiers',press('1','Digit1',{metaKey:true,ctrlKey:true})],['the other platform\'s modifier',press('1','Digit1',macOS?{ctrlKey:true}:{metaKey:true})],
  ['undo',press('z','KeyZ',mod)],['find',press('f','KeyF',mod)],['source',press('M','KeyM',{...mod,shiftKey:true})],['save',press('s','KeyS',mod)],
 ] as const)assert.equal(on(e),undefined,`${name} ${label}`);
}
assert.equal(shortcutAction(press('1','Digit1',{ctrlKey:true,altKey:true}),{macOS:false}),undefined,'AltGr');
for(const [keys,macOS,other] of [['Mod+Shift+X','Meta+Shift+X','Control+Shift+X'],['Mod+0','Meta+0','Control+0'],['Mod+\\','Meta+\\','Control+\\'],['Shift+Tab','Shift+Tab','Shift+Tab']] as const){
 assert.equal(ariaKeys(keys,{macOS:true}),macOS,keys);assert.equal(ariaKeys(keys,{macOS:false}),other,keys);
}
for(const [id,macOS,other] of [['paragraph','⌘0','Ctrl+0'],['h6','⌘6','Ctrl+6'],['italic','⌘I','Ctrl+I'],['strike','⌘⇧X','Ctrl+Shift+X'],['highlight','⌘⇧H','Ctrl+Shift+H'],['inlineCode','⌘E','Ctrl+E'],['ordered','⌘⇧7','Ctrl+Shift+7'],['bullet','⌘⇧8','Ctrl+Shift+8'],['task','⌘⇧9','Ctrl+Shift+9'],['outdent','⇧Tab','Shift+Tab'],['indent','Tab','Tab'],['source','⌘⇧M','Ctrl+Shift+M']] as const){
 assert.equal(keyLabel(shortcuts[id],{macOS:true}),macOS,id);assert.equal(keyLabel(shortcuts[id],{macOS:false}),other,id);
}
assert.equal(shortcuts.redo,redoKeys);
assert.equal(keyLabel('Mod+1–6',{macOS:true}),'⌘1–6');assert.equal(keyLabel('Mod+1–6',{macOS:false}),'Ctrl+1–6');
console.log('格式快捷键检查通过');
```

- [ ] **Step 2: 运行，确认失败**

Run: `bun scripts/check-shortcuts.ts`
Expected: FAIL，报找不到模块 `../src/shortcuts`。

- [ ] **Step 3: 实现** `src/shortcuts.ts`

```ts
import {mac,redoKeys} from './platform';
// The toolbar's keys, in platform.ts notation. The tooltips, the heading menu, All Commands and the key handler read them here.
export const shortcuts:Record<string,string>={undo:'Mod+Z',redo:redoKeys,paragraph:'Mod+0',h1:'Mod+1',h2:'Mod+2',h3:'Mod+3',h4:'Mod+4',h5:'Mod+5',h6:'Mod+6',bold:'Mod+B',italic:'Mod+I',underline:'Mod+U',strike:'Mod+Shift+X',highlight:'Mod+Shift+H',inlineCode:'Mod+E',ordered:'Mod+Shift+7',bullet:'Mod+Shift+8',task:'Mod+Shift+9',outdent:'Shift+Tab',indent:'Tab',link:'Mod+L',find:'Mod+F',source:'Mod+Shift+M'};
// CodeMirror and the native menu handle undo, redo, find, the source view and list indents; the key handler matches the rest.
const matched=['paragraph','h1','h2','h3','h4','h5','h6','bold','italic','underline','strike','highlight','inlineCode','ordered','bullet','task','link'];
type Keys=Pick<KeyboardEvent,'key'|'code'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'>;
// Mod is ⌘ on macOS and Ctrl elsewhere. Shift must agree and Alt stays up, as Ctrl+Alt is AltGr on Windows.
// Letters go by the character typed, digits by the key, because Shift+7 types &; keypad digits do not count.
export function shortcutAction(e:Keys,{macOS=mac}:{macOS?:boolean}={}):string|undefined{
 if(e.altKey||(macOS?!e.metaKey||e.ctrlKey:!e.ctrlKey||e.metaKey))return;
 const key=/^Digit(\d)$/.exec(e.code)?.[1]||(/^[a-z]$/i.test(e.key)?e.key.toUpperCase():'');
 const keys=(e.shiftKey?'Mod+Shift+':'Mod+')+key;
 return key?matched.find(id=>shortcuts[id]===keys):undefined;
}
// The same keys as aria-keyshortcuts names them: Meta+Shift+X on macOS, Control+Shift+X elsewhere.
export function ariaKeys(keys:string,{macOS=mac}:{macOS?:boolean}={}){return keys.split('+').map(part=>part==='Mod'?(macOS?'Meta':'Control'):part).join('+')}
```

- [ ] **Step 4: 运行，确认通过**

Run: `bun scripts/check-shortcuts.ts && bun scripts/check-platform.ts && node_modules/.bin/tsc --noEmit`
Expected: 输出「格式快捷键检查通过」和「平台快捷键写法检查通过」，tsc 无输出。

---

### Task 2: 提示层，并把工具栏的 `title` 换成它

**Files:**
- Create: `src/tooltip.ts`
- Modify: `src/style.css`（末尾加一行）、`src/index.html`（第 2、6、9 行的 12 个 `title`）、`src/i18n.ts`（`localizePage`）、`src/app.ts`（import、`renderDrawer`、`formatButtons`、插入按钮、格式栏生成循环、源码按钮、`applyIcons();` 之后、`refreshLanguage`）
- Modify: `locales/zh-Hans.json`、`locales/en.json`（然后 `go tool mygo generate`）
- Test: `scripts/check-toolbar.py`、`scripts/check-windows.py`、`scripts/check-english.py`

**Interfaces:**
- Consumes: Task 1 的 `shortcuts`、`ariaKeys`；`platform.ts` 的 `keyLabel`；`i18n.ts` 的 `onPageLocaleChange`。
- Produces:
  - `attachTooltips(): void`，建 `<div id="tooltip" role="tooltip" hidden><span></span><kbd></kbd></div>`，挂在 `body` 末尾。
  - DOM 约定：带 `data-tip` 的元素有提示；`data-shortcut` 是键位（如 `Mod+B`）；静态 HTML 用 `data-i18n-tip="消息键"` 本地化提示文字。

- [ ] **Step 1: 先改测试** `scripts/check-toolbar.py`

（a）`accessible_buttons` 里，把

```python
            assert button.get_attribute("title"), button.evaluate("el => el.outerHTML")
```

换成

```python
            assert button.get_attribute("data-tip"), button.evaluate("el => el.outerHTML")
            assert button.get_attribute("title") is None, button.evaluate("el => el.outerHTML")
```

（b）`check_format_bar` 里，把从 `expect(heading).to_have_attribute("title", "标题级别")` 到 `expect(source).to_have_attribute("title", "显示 Markdown 源码 ⌘⇧M")` 这 12 行换成

```python
    expect(heading).to_have_attribute("data-tip", "标题级别")
    expect(heading).to_have_attribute("data-shortcut", "Mod+1–6")
    expect(heading).to_have_attribute("aria-haspopup", "menu")
    expect(bar.locator('[data-action="bold"]')).to_have_attribute("data-tip", "加粗")
    expect(bar.locator('[data-action="bold"]')).to_have_attribute("data-shortcut", "Mod+B")
    expect(bar.locator('[data-action="link"]')).to_have_attribute("data-tip", "链接")
    expect(bar.locator('[data-action="link"]')).to_have_attribute("data-shortcut", "Mod+L")
    expect(bar.locator('[data-action="footnote"]')).to_have_accessible_name("脚注")
    expect(bar.locator('[data-action="footnote"]')).to_have_attribute("data-tip", "脚注")
    expect(bar.locator('[data-action="mermaid"]')).to_have_accessible_name("图表")
    expect(bar.locator('[data-action="mermaid"]')).to_have_attribute("data-tip", "图表")
    expect(bar.locator('[data-action="math"]')).to_have_accessible_name("公式")
    expect(bar.locator('[data-action="math"]')).to_have_attribute("data-tip", "公式")
    expect(source).to_have_text("源码")
    expect(source).to_have_attribute("data-tip", "显示 Markdown 源码")
    expect(source).to_have_attribute("data-shortcut", "Mod+Shift+M")
```

（c）同一函数里，把

```python
    for button in bar.locator("button:visible").all():
        assert button.get_attribute("title"), button.evaluate("el => el.outerHTML")
```

换成

```python
    for button in bar.locator("button:visible").all():
        assert button.get_attribute("data-tip") and button.get_attribute("title") is None, button.evaluate("el => el.outerHTML")
```

（d）在 `def settled(page):` 之前加一个函数：

```python
def check_tooltips(page):
    """The drawn tooltip: name and keys, the delay, moving along the bar, dismissal, keyboard focus, placement and theme."""
    tip, bar = page.locator("#tooltip"), page.locator("#format-bar")
    name, keys = tip.locator("span"), tip.locator("kbd")
    expect(tip).to_have_attribute("role", "tooltip")
    expect(tip).to_be_hidden()
    assert page.locator(".topbar [title], #format-bar [title], #drawer [title]").count() == 0
    for selector, label, shortcut, aria in [
        ('#format-bar [data-action="bold"]', "加粗", "Mod+B", "Meta+B"), ('#format-bar [data-action="italic"]', "斜体", "Mod+I", "Meta+I"),
        ('#format-bar [data-action="footnote"]', "脚注", None, None), ("#heading-button", "标题级别", "Mod+1–6", None),
        ('[data-view="single"]', "只显示编辑区", None, None), ('[data-view="split"]', "编辑区和阅读视图并排", "Mod+\\", "Meta+\\"),
        ('[data-view="read"]', "只显示排好版的文稿", "Mod+Shift+R", "Meta+Shift+R"), ('.drawer-head [data-action="new"]', "新建文稿", "Mod+N", "Meta+N"),
        ('#format-bar [data-action="source"]', "显示 Markdown 源码", "Mod+Shift+M", "Meta+Shift+M"), ("#sidebar-button", "侧栏：最近文稿", None, None),
    ]:
        control = page.locator(selector)
        expect(control).to_have_attribute("data-tip", label)
        assert control.get_attribute("data-shortcut") == shortcut, (selector, control.get_attribute("data-shortcut"))
        assert control.get_attribute("aria-keyshortcuts") == aria, (selector, control.get_attribute("aria-keyshortcuts"))

    # A resting pointer waits about 500ms; then the tooltip follows it along the bar at once.
    page.mouse.move(5, 500)
    page.wait_for_timeout(900)
    page.evaluate("""() => { const tip = document.querySelector('#tooltip'); window.tipTimes = {};
      document.addEventListener('pointerover', e => { if (e.target.closest('[data-tip]') && !window.tipTimes.over) window.tipTimes.over = performance.now() }, true);
      new MutationObserver(() => { if (!tip.hidden && !window.tipTimes.shown) window.tipTimes.shown = performance.now() }).observe(tip, {attributes: true}) }""")
    bold = bar.locator('[data-action="bold"]')
    bold.hover()
    expect(tip).to_be_visible()
    delay = page.evaluate("window.tipTimes.shown - window.tipTimes.over")
    assert 450 <= delay <= 2000, delay
    expect(name).to_have_text("加粗")
    expect(keys).to_have_text("⌘B")
    expect(bold).to_have_attribute("aria-describedby", "tooltip")
    b, t = bold.bounding_box(), tip.bounding_box()
    assert abs(t["x"] + t["width"] / 2 - (b["x"] + b["width"] / 2)) <= 1.5 and 4 <= t["y"] - (b["y"] + b["height"]) <= 8, (b, t)
    for action, label, shortcut in [("italic", "斜体", "⌘I"), ("strike", "删除线", "⌘⇧X"), ("ordered", "有序列表", "⌘⇧7"), ("footnote", "脚注", "")]:
        bar.locator(f'[data-action="{action}"]').hover()
        expect(name).to_have_text(label, timeout=300)
        expect(keys).to_have_text(shortcut)
    expect(keys).to_be_hidden()
    assert bold.get_attribute("aria-describedby") is None
    page.locator("#heading-button").hover()
    expect(name).to_have_text("标题级别", timeout=300)
    expect(keys).to_have_text("⌘1–6")

    # Leaving and Escape hide it. A press hides it until the pointer leaves that control.
    page.mouse.move(5, 500)
    expect(tip).to_be_hidden()
    bold.hover()
    expect(tip).to_be_visible()
    page.keyboard.press("Escape")
    expect(tip).to_be_hidden()
    page.mouse.move(5, 500)
    page.wait_for_timeout(900)
    find = bar.locator('[data-action="find"]')
    find.hover()
    expect(name).to_have_text("查找替换")
    box = find.bounding_box()
    page.mouse.down()
    expect(tip).to_be_hidden()
    page.mouse.up()
    expect(page.locator(".cm-search")).to_be_visible()
    page.mouse.move(box["x"] + box["width"] / 2 + 3, box["y"] + box["height"] / 2 + 2)
    page.wait_for_timeout(900)
    expect(tip).to_be_hidden()
    page.mouse.move(5, 500)
    find.hover()
    expect(tip).to_be_visible()
    page.locator(".cm-search input").first.focus()
    page.keyboard.press("Escape")
    expect(tip).to_be_hidden()
    expect(page.locator(".cm-search")).to_be_hidden()

    # No tooltip for a control whose menu is open.
    page.locator("#heading-button").click()
    expect(page.locator("#heading-menu")).to_be_visible()
    page.mouse.move(5, 500)
    page.locator("#heading-button").hover()
    page.wait_for_timeout(900)
    expect(tip).to_be_hidden()
    page.keyboard.press("Escape")
    expect(page.locator("#heading-menu")).to_be_hidden()

    # Keyboard focus shows it at once; leaving the control hides it.
    page.mouse.move(5, 500)
    bold.focus()
    page.keyboard.press("Tab")
    expect(bar.locator('[data-action="italic"]')).to_be_focused()
    expect(name).to_have_text("斜体", timeout=300)
    expect(tip).to_be_visible()
    page.keyboard.press("Shift+Tab")
    expect(name).to_have_text("加粗", timeout=300)
    page.locator(".cm-content").focus()
    expect(tip).to_be_hidden()

    # Near the window's edges it stays 8px inside; with no room below it sits above the control.
    page.set_viewport_size({"width": 680, "height": 820})
    for selector in ("#sidebar-button", ".export-button"):
        page.mouse.move(5, 700)
        page.locator(selector).hover()
        expect(tip).to_be_visible()
        t = tip.bounding_box()
        assert t["x"] >= 7.5 and t["x"] + t["width"] <= 680 - 7.5, (selector, t)
    page.set_viewport_size({"width": 1120, "height": 820})
    page.evaluate("""() => { const b = document.createElement('button'); b.id = 'tip-probe'; b.dataset.tip = '底部'; b.textContent = '底'; b.style.cssText = 'position:fixed;left:2px;bottom:2px'; document.body.append(b) }""")
    page.mouse.move(5, 400)
    page.locator("#tip-probe").hover()
    expect(tip).to_be_visible()
    p, t = page.locator("#tip-probe").bounding_box(), tip.bounding_box()
    assert t["y"] + t["height"] <= p["y"] - 4 and t["x"] >= 7.5, (p, t)
    page.mouse.move(5, 400)
    page.evaluate("document.querySelector('#tip-probe').remove()")

    # Floating paper in every theme: in Ink it takes Ink's popover colour.
    set_theme(page, "ink")
    bold.hover()
    expect(tip).to_be_visible()
    colours = page.evaluate("""() => { const probe = document.createElement('div'); probe.style.background = 'var(--popover)'; document.body.append(probe);
      const pair = [getComputedStyle(document.querySelector('#tooltip')).backgroundColor, getComputedStyle(probe).backgroundColor]; probe.remove(); return pair }""")
    assert colours[0] == colours[1], colours
    page.evaluate("delete document.documentElement.dataset.liubaiTheme; delete document.documentElement.dataset.liubaiScheme")
    page.mouse.move(5, 500)
    expect(tip).to_be_hidden()
```

（e）在 `run(page)` 里，紧跟 `check_format_bar(page)` 加一行 `check_tooltips(page)`。

（f）文件末尾英文部分，在 `expect(page.locator("#insert-button")).to_have_accessible_name("Insert")` 之后加：

```python
    page.locator('#format-bar [data-action="bold"]').hover()
    expect(page.locator("#tooltip span")).to_have_text("Bold")
    expect(page.locator("#tooltip kbd")).to_have_text("⌘B")
    page.locator('[data-view="split"]').hover()
    expect(page.locator("#tooltip span")).to_have_text("Show the editor and reading view side by side")
    page.mouse.move(5, 500)
```

- [ ] **Step 2: 改 Windows 和英文检查**

`scripts/check-windows.py` 的 `windows()` 里，把

```python
    expect(page.locator('button.tool[data-action="new"]')).to_have_attribute("title", "新建文稿 Ctrl+N")
    expect(page.locator('[data-view="split"]')).to_have_attribute("title", "编辑区和阅读视图并排 Ctrl+\\")
    expect(page.locator('[data-view="read"]')).to_have_attribute("title", "只显示排好版的文稿 Ctrl+Shift+R")
    expect(page.locator('#format-bar [data-action="bold"]')).to_have_attribute("title", "加粗 Ctrl+B")
    expect(page.locator('#format-bar [data-action="redo"]')).to_have_attribute("title", "重做 Ctrl+Y")
```

换成

```python
    expect(page.locator('button.tool[data-action="new"]')).to_have_attribute("aria-keyshortcuts", "Control+N")
    expect(page.locator('#format-bar [data-action="bold"]')).to_have_attribute("aria-keyshortcuts", "Control+B")
    # The tooltip writes the keys for this platform as it shows.
    for selector, label, keys in [('[data-view="split"]', "编辑区和阅读视图并排", "Ctrl+\\"), ('[data-view="read"]', "只显示排好版的文稿", "Ctrl+Shift+R"), ('#format-bar [data-action="bold"]', "加粗", "Ctrl+B"), ('#format-bar [data-action="redo"]', "重做", "Ctrl+Y"), ('#format-bar [data-action="strike"]', "删除线", "Ctrl+Shift+X"), ("#heading-button", "标题级别", "Ctrl+1–6")]:
        page.locator(selector).hover()
        expect(page.locator("#tooltip span")).to_have_text(label)
        expect(page.locator("#tooltip kbd")).to_have_text(keys)
    page.mouse.move(5, 500)
```

`mac()` 里，把

```python
    expect(page.locator('button.tool[data-action="new"]')).to_have_attribute("title", "新建文稿 ⌘N")
    expect(page.locator('#format-bar [data-action="redo"]')).to_have_attribute("title", "重做 ⌘⇧Z")
```

换成

```python
    expect(page.locator('button.tool[data-action="new"]')).to_have_attribute("aria-keyshortcuts", "Meta+N")
    page.locator('#format-bar [data-action="redo"]').hover()
    expect(page.locator("#tooltip kbd")).to_have_text("⌘⇧Z")
    page.mouse.move(5, 500)
```

`mac_symbols_outside_documents` 里，把 `for (const attr of ['title', 'aria-label', 'placeholder'])` 换成 `for (const attr of ['title', 'aria-label', 'placeholder', 'data-tip', 'aria-keyshortcuts'])`。

`scripts/check-english.py` 里，把 `for (const attr of ['title', 'aria-label', 'placeholder'])` 换成 `for (const attr of ['title', 'aria-label', 'placeholder', 'data-tip'])`。

- [ ] **Step 3: 构建并运行，确认失败**

Run: `node scripts/build.mjs && scripts/e2e.sh check-toolbar`
Expected: FAIL，在 `accessible_buttons` 或 `check_format_bar` 的 `data-tip` 断言上失败（按钮上还没有 `data-tip`）。

- [ ] **Step 4: 写提示层** `src/tooltip.ts`

```ts
import {keyLabel} from './platform';
import {onPageLocaleChange} from './i18n';
// One tooltip for the chrome: data-tip names a control and data-shortcut holds its keys, written for this platform as it shows.
// The pointer waits 500ms; within 800ms of the last tooltip the next control shows at once. Keyboard focus shows it at once.
const delay=500,warm=800;
export function attachTooltips(){
 const tip=document.createElement('div'),label=document.createElement('span'),keys=document.createElement('kbd');
 tip.id='tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;tip.append(label,keys);document.body.append(tip);
 let shown:HTMLElement|null=null,pending:HTMLElement|null=null,pressed:HTMLElement|null=null,timer=0,closed=-Infinity;
 const control=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('[data-tip]'):null;
 function open(el:HTMLElement){
  clearTimeout(timer);pending=null;
  if(!el.isConnected||el.closest('[hidden]')||el.getAttribute('aria-expanded')==='true'||document.body.classList.contains('printing'))return;
  shown?.removeAttribute('aria-describedby');shown=el;el.setAttribute('aria-describedby',tip.id);
  label.textContent=el.dataset.tip||'';keys.textContent=el.dataset.shortcut?keyLabel(el.dataset.shortcut):'';tip.hidden=false;
  // Under the control, or above it where the window ends first; never closer than 8px to an edge.
  const r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight,below=r.bottom+6;
  tip.style.left=Math.max(8,Math.min(r.left+r.width/2-w/2,innerWidth-w-8))+'px';tip.style.top=Math.max(8,below+h>innerHeight-8?r.top-6-h:below)+'px';
 }
 function close(){clearTimeout(timer);pending=null;if(!shown)return;shown.removeAttribute('aria-describedby');shown=null;tip.hidden=true;closed=performance.now()}
 document.addEventListener('pointerover',e=>{
  const el=control(e.target);if(!el||el===shown||el===pending||el===pressed||e.pointerType!=='mouse'&&e.pointerType!=='pen')return;
  if(shown||performance.now()-closed<warm){open(el);return}
  clearTimeout(timer);pending=el;timer=window.setTimeout(()=>open(el),delay);
 });
 document.addEventListener('pointerout',e=>{
  const el=control(e.target);if(!el||el.contains(e.relatedTarget as Node|null))return;
  if(el===pressed)pressed=null;if(el===pending){clearTimeout(timer);pending=null}if(el===shown)close();
 });
 // A press hides the tooltip until the pointer leaves that control.
 document.addEventListener('pointerdown',e=>{pressed=control(e.target);close()},true);
 document.addEventListener('focusin',e=>{const el=control(e.target);if(el?.matches(':focus-visible'))open(el)});
 document.addEventListener('focusout',e=>{if(control(e.target)===shown)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close()},true);
 document.addEventListener('scroll',close,{capture:true,passive:true});
 addEventListener('resize',close);addEventListener('blur',close);onPageLocaleChange(close);
}
```

- [ ] **Step 5: 样式** 在 `src/style.css` 末尾加一行（文件已以换行结尾，加在最后）：

```css
#tooltip{position:fixed;z-index:50;display:flex;align-items:baseline;gap:12px;max-width:min(320px,calc(100vw - 16px));padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--popover);color:var(--foreground);box-shadow:0 3px 12px #0002;font-size:12px;line-height:1.45;pointer-events:none}#tooltip kbd{flex:none;margin:0;padding:0;border:0;color:var(--muted-foreground);white-space:nowrap}#tooltip kbd:empty{display:none}
```

`[hidden]{display:none!important}` 已经存在，打印时 `body>*` 全部隐藏，都不用另写。

- [ ] **Step 6: 静态按钮** `src/index.html`。用下面的脚本替换：它把 12 个 `title`/`data-i18n-title` 换成 `data-tip`/`data-i18n-tip`，并去掉提示文字里写死的快捷键。

```bash
python3 - <<'EOF'
from pathlib import Path
p = Path('src/index.html'); s = p.read_text()
assert s.count(' title="') == 12 and s.count('data-i18n-title="') == 12
s = s.replace(' title="', ' data-tip="').replace('data-i18n-title="', 'data-i18n-tip="')
for old, new in [
    ('data-tip="Show the editor and reading view side by side ⌘\\"', 'data-tip="Show the editor and reading view side by side"'),
    ('data-tip="Show the formatted document ⌘⇧R"', 'data-tip="Show the formatted document"'),
    ('data-tip="New Document ⌘N"', 'data-tip="New Document"'),
    ('data-i18n-tip="fNewDocumentN"', 'data-i18n-tip="fNewDocument"'),
    ('data-i18n-tip="fHeadingLevel">', 'data-i18n-tip="fHeadingLevel" data-shortcut="Mod+1–6">'),
]:
    assert s.count(old) == 1, old
    s = s.replace(old, new)
p.write_text(s)
EOF
```

- [ ] **Step 7: 本地化** `src/i18n.ts`。在 `localizePage` 里，`for(const attr of ['title','aria-label','placeholder'])…` 那一行之后加两行：

```ts
 // Tooltip text never carries keys: the tooltip shows data-shortcut beside it.
 for(const el of root.querySelectorAll<HTMLElement>('[data-i18n-tip]')){const say=lookup[el.dataset.i18nTip!];if(say)el.dataset.tip=say()}
```

- [ ] **Step 8: 文案**。分栏、阅读两条去掉 `{shortcut}`；删掉不再使用的 `fNewDocumentN`、`fShowMarkdownSourceM`。然后重新生成。

```bash
python3 - <<'EOF'
from pathlib import Path
def edit(path, pairs):
    p = Path(path); s = p.read_text()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old)
        s = s.replace(old, new)
    p.write_text(s)
placeholder = '''    "placeholders": {
      "shortcut": {
        "type": "String"
      }
    }
  },
'''
edit('locales/zh-Hans.json', [
    ('''  "fShowTheEditorAndReadingViewSideBySide": "编辑区和阅读视图并排 {shortcut}",
  "@fShowTheEditorAndReadingViewSideBySide": {
    "description": "Tooltip of the Split view button, followed by its shortcut.",
''' + placeholder, '''  "fShowTheEditorAndReadingViewSideBySide": "编辑区和阅读视图并排",
  "@fShowTheEditorAndReadingViewSideBySide": {
    "description": "Tooltip of the Split view button. The tooltip shows the shortcut beside it."
  },
'''),
    ('''  "fShowTheFormattedDocumentR": "只显示排好版的文稿 {shortcut}",
  "@fShowTheFormattedDocumentR": {
    "description": "Tooltip of the Read view button, followed by its shortcut.",
''' + placeholder, '''  "fShowTheFormattedDocumentR": "只显示排好版的文稿",
  "@fShowTheFormattedDocumentR": {
    "description": "Tooltip of the Read view button. The tooltip shows the shortcut beside it."
  },
'''),
    ('''  "fNewDocumentN": "新建文稿 {shortcut}",
  "@fNewDocumentN": {
    "description": "Tooltip of the New Document button, followed by its shortcut.",
''' + placeholder, ''),
    ('''  "fShowMarkdownSourceM": "显示 Markdown 源码 {shortcut}",
  "@fShowMarkdownSourceM": {
    "description": "Tooltip of the Markdown source button, followed by its shortcut.",
''' + placeholder, ''),
])
edit('locales/en.json', [
    ('  "fShowTheEditorAndReadingViewSideBySide": "Show the editor and reading view side by side {shortcut}",\n', '  "fShowTheEditorAndReadingViewSideBySide": "Show the editor and reading view side by side",\n'),
    ('  "fShowTheFormattedDocumentR": "Show the formatted document {shortcut}",\n', '  "fShowTheFormattedDocumentR": "Show the formatted document",\n'),
    ('  "fNewDocumentN": "New Document {shortcut}",\n', ''),
    ('  "fShowMarkdownSourceM": "Show Markdown Source {shortcut}",\n', ''),
])
EOF
go tool mygo generate
```

- [ ] **Step 9: 脚本生成的按钮** `src/app.ts`。用下面的脚本做精确替换；某条断言失败时，打开文件找到对应代码手工改，保持同样的结果。

```bash
python3 - <<'EOF'
from pathlib import Path
p = Path('src/app.ts'); s = p.read_text()
pairs = [
    # Imports.
    ("import {mac,windows,keyLabel,focusKeys,redoKeys} from './platform';\n",
     "import {mac,windows,keyLabel,focusKeys,redoKeys} from './platform';\nimport {shortcuts,ariaKeys} from './shortcuts';\nimport {attachTooltips} from './tooltip';\n"),
    # The recent document's remove control.
    ("remove.title=messages.fRemoveFromRecentDocuments();", "remove.dataset.tip=messages.fRemoveFromRecentDocuments();"),
    # Format buttons take their keys from shortcuts.ts.
    ("const formatButtons=()=>[\n [['undo',messages.fUndo(),keyLabel('Mod+Z')],['redo',messages.fRedo(),keyLabel(redoKeys)]],",
     "// Each button's keys come from shortcuts.ts, so its tooltip, All Commands and the key handler agree.\nconst formatButtons=()=>[\n [['undo',messages.fUndo()],['redo',messages.fRedo()]],"),
    ("['bold',messages.fBold(),keyLabel('Mod+B')]", "['bold',messages.fBold()]"),
    ("['underline',messages.fUnderline(),keyLabel('Mod+U')]", "['underline',messages.fUnderline()]"),
    ("['link',messages.fLink(),keyLabel('Mod+L')]", "['link',messages.fLink()]"),
    ("['find',messages.fFindReplace(),keyLabel('Mod+F')]", "['find',messages.fFindReplace()]"),
    ("for(const [id,label,shortcut] of buttons){const b=node('button','tool');b.dataset.action=id;b.setAttribute('aria-label',label);b.title=label+(shortcut?' '+shortcut:'');b.append(icon(id));cluster.append(b)}",
     "for(const [id,label] of buttons){const b=node('button','tool'),keys=shortcuts[id];b.dataset.action=id;b.dataset.tip=label;b.setAttribute('aria-label',label);if(keys){b.dataset.shortcut=keys;b.setAttribute('aria-keyshortcuts',ariaKeys(keys))}b.append(icon(id));cluster.append(b)}"),
    # The source toggle.
    ("sourceButton.title=messages.fShowMarkdownSourceM(keyLabel('Mod+Shift+M'));sourceButton.dataset.shortcut='Mod+Shift+M';",
     "sourceButton.dataset.tip=messages.fShowMarkdownSource();sourceButton.dataset.shortcut=shortcuts.source;sourceButton.setAttribute('aria-keyshortcuts',ariaKeys(shortcuts.source));"),
    ("sourceButton.dataset.i18nTitle='fShowMarkdownSourceM';", "sourceButton.dataset.i18nTip='fShowMarkdownSource';"),
    # Start the tooltip; controls whose keys do their own action announce them.
    ("\napplyIcons();\n",
     "\napplyIcons();\n// The drawn tooltip replaces title. Controls whose keys do their own action announce them.\nattachTooltips();for(const el of $$('.topbar [data-shortcut],.drawer-head [data-shortcut]'))el.setAttribute('aria-keyshortcuts',ariaKeys(el.dataset.shortcut!));\n"),
    # A language change relabels the format buttons.
    ("for(const group of formatButtons())for(const [id,label,shortcut] of group){const button=$<HTMLButtonElement>('#format-bar [data-action='+id+']');button.setAttribute('aria-label',label);button.title=label+(shortcut?' '+shortcut:'')}",
     "for(const group of formatButtons())for(const [id,label] of group){const button=$<HTMLButtonElement>('#format-bar [data-action='+id+']');button.setAttribute('aria-label',label);button.dataset.tip=label}"),
]
for old, new in pairs:
    assert s.count(old) == 1, old
    s = s.replace(old, new)
# The insert button is labelled twice: when it is built and on a language change.
assert s.count("insertButton.title=messages.fInsert();") == 2
s = s.replace("insertButton.title=messages.fInsert();", "insertButton.dataset.tip=messages.fInsert();")
p.write_text(s)
EOF
grep -n "\.title=\|i18nTitle\|fShowMarkdownSourceM\|fNewDocumentN" src/app.ts src/index.html
```

Expected: 最后的 grep 只剩与工具栏无关的行（例如 `doc.title=`），没有 `fShowMarkdownSourceM`、`fNewDocumentN`、`i18nTitle`。

- [ ] **Step 10: 静态检查**

Run: `go tool mygo i18n check && node scripts/check-i18n.mjs && node_modules/.bin/tsc --noEmit && node scripts/check-editor.mjs`
Expected: 全部通过；tsc 无输出。

- [ ] **Step 11: 构建并运行浏览器回归，确认通过**

Run: `node scripts/build.mjs && scripts/e2e.sh check-toolbar && scripts/e2e.sh check-windows && scripts/e2e.sh check-english`
Expected: 三个都输出 `PASS: …`。

---

### Task 3: 接上格式快捷键

**Files:**
- Modify: `src/editor.ts`（keymap 那一行和它上面的注释）、`src/app.ts`（import、文档级按键处理、⌘K 列表、启动时的 `aria-keyshortcuts`）、`src/index.html`（第 4 行的标题菜单）
- Test: `scripts/check-toolbar.py`、`scripts/check-tables.py`、`scripts/check-images.py`、`scripts/check-windows.py`

**Interfaces:**
- Consumes: Task 1 的 `shortcuts`、`shortcutAction`、`ariaKeys`；`app.ts` 现有的 `action(id)`，它已经处理阅读模式、输入法组字、选中图片和表格单元格的限制。
- Produces: 文档级按键处理先问 `shortcutAction(e)`；标题菜单每项有 `<kbd data-keys="Mod+N" aria-hidden="true">` 和 `aria-keyshortcuts`。

- [ ] **Step 1: 先写测试** `scripts/check-toolbar.py`

（a）`check_format_bar` 里，把

```python
        expect(menu.get_by_role("menuitemradio")).to_have_text(["正文"] + [f"标题 {i}" for i in range(1, 7)])
```

换成

```python
        expect(menu.locator("[role=menuitemradio] > span")).to_have_text(["正文"] + [f"标题 {i}" for i in range(1, 7)])
```

文件末尾英文部分，把

```python
    expect(page.locator("#heading-menu [role=menuitemradio]")).to_have_text(["Body"] + [f"Heading {i}" for i in range(1, 7)])
```

换成

```python
    expect(page.locator("#heading-menu [role=menuitemradio] > span")).to_have_text(["Body"] + [f"Heading {i}" for i in range(1, 7)])
```

（b）在 `def settled(page):` 之前加一个函数：

```python
def check_format_shortcuts(page):
    """The format keys do what their toolbar buttons do, and nothing where the buttons do nothing."""
    with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
        more_action(page, "new")
    content = page.locator('.cm-content[contenteditable="true"]')

    def replace(text):
        content.focus()
        page.keyboard.press("Meta+a")
        page.keyboard.insert_text(text)

    def saved_text(text):
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        assert api(page, "State")["current"]["content"] == text, api(page, "State")["current"]["content"]

    # ⌘1–⌘6 set every selected line's level, as the heading menu does; ⌘0 returns to body text.
    replace("第一行\n第二行")
    page.keyboard.press("Meta+a")
    for level in (1, 2, 3, 4, 5, 6, 6):
        page.keyboard.press(f"Meta+{level}")
        saved_text("#" * level + " 第一行\n" + "#" * level + " 第二行")
    expect(page.locator("#heading-label")).to_have_text("标题 6")
    page.keyboard.press("Meta+0")
    saved_text("第一行\n第二行")
    # Inline formats wrap the selection, and the same key unwraps it.
    for keys, opening, closing in [("Meta+i", "_", "_"), ("Meta+Shift+X", "~~", "~~"), ("Meta+Shift+H", "==", "=="), ("Meta+e", "`", "`"), ("Meta+b", "**", "**"), ("Meta+u", "<u>", "</u>")]:
        replace("选中文字")
        page.keyboard.press("Meta+a")
        page.keyboard.press(keys)
        saved_text(opening + "选中文字" + closing)
        page.keyboard.press(keys)
        saved_text("选中文字")
    # Lists toggle on every selected line.
    for keys, first, second in [("Meta+Shift+7", "1. ", "2. "), ("Meta+Shift+8", "- ", "- "), ("Meta+Shift+9", "- [ ] ", "- [ ] ")]:
        replace("第一项\n第二项")
        page.keyboard.press("Meta+a")
        page.keyboard.press(keys)
        saved_text(first + "第一项\n" + second + "第二项")
        page.keyboard.press(keys)
        saved_text("第一项\n第二项")
    # Other modifiers do nothing: ⌘⇧E, ⌥⌘1 and, on macOS, ⌃1.
    replace("不变")
    page.keyboard.press("Meta+a")
    for keys in ("Meta+Shift+E", "Meta+Alt+1", "Control+1"):
        page.keyboard.press(keys)
    page.wait_for_timeout(300)
    saved_text("不变")
    # In a text field the keys belong to the field: ⌘B there no longer bolds the document.
    page.locator("#sidebar-button").click()
    search = page.locator("#recent-search")
    search.fill("搜索")
    for keys in ("Meta+1", "Meta+b", "Meta+Shift+7"):
        search.press(keys)
    expect(search).to_be_focused()
    expect(search).to_have_value("搜索")
    page.wait_for_timeout(300)
    saved_text("不变")
    search.fill("")
    page.keyboard.press("Escape")
    # Reading mode keeps the text and says how to get back.
    select_view(page, "read")
    page.keyboard.press("Meta+1")
    expect(page.locator("#toast")).to_contain_text("阅读模式下不能编辑")
    select_view(page, "single")
    saved_text("不变")
    # The heading menu and All Commands show the same keys.
    page.locator("#heading-button").click()
    expect(page.locator("#heading-menu [role=menuitemradio] kbd")).to_have_text(["⌘0"] + [f"⌘{i}" for i in range(1, 7)])
    expect(page.locator('#heading-menu [data-menu-action="h2"]')).to_have_attribute("aria-keyshortcuts", "Meta+2")
    expect(page.locator('#heading-menu [data-menu-action="h2"]')).to_have_accessible_name("标题 2")
    page.keyboard.press("Escape")
    content.focus()
    page.keyboard.press("Meta+k")
    for label, keys in [("斜体选中文字", "⌘ I"), ("删除线", "⌘ ⇧ X"), ("高亮", "⌘ ⇧ H"), ("行内代码", "⌘ E"), ("正文", "⌘ 0"), ("标题 1", "⌘ 1"), ("标题 6", "⌘ 6"), ("有序列表", "⌘ ⇧ 7"), ("无序列表", "⌘ ⇧ 8"), ("插入任务列表", "⌘ ⇧ 9")]:
        row = page.locator("#command-list .command").filter(has=page.locator("span", has_text=re.compile("^" + re.escape(label) + "$")))
        expect(row.locator("kbd")).to_have_text(keys)
    page.keyboard.press("Escape")
```

（c）在 `run(page)` 里，紧跟 `check_tooltips(page)` 加一行 `check_format_shortcuts(page)`。

- [ ] **Step 2: 表格、图片和 Windows 的测试**

`scripts/check-tables.py`：在工具栏循环（`for action, initial, expected in [('bold', '文字', '**文字**'), …]:` 那一段）结束之后、`source(page, TEXT)` 加插入引用之前，加：

```python
    # The new format keys work in a cell as its buttons do; heading and list keys leave the table alone.
    for keys, expected in [('Meta+i', '_文字_'), ('Meta+e', '`文字`'), ('Meta+Shift+X', '~~文字~~'), ('Meta+Shift+H', '==文字==')]:
        source(page, TEXT.replace('[链接](x)', '文字'))
        target = cell(page, 1, 1)
        target.click()
        page.keyboard.press('Meta+a')
        page.keyboard.press(keys)
        expect(target).to_be_focused()
        saved(page, TEXT.replace('[链接](x)', expected))
    original = TEXT.replace('[链接](x)', '文字')
    source(page, original)
    target = cell(page, 1, 1)
    target.click()
    for keys in ('Meta+1', 'Meta+0', 'Meta+Shift+7', 'Meta+Shift+8', 'Meta+Shift+9'):
        page.keyboard.press(keys)
    page.wait_for_timeout(300)
    expect(target).to_be_focused()
    saved(page, original)
```

`scripts/check-images.py`：在 `run()` 的 `for raw in forms:` 循环里，紧跟

```python
        page.keyboard.insert_text('不得输入')
        saved(page, text)
```

加：

```python
        for keys in ('Meta+i', 'Meta+e', 'Meta+Shift+X', 'Meta+Shift+H', 'Meta+1', 'Meta+Shift+7'):
            page.keyboard.press(keys)
        saved(page, text)
```

`scripts/check-windows.py`，`windows()` 里：

- 把 `assert "Ctrl+N" in keys and "F8" in keys and "Ctrl+Y" in keys, keys` 换成 `assert "Ctrl+N" in keys and "F8" in keys and "Ctrl+Y" in keys and "Ctrl+1" in keys and "Ctrl+Shift+7" in keys and "Ctrl+I" in keys, keys`。
- 在撤销/重做循环（`for redo in ["Control+y", "Control+Shift+Z"]:` 那一段）之后、`assert "Microsoft YaHei" in style(…)` 之前加：

```python
    # Headings, lists and inline formats on Ctrl. Ctrl+Alt is AltGr, and the Windows key is not Ctrl.
    def saved(text):
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        assert api(page, "State")["current"]["content"] == text, api(page, "State")["current"]["content"]
    page.keyboard.press("Control+a")
    page.keyboard.insert_text("平台标题")
    page.keyboard.press("Control+1")
    saved("# 平台标题")
    for keys in ("Control+Alt+2", "Meta+2"):
        page.keyboard.press(keys)
    page.wait_for_timeout(300)
    saved("# 平台标题")
    page.keyboard.press("Control+0")
    saved("平台标题")
    page.keyboard.press("Control+Shift+7")
    saved("1. 平台标题")
    page.keyboard.press("Control+Shift+7")
    saved("平台标题")
    page.keyboard.press("Control+a")
    page.keyboard.press("Control+i")
    saved("_平台标题_")
    expect(page.locator('#heading-menu [data-menu-action="paragraph"] kbd')).to_have_text("Ctrl+0")
    expect(page.locator('#heading-menu [data-menu-action="h6"] kbd')).to_have_text("Ctrl+6")
    expect(page.locator('#heading-menu [data-menu-action="h1"]')).to_have_attribute("aria-keyshortcuts", "Control+1")
```

`mac()` 里，把 `assert "⌘ N" in keys and "⌘ ⇧ F" in keys, keys` 换成 `assert "⌘ N" in keys and "⌘ ⇧ F" in keys and "⌘ 1" in keys and "⌘ ⇧ 7" in keys, keys`。

- [ ] **Step 3: 构建并运行，确认失败**

Run: `node scripts/build.mjs && scripts/e2e.sh check-toolbar`
Expected: FAIL，在 `check_format_bar` 的 `[role=menuitemradio] > span` 上失败（标题菜单还没有 span）。

- [ ] **Step 4: 编辑器去掉 ⌘I 的默认绑定** `src/editor.ts`

```bash
python3 - <<'EOF'
from pathlib import Path
p = Path('src/editor.ts'); s = p.read_text()
for old, new in [
    ("  // ⌘U underlines like the toolbar, so CodeMirror's undo-selection binding is dropped.",
     "  // ⌘U underlines and ⌘I italicizes like the toolbar, so CodeMirror's undo-selection and select-parent bindings are dropped."),
    ("...searchKeymap,...defaultKeymap,indentWithTab]", "...searchKeymap,...defaultKeymap.filter(binding=>binding.key!=='Mod-i'),indentWithTab]"),
]:
    assert s.count(old) == 1, old
    s = s.replace(old, new)
p.write_text(s)
EOF
```

- [ ] **Step 5: 标题菜单写上快捷键** `src/index.html`（只改 `#heading-menu`，块菜单的「转换为」不动）

```bash
python3 - <<'EOF'
from pathlib import Path
import re
p = Path('src/index.html'); s = p.read_text()
start = s.index('<div id="heading-menu"'); end = s.index('</div>', start)
def item(m):
    action, checked, key, text = m.groups()
    digit = '0' if action == 'paragraph' else action[1]
    return f'<button role="menuitemradio" data-menu-action="{action}" aria-checked="{checked}" tabindex="-1"><span data-i18n="{key}">{text}</span><kbd data-keys="Mod+{digit}" aria-hidden="true">⌘{digit}</kbd></button>'
menu, n = re.subn(r'<button role="menuitemradio" data-menu-action="(\w+)" aria-checked="(\w+)" tabindex="-1" data-i18n="(\w+)">([^<]+)</button>', item, s[start:end])
assert n == 7, n
p.write_text(s[:start] + menu + s[end:])
EOF
```

启动时已有的 `for(const kbd of $$('kbd[data-keys]'))…` 会按平台改写这些 `<kbd>`，不用另写。

- [ ] **Step 6: 按键处理、⌘K 列表和标题菜单的 ARIA** `src/app.ts`

```bash
python3 - <<'EOF'
from pathlib import Path
p = Path('src/app.ts'); s = p.read_text()
pairs = [
    ("import {shortcuts,ariaKeys} from './shortcuts';", "import {shortcuts,shortcutAction,ariaKeys} from './shortcuts';"),
    # The key handler asks shortcuts.ts first; ⌘B, ⌘U and ⌘L move there too.
    ("\n if(!(e.metaKey||e.ctrlKey)||!mac&&e.ctrlKey&&e.altKey)return;",
     "\n // Format keys come from shortcuts.ts; in a text field they belong to the field.\n if(!(e.metaKey||e.ctrlKey)||!mac&&e.ctrlKey&&e.altKey)return;"),
    ("if(document.querySelector('dialog[open]'))return;if(!mac&&k==='z'&&e.shiftKey)id='redo';if(k==='p')id='pdf';if(k==='l')id='link';if(k==='f'&&e.shiftKey)id='focus';if(k==='b')id='bold';if(k==='u')id='underline';if(k==='n')id='new';",
     "if(document.querySelector('dialog[open]'))return;const format=shortcutAction(e);if(format){if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement)return;e.preventDefault();void action(format);return}if(!mac&&k==='z'&&e.shiftKey)id='redo';if(k==='p')id='pdf';if(k==='f'&&e.shiftKey)id='focus';if(k==='n')id='new';"),
    # All Commands shows the same keys.
    ("['bold',messages.fBoldSelection(),kbd('Mod+B')],['italic',messages.fItalicizeSelection(),''],['paragraph',messages.fBody(),''],['h1',messages.fHeading1(),''],['h2',messages.fHeading2(),''],['h3',messages.fHeading3(),''],['h4',messages.fHeading4(),''],['h5',messages.fHeading5(),''],['h6',messages.fHeading6(),''],['underline',messages.fUnderline(),kbd('Mod+U')],['highlight',messages.fHighlight(),'']",
     "['bold',messages.fBoldSelection(),kbd(shortcuts.bold)],['italic',messages.fItalicizeSelection(),kbd(shortcuts.italic)],['paragraph',messages.fBody(),kbd(shortcuts.paragraph)],['h1',messages.fHeading1(),kbd(shortcuts.h1)],['h2',messages.fHeading2(),kbd(shortcuts.h2)],['h3',messages.fHeading3(),kbd(shortcuts.h3)],['h4',messages.fHeading4(),kbd(shortcuts.h4)],['h5',messages.fHeading5(),kbd(shortcuts.h5)],['h6',messages.fHeading6(),kbd(shortcuts.h6)],['underline',messages.fUnderline(),kbd(shortcuts.underline)],['highlight',messages.fHighlight(),kbd(shortcuts.highlight)]"),
    ("['strike',messages.fStrikethrough(),''],['inlineCode',messages.fInlineCode(),'']",
     "['strike',messages.fStrikethrough(),kbd(shortcuts.strike)],['inlineCode',messages.fInlineCode(),kbd(shortcuts.inlineCode)]"),
    ("['task',messages.fInsertTaskList(),'']", "['task',messages.fInsertTaskList(),kbd(shortcuts.task)]"),
    ("['link',messages.fInsertEditLink(),kbd('Mod+L')],['bullet',messages.fBulletedList(),''],['ordered',messages.fNumberedList(),'']",
     "['link',messages.fInsertEditLink(),kbd(shortcuts.link)],['bullet',messages.fBulletedList(),kbd(shortcuts.bullet)],['ordered',messages.fNumberedList(),kbd(shortcuts.ordered)]"),
    # Each heading menu item announces its key.
    ("el.setAttribute('aria-keyshortcuts',ariaKeys(el.dataset.shortcut!));\n",
     "el.setAttribute('aria-keyshortcuts',ariaKeys(el.dataset.shortcut!));\nfor(const item of $$('#heading-menu [data-menu-action]'))item.setAttribute('aria-keyshortcuts',ariaKeys(shortcuts[item.dataset.menuAction!]));\n"),
]
for old, new in pairs:
    assert s.count(old) == 1, old
    s = s.replace(old, new)
p.write_text(s)
EOF
```

- [ ] **Step 7: 静态检查和单元检查**

Run: `node_modules/.bin/tsc --noEmit && node scripts/check-i18n.mjs && node scripts/check-editor.mjs && bun scripts/check-shortcuts.ts && bun scripts/check-editing.ts && bun scripts/check-tables.ts`
Expected: 全部通过。

- [ ] **Step 8: 构建并运行浏览器回归，确认通过**

Run: `node scripts/build.mjs && scripts/e2e.sh check-toolbar && scripts/e2e.sh check-tables && scripts/e2e.sh check-images && scripts/e2e.sh check-windows && scripts/e2e.sh check-english`
Expected: 五个都输出 `PASS: …`。

---

### Task 4: 文档与全量验证

**Files:**
- Modify: `README.md`（第 29 行）、`README.en.md`（第 29 行）、`DESIGN.md`

- [ ] **Step 1: README 与 DESIGN.md**

```bash
python3 - <<'EOF'
from pathlib import Path
def edit(path, pairs):
    p = Path(path); s = p.read_text()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old)
        s = s.replace(old, new)
    p.write_text(s)
edit('README.md', [(
    '、`⌘P` 导出 PDF。Windows 上 ⌘ 换成 Ctrl、⇧ 即 Shift；',
    '、`⌘P` 导出 PDF。格式：`⌘1`–`⌘6` 标题 1–6、`⌘0` 正文、`⌘B` 加粗、`⌘I` 斜体、`⌘U` 下划线、`⌘⇧X` 删除线、`⌘⇧H` 高亮、`⌘E` 行内代码、`⌘⇧7` 有序列表、`⌘⇧8` 无序列表、`⌘⇧9` 任务列表；鼠标停在工具栏按钮上会显示它的名称和快捷键。Windows 上 ⌘ 换成 Ctrl、⇧ 即 Shift；')])
edit('README.en.md', [(
    ', `⌘P` export PDF. On Windows ⌘ is Ctrl and ⇧ is Shift;',
    ', `⌘P` export PDF. Formatting: `⌘1`–`⌘6` headings 1–6, `⌘0` body text, `⌘B` bold, `⌘I` italic, `⌘U` underline, `⌘⇧X` strikethrough, `⌘⇧H` highlight, `⌘E` inline code, `⌘⇧7` numbered list, `⌘⇧8` bulleted list, `⌘⇧9` task list; rest the pointer on a toolbar button to see its name and shortcut. On Windows ⌘ is Ctrl and ⇧ is Shift;')])
edit('DESIGN.md', [
    ('  menu-item-hover:\n    backgroundColor: "{colors.accent}"\n',
     '  menu-item-hover:\n    backgroundColor: "{colors.accent}"\n  tooltip:\n    backgroundColor: "{colors.popover}"\n    textColor: "{colors.foreground}"\n    typography: "{typography.label}"\n    rounded: "{rounded.lg}"\n    padding: "5px 8px"\n'),
    ('- **Image Tools** (`0 3px 12px #0002`): the image toolbar and the alt-text popover.',
     '- **Image Tools** (`0 3px 12px #0002`): the image toolbar, the alt-text popover and the tooltip.'),
    ('menus, dialogs, toasts, popovers and the floating sidebar.',
     'menus, dialogs, toasts, popovers, the tooltip and the floating sidebar.'),
    ('6px for standalone buttons, fields and code blocks;',
     '6px for standalone buttons, fields, code blocks and the tooltip;'),
    ('hover and focus take the hover fill; keyboard hints sit right-aligned in pencil.\n',
     'hover and focus take the hover fill; keyboard hints sit right-aligned in pencil.\n'
     '- **Tooltip:** one floating-paper layer for the chrome, with a 1px hairline, 6px radius, the Image Tools shadow and 5px 8px padding. The name is 12px ink and the keys sit right-aligned in pencil, as in the menus; at most 320px wide. It sits 6px under its control, centred, or above it where the window ends first, and stays 8px inside the window. It appears once the pointer has rested 500ms, moves from control to control at once for 800ms after the last one closed, shows at once on keyboard focus, and never fades. A press, Escape, scrolling or the control\'s menu opening hides it. Controls declare it with `data-tip` and `data-shortcut`, never `title`.\n'),
])
EOF
```

- [ ] **Step 2: 全量验证**（每条记下结果；失败的按 Global Constraints 处理）

```bash
gofmt -l . | grep -v '^node_modules/' ; go vet ./... && go test ./...
go tool mygo i18n check && node scripts/check-i18n.mjs && node_modules/.bin/tsc --noEmit && node scripts/check-editor.mjs
node scripts/build.mjs
for f in shortcuts platform capture-input editing rendering paste slash blocks tables images marks math mermaid extras docx theme preview; do bun scripts/check-$f.ts || echo "FAIL check-$f"; done
bun scripts/check-performance.ts || PERF_BUDGET_SCALE=2 bun scripts/check-performance.ts
for c in check-toolbar check-windows check-english check-tables check-images check-blocks check-split-preview check-themes check-outline check-reader check-extras; do scripts/e2e.sh $c || echo "FAIL $c"; done
git status --short
```

Expected:
- `gofmt -l` 无输出，`go vet`、`go test` 通过（含 `TestStartupBundleStaysSmall`）。
- i18n、tsc、check-editor 通过。
- 循环里的 17 个 bun 单元检查都通过。
- 性能检查通过；如果只有在 `PERF_BUDGET_SCALE=2` 下才通过，在报告里写明。
- 11 个浏览器回归都输出 `PASS`。
- `git status` 只列出本计划的文件清单里的文件和 `web/` 下的构建产物。

- [ ] **Step 3: 写报告**（traecli 的 `-o` 输出文件）

报告包括：
- 改动的文件清单；
- 每条验证命令和结果，失败时附最后 30 行输出；
- 与本计划不一致的地方，以及原因；
- 没能验证的部分。

---

### Task 5: 审查后的修正（2026-10-26）

Claude 和 Codex 审查 Task 1–4 后发现：表格菜单里的格式快捷键会改到表格背后的 Markdown；Enter 打开侧栏后提示还留着；Esc 关菜单后提示又冒出来；计时断言依赖机器调度；平台和英文检查没断言提示可见；`check-math`、`check-mermaid` 还在断言已经去掉的 `title`。5A 和 5B 改的文件互不重叠，可以分开做。

#### 5A：提示层的键盘规则和测试（traecli，原 worktree）

**Files:** Modify `src/tooltip.ts`、`scripts/check-toolbar.py`、`scripts/check-windows.py`

- [ ] **Step 1: 先改测试** `scripts/check-toolbar.py`

（a）在 `check_tooltips` 里删掉实时计时那一段：从注释 `# A resting pointer waits about 500ms; then the tooltip follows it along the bar at once.` 这一行起（含这一行），到 `assert 450 <= delay <= 2000, delay` 为止，整段换成

```python
    # The timing itself is checked on a controlled clock in check_tooltip_timing.
    page.mouse.move(5, 500)
    bold = bar.locator('[data-action="bold"]')
    bold.hover()
    expect(tip).to_be_visible()
```

并把该函数里所有 `timeout=300` 参数去掉（用默认超时）。

（b）在 `check_tooltips` 的键盘那一段（以 `page.locator(".cm-content").focus()` 和 `expect(tip).to_be_hidden()` 结束）之后加：

```python
    # Enter and Escape hide it, and the focus they hand back does not bring it back.
    page.locator("#doc-title").focus()
    page.keyboard.press("Shift+Tab")
    expect(page.locator("#sidebar-button")).to_be_focused()
    expect(tip).to_be_visible()
    expect(name).to_have_text("侧栏：最近文稿")
    page.keyboard.press("Enter")
    expect(page.locator("#drawer")).to_be_visible()
    expect(tip).to_be_hidden()
    page.keyboard.press("Escape")
    expect(page.locator("#drawer")).to_be_hidden()
    expect(page.locator("#sidebar-button")).to_be_focused()
    page.wait_for_timeout(300)
    expect(tip).to_be_hidden()
    heading = page.locator("#heading-button")
    heading.focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")
    expect(heading).to_be_focused()
    expect(tip).to_be_visible()
    expect(name).to_have_text("标题级别")
    page.keyboard.press("Enter")
    expect(page.locator("#heading-menu")).to_be_visible()
    expect(tip).to_be_hidden()
    page.keyboard.press("Escape")
    expect(heading).to_be_focused()
    page.wait_for_timeout(300)
    expect(tip).to_be_hidden()
    assert heading.get_attribute("aria-describedby") is None
    # A control removed under the tooltip takes the tooltip with it.
    page.evaluate("""() => { const b = document.createElement('button'); b.id = 'tip-gone'; b.dataset.tip = '临时'; b.textContent = '临'; b.style.cssText = 'position:fixed;left:300px;top:300px'; document.body.append(b) }""")
    page.mouse.move(5, 500)
    page.locator("#tip-gone").hover()
    expect(tip).to_be_visible()
    page.evaluate("document.querySelector('#tip-gone').remove()")
    page.mouse.move(310, 330)
    page.mouse.move(320, 340)
    expect(tip).to_be_hidden()
```

（c）在 `def check_tooltips(page):` 之前加：

```python
def check_tooltip_timing(browser):
    """The tooltip's timing on a controlled clock: 500ms to appear, at once along the bar, 800ms of warmth after it closes."""
    context = browser.new_context(locale="zh-CN", viewport={"width": 1120, "height": 820})
    page = context.new_page()
    page.clock.install()
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    tip, name = page.locator("#tooltip"), page.locator("#tooltip span")

    def centre(action):
        box = page.locator(f'#format-bar [data-action="{action}"]').bounding_box()
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    bold, italic, footnote = centre("bold"), centre("italic"), centre("footnote")
    page.mouse.move(5, 500)
    page.clock.pause_at(page.evaluate("Date.now()") + 1000)
    page.mouse.move(*bold)
    page.clock.run_for(499)
    expect(tip).to_be_hidden()
    page.clock.run_for(1)
    expect(tip).to_be_visible()
    expect(name).to_have_text("加粗")
    # Along the bar it follows at once: no time passes.
    page.mouse.move(*italic)
    expect(tip).to_be_visible()
    expect(name).to_have_text("斜体")
    page.mouse.move(5, 500)
    expect(tip).to_be_hidden()
    page.clock.run_for(799)
    page.mouse.move(*footnote)
    expect(tip).to_be_visible()
    expect(name).to_have_text("脚注")
    page.mouse.move(5, 500)
    page.clock.run_for(800)
    page.mouse.move(*bold)
    page.clock.run_for(499)
    expect(tip).to_be_hidden()
    page.clock.run_for(1)
    expect(tip).to_be_visible()
    context.close()
```

在 `run(page)` 里紧跟 `check_tooltips(page)` 加一行 `check_tooltip_timing(page.context.browser)`。

（d）文件末尾英文部分的两次悬停，每次在检查文字之前加 `expect(page.locator("#tooltip")).to_be_visible()`，并断言对应按钮 `to_have_attribute("aria-describedby", "tooltip")`。

- [ ] **Step 2: Windows 检查** `scripts/check-windows.py`：`windows()` 里提示循环的每次悬停之后、检查文字之前加 `expect(page.locator("#tooltip")).to_be_visible()` 和 `expect(page.locator(selector)).to_have_attribute("aria-describedby", "tooltip")`；`mac()` 里悬停重做按钮之后加 `expect(page.locator("#tooltip")).to_be_visible()`。

- [ ] **Step 3: 构建并运行，确认失败**

Run: `node scripts/build.mjs && scripts/e2e.sh check-toolbar`
Expected: FAIL，在 Enter 打开侧栏后的 `expect(tip).to_be_hidden()` 上失败（旧代码只在 Esc 时收起提示）。

- [ ] **Step 4: 改** `src/tooltip.ts`

- 第 4 行注释换成：`// The pointer waits 500ms; within 800ms of the last tooltip the next control shows at once. Moving focus with Tab or the arrow keys shows it at once; any other key hides it, so Escape or Enter never brings it back on the focus they hand back.`
- 第 5 行换成：`const delay=500,warm=800,navigation=['Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'],modifiers=['Shift','Control','Alt','Meta','CapsLock'];`
- `let` 那一行末尾加 `,navigating=false`。
- 计时一律改用 `Date.now()`（Playwright 的可控时钟一定接管它）：`closed=performance.now()` 改成 `closed=Date.now()`，`performance.now()-closed<warm` 改成 `Date.now()-closed<warm`。
- 在 `function close(){…}` 之后加一行：

```ts
 // A control re-rendered under the tooltip leaves no event behind, so the tooltip goes with it.
 const stale=()=>{if(shown&&!shown.isConnected)close()};
```

- `pointerover` 和 `pointerout` 两个处理函数的第一句都加上 `stale();`。
- `focusin` 那一行换成：`document.addEventListener('focusin',e=>{const el=control(e.target);if(navigating&&el?.matches(':focus-visible'))open(el)});`
- `keydown` 那一行换成：

```ts
 // Any key but a modifier hides it; only focus moved by Tab, the arrows, Home or End shows it again.
 document.addEventListener('keydown',e=>{if(modifiers.includes(e.key))return;close();navigating=navigation.includes(e.key);setTimeout(()=>{navigating=false})},true);
```

- [ ] **Step 5: 运行，确认通过**

Run: `node_modules/.bin/tsc --noEmit && node scripts/build.mjs && scripts/e2e.sh check-toolbar && scripts/e2e.sh check-windows && scripts/e2e.sh check-english`
Expected: 三个都输出 `PASS`。

#### 5B：菜单和编辑区按钮里不响应格式快捷键，修好旧断言（Codex，第二个 worktree）

**Files:** Modify `src/app.ts`、`scripts/check-tables.py`、`scripts/check-math.py`、`scripts/check-mermaid.py`

- [ ] **Step 1: 先改测试**

`scripts/check-tables.py`：在 Task 3 加的「heading and list keys leave the table alone」那一段（以 `saved(page, original)` 结束）之后加：

```python
    # In the table's menu, and on its ⋯ button, the format keys do nothing: the Markdown behind the table is not theirs.
    source(page, TEXT)
    cell(page, 1, 1).click()
    page.keyboard.press('Meta+/')
    expect(page.locator('.table-menu:not([hidden])')).to_be_visible()
    for keys in ('Meta+1', 'Meta+b', 'Meta+i', 'Meta+Shift+7'):
        page.keyboard.press(keys)
    page.keyboard.press('Escape')
    expect(page.locator('.table-menu-button')).to_be_focused()
    for keys in ('Meta+1', 'Meta+b', 'Meta+Shift+8'):
        page.keyboard.press(keys)
    page.wait_for_timeout(300)
    saved(page, TEXT)
```

`scripts/check-math.py`：`expect(button).to_have_attribute('title', '公式')` 换成 `expect(button).to_have_attribute('data-tip', '公式')`；`expect(page.locator('#format-bar [data-action="math"]')).to_have_attribute('title', 'Formula')` 换成同一行的 `'data-tip', 'Formula'`。

`scripts/check-mermaid.py`：`expect(button).to_have_attribute('title', '图表')` 换成 `'data-tip', '图表'`；`expect(page.locator('#format-bar [data-action="mermaid"]')).to_have_attribute('title', 'Diagram')` 换成 `'data-tip', 'Diagram'`。

- [ ] **Step 2: 改** `src/app.ts` 的文档级按键处理

- 注释 `// Format keys come from shortcuts.ts; in a text field they belong to the field.` 换成 `// Format keys come from shortcuts.ts. In a text field, a menu or a control inside the editor (a table's ⋯ button) they belong to that control, not to the document.`
- `if(format){if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement)return;` 换成 `if(format){if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement||e.target instanceof Element&&e.target.closest('[role=menu],.cm-editor button'))return;`

- [ ] **Step 3: 静态检查和构建**

Run: `node_modules/.bin/tsc --noEmit && node scripts/check-i18n.mjs && bun scripts/check-shortcuts.ts && node scripts/build.mjs`
Expected: 全部通过。浏览器回归（check-tables、check-math、check-mermaid、check-toolbar）由 Claude 合并后统一运行。
