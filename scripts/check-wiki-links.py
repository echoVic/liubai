"""Wiki references against the real Go API and an isolated workspace."""
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4206"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-wiki-qa-"))
TARGET = "目标😀"
SOURCE = "# 来源\n\n正文 [[目标😀]] [[同名]] [[不存在]]\n\n"
SOURCE += "\n\n".join("这是用于检查正文定位的段落。" * 30 for _ in range(25))
SOURCE += "\n\n中😀 [[目标😀]]\n[[目标😀]]\n[[目标😀]]\n[[目标😀]]"


def api(page, method, *args, locale="zh-Hans"):
    response = page.request.post(BASE + "/api", data={"method": method, "args": args, "locale": locale}, headers={"Origin": BASE})
    assert response.ok, response.text()
    result = response.json()
    assert not result.get("error"), result
    return result["value"]


def create(page, title, body):
    doc = api(page, "New")["current"]
    saved = api(page, "Update", {"id": doc["id"], "revision": doc["revision"], "content": body, "position": doc["position"]})
    if saved["title"] != title:
        saved = api(page, "Rename", doc["id"], title)["current"]
    return saved


def load(page, doc):
    api(page, "Activate", doc["id"])
    page.reload()
    expect(page.locator("#doc-title")).to_have_text(doc["title"])


def wait_callback(page, predicate):
    deadline = time.monotonic() + 7
    while not predicate() and time.monotonic() < deadline:
        page.wait_for_timeout(10)
    assert predicate(), "callback condition did not arrive"


def ready(page, doc_id=None):
    if not page.locator("#drawer").is_visible():
        page.locator("#sidebar-button").click()
    if not page.locator("#backlinks").evaluate("(el)=>el.open"):
        page.locator("#backlinks summary").click()
    listing = page.locator("#backlink-list")
    expect(listing).to_have_attribute("data-backlink-state", "ready")
    if doc_id:
        expect(listing).to_have_attribute("data-document-id", doc_id)


def click_wiki(page, title, mode="single"):
    if mode == "single":
        expect(page.locator(".cm-content")).not_to_have_attribute("aria-readonly", "true")
        page.locator(".cm-content .md-wiki-link").filter(has_text=title).first.click(modifiers=["Meta"])
    else:
        page.locator("#preview .md-wiki-link").filter(has_text=title).first.click()


def palette(page, text):
    page.keyboard.press("Meta+k")
    page.locator("#command-search").fill(text)
    page.locator("#command-list button").filter(has_text=text).first.click()


def table_navigation(page):
    page.set_viewport_size({"width": 1440, "height": 850})
    first = create(page, "Table A", "# Table A")
    second = create(page, "Table B", "# Table B")
    content = "# Table source\n\n| [[Table A]] and [[Table B]] | Other |\n| --- | --- |\n| [[Table A]] | `[[Table A]]` |\n| [[Table A]][ref] | Plain |\n\n[ref]: https://example.test\n\nAfter"
    origin = create(page, "Table source", content)

    def click_text(row, column, text, modifier=True):
        cell = page.locator(f'.rendered-table [data-row="{row}"][data-column="{column}"]')
        point = cell.evaluate("""(cell,text)=>{
          const raw=cell.textContent,start=raw.indexOf(text),range=document.createRange();
          if(start<0)throw Error('Missing cell text: '+text);
          range.setStart(cell.firstChild,start);range.setEnd(cell.firstChild,start+text.length);
          const box=range.getBoundingClientRect(),outer=cell.getBoundingClientRect();
          return {x:box.x-outer.x+box.width/2,y:box.y-outer.y+box.height/2};
        }""", text)
        cell.click(position=point, modifiers=["Meta"] if modifier else [])

    page.locator('[data-view="single"]').click()
    load(page, origin)
    expect(page.locator(".rendered-table")).to_be_visible()
    page.screenshot(path=str(ARTIFACTS / "table-links.png"))
    click_text(0, 0, "Table B")
    expect(page.locator("#doc-title")).to_have_text(second["title"])
    load(page, origin)
    click_text(1, 0, "Table A", False)
    expect(page.locator("#doc-title")).to_have_text(origin["title"])
    click_text(1, 1, "Table A")
    expect(page.locator("#doc-title")).to_have_text(origin["title"])
    click_text(2, 0, "Table A")
    expect(page.locator("#doc-title")).to_have_text(origin["title"])
    cell = page.locator('.rendered-table [data-row="0"][data-column="0"]')
    cell.dispatch_event("compositionstart")
    click_text(0, 0, "Table A")
    expect(page.locator("#doc-title")).to_have_text(origin["title"])
    cell.dispatch_event("compositionend")
    expect(page.locator(".table-menu-button")).to_be_enabled()
    assert api(page, "State")["current"]["content"] == content
    click_text(0, 0, "Table A")
    expect(page.locator("#doc-title")).to_have_text(first["title"])
    print("PASS: rich table pointer selects the correct reference, ordinary click/code/native label/IME guards preserve cell source")


