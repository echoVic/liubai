"""Math regression. Run via scripts/e2e.sh check-math (fresh server/data)."""
import json
import os
from pathlib import Path
import sys
import tempfile
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4196'
ARTIFACTS = Path(tempfile.mkdtemp(prefix='liubai-math-qa-'))
TEXT = '前文\n\n中文$x^2$中文\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```math\ny^2\n```\n\n$\\frac{$\n\n$5 和 $10\n\n尾文'


def api(page, method, *args):
    response = page.request.post(BASE + '/api', data={'method': method, 'args': list(args)}, headers={'Origin': BASE})
    assert response.ok, response.text()
    data = response.json()
    assert not data.get('error'), data
    return data['value']


def saved(page, expected):
    expect(page.locator('#save-status')).to_have_text('草稿已保存')
    assert api(page, 'State')['current']['content'] == expected


def replace(page, text):
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+a')
    page.keyboard.insert_text(text)
    saved(page, text)


def rich_fixture(page, text=TEXT):
    page.locator('[data-view="split"]').click()
    source = page.locator('#format-bar [data-action="source"]')
    if source.get_attribute('aria-pressed') != 'true':
        source.click()
    replace(page, text)
    page.keyboard.press('Meta+ArrowDown')
    source.click()
    page.locator('[data-view="single"]').click()


def select_text(page, text):
    # Native DOM selection drives CodeMirror's real selection observer.
    page.locator('.cm-line').filter(has_text=text).first.evaluate('''(line, text) => {
      const walk=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let node;
      while(node=walk.nextNode()){const at=node.textContent.indexOf(text);if(at<0)continue;
        line.closest('.cm-content').focus();const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+text.length);
        const sel=getSelection();sel.removeAllRanges();sel.addRange(range);document.dispatchEvent(new Event('selectionchange'));break}
    }''', text)
    page.wait_for_timeout(150)


