"""Screenshots of every theme in the edit, split and read views, in Chrome and (if installed) Playwright WebKit.

scripts/e2e.sh shoot-themes   → /tmp/liubai-theme-shots/<engine>-<theme>-<view>.png and index.html
11 themes x 3 views = 33 shots per engine. The edit and split shots start at the title, with the first line selected.
"""
import json
from pathlib import Path
import re
import sys

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4196"
THEMES = json.loads((Path(__file__).resolve().parent.parent / "src" / "themes.json").read_text())
OUT = Path("/tmp/liubai-theme-shots"); OUT.mkdir(exist_ok=True)
expect.set_options(timeout=15000)  # reloads are slow when the machine is busy
TEXT = ("# 留白\n\n写作的人都知道，最难的不是第一句，而是第一句之前那片空白。留白让每一句话都有地方落下。\n\n"
        "## 一、先写结尾\n\n我习惯==先写结尾==。知道要去哪里，路上的句子才不会迷路，这个办法是从[《文心雕龙》](https://example.com)里学来的。\n\n"
        "> 文章本天成，妙手偶得之。\n\n- 每天写满一页\n- 晚上用 `⌘⇧R` 读一遍\n\n```js\nconst draft = '先写，再改'; // 一页就够\n```\n\n> [!NOTE]\n> 提示块也跟着主题变。\n")
# What each view must show before it is photographed.
LAYOUT = {"single": r"^(?!.*(split|read)-layout)", "split": r"split-layout", "read": r"read-layout"}


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok and not response.json().get("error"), response.text()
    return response.json()["value"]


with sync_playwright() as p:
    engines = [("chrome", lambda: p.chromium.launch(channel="chrome"))]
    try:
        p.webkit.launch().close(); engines.append(("webkit", p.webkit.launch))
    except Exception as error:
        print("WebKit 未安装，跳过：", error)
    shots = []
    for engine, launch in engines:
        browser = launch(); page = browser.new_page(viewport={"width": 1440, "height": 1000}, locale="zh-CN")
        page.goto(BASE); content = page.locator('.cm-content[contenteditable="true"]')
        content.focus(); page.keyboard.press("Meta+a"); page.keyboard.insert_text(TEXT)
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        for t in THEMES:
            for view in ("single", "split", "read"):
                state = api(page, "State")["appearance"]; state.update(theme=t["id"], auto="off", layout=view)
                api(page, "Appearance", state); page.reload(); expect(page.locator(".cm-content")).to_be_attached()
                # Shoot only what was asked for: the theme painted, the view laid out, the text rendered, fonts loaded.
                root = page.locator("html")
                expect(root).to_have_attribute("data-liubai-theme", t["id"])
                expect(root).to_have_attribute("data-liubai-scheme", "dark" if t["dark"] else "light")
                expect(page.locator(".desk")).to_have_class(re.compile(LAYOUT[view]))
                expect(page.locator(".cm-content")).to_contain_text("写作的人都知道")
                if view != "single":
                    expect(page.locator("#preview-content h1")).to_have_text("留白")
                page.evaluate("async () => {await document.fonts.ready;await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))}")
                if view != "read":
                    # The saved caret sits at the end of the text: scroll back to the title, and select the first line so the selection colour shows.
                    page.evaluate("document.querySelector('.editor-scroll').scrollTop = 0")
                    page.locator(".cm-line", has_text="写作的人都知道").click(position={"x": 4, "y": 12})
                    page.keyboard.press("Home"); page.keyboard.press("Shift+ArrowDown")
                    page.wait_for_function("getSelection().toString().length > 10")  # the editor paints the browser's own selection
                    page.mouse.move(700, 30)  # off the editor, so no block handles
                page.wait_for_timeout(600)
                name = f"{engine}-{t['id']}-{view}.png"; page.screenshot(path=str(OUT / name)); shots.append(name)
        browser.close()
    (OUT / "index.html").write_text("<!doctype html><meta charset=utf-8><body style='margin:0;background:#888'>" + "".join(f"<figure style='display:inline-block;margin:8px'><a href='{n}'><img src='{n}' width=480></a><figcaption>{n}</figcaption></figure>" for n in shots))
print("截图在", OUT / "index.html")
