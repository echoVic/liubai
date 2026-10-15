"""Browser regression for the 0.4 reader foundation. Use an isolated --data-dir.

python3 scripts/check-reader.py http://127.0.0.1:4194
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
Covers: reader rendering of a README, reading mode, focus mode, position-only
saves and word count, status-driven reload and conflict actions, empty-draft
cleanup and two-step removal, dropping a .md file, relative links in drafts.
"""
import json
import os
from pathlib import Path
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4194"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-reader-qa-"))
README = "\n".join([
    "---", "title: 示例项目", "tags: [reader]", "---", "",
    '<p align="center"><img src="https://example.invalid/logo.png" width="120" onerror="window.__xss=1"></p>', "",
    "# 示例项目", "",
    "访问 https://github.com/egoist/mygo 或查看 README.md。", "",
    "> [!NOTE]", "> 这是一条说明。", "",
    "```ts", "const answer: number = 42 // comment", "```", "",
    "脚注引用[^1]。", "",
    "[^1]: 脚注内容",
])


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok, response.text()
    data = response.json()
    assert not data.get("error"), data
    return data["value"]


def new_document(page, text):
    # Wait for the New round-trip itself: the previous draft may also be titled 未命名文稿,
    # and typing while the request is in flight lands in a read-only editor.
    with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
        page.locator('[data-action="new"]').first.click()
    expect(page.locator("#doc-title")).to_have_text("未命名文稿")
    page.wait_for_timeout(150)
    page.locator(".cm-content").click()
    page.keyboard.insert_text(text)
    expect(page.locator("#save-status")).to_have_text("草稿已保存")


