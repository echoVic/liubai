"""Full-text search regression against the real Go API and an isolated data dir."""
import json
import os
import re

from playwright.sync_api import expect, sync_playwright
from checklib import base_url, evidence, launch, localized_api as api, palette, save_failure, wait_callback

BASE = base_url()
ARTIFACTS = evidence("liubai-search-qa-")
TAIL = "中😀AKſ尾 独特文尾"
TEXT = "# 全文验收\n\n" + "\n\n".join(f"第 {i} 段 " + "正文内容。" * 20 for i in range(50)) + "\n\n" + TAIL
TEXT += "\n\n<details>\n<summary>折叠块</summary>\n\n折叠命中\n\n</details>"


def query(page, text):
    if not page.locator("#drawer").is_visible():
        page.locator("#sidebar-button").click()
    page.locator("#recent-search").fill(text)
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-query", text.strip())
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")


def visible_tail(page, text):
    page.wait_for_function("""text => {
      const scroll=document.querySelector('.preview-scroll');
      const target=[...scroll.querySelectorAll('p')].find(el=>el.textContent.includes(text));
      if(!target)return false;
      const box=target.getBoundingClientRect(),port=scroll.getBoundingClientRect();
      return box.bottom>port.top && box.top<port.bottom;
    }""", arg=text)


def stable_reader(page):
    return page.evaluate("""() => new Promise(resolve=>{
      const r=document.querySelector('.preview-scroll'),start=r.scrollTop,at=performance.now();
      let moved=0;
      function sample(){moved=Math.max(moved,Math.abs(r.scrollTop-start));
        if(performance.now()-at>400)resolve(moved);else requestAnimationFrame(sample)}
      requestAnimationFrame(sample);
    })""")


