"""Quick capture browser regression. Run against -web with its own data directory.

python3 scripts/check-capture.py http://127.0.0.1:4198
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import os
from pathlib import Path
import sys
import tempfile
import uuid

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4198"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-capture-qa-"))


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok, response.text()
    result = response.json()
    assert not result.get("error"), result
    return result["value"]


def run(context):
    main = context.new_page()
    main.goto(BASE)
    expect(main.locator(".cm-content")).to_be_visible()
    current = api(main, "State")["current"]
    main.locator("#sidebar-button").click()
    expect(main.locator("#drawer")).to_be_visible()
    capture = context.new_page()
    capture.goto(BASE + "/capture.html")
    field = capture.get_by_placeholder("记下这一刻……")
    expect(field).to_be_focused()
    before = api(capture, "State")
    calls = []
    capture.on("request", lambda r: calls.append(r.post_data_json.get("method")) if r.url.endswith("/api") and r.method == "POST" else None)
    field.press("Meta+Enter")
    capture.wait_for_timeout(150)
    assert "Capture" not in calls
    assert len(api(capture, "State")["recent"]) == len(before["recent"])
    field.fill(" \n\t")
    field.press("Meta+Enter")
    capture.wait_for_timeout(150)
    assert "Capture" not in calls
    title = "随手记回归 " + uuid.uuid4().hex[:8]
    field.fill(title + "\n第二行想法")
    field.press("Meta+Enter")
    expect(field).to_have_value("")
    expect(capture.locator("#capture-status")).to_have_text("已存为草稿")
    saved = api(capture, "State")
    assert saved["current"] == current, (saved["current"], current)
    assert saved["recent"][0]["title"] == title
    captured_id = saved["recent"][0]["id"]
    main.bring_to_front()
    # Opening the sidebar refreshes from the service without loading another document.
    main.locator("#sidebar-button").click()
    main.locator("#sidebar-button").click()
    expect(main.locator("#drawer-list .recent-item b").first).to_have_text(title)
    expect(main.locator("#doc-title")).to_have_text(current["title"])
    assert api(main, "State")["current"]["id"] == current["id"]
    capture.bring_to_front()
    capture.wait_for_timeout(700)
    field.fill("换行")
    field.press("End")
    field.press("Enter")
    expect(field).to_have_value("换行\n")
    field.fill("输入法尚未确认")
    calls.clear()
    field.evaluate("""el => {
        el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',metaKey:true,isComposing:true,bubbles:true,cancelable:true}));
        el.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',isComposing:true,bubbles:true,cancelable:true}));
    }""")
    capture.wait_for_timeout(150)
    assert "Capture" not in calls and "HideCapture" not in calls, calls
    expect(field).to_have_value("输入法尚未确认")
    field.evaluate("el => el.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}))")
    field.press("Escape")
    expect(field).to_have_value("输入法尚未确认")
    assert api(capture, "State")["recent"][0]["id"] == captured_id
    # The button creates another draft, too.
    capture.get_by_role("button", name="存为草稿", exact=True).click()
    expect(field).to_have_value("")
    assert api(capture, "State")["recent"][0]["id"] != captured_id
    main.bring_to_front()
    main.locator("#more-button").click()
    main.get_by_role("menuitem", name="随手记设置…", exact=True).click()
    settings = main.get_by_role("dialog", name="随手记", exact=True)
    expect(settings).to_be_visible()
    expect(settings).to_contain_text("随手记只在桌面版可用")
    expect(settings.get_by_role("switch", name="启用随手记")).to_be_disabled()
    expect(settings.get_by_label("快捷键", exact=True)).to_be_disabled()
    expect(settings.get_by_role("switch", name="登录时在后台打开留白")).to_be_disabled()
    main.screenshot(path=str(ARTIFACTS / "capture-settings-web.png"))
    settings.get_by_role("button", name="关闭随手记设置").click()
    main.keyboard.press("Meta+k")
    main.locator("#command-search").fill("随手记")
    expect(main.locator("#command-list button")).to_have_count(2)
    main.locator("#command-list button").filter(has_text="随手记设置…").click()
    expect(settings).to_be_visible()
    print("PASS: quick note save, current document untouched, newline, IME guard, web-mode settings")


with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"), headless=True)
    context = browser.new_context(viewport={"width": 1120, "height": 820})
    try:
        run(context)
        print("Evidence:", ARTIFACTS)
    finally:
        browser.close()
