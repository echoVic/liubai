"""Dialog recovery states, narrow layouts, themes, touch and localized validation.

Run via sh scripts/e2e.sh check-dialogs with isolated data. Native menu coverage
uses the registered frontend event and does not verify macOS UI or quitting.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1]
FAILURES = []
MISSING = [f"图片/{i:02d}-" + "需要恢复的截图文件" * 8 + ".png" for i in range(45)]
THEMES = json.loads((Path(__file__).resolve().parents[1] / "src/themes.json").read_text())
BRIDGE = """window.__settingsEvents={};window.mygo={
 locale:'zh-CN',on:(name,fn)=>window.__settingsEvents[name]=fn,
 call:async(method,...args)=>{
  const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({method:method.replace(/^Desktop\\./,''),args,locale:'zh-CN'})}).then(r=>r.json());
  if(r.error)throw Error(r.error);return r.value;
 }
}"""
CONTRAST = """e=>{
 const rgb=c=>{const n=document.createElement('span');n.style.color=c;e.append(n);const s=getComputedStyle(n).color;n.remove();return s.match(/[\\d.]+/g).slice(0,3).map(Number)};
 const lum=c=>rgb(c).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 const css=getComputedStyle(e),text=getComputedStyle(e.querySelector('p')),button=getComputedStyle(e.querySelector('button.primary,button.danger')),
  paper=css.backgroundColor;
 return {body:contrast(css.color,paper),note:contrast(text.color,paper),action:contrast(button.color,button.backgroundColor),
 focus:contrast(css.getPropertyValue('--ring'),paper)};
}"""

def check(name, ok, data=None):
    print(("PASS " if ok else "FAIL ") + name, json.dumps(data, ensure_ascii=False) if data is not None else "", flush=True)
    if not ok:
        FAILURES.append(name)

def look(page, id, state):
    d = page.locator("#" + id)
    expect(d).to_be_visible()
    page.wait_for_timeout(170)
    data = d.evaluate("""e=>{
     const b=e.getBoundingClientRect(),h=e.querySelector('h2'),hr=h?.getBoundingClientRect(),
      actions=e.querySelector('.dialog-actions'),a=actions?.getBoundingClientRect();
     return {x:b.x,y:b.y,width:b.width,height:b.height,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,
      clientHeight:e.clientHeight,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,
      headingVisible:!h||(hr.top>=b.top&&hr.bottom<=b.bottom),
      actionsVisible:!a||(a.top>=b.top&&a.bottom<=b.bottom),
      name:e.getAttribute('aria-label')||document.getElementById(e.getAttribute('aria-labelledby'))?.textContent};
    }""")
    size = page.viewport_size
    check(f"{state} bounds", data["x"] >= 0 and data["y"] >= 0 and data["x"] + data["width"] <= size["width"] + 1 and data["y"] + data["height"] <= size["height"] + 1 and data["scrollWidth"] <= data["clientWidth"] + 1, data)
    check(f"{state} named dialog", bool(data["name"]))
    check(f"{state} initial heading visible", data["headingVisible"])
    if id == "missing-dialog":
        check(f"{state} recovery actions visible", data["actionsVisible"])
    stops = []
    for i in range(12):
        page.keyboard.press("Tab")
        # Native <dialog> keeps the app inert but permits Tab through browser
        # chrome; headless Chrome reports BODY during that browser focus stop.
        stops.append(d.evaluate("e=>e.contains(document.activeElement)||document.activeElement===document.body"))
    check(f"{state} Tab stays in dialog or browser chrome", all(stops), stops if not all(stops) else None)
    page.screenshot(path=f"/tmp/r190-{state}.png")
    return d

def close(page, id):
    page.keyboard.press("Escape")
    expect(page.locator("#" + id)).to_be_hidden()

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900}, locale="zh-CN")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="networkidle")
    page.locator(".cm-content").focus()
    page.keyboard.insert_text("# 弹窗检查\n\n正文。")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")

    def missing_route(route):
        if route.request.post_data_json.get("method") == "Delivery":
            response = route.fetch().json()
            response["value"]["missing"] = MISSING
            route.fulfill(status=200, content_type="application/json", body=json.dumps(response))
        else:
            route.continue_()

    for width, height in [(1440, 900), (900, 700), (360, 640), (320, 568), (740, 320)]:
        page.set_viewport_size({"width": width, "height": height})
        page.locator("#doc-title").click()
        d = look(page, "rename-dialog", f"rename-{width}")
        close(page, "rename-dialog")
        expect(page.locator("#doc-title")).to_be_focused()
        check(f"rename-{width} focus restored", True)
        page.locator(".cm-content").focus()
        page.locator('#format-bar [data-action="link"]').click()
        page.locator("#link-text").fill("测试链接")
        page.locator("#link-url").fill("javascript:alert(1)")
        page.locator('#link-form button[type="submit"]').click()
        expect(page.locator("#link-error")).to_be_visible()
        look(page, "link-dialog", f"link-error-{width}")
        close(page, "link-dialog")
        page.locator('[data-action="deliver"]').click()
        look(page, "delivery-dialog", f"delivery-{width}")
        close(page, "delivery-dialog")
        page.route(BASE + "/api", missing_route)
        page.locator('[data-action="deliver"]').click()
        page.locator('[data-deliver="html"]').click()
        look(page, "missing-dialog", f"missing-{width}")
        close(page, "missing-dialog")
        page.unroute(BASE + "/api", missing_route)
        page.locator('[data-action="deliver"]').click()
        page.locator('[data-deliver="html"]').click()
        look(page, "ready-dialog", f"ready-{width}")
        close(page, "ready-dialog")
        page.locator("#more-button").click()
        page.locator('#more-menu [data-menu-action="captureSettings"]').click()
        look(page, "capture-settings", f"capture-{width}")
        check(f"capture-{width} web disabled state", page.locator("#capture-enabled").is_disabled() and page.locator("#capture-shortcut").is_disabled() and page.locator("#capture-login").is_disabled())
        close(page, "capture-settings")

    # Whitespace satisfies native required validation but is not a valid name.
    page.locator("#doc-title").click()
    page.locator("#rename-input").fill("   ")
    page.locator('#rename-form button[type="submit"]').click()
    check("whitespace draft name has actionable feedback", page.locator("#rename-input").evaluate("e=>!e.validity.valid||e.getAttribute('aria-invalid')==='true'") or page.locator('#rename-form button[type="submit"]').is_disabled())
    check("localized blank-name feedback", page.locator("#rename-input").evaluate("e=>e.validationMessage") == "请输入名称")
    page.locator("#rename-input").fill("可以保存的标题")
    check("valid name clears error", page.locator("#rename-input").evaluate("e=>e.validity.valid"))
    page.locator('#rename-form button[type="submit"]').click()
    expect(page.locator("#rename-dialog")).to_be_hidden()
    expect(page.locator("#doc-title")).to_have_text("可以保存的标题")
    page.locator("#doc-title").click()
    close(page, "rename-dialog")
    page.route(BASE + "/api", missing_route)
    for theme in THEMES:
        page.locator('[data-action="settings"]').click()
        page.locator(f'#themes [data-theme="{theme["id"]}"]').click()
        close(page, "appearance")
        page.locator('[data-action="deliver"]').click()
        page.locator('[data-deliver="html"]').click()
        expect(page.locator("#missing-dialog")).to_be_visible()
        value = page.locator("#missing-dialog").evaluate(CONTRAST)
        check(f'{theme["id"]} dialog contrast', min(value["body"], value["note"], value["action"]) >= 4.5 and value["focus"] >= 3, value)
        listing = page.locator("#missing-list")
        listing.focus()
        page.keyboard.press("End")
        page.wait_for_timeout(120)
        check(f'{theme["id"]} keyboard reaches last missing path', listing.evaluate("e=>e.scrollTop>0"))
        if theme["id"] in ["paper", "nord"]:
            page.screenshot(path=f'/tmp/r190-missing-{theme["id"]}.png')
        close(page, "missing-dialog")
    page.unroute(BASE + "/api", missing_route)

    mobile_ctx = browser.new_context(has_touch=True, is_mobile=True, viewport={"width": 360, "height": 640}, locale="zh-CN")
    mobile = mobile_ctx.new_page()
    mobile.route(BASE + "/api", missing_route)
    mobile.goto(BASE, wait_until="networkidle")
    mobile.locator('[data-action="deliver"]').tap()
    mobile.locator('[data-deliver="html"]').tap()
    expect(mobile.locator("#missing-dialog")).to_be_visible()
    listing = mobile.locator("#missing-list")
    b = listing.bounding_box()
    cdp = mobile_ctx.new_cdp_session(mobile)
    for kind, y in [("touchStart", b["y"] + b["height"] * .8), ("touchMove", b["y"] + b["height"] * .5), ("touchMove", b["y"] + b["height"] * .2), ("touchEnd", None)]:
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if y is None else [{"x": b["x"] + 90, "y": y}]})
        mobile.wait_for_timeout(40)
    mobile.wait_for_timeout(150)
    check("real touch missing-list scroll", listing.evaluate("e=>e.scrollTop") > 0)
    check("touch recovery targets", mobile.locator("#missing-dialog button").evaluate_all("els=>els.every(e=>e.getBoundingClientRect().height>=44)"))
    mobile.screenshot(path="/tmp/r190-missing-touch.png")
    mobile.locator('[data-close="missing-dialog"]').tap()
    mobile.locator("#doc-title").tap()
    check("touch naming targets", mobile.locator("#rename-dialog button,#rename-input").evaluate_all("els=>els.every(e=>e.getBoundingClientRect().height>=44)"))
    mobile.locator('[data-close="rename-dialog"]').tap()
    mobile.locator('#format-bar [data-action="link"]').tap()
    check("touch link targets", mobile.locator("#link-dialog button,#link-text,#link-url").evaluate_all("els=>els.filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)"))
    mobile.locator('[data-close="link-dialog"]').tap()
    mobile_ctx.close()

    # Exercise the registered native menu event in the frontend bridge. This
    # checks the web dialog, not the native menu or macOS close operation.
    native_ctx = browser.new_context(viewport={"width": 320, "height": 568}, locale="zh-CN")
    native_ctx.add_init_script(BRIDGE)
    native = native_ctx.new_page()
    native.on("pageerror", lambda e: errors.append(str(e)))
    native.goto(BASE, wait_until="networkidle")
    def failed_save(route):
        if route.request.post_data_json.get("method") == "Update":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"error": "草稿暂时无法写入，请重试"}))
        else:
            route.continue_()
    native.route(BASE + "/api", failed_save)
    native.locator(".cm-content").focus()
    native.keyboard.insert_text("尚未保存的内容")
    native.evaluate("()=>window.__settingsEvents['liubai:action']('close')")
    look(native, "close-dialog", "close-unsaved-320")
    for theme in THEMES:
        native.evaluate("t=>window.__settingsEvents['liubai:appearance-changed']({theme:t,auto:'off'})", theme["id"])
        value = native.locator("#close-dialog").evaluate(CONTRAST)
        check(f'{theme["id"]} destructive dialog contrast', min(value["body"], value["note"], value["action"]) >= 4.5 and value["focus"] >= 3, value)
    native.locator('[data-close="close-dialog"]').click()
    expect(native.locator("#close-dialog")).to_be_hidden()
    expect(native.locator(".cm-content")).to_contain_text("尚未保存的内容")
    check("failed-close keep editing preserves text", True)
    native.unroute(BASE + "/api", failed_save)
    native.keyboard.press("Meta+s")
    expect(native.locator("#save-status")).to_have_text("草稿已保存")
    check("failed save can recover", "尚未保存的内容" in native.request.post(BASE + "/api", data={"method": "State", "args": []}).json()["value"]["current"]["content"])
    native_ctx.close()

    # Open the same field in English and inspect the actual native validation
    # message supplied by the application.
    english_ctx = browser.new_context(locale="en-US")
    english = english_ctx.new_page()
    english.goto(BASE, wait_until="networkidle")
    english.locator("#doc-title").click()
    english.locator("#rename-input").fill("   ")
    check("English blank-name feedback", english.locator("#rename-input").evaluate("e=>e.validationMessage") == "Enter a name")
    english_ctx.close()
    check("no runtime errors", not errors, errors)
    browser.close()

print("RESULT failures=", len(FAILURES))
sys.exit(bool(FAILURES))
