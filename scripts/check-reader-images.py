"""Reader image viewer: keyboard zoom, full-image panning and live locale."""
import re
from playwright.sync_api import sync_playwright, expect
from checklib import base_url, evidence, launch

BASE = base_url()
OUT = evidence("liubai-reader-images-qa-")
FAILURES = []
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1000"><rect width="1800" height="1000" fill="#eee"/><rect width="100" height="1000" fill="#b22"/><rect x="1700" width="100" height="1000" fill="#26a"/><text x="180" y="300" font-size="100">1800 pixel image</text></svg>'

def check(label, ok, evidence=None):
    print(("PASS " if ok else "FAIL ") + label, evidence or "", flush=True)
    if not ok:
        FAILURES.append(label)

with sync_playwright() as pw:
    browser = launch(pw.chromium)
    page = browser.new_page(viewport={"width": 900, "height": 700}, locale="zh-CN",
                            reduced_motion="reduce")
    page.add_init_script("window.__imageLinks=[];window.open=u=>{window.__imageLinks.push(u);return null}")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="networkidle")
    page.locator(".cm-content").focus()
    page.keyboard.insert_text("# 图片查看检查\n\n")
    page.locator("#image-input").set_input_files(
        {"name": "宽幅查看图.svg", "mimeType": "image/svg+xml", "buffer": SVG})
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    state = page.request.post(BASE + "/api", data={"method": "State", "args": []}).json()["value"]
    asset = re.search(r"liubai-asset:[^)\s]+", state["current"]["content"]).group()
    text = f"# 图片查看检查\n\n![宽幅查看图]({asset})\n\n[![链接图片]({asset})](https://example.invalid/image-link)"
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text(text)
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    page.locator('[data-view="read"]').click()
    thumb = page.locator('#preview-content img[data-zoomable]').first
    expect(thumb).to_be_visible()
    page.wait_for_function("()=>document.querySelector('#preview-content img').naturalWidth===1800")
    thumb.focus()
    page.keyboard.press("Enter")
    viewer = page.locator(".reader-image-viewer")
    expect(viewer).to_be_visible()
    full = viewer.locator(".reader-image-full")
    stage = viewer.locator(".reader-image-stage")
    page.keyboard.press("Tab")
    check("Tab reaches the image size control", full.evaluate("e=>e===document.activeElement"))
    check("image size control has button semantics",
          full.get_attribute("role") == "button" and full.get_attribute("aria-pressed") == "false")
    page.keyboard.press("Enter")
    check("Enter shows actual size", full.evaluate("e=>e.classList.contains('is-actual')"))
    check("actual-size state is announced", full.get_attribute("aria-pressed") == "true")
    focus = stage.evaluate("e=>({style:getComputedStyle(e).outlineStyle,width:getComputedStyle(e).outlineWidth,color:getComputedStyle(e).outlineColor})")
    check("zoom focus remains visible on the bounded stage",
          focus == {"style": "solid", "width": "2px", "color": "rgb(255, 255, 255)"}, focus)
    check("image uses the stage ring without a browser-blue outline",
          full.evaluate("e=>getComputedStyle(e).outlineStyle==='none'"))
    for key, axis in [("ArrowRight", "scrollLeft"), ("ArrowDown", "scrollTop")]:
        page.keyboard.press(key)
        try:
            page.wait_for_function("(axis)=>document.querySelector('.reader-image-stage')[axis]>0", arg=axis, timeout=2000)
            check("keyboard pans " + axis, True)
        except Exception:
            check("keyboard pans " + axis, False)
    page.keyboard.press("Space")
    check("Space returns to fit", not full.evaluate("e=>e.classList.contains('is-actual')"))
    # Pointer activation remains usable even on the old keyboard-inaccessible UI.
    if not full.evaluate("e=>e.classList.contains('is-actual')"):
        full.click()
    for width, height in [(900, 700), (360, 640), (320, 568), (740, 320)]:
        page.set_viewport_size({"width": width, "height": height})
        stage.evaluate("e=>{e.scrollLeft=0;e.scrollTop=0}")
        edge = stage.evaluate("""e=>{
          const s=e.getBoundingClientRect(),i=e.querySelector('img').getBoundingClientRect();
          return {stageLeft:s.left,stageTop:s.top,imageLeft:i.left,imageTop:i.top,
                  imageWidth:i.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};
        }""")
        check(f"{width} original left and top edges reachable",
              edge["imageLeft"] >= edge["stageLeft"] - 1 and
              edge["imageTop"] >= edge["stageTop"] - 1, edge)
        if width in [900, 360]:
            page.screenshot(path=str(OUT / f"actual-start-{width}.png"))
        stage.evaluate("e=>{e.scrollLeft=e.scrollWidth;e.scrollTop=e.scrollHeight}")
        end = stage.evaluate("""e=>{
          const s=e.getBoundingClientRect(),i=e.querySelector('img').getBoundingClientRect();
          return {stageRight:s.right,stageBottom:s.bottom,imageRight:i.right,imageBottom:i.bottom};
        }""")
        check(f"{width} original right and bottom edges reachable",
              end["imageRight"] <= end["stageRight"] + 1 and
              end["imageBottom"] <= end["stageBottom"] + 1, end)
        page.screenshot(path=str(OUT / f"actual-{width}.png"))
    page.keyboard.press("Escape")
    check("Escape restores thumbnail focus", thumb.evaluate("e=>e===document.activeElement"))
    page.evaluate("""()=>{localStorage.setItem('mygo:locale','en');
      window.dispatchEvent(new Event('mygo:locale'))}""")
    expect(page.locator("html")).to_have_attribute("lang", "en")
    # The dialog is reused; all of its names must use the new locale.
    thumb.focus()
    page.keyboard.press("Enter")
    expect(viewer).to_be_visible()
    check("reused viewer dialog follows English", viewer.get_attribute("aria-label") == "View image")
    check("reused close control follows English",
          viewer.locator(".reader-image-close").get_attribute("aria-label") == "Close")
    check("reused zoom control follows English",
          "Original size" in (full.get_attribute("aria-label") or ""))
    page.evaluate("""()=>{localStorage.setItem('mygo:locale','zh-Hans');
      window.dispatchEvent(new Event('mygo:locale'))}""")
    check("open viewer updates language immediately", viewer.get_attribute("aria-label") == "查看图片")
    check("open close control updates language immediately",
          viewer.locator(".reader-image-close").get_attribute("aria-label") == "关闭")
    page.keyboard.press("Escape")
    thumb.focus()
    page.keyboard.press("Enter")
    check("reused viewer returns to Chinese", viewer.get_attribute("aria-label") == "查看图片")
    check("reopening resets actual-size state",
          not full.evaluate("e=>e.classList.contains('is-actual')") and
          full.get_attribute("aria-pressed") == "false")
    check("no page errors", not errors, errors)
    page.keyboard.press("Escape")
    link = page.locator('#preview-content a[href="https://example.invalid/image-link"]')
    check("linked image keeps anchor semantics",
          link.locator("img").get_attribute("role") is None and link.locator("img").get_attribute("data-zoomable") is None)
    link.click()
    check("linked image opens its destination", page.evaluate("window.__imageLinks") == ["https://example.invalid/image-link"])
    check("linked image does not open the viewer", not viewer.is_visible())
    saved = page.request.post(BASE + "/api", data={"method": "State", "args": []}).json()["value"]["current"]["content"]
    check("viewer leaves Markdown unchanged", saved == text)
    browser.close()
print(f"RESULT failures={len(FAILURES)}", flush=True)
raise SystemExit(1 if FAILURES else 0)
