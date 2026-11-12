"""Reader state follows unchanged blocks through edits, without leaking to replacements.

Run with sh scripts/e2e.sh check-reader-state, in Chrome and WebKit.
WebKit is optional locally; REQUIRE_WEBKIT=1 makes its absence a failure.
"""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from checklib import base_url, evidence, launch

BASE = base_url()
FAILURES = []
ARTIFACTS = evidence("liubai-reader-state-")
CODE = "```\n" + "keep_code_" * 100 + "\n```"
TABLE = "| " + " | ".join("Keep column " + str(i) for i in range(12)) + " |\n"
TABLE += "| " + " | ".join("---" for _ in range(12)) + " |\n"
TABLE += "| " + " | ".join("Keep cell " + str(i) for i in range(12)) + " |"
HTML_CODE = "<pre>" + "keep_html_" * 100 + "</pre>"
HTML_TABLE = "<table><caption>Keep HTML table</caption><tr>" + "".join("<td>Wide column " + str(i) + "</td>" for i in range(12)) + "</tr></table>"
DETAILS = "<details><summary>Keep details</summary><p>Original body</p></details>"
OPEN_DETAILS = "<details open><summary>Keep open details</summary><p>Other body</p></details>"
BLOCKS = "\n\n".join([CODE, TABLE, HTML_CODE, HTML_TABLE, DETAILS, OPEN_DETAILS])
TEXT = "# State preservation\n\nOriginal paragraph.\n\n" + BLOCKS
PREFIX = "Inserted paragraph.\n\nAnother paragraph.\n\n"


def check(name, ok, value=None):
    print(("PASS " if ok else "FAIL ") + name, json.dumps(value) if value is not None else "", flush=True)
    if not ok:
        FAILURES.append(name)


def write(page, text):
    old = page.locator("#preview-content article").element_handle()
    editor = page.locator(".cm-content")
    editor.focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text(text)
    expect(page.locator("#save-status")).to_have_text(re.compile("^(草稿已保存|Draft saved)$"))
    expect(page.locator("#preview-content article")).to_contain_text("State preservation")
    # The render is debounced independently of saving. Wait for the new root,
    # including when only HTML attributes or source fences changed.
    page.wait_for_function("old=>document.querySelector('#preview-content article')!==old", arg=old)


def targets(page):
    root = page.locator("#preview-content")
    return [
        root.locator("pre").filter(has_text="keep_code_").last,
        root.locator("table").filter(has_text="Keep column 0").last.locator(".."),
        root.locator("pre").filter(has_text="keep_html_").last,
        root.locator("table").filter(has_text="Keep HTML table").last.locator(".."),
    ]


def set_state(page):
    for region in targets(page):
        region.evaluate("e=>e.scrollLeft=480")
    page.locator("details").filter(has=page.get_by_text("Keep details", exact=True)).evaluate("e=>e.open=true")
    page.locator("details").filter(has=page.get_by_text("Keep open details", exact=True)).evaluate("e=>e.open=false")


def state(page, label):
    for name, region in zip(["code", "table", "HTML code", "HTML table"], targets(page)):
        offset = region.evaluate("e=>e.scrollLeft")
        check(label + " " + name + " position", offset >= 450, offset)
    check(label + " expanded details", page.get_by_text("Keep details", exact=True).evaluate("e=>e.parentElement.open"))
    check(label + " collapsed authored-open details", not page.get_by_text("Keep open details", exact=True).evaluate("e=>e.parentElement.open"))


