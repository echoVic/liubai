"""Browser regression for the real Go workspace. Use an isolated --data-dir.

python3 scripts/check-split-preview.py http://127.0.0.1:4194
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
Screenshots and failure evidence are written to a temporary directory.
"""
import base64
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

from playwright.sync_api import expect, sync_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4194"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-preview-qa-"))
THEMES = json.loads((Path(__file__).resolve().parent.parent / "src" / "themes.json").read_text())
TEXT = "# 分栏验收\n\n一句**强调**，一个[链接](https://example.com)。\n\n"
TEXT += "- [ ] 未完成\n- [x] 已完成\n\n"
TEXT += "| 项目 | 说明 |\n| --- | --- |\n| 留白 | 阅读与编辑 |\n\n"
TEXT += "```md\n# 代码里的标题\n**不要改变**\n```\n\n"
TEXT += "\n\n".join(f"## 第 {i} 段\n\n这是第 {i} 段正文。" for i in range(1, 41))


def workspace(page):
    response = page.request.post(
        BASE + "/api",
        data={"method": "State", "args": []},
        headers={"Origin": BASE},
    )
    assert response.ok, response.text()
    data = response.json()
    assert not data.get("error"), data
    return data["value"]


def appearance_change(page, operation):
    with page.expect_response(
        lambda response: response.url.endswith("/api")
        and '"Appearance"' in (response.request.post_data or "")
    ) as pending:
        operation()
    assert not pending.value.json().get("error"), pending.value.text()


def import_text(page, text, name):
    with page.expect_response(
        lambda response: response.url.endswith("/api")
        and '"Update"' in (response.request.post_data or "")
    ):
        page.locator("#open-input").set_input_files(
            {"name": name, "mimeType": "text/markdown", "buffer": text.encode()}
        )
    assert workspace(page)["current"]["content"] == text


def open_recent(page, title):
    page.locator("#sidebar-button").click()
    expect(page.locator("#drawer")).to_be_visible()
    item = page.locator(".recent-item").filter(
        has=page.locator("b", has_text=title)
    )
    expect(item).to_have_count(1)
    with page.expect_response(
        lambda response: response.url.endswith("/api")
        and '"Activate"' in (response.request.post_data or "")
    ) as activated:
        item.click()
    assert not activated.value.json().get("error"), activated.value.text()
    expect(page.locator("#drawer")).to_be_hidden()


def scroll_top(locator):
    return locator.evaluate("(element) => element.scrollTop")


def reset_preview_renders(page):
    page.evaluate("window.__liubaiPreviewRenders = 0")


def assert_preview_renders(page, expected=1):
    page.wait_for_function(
        "(count) => window.__liubaiPreviewRenders >= count", arg=expected
    )
    actual = page.evaluate("window.__liubaiPreviewRenders")
    assert actual == expected, f"preview rendered {actual} times, expected {expected}"


def wait_preview_scroll_settled(page):
    page.evaluate("""() => new Promise(resolve => {
      const reader=document.querySelector('#preview .preview-scroll');
      let previous=reader.scrollTop, stable=0;
      function sample() {
        const current=reader.scrollTop;
        stable=Math.abs(current-previous)<0.5 ? stable+1 : 0;
        previous=current;
        if (stable>=6) resolve();
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })""")


def stability_sample(page):
    # Observe a complete debounce interval, proving the absence of unwanted jumps.
    return page.evaluate("""() => new Promise(resolve => {
      const reader = document.querySelector('#preview .preview-scroll');
      const editor = document.querySelector('.editor-scroll');
      const start = performance.now(), left = editor.scrollTop, right = reader.scrollTop;
      let movedLeft = 0, movedRight = 0;
      function sample(now) {
        movedLeft = Math.max(movedLeft, Math.abs(editor.scrollTop - left));
        movedRight = Math.max(movedRight, Math.abs(reader.scrollTop - right));
        if (now - start >= 450) resolve({movedLeft, movedRight});
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })""")


def more_action(page, action):
    page.locator("#more-button").click()
    page.locator(f'#more-menu [data-menu-action="{action}"]').click()


