"""Cancel search activation after the real backend switched from an empty draft."""
import json
import os
import sys
import time

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1].rstrip("/")


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    result = response.json()
    assert response.ok and not result.get("error"), result
    return result["value"]


with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"), headless=True)
    page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 850})
    page.goto(BASE)
    target = api(page, "State")["current"]
    api(page, "Update", {"id": target["id"], "revision": target["revision"], "content": "# 搜索目的地\n\n取消跳转命中", "position": {}})
    origin = api(page, "New")["current"]
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    page.locator("#sidebar-button").click()
    page.locator("#recent-search").fill("取消跳转命中")
    expect(page.locator(".search-hit")).to_have_count(1)
    held = []

    def hold_activation(route):
        if not held and route.request.post_data_json["method"] in ("Activate", "ActivateSearch"):
            # Execute the production backend first; hold only its response.
            response = route.fetch()
            held.append((route, response))
        else:
            route.continue_()

    page.route(BASE + "/api", hold_activation)
    page.locator(".search-hit").click()
    deadline = time.monotonic() + 7
    while not held and time.monotonic() < deadline:
        page.wait_for_timeout(10)
    assert held
    assert api(page, "State")["current"]["id"] == target["id"]
    page.locator(".cm-content").dispatch_event("compositionstart")
    # Only the first request is held; restoration must go through the real API.
    held[0][0].fulfill(response=held[0][1])
    expect(page.locator("#toast")).to_contain_text("输入")
    expect(page.locator("#doc-title")).to_have_text(origin["title"])
    page.wait_for_function("""async id => {
      const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'State',args:[]})});
      return (await r.json()).value.current.id===id;
    }""", arg=origin["id"])
    page.unroute(BASE + "/api", hold_activation)
    page.locator(".cm-content").dispatch_event("compositionend")
    page.locator(".cm-content").focus()
    page.keyboard.insert_text("取消之后仍能保存")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    saved = api(page, "State")["current"]
    assert saved["id"] == origin["id"] and saved["content"] == "取消之后仍能保存", json.dumps(saved, ensure_ascii=False)
    assert any(d["id"] == target["id"] for d in api(page, "State")["recent"])
    page.reload()
    expect(page.locator(".cm-content")).to_contain_text("取消之后仍能保存")
    browser.close()
    print("PASS: real backend cancellation restores authoritative current, retains empty origin and saves subsequent input")