def run(page):
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    current = api(page, "New")["current"]
    api(page, "Update", {"id": current["id"], "revision": current["revision"], "content": TEXT, "position": current["position"]})
    page.reload()
    expect(page.locator("#doc-title")).to_have_text("全文验收")
    page.locator("#sidebar-button").click()
    page.locator("#recent-search").fill("独特文尾")
    # The existing excerpt-only sidebar cannot find this text after byte 4096.
    expect(page.locator("#drawer-list")).to_contain_text("独特文尾")
    result = api(page, "Search", "独特文尾")
    assert result["total"] == 1 and result["items"][0]["id"] == current["id"], result
    query(page, "独特文尾")
    page.locator(".search-title").first.focus()
    page.locator("#recent-search").dispatch_event("input")
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    expect(page.locator(".search-title").first).to_be_focused()
    page.locator("#recent-search").dispatch_event("input")
    page.locator(".cm-content").focus()
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    expect(page.locator(".cm-content")).to_be_focused()
    query(page, "k")
    item = result["items"][0]
    assert api(page, "Search", "k")["items"][0]["hits"][0]["text"] == "K"
    page.locator(".search-hit").first.click()
    page.wait_for_function("() => getSelection()?.toString()==='K'")
    assert api(page, "State")["appearance"]["layout"] == "single"
    assert api(page, "State")["current"]["revision"] == item["revision"]
    # A saved edit and search navigation in the same document keep history.
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\n撤销保留标记")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    query(page, "独特文尾")
    page.locator(".search-hit").first.click()
    page.wait_for_function("() => getSelection()?.toString()==='独特文尾'")
    page.keyboard.press("Meta+z")
    expect(page.locator(".cm-content")).not_to_contain_text("撤销保留标记")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    # Read and split navigation explicitly returns to a manually scrolled-away block.
    page.locator('[data-view="read"]').click()
    query(page, "独特文尾")
    page.locator(".search-hit").first.click()
    visible_tail(page, TAIL)
    assert api(page, "State")["appearance"]["layout"] == "read"
    page.locator(".preview-scroll").hover()
    page.mouse.wheel(0, -100000)
    page.wait_for_function("() => document.querySelector('.preview-scroll').scrollTop<100")
    assert stable_reader(page) < 2
    page.locator(".search-hit").first.click()
    visible_tail(page, TAIL)
    query(page, "折叠命中")
    expect(page.locator("#preview details")).not_to_have_attribute("open", "")
    page.locator(".search-hit").first.click()
    expect(page.locator("#preview details")).to_have_attribute("open", "")
    visible_tail(page, "折叠命中")
    query(page, "独特文尾")
    page.locator(".search-source").first.click()
    expect(page.locator('[data-view="split"]')).to_have_attribute("aria-checked", "true")
    expect(page.locator(".paper")).to_have_class(re.compile("source-mode"))
    page.wait_for_function("() => getSelection()?.toString()==='独特文尾'")
    visible_tail(page, TAIL)
    # Composition can begin while an explicit source-view preference is in flight.
    page.locator('#format-bar [data-action="source"]').click()
    expect(page.locator(".paper")).not_to_have_class(re.compile("source-mode"))
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+Home")
    page.locator('[data-view="read"]').click()
    query(page, "独特文尾")
    held_appearance = []
    def hold_appearance(route):
        if route.request.post_data_json["method"] == "UpdateAppearance":
            held_appearance.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold_appearance)
    page.locator(".search-source").first.click()
    wait_callback(page, lambda: len(held_appearance) == 1)
    page.locator("#toast").evaluate("(el)=>{el.textContent='';el.hidden=true}")
    page.locator(".cm-content").dispatch_event("compositionstart")
    held_appearance[0].continue_()
    expect(page.locator("#toast")).to_contain_text("输入")
    expect(page.locator("#toast")).to_be_visible()
    assert page.evaluate("getSelection()?.toString()") != "独特文尾"
    expect(page.locator(".paper")).not_to_have_class(re.compile("source-mode"))
    page.locator(".cm-content").dispatch_event("compositionend")
    page.unroute(BASE + "/api", hold_appearance)
    query(page, "独特文尾")
    held_source = []
    def hold_source(route):
        request = route.request.post_data_json
        if request["method"] == "UpdateAppearance" and request["args"][0].get("source") is True:
            held_source.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold_source)
    page.locator(".search-source").first.click()
    wait_callback(page, lambda: len(held_source) == 1)
    page.locator("#toast").evaluate("(el)=>{el.textContent='';el.hidden=true}")
    page.locator(".cm-content").dispatch_event("compositionstart")
    held_source[0].continue_()
    expect(page.locator("#toast")).to_contain_text("输入")
    expect(page.locator("#toast")).to_be_visible()
    page.locator(".cm-content").dispatch_event("compositionend")
    expect(page.locator(".paper")).to_have_class(re.compile("source-mode"))
    page.unroute(BASE + "/api", hold_source)
    query(page, "独特文尾")
    page.locator(".search-source").first.click()
    page.wait_for_function("() => getSelection()?.toString()==='独特文尾'")
    # A real second document tests load's default-scroll/search-target ordering.
    other = api(page, "New")["current"]
    api(page, "Update", {"id": other["id"], "revision": other["revision"], "content": "# 另一篇\n\n其他正文", "position": other["position"]})
    page.reload()
    expect(page.locator("#doc-title")).to_have_text("另一篇")
    query(page, "独特文尾")
    held_activate = []
    def hold_activate(route):
        if not held_activate and route.request.post_data_json["method"] == "ActivateSearch":
            held_activate.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold_activate)
    page.locator(".search-hit").first.click()
    wait_callback(page, lambda: len(held_activate) == 1)
    page.locator("#toast").evaluate("(el)=>{el.textContent='';el.hidden=true}")
    page.locator(".cm-content").dispatch_event("compositionstart")
    held_activate[0].continue_()
    expect(page.locator("#toast")).to_contain_text("输入")
    expect(page.locator("#toast")).to_be_visible()
    expect(page.locator("#doc-title")).to_have_text("另一篇")
    # An async wait_for_function predicate counts as already true, so poll from here.
    wait_callback(page, lambda: api(page, "State")["current"]["id"] == other["id"])
    page.locator(".cm-content").dispatch_event("compositionend")
    page.unroute(BASE + "/api", hold_activate)
    query(page, "独特文尾")
    page.locator(".search-hit").first.click()
    expect(page.locator("#doc-title")).to_have_text("全文验收")
    visible_tail(page, TAIL)
    page.wait_for_function("() => getSelection()?.toString()==='独特文尾'")
    # Old revisions open normally and never apply their old source offsets.
    query(page, "独特文尾")
    before = api(page, "State")["current"]
    changed = "# 全文验收\n\n前置新段\n\n" + TEXT
    api(page, "Update", {"id": before["id"], "revision": before["revision"], "content": changed, "position": before["position"]})
    page.locator(".search-hit").first.click()
    expect(page.locator("#toast")).to_contain_text("文稿内容已更新")
    expect(page.locator("#preview-content")).to_contain_text("前置新段")
    assert page.evaluate("getSelection()?.toString()") != "独特文尾"
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    # HTML-like input is plain text in both titles and snippets.
    attack = api(page, "New")["current"]
    api(page, "Update", {"id": attack["id"], "revision": attack["revision"], "content": '# <img src=x onerror="window.__searchXSS=1">\n\n<script>window.__searchXSS=1</script>', "position": attack["position"]})
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    query(page, "window.__searchXSS")
    expect(page.locator("#drawer-list img, #drawer-list script")).to_have_count(0)
    assert page.evaluate("window.__searchXSS") is None
    # Search input's composition guard prevents queries and Enter activation.
    requests = []
    page.on("request", lambda request: requests.append(request.post_data_json) if request.url == BASE + "/api" else None)
    field = page.locator("#recent-search")
    field.dispatch_event("compositionstart")
    field.fill("独特文尾")
    field.press("Enter")
    page.evaluate("() => new Promise(resolve=>setTimeout(resolve,220))")
    assert not [r for r in requests if r["method"] == "FilterDocuments" and r["args"] == [{"query": "独特文尾", "tag": ""}]]
    expect(page.locator("#doc-title")).to_contain_text("<img")
    field.dispatch_event("compositionend")
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    page.locator(".cm-content").dispatch_event("compositionstart")
    page.locator(".search-hit").first.click()
    expect(page.locator("#toast")).to_contain_text("输入")
    expect(page.locator("#doc-title")).to_contain_text("<img")
    page.locator(".cm-content").dispatch_event("compositionend")
    field.press("ArrowDown")
    expect(page.locator(".search-title").first).to_be_focused()
    page.keyboard.press("ArrowDown")
    expect(page.locator(".search-hit").first).to_be_focused()
    page.keyboard.press("Escape")
    expect(field).to_be_focused()
    # Delayed old errors cannot override newer input, a clear or a new language.
    held = []
    def hold_search(route):
        request = route.request.post_data_json
        if request["method"] == "FilterDocuments" and request["args"][0]["query"]:
            held.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold_search)
    field.fill("旧查询")
    wait_callback(page, lambda: len(held) == 1)
    field.fill("最新查询")
    page.evaluate("() => new Promise(resolve=>setTimeout(resolve,220))")
    assert len(held) == 1
    held[0].fulfill(status=200, content_type="application/json", body=json.dumps({"error": "old query error"}))
    wait_callback(page, lambda: len(held) == 2)
    expect(page.locator("#search-status")).not_to_contain_text("old query error")
    field.fill("")
    held[1].fulfill(status=200, content_type="application/json", body=json.dumps({"value": result}))
    expect(page.locator(".recent-item")).to_have_count(3)
    expect(page.locator(".search-item")).to_have_count(0)
    field.fill("语言旧查询")
    wait_callback(page, lambda: len(held) == 3)
    palette(page, "English")
    held[2].fulfill(status=200, content_type="application/json", body=json.dumps({"error": "stale language error"}))
    wait_callback(page, lambda: len(held) == 4)
    assert held[3].request.post_data_json["locale"] == "en"
    held[3].continue_()
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    expect(page.locator("#search-status")).to_contain_text("No documents contain")
    expect(page.locator("#search-status")).not_to_contain_text("stale language error")
    page.unroute(BASE + "/api", hold_search)
    palette(page, "简体中文")
    # Save failure preserves text and prevents Activate on result click.
    query(page, "独特文尾")
    updates = []
    def fail_update(route):
        method = route.request.post_data_json["method"]
        if method == "Update":
            updates.append(method)
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"error": "synthetic save failure"}))
        else:
            route.continue_()
    page.route(BASE + "/api", fail_update)
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\n失败时保留输入")
    expect(page.locator("#search-consistency")).to_contain_text("自动保存")
    wait_callback(page, lambda: len(updates) > 0)
    expect(page.locator("#search-consistency")).to_contain_text("未保存")
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    failed_id = api(page, "State")["current"]["id"]
    before_activate = len([r for r in requests if r["method"] == "ActivateSearch"])
    page.locator(".search-hit").first.click()
    expect(page.locator("#toast")).to_contain_text("重试")
    assert api(page, "State")["current"]["id"] == failed_id
    assert len([r for r in requests if r["method"] == "ActivateSearch"]) == before_activate
    expect(page.locator(".cm-content")).to_contain_text("失败时保留输入")
    page.unroute(BASE + "/api", fail_update)
    # A retry that saves successfully still cannot navigate into a new composition.
    held_save = []
    def hold_save(route):
        if route.request.post_data_json["method"] == "Update":
            held_save.append(route)
        else:
            route.continue_()
    page.route(BASE + "/api", hold_save)
    page.locator(".search-hit").first.click()
    wait_callback(page, lambda: len(held_save) == 1)
    page.locator("#toast").evaluate("(el)=>{el.textContent='';el.hidden=true}")
    page.locator(".cm-content").dispatch_event("compositionstart")
    held_save[0].continue_()
    expect(page.locator("#toast")).to_contain_text("输入")
    expect(page.locator("#toast")).to_be_visible()
    assert len([r for r in requests if r["method"] == "ActivateSearch"]) == before_activate
    expect(page.locator("#doc-title")).to_contain_text("<img")
    expect(page.locator(".cm-content")).to_contain_text("失败时保留输入")
    page.locator(".cm-content").dispatch_event("compositionend")
    page.unroute(BASE + "/api", hold_save)
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+s")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    expect(page.locator("#search-consistency")).to_be_hidden()
    # A new unsaved term becomes searchable after the ordinary autosave only.
    query(page, "自动保存新词")
    expect(page.locator(".search-item")).to_have_count(0)
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\n自动保存新词")
    expect(page.locator(".search-hit")).to_contain_text("自动保存新词")
    saved = api(page, "State")["current"]
    assert "自动保存新词" in saved["content"]
    # Position-only persistence must not issue another filter query.
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "ready")
    search_count = len([r for r in requests if r["method"] == "FilterDocuments"])
    page.locator(".cm-content").focus()
    page.keyboard.press("ArrowLeft")
    page.evaluate("() => new Promise(resolve=>setTimeout(resolve,900))")
    assert search_count == len([r for r in requests if r["method"] == "FilterDocuments"])
    # Removed results fail safely without leaving the current document.
    query(page, "独特文尾")
    api(page, "Delete", current["id"])
    page.locator(".search-hit").first.click()
    expect(page.locator("#toast")).to_contain_text("文稿已移除")
    assert api(page, "State")["current"]["id"] == saved["id"]
    query(page, "自动保存新词")
    field.focus()
    field.press("Escape")
    expect(field).to_have_value("")
    expect(page.locator(".recent-remove")).to_have_count(2)
    expect(page.locator(".search-item")).to_have_count(0)
    # Request locales are isolated and title ranges refer to their returned title.
    empty = api(page, "New")["current"]
    zh = api(page, "Search", "未命名", locale="zh-Hans")
    en = api(page, "Search", "untitled", locale="en")
    assert any(i["id"] == empty["id"] and i["title"].startswith("未命名") for i in zh["items"])
    assert any(i["id"] == empty["id"] and i["title"].startswith("Untitled") for i in en["items"])
    assert api(page, "Search", "untitled", locale="zh-Hans")["total"] == 0
    # Search errors retain localized prose and expose a working Retry action.
    field.fill("a" * 129)
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "error")
    expect(page.locator("#search-status")).to_contain_text("128")
    with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json["method"] == "FilterDocuments"):
        page.locator(".search-retry").click()
    expect(page.locator("#drawer-list")).to_have_attribute("data-search-state", "error")
    query(page, "自动保存新词")
    page.locator('[data-action="settings"]').click()
    # Walk every shipped theme (labels are localized) instead of hardcoding the old eleven names.
    radios = page.locator('#themes [role="radio"]')
    theme_names = radios.evaluate_all("els => els.map(el => el.getAttribute('aria-label'))")
    assert theme_names and len(set(theme_names)) == radios.count(), theme_names
    for name in theme_names:
        page.get_by_role("radio", name=name, exact=True).click()
        # Resolve --foreground through a probe: the raw custom property is not in rgb() form.
        assert page.locator(".search-hit mark").first.evaluate("(el)=>{const probe=document.createElement('i');probe.style.color='var(--foreground)';document.body.append(probe);const foreground=getComputedStyle(probe).color;probe.remove();const style=getComputedStyle(el);return style.color===foreground||style.color!==style.backgroundColor}"), name
    page.locator('[data-close="appearance"]').click()
    for width in [1440, 800, 680]:
        page.set_viewport_size({"width": width, "height": 850})
        if width == 800:
            # Crossing the 1180px dock breakpoint closes the docked drawer via an
            # async matchMedia change; wait for it before reopening as an overlay.
            expect(page.locator(".workspace")).not_to_have_class("workspace sidebar-docked")
            expect(page.locator("#drawer")).not_to_be_visible()
        if not page.locator("#drawer").is_visible():
            page.locator("#sidebar-button").click()
        expect(page.locator(".search-hit")).to_be_visible()
        assert not page.evaluate("document.documentElement.scrollWidth>innerWidth")
        assert not page.locator("#drawer-list").evaluate("(el)=>el.scrollWidth>el.clientWidth+1")
    page.set_viewport_size({"width": 1440, "height": 850})
    query(page, "自动保存新词")
    page.screenshot(path=str(ARTIFACTS / "search.png"))
    print("PASS: full Markdown tail, folding/UTF-16, undo, read/split/source/load ordering, stale revisions, XSS, composition/keyboard, one flight/stale success+error/language, save failure/autosave/position, removed results and locale isolation")


