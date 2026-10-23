"""Mermaid regression. Run via scripts/e2e.sh check-mermaid (fresh server/data)."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4196'
ARTIFACTS = Path(tempfile.mkdtemp(prefix='liubai-mermaid-qa-'))
THEMES = json.loads((Path(__file__).resolve().parent.parent / "src" / "themes.json").read_text())
TEMPLATE = '```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```'
TEXT = '前文\n\n' + TEMPLATE + '\n\n' + TEMPLATE + '\n\n尾文'


def set_theme(page, theme):
    """Paint a theme the way the app does, both root attributes. Assert right after: the app repaints the stored theme on its next minute tick or window focus."""
    scheme = 'dark' if next(t['dark'] for t in THEMES if t['id'] == theme) else 'light'
    page.evaluate("([theme, scheme]) => { const root = document.documentElement; root.dataset.liubaiTheme = theme; root.dataset.liubaiScheme = scheme }", [theme, scheme])


def saved(page, text):
    expect(page.locator('#save-status')).to_have_text(re.compile('^(草稿已保存|Draft saved)$'))
    response = page.request.post(BASE + '/api', data={'method': 'State', 'args': []}, headers={'Origin': BASE})
    assert response.ok
    assert response.json()['value']['current']['content'] == text


def replace(page, text):
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+a')
    page.keyboard.insert_text(text)
    saved(page, text)


def fixture(page, text=TEXT):
    page.locator('[data-view="split"]').click()
    source = page.locator('#format-bar [data-action="source"]')
    if source.get_attribute('aria-pressed') != 'true':
        source.click()
    replace(page, text)
    page.keyboard.press('Meta+ArrowDown')
    source.click()
    page.locator('[data-view="single"]').click()


def diagrams(page, selector, count=2):
    expect(page.locator(selector + ' svg')).to_have_count(count)
    for svg in page.locator(selector + ' svg').all():
        expect(svg).to_contain_text('开始')
        expect(svg).to_contain_text('结束')
    ids = page.locator(selector + ' [id]').evaluate_all('els=>els.map(el=>el.id)')
    assert len(ids) == len(set(ids)), ids


def run(page):
    requests, violations = [], []
    page.on('request', lambda request: requests.append(request.url))
    page.add_init_script("document.addEventListener('securitypolicyviolation',e=>console.error('CSP violation: '+e.violatedDirective+' '+e.blockedURI))")
    page.on('console', lambda message: violations.append(message.text) if message.text.startswith('CSP violation:') else None)
    page.goto(BASE)
    expect(page.locator('.cm-content')).to_be_visible()
    fixture(page, '普通正文\n\n```js\nmermaid\n```\n\n尾文')
    page.locator('[data-view="read"]').click()
    page.wait_for_timeout(400)
    assert not any(re.search(r'/mermaid-runtime-[^/]+\.js', url) for url in requests), requests
    page.locator('[data-view="single"]').click()
    fixture(page)
    diagrams(page, '.cm-content .rendered-mermaid')
    assert any(re.search(r'/mermaid-runtime-[^/]+\.js', url) for url in requests), requests
    set_theme(page, 'ink')
    expect(page.locator('.cm-content .rendered-mermaid').first).to_have_attribute('data-theme', 'ink')
    set_theme(page, 'paper')
    expect(page.locator('.cm-content .rendered-mermaid').first).to_have_attribute('data-theme', 'paper')
    page.locator('.rendered-mermaid').first.click()
    expect(page.locator('.cm-content')).to_contain_text('```mermaid')
    expect(page.locator('.cm-content .rendered-mermaid svg')).to_have_count(1)
    page.keyboard.press('Meta+ArrowDown')
    diagrams(page, '.cm-content .rendered-mermaid')
    saved(page, TEXT)
    # Ordinary prose changes keep the mounted diagram and its height.
    before = page.locator('.rendered-mermaid').first.evaluate('el=>({id:el.querySelector("svg").id,height:el.getBoundingClientRect().height})')
    page.keyboard.insert_text('续')
    after = page.locator('.rendered-mermaid').first.evaluate('el=>({id:el.querySelector("svg").id,height:el.getBoundingClientRect().height})')
    assert before == after, (before, after)
    page.keyboard.press('Meta+z')
    page.locator('[data-view="read"]').click()
    diagrams(page, '#preview-content .rendered-mermaid')
    for theme in [t["id"] for t in THEMES]:
        set_theme(page, theme)
        expect(page.locator('#preview-content .rendered-mermaid').first).to_have_attribute('data-theme', theme)
        diagrams(page, '#preview-content .rendered-mermaid')
        html = page.locator('#preview-content .rendered-mermaid svg').first.inner_html()
        # #1f2020 is in Mermaid's dark palette only (the light one has #333 instead), so it tells the two apart.
        if theme in [t["id"] for t in THEMES if t["dark"]]:
            assert '#1f2020' in html, (theme, 'dark theme, but the diagram is not in the dark palette', html[:3000])
        else:
            assert '#1f2020' not in html, (theme, 'light theme, but the diagram is in the dark palette', html[:3000])
    set_theme(page, 'paper')  # the loop used to end on the default theme; what follows does not depend on a theme
    page.locator('[data-view="single"]').click()
    fixture(page, '前\n\n```mermaid\nflowchart LR\n A[\n```\n\n尾')
    expect(page.locator('.cm-content .mermaid-error')).to_contain_text('Parse error')
    page.locator('.cm-content .mermaid-error').click()
    expect(page.locator('.cm-content')).to_contain_text('A[')
    page.keyboard.press('Meta+ArrowDown')
    page.locator('[data-view="read"]').click()
    expect(page.locator('#preview-content pre code')).to_contain_text('A[')
    expect(page.locator('#preview-content .mermaid-error')).to_contain_text('Parse error')
    page.locator('[data-view="single"]').click()
    button = page.locator('#format-bar [data-action="mermaid"]')
    expect(button).to_have_accessible_name('图表')
    expect(button).to_have_attribute('title', '图表')
    for command in ('toolbar', 'slash', 'insert'):
        replace(page, '')
        if command == 'toolbar':
            button.click()
        elif command == 'slash':
            page.keyboard.insert_text('/')
            page.keyboard.insert_text('tubiao')
            expect(page.locator('#slash-menu [data-slash-item="mermaid"]')).to_have_text('图表')
            page.keyboard.press('Enter')
        else:
            page.locator('#insert-button').click()
            page.locator('#insert-menu [data-menu-action="mermaid"]').click()
        saved(page, TEMPLATE)
        page.keyboard.insert_text('X')
        saved(page, TEMPLATE.replace('  A[', 'X  A['))
        page.keyboard.press('Meta+z')
        page.keyboard.press('Meta+z')
        saved(page, '/tubiao' if command == 'slash' else '')
    # Author HTML is still sanitized; successful diagrams survive through the trusted insertion boundary.
    fixture(page, TEXT + '\n\n<svg onload="alert(1)"><text>author-svg</text></svg><script>alert(1)</script>')
    # Exports print on white paper: even under 夜墨 their diagrams use the light theme.
    for kind in ('html', 'copyRich', 'pdf'):
        set_theme(page, 'ink')
        page.locator('.export-button').click()
        page.locator(f'[data-deliver="{kind}"]').click()
        expect(page.locator('#ready-dialog')).to_be_visible()
        diagrams(page, '#print-document .rendered-mermaid')
        expect(page.locator('#print-document .rendered-mermaid').first).to_have_attribute('data-theme', 'paper')
        expect(page.locator('#print-document script, #print-document [onload]')).to_have_count(0)
        assert 'author-svg' not in page.locator('#print-document').inner_html()
        if kind == 'html':
            with page.expect_download() as pending:
                page.locator('#ready-go').click()
            html = Path(pending.value.path()).read_text()
            assert html.count('<svg') == 2 and '开始' in html and '结束' in html
        page.keyboard.press('Escape')
    page.evaluate('delete document.documentElement.dataset.liubaiTheme; delete document.documentElement.dataset.liubaiScheme')
    fixture(page, '前\n\n```mermaid\nnot a diagram\n```\n\n尾')
    page.locator('.export-button').click()
    page.locator('[data-deliver="html"]').click()
    expect(page.locator('#ready-dialog')).to_be_visible()
    expect(page.locator('#print-document pre code')).to_have_text('not a diagram\n')
    page.keyboard.press('Escape')
    page.evaluate("localStorage.setItem('mygo:locale','en')")
    page.reload()
    expect(page.locator('#format-bar [data-action="mermaid"]')).to_have_accessible_name('Diagram')
    expect(page.locator('#format-bar [data-action="mermaid"]')).to_have_attribute('title', 'Diagram')
    page.locator('#insert-button').click()
    expect(page.locator('#insert-menu [data-menu-action="mermaid"]')).to_have_text('Diagram')
    page.keyboard.press('Escape')
    replace(page, '')
    page.locator('#format-bar [data-action="mermaid"]').click()
    expect(page.locator('.cm-content')).to_contain_text('A[Start] --> B[End]')
    assert not violations, violations
    print('PASS: lazy Mermaid, editor/reader SVG, caret/error/theme, stable prose layout, toolbar/slash/insert/undo, inline exports/unique ids, sanitizer/CSP and English')


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get('PLAYWRIGHT_CHANNEL', 'chrome'))
    page = browser.new_page(locale='zh-CN', viewport={'width': 1120, 'height': 820})
    page.set_default_timeout(15000)
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