with sync_playwright() as pw:
    for engine in ["chromium", "webkit"]:
        if engine == "webkit" and not Path(pw.webkit.executable_path).exists():
            check("WebKit available when required", not os.environ.get("REQUIRE_WEBKIT"))
            print("SKIP WebKit not installed", flush=True)
            continue
        browser = launch(getattr(pw, engine))
        page = browser.new_page(viewport={"width": 900, "height": 700}, locale="zh-CN")
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle")
        page.locator('[data-view="split"]').click()
        source = page.locator('#format-bar [data-action="source"]')
        if source.get_attribute("aria-pressed") != "true":
            source.click()
        write(page, TEXT)
        set_state(page)
        write(page, PREFIX + TEXT)
        state(page, engine + " insert above")
        targets(page)[0].scroll_into_view_if_needed()
        targets(page)[0].focus()
        page.screenshot(path=str(ARTIFACTS / (engine + "-code.png")))
        set_state(page)
        write(page, TEXT)
        state(page, engine + " delete above")
        for label, original, replacement in [
            ("edit code", "keep_code_" * 100, "keep_code_" * 100 + "typed_suffix"),
            ("edit table cell", "Keep cell 1", "Revised cell 1"),
            ("edit disclosure body", "Original body", "Updated body"),
        ]:
            set_state(page)
            write(page, TEXT.replace(original, replacement))
            state(page, engine + " " + label)
            write(page, TEXT)

        # Duplicate content needs separate state; inserting an identical first
        # block must not give it the existing last block's scroll position.
        for marker, block, selector in [
            ("keep_code_", CODE, "pre"),
            ("Keep column 0", TABLE, ".md-table-scroll"),
            ("keep_html_", HTML_CODE, "pre"),
            ("Keep HTML table", HTML_TABLE, ".md-table-scroll"),
        ]:
            set_state(page)
            write(page, block + "\n\n" + TEXT)
            copies = page.locator("#preview-content " + selector).filter(has_text=marker)
            check(engine + " duplicate " + marker + " starts at left", copies.first.evaluate("e=>e.scrollLeft") <= 1)
            check(engine + " duplicate " + marker + " original keeps position", copies.last.evaluate("e=>e.scrollLeft") >= 450)
            write(page, TEXT)
            state(page, engine + " remove duplicate " + marker)
        for block, label, expected_open in [
            (DETAILS, "Keep details", False),
            (OPEN_DETAILS, "Keep open details", True),
        ]:
            set_state(page)
            write(page, block + "\n\n" + TEXT)
            copies = page.get_by_text(label, exact=True)
            check(engine + " duplicate " + label + " keeps authored default", copies.first.evaluate("e=>e.parentElement.open") == expected_open)
            check(engine + " duplicate " + label + " original keeps state", copies.last.evaluate("e=>e.parentElement.open") != expected_open)
            write(page, TEXT)
        diagram = "\n\n```mermaid\nnot_a_diagram " + "bad_source_" * 100 + "\n```"
        write(page, TEXT + diagram)
        fallback = page.locator("#preview-content .rendered-mermaid pre")
        expect(fallback).to_have_count(1)
        fallback.evaluate("e=>e.scrollLeft=480")
        write(page, PREFIX + TEXT + diagram)
        expect(fallback).to_have_count(1)
        check(engine + " late diagram fallback keeps position", fallback.evaluate("e=>e.scrollLeft") >= 450)
        check(engine + " late diagram fallback keyboard access", fallback.get_attribute("tabindex") == "0")
        write(page, TEXT)
        for label, original, replacement, selector in [
            ("code", "keep_code_", "other_code_", "pre"),
            ("table headers", "Keep column", "Other column", ".md-table-scroll"),
            ("HTML code", "keep_html_", "other_html_", "pre"),
            ("HTML caption", "Keep HTML table", "Other HTML table", ".md-table-scroll"),
        ]:
            set_state(page)
            write(page, TEXT.replace(original, replacement))
            region = page.locator("#preview-content " + selector).filter(has_text=replacement)
            check(engine + " replace only " + label + " starts at left", region.evaluate("e=>e.scrollLeft") <= 1)
            write(page, TEXT)
        set_state(page)
        changed = TEXT.replace("keep_code_", "other_code_").replace("Keep column", "Other column").replace("keep_html_", "other_html_").replace("Keep HTML table", "Other HTML table")
        changed = changed.replace("Keep details", "Other details").replace("Keep open details", "Other open details")
        write(page, changed)
        for region in page.locator("#preview-content pre, #preview-content .md-table-scroll").all():
            check(engine + " replacement starts at left", region.evaluate("e=>e.scrollLeft") <= 1)
        check(engine + " replacement closed default", not page.get_by_text("Other details", exact=True).evaluate("e=>e.parentElement.open"))
        check(engine + " replacement authored-open default", page.get_by_text("Other open details", exact=True).evaluate("e=>e.parentElement.open"))
        value = page.request.post(BASE + "/api", data={"method": "State", "args": []}).json()["value"]["current"]["content"]
        check(engine + " source unchanged by restoration", value == changed)
        check(engine + " no client errors", not errors, errors)
        browser.close()
print(json.dumps({"failures": FAILURES}))
raise SystemExit(bool(FAILURES))
