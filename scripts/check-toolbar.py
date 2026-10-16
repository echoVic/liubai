"""Browser regression for the approved toolbar. Use an isolated --data-dir.

python3 scripts/check-toolbar.py http://127.0.0.1:4197
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import json
import os
from pathlib import Path
import re
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4197"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-toolbar-qa-"))
TEXT = "# 一\n\n第一段。\n\n## 二\n\n第二段。"


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok, response.text()
    body = response.json()
    assert not body.get("error"), body
    return body["value"]


def appearance_change(page, operation):
    with page.expect_response(lambda r: r.url.endswith("/api") and '"Appearance"' in (r.request.post_data or "")) as pending:
        operation()
    assert not pending.value.json().get("error"), pending.value.text()


def select_view(page, view):
    appearance_change(page, lambda: page.locator(f'[data-view="{view}"]').click())
    assert_view(page, view)


def assert_view(page, view):
    expect(page.locator('.view-switch [aria-checked="true"]')).to_have_count(1)
    expect(page.locator(f'[data-view="{view}"]')).to_have_attribute("aria-checked", "true")
    assert page.locator('.view-switch button').evaluate_all("els => els.filter(el => el.tabIndex === 0).map(el => el.dataset.view)") == [view]
    assert api(page, "State")["appearance"]["layout"] == view


def more_action(page, action):
    page.locator("#more-button").click()
    page.locator(f'#more-menu [data-menu-action="{action}"]').click()


def accessible_buttons(page):
    for button in page.locator('.topbar button:visible, #format-bar button:visible, #heading-menu button:visible, #drawer button:visible, #more-menu button:visible').all():
        expect(button).to_have_accessible_name(re.compile(r"\S"))
        # SVG-only controls and the × recent-removal control need tooltips.
        if button.locator("svg").count() and not button.inner_text().strip() or button.inner_text().strip() == "×":
            assert button.get_attribute("title"), button.evaluate("el => el.outerHTML")


def check_format_bar(page):
    bar = page.locator("#format-bar")
    heading = page.locator("#heading-button")
    menu = page.locator("#heading-menu")
    source = bar.locator('[data-action="source"]')
    source_item = page.locator('#more-menu [data-menu-action="source"]')
    expect(bar).to_have_attribute("role", "toolbar")
    expect(bar).to_have_attribute("aria-label", "格式")
    order = bar.evaluate("el => [...el.children].map(el => el.classList.contains('format-sep') ? '|' : el.dataset.action || el.id)")
    assert order == ["heading-button", "|", "bold", "italic", "strike", "inlineCode", "|", "quote", "bullet", "ordered", "task", "|", "link", "image", "table", "code", "source"], order
    for separator in bar.locator(".format-sep").all():
        expect(separator).to_have_attribute("aria-hidden", "true")
    expect(heading).to_have_attribute("title", "标题级别")
    expect(heading).to_have_attribute("aria-haspopup", "menu")
    expect(bar.locator('[data-action="bold"]')).to_have_attribute("title", "加粗 ⌘B")
    expect(bar.locator('[data-action="link"]')).to_have_attribute("title", "链接 ⌘L")
    expect(source).to_have_text("源码")
    expect(source).to_have_attribute("title", "显示 Markdown 源码 ⌘⇧M")
    expect(source).to_be_hidden()
    expect(page.locator("#source-button, .source-toggle, .paper-top button")).to_have_count(0)
    expect(bar.locator('[data-action="image"]')).to_have_count(1)
    icons = bar.locator("button.tool").evaluate_all("els => els.map(el => ({action:el.dataset.action, svg:el.querySelector('svg').outerHTML}))")
    assert len(icons) == 12
    assert len({item["svg"] for item in icons}) == len(icons), icons
    assert bar.locator("button.tool").evaluate_all("els => els.every(el => el.getAttribute('aria-label') && getComputedStyle(el).width === '32px' && getComputedStyle(el).height === '32px')")
    accessible_buttons(page)

    with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
        more_action(page, "new")
    content = page.locator('.cm-content[contenteditable="true"]')
    # An empty document shows only the CodeMirror placeholder.
    expect(page.locator(".cm-placeholder")).to_be_visible()
    content.focus()
    page.keyboard.insert_text("格式测试")
    for action, text, label in [("h1", "# 格式测试", "标题 1"), ("h3", "### 格式测试", "标题 3"), ("paragraph", "格式测试", "正文")]:
        heading.click()
        expect(menu).to_be_visible()
        expect(menu.get_by_role("menuitemradio")).to_have_text(["正文", "标题 1", "标题 2", "标题 3"])
        # Dropdowns on the left half open left-aligned under their button.
        button_box, menu_box = heading.bounding_box(), menu.bounding_box()
        assert abs(menu_box["x"] - button_box["x"]) <= 1 and menu_box["y"] >= button_box["y"] + button_box["height"], (button_box, menu_box)
        expect(menu.locator('[aria-checked="true"]')).to_have_count(1)
        accessible_buttons(page)
        menu.locator(f'[data-menu-action="{action}"]').click()
        expect(menu).to_be_hidden()
        expect(content).to_be_focused()
        expect(content).to_have_text(text)
        expect(heading).to_have_text(label)
        expect(menu.locator(f'[data-menu-action="{action}"]')).to_have_attribute("aria-checked", "true")
    # Radio items use the shared menu's full keyboard navigation and dismissal.
    heading.focus()
    page.keyboard.press("ArrowDown")
    expect(menu.get_by_role("menuitemradio", name="正文", exact=True)).to_be_focused()
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    expect(content).to_have_text("### 格式测试")
    expect(content).to_be_focused()
    heading.click()
    page.keyboard.press("Escape")
    expect(heading).to_be_focused()
    expect(menu).to_be_hidden()

    content.focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("# 标题行\n正文行")
    expect(heading).to_have_text("正文")
    page.keyboard.press("Meta+Home")
    expect(heading).to_have_text("标题 1")
    page.keyboard.press("Meta+End")
    expect(heading).to_have_text("正文")
    for action, marker in [("strike", "~~"), ("inlineCode", "`")]:
        page.keyboard.press("Meta+a")
        page.keyboard.insert_text("选中文字")
        page.keyboard.press("Meta+a")
        bar.locator(f'[data-action="{action}"]').click()
        expect(content).to_be_focused()
        expect(content).to_have_text(marker + "选中文字" + marker)
        bar.locator(f'[data-action="{action}"]').click()
        expect(content).to_have_text("选中文字")

    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("# 源码测试\n\n**格式标记**\n\n正文")
    page.keyboard.press("Meta+End")
    expect(page.locator(".cm-content .cm-line").first).not_to_contain_text("# ")
    select_view(page, "split")
    expect(source).to_be_visible()
    expect(source).to_have_attribute("aria-pressed", "false")
    appearance_change(page, lambda: source.click())
    expect(source).to_have_attribute("aria-pressed", "true")
    expect(source_item).to_have_attribute("aria-checked", "true")
    expect(page.locator(".cm-content .cm-line").first).to_have_text("# 源码测试")
    expect(content).to_contain_text("**格式标记**")
    appearance_change(page, lambda: source.click())
    expect(source).to_have_attribute("aria-pressed", "false")
    expect(source_item).to_have_attribute("aria-checked", "false")
    expect(page.locator(".cm-content .cm-line").first).not_to_contain_text("# ")
    select_view(page, "read")
    expect(bar).to_be_hidden()
    select_view(page, "single")
    expect(source).to_be_hidden()


def check_writing_sheet(page):
    def new_document():
        with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
            more_action(page, "new")
        expect(page.locator(".cm-placeholder")).to_be_visible()

    def settled():
        page.evaluate("async () => {await document.fonts.ready;await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))}")

    def geometry():
        return page.evaluate("""() => {
          const pane=document.querySelector('.editor-pane'), paper=document.querySelector('.paper'), footer=document.querySelector('.paper-bottom');
          const p=pane.getBoundingClientRect(), r=paper.getBoundingClientRect(), f=footer.getBoundingClientRect();
          return {paperBottom:r.bottom,paperHeight:r.height,footerTop:f.top,footerBottom:f.bottom,
            contentBottom:p.top+pane.clientTop+pane.clientHeight-parseFloat(getComputedStyle(pane).paddingBottom),
            scrollHeight:pane.scrollHeight,clientHeight:pane.clientHeight};
        }""")

    def desk_width(selector):
        return page.locator(selector).evaluate("""el => {
          const desk=document.querySelector('.desk'), style=getComputedStyle(desk);
          return {width:el.getBoundingClientRect().width,deskWidth:desk.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};
        }""")

    select_view(page, "single")
    new_document()
    for width, height in ((1700, 1100), (1120, 820)):
        page.set_viewport_size({"width": width, "height": height})
        settled()
        g = geometry()
        assert abs(g["paperBottom"] - g["contentBottom"]) <= 2, g
        assert g["paperBottom"] - 80 <= g["footerTop"] < g["footerBottom"] <= g["paperBottom"], g
        assert g["scrollHeight"] == g["clientHeight"], g

    page.set_viewport_size({"width": 1700, "height": 1100})
    content = page.locator('.cm-content[contenteditable="true"]')
    content.focus()
    page.keyboard.insert_text("第一行\n第二行\n第三行")
    expect(content.locator(".cm-line")).to_have_text(["第一行", "第二行", "第三行"])
    page.keyboard.press("Meta+Home")
    settled()
    page.locator('[data-action="theme"]').focus()
    footer = page.locator(".paper-bottom").bounding_box()
    page.mouse.click(footer["x"] + footer["width"] / 2, footer["y"] - 60)
    expect(content).to_be_focused()
    page.keyboard.insert_text("尾")
    expect(content.locator(".cm-line")).to_have_text(["第一行", "第二行", "第三行尾"])
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    assert api(page, "State")["current"]["content"] == "第一行\n第二行\n第三行尾"
    g = geometry()
    assert g["scrollHeight"] == g["clientHeight"], g

    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("\n".join(f"长文第{i}行" for i in range(1, 121)))
    page.locator(".paper-bottom").scroll_into_view_if_needed()
    last = content.locator(".cm-line", has_text=re.compile("^长文第120行$"))
    expect(last).to_be_visible()
    settled()
    g = geometry()
    assert g["paperHeight"] > g["clientHeight"] and g["scrollHeight"] > g["clientHeight"], g
    line = last.bounding_box()
    assert g["footerTop"] >= line["y"] + line["height"], (g, line)

    new_document()
    page.locator('[data-action="theme"]').click()
    expect(page.locator('#line-width option[value="full"]')).to_have_text("全宽")
    appearance_change(page, lambda: page.locator("#line-width").select_option(label="全宽"))
    page.keyboard.press("Escape")
    settled()
    g = desk_width(".paper")
    assert abs(g["width"] - g["deskWidth"]) <= 2, g
    for selector in (".desk-caption", ".desk-bottom"):
        g = desk_width(selector)
        assert abs(g["width"] - g["deskWidth"]) <= 2, (selector, g)
    assert api(page, "State")["appearance"]["lineWidth"] == "full"
    page.reload()
    expect(content).to_be_visible()
    settled()
    g = desk_width(".paper")
    assert abs(g["width"] - g["deskWidth"]) <= 2, g
    page.locator('[data-action="theme"]').click()
    expect(page.locator("#line-width")).to_have_value("full")
    page.keyboard.press("Escape")
    select_view(page, "read")
    settled()
    for selector in ("#preview", ".read-layout .markdown-document"):
        g = desk_width(selector)
        # The reading document is inside the preview's 1px borders.
        assert abs(g["width"] - g["deskWidth"]) <= 2, (selector, g)
    select_view(page, "split")
    settled()
    split_width = page.locator(".paper").bounding_box()["width"]
    page.locator('[data-action="theme"]').click()
    appearance_change(page, lambda: page.locator("#line-width").select_option(label="舒适"))
    page.keyboard.press("Escape")
    settled()
    assert abs(page.locator(".paper").bounding_box()["width"] - split_width) <= 2
    select_view(page, "single")
    settled()
    assert abs(page.locator(".paper").bounding_box()["width"] - 760) <= 2
    page.locator('[data-action="theme"]').click()
    appearance_change(page, lambda: page.locator("#line-width").select_option(label="宽阔"))
    page.keyboard.press("Escape")
    settled()
    assert abs(page.locator(".paper").bounding_box()["width"] - 920) <= 2
    page.locator('[data-action="theme"]').click()
    appearance_change(page, lambda: page.locator("#line-width").select_option(label="舒适"))
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 1120, "height": 820})


def check_split_columns(page):
    select_view(page, "split")
    for width, height in ((1700, 1100), (1120, 820)):
        page.set_viewport_size({"width": width, "height": height})
        page.evaluate("async () => {await document.fonts.ready;await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))}")
        g = page.evaluate("""() => {
          const pane=document.querySelector('.editor-pane'), paper=document.querySelector('.paper'), footer=document.querySelector('.paper-bottom');
          const p=pane.getBoundingClientRect(), r=paper.getBoundingClientRect(), f=footer.getBoundingClientRect();
          return {pane:p.width,preview:document.querySelector('#preview').getBoundingClientRect().width,paper:r.width,
            paperBottom:r.bottom,footerBottom:f.bottom,text:document.querySelector('.cm-content').getBoundingClientRect().width,
            contentBottom:p.top+pane.clientTop+pane.clientHeight-parseFloat(getComputedStyle(pane).paddingBottom),
            scroll:pane.scrollHeight-pane.clientHeight};
        }""")
        # Editor and reading view share the width; the sheet fills its column and its height.
        assert abs(g["pane"] - g["preview"]) <= 2 and abs(g["paper"] - g["pane"]) <= 2, g
        assert abs(g["paperBottom"] - g["contentBottom"]) <= 2 and g["paperBottom"] - 80 <= g["footerBottom"] <= g["paperBottom"], g
        assert g["scroll"] == 0, g
        if width == 1700:
            # 舒适 still caps the text inside the wider column.
            assert g["text"] <= 760 - 100 + 2, g
    page.set_viewport_size({"width": 1120, "height": 820})
    select_view(page, "single")


def run(page):
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    order = page.locator(".topbar button").evaluate_all("els => els.map(el => el.id || el.dataset.view || el.dataset.action)")
    assert order == ["sidebar-button", "doc-title", "single", "split", "read", "theme", "deliver", "more-button"], order
    assert page.locator(".view-switch button").all_text_contents() == ["编辑", "分栏", "阅读"]
    expect(page.locator('.view-switch')).to_have_attribute("role", "radiogroup")
    expect(page.locator('.view-switch')).to_have_attribute("aria-label", "视图")
    expect(page.locator('.view-switch [role="radio"]')).to_have_count(3)
    accessible_buttons(page)
    icons = page.locator('.topbar button, .drawer-head button, #format-bar button').evaluate_all("""els => els.filter(el => el.querySelector('svg')).map(el => ({
      action:el.dataset.action || el.dataset.close || el.id, svg:el.querySelector('svg').outerHTML
    }))""")
    for i, first in enumerate(icons):
        for second in icons[i + 1:]:
            assert first["action"] == second["action"] or first["svg"] != second["svg"], (first, second)

    check_format_bar(page)
    check_writing_sheet(page)
    check_split_columns(page)

    # Use the real New action and autosave before checking sidebar headings/recent.
    with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
        more_action(page, "new")
    page.locator('.cm-content[contenteditable="true"]').click()
    page.keyboard.insert_text(TEXT)
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    title = page.locator("#doc-title").inner_text()

    select_view(page, "split")
    expect(page.locator("#preview")).to_be_visible()
    select_view(page, "read")
    expect(page.locator("#format-bar")).to_be_hidden()
    expect(page.locator(".editor-pane")).to_be_hidden()
    select_view(page, "single")
    expect(page.locator(".editor-pane")).to_be_visible()
    expect(page.locator("#preview")).to_be_hidden()
    appearance_change(page, lambda: page.keyboard.press("Meta+\\"))
    assert_view(page, "split")
    appearance_change(page, lambda: page.keyboard.press("Meta+Shift+R"))
    assert_view(page, "read")
    appearance_change(page, lambda: page.keyboard.press("Meta+Shift+R"))
    assert_view(page, "split")
    page.locator('[data-view="split"]').focus()
    appearance_change(page, lambda: page.keyboard.press("ArrowLeft"))
    assert_view(page, "single")
    expect(page.locator('[data-view="single"]')).to_be_focused()
    appearance_change(page, lambda: page.keyboard.press("ArrowRight"))
    assert_view(page, "split")
    appearance_change(page, lambda: page.keyboard.press("ArrowRight"))
    assert_view(page, "read")
    appearance_change(page, lambda: page.keyboard.press("ArrowRight"))
    assert_view(page, "single")
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    assert_view(page, "single")

    sidebar = page.locator("#sidebar-button")
    drawer = page.locator("#drawer")
    sidebar.click()
    expect(drawer).to_be_visible()
    expect(sidebar).to_have_attribute("aria-expanded", "true")
    expect(page.locator('[data-tab="recent"]')).to_have_attribute("aria-selected", "true")
    accessible_buttons(page)
    sidebar.click()
    expect(drawer).to_be_hidden()
    expect(sidebar).to_have_attribute("aria-expanded", "false")
    sidebar.click()
    page.locator('[data-tab="outline"]').click()
    expect(page.locator('[data-tab="outline"]')).to_have_attribute("aria-selected", "true")
    expect(page.locator('[data-tab="recent"]')).to_have_attribute("aria-selected", "false")
    expect(page.locator("#drawer-list")).to_have_attribute("role", "tabpanel")
    expect(page.locator("#recent-search")).to_be_hidden()
    expect(page.locator(".drawer-open")).to_be_hidden()
    expect(page.locator(".outline-item")).to_have_text(["一", "二"])
    page.locator(".outline-item", has_text="二").click()
    page.wait_for_function("""() => {
      const node=getSelection()?.anchorNode;
      return node?.parentElement?.closest('.cm-line')?.textContent.includes('二');
    }""")
    # Verify the actual CodeMirror selection via the separately persisted position.
    page.wait_for_function("""async ({base, anchor}) => {
      const r=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'State',args:[]})});
      return (await r.json()).value.current.position.anchor===anchor;
    }""", arg={"base": BASE, "anchor": TEXT.index("## 二")})
    page.keyboard.press("Escape")
    expect(drawer).to_be_hidden()
    expect(sidebar).to_have_attribute("aria-expanded", "false")
    sidebar.click()
    expect(page.locator('[data-tab="outline"]')).to_have_attribute("aria-selected", "true")
    page.locator('[data-tab="recent"]').click()
    expect(page.locator("#recent-search")).to_be_visible()
    expect(page.locator(".drawer-open")).to_be_visible()
    expect(page.locator(".recent-item b", has_text=title)).to_have_count(1)
    accessible_buttons(page)
    page.locator('[data-close="drawer"]').click()
    expect(sidebar).to_have_attribute("aria-expanded", "false")

    more = page.locator("#more-button")
    menu = page.locator("#more-menu")
    first = menu.locator('[data-menu-action="new"]')
    source = menu.locator('[data-menu-action="source"]')
    focus = menu.locator('[data-menu-action="focus"]')
    more.click()
    expect(menu).to_be_visible()
    expect(more).to_have_attribute("aria-expanded", "true")
    expect(first).to_be_focused()
    # Dropdowns on the right half open right-aligned under their button.
    button_box, menu_box = more.bounding_box(), menu.bounding_box()
    assert abs((menu_box["x"] + menu_box["width"]) - (button_box["x"] + button_box["width"])) <= 1 and menu_box["y"] >= button_box["y"] + button_box["height"], (button_box, menu_box)
    accessible_buttons(page)
    expect(source).to_have_attribute("aria-disabled", "true")
    expect(source).to_contain_text("仅分栏可用")
    page.keyboard.press("ArrowDown")
    expect(menu.locator('[data-menu-action="open"]')).to_be_focused()
    page.keyboard.press("End")
    expect(menu.locator('[data-menu-action="commands"]')).to_be_focused()
    page.keyboard.press("ArrowUp")
    expect(menu.locator('[data-menu-action="captureSettings"]')).to_be_focused()
    page.keyboard.press("ArrowUp")  # Skip disabled source.
    expect(focus).to_be_focused()
    page.keyboard.press("Home")
    expect(first).to_be_focused()
    page.keyboard.press("Escape")
    expect(menu).to_be_hidden()
    expect(more).to_have_attribute("aria-expanded", "false")
    expect(more).to_be_focused()
    for key in ("Enter", "Space", "ArrowDown"):
        page.keyboard.press(key)
        expect(first).to_be_focused()
        page.keyboard.press("Escape")
    more.click()
    page.locator("#document-kind").click()
    expect(menu).to_be_hidden()
    expect(more).to_have_attribute("aria-expanded", "false")
    more.click()
    page.keyboard.press("Tab")
    expect(menu).to_be_hidden()

    select_view(page, "read")
    more.click()
    expect(focus).to_have_attribute("aria-disabled", "true")
    expect(source).to_have_attribute("aria-disabled", "true")
    page.keyboard.press("Escape")
    select_view(page, "split")
    more.click()
    expect(source).to_have_attribute("aria-disabled", "false")
    expect(source.locator("small")).to_be_hidden()
    previous = source.get_attribute("aria-checked")
    source.focus()
    appearance_change(page, lambda: page.keyboard.press("Space"))
    expect(menu).to_be_hidden()
    more.click()
    expect(source).to_have_attribute("aria-checked", "false" if previous == "true" else "true")
    page.keyboard.press("Escape")
    expect(page.locator('#format-bar [data-action="source"]')).to_have_attribute("aria-pressed", "false" if previous == "true" else "true")
    more_action(page, "focus")
    expect(page.locator("body")).to_have_class(re.compile("focus-mode"))
    page.keyboard.press("Escape")
    expect(page.locator("body")).not_to_have_class(re.compile("focus-mode"))
    more.click()
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    expect(page.locator("#commands")).to_be_visible()
    expect(page.locator("#commands")).to_have_attribute("aria-label", "所有操作")
    for label in ("正文", "标题 1", "标题 2", "标题 3", "删除线", "行内代码"):
        expect(page.locator("#command-list .command span").filter(has_text=re.compile("^" + re.escape(label) + "$"))).to_have_count(1)
    expect(page.locator("#command-list")).not_to_contain_text("插入二级标题")
    page.keyboard.press("Escape")
    page.locator(".export-button").click()
    expect(page.locator("#delivery-dialog")).to_be_visible()
    expect(page.locator("#delivery-dialog h2")).to_have_text("导出这一页")
    page.keyboard.press("Escape")

    # Include desktop traffic-light space even though this test uses the web backend.
    page.evaluate("document.body.classList.add('desktop')")
    for width in (1440, 1120, 800, 680):
        page.set_viewport_size({"width": width, "height": 820})
        accessible_buttons(page)
        geometry = page.locator(".topbar").evaluate("""bar => {
          const r=bar.getBoundingClientRect();
          return {overflow:bar.scrollWidth>bar.clientWidth || document.documentElement.scrollWidth>innerWidth,
            boxes:[...bar.querySelectorAll('button')].map(b => {const q=b.getBoundingClientRect();return {x:q.x,right:q.right,y:q.y,bottom:q.bottom}}),
            bounds:{x:r.x,right:r.right,y:r.y,bottom:r.bottom}};
        }""")
        assert not geometry["overflow"], geometry
        for box in geometry["boxes"]:
            assert box["x"] >= 0 and box["right"] <= width and box["y"] >= geometry["bounds"]["y"] and box["bottom"] <= geometry["bounds"]["bottom"], geometry
        for radio in page.locator(".view-switch button").all():
            expect(radio).to_be_visible()
        if width == 680:
            expect(page.locator(".export-label")).to_be_hidden()
            expect(page.locator(".export-button")).to_have_accessible_name("导出")
        # Narrow editors wrap the format bar onto another row; every control stays visible.
        for view in ("single", "split"):
            page.locator(f'[data-view="{view}"]').click()
            format_geometry = page.locator("#format-bar").evaluate("""bar => {
              const r=bar.getBoundingClientRect();
              return {scroll:bar.scrollWidth, width:bar.clientWidth, outside:[...bar.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect()).filter(q => q.x < r.x - 1 || q.right > r.right + 1).length};
            }""")
            assert format_geometry["scroll"] <= format_geometry["width"] and format_geometry["outside"] == 0, (width, view, format_geometry)
            expect(page.locator("#format-bar .format-source")).to_be_visible() if view == "split" else None
            page.locator("#format-bar").screenshot(path=str(ARTIFACTS / f"format-bar-{width}-{view}.png"))
        page.locator('[data-view="single"]').click()
        page.locator(".topbar").screenshot(path=str(ARTIFACTS / f"toolbar-{width}.png"))
    print("PASS: paper height/footer/no-scroll/long-document/click-to-write, split equal columns/filled sheet, full/normal/wide widths/reload/reading/split, format groups/names/icons/headings/cursor/wrapping/source, toolbar order/names/icons, view radios/shortcuts/reload, sidebar tabs/headings/recent, menu keyboard/dismissal/disabled/source/focus/commands, export, responsive toolbar")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    page = browser.new_page(locale="zh-CN", viewport={"width": 1120, "height": 820})
    page.set_default_timeout(7000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        run(page)
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(ARTIFACTS / "failure.png"))
        (ARTIFACTS / "errors.json").write_text(json.dumps(errors, ensure_ascii=False))
        raise
    finally:
        print(f"Evidence: {ARTIFACTS}")
        browser.close()
