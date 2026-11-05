"""Reader table widths, semantics, keyboard/touch, themes and scroll preservation.

Run via sh scripts/e2e.sh check-reader-tables against a fresh data directory.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1]
PREFIX = sys.argv[2] if len(sys.argv) > 2 else "r189"
FAILURES = []

def check(name, ok, value=None):
    print(("PASS " if ok else "FAIL ") + name, json.dumps(value, ensure_ascii=False) if value is not None else "", flush=True)
    if not ok:
        FAILURES.append(name)

def table(cols, long=False):
    header = "| " + " | ".join(f"项目{i:02d}" for i in range(1, cols + 1)) + " |"
    rule = "| " + " | ".join(":---" if i == 0 else "---:" if i == cols - 1 else "---" for i in range(cols)) + " |"
    rows = []
    for r in range(3):
        cells = [
            ("这是一段需要正常换行的中文内容，阅读时应该保留足够列宽。" * 2 if long and i == 1 else f"内容{r + 1}-{i + 1:02d}")
            for i in range(cols)
        ]
        if r == 0:
            cells[-1] = f"[末列链接{cols}](#末尾)"
        rows.append("| " + " | ".join(cells) + " |")
    return "\n".join([header, rule, *rows])

TEXT = "\n\n".join([
    "# 多列表格阅读检查", "表格前的正文可以正常阅读。",
    "## 四列表格", table(4),
    "## 十二列表格", table(12, True),
    "## 二十列表格", table(20, True),
    "## HTML 表格",
    '<table><caption>任务状态</caption><thead><tr><th scope="col">任务</th><th scope="col">进度</th></tr></thead><tbody><tr><th scope="row">写作</th><td><input type="checkbox" checked aria-label="已完成"></td></tr></tbody></table>',
    "## 末尾", "末列链接应跳转到这里。", "[离开表格后的链接](#多列表格阅读检查)",
])

METRICS = """e=>{
 const t=e.querySelector('table'),s=t.parentElement,b=t.getBoundingClientRect(),r=e.getBoundingClientRect();
 return {width:r.width,scrollWidth:e.scrollWidth,tableWidth:b.width,height:b.height,
  columns:t.rows[0].cells.length,cellWidth:t.rows[0].cells[0].getBoundingClientRect().width,
  parent:s.className,tabindex:s.getAttribute('tabindex'),role:s.getAttribute('role'),label:s.getAttribute('aria-label'),
  parentWidth:s.clientWidth,parentScrollWidth:s.scrollWidth};
}"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900}, locale="zh-CN")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="networkidle")
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('.cm-content').focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text(TEXT)
    page.wait_for_function("()=>document.querySelector('#save-status').textContent==='草稿已保存'")
    page.locator('[data-view="read"]').click()
    expect(page.locator('#preview-content table')).to_have_count(4)

    check("header elements", page.locator("#preview-content table").nth(2).locator("thead th").count() == 20)
    check("readonly HTML task", page.locator("#preview-content input").evaluate("e=>e.disabled&&e.checked"))
    check("author table caption/row scope", page.locator("#preview-content caption").text_content() == "任务状态" and page.locator('#preview-content th[scope="row"]').count() == 1)
    check("Markdown header scopes", page.locator("#preview-content table").nth(2).locator('thead th[scope="col"]').count() == 20)
    expect(page.locator("#preview-content td").first).to_have_css("vertical-align", "top")

    for width, height in [(1440, 900), (900, 700), (360, 640), (320, 568), (740, 360)]:
        page.set_viewport_size({"width": width, "height": height})
        for i, cols in enumerate([4, 12, 20]):
            t = page.locator("#preview-content table").nth(i)
            t.scroll_into_view_if_needed()
            data = t.locator("xpath=ancestor::article").evaluate(METRICS) if i == 0 else t.evaluate("""t=>{
 const s=t.parentElement,a=t.closest('article'),b=t.getBoundingClientRect();
 return {width:a.clientWidth,scrollWidth:a.scrollWidth,tableWidth:b.width,height:b.height,
 columns:t.rows[0].cells.length,cellWidth:t.rows[0].cells[0].getBoundingClientRect().width,
 parent:s.className,tabindex:s.getAttribute('tabindex'),role:s.getAttribute('role'),label:s.getAttribute('aria-label'),
 parentWidth:s.clientWidth,parentScrollWidth:s.scrollWidth};
}""")
            check(f"{width}x{height} {cols} readable columns", data["cellWidth"] >= 90, data)
            check(f"{width}x{height} {cols} no document overflow", data["scrollWidth"] <= data["width"] + 1)
            if cols == 12:
                page.screenshot(path=f"/tmp/{PREFIX}-table-{width}.png")
    page.set_viewport_size({"width": 360, "height": 640})
    scrollers = page.locator("#preview-content .md-table-scroll")
    check("local table scroll regions", scrollers.count() == 4, scrollers.count())
    if scrollers.count() == 4:
        target = scrollers.nth(2)
        target.scroll_into_view_if_needed()
        target.focus()
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(250)
        check("keyboard horizontal scroll", target.evaluate("e=>e.scrollLeft") > 0)
        check("keyboard focus visible", target.evaluate("e=>getComputedStyle(e).outlineStyle") != "none")
        last = target.locator("a").last
        page.keyboard.press("Tab")
        expect(last).to_be_focused()
        check("last column link revealed by Tab", last.evaluate("e=>{const s=e.closest('.md-table-scroll'),a=e.getBoundingClientRect(),b=s.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right}"))
        page.keyboard.press("Enter")
        expect(page.locator('#末尾')).to_be_focused()
        check("table link anchor works", True)
        target.focus()
        page.keyboard.press("Shift+Tab")
        check("Tab leaves table backwards", target.evaluate("e=>!e.contains(document.activeElement)"))
        mobile = browser.new_context(has_touch=True, is_mobile=True, viewport={"width": 360, "height": 640}, locale="zh-CN")
        touch = mobile.new_page()
        touch.goto(BASE, wait_until="networkidle")
        touch.locator('[data-view="read"]').tap()
        ts = touch.locator("#preview-content .md-table-scroll").nth(2)
        ts.scroll_into_view_if_needed()
        ts.evaluate("e=>e.scrollLeft=0")
        box = ts.bounding_box()
        cdp = mobile.new_cdp_session(touch)
        y = max(150, min(550, box["y"] + box["height"] / 2))
        print("touch geometry", box, "point", [280, y], touch.evaluate("([x,y])=>document.elementFromPoint(x,y)?.tagName", [280, y]), flush=True)
        for kind, x in [("touchStart", 280), ("touchMove", 240), ("touchMove", 170), ("touchMove", 100), ("touchEnd", None)]:
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if x is None else [{"x": x, "y": y}]})
            touch.wait_for_timeout(25)
        touch.wait_for_timeout(250)
        check("real touch horizontal swipe", ts.evaluate("e=>e.scrollLeft") > 0, ts.evaluate("e=>e.scrollLeft"))
        mobile.close()

    check("document text stays unchanged", page.request.post(BASE + "/api", data={"method": "State", "args": []}).json()["value"]["current"]["content"] == TEXT)
    page.set_viewport_size({"width": 1440, "height": 900})
    expect(scrollers.first).to_have_attribute("tabindex", "-1")
    page.locator('[data-action="settings"]').click()
    page.locator("#font-size").select_option("22")
    page.keyboard.press("Escape")
    expect(scrollers.first).to_have_attribute("tabindex", "0")
    check("font change activates overflowing region", True)
    page.locator('[data-action="settings"]').click()
    page.locator("#font-size").select_option("18")
    page.keyboard.press("Escape")
    expect(scrollers.first).to_have_attribute("tabindex", "-1")
    check("fitting table skips extra Tab stop", True)

    ratios = []
    for theme in json.loads((Path(__file__).resolve().parents[1] / "src/themes.json").read_text()):
        page.locator('[data-action="settings"]').click()
        page.locator(f'#themes [data-theme="{theme["id"]}"]').click()
        page.keyboard.press("Escape")
        scrollers.nth(2).focus()
        value = scrollers.nth(2).evaluate("""e=>{
          const rgb=c=>{const n=document.createElement('span');n.style.color=c;e.append(n);const s=getComputedStyle(n).color;n.remove();return s.match(/[\\d.]+/g).slice(0,3).map(Number)};
          const lum=c=>rgb(c).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
          const contrast=(a,b)=>{a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
          const css=getComputedStyle(e),a=getComputedStyle(e.querySelector('a')),t=getComputedStyle(e.querySelector('th')),
            paper=css.getPropertyValue('--card'),muted=css.getPropertyValue('--muted');
          return {text:contrast(css.color,paper),header:contrast(t.color,t.backgroundColor),link:contrast(a.color,paper),
           focus:contrast(css.getPropertyValue('--ring'),paper),thumb:contrast(css.getPropertyValue('--muted-foreground'),muted)};
        }""")
        ratios.append(value)
        check(f'{theme["id"]} table contrast', min(value["text"], value["header"], value["link"]) >= 4.5 and min(value["focus"], value["thumb"]) >= 3, value)
        if theme["id"] in ["paper", "nord"]:
            page.screenshot(path=f'/tmp/{PREFIX}-table-{theme["id"]}.png')
    print("contrast minima", {key: min(v[key] for v in ratios) for key in ratios[0]}, flush=True)

    target = scrollers.nth(2)
    target.evaluate("e=>e.scrollLeft=700")
    page.locator('[data-view="split"]').click()
    # Source mode remains on from fixture creation.
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+End")
    page.keyboard.insert_text("\n\n新增正文。")
    page.wait_for_function("()=>document.querySelector('#preview-content').textContent.includes('新增正文。')")
    check("table keeps horizontal position after editing", scrollers.nth(2).evaluate("e=>e.scrollLeft") >= 650, scrollers.nth(2).evaluate("e=>e.scrollLeft"))
    check("no runtime errors", not errors, errors)
    browser.close()

print(f"RESULT failures={len(FAILURES)}")
sys.exit(bool(FAILURES))