def navigation_formats(page):
    content = "---\ntitle: 格式搜索验收\nnote: PropertiesSearchNeedle\n---\n\n# 格式搜索验收\n\n"
    content += "\n\n".join("用于检查定位的正文。" * 30 for _ in range(30))
    content += "\n\n| 名称 | 值 |\n| --- | --- |\n| 搜索 | SourceTableNeedle |\n\n"
    content += "$$\n\\operatorname{MathSourceNeedle}+x=1\n$$"
    doc = api(page, "New")["current"]
    saved = api(page, "Update", {"id": doc["id"], "revision": doc["revision"], "content": content, "position": doc["position"]})
    page.reload()
    expect(page.locator("#doc-title")).to_have_text("格式搜索验收")
    page.locator('[data-view="read"]').click()
    query(page, "PropertiesSearchNeedle")
    page.locator(".search-hit").first.click()
    expect(page.locator("#preview .md-front-matter")).to_have_attribute("open", "")
    expect(page.locator("#preview .md-front-matter")).to_be_in_viewport()
    query(page, "SourceTableNeedle")
    page.locator(".search-hit").first.click()
    expect(page.locator("#preview table")).to_be_in_viewport()
    assert api(page, "State")["appearance"]["layout"] == "read"
    for term in ("SourceTableNeedle", "MathSourceNeedle", "PropertiesSearchNeedle"):
        query(page, term)
        page.locator(".search-source").first.click()
        expect(page.locator(".paper")).to_have_class(re.compile("source-mode"))
        page.wait_for_function("text=>getSelection()?.toString()===text", arg=term)
        if term == "MathSourceNeedle":
            expect(page.locator("#preview .math-display")).to_be_in_viewport()
    current = api(page, "State")["current"]
    assert current["content"] == content and current["revision"] == saved["revision"]
    print("PASS: front matter expands in reading view, table block navigation, exact properties/table/math source selection without content or revision changes")


