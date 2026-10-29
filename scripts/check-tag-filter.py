"""Tag filtering against the real Go API, using an isolated workspace."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4206"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-tags-qa-"))
TAIL = "中文😀 独特文尾"


def api(page, method, *args, locale="zh-Hans"):
    response = page.request.post(BASE + "/api", data={"method": method, "args": args, "locale": locale}, headers={"Origin": BASE})
    assert response.ok, response.text()
    result = response.json()
    assert not result.get("error"), result
    return result["value"]


def create(page, title, metadata, body=TAIL):
    doc = api(page, "New")["current"]
    content = "---\n" + metadata + "\n---\n\n# " + title + "\n\n" + body
    api(page, "Update", {"id": doc["id"], "revision": doc["revision"], "content": content, "position": doc["position"]})
    return doc["id"]


def wait_callback(page, predicate):
    deadline = time.monotonic() + 7
    while not predicate() and time.monotonic() < deadline:
        page.wait_for_timeout(10)
    assert predicate(), "callback condition did not arrive"


def ready(page, query=None, tag=None):
    if query is not None:
        page.locator("#recent-search").fill(query)
    if tag is not None:
        page.locator("#tag-filter").select_option(tag)
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    if query is not None:
        expect(page.locator("#drawer-list")).to_have_attribute("data-search-query", query)
    if tag is not None:
        expect(page.locator("#drawer-list")).to_have_attribute("data-search-tag", tag)


def recent(page):
    with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "FilterDocuments" and r.request.post_data_json["args"][0] == {"query": "", "tag": ""}):
        page.locator("#recent-search").fill("")
        page.locator("#tag-filter").select_option("")
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "recent")
    page.wait_for_load_state("networkidle")


def palette(page, text):
    page.keyboard.press("Meta+k")
    page.locator("#command-search").fill(text)
    page.locator("#command-list button").filter(has_text=text).first.click()


def run(page):
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    work = create(page, "工作文稿", 'tags: [工作, 共同, 第三, 第四, 工作, Work]', "正文内容。" * 1200 + "\n\n" + TAIL)
    life = create(page, "生活文稿", "tags: [生活, 共同]")
    plain = create(page, "无标签文稿", "tags: 7", "正文 #工作 " + TAIL)
    sharp = create(page, "井号文稿", "tags: ['##work', work]")
    attack = create(page, "安全文字", "tags: '<img src=x onerror=window.__tagXSS=1>'")
    unique = create(page, "临时文稿", "tags: [临时]")
    api(page, "Activate", work)
    page.reload()
    expect(page.locator("#doc-title")).to_have_text("工作文稿")
    page.locator("#sidebar-button").click()
    page.wait_for_load_state("networkidle")
    select, field, listing = page.locator("#tag-filter"), page.locator("#recent-search"), page.locator("#drawer-list")
    expect(select).to_have_accessible_name("标签筛选")
    catalog = api(page, "FilterDocuments", {"query": "", "tag": ""})
    counts = {t["name"]: t["count"] for t in catalog["tags"]}
    assert counts["工作"] == 1 and counts["共同"] == 2 and counts["Work"] == 1 and counts["work"] == 1
    assert counts["#work"] == 1 and len(catalog["recent"]) == 6
    assert catalog["items"] == [] and catalog["total"] == 0
    before = api(page, "State")
    expect(page.locator(".recent-row").filter(has=page.locator('.recent-item', has_text="工作文稿")).locator(".document-tag")).to_have_count(3)
    page.locator(".recent-row").filter(has=page.locator('.recent-item', has_text="工作文稿")).get_by_role("button", name="筛选标签「工作」", exact=True).click()
    expect(listing).to_have_attribute("data-search-tag", "工作")
    expect(page.locator(".search-title")).to_have_text("工作文稿")
    assert api(page, "State")["current"] == before["current"], "tag click navigated or wrote content"
    expect(page.locator("#recent-label")).to_have_text("文稿")
    ready(page, tag="第四")
    expect(page.get_by_role("button", name="清除标签筛选「第四」", exact=True)).to_be_visible()
    ready(page, tag="工作", query="独特文尾")
    expect(page.locator(".search-hit")).to_contain_text(TAIL)
    result = api(page, "FilterDocuments", {"query": "独特文尾", "tag": "工作"})
    assert result["total"] == 1 and result["items"][0]["document"]["id"] == work and result["recent"] == []
    page.locator(".search-hit").click()
    page.wait_for_function("() => getSelection()?.toString()==='独特文尾'")
    expect(select).to_have_value("工作")
    ready(page, query="")
    expect(page.locator(".search-hit")).to_have_count(0)
    expect(page.locator(".search-excerpt")).to_be_visible()
    # Tag-only opens preserve the current view and focus the current content.
    for mode in ("single", "split", "read"):
        page.locator(f'[data-view="{mode}"]').click()
        ready(page, tag="工作")
        page.locator(".search-title").click()
        expect(page.locator(f'[data-view="{mode}"]')).to_have_attribute("aria-checked", "true")
        expect(page.locator(".preview-scroll" if mode == "read" else ".cm-content")).to_be_focused()
    # Select and tag focus survive a response; moving to the editor cancels focus intent.
    page.locator('[data-view="single"]').click()
    select.focus()
    select.dispatch_event("change")
    expect(listing).to_have_attribute("data-search-state", "ready")
    expect(select).to_be_focused()
    tag_button = page.get_by_role("button", name="清除标签筛选「工作」", exact=True)
    tag_button.focus()
    field.dispatch_event("input")
    expect(listing).to_have_attribute("data-search-state", "ready")
    expect(tag_button).to_be_focused()
    field.dispatch_event("input")
    page.locator(".cm-content").focus()
    expect(listing).to_have_attribute("data-search-state", "ready")
    expect(page.locator(".cm-content")).to_be_focused()
    ready(page, query="独特文尾")
    field.press("Escape")
    expect(field).to_have_value("")
    expect(select).to_have_value("工作")
    field.press("Escape")
    expect(select).to_have_value("")
    expect(page.locator(".recent-remove")).to_have_count(6)
    ready(page, tag="#work")
    expect(page.locator(".search-title")).to_have_text("井号文稿")
    ready(page, tag="work")
    expect(page.locator(".search-title")).to_have_text("井号文稿")
    ready(page, tag="Work")
    expect(page.locator(".search-title")).to_have_text("工作文稿")
    ready(page, tag="<img src=x onerror=window.__tagXSS=1>")
    expect(page.locator("#drawer-list img, #drawer-list script")).to_have_count(0)
    assert page.evaluate("window.__tagXSS") is None
    # Same query, different tags: old results and old catalogs cannot win.
    ready(page, tag="工作", query="独特文尾")
    held = []
    def hold(route):
        r = route.request.post_data_json
        if r["method"] == "FilterDocuments" and r["args"][0]["query"] == "独特文尾":
            held.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold)
    field.dispatch_event("input")
    wait_callback(page, lambda: len(held) == 1)
    select.select_option("生活")
    # Wait for the second debounce without pretending the held request finished.
    page.evaluate("() => new Promise(resolve=>setTimeout(resolve,220))")
    assert len(held) == 1, "overlapping filter requests"
    obsolete = {**result, "tags": [{"name": "过期目录", "count": 999}]}
    held[0].fulfill(status=200, content_type="application/json", body=json.dumps({"value": obsolete}))
    wait_callback(page, lambda: len(held) == 2)
    assert held[1].request.post_data_json["args"][0]["tag"] == "生活"
    expect(select.locator("option", has_text="过期目录")).to_have_count(0)
    held[1].continue_()
    expect(page.locator(".search-title")).to_have_text("生活文稿")
    # Retained tag buttons toggle against the current selection while loading.
    page.get_by_role("button", name="筛选标签「共同」", exact=True).click()
    expect(select).to_have_value("共同")
    page.get_by_role("button", name="清除标签筛选「共同」", exact=True).click()
    expect(select).to_have_value("")
    wait_callback(page, lambda: len(held) == 3)
    assert held[2].request.post_data_json["args"][0]["tag"] == ""
    held[2].continue_()
    expect(listing).to_have_attribute("data-search-state", "ready")
    page.unroute(BASE + "/api", hold)
    ready(page, tag="生活")
    field.fill("")
    expect(select).to_have_value("生活")
    expect(page.locator(".search-title")).to_have_text("生活文稿")
    page.locator('#drawer [data-close="drawer"]').click()
    page.locator("#sidebar-button").click()
    expect(select).to_have_value("生活")
    ready(page, tag="临时")
    api(page, "Delete", unique)
    select.dispatch_event("change")
    expect(page.locator(".search-title")).to_have_count(0)
    expect(page.locator("#search-status")).to_contain_text("临时")
    expect(select).to_have_value("临时")
    expect(select.locator("option:checked")).to_have_text("临时 · 0")
    # Empty-filter metadata failure preserves recent documents and a usable retry.
    recent(page)
    def fail_catalog(route):
        r = route.request.post_data_json
        if r["method"] == "FilterDocuments":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"error": "catalog unavailable"}))
        else:
            route.continue_()
    page.route(BASE + "/api", fail_catalog)
    field.dispatch_event("input")
    expect(listing).to_have_attribute("data-search-state", "error")
    expect(page.locator(".recent-item")).to_have_count(5)
    expect(page.locator("#search-status")).to_contain_text("catalog unavailable")
    page.locator(".recent-remove").first.focus()
    page.locator(".recent-remove").first.click()
    expect(page.locator(".search-retry")).to_be_visible()
    page.unroute(BASE + "/api", fail_catalog)
    page.locator(".search-retry").click()
    expect(listing).to_have_attribute("data-search-state", "recent")
    expect(page.locator(".recent-item")).to_have_count(5)
    # Accepted source edits refresh the directory without an index or reload.
    ready(page, tag="工作")
    page.locator(".search-title").click()
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    expect(page.locator(".paper")).to_have_class(re.compile("source-mode"))
    page.locator(".cm-content").fill("---\ntags: [新标签]\n---\n\n# 工作文稿\n\n编辑后 " + TAIL)
    expect(page.locator("#search-consistency")).to_contain_text("自动保存")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    expect(select.locator("option:checked")).to_have_text("工作 · 0")
    expect(page.locator(".search-title")).to_have_count(0)
    ready(page, tag="新标签")
    page.locator(".search-title").click()
    expect(page.locator(".cm-content")).not_to_have_attribute("aria-readonly", "true")
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+z")
    expect(page.locator(".cm-content")).to_contain_text("正文内容")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    expect(select.locator("option:checked")).to_have_text("新标签 · 0")
    # English, all theme colors, narrow layout and native keyboard interaction.
    ready(page, tag="工作")
    palette(page, "English")
    expect(select).to_have_accessible_name("Filter by tag")
    expect(page.locator("#recent-label")).to_have_text("Documents")
    expect(page.get_by_role("button", name="Clear tag filter “工作”", exact=True)).to_be_visible()
    expect(listing).to_have_attribute("data-search-state", "ready")
    field.focus()
    field.press("ArrowDown")
    expect(page.locator(".search-title")).to_be_focused()
    page.keyboard.press("Escape")
    expect(field).to_be_focused()
    page.locator('[data-action="settings"]').click()
    themes = ["Dawn", "Paper", "Warm", "Lamplight", "Ink", "Moonlight", "Mist", "Lotus", "Harvest", "Moon White", "Indigo"]
    for name in themes:
        page.get_by_role("radio", name=name, exact=True).click()
        assert select.evaluate("(el)=>getComputedStyle(el).color!==getComputedStyle(el).backgroundColor")
    page.locator('[data-close="appearance"]').click()
    for width in (1440, 800, 680):
        page.set_viewport_size({"width": width, "height": 850})
        if not page.locator("#drawer").is_visible():
            page.locator("#sidebar-button").click()
        expect(select).to_be_visible()
        assert not page.evaluate("document.documentElement.scrollWidth>innerWidth")
        assert not listing.evaluate("(el)=>el.scrollWidth>el.clientWidth+1")
    assert not page.locator("#drawer-list").evaluate("(el)=>!!el.querySelector('button button, button select')")
    expect(listing).to_have_attribute("data-search-state", "ready")
    assert page.locator(".document-tag").first.evaluate("(el)=>parseFloat(getComputedStyle(el).fontSize)>=11")
    page.screenshot(path=str(ARTIFACTS / "tags.png"))
    # Full scope and cap: 105 matching drafts, all totals before limiting the DOM.
    for i in range(105):
        create(page, f"批量 {i}", "tags: [批量]", TAIL + "\n" + TAIL + "\n" + TAIL + "\n" + TAIL)
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    if not page.locator("#drawer").is_visible():
        page.locator("#sidebar-button").click()
    ready(page, query="独特文尾", tag="批量")
    bulk = api(page, "FilterDocuments", {"query": "独特文尾", "tag": "批量"})
    assert bulk["total"] == 105 and bulk["truncated"] and len(bulk["items"]) == 100
    assert all(len(i["document"]["hits"]) == 3 and i["document"]["moreHits"] for i in bulk["items"])
    expect(page.locator(".search-item")).to_have_count(100)
    recent(page)
    expect(page.locator(".recent-item")).to_have_count(110)
    expect(page.locator("#tag-filter")).to_have_value("")
    print("PASS: global catalog/exact tags, intersection/UTF-16, tag-only three views/focus/undo, one flight/stale catalog, zero-count selection, metadata retry, saves/locales/themes/narrow UI, 105-doc cap/full recent scope")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 850})
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
