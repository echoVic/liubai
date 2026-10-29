"""Browser regression for the themes: picker, keyboard, automatic switching and the boot paint.

scripts/e2e.sh check-themes
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import datetime as dt
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4196"
THEMES = json.loads((Path(__file__).resolve().parent.parent / "src" / "themes.json").read_text())


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok, response.text()
    body = response.json()
    assert not body.get("error"), body
    return body["value"]


def appearance_change(page, operation):
    with page.expect_response(lambda r: r.url.endswith("/api") and '"UpdateAppearance"' in (r.request.post_data or "")) as pending:
        operation()
    assert not pending.value.json().get("error"), pending.value.text()


def painted(page):
    return page.evaluate("[document.documentElement.dataset.liubaiTheme, document.documentElement.dataset.liubaiScheme]")


def style(dialog, theme, prop):
    return dialog.locator(f'[data-theme="{theme}"]').evaluate("(el, prop) => getComputedStyle(el)[prop]", prop)


def reload_keeps(page, shown, **stored):
    # A reload keeps the stored choice, and the boot script paints the theme shown before the app runs.
    page.reload(); expect(page.locator(".cm-content")).to_be_visible()
    a = api(page, "State")["appearance"]
    assert {k: a[k] for k in stored} == stored, a
    assert [page.evaluate("window.bootTheme"), painted(page)[0]] == [shown, shown], (page.evaluate("window.bootTheme"), painted(page))


def open_panel(page):
    page.locator('[data-action="settings"]').click()
    expect(page.locator('#appearance #themes [aria-checked="true"]')).to_be_focused()  # the panel moves focus there on the next frame


def palette_theme(page, name, how):
    # The palette lists the commands whose title contains the query. Enter in the search box clicks the first listed one,
    # ArrowDown moves focus to it, and the listed button can also be clicked: drive each the way a person would.
    page.keyboard.press("Meta+k")
    search = page.locator("#command-search")
    search.fill("切换主题 · " + name)
    items = page.locator("#command-list button")
    expect(items).to_have_count(1)
    expect(items.first).to_contain_text("切换主题 · " + name)
    if how == "enter":
        appearance_change(page, lambda: search.press("Enter"))
    elif how == "arrow":
        search.press("ArrowDown"); expect(items.first).to_be_focused()
        appearance_change(page, lambda: page.keyboard.press("Enter"))
    else:
        appearance_change(page, lambda: items.first.click())
    expect(page.locator("#commands")).not_to_be_visible()


with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light", locale="zh-CN")
    page = context.new_page()
    page.clock.install(time=dt.datetime(2026, 10, 22, 16, 0))
    # What the boot script painted, before the app module ran.
    page.add_init_script("document.addEventListener('DOMContentLoaded', () => { window.bootTheme = document.documentElement.dataset.liubaiTheme }, {once: true})")
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    a = api(page, "State")["appearance"]
    assert (a["auto"], a["lightTheme"], a["darkTheme"]) == ("system", "paper", "ink"), a
    assert painted(page) == ["paper", "light"]

    page.locator('[data-action="settings"]').click()
    dialog = page.locator("#appearance")
    radios = dialog.locator('#themes [role="radio"]')
    expect(radios).to_have_count(len(THEMES))
    assert radios.evaluate_all("els => els.map(el => el.dataset.theme)") == [t["id"] for t in THEMES]
    names = radios.evaluate_all("els => els.map(el => el.getAttribute('aria-label'))")
    assert len(set(names)) == len(THEMES) and all(names), names
    expect(dialog.locator('[data-auto="system"]')).to_have_attribute("aria-checked", "true")
    expect(dialog.locator(".system-themes")).to_be_visible()
    assert dialog.locator("#light-theme option").count() == 7 and dialog.locator("#dark-theme option").count() == 4

    # Other elements carry data-theme too (a Mermaid diagram does); the panel must find its own buttons.
    page.evaluate("ids => ids.forEach(id => { const el = document.createElement('i'); el.className = 'decoy'; el.dataset.theme = id; document.body.prepend(el) })", [t["id"] for t in THEMES])

    # Keyboard: the theme in use holds the tab stop; arrows walk the order and jump between the rows.
    expect(dialog.locator('#themes [tabindex="0"]')).to_have_attribute("data-theme", "paper")
    dialog.locator('[data-theme="paper"]').focus()
    page.keyboard.press("ArrowRight"); expect(dialog.locator('[data-theme="warm"]')).to_be_focused()
    expect(dialog.locator('[data-caption="hours"]')).to_contain_text("暖纸 · 15–19 点")
    # Selection is a ring and a check mark, never an outline; the outline is the keyboard focus alone.
    assert style(dialog, "warm", "outlineStyle") == "solid" and style(dialog, "warm", "boxShadow") == "none"  # focused, not selected
    assert style(dialog, "paper", "outlineStyle") == "none" and style(dialog, "paper", "boxShadow") != "none"  # selected, not focused
    expect(dialog.locator("#themes .theme-check")).to_have_count(1)
    expect(dialog.locator('[data-theme="paper"] .theme-check')).to_have_count(1)
    expect(dialog.locator('[data-theme="warm"] .theme-check')).to_have_count(0)
    expect(dialog.locator("#themes .theme-check")).to_have_attribute("aria-hidden", "true")
    page.keyboard.press("ArrowLeft"); expect(dialog.locator('[data-theme="paper"]')).to_be_focused()
    assert style(dialog, "paper", "outlineStyle") == "solid" and style(dialog, "paper", "boxShadow") != "none"  # selected and focused: both show
    page.keyboard.press("End"); expect(dialog.locator('[data-theme="indigo"]')).to_be_focused()
    page.keyboard.press("ArrowUp"); expect(dialog.locator('[data-theme="moon"]')).to_be_focused()
    page.keyboard.press("ArrowDown"); expect(dialog.locator('[data-theme="indigo"]')).to_be_focused()
    page.keyboard.press("Home"); expect(dialog.locator('[data-theme="dawn"]')).to_be_focused()
    page.keyboard.press("ArrowDown"); expect(dialog.locator('[data-theme="mist"]')).to_be_focused()
    page.keyboard.press("ArrowUp"); expect(dialog.locator('[data-theme="dawn"]')).to_be_focused()
    dialog.locator('[data-theme="lamp"]').hover(); expect(dialog.locator('[data-caption="hours"]')).to_contain_text("灯下 · 19–21 点")
    page.mouse.move(0, 0); expect(dialog.locator('[data-caption="hours"]')).to_contain_text("纸白 · 9–15 点")

    # Picking a theme turns automatic switching off; every theme paints its own tokens and scheme.
    for t in THEMES:
        appearance_change(page, lambda: dialog.locator(f'[data-theme="{t["id"]}"]').click())
        assert painted(page) == [t["id"], "dark" if t["dark"] else "light"]
        expect(dialog.locator(f'[data-theme="{t["id"]}"]')).to_be_focused()
        expect(dialog.locator("#themes .theme-check")).to_have_count(1)
        expect(dialog.locator(f'[data-theme="{t["id"]}"] .theme-check')).to_have_count(1)
        colours = page.evaluate("""() => {
          const probe = document.createElement('i'); probe.style.color = 'var(--card)'; document.body.append(probe);
          const card = getComputedStyle(probe).color; probe.remove();
          return [card, getComputedStyle(document.querySelector('.cm-editor')).backgroundColor];
        }""")
        assert colours[0] == colours[1], (t["id"], colours)
    page.evaluate("document.querySelectorAll('.decoy').forEach(el => el.remove())")
    a = api(page, "State")["appearance"]
    assert a["theme"] == THEMES[-1]["id"] and a["auto"] == "off" and not a["followSystem"], a
    expect(dialog.locator(".system-themes")).to_be_hidden()
    reload_keeps(page, THEMES[-1]["id"], auto="off", theme=THEMES[-1]["id"]); open_panel(page)
    # The panel keeps its top edge while the mode changes its height (the selects, the notes), so the switch under the pointer stays put.
    switch_top = lambda: dialog.locator(".segmented").bounding_box()["y"]
    top = switch_top()
    for mode in ("system", "hours", "off"):
        appearance_change(page, lambda: dialog.locator(f'[data-auto="{mode}"]').click())
        assert abs(switch_top() - top) <= 1, (mode, top, switch_top())

    # Follow the system with a chosen pair. The automatic switch is a radiogroup too: an arrow key moves the choice and the focus together.
    dialog.locator('[data-auto="off"]').focus()
    appearance_change(page, lambda: page.keyboard.press("ArrowRight"))
    expect(dialog.locator('[data-auto="system"]')).to_be_focused()
    expect(dialog.locator('[data-auto="system"]')).to_have_attribute("aria-checked", "true")
    appearance_change(page, lambda: page.keyboard.press("ArrowLeft"))
    expect(dialog.locator('[data-auto="off"]')).to_be_focused()
    appearance_change(page, lambda: dialog.locator('[data-auto="system"]').click())
    appearance_change(page, lambda: dialog.locator("#light-theme").select_option("moonwhite"))
    appearance_change(page, lambda: dialog.locator("#dark-theme").select_option("lamp"))
    assert painted(page) == ["moonwhite", "light"]
    page.emulate_media(color_scheme="dark"); expect(page.locator("html")).to_have_attribute("data-liubai-theme", "lamp")
    reload_keeps(page, "lamp", auto="system", lightTheme="moonwhite", darkTheme="lamp")
    page.emulate_media(color_scheme="light"); expect(page.locator("html")).to_have_attribute("data-liubai-theme", "moonwhite")
    open_panel(page)

    # Follow the hours: 16:00 is 申时, and the clock reaching 19:00 switches on its next minute tick.
    # warm → lamp crosses from light to dark, so it paints at once: no crossfade, whose instant text colour would sit on a still-fading page.
    # The clock stays paused while each fade is checked, so the fade's own timer cannot end it first.
    appearance_change(page, lambda: dialog.locator('[data-auto="hours"]').click())
    assert painted(page) == ["warm", "light"]
    page.clock.pause_at(dt.datetime(2026, 10, 22, 19, 0, 30))
    expect(page.locator("html")).to_have_attribute("data-liubai-theme", "lamp")
    expect(page.locator("html")).to_have_attribute("data-liubai-scheme", "dark")
    expect(page.locator("html")).not_to_contain_class("theme-fade")
    page.clock.resume()
    # Turning automatic switching off keeps the theme in use, so the page does not jump; then follow the hours again.
    appearance_change(page, lambda: dialog.locator('[data-auto="off"]').click())
    assert painted(page) == ["lamp", "dark"]
    expect(dialog.locator('[data-theme="lamp"]')).to_have_attribute("aria-checked", "true")
    a = api(page, "State")["appearance"]
    assert a["theme"] == "lamp" and a["auto"] == "off", a
    appearance_change(page, lambda: dialog.locator('[data-auto="hours"]').click())
    assert painted(page) == ["lamp", "dark"]
    # A repaint by the clock rebuilds the cards; the one holding the keyboard focus keeps it.
    dialog.locator('[data-theme="mist"]').focus()
    page.clock.fast_forward("02:00:00")
    expect(page.locator("html")).to_have_attribute("data-liubai-theme", "ink")
    expect(dialog.locator('[data-theme="ink"]')).to_have_attribute("aria-checked", "true")
    expect(dialog.locator('[data-theme="mist"]')).to_be_focused()
    # ink → moon at 23:00 stays dark, so the automatic switch crossfades the large surfaces; a manual pick or a mode change paints at once.
    page.clock.pause_at(dt.datetime(2026, 10, 22, 23, 0, 30))
    expect(page.locator("html")).to_have_attribute("data-liubai-theme", "moon")
    expect(page.locator("html")).to_contain_class("theme-fade")
    assert page.evaluate("getComputedStyle(document.querySelector('.paper')).transitionProperty") == "background-color"
    appearance_change(page, lambda: dialog.locator('[data-theme="dawn"]').click())
    assert painted(page) == ["dawn", "light"]
    expect(page.locator("html")).not_to_contain_class("theme-fade")
    page.clock.resume()
    appearance_change(page, lambda: dialog.locator('[data-auto="hours"]').click())
    assert painted(page) == ["moon", "dark"]
    expect(page.locator("html")).not_to_contain_class("theme-fade")
    reload_keeps(page, "moon", auto="hours"); open_panel(page)

    # Follow the seasons: 10-22 falls between 立秋 and 立冬, and a dark system takes indigo.
    appearance_change(page, lambda: dialog.locator('[data-auto="seasons"]').click())
    expect(page.locator("html")).to_have_attribute("data-liubai-theme", "autumn")
    page.emulate_media(color_scheme="dark"); expect(page.locator("html")).to_have_attribute("data-liubai-theme", "indigo")
    page.emulate_media(color_scheme="light")
    reload_keeps(page, "autumn", auto="seasons")

    # The command palette reaches every theme and turns automatic switching off.
    palette_theme(page, names[-1], "enter")
    assert painted(page) == ["indigo", "dark"] and api(page, "State")["appearance"]["auto"] == "off"
    for i, (t, name) in enumerate(zip(THEMES, names)):
        palette_theme(page, name, "arrow" if i % 2 else "click")
        assert painted(page) == [t["id"], "dark" if t["dark"] else "light"], t["id"]
    browser.close()
print("PASS: 主题面板、自动切换与启动绘制")
