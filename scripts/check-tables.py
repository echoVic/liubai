"""Inline tables. Run via scripts/e2e.sh check-tables (fresh server/data)."""
import json
import os
from pathlib import Path
import sys
import tempfile
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4196'
ARTIFACTS = Path(tempfile.mkdtemp(prefix='liubai-tables-qa-'))
PREFIX, SUFFIX = '前文  \n\n', '\n\n尾文\t '
TABLE = '| **头** | `代码` |\n| :--- | ---: |\n| 甲\\|乙 | [链接](x) |'
TEXT = PREFIX + TABLE + SUFFIX


def api(page, method, *args):
    response = page.request.post(BASE + '/api', data={'method': method, 'args': list(args)}, headers={'Origin': BASE})
    assert response.ok, response.text()
    data = response.json()
    assert not data.get('error'), data
    return data['value']


def saved(page, expected=None):
    expect(page.locator('#save-status')).to_have_text('草稿已保存')
    current = api(page, 'State')['current']
    if expected is not None:
        assert current['content'] == expected, current['content']
    return current


def source(page, value):
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+a')
    page.keyboard.insert_text(value)
    saved(page, value)
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('[data-view="single"]').click()
    expect(page.locator('.rendered-table')).to_have_count(1)


def cell(page, row=0, column=0):
    return page.locator(f'.rendered-table [data-row="{row}"][data-column="{column}"]')


def undo(page, expected=TEXT):
    page.keyboard.press('Meta+z')
    saved(page, expected)


def menu_action(page, action, row=1, column=1):
    cell(page, row, column).click()
    page.locator('.table-menu-button').click()
    page.locator(f'.table-menu:not([hidden]) [data-menu-action="{action}"]').click()


