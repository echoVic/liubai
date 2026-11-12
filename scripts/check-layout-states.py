"""Cross-module UI review: view modes, drawers, find, recovery and locale.

PLAYWRIGHT_ENGINE=webkit runs the same layout/keyboard scenarios in WebKit.
Synthesized touch gestures require Chromium's CDP input API.
"""
import json
import os

from playwright.sync_api import sync_playwright, expect
from checklib import api, base_url, evidence, launch

BASE = base_url()
ENGINE = os.environ.get("PLAYWRIGHT_ENGINE", "chromium")
OUT = evidence("liubai-layout-states-qa-")
FAILURES = []
RECORDS = []
TEXT = "\n\n".join([
    "---\ntitle: 全模块组合检查\ntags: [布局, 交互]\n---",
    "# 全模块组合检查",
    "查找标记：键盘和指针都应能继续操作。",
    "> [!NOTE]\n> 切换视图时保留文稿。",
    "| 日期 | 内容 | 进度 |\n| --- | --- | --- |\n| 11 月 | 正文布局检查 | 100% |",
    *[f"## 第{i}节\n\n" + "正文用于检查阅读位置和滚动容器。" * 7 for i in range(1, 12)],
])


def check(name, ok, data=None):
    record = {"name": name, "passed": bool(ok), "evidence": data}
    RECORDS.append(record)
    print(("PASS " if ok else "FAIL ") + name,
          json.dumps(data, ensure_ascii=False) if data is not None else "",
          flush=True)
    if not ok:
        FAILURES.append(name)


def settle(page):
    page.evaluate("""()=>new Promise(resolve=>{
      let count=0;function frame(){if(++count>=5)resolve();else requestAnimationFrame(frame)}
      requestAnimationFrame(frame);
    })""")


def bounds(page, name, selector, allow_scroll=False):
    v = page.locator(selector).evaluate("""e=>{
      const r=e.getBoundingClientRect();
      return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,
       scroll:e.scrollWidth,client:e.clientWidth};
    }""")
    w, h = page.viewport_size.values()
    check(name, v["x"] >= -1 and v["y"] >= -1 and v["right"] <= w + 1
          and v["bottom"] <= h + 1 and (allow_scroll or v["scroll"] <= v["client"] + 1), v)