def run(page):
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    expect(page.locator(".topbar #workspace-label")).to_have_text("本地开发版 · 独立草稿存档")
    expect(page.locator(".topbar #workspace-label")).to_be_visible()
    import_text(page, TEXT, "分栏验收.md")
    original_id = workspace(page)["current"]["id"]
    # On the pre-feature build this fails: the page has no reading pane.
    expect(page.locator("#preview")).to_have_count(1)
    expect(page.locator("#preview")).to_be_hidden()
    appearance_change(page, lambda: page.locator('[data-view="split"]').click())
    expect(page.locator("#preview")).to_be_visible()
    expect(page.locator("#preview h1")).to_have_text("分栏验收")
    expect(page.locator("#preview h2")).to_have_count(40)
    expect(page.locator("#preview table")).to_have_count(1)
    expect(page.locator("#preview pre")).to_contain_text("**不要改变**")
    assert workspace(page)["appearance"]["layout"] == "split"
    assert workspace(page)["current"]["content"] == TEXT

    # Reading tasks are visible but cannot edit the document.
    checks = page.locator("#preview input[type=checkbox]")
    expect(checks).to_have_count(2)
    expect(checks.nth(0)).to_be_disabled()
    expect(checks.nth(1)).to_be_checked()

    # Editing mode is global; switching layout must keep one EditorView/history.
    appearance_change(page, lambda: page.locator('#format-bar [data-action="source"]').click())
    expect(page.locator(".paper")).to_have_class(re.compile("source-mode"))
    content = page.locator(".cm-content")
    content.focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\n撤销保留检查")
    expect(page.locator("#preview article")).to_contain_text("撤销保留检查")
    appearance_change(page, lambda: page.locator('[data-view="single"]').click())
    expect(page.locator("#preview")).to_be_hidden()
    assert "source-mode" not in page.locator(".paper").get_attribute("class")
    content.focus()
    page.keyboard.press("Meta+z")
    appearance_change(page, lambda: page.locator('[data-view="split"]').click())
    expect(page.locator("#preview article")).not_to_contain_text("撤销保留检查")
    assert "source-mode" in page.locator(".paper").get_attribute("class")
    page.keyboard.press("Meta+Shift+z")
    expect(page.locator("#preview article")).to_contain_text("撤销保留检查")

    # Cross-block caret movement follows; manual scrolling is independent.
    reader = page.locator("#preview .preview-scroll")
    editor_scroll = page.locator(".editor-scroll")
    content.focus()
    page.keyboard.press("Meta+Home")
    page.wait_for_function("() => document.querySelector('#preview .preview-scroll').scrollTop < 100")
    content.focus()
    page.keyboard.press("Meta+End")
    page.wait_for_function("() => document.querySelector('#preview .preview-scroll').scrollTop > 1000")
    page.wait_for_function("""() => {
      const r=document.querySelector('#preview .preview-scroll');
      return r.scrollHeight-r.clientHeight-r.scrollTop < 100;
    }""")
    left_before = scroll_top(editor_scroll)
    right_before = scroll_top(reader)
    reader.hover()
    page.mouse.wheel(0, -750)
    page.wait_for_function(
        "(previous) => document.querySelector('#preview .preview-scroll').scrollTop < previous",
        arg=right_before - 400,
    )
    assert abs(scroll_top(editor_scroll) - left_before) < 2
    # Same-block caret movement and typing must leave manually positioned reader alone.
    page.keyboard.press("ArrowLeft")
    assert stability_sample(page)["movedRight"] < 2
    page.keyboard.insert_text("段内")
    expect(page.locator("#preview article")).to_contain_text("段内")
    assert stability_sample(page)["movedRight"] < 2

    # A top-level separator has no exact mapped block. After a different block
    # was followed and the reader was moved away, follow its preceding block.
    reader.hover()
    page.mouse.wheel(0, 100000)
    separator_line = TEXT.split("\n").index("这是第 6 段正文。") + 1
    page.wait_for_function("""() => {
      const reader=document.querySelector('#preview .preview-scroll');
      const target=[...reader.querySelectorAll('p')].find(el => el.textContent === '这是第 6 段正文。');
      if (!target) return false;
      const viewport=reader.getBoundingClientRect(), box=target.getBoundingClientRect();
      return box.bottom <= viewport.top || box.top >= viewport.bottom;
    }""")
    content.focus()
    page.keyboard.press("Meta+Home")
    for _ in range(separator_line):
        page.keyboard.press("ArrowDown")
    assert page.evaluate("""() => {
      const node=getSelection()?.anchorNode;
      const line=(node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)
        ?.closest?.('.cm-line');
      return line?.textContent ?? null;
    }""") == ""
    page.wait_for_function("""() => {
      const reader=document.querySelector('#preview .preview-scroll');
      const target=[...reader.querySelectorAll('p')].find(el => el.textContent === '这是第 6 段正文。');
      if (!target) return false;
      const viewport=reader.getBoundingClientRect(), box=target.getBoundingClientRect();
      return box.bottom > viewport.top + 12 && box.top < viewport.bottom - 12;
    }""")
    wait_preview_scroll_settled(page)

    # Composition events deliberately exercise our guard, not an OS input method.
    content.dispatch_event("compositionstart")
    page.keyboard.insert_text("组合候选")
    assert stability_sample(page)["movedRight"] < 2
    expect(page.locator("#preview article")).not_to_contain_text("组合候选")
    content.dispatch_event("compositionend")
    expect(page.locator("#preview article")).to_contain_text("组合候选")

    # Persisted preferences survive reload and apply to a new document.
    expect(page.locator("#save-status")).to_have_text(re.compile("^(草稿已保存|文件已保存)$"))
    page.reload()
    expect(page.locator("#preview h1")).to_have_text("分栏验收")
    assert_preview_renders(page)
    assert workspace(page)["appearance"]["source"] is True
    expect(page.locator(".paper")).to_have_class(re.compile("source-mode"))
    reset_preview_renders(page)
    before_new = workspace(page)["current"]["id"]
    with page.expect_response(
        lambda response: response.url.endswith("/api")
        and '"New"' in (response.request.post_data or "")
    ):
        more_action(page, "new")
    assert_preview_renders(page)
    assert workspace(page)["current"]["id"] != before_new
    import_text(page, "# 第二篇\n\n另一篇正文", "第二篇.md")
    expect(page.locator("#preview h1")).to_have_text("第二篇")
    assert workspace(page)["current"]["id"] != original_id
    assert workspace(page)["appearance"]["layout"] == "split"
    assert workspace(page)["appearance"]["source"] is True

    # Real local-image import and exported HTML must keep the offline delivery policy.
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="
    )
    page.locator("#image-input").set_input_files(
        {"name": "测试图片.png", "mimeType": "image/png", "buffer": png}
    )
    page.wait_for_function("""() => {
      const img=document.querySelector('#preview img');
      return img && img.complete && img.naturalWidth > 0;
    }""")
    expect(page.locator("#save-status")).to_have_text(re.compile("^(草稿已保存|文件已保存)$"))
    page.locator(".export-button").click()
    page.locator('[data-deliver="html"]').click()
    expect(page.locator("#ready-go")).to_be_visible()
    with page.expect_download() as downloaded:
        page.locator("#ready-go").click()
    html = Path(downloaded.value.path()).read_text()
    assert "data:image/png;base64," in html
    assert "另一篇正文" in html
    assert "color: rgb(36, 37, 35)" in html or "color:#242523" in html

    # A freshly typed local reference initially fails backend capability checks
    # until autosave records it. Delay that save to prove the preview retries.
    asset = re.search(r"liubai-asset:[^) \n]+", workspace(page)["current"]["content"])
    assert asset, "import did not create a local image destination"
    content.focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("# 图片重试\n\n未引用图片")
    expect(page.locator("#preview h1")).to_have_text("图片重试")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    page.reload()  # Clear the image cache; the asset still belongs to this draft.
    expect(page.locator("#preview h1")).to_have_text("图片重试")
    held_updates = []
    hold_update = True

    def defer_update(route):
        if hold_update and route.request.post_data_json.get("method") == "Update":
            held_updates.append(route)
        else:
            route.continue_()

    page.route(BASE + "/api", defer_update)
    content.focus()
    page.keyboard.press("Meta+End")
    with page.expect_request(
        lambda request: request.url == BASE + "/api"
        and request.post_data_json.get("method") == "Update"
    ):
        page.keyboard.insert_text(f"\n\n![重新引用]({asset.group()})")
    expect(page.locator("#preview .markdown-image-note")).to_be_visible()
    assert held_updates, "autosave was not intercepted"
    hold_update = False
    for route in held_updates:
        route.continue_()
    page.wait_for_function("""() => {
      const img=document.querySelector('#preview img');
      return img && img.complete && img.naturalWidth > 0;
    }""")
    page.unroute(BASE + "/api", defer_update)
    expect(page.locator("#preview .markdown-image-note")).to_have_count(0)

    # The image read can also fail after Update has already succeeded. Preserve
    # that save signal until the current render settles, then retry once.
    content.focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("# 图片晚到重试\n\n未引用图片")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    page.reload()  # Clear the successful image cache before the race.
    expect(page.locator("#preview h1")).to_have_text("图片晚到重试")
    held_reads = []
    read_attempts = 0

    def defer_first_read(route):
        nonlocal read_attempts
        if route.request.post_data_json.get("method") == "ReadImage":
            read_attempts += 1
            if read_attempts == 1:
                held_reads.append(route)
                return
        route.continue_()

    page.route(BASE + "/api", defer_first_read)
    content.focus()
    page.keyboard.press("Meta+End")
    with page.expect_response(
        lambda response: response.url == BASE + "/api"
        and response.request.post_data_json.get("method") == "Update"
    ) as saved:
        page.keyboard.insert_text(f"\n\n![晚到错误]({asset.group()})")
    assert not saved.value.json().get("error"), saved.value.text()
    assert asset.group() in workspace(page)["current"]["content"]
    assert held_reads, "ReadImage did not remain pending across successful Update"
    with page.expect_request(
        lambda request: request.url == BASE + "/api"
        and request.post_data_json.get("method") == "ReadImage"
    ):
        held_reads[0].fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"value": None, "error": "synthetic late ReadImage failure"}),
        )
    page.wait_for_function("""() => {
      const img=document.querySelector('#preview img');
      return img && img.complete && img.naturalWidth > 0;
    }""")
    assert read_attempts == 2, f"late image failure retried {read_attempts - 1} times"
    page.unroute(BASE + "/api", defer_first_read)
    expect(page.locator("#preview .markdown-image-note")).to_have_count(0)

    # Recent must reopen persisted documents through the real drawer flow.
    image_document = workspace(page)
    image_id = image_document["current"]["id"]
    image_title = image_document["current"]["title"]
    original = next(item for item in image_document["recent"] if item["id"] == original_id)
    open_recent(page, original["title"])
    reopened = workspace(page)
    assert reopened["current"]["id"] == original_id
    original_content = reopened["current"]["content"]
    expect(page.locator("#preview h1")).to_have_text("分栏验收")
    reset_preview_renders(page)
    open_recent(page, image_title)
    assert workspace(page)["current"]["id"] == image_id
    expect(page.locator("#preview h1")).to_have_text("图片晚到重试")
    assert_preview_renders(page)

    # A deferred image result from document A must not affect document B after
    # switching through Recent. This is a synthetic network race, not native I/O.
    stale_reads = []
    stale_attempts = 0

    def defer_stale_read(route):
        nonlocal stale_attempts
        if route.request.post_data_json.get("method") == "ReadImage":
            stale_attempts += 1
            if stale_attempts == 1:
                stale_reads.append(route)
                return
        route.continue_()

    page.route(BASE + "/api", defer_stale_read)
    with page.expect_request(
        lambda request: request.url == BASE + "/api"
        and request.post_data_json.get("method") == "ReadImage"
    ):
        page.reload()  # Clear A's image cache and hold its first backend read.
    deadline = time.monotonic() + 7
    while not stale_reads and time.monotonic() < deadline:
        page.wait_for_timeout(10)
    assert stale_reads, "document A ReadImage was not held"
    expect(page.locator("#preview h1")).to_have_text("图片晚到重试")
    open_recent(page, original["title"])
    switched = workspace(page)
    assert switched["current"]["id"] == original_id
    assert switched["current"]["content"] == original_content
    expect(page.locator("#preview h1")).to_have_text("分栏验收")
    stale_reads[0].fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"value": None, "error": "synthetic stale ReadImage failure"}),
    )
    page.wait_for_timeout(500)
    after_stale = workspace(page)
    assert after_stale["current"]["id"] == original_id
    assert after_stale["current"]["content"] == original_content
    expect(page.locator("#preview h1")).to_have_text("分栏验收")
    expect(page.locator("#preview img")).to_have_count(0)
    expect(page.locator("#preview .markdown-image-note")).to_have_count(0)
    assert stale_attempts == 1, f"stale document retried ReadImage {stale_attempts - 1} times"
    page.unroute(BASE + "/api", defer_stale_read)

    # Theme/font controls must not reset the new global fields.
    page.locator('[data-action="theme"]').click()
    names = {"dawn": "晨光", "paper": "纸白", "warm": "暖纸", "lamp": "灯下", "ink": "夜墨", "moon": "月夜", "mist": "雾绿", "lotus": "藕荷", "autumn": "秋香", "moonwhite": "月白", "indigo": "黛蓝"}
    for theme in [t["id"] for t in THEMES]:
        appearance_change(page, lambda: page.get_by_role("radio", name=names[theme], exact=True).click())
        colors = page.evaluate("""() => ({
          editor:getComputedStyle(document.querySelector('.cm-editor')).color,
          preview:getComputedStyle(document.querySelector('#preview article')).color
        })""")
        assert colors["editor"] == colors["preview"], colors
    # The loop used to end on paper: end there again, so the layout checks below run on the default theme and not on 黛蓝's sans font.
    appearance_change(page, lambda: page.get_by_role("radio", name=names["paper"], exact=True).click())
    appearance_change(page, lambda: page.locator("#font-size").select_option("20"))
    assert page.locator("#preview article").evaluate("(el) => getComputedStyle(el).fontSize") == "20px"
    page.locator('[data-close="appearance"]').click()
    assert workspace(page)["appearance"]["layout"] == "split"
    assert workspace(page)["appearance"]["source"] is True

    # Narrow windows stack both panes; content must not expand the root viewport.
    wide_blocks = "\n\n```text\n" + "long_code_" * 80 + "\n```\n\n"
    wide_blocks += "| 长字段 | 另一个字段 |\n| --- | --- |\n| "
    wide_blocks += "table_cell_" * 50 + " | 内容 |\n"
    import_text(page, TEXT + wide_blocks, "尺寸验收.md")
    content.focus()
    page.keyboard.press("Meta+Home")
    expect(page.locator("#preview h1")).to_have_text("分栏验收")
    for width, height in [(1440, 900), (1120, 820), (800, 700), (680, 540)]:
        page.set_viewport_size({"width": width, "height": height})
        expect(reader).to_be_visible()
        geometry = page.evaluate("""() => {
          const left = document.querySelector('.editor-pane').getBoundingClientRect();
          const right = document.querySelector('#preview').getBoundingClientRect();
          const reader = document.querySelector('#preview .preview-scroll');
          const first = reader.querySelector('[data-line][data-line-end]').getBoundingClientRect();
          const code = document.querySelector('#preview pre:last-of-type');
          const visibleFirst = Math.max(0, Math.min(first.bottom, reader.getBoundingClientRect().bottom)
            - Math.max(first.top, reader.getBoundingClientRect().top));
          return {left:{x:left.x,y:left.y,w:left.width,h:left.height},
            right:{x:right.x,y:right.y,w:right.width,h:right.height},
            visibleFirst,
            headerCount:document.querySelectorAll('body > .topbar').length,
            iframeCount:document.querySelectorAll('iframe').length,
            readerOverflow:reader.scrollWidth > reader.clientWidth + 1,
            localCodeScroll:code.scrollWidth > code.clientWidth,
            overflow:document.documentElement.scrollWidth > innerWidth};
        }""")
        assert geometry["headerCount"] == 1 and geometry["iframeCount"] == 0, geometry
        assert not geometry["overflow"], geometry
        assert not geometry["readerOverflow"], geometry
        assert geometry["localCodeScroll"], geometry
        assert geometry["left"]["h"] > 120 and geometry["right"]["h"] > 120, geometry
        if width < 820:
            assert geometry["right"]["y"] >= geometry["left"]["y"] + geometry["left"]["h"] - 2, geometry
            if width == 680 and height == 540:
                assert geometry["visibleFirst"] >= 24, geometry
        else:
            assert geometry["right"]["x"] >= geometry["left"]["x"] + geometry["left"]["w"] - 2, geometry
        page.screenshot(path=str(ARTIFACTS / f"split-{width}.png"))

    # ReloadDisk also calls load() with the same document ID. A synthetic
    # same-ID New response exercises that controller path without native I/O.
    same_id = workspace(page)
    same_id["current"]["content"] = "# 同 ID 重载\n\n磁盘内容"
    same_id["current"]["title"] = "同 ID 重载"

    def fulfill_same_id(route):
        if route.request.post_data_json.get("method") == "New":
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"value": same_id}),
            )
        else:
            route.continue_()

    page.route(BASE + "/api", fulfill_same_id)
    reset_preview_renders(page)
    more_action(page, "new")
    expect(page.locator("#preview h1")).to_have_text("同 ID 重载")
    assert_preview_renders(page)
    page.unroute(BASE + "/api", fulfill_same_id)

    print("PASS: rendering, readonly tasks, modes/history, separator soft follow, one-render reload/new/Recent/same-ID load, synthetic composition guard, stale image isolation, themes, local images/HTML export, responsive layout")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome")
    )
    page = browser.new_page(locale="zh-CN", viewport={"width": 1120, "height": 820})
    page.add_init_script("""(() => {
      window.__liubaiPreviewRenders = 0;
      const replaceChildren = Element.prototype.replaceChildren;
      Element.prototype.replaceChildren = function(...nodes) {
        if (this.id === 'preview-content') window.__liubaiPreviewRenders++;
        return replaceChildren.apply(this, nodes);
      };
    })()""")
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
