"""Typography preserves visible text in editing, split and reading layouts.

Run against an isolated workspace: sh scripts/e2e.sh check-typography
Desktop coverage invokes the registered frontend event; it does not test
the native settings window itself.
"""
import sys
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1]
TEXT = "\n\n".join(
    f"段落{i:03d} " + "改变字号与行宽后，应继续停留在当前正文位置。" * 6
    for i in range(60)
)
BRIDGE = """window.__settingsEvents={};window.mygo={
 locale:'zh-CN',on:(name,fn)=>window.__settingsEvents[name]=fn,
 call:async(method,...args)=>{
  const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({method:method.replace(/^Desktop\\./,''),args,locale:'zh-CN'})}).then(r=>r.json());
  if(r.error)throw Error(r.error);return r.value;
 }
}"""


def workspace(page):
    result = page.request.post(BASE + "/api", data={"method": "State", "args": []}).json()
    assert not result.get("error"), result
    return result["value"]


def settle(page):
    # Let browser layout and CodeMirror's height measurement finish.
    page.evaluate("""()=>new Promise((resolve,reject)=>{
      let previous='',stable=0,count=0;
      function frame(){
        const current=JSON.stringify([...document.querySelectorAll('.editor-scroll,.preview-scroll')].map(e=>
          [e.scrollTop,e.scrollHeight,e.clientHeight]));
        stable=current===previous?stable+1:0;previous=current;
        if(stable>=8)resolve();else if(++count>=90)reject(Error('Document layout did not settle'));else requestAnimationFrame(frame);
      }requestAnimationFrame(frame);
    })""")


def anchor(page, reading):
    return page.evaluate("""read=>{
      const s=document.querySelector(read?'.preview-scroll':'.editor-scroll'),top=s.getBoundingClientRect().top;
      const n=[...document.querySelectorAll(read?'#preview-content p':'.cm-line')].find(e=>{
       if(!/段落\\d+/.test(e.textContent))return false;
       const range=document.createRange();range.selectNodeContents(e);
       return [...range.getClientRects()].some(r=>r.bottom>top+2);
      });
      return n?.textContent.match(/段落\\d+/)?.[0]||'';
    }""", reading)


def change(page, size, width):
    page.locator('[data-action="settings"]').click()
    expect(page.locator("#appearance")).to_be_visible()
    for selector, value, key in [("#font-size", str(size), "fontSize"), ("#line-width", width, "lineWidth")]:
        with page.expect_response(lambda r: r.url == BASE + "/api" and r.request.post_data_json.get("method") == "UpdateAppearance") as response:
            page.locator(selector).select_option(value)
        assert not response.value.json().get("error"), response.value.text()
        page.wait_for_function(
            "([k,v])=>JSON.parse(localStorage.getItem('liubai-appearance')||'{}')[k]===v",
            arg=[key, size if key == "fontSize" else width],
        )
    page.keyboard.press("Escape")
    settle(page)


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900}, locale="zh-CN")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until="networkidle")
    page.locator(".cm-content").focus()
    page.keyboard.insert_text(TEXT)
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    original_id = workspace(page)["current"]["id"]

    for layout in ["single", "split", "read"]:
        page.locator(f'[data-view="{layout}"]').click()
        change(page, 18, "normal")
        if layout != "read":
            page.locator(".editor-scroll").evaluate("e=>e.scrollTop=e.scrollHeight/2")
        if layout != "single":
            page.locator("#preview-content p").nth(28).evaluate("e=>e.scrollIntoView({block:'start'})")
        settle(page)
        before = {read: anchor(page, read) for read in ([False] if layout == "single" else [True] if layout == "read" else [False, True])}
        assert all(before.values()), before
        change(page, 22, "wide")
        for read, paragraph in before.items():
            assert anchor(page, read) == paragraph, (layout, read, paragraph, anchor(page, read))
        assert workspace(page)["current"]["id"] == original_id
        assert workspace(page)["current"]["content"] == TEXT

    # Reload applies the same preferences. Touch controls have usable targets.
    page.reload(wait_until="networkidle")
    expect(page.locator("#preview-content .markdown-document")).to_have_css("font-size", "22px")
    touch = browser.new_context(has_touch=True, is_mobile=True, viewport={"width": 360, "height": 640}, locale="zh-CN")
    mobile = touch.new_page()
    mobile.goto(BASE, wait_until="networkidle")
    mobile.locator('[data-action="settings"]').tap()
    mobile.locator("#font-size").scroll_into_view_if_needed()
    assert all(mobile.locator(s).bounding_box()["height"] >= 44 for s in ["#font-size", "#line-width"])

    # Desktop setting events use the same rendering path, including 17px.
    native_ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
    native_ctx.add_init_script(BRIDGE)
    native = native_ctx.new_page()
    native.on("pageerror", lambda error: errors.append(str(error)))
    native.goto(BASE, wait_until="networkidle")
    expect(native.locator("#preview-content p")).to_have_count(60)
    native.locator("#preview-content p").nth(28).evaluate("e=>e.scrollIntoView({block:'start'})")
    before = anchor(native, True)
    native.evaluate("()=>window.__settingsEvents['liubai:appearance-changed']({fontSize:17,lineWidth:'normal'})")
    settle(native)
    assert anchor(native, True) == before, (before, anchor(native, True))
    expect(native.locator("#preview-content .markdown-document")).to_have_css("font-size", "17px")
    native.locator('[data-view="single"]').click()
    native.wait_for_function("()=>JSON.parse(localStorage.getItem('liubai-appearance')).layout==='single'")
    settle(native)
    native.locator(".editor-scroll").evaluate("e=>e.scrollTop=e.scrollHeight/2")
    settle(native)
    before = anchor(native, False)
    native.evaluate("()=>window.__settingsEvents['liubai:appearance-changed']({fontSize:22,lineWidth:'full'})")
    settle(native)
    assert anchor(native, False) == before, (before, anchor(native, False))
    assert workspace(native)["current"]["content"] == TEXT
    assert not errors, errors
    browser.close()

print("PASS: typography anchors in all layouts, persistence, touch targets, desktop appearance events")