with sync_playwright() as pw:
    browser = launch(getattr(pw, ENGINE))
    setup = browser.new_page(locale="zh-CN")
    d = api(setup, "State")["current"]
    api(setup, "Update", {"id": d["id"], "revision": d["revision"], "content": TEXT,
        "position": {"anchor": 0, "head": 0, "scroll": 0}})
    setup.close()
    for locale in ["zh-CN", "en-US"]:
        ctx = browser.new_context(locale=locale, reduced_motion="reduce",
                                  viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle")
        expect(page.locator("#doc-title")).not_to_have_text("")
        for w, h in [(1440, 900), (900, 700), (360, 640), (320, 568), (740, 320)]:
            page.set_viewport_size({"width": w, "height": h})
            # Each layout has the drawer open alongside a real find operation.
            for layout in ["single", "split", "read"]:
                label = f"{locale}-{w}x{h}-{layout}"
                page.locator(f'[data-view="{layout}"]').click()
                expect(page.locator(f'[data-view="{layout}"]')).to_have_attribute("aria-checked", "true")
                settle(page)
                bounds(page, label + " topbar", ".topbar")
                bounds(page, label + " workspace", ".workspace")
                if layout != "read":
                    strip = w <= 480 or (w <= 819 and h <= 400)
                    bounds(page, label + " format bar", "#format-bar", allow_scroll=strip)
                    if strip:
                        bar = page.locator("#format-bar")
                        controls = bar.locator("button:visible:not(:disabled)")
                        last = controls.last
                        controls.first.focus()
                        for _ in range(controls.count() + 1):
                            if last.evaluate("e=>e===document.activeElement"):
                                break
                            page.keyboard.press("Tab")
                        check(label + " Tab reaches last tool",
                              last.evaluate("e=>e===document.activeElement"))
                        settle(page)
                        visible = last.evaluate("""e=>{
                          const r=e.getBoundingClientRect(),b=e.closest('nav').getBoundingClientRect();
                          return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
                                  barLeft:b.left,barRight:b.right,barTop:b.top,barBottom:b.bottom};
                        }""")
                        check(label + " last tool scrolls fully into view",
                              visible["left"] >= visible["barLeft"] and
                              visible["right"] <= visible["barRight"] and
                              visible["top"] >= visible["barTop"] and
                              visible["bottom"] <= visible["barBottom"], visible)
                        bar.evaluate("e=>e.scrollLeft=0")
                    if layout == "split" and w >= 640 and h <= 400:
                        panes = page.evaluate("""()=>{
                         const a=document.querySelector('.editor-pane').getBoundingClientRect(),
                               b=document.querySelector('#preview').getBoundingClientRect();
                         return {editorRight:a.right,previewLeft:b.left,editorWidth:a.width,
                                 previewWidth:b.width,editorTop:a.top,previewTop:b.top};
                        }""")
                        check(label + " short landscape panes sit side by side",
                              abs(panes["editorRight"] + 1 - panes["previewLeft"]) < 1 and
                              abs(panes["editorWidth"] - panes["previewWidth"]) < 1 and
                              abs(panes["editorTop"] - panes["previewTop"]) < 1, panes)
                else:
                    check(label + " editor inaccessible while reading",
                          page.locator(".editor-pane").is_hidden())
                page.locator("#document-find-button").click()
                page.locator("#find-query").fill("正文")
                expect(page.locator("#find-count")).not_to_have_text("")
                if layout != "read":
                    page.locator("#find-replace-toggle").click()
                    expect(page.locator("#find-replace-row")).to_be_visible()
                settle(page)
                bounds(page, label + " find", "#document-find")
                page.locator("#sidebar-button").click()
                expect(page.locator("#drawer")).to_be_visible()
                settle(page)
                bounds(page, label + " sidebar", "#drawer")
                bounds(page, label + " find beside sidebar", "#document-find")
                # Clicking the find field dismisses the overlay drawer, while
                # a wide docked sidebar remains available beside the document.
                page.locator("#find-query").click()
                check(label + " sidebar dismissal",
                      page.locator("#drawer").is_visible() == (w >= 1180))
                page.keyboard.press("Enter")
                page.keyboard.press("Escape")
                expect(page.locator("#document-find")).to_be_hidden()
                check(label + " find returns focus",
                      page.locator(".preview-scroll" if layout == "read" else ".cm-content").evaluate(
                          "e=>e===document.activeElement"))
                if page.locator("#drawer").is_visible():
                    page.locator('#drawer [data-close="drawer"]').click()
                if layout == "read":
                    page.locator(".preview-scroll").evaluate("e=>e.scrollTop=0")
                current = api(page, "State")["current"]
                def conflict(route):
                    if route.request.post_data_json.get("method") == "Status":
                        route.fulfill(status=200, content_type="application/json",
                                      body=json.dumps({"value": {
                                          "id": current["id"], "revision": current["revision"],
                                          "conflict": True, "statusCode": "diskConflict",
                                      }}))
                    else:
                        route.continue_()
                page.route(BASE + "/api", conflict)
                page.evaluate("window.dispatchEvent(new Event('focus'))")
                expect(page.locator('#banner[data-kind="conflict"]')).to_be_visible(timeout=10000)
                settle(page)
                bounds(page, label + " conflict banner", "#banner")
                if layout != "read":
                    available = page.locator(".editor-scroll").evaluate("e=>e.clientHeight")
                    minimum = 100 if layout == "split" and w >= 640 and h <= 400 else 40
                    check(label + " editing space after conflict", available >= minimum, available)
                if layout != "single":
                    available = page.locator(".preview-scroll").evaluate("e=>e.clientHeight")
                    minimum = 100 if layout == "split" and w >= 640 and h <= 400 else 40
                    check(label + " reading space after conflict", available >= minimum, available)
                page.locator('[data-action="deliver"]').click()
                expect(page.locator("#delivery-dialog")).to_be_visible()
                bounds(page, label + " export modal", "#delivery-dialog")
                page.keyboard.press("Escape")
                expect(page.locator('[data-action="deliver"]')).to_be_focused()
                if layout == "split" and w in [1440, 360, 740]:
                    page.screenshot(path=str(OUT / f"{label}.png"))
                # The replace expansion is remembered: reset it once rather
                # than accidentally testing a closed row on the next layout.
                if layout != "read":
                    page.locator("#document-find-button").click()
                    if page.locator("#find-replace-toggle").get_attribute("aria-expanded") == "true":
                        page.locator("#find-replace-toggle").click()
                    page.keyboard.press("Escape")
                page.unroute(BASE + "/api", conflict)
                page.reload(wait_until="networkidle")
        check(locale + " content unchanged", api(page, "State")["current"]["content"] == TEXT)
        check(locale + " no page errors", not errors, errors)
        ctx.close()
    if ENGINE == "chromium":
        touch_context = browser.new_context(locale="zh-CN", has_touch=True, is_mobile=True,
                                             viewport={"width": 740, "height": 320})
        touch = touch_context.new_page()
        touch.goto(BASE, wait_until="networkidle")
        touch.locator('[data-view="single"]').click()
        bar = touch.locator("#format-bar")
        settle(touch)
        box = bar.bounding_box()
        client = touch_context.new_cdp_session(touch)
        y = box["y"] + 24
        client.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 680, "y": y}]})
        for x in [620, 560, 500, 440, 380, 320, 260]:
            client.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
        client.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        touch.wait_for_function("()=>document.querySelector('#format-bar').scrollLeft>80")
        check("touch swipes compact toolbar", bar.evaluate("e=>e.scrollLeft") > 80)
        check("touch toolbar keeps page width", touch.evaluate("document.documentElement.scrollWidth<=innerWidth"))
        check("touch toolbar leaves content unchanged", api(touch, "State")["current"]["content"] == TEXT)
        touch.screenshot(path=str(OUT / "touch-toolbar.png"))
        touch_context.close()
    else:
        print("SKIP synthesized touch: CDP input is Chromium-only", flush=True)
    browser.close()
    (OUT / "results.json").write_text(json.dumps(RECORDS, indent=2, ensure_ascii=False))
    print(f"RESULT {len(RECORDS)} checks, {len(FAILURES)} failures", flush=True)
    if FAILURES:
        raise SystemExit(1)
