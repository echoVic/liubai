"""Reader code/properties keyboard access and local state, in two engines.

Run via sh scripts/e2e.sh check-reader-code against an isolated data directory.
WebKit is optional locally; REQUIRE_WEBKIT=1 makes its absence a failure.
"""
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1]
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-reader-code-"))
FAILURES = []
THEMES = json.loads((Path(__file__).resolve().parents[1] / "src/themes.json").read_text())
TEXT = """---
title: Keyboard reading
description: """ + "属性需要完整阅读。" * 100 + """
---

# Keyboard reading

[Before code](#keyboard-reading)

```typescript
const longLine = '""" + "readable_code_" * 100 + """';
```

[After code](#keyboard-reading)

```
short
```

<pre>""" + "author_html_" * 100 + """</pre>

<details><summary>Extra details</summary>
Folded content
</details>
""".rstrip("\n")


def check(name, ok, value=None):
    print(("PASS " if ok else "FAIL ") + name, json.dumps(value, ensure_ascii=False) if value is not None else "", flush=True)
    if not ok:
        FAILURES.append(name)


def current(page):
    return page.request.post(BASE + "/api", data={"method": "State", "args": []}).json()["value"]["current"]


def fixture(page):
    page.locator('[data-view="split"]').click()
    source = page.locator('#format-bar [data-action="source"]')
    if source.get_attribute("aria-pressed") != "true":
        source.click()
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text(TEXT)
    expect(page.locator("#save-status")).to_have_text(re.compile("^(草稿已保存|Draft saved)$"))
    assert current(page)["content"] == TEXT
    page.locator('[data-view="read"]').click()
    expect(page.locator("#preview-content pre")).to_have_count(4)


def keyboard_pan(page, target, before, label):
    before.focus()
    page.keyboard.press("Tab")
    focused = target.evaluate("e=>e===document.activeElement")
    check(label + " Tab enters", focused)
    target.evaluate("e=>e.scrollLeft=0")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(200)  # Native keyboard scrolling is animated.
    check(label + " right arrow scrolls", target.evaluate("e=>e.scrollLeft") > 0)
    check(label + " visible focus", target.evaluate("e=>getComputedStyle(e).outlineStyle!=='none'&&e.matches(':focus-visible')"))
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(200)
    check(label + " left edge reachable", target.evaluate("e=>e.scrollLeft") <= 1)
    page.keyboard.press("Tab")
    check(label + " Tab leaves", target.evaluate("e=>!e.contains(document.activeElement)"))
    target.focus()
    page.keyboard.press("Shift+Tab")
    # WebKit's full keyboard access setting may skip ordinary links.
    check(label + " Shift+Tab exits", target.evaluate("e=>!e.contains(document.activeElement)"))