def held_save_navigation(page, origin, destination, kind, requests):
    load(page, origin)
    page.locator('[data-view="single"]').click()
    if kind == "backlink":
        ready(page, origin["id"])
    held_update, held_position = [], []

    def hold_save(route):
        request = route.request.post_data_json
        if request["method"] == "Update" and request["args"][0]["id"] == origin["id"] and not held_update:
            held_update.append(route)
        elif kind == "backlink" and request["method"] == "SavePosition" and request["args"][0] == origin["id"] and not held_position:
            held_position.append(route)
        else:
            route.continue_()

    def navigate():
        if kind == "wiki":
            click_wiki(page, destination["title"])
        else:
            page.locator(f'#backlink-list [data-document-id="{destination["id"]}"] .search-title').click()

    page.route(BASE + "/api", hold_save)
    try:
        page.locator(".cm-content").focus()
        if kind == "wiki":
            page.keyboard.press("Meta+End")
            page.keyboard.insert_text("\n\nWiki save-wait marker")
            page.keyboard.press("Meta+Home")
            navigate()
        else:
            # Start the real backlink callback while its rows are still ready.
            # A late transaction during SavePosition exercises the subsequent
            # Update wait without bypassing the backlink's dirty-state guard.
            page.locator(".cm-content").evaluate("""el=>{
              const view=el.cmTile.root.view;
              view.dispatch({selection:{anchor:view.state.selection.main.head===0?1:0}});
            }""")
            navigate()
            wait_callback(page, lambda: len(held_position) == 1)
            page.locator(".cm-content").evaluate("""el=>{
              const view=el.cmTile.root.view;
              view.dispatch({changes:{from:view.state.doc.length,insert:'\\n\\nBacklink save-wait marker'}});
            }""")
            with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "SavePosition"):
                held_position[0].continue_()
        wait_callback(page, lambda: len(held_update) == 1)
        count = len([r for r in requests if r["method"] in ("ResolveWikiLink", "Activate")])
        page.locator("#toast").evaluate("(el)=>{el.textContent='';el.hidden=true}")
        page.locator(".cm-content").dispatch_event("compositionstart")
        page.locator(".cm-content").dispatch_event("compositionend")
        with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "Update"):
            held_update[0].continue_()
        # Busy/read-only clearing is callback-visible proof that navigation has
        # finished, not just that its save response arrived.
        expect(page.locator(".cm-content")).not_to_have_attribute("aria-readonly", "true")
        expect(page.locator("#doc-title")).to_have_text(origin["title"])
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        assert len([r for r in requests if r["method"] in ("ResolveWikiLink", "Activate")]) == count, kind
        expect(page.locator("#toast")).not_to_be_visible()
        saved = api(page, "State")["current"]
        assert saved["content"] == held_update[0].request.post_data_json["args"][0]["content"], "no-edit composition changed saved text"
        if kind == "backlink":
            ready(page, origin["id"])
        navigate()
        expect(page.locator("#doc-title")).to_have_text(destination["title"])
    finally:
        page.unroute(BASE + "/api", hold_save)


