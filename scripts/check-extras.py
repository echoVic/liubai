"""Callouts, details and footnotes. Run via scripts/e2e.sh check-extras (fresh server/data)."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4196'
ARTIFACTS = Path(tempfile.mkdtemp(prefix='liubai-extras-qa-'))
THEMES = json.loads((Path(__file__).resolve().parent.parent / "src" / "themes.json").read_text())
DETAILS = '<details>\n<summary>标题</summary>\n\n内容\n\n</details>'


def set_theme(page, theme):
    """Paint a theme the way the app does, both root attributes. Assert right after: the app repaints the stored theme on its next minute tick or window focus."""
    scheme = 'dark' if next(t['dark'] for t in THEMES if t['id'] == theme) else 'light'
    page.evaluate("([theme, scheme]) => { const root = document.documentElement; root.dataset.liubaiTheme = theme; root.dataset.liubaiScheme = scheme }", [theme, scheme])


def current(page):
    response = page.request.post(BASE + '/api', data={'method': 'State', 'args': []}, headers={'Origin': BASE})
    assert response.ok
    return response.json()['value']['current']


def saved(page, text):
    expect(page.locator('#save-status')).to_have_text(re.compile('^(草稿已保存|Draft saved)$'))
    assert current(page)['content'] == text


def position(page, text, needle):
    expected = len(text[:text.index(needle)].encode('utf-16-le')) // 2
    for _ in range(70):
        pos = current(page)['position']
        if pos['anchor'] == pos['head'] == expected:
            return
        page.wait_for_timeout(100)
    raise AssertionError((pos, expected))


def fixture(page, text):
    page.locator('[data-view="split"]').click()
    button = page.locator('#format-bar [data-action="source"]')
    if button.get_attribute('aria-pressed') != 'true':
        button.click()
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+a')
    if text:
        page.keyboard.insert_text(text)
    else:
        page.keyboard.press('Backspace')  # Inserting nothing would leave the selection in place.
    saved(page, text)
    page.keyboard.press('Meta+ArrowDown')
    button.click()
    page.locator('[data-view="single"]').click()


def insert(page, kind, method):
    if method == 'toolbar':
        page.locator(f'#format-bar [data-action="{kind}"]').click()
    elif method == 'slash':
        page.locator('.cm-content').focus()
        # The menu opens on a lone slash typed at the start of an empty line; the query follows.
        page.keyboard.insert_text('/')
        page.keyboard.insert_text('jz' if kind == 'footnote' else 'zdk')
        expect(page.locator(f'#slash-menu [data-slash-item="{kind}"]')).to_be_visible()
        page.keyboard.press('Enter')
    else:
        page.locator('#insert-button').click()
        page.locator(f'#insert-menu [data-menu-action="{kind}"]').click()


def footnotes(root):
    expect(root.locator('sup.footnote-ref')).to_have_count(3)
    expect(root.locator('sup.footnote-ref a')).to_have_text(['[1]', '[2]', '[1:1]'])
    expect(root.locator('.footnote-item')).to_have_count(2)
    expect(root.locator('.footnote-backref')).to_have_count(3)
    expect(root.locator('#fn1')).to_contain_text('first definition')
    expect(root.locator('#fn2')).to_contain_text('second definition')
    assert root.locator('#fnref1').get_attribute('href') == '#fn1'
    assert root.locator('[id="fnref1:1"]').get_attribute('href') == '#fn1'


def run(page):
    page.goto(BASE)
    page.wait_for_selector('.cm-content')
    kinds = ('note', 'tip', 'important', 'warning', 'caution')
    labels = ('说明', '提示', '重要', '警告', '注意')
    text = '\n\n'.join(f'> [!{kind.upper()}]\n> {kind} body' for kind in kinds) + '\n\ntail'
    fixture(page, text)
    for kind, label in zip(kinds, labels):
        expect(page.locator(f'.md-callout.markdown-alert-{kind} .md-callout-title')).to_have_text(label)
        expect(page.locator(f'.md-callout.markdown-alert-{kind} .md-callout-title svg')).to_have_count(1)
    page.locator('[data-view="split"]').click()
    for theme in [t["id"] for t in THEMES]:
        set_theme(page, theme)
        colours = []
        for kind in kinds:
            style = '(el)=>{const s=getComputedStyle(el);return [s.borderLeftColor,s.backgroundColor]}'
            editor = page.locator(f'.cm-line.md-callout.markdown-alert-{kind}').first.evaluate(style)
            reader = page.locator(f'#preview-content .markdown-alert-{kind}').evaluate(style)
            assert editor == reader, (theme, kind, editor, reader)
            assert editor[1] not in ('transparent', 'rgba(0, 0, 0, 0)')
            colours.append(editor[0])
        assert len(set(colours)) == 5
        page.screenshot(path=str(ARTIFACTS / f'callouts-{theme}.png'))
    set_theme(page, 'paper')  # back to the default for the steps below
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+ArrowUp')
    expect(page.locator('.cm-line').first).to_contain_text('[!NOTE]')
    saved(page, text)
    page.locator('[data-view="single"]').click()

    text = '<details>\n<summary>Summary</summary>\n\nsecret-body\n\n</details>\n\ntail'
    fixture(page, text)
    toggle = page.locator('.md-details-toggle')
    expect(toggle).to_have_accessible_name('折叠内容')
    expect(toggle).to_have_attribute('aria-expanded', 'true')
    toggle.click()
    expect(toggle).to_have_accessible_name('展开内容')
    expect(toggle).to_have_attribute('aria-expanded', 'false')
    expect(page.locator('.cm-line').filter(has_text='secret-body')).to_have_count(0)
    expect(page.locator('.cm-content')).not_to_contain_text('<details>')
    saved(page, text)
    toggle.focus()
    page.keyboard.press('Space')
    expect(toggle).to_have_attribute('aria-expanded', 'true')
    expect(toggle).to_be_focused()
    expect(page.locator('.cm-line').filter(has_text='secret-body')).to_be_visible()
    page.keyboard.press('Enter')
    expect(toggle).to_have_attribute('aria-expanded', 'false')
    saved(page, text)
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    expect(toggle).to_have_count(0)
    expect(page.locator('.cm-content')).to_contain_text('secret-body')
    page.locator('#format-bar [data-action="source"]').click()
    expect(toggle).to_have_attribute('aria-expanded', 'true')
    page.locator('[data-view="single"]').click()

    for method in ('toolbar', 'slash', 'insert'):
        fixture(page, '')
        insert(page, 'footnote', method)
        saved(page, '[^1]\n\n[^1]: ')
        page.keyboard.insert_text('new note')
        saved(page, '[^1]\n\n[^1]: new note')
        page.keyboard.press('Meta+z')
        saved(page, '[^1]\n\n[^1]: ')
        page.keyboard.press('Meta+z')
        saved(page, '/jz' if method == 'slash' else '')
    for method in ('slash', 'insert'):
        fixture(page, '')
        insert(page, 'details', method)
        saved(page, DETAILS)
        page.keyboard.insert_text('Replacement')
        saved(page, DETAILS.replace('标题', 'Replacement'))
        page.keyboard.press('Meta+z')
        page.keyboard.press('Meta+z')
        saved(page, '/zdk' if method == 'slash' else '')

    # The reference belongs to the focused table cell; only its definition goes below the table.
    table = '| A | B |\n| --- | --- |\n| cell | other |\n\ntail'
    for method in ('toolbar', 'insert'):
        fixture(page, table)
        cell = page.locator('.rendered-table [data-row="1"][data-column="0"]')
        cell.click()
        page.keyboard.press('Meta+ArrowRight')
        insert(page, 'footnote', method)
        expected = table.replace('cell', 'cell[^1]') + '\n\n[^1]: '
        saved(page, expected)
        page.keyboard.insert_text('table note')
        saved(page, expected + 'table note')
        page.keyboard.press('Meta+z')
        page.keyboard.press('Meta+z')
        saved(page, table)

    image = '![pixel](missing.png)'
    for method in ('toolbar', 'insert'):
        fixture(page, image + '\n\ntail')
        page.locator('.inline-image').click()
        insert(page, 'footnote', method)
        saved(page, image + '\n\n[^1]\n\ntail\n\n[^1]: ')
        page.keyboard.press('Meta+z')
        saved(page, image + '\n\ntail')

    text = 'alpha[^named] beta[^2] again[^named] unresolved[^missing]\n\n[^named]: first definition <b>literal</b>\n[^2]: second definition\n\ntail'
    fixture(page, text)
    expect(page.locator('.md-footnote-ref')).to_have_text(['[1]', '[2]', '[1]'])
    marker = page.locator('.md-footnote-ref').first
    marker.hover()
    expect(page.locator('.md-footnote-tooltip')).to_have_text('first definition <b>literal</b>')
    expect(page.locator('.md-footnote-tooltip b')).to_have_count(0)
    marker.click(modifiers=['Meta'])
    position(page, text, 'first definition')
    page.locator('[data-view="read"]').click()
    footnotes(page.locator('#preview-content'))
    for kind in ('html', 'pdf', 'copyRich'):
        page.locator('.export-button').click()
        page.locator(f'[data-deliver="{kind}"]').click()
        expect(page.locator('#ready-dialog')).to_be_visible()
        footnotes(page.locator('#print-document'))
        if kind == 'html':
            with page.expect_download() as pending:
                page.locator('#ready-go').click()
            html = Path(pending.value.path()).read_text()
            assert 'footnote-ref' in html and 'href="#fnref1:1"' in html and 'id="fn2"' in html
        page.keyboard.press('Escape')
    page.locator('[data-view="single"]').click()
    page.evaluate("localStorage.setItem('mygo:locale','en')")
    page.reload()
    expect(page.locator('#format-bar [data-action="footnote"]')).to_have_accessible_name('Footnote')
    expect(page.locator('#format-bar [data-action="footnote"]')).to_have_attribute('data-tip', 'Footnote')
    assert page.locator('#format-bar [data-action="footnote"]').get_attribute('title') is None
    page.locator('#insert-button').click()
    expect(page.locator('#insert-menu [data-menu-action="details"]')).to_have_text('Details')
    expect(page.locator('#insert-menu [data-menu-action="footnote"]')).to_have_text('Footnote')
    page.keyboard.press('Escape')
    fixture(page, '> [!NOTE]\n> body\n\ntail')
    expect(page.locator('.md-callout-title')).to_have_text('Note')
    fixture(page, '')
    insert(page, 'details', 'insert')
    saved(page, '<details>\n<summary>Title</summary>\n\nContent\n\n</details>')
    expect(page.locator('.md-details-toggle')).to_have_accessible_name('Collapse details')
    print('PASS: callout themes/locales, details mouse/keyboard/source, footnote toolbar/slash/insert/cells/images/undo/hover/jump and export numbering/backrefs')


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