def run(pw, engine):
    browser = getattr(pw, engine).launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900}, locale="zh-CN")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until="networkidle")
    fixture(page)
    root = page.locator("#preview-content")
    code = root.locator(".md-pre").first
    short = root.locator(".md-pre").last
    props = root.locator(".md-front-matter pre")
    details = root.locator("details").last
    summary = root.locator(".md-front-matter summary")
    for width, height in [(1440, 900), (900, 700), (360, 640), (320, 568), (740, 320)]:
        page.set_viewport_size({"width": width, "height": height})
        keyboard_pan(page, code, root.locator("a").first, f"{engine} {width} code")
        summary.focus()
        if not summary.evaluate("e=>e.parentElement.open"):
            page.keyboard.press("Enter")
        keyboard_pan(page, props, summary, f"{engine} {width} properties")
        check(f"{engine} {width} names", code.get_attribute("aria-label") == "代码块，可左右滚动" and props.get_attribute("aria-label") == "文稿属性，可左右滚动")
        check(f"{engine} {width} fitting code skips Tab", short.get_attribute("tabindex") == "-1")
        check(f"{engine} {width} code semantics", code.locator("code.language-typescript").count() == 1 and code.get_attribute("role") == "region")
        check(f"{engine} {width} author HTML supported", root.locator("pre").last.get_attribute("tabindex") == "0")
        check(f"{engine} {width} page contains wide blocks", root.locator("article").evaluate("e=>e.scrollWidth<=e.clientWidth+1"))
        if width in (1440, 360):
            code.focus()
            page.screenshot(path=str(ARTIFACTS / f"{engine}-{width}.png"))

    # Narrowing a formerly fitting block activates only its needed Tab stop.
    short.evaluate("e=>e.querySelector('code').textContent='fitting_code_'.repeat(4)")
    page.set_viewport_size({"width": 1440, "height": 900})
    expect(short).to_have_attribute("tabindex", "-1")
    page.set_viewport_size({"width": 320, "height": 568})
    expect(short).to_have_attribute("tabindex", "0")
    check(engine + " resize updates keyboard access", True)
    # Restore the fixture through the actual editor before checking persistence.
    fixture(page)
    if not props.evaluate("e=>e.parentElement.open"):
        summary.click()
    if not details.evaluate("e=>e.open"):
        details.locator("summary").click()
    code.evaluate("e=>e.scrollLeft=700")
    props.evaluate("e=>e.scrollLeft=650")
    page.locator('[data-view="split"]').click()
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\nNew paragraph.")
    page.wait_for_function("()=>document.querySelector('#preview-content').textContent.includes('New paragraph.')")
    check(engine + " code keeps horizontal position", code.evaluate("e=>e.scrollLeft") >= 650)
    check(engine + " properties stay open after editing", props.evaluate("e=>e.parentElement.open"))
    check(engine + " properties keep horizontal position", props.evaluate("e=>e.scrollLeft") >= 600)
    check(engine + " author details stay open after editing", details.evaluate("e=>e.open"))
    summary.click()
    details.locator("summary").click()
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\nCollapsed paragraph.")
    page.wait_for_function("()=>document.querySelector('#preview-content').textContent.includes('Collapsed paragraph.')")
    check(engine + " collapsed state stays collapsed after editing", not props.evaluate("e=>e.parentElement.open") and not details.evaluate("e=>e.open"))
    summary.click()
    details.locator("summary").click()
    page.locator('[data-view="read"]').click()
    page.evaluate("""()=>{localStorage.setItem('mygo:locale','en');
      window.dispatchEvent(new Event('mygo:locale'))}""")
    expect(page.locator("html")).to_have_attribute("lang", "en")
    check(engine + " live English code name", code.get_attribute("aria-label") == "Code Block, scroll horizontally")
    check(engine + " live English properties name", props.get_attribute("aria-label") == "Document Properties, scroll horizontally")
    check(engine + " language preserves details", props.evaluate("e=>e.parentElement.open") and details.evaluate("e=>e.open"))

    for theme in THEMES:
        page.locator('[data-action="settings"]').click()
        page.locator(f'#themes [data-theme="{theme["id"]}"]').click()
        page.keyboard.press("Escape")
        code.focus()
        ratios = code.evaluate("""e=>{
          const rgb=c=>{const n=document.createElement('span');n.style.color=c;e.append(n);const s=getComputedStyle(n).color;n.remove();return s.match(/[\\d.]+/g).slice(0,3).map(Number)};
          const lum=c=>rgb(c).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
          const contrast=(a,b)=>{a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
          const s=getComputedStyle(e),paper=s.getPropertyValue('--card'),bg=s.backgroundColor;
          return {text:contrast(s.color,bg),focus:Math.min(contrast(s.getPropertyValue('--ring'),paper),contrast(s.getPropertyValue('--ring'),bg)),
            thumb:contrast(s.getPropertyValue('--muted-foreground'),bg)};
        }""")
        check(f'{engine} {theme["id"]} code contrast', ratios["text"] >= 4.5 and min(ratios["focus"], ratios["thumb"]) >= 3, ratios)
        check(f'{engine} {theme["id"]} expanded state', props.evaluate("e=>e.parentElement.open") and details.evaluate("e=>e.open"))
        if theme["id"] in ("paper", "nord"):
            page.screenshot(path=str(ARTIFACTS / f'{engine}-{theme["id"]}.png'))
    check(engine + " Markdown unchanged by reader actions", current(page)["content"] == TEXT + "\n\nNew paragraph.\n\nCollapsed paragraph.")
    if engine == "chromium":
        touch_context = browser.new_context(has_touch=True, is_mobile=True, viewport={"width": 360, "height": 640}, locale="zh-CN")
        touch = touch_context.new_page()
        touch.goto(BASE, wait_until="networkidle")
        touch.locator('[data-view="read"]').tap()
        target = touch.locator("#preview-content .md-pre").first
        target.scroll_into_view_if_needed()
        bounds = target.bounding_box()
        y = max(bounds["y"] + 10, min(bounds["y"] + bounds["height"] / 2, 550))
        cdp = touch_context.new_cdp_session(touch)
        for kind, x in [("touchStart", 280), ("touchMove", 240), ("touchMove", 170), ("touchMove", 100), ("touchEnd", None)]:
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if x is None else [{"x": x, "y": y}]})
            touch.wait_for_timeout(25)
        touch.wait_for_timeout(200)
        check("Chromium real touch code swipe", target.evaluate("e=>e.scrollLeft") > 0)
        touch_context.close()
    previous = current(page)["id"]
    with page.expect_response(lambda r: r.url.endswith("/api") and r.request.post_data_json.get("method") == "New"):
        page.keyboard.press("Meta+n")
    page.locator('[data-view="split"]').click()
    expect(page.locator(".cm-placeholder")).to_be_visible()
    created = current(page)
    check(engine + " new document opened empty", created["id"] != previous and created["content"] == "")
    fixture(page)
    check(engine + " new document does not inherit reader state", not props.evaluate("e=>e.parentElement.open") and not details.evaluate("e=>e.open") and code.evaluate("e=>e.scrollLeft") == 0)
    check(engine + " no runtime errors", not errors, errors)
    browser.close()


with sync_playwright() as pw:
    run(pw, "chromium")
    if Path(pw.webkit.executable_path).exists():
        run(pw, "webkit")
    else:
        check("WebKit available when required", not os.environ.get("REQUIRE_WEBKIT"))
        print("SKIP WebKit not installed", flush=True)
print(f"RESULT failures={len(FAILURES)} artifacts={ARTIFACTS}", flush=True)
sys.exit(bool(FAILURES))