def run(page):
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    target = create(page, TARGET, "# " + TARGET + "\n\n[[目标😀]]")
    duplicate_a = create(page, "同名", "# 同名\n\n候选甲")
    duplicate_b = create(page, "同名", "# 同名\n\n候选乙")
    source = create(page, "来源", SOURCE)
    requests = []
    page.on("request", lambda request: requests.append(request.post_data_json) if request.url == BASE + "/api" else None)
    load(page, source)
    page.locator("#sidebar-button").click()
    page.wait_for_load_state("networkidle")
    assert not [r for r in requests if r["method"] == "Backlinks"], "collapsed queried graph"
    resolved = api(page, "ResolveWikiLink", {"sourceID": source["id"], "revision": source["revision"], "target": TARGET})
    assert resolved["total"] == 1 and resolved["items"][0]["id"] == target["id"]
    assert len(api(page, "ResolveWikiLink", {"sourceID": source["id"], "revision": source["revision"], "target": "同名"})["items"]) == 2
    assert api(page, "ResolveWikiLink", {"sourceID": source["id"], "revision": source["revision"], "target": "不存在"})["items"] == []
    click_wiki(page, TARGET)
    expect(page.locator("#doc-title")).to_have_text(TARGET)
    ready(page, target["id"])
    back = api(page, "Backlinks", target["id"])
    assert back["total"] == 1 and back["items"][0]["id"] == source["id"], back
    assert len(back["items"][0]["hits"]) == 3 and back["items"][0]["moreHits"]
    for hit in back["items"][0]["hits"]:
        raw = SOURCE.encode("utf-16-le")[hit["from"] * 2:hit["to"] * 2].decode("utf-16-le")
        assert raw == hit["text"] == "[[目标😀]]"
    group = page.locator(f'#backlink-list [data-document-id="{source["id"]}"]')
    group.locator(".search-hit").nth(1).click()
    expect(page.locator("#doc-title")).to_have_text("来源")
    page.wait_for_function("()=>getSelection()?.toString()==='[[目标😀]]'")
    # A saved edit, link navigation and reverse navigation retain the source undo history.
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\n双链撤销标记")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    page.keyboard.press("Meta+Home")
    click_wiki(page, TARGET)
    expect(page.locator("#doc-title")).to_have_text(TARGET)
    ready(page, target["id"])
    page.locator("#backlink-list .search-title").click()
    expect(page.locator("#doc-title")).to_have_text("来源")
    page.keyboard.press("Meta+z")
    expect(page.locator(".cm-content")).not_to_contain_text("双链撤销标记")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    for mode in ("single", "split", "read"):
        page.locator(f'[data-view="{mode}"]').click()
        if mode != "single":
            page.locator(".preview-scroll").evaluate("(el)=>el.scrollTop=0")
        else:
            page.locator(".cm-content").focus()
            page.keyboard.press("Meta+Home")
        click_wiki(page, TARGET, mode)
        expect(page.locator("#doc-title")).to_have_text(TARGET)
        expect(page.locator(f'[data-view="{mode}"]')).to_have_attribute("aria-checked", "true")
        ready(page, target["id"])
        page.locator("#backlink-list .search-hit").nth(1).click()
        expect(page.locator("#doc-title")).to_have_text("来源")
        expect(page.locator(f'[data-view="{mode}"]')).to_have_attribute("aria-checked", "true")
        if mode != "single":
            page.locator("#preview .md-wiki-link").filter(has_text=TARGET).nth(1).wait_for()
            page.wait_for_function("""()=>{const root=document.querySelector('.preview-scroll'),node=[...root.querySelectorAll('p')].find(p=>p.textContent.startsWith('中😀'));
              if(!node)return false;const a=root.getBoundingClientRect(),b=node.getBoundingClientRect();return b.top<a.bottom&&b.bottom>a.top}""")
    page.locator('[data-view="single"]').click()
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+Home")
    click_wiki(page, "同名")
    expect(page.locator("#wiki-dialog")).to_be_visible()
    expect(page.locator(".wiki-candidate")).to_have_count(2)
    page.keyboard.press("Escape")
    expect(page.locator("#wiki-dialog")).not_to_be_visible()
    expect(page.locator("#doc-title")).to_have_text("来源")
    click_wiki(page, "同名")
    page.locator(f'[data-wiki-candidate="{duplicate_a["id"]}"]').click()
    expect(page.locator("#doc-title")).to_have_text("同名")
    ready(page, duplicate_a["id"])
    expect(page.locator("#backlink-status")).to_contain_text("同名")
    load(page, source)
    click_wiki(page, "不存在")
    expect(page.locator("#toast")).to_contain_text("没有找到")
    expect(page.locator("#doc-title")).to_have_text("来源")
    # Resolution already in flight cannot navigate after a new composition.
    held = []
    def hold_resolve(route):
        if route.request.post_data_json["method"] == "ResolveWikiLink":
            held.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold_resolve)
    click_wiki(page, TARGET)
    wait_callback(page, lambda: len(held) == 1)
    page.locator(".cm-content").dispatch_event("compositionstart")
    held[0].continue_()
    with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "SavePosition"):
        page.locator(".cm-content").dispatch_event("compositionend")
        page.locator(".cm-content").focus()
        page.keyboard.press("ArrowRight")
    expect(page.locator("#doc-title")).to_have_text("来源")
    page.unroute(BASE + "/api", hold_resolve)
    # Ending a composition without inserting text must not revive the navigation intent.
    held.clear()
    page.route(BASE + "/api", hold_resolve)
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+Home")
    click_wiki(page, TARGET)
    wait_callback(page, lambda: len(held) == 1)
    page.locator(".cm-content").dispatch_event("compositionstart")
    with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "SavePosition"):
        page.locator(".cm-content").dispatch_event("compositionend")
        page.locator(".cm-content").focus()
        page.keyboard.press("ArrowRight")
    with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "ResolveWikiLink"):
        held[0].continue_()
    expect(page.locator(".cm-content")).not_to_have_attribute("aria-readonly", "true")
    expect(page.locator("#doc-title")).to_have_text("来源")
    page.unroute(BASE + "/api", hold_resolve)
    # Save waits are part of the intent: an ended no-edit composition cancels
    # both wiki and backlink navigation, while a subsequent click still works.
    held_save_navigation(page, source, target, "wiki", requests)
    held_save_navigation(page, target, source, "backlink", requests)
    load(page, source)
    # Failing saves retain text and do not issue resolution.
    failures = []
    def fail_update(route):
        if route.request.post_data_json["method"] == "Update":
            failures.append(route.request)
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"error": "synthetic wiki save failure"}))
        else:
            route.continue_()
    page.route(BASE + "/api", fail_update)
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\n失败时保留双链文字")
    wait_callback(page, lambda: bool(failures))
    count = len([r for r in requests if r["method"] == "ResolveWikiLink"])
    page.keyboard.press("Meta+Home")
    click_wiki(page, TARGET)
    expect(page.locator("#toast")).to_contain_text("重试")
    assert len([r for r in requests if r["method"] == "ResolveWikiLink"]) == count
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    expect(page.locator(".cm-content")).to_contain_text("失败时保留双链文字")
    page.unroute(BASE + "/api", fail_update)
    page.keyboard.press("Meta+s")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    # Stale source revision/semantic reference is rejected even if an old preview remains.
    old = api(page, "State")["current"]
    def hold_status(route):
        if route.request.post_data_json["method"] == "Status":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"value": old}))
        else:
            route.continue_()
    page.route(BASE + "/api", hold_status)
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+Home")
    changed = api(page, "Update", {"id": old["id"], "revision": old["revision"], "content": "# 来源\n\n引用已移除", "position": old["position"]})
    click_wiki(page, TARGET)
    expect(page.locator("#toast")).to_contain_text("来源文稿已更新")
    expect(page.locator("#doc-title")).to_have_text("来源")
    api(page, "Update", {"id": changed["id"], "revision": changed["revision"], "content": SOURCE, "position": changed["position"]})
    page.unroute(BASE + "/api", hold_status)
    load(page, source)
    click_wiki(page, TARGET)
    expect(page.locator("#doc-title")).to_have_text(TARGET)
    ready(page, target["id"])
    # Backlink refresh is one flight; closed/old-language responses never win.
    back_held = []
    def hold_back(route):
        if route.request.post_data_json["method"] == "Backlinks":
            back_held.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold_back)
    page.locator("#backlinks summary").click()
    page.locator("#backlinks summary").click()
    wait_callback(page, lambda: len(back_held) == 1)
    palette(page, "English")
    back_held[0].fulfill(status=200, content_type="application/json", body=json.dumps({"error": "obsolete locale"}))
    wait_callback(page, lambda: len(back_held) == 2)
    assert back_held[1].request.post_data_json["locale"] == "en"
    expect(page.locator("#backlink-status")).not_to_contain_text("obsolete locale")
    page.locator("#backlinks summary").click()
    back_held[1].continue_()
    page.wait_for_load_state("networkidle")
    expect(page.locator("#backlink-list")).to_have_attribute("data-backlink-state", "idle")
    page.unroute(BASE + "/api", hold_back)
    ready(page, target["id"])
    expect(page.locator("#backlinks summary")).to_have_text("Backlinks")
    # Changing documents while a backlink request is in flight discards the old target's rows.
    switched = []
    def hold_switched_back(route):
        if route.request.post_data_json["method"] == "Backlinks":
            switched.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold_switched_back)
    page.locator("#backlinks summary").click()
    page.locator("#backlinks summary").click()
    wait_callback(page, lambda: len(switched) == 1)
    page.locator(".recent-item").filter(has_text="来源").first.click()
    expect(page.locator("#doc-title")).to_have_text("来源")
    switched[0].fulfill(status=200, content_type="application/json", body=json.dumps({"value": back}))
    wait_callback(page, lambda: len(switched) == 2)
    assert switched[1].request.post_data_json["args"] == [source["id"]]
    expect(page.locator("#backlink-list .backlink-item")).to_have_count(0)
    switched[1].continue_()
    ready(page, source["id"])
    page.unroute(BASE + "/api", hold_switched_back)
    load(page, target)
    ready(page, target["id"])
    page.locator("#backlink-list .search-title").focus()
    page.keyboard.press("ArrowDown")
    expect(page.locator("#backlink-list .search-hit").first).to_be_focused()
    page.keyboard.press("Escape")
    expect(page.locator("#backlinks summary")).to_be_focused()
    # Requery keeps focused results, but never steals focus back from the editor.
    with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "Backlinks"):
        page.locator("#sidebar-button").click()
        page.locator("#sidebar-button").click()
    ready(page, target["id"])
    page.locator(".cm-content").focus()
    with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "SavePosition"):
        page.keyboard.press("Meta+End")
    ready(page, target["id"])
    expect(page.locator(".cm-content")).to_be_focused()
    # Titles resembling executable markup are escaped in previews and candidates.
    malicious = 'javascript:alert(1)'
    attack = create(page, malicious, "# 安全标题")
    safe = create(page, "安全语法", "# 安全语法\n\n[[" + malicious + "]]\n\n<span title='[[属性]]'>[[目标😀]]</span>\n\n<script>window.__wikiXSS=1</script>\n\n`[[代码]]` $[[公式]]$")
    load(page, safe)
    page.locator('[data-view="read"]').click()
    expect(page.locator("#preview .md-wiki-link")).to_have_count(2)
    expect(page.locator("#preview script")).to_have_count(0)
    assert page.evaluate("window.__wikiXSS") is None
    click_wiki(page, malicious, "read")
    expect(page.locator("#doc-title")).to_have_text(malicious)
    assert page.url.startswith(BASE)
    load(page, safe)
    palette(page, "Download HTML")
    expect(page.locator("#ready-dialog")).to_be_visible()
    exported = page.locator("#print-document").inner_html()
    assert "[[javascript:alert(1)]]" in exported and "liubai-wiki:" not in exported, exported[:300]
    page.locator('[data-close="ready-dialog"]').click()
    # Search/tag controls survive backlink navigation and themes/narrow layout.
    load(page, target)
    ready(page, target["id"])
    page.locator("#recent-search").fill("来源")
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    expect(page.locator("#backlink-list .search-title").filter(has_text="来源")).to_have_count(1)
    page.locator('[data-action="settings"]').click()
    for theme in ("Dawn", "Paper", "Warm", "Lamplight", "Ink", "Moonlight", "Mist", "Lotus", "Harvest", "Moon White", "Indigo"):
        page.get_by_role("radio", name=theme, exact=True).click()
        assert page.locator("#backlinks summary").evaluate("(el)=>getComputedStyle(el).color!==getComputedStyle(document.documentElement).getPropertyValue('--popover')")
    page.locator('[data-close="appearance"]').click()
    for width in (1440, 800, 680):
        page.set_viewport_size({"width": width, "height": 850})
        if width == 800:
            expect(page.locator(".workspace")).not_to_have_class("workspace sidebar-docked")
            expect(page.locator("#drawer")).not_to_be_visible()
        ready(page, target["id"])
        assert not page.evaluate("document.documentElement.scrollWidth>innerWidth")
        assert not page.locator("#backlink-list").evaluate("(el)=>el.scrollWidth>el.clientWidth+1")
        assert not page.locator("#backlink-list").evaluate("(el)=>!!el.querySelector('button button')")
    page.screenshot(path=str(ARTIFACTS / "backlinks.png"))
    # 105 sources and self-reference: full totals, capped rows and three raw hits.
    for i in range(105):
        create(page, f"批量 {i}", f"# 批量 {i}\n\n[[目标😀]]\n[[目标😀]]\n[[目标😀]]\n[[目标😀]]")
    load(page, target)
    ready(page, target["id"])
    bulk = api(page, "Backlinks", target["id"])
    assert bulk["total"] == 107 and bulk["truncated"] and len(bulk["items"]) == 100, bulk["total"]
    expect(page.locator("#backlink-list .backlink-item")).to_have_count(100)
    assert api(page, "Backlinks", duplicate_b["id"])["status"] == "ambiguous"
    table_navigation(page)
    print("PASS: source validation, unique/duplicate/missing, UTF-16/raw hits, three views/undo, IME/save failure, lazy/oneflight/locale/close, keyboard/focus, sanitizer/export, themes/narrow, 100/3 caps")