def run(page):
    page.goto(BASE)
    expect(page.locator('.cm-content')).to_be_visible()
    source(page, TEXT)
    target = cell(page, 1, 1)
    target.click()
    target.evaluate('el => window.originalCell = el')
    page.keyboard.press('Meta+a')
    page.keyboard.insert_text('**新** | `原样`')
    expected = TEXT.replace('[链接](x)', '**新** \\| `原样`')
    saved(page, expected)
    expect(target).to_be_focused()
    assert target.evaluate('el => el === window.originalCell'), 'cell DOM replaced during input'
    target.evaluate('el => window.getSelection().collapse(el.firstChild,1)')
    page.keyboard.insert_text('X')
    saved(page, TEXT.replace('[链接](x)', '*X*新** \\| `原样`'))
    expect(target).to_be_focused()
    # Edits separated by a pause are separate undo steps, as in the rest of the editor.
    undo(page, expected)
    undo(page)

    # Tab order, reverse Tab and appending exactly one row from the last cell.
    cell(page).click()
    page.keyboard.press('Tab')
    expect(cell(page, 0, 1)).to_be_focused()
    page.keyboard.press('Shift+Tab')
    expect(cell(page)).to_be_focused()
    page.keyboard.press('ArrowDown')
    expect(cell(page, 1, 0)).to_be_focused()
    page.keyboard.press('Tab')
    expect(cell(page, 1, 1)).to_be_focused()
    page.keyboard.press('Tab')
    expect(cell(page, 2, 0)).to_be_focused()
    saved(page, PREFIX + TABLE + '\n|  |  |' + SUFFIX)
    undo(page)

    # Leaving moves into the neighbouring paragraph, so what is typed next never joins the table.
    for row, key, typed in [(0, 'ArrowUp', TEXT.replace('前文  ', '前文  续')), (1, 'ArrowDown', TEXT.replace('尾文', '续尾文')), (1, 'Escape', TEXT.replace('尾文', '续尾文'))]:
        cell(page, row).click()
        page.keyboard.press(key)
        expect(page.locator('.cm-content')).to_be_focused()
        page.keyboard.insert_text('续')
        saved(page, typed)
        undo(page)

    # Shared menu keyboard navigation, dismissal, and every action.
    cell(page, 1, 1).click()
    page.keyboard.press('Meta+/')
    popup = page.locator('.table-menu:not([hidden])')
    expect(popup).to_have_accessible_name('表格操作')
    expect(popup.locator('[data-menu-action="rowAbove"]')).to_be_focused()
    page.keyboard.press('End')
    expect(popup.locator('[data-menu-action="deleteTable"]')).to_be_focused()
    page.keyboard.press('ArrowDown')
    expect(popup.locator('[data-menu-action="rowAbove"]')).to_be_focused()
    page.keyboard.press('Escape')
    expect(page.locator('.table-menu-button')).to_be_focused()
    cases = {
        'rowAbove': '| **头** | `代码` |\n| :--- | ---: |\n|  |  |\n| 甲\\|乙 | [链接](x) |',
        'rowBelow': TABLE + '\n|  |  |',
        'columnLeft': '| **头** |  | `代码` |\n| :--- | --- | ---: |\n| 甲\\|乙 |  | [链接](x) |',
        'columnRight': '| **头** | `代码` |  |\n| :--- | ---: | --- |\n| 甲\\|乙 | [链接](x) |  |',
        'deleteRow': '| **头** | `代码` |\n| :--- | ---: |',
        'deleteColumn': '| **头** |\n| :--- |\n| 甲\\|乙 |',
        'left': TABLE.replace('---:', ':---'),
        'center': TABLE.replace('---:', ':---:'),
        'right': TABLE,
        'deleteTable': '',
    }
    for action, table in cases.items():
        # Right alignment must change the source, so start this case left aligned.
        original = TEXT
        if action == 'right':
            original = TEXT.replace('---:', ':---')
            source(page, original)
        menu_action(page, action)
        saved(page, PREFIX + table + SUFFIX)
        undo(page, original)
        if action == 'right':
            source(page, TEXT)

    # No document transaction or save during synthetic composition, even after the debounce.
    target = cell(page, 1, 1)
    target.click()
    target.dispatch_event('compositionstart')
    target.evaluate("el => { el.textContent='组字中'; el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'组字中',isComposing:true})); }")
    page.wait_for_timeout(1000)
    assert api(page, 'State')['current']['content'] == TEXT
    expect(target).to_have_text('组字中')
    expect(page.locator('.table-menu-button')).to_be_disabled()
    target.dispatch_event('compositionend', {'data': '组字中'})
    expect(page.locator('.table-menu-button')).to_be_enabled()
    saved(page, TEXT.replace('[链接](x)', '组字中'))
    expect(target).to_be_focused()
    undo(page)

    # Dragging the table handle moves the complete table and preserves both paragraphs.
    page.locator('.rendered-table').hover()
    expect(page.locator('#block-grip')).to_be_visible()
    grip = page.locator('#block-grip').bounding_box()
    tail = page.locator('.cm-line').filter(has_text='尾文').bounding_box()
    page.mouse.move(grip['x'] + grip['width'] / 2, grip['y'] + grip['height'] / 2)
    page.mouse.down()
    page.mouse.move(tail['x'] + 20, tail['y'] + tail['height'] + 2, steps=14)
    expect(page.locator('.block-insertion')).to_be_visible()
    page.mouse.up()
    saved(page, PREFIX + '尾文\t ' + '\n\n' + TABLE)
    undo(page)

    # Existing whole-block table handles still delete and move the table.
    page.locator('.rendered-table').hover()
    expect(page.locator('#block-grip')).to_be_visible()
    page.locator('#block-grip').click()
    page.locator('#block-menu [data-menu-action="down"]').click()
    moved = saved(page)['content']
    assert moved == PREFIX + '尾文\t ' + '\n\n' + TABLE, moved
    undo(page)
    page.locator('.rendered-table').hover()
    page.locator('#block-grip').click()
    page.locator('#block-menu [data-menu-action="delete"]').click()
    assert TABLE not in saved(page)['content']
    undo(page)

    for entry in ('format', 'slash'):
        source(page, TEXT)
        cell(page, 1, 1).click()
        page.keyboard.press('Escape')
        # Place the document caret at the end, then insert on a new paragraph.
        page.keyboard.press('Meta+a')
        page.keyboard.press('ArrowRight')
        page.keyboard.insert_text('\n\n')
        before = saved(page)['content']
        if entry == 'format':
            page.locator('#format-bar [data-action="table"]').click()
        else:
            page.keyboard.insert_text('/')
            page.keyboard.insert_text('bg')
            page.keyboard.press('Enter')
        inserted = page.locator('.rendered-table').last.locator('[data-row="0"][data-column="0"]')
        expect(inserted).to_be_focused()
        page.keyboard.insert_text('新表头')
        assert before + '| 新表头 |  |\n| --- | --- |\n|  |  |' in saved(page)['content']

    # Leaving at BOF/EOF opens an empty paragraph as its own undo step, so typing there is kept apart.
    bare = '| a | b |\n| --- | --- |\n| c | d |'
    for key, row, above in [('ArrowUp', 0, True), ('Shift+Tab', 0, True), ('ArrowDown', 1, False), ('Escape', 1, False)]:
        source(page, bare)
        cell(page, row, 0).click()
        page.keyboard.press(key)
        expect(page.locator('.cm-content')).to_be_focused()
        # At the document edge there is no line for the caret, so leaving opens an empty paragraph.
        opened = '\n\n' + bare if above else bare + '\n\n'
        saved(page, opened)
        page.keyboard.insert_text('正文')
        saved(page, '正文\n\n' + bare if above else bare + '\n\n正文')
        undo(page, opened)
        undo(page, bare)
    # Clicking the page below a table that ends the document starts a paragraph there.
    source(page, bare)
    pane = page.locator('.editor-scroll').bounding_box()
    page.mouse.click(pane['x'] + pane['width'] / 2, pane['y'] + pane['height'] - 40)
    page.keyboard.insert_text('尾')
    saved(page, bare + '\n\n尾')
    undo(page, bare + '\n\n')
    undo(page, bare)
    # With the usual trailing newline the last line is still beside the table, so a paragraph opens after it.
    source(page, bare + '\n')
    page.mouse.click(pane['x'] + pane['width'] / 2, pane['y'] + pane['height'] - 40)
    page.keyboard.insert_text('尾')
    saved(page, bare + '\n\n尾')
    undo(page, bare + '\n\n')
    undo(page, bare + '\n')
    for nested in ('> | a | b |\n> | --- | --- |\n> | c | d |', '- | a | b |\n  | --- | --- |\n  | c | d |'):
        source(page, nested)
        cell(page, 1, 1).click()
        page.keyboard.press('Meta+a')
        page.keyboard.insert_text('改')
        saved(page, nested.replace('c | d', 'c | 改'))
        undo(page, nested)
    for entry in ('format', 'slash'):
        source(page, bare + '\n')
        cell(page, 1, 1).click()
        page.keyboard.press('Escape')
        if entry == 'format':
            page.locator('#format-bar [data-action="table"]').click()
        else:
            page.keyboard.insert_text('/')
            page.keyboard.insert_text('bg')
            page.keyboard.press('Enter')
        expect(page.locator('.rendered-table')).to_have_count(2)
        expect(page.locator('.rendered-table').last.locator('[data-row="0"][data-column="0"]')).to_be_focused()

    # ⌘B in a cell wraps only that cell's selected text, never the Markdown behind the table.
    source(page, TEXT)
    first = cell(page, 1, 0)
    first.click()
    first.evaluate("el => { const r=document.createRange(); r.setStart(el.firstChild,0); r.setEnd(el.firstChild,1); const s=getSelection(); s.removeAllRanges(); s.addRange(r) }")
    page.keyboard.press('Meta+b')
    saved(page, TEXT.replace('| 甲\\|乙 |', '| **甲**\\|乙 |'))
    expect(first).to_be_focused()
    page.keyboard.press('Meta+z')
    saved(page, TEXT)
    source(page, TEXT)
    page.evaluate("localStorage.setItem('mygo:locale','en')")
    page.reload()
    expect(cell(page)).to_be_visible()
    page.locator('.table-menu-button').click()
    popup = page.locator('.table-menu:not([hidden])')
    expect(popup).to_have_accessible_name('Table actions')
    expect(popup.get_by_role('menuitem')).to_have_text(['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Delete row', 'Delete column', 'Align column left', 'Align column center', 'Align column right', 'Delete table'])
    page.screenshot(path=str(ARTIFACTS / 'english-table.png'))
    print('PASS: inline table input/caret/IME, cell-scoped ⌘A/⌘B, Tab/arrows/Escape, all menu edits/undo, block handles, insertion and English')


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get('PLAYWRIGHT_CHANNEL', 'chrome'))
    page = browser.new_page(locale='zh-CN', viewport={'width': 1120, 'height': 820})
    page.set_default_timeout(7000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        run(page)
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(ARTIFACTS / 'failure.png'))
        (ARTIFACTS / 'errors.json').write_text(json.dumps(errors, ensure_ascii=False))
        raise
    finally:
        print(f'Evidence: {ARTIFACTS}')
        browser.close()