def performance(page):
    terms = [f"ui_perf_{i:02d}" for i in range(30)]
    text = "# UI performance\n\n" + " ".join(terms) + "\n\n"
    text += "four KiB text with a literal needle. " * ((4096 - len(text)) // 36)
    for i in range(1000):
        current = api(page, "New")["current"]
        api(page, "Update", {"id": current["id"], "revision": current["revision"], "content": text, "position": current["position"]})
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    if not page.locator("#drawer").is_visible():
        page.locator("#sidebar-button").click()
    times = []
    for term in terms:
        ms = page.evaluate("""query=>new Promise((resolve,reject)=>{
          const list=document.querySelector('#drawer-list'),input=document.querySelector('#recent-search');
          const start=performance.now();
          const observer=new MutationObserver(()=>{
            if(list.dataset.searchQuery===query&&list.dataset.searchState==='ready'){
              clearTimeout(deadline);observer.disconnect();resolve(performance.now()-start);
            }
          });
          const deadline=setTimeout(()=>{observer.disconnect();reject(Error('Search did not become ready: '+query))},7000);
          observer.observe(list,{attributes:true});
          input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));
        })""", term)
        assert api(page, "Search", term)["total"] == 1000
        expect(page.locator(".search-item")).to_have_count(100)
        expect(page.locator("#drawer-list")).to_contain_text("前 100")
        times.append(ms)
    p95 = sorted(times)[28]
    record = {"documents": 1000, "bytesPerDocument": len(text.encode()), "textBytes": 1000 * len(text.encode()), "queries": 30, "uiP95Ms": p95, "allMs": times}
    (ARTIFACTS / "performance.json").write_text(json.dumps(record, indent=2))
    assert p95 <= 600, record
    print(f"PASS: 1000 × {len(text.encode())} bytes, 30 distinct queries, UI P95 {p95:.1f}ms (budget 600ms), top-100 DOM/truncation")


with sync_playwright() as playwright:
    browser = launch(playwright.chromium)
    page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 850})
    page.set_default_timeout(7000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        run(page)
        navigation_formats(page)
        if os.environ.get("LIUBAI_SEARCH_PERF") == "1":
            performance(page)
        assert not errors, errors
    except Exception:
        save_failure(ARTIFACTS, page, errors)
        raise
    finally:
        browser.close()