def run(page):
    calls = []
    page.on("request", lambda r: calls.append(r.post_data_json.get("method")) if r.url.endswith("/api") and r.method == "POST" else None)

    # A startup notice shows only its text: no save actions that do not apply.
    def notice_route(route):
        if route.request.post_data_json.get("method") == "State":
            body = route.fetch().json()
            body["value"]["notices"] = ["有 1 份草稿无法读取，已移到隔离目录"]
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        else:
            route.continue_()

    page.route(BASE + "/api", notice_route)
    page.goto(BASE)
    expect(page.locator("#banner-text")).to_have_text("有 1 份草稿无法读取，已移到隔离目录")
    for hidden in ("#retry-save", "#banner-save-as", "#reload-disk", "#overwrite-disk"):
        expect(page.locator(hidden)).to_be_hidden()
    page.unroute(BASE + "/api", notice_route)

    # Reader rendering through the real preview: sanitized HTML, front matter, linkify, alerts, footnotes, highlighting.
    new_document(page, README)
    page.keyboard.press("Meta+Shift+R")
    expect(page.locator("#preview")).to_be_visible()
    expect(page.locator(".editor-pane")).to_be_hidden()
    preview = page.locator("#preview-content")
    expect(preview.locator("details.md-front-matter")).to_contain_text("title: 示例项目")
    expect(preview.locator('a[href="https://github.com/egoist/mygo"]')).to_have_count(1)
    expect(preview.locator('a[href*="README.md"]')).to_have_count(0)
    expect(preview.locator("blockquote.markdown-alert-note .markdown-alert-title")).to_have_text("说明")
    expect(preview.locator("#fn1")).to_have_count(1)
    expect(preview.locator("pre code .tok-keyword").first).to_be_visible()
    assert not page.evaluate("Boolean(window.__xss) || Boolean(document.querySelector('#preview-content [onerror], #preview-content script'))")
    assert api(page, "State")["appearance"]["layout"] == "read"
    page.keyboard.press("Meta+b")
    expect(page.locator("#toast")).to_contain_text("阅读模式下不能编辑")
    page.screenshot(path=str(ARTIFACTS / "reading-mode.png"))
    page.keyboard.press("Meta+Shift+R")
    expect(page.locator(".editor-pane")).to_be_visible()
    assert api(page, "State")["appearance"]["layout"] == "single"

    # Focus mode dims every line except the active block.
    new_document(page, "第一段文字。\n\n第二段文字。\n\n第三段文字。")
    page.keyboard.press("Meta+Shift+F")
    lines = page.evaluate("""() => [...document.querySelectorAll('.cm-line')].map(l => ({text: l.textContent, active: l.classList.contains('focus-active'), color: getComputedStyle(l).color}))""")
    active = [l for l in lines if l["active"]]
    assert len(active) == 1 and active[0]["text"] == "第三段文字。", lines
    assert all(l["color"] != active[0]["color"] for l in lines if not l["active"] and l["text"]), lines
    page.keyboard.press("Escape")

    # Cursor moves only send positions; an explicit save resends the content; word count ignores syntax.
    page.wait_for_timeout(300)
    calls.clear()
    page.keyboard.press("ArrowUp")
    page.keyboard.press("ArrowUp")
    page.wait_for_timeout(1500)
    assert "SavePosition" in calls and "Update" not in calls, calls
    calls.clear()
    page.keyboard.press("Meta+s")
    page.wait_for_timeout(800)
    assert "Update" in calls, calls
    expect(page.locator("#word-count")).to_have_text("15 字")

    # Status polling reloads a clean document and shows both conflict actions.
    state = api(page, "State")
    cur = state["current"]
    bumped = dict(cur, revision=cur["revision"] + 1, content="# 磁盘新版\n\n外部修改", status="已载入磁盘上的新版本")

    def reload_route(route):
        method = route.request.post_data_json.get("method")
        if method == "Status":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"value": {"id": cur["id"], "revision": cur["revision"] + 1, "conflict": False, "status": bumped["status"]}}))
        elif method == "Activate":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"value": dict(state, current=bumped)}))
        else:
            route.continue_()

    page.route(BASE + "/api", reload_route)
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(page.locator(".cm-content")).to_contain_text("外部修改")
    page.unroute(BASE + "/api", reload_route)

    def conflict_route(route):
        if route.request.post_data_json.get("method") == "Status":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"value": {"id": cur["id"], "revision": cur["revision"] + 1, "conflict": True, "status": "磁盘内容已变化，自动写入已暂停"}}))
        else:
            route.continue_()

    page.route(BASE + "/api", conflict_route)
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(page.locator("#overwrite-disk")).to_be_visible()
    expect(page.locator("#reload-disk")).to_be_visible()
    page.unroute(BASE + "/api", conflict_route)
    page.reload()

    # Empty drafts are cleaned when switching away; removal needs two clicks.
    new_document(page, "# 要移除的文稿\n\n内容")
    page.locator('[data-action="new"]').first.click()
    page.wait_for_timeout(300)
    page.locator('[data-action="new"]').first.click()
    page.wait_for_timeout(300)
    titles = [d["title"] for d in api(page, "State")["recent"]]
    assert titles.count("未命名文稿") == 1, titles
    page.locator('[data-action="recent"]').first.click()
    row = page.locator(".recent-row").filter(has=page.locator("b", has_text="要移除的文稿"))
    row.hover()
    remove = row.locator(".recent-remove")
    remove.click()
    expect(remove).to_have_text("确认移除")
    remove.click()
    expect(page.locator("#toast")).to_have_text("已移除，草稿在废纸篓目录保留 30 天")
    assert "要移除的文稿" not in [d["title"] for d in api(page, "State")["recent"]]
    page.keyboard.press("Escape")

    # Dropping a .md file opens it instead of inserting its text; relative links in drafts explain themselves.
    new_document(page, "# 原来的文稿\n\n不应被插入")
    before = api(page, "State")["current"]["id"]
    transfer = page.evaluate_handle("""() => { const dt = new DataTransfer(); dt.items.add(new File(['# 拖入的文稿\\n\\n正文'], '拖入.md', {type: 'text/markdown'})); return dt; }""")
    page.dispatch_event(".cm-content", "drop", {"dataTransfer": transfer})
    expect(page.locator(".cm-content")).to_contain_text("拖入的文稿")
    page.wait_for_timeout(800)
    s = api(page, "State")
    assert s["current"]["id"] != before
    assert all("拖入" not in d["excerpt"] for d in s["recent"] if d["id"] == before)
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("[指南](docs/guide.md)")
    page.wait_for_timeout(600)
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.locator(".cm-content .md-link").click(modifiers=["Meta"])
    expect(page.locator("#toast")).to_contain_text("草稿还没有保存位置")

    print("PASS: notice banner, reader rendering, reading mode, focus mode, position saves/word count, status reload/conflict, draft cleanup/removal, drop to open, relative links")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    page = browser.new_page(viewport={"width": 1120, "height": 820})
    page.route("https://example.invalid/**", lambda route: route.abort())
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
