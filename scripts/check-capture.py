"""Quick capture browser regression. Run against -web with its own data directory.

python3 scripts/check-capture.py http://127.0.0.1:<port>
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import uuid

from playwright.sync_api import expect, sync_playwright
from checklib import api, base_url, evidence, launch

BASE = base_url()
ARTIFACTS = evidence("liubai-capture-qa-")


def run(context):
    main = context.new_page()
    main.goto(BASE)
    expect(main.locator(".cm-content")).to_be_visible()
    expect(main.locator(".topbar #workspace-label")).to_have_text("本地开发版 · 独立草稿存档")
    expect(main.locator(".topbar #workspace-label")).to_be_visible()
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
    assert "Capture" not in calls and "SaveCapture" not in calls, calls
    assert len(api(capture, "State")["recent"]) == len(before["recent"])
    field.fill(" \n\t")
    field.press("Meta+Enter")
    capture.wait_for_timeout(150)
    assert "Capture" not in calls and "SaveCapture" not in calls, calls
    title = "随手记回归 " + uuid.uuid4().hex[:8]
    field.fill(title + "\n第二行想法")
    field.press("Meta+Enter")
    expect(field).to_have_value("")
    expect(capture.locator("#capture-status")).to_have_text("已存为草稿")
    # A plain note (no target, no tags) takes the same SaveCapture call as any other.
    assert "SaveCapture" in calls and "Capture" not in calls, calls
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
    assert "Capture" not in calls and "SaveCapture" not in calls and "HideCapture" not in calls, calls
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
    browser = launch(p.chromium)
    context = browser.new_context(locale="zh-CN", viewport={"width": 1120, "height": 820})
    errors = []
    context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
    try:
        run(context)
        assert not errors, errors
    finally:
        browser.close()