def run(page):
    page.goto(BASE)
    expect(page.locator('.cm-content')).to_be_visible()
    rich_fixture(page)
    expect(page.locator('.rendered-math .katex')).to_have_count(3)
    expect(page.locator('.rendered-math.math-error')).to_have_text('\\frac{')
    assert 'KaTeX' in page.locator('.rendered-math.math-error').get_attribute('title')
    expect(page.locator('.cm-content')).to_contain_text('$5 和 $10')
    page.evaluate("async () => {await document.fonts.ready;await document.fonts.load('16px KaTeX_Main')}")
    assert page.evaluate("document.fonts.check('16px KaTeX_Main')")
    assert not page.evaluate("performance.getEntriesByType('resource').some(r=>/\\.(woff|ttf)(?:[?#]|$)/.test(r.name))")

    for selector, source_text in [('.rendered-math.math-inline:not(.math-error)', '$x^2$'), ('.rendered-math.math-display', '$$')]:
        page.locator(selector).first.click()
        expect(page.locator('.cm-content')).to_contain_text(source_text)
        page.keyboard.press('Meta+ArrowDown')
        expect(page.locator('.rendered-math .katex')).to_have_count(3)
    # Entering with keys must also reveal source, without changing Markdown.
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+ArrowUp')
    page.keyboard.press('ArrowDown')
    page.keyboard.press('ArrowDown')
    expect(page.locator('.cm-content')).to_contain_text('$x^2$')
    page.keyboard.press('Meta+ArrowDown')
    saved(page, TEXT)
    page.locator('[data-view="read"]').click()
    expect(page.locator('#preview-content .katex')).to_have_count(3)
    expect(page.locator('#preview-content .math-error')).to_have_text('\\frac{')
    for theme in ('paper', 'warm', 'mist', 'ink'):
        page.evaluate('(theme)=>document.documentElement.dataset.liubaiTheme=theme', theme)
        colors = page.locator('#preview-content .math-inline').first.evaluate('''el => {
          const c=getComputedStyle(el),math=getComputedStyle(el.querySelector('.katex'));return {foreground:c.color,formula:math.color};
        }''')
        assert colors['foreground'] == colors['formula'], colors
        page.screenshot(path=str(ARTIFACTS / f'math-reader-{theme}.png'))
    page.evaluate('delete document.documentElement.dataset.liubaiTheme')
    page.locator('[data-view="single"]').click()
    button = page.locator('#format-bar [data-action="math"]')
    expect(button).to_have_accessible_name('公式')
    expect(button).to_have_attribute('title', '公式')
    replace(page, 'xy')
    select_text(page, 'xy')
    button.click()
    saved(page, '$xy$')
    page.keyboard.press('Meta+z')
    saved(page, 'xy')
    replace(page, '')
    button.click()
    saved(page, '$$\n\n$$')
    page.keyboard.insert_text('x+1')
    saved(page, '$$\nx+1\n$$')
    page.keyboard.press('Meta+z')
    page.keyboard.press('Meta+z')
    saved(page, '')
    replace(page, '前后')
    page.keyboard.press('ArrowLeft')
    button.click()
    saved(page, '前$$后')
    page.keyboard.insert_text('x')
    saved(page, '前$x$后')
    page.keyboard.press('Meta+z')
    page.keyboard.press('Meta+z')
    saved(page, '前后')
    replace(page, '')
    # The menu opens on a lone slash typed at the start of an empty line; the query follows.
    page.keyboard.insert_text('/')
    page.keyboard.insert_text('gongshi')
    expect(page.locator('#slash-menu [data-slash-item="math"]')).to_be_visible()
    page.keyboard.press('Enter')
    saved(page, '$$\n\n$$')
    page.keyboard.press('Meta+z')
    saved(page, '/gongshi')
    replace(page, '')
    page.locator('#insert-button').click()
    page.locator('#insert-menu [data-menu-action="math"]').click()
    saved(page, '$$\n\n$$')

    # Table focus keeps math inline, even for an empty cell; image selection inserts below it.
    rich_fixture(page, '前\n\n| h |\n| --- |\n| xy |\n\n尾')
    cell = page.locator('.rendered-table [data-row="1"][data-column="0"]')
    cell.click()
    page.keyboard.press('Meta+ArrowRight')
    page.keyboard.insert_text('z')
    page.keyboard.press('Meta+a')
    button.click()
    saved(page, '前\n\n| h |\n| --- |\n| $xyz$ |\n\n尾')
    page.keyboard.press('Meta+z')
    saved(page, '前\n\n| h |\n| --- |\n| xyz |\n\n尾')
    page.keyboard.press('Meta+z')
    saved(page, '前\n\n| h |\n| --- |\n| xy |\n\n尾')
    rich_fixture(page, '前\n\n![图](missing.png)\n\n尾')
    page.locator('.inline-image').click()
    button.click()
    saved(page, '前\n\n![图](missing.png)\n\n$$\n\n$$\n\n尾')

    long_text = '前\n\n' + ('正文。\n\n' * 500) + '$$x^{12345}$$\n\n尾'
    rich_fixture(page, long_text)
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+ArrowUp')
    editor_scroll = page.locator('.editor-scroll')
    editor_scroll.evaluate('el=>el.scrollTop=0')
    page.wait_for_timeout(150)
    page.locator('.cm-content').evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'}))")
    editor_scroll.evaluate('el=>el.scrollTop=el.scrollHeight')
    expect(page.locator('.rendered-math')).to_have_count(1)
    expect(page.locator('.rendered-math .katex')).to_have_count(0)
    expect(page.locator('#slash-menu')).to_be_hidden()
    page.locator('.cm-content').evaluate("el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}))")
    expect(page.locator('.rendered-math .katex')).to_have_count(1)
    saved(page, long_text)

    rich_fixture(page)
    # HTML and rich copy share the same portable rendering, while PDF keeps styled KaTeX HTML.
    page.locator('.export-button').click()
    page.locator('[data-deliver="html"]').click()
    expect(page.locator('#ready-dialog')).to_be_visible()
    expect(page.locator('#print-document math')).to_have_count(3)
    expect(page.locator('#print-document .katex-html')).to_have_count(0)
    with page.expect_download() as pending:
        page.locator('#ready-go').click()
    html = Path(pending.value.path()).read_text()
    assert '<math ' in html and 'katex-html' not in html and 'fonts/' not in html
    page.keyboard.press('Escape')
    page.locator('.export-button').click()
    page.locator('[data-deliver="copyRich"]').click()
    expect(page.locator('#ready-dialog')).to_be_visible()
    expect(page.locator('#print-document math')).to_have_count(3)
    expect(page.locator('#print-document .katex-html')).to_have_count(0)
    page.keyboard.press('Escape')
    page.locator('.export-button').click()
    page.locator('[data-deliver="pdf"]').click()
    expect(page.locator('#ready-dialog')).to_be_visible()
    expect(page.locator('#print-document .katex-html')).to_have_count(3)
    page.keyboard.press('Escape')
    page.evaluate("localStorage.setItem('mygo:locale','en')")
    page.reload()
    expect(page.locator('#format-bar [data-action="math"]')).to_have_accessible_name('Formula')
    expect(page.locator('#format-bar [data-action="math"]')).to_have_attribute('title', 'Formula')
    page.locator('#insert-button').click()
    expect(page.locator('#insert-menu [data-menu-action="math"]')).to_have_text('Formula')
    print('PASS: math editor/reader, fonts, caret/errors/currency, toolbar/undo/cells/images, slash/insert, portable exports, themes and English')


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