def performance(page):
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    target = create(page, "Wiki performance target", "# Wiki performance target")
    text = "# Wiki source\n\n[[Wiki performance target]]\n\n" + "Four KiB prose. " * 270
    for i in range(1000):
        create(page, f"Wiki source {i}", text)
    load(page, target)
    ready(page, target["id"])
    times = []
    for _ in range(30):
        page.locator("#backlinks summary").click()
        expect(page.locator("#backlink-list")).to_have_attribute("data-backlink-state", "idle")
        ms = page.evaluate("""target=>new Promise((resolve,reject)=>{
          const list=document.querySelector('#backlink-list'),details=document.querySelector('#backlinks'),start=performance.now();
          const observer=new MutationObserver(()=>{
            if(list.dataset.backlinkState==='ready'&&list.dataset.documentId===target.id&&Number(list.dataset.revision)===target.revision){
              clearTimeout(deadline);observer.disconnect();resolve(performance.now()-start);
            }
          });
          const deadline=setTimeout(()=>{observer.disconnect();reject(Error('Backlinks did not become ready'))},7000);
          observer.observe(list,{attributes:true});details.open=true;
        })""", target)
        expect(page.locator("#backlink-list .backlink-item")).to_have_count(100)
        times.append(ms)
    p95 = sorted(times)[28]
    record = {"documents": 1000, "bytesPerDocument": len(text.encode()), "queries": 30, "uiP95Ms": p95, "maxMs": max(times), "allMs": times}
    (ARTIFACTS / "performance.json").write_text(json.dumps(record, indent=2))
    assert api(page, "Backlinks", target["id"])["total"] == 1000
    assert p95 <= 800, record
    print(f"PASS: 1000 sources/30 lazy opens; UI P95 {p95:.1f}ms, max {max(times):.1f}ms (budget 800ms)")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 850})
    page.set_default_timeout(7000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        performance(page) if os.environ.get("LIUBAI_WIKI_PERF") == "1" else run(page)
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(ARTIFACTS / "failure.png"))
        (ARTIFACTS / "errors.json").write_text(json.dumps(errors, ensure_ascii=False))
        raise
    finally:
        print(f"Evidence: {ARTIFACTS}")
        browser.close()
