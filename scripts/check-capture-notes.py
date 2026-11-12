"""Quick Note enhancements: run against a fresh -web server."""

from playwright.sync_api import expect, sync_playwright
from checklib import api, base_url, evidence, launch, wait_state

BASE = base_url()
ARTIFACTS = evidence("liubai-capture-notes-")


with sync_playwright() as p:
    browser = launch(p.chromium)
    context = browser.new_context(locale="zh-CN", viewport={"width": 1120, "height": 820})
    errors = []
    context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
    main = context.new_page()
    main.goto(BASE)
    editor = main.locator(".cm-content")
    expect(editor).to_be_visible()
    current = api(main, "State")["current"]
    editor.click()
    main.keyboard.insert_text("# 中文 📝\n\n正在编辑的文字")
    main.keyboard.press("Meta+f")
    main.locator("#find-query").fill("新任务")
    expect(main.locator("#find-count")).to_have_text("未找到")
    # Call the production main-window append entry immediately, before autosave.
    summary = main.evaluate("""req => window.liubaiAppendCapture(req)""",
                            {"targetID": current["id"], "text": "- [ ] 新任务", "tags": ["工作", "灵感"], "revision": -1})
    expect(main.locator("#find-count")).to_have_text("0 / 1")
    main.keyboard.press("Escape")
    expect(editor).to_contain_text("正在编辑的文字")
    expect(editor).to_contain_text("新任务")
    assert summary["tags"] == ["工作", "灵感"], summary
    saved = api(main, "State")["current"]
    assert saved["content"] == '---\ntags: ["工作","灵感"]\n---\n\n# 中文 📝\n\n正在编辑的文字\n\n- [ ] 新任务', saved
    # An append is its own undo step and keeps earlier typing in history.
    editor.click()
    main.keyboard.press("Meta+z")
    expect(editor).not_to_contain_text("新任务")
    expect(editor).to_contain_text("正在编辑的文字")
    main.keyboard.press("Meta+Shift+z")
    expect(editor).to_contain_text("新任务")
    main.keyboard.press("Meta+s")
    # Save opened the draft's Save As flow; Esc closes it in web mode if present.
    main.keyboard.press("Escape")
    wait_state(main, lambda state: "新任务" in state["current"]["content"])
    target = api(main, "SaveCapture", {"text": "另一份文稿\n\n原来的段落", "tags": [], "targetID": "", "revision": 0})
    capture = context.new_page()
    capture.set_viewport_size({"width": 560, "height": 340})
    capture.goto(BASE + "/capture.html")
    field = capture.locator("#capture-text")
    expect(field).to_be_focused()
    capture.locator("#capture-template").select_option("task")
    expect(field).to_have_value("- [ ] ")
    field.fill("- [ ] 已输入的待办")
    capture.locator("#capture-template").select_option("meeting")
    assert field.input_value().startswith("- [ ] 已输入的待办\n\n## 会议记录"), field.input_value()
    field.fill("追加的想法 📝")
    capture.locator("#capture-tags").fill("工作，#灵感, 工作")
    capture.locator("#capture-target").select_option(target["id"])
    capture.screenshot(path=str(ARTIFACTS / "quick-note-zh.png"))
    capture.get_by_role("button", name="追加", exact=True).click()
    expect(field).to_have_value("")
    expect(capture.locator("#capture-status")).to_have_text("已追加到文稿")
    assert api(main, "State")["current"]["id"] == current["id"]
    appended = api(main, "Activate", target["id"])["current"]
    assert appended["content"] == '---\ntags: ["工作","灵感"]\n---\n\n另一份文稿\n\n原来的段落\n\n追加的想法 📝', appended
    api(main, "Activate", current["id"])
    # Removed targets fail with the full capture input retained.
    api(main, "Delete", target["id"])
    field.fill("必须保留的文字")
    capture.locator("#capture-tags").fill("保留标签")
    capture.get_by_role("button", name="追加", exact=True).click()
    expect(capture.locator("#capture-status")).to_have_attribute("data-error", "true")
    expect(field).to_have_value("必须保留的文字")
    expect(capture.locator("#capture-tags")).to_have_value("保留标签")
    # Full-text search matches the literal Markdown front matter.
    main.reload()
    expect(main.locator(".cm-content")).to_be_visible()
    main.locator("#sidebar-button").click()
    main.locator("#recent-search").fill("灵感")
    expect(main.locator("#drawer-list .search-item")).to_have_count(1)
    expect(main.locator("#drawer-list .search-item")).to_contain_text('tags: ["工作","灵感"]')
    for width, height in [(560, 340), (360, 400)]:
        capture.set_viewport_size({"width": width, "height": height})
        assert capture.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert capture.locator("#capture-save").bounding_box()["y"] < height
    assert not errors, errors
    browser.close()
    print("PASS: pending text, append undo/redo, templates, Markdown tags, deleted target recovery, tag search, compact layout")
