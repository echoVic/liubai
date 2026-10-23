"""Inline images. Run via scripts/e2e.sh check-images (fresh server/data)."""
import json
import base64
import html
import os
from pathlib import Path
import re
import struct
import sys
import tempfile
import zlib
from urllib.parse import unquote
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4196'
ARTIFACTS = Path(tempfile.mkdtemp(prefix='liubai-images-qa-'))
THEMES = json.loads((Path(__file__).resolve().parent.parent / "src" / "themes.json").read_text())
PREFIX, SUFFIX = '前文  \n\n', '\n\n尾文\t '


def api(page, method, *args):
    response = page.request.post(BASE + '/api', data={'method': method, 'args': list(args)}, headers={'Origin': BASE})
    assert response.ok, response.text()
    data = response.json()
    assert not data.get('error'), data
    return data['value']


def set_theme(page, theme):
    """Paint a theme the way the app does, both root attributes. Assert right after: the app repaints the stored theme on its next minute tick or window focus."""
    scheme = 'dark' if next(t['dark'] for t in THEMES if t['id'] == theme) else 'light'
    page.evaluate("([theme, scheme]) => { const root = document.documentElement; root.dataset.liubaiTheme = theme; root.dataset.liubaiScheme = scheme }", [theme, scheme])


def saved(page, expected=None):
    expect(page.locator('#save-status')).to_have_text('草稿已保存')
    current = api(page, 'State')['current']['content']
    if expected is not None:
        assert current == expected, (current, expected)
    return current


def saved_position(page, check, timeout=7000):
    """Poll the persisted position; Playwright treats an async wait_for_function predicate as already true."""
    for _ in range(timeout // 100):
        current = api(page, 'State')['current']
        if check(current):
            return current
        page.wait_for_timeout(100)
    raise AssertionError(api(page, 'State')['current']['position'])


def source(page, value):
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+a')
    page.keyboard.insert_text(value)
    saved(page, value)
    # Move the text cursor off the image: keyboard entry still reveals its source.
    page.keyboard.press('Meta+ArrowDown')
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('[data-view="single"]').click()
    expect(page.locator('.inline-image')).to_have_count(1)
    expect(page.locator('.inline-image img')).to_have_js_property('complete', True)


def select(page):
    page.locator('.inline-image img').click()
    expect(page.locator('.inline-image')).to_have_class(re.compile('image-selected'))
    expect(page.locator('.image-resize-handle')).to_be_visible()
    expect(page.locator('.image-toolbar')).to_be_visible()
    assert '![' not in page.locator('.cm-content').inner_text()


def action(page, name):
    select(page)
    page.locator(f'[data-image-action="{name}"]').click()


def undo(page, expected, deleted=False):
    page.keyboard.press('Meta+z')
    saved(page, expected)
    if deleted:
        # Delete restores the document caret; moving it off the restored line shows the widget.
        page.keyboard.press('Meta+ArrowDown')
    expect(page.locator('.inline-image')).to_have_count(1)


def png(path):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 640, 320, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + b'\x70\x99\x88' * 640) * 320)) + chunk(b'IEND', b''))


def geometry(page, selector):
    expect(page.locator(selector)).to_be_visible()
    page.wait_for_function('(selector)=>document.querySelector(selector)?.naturalWidth>0', arg=selector)
    return page.locator(selector).evaluate('''el => { const r=el.getBoundingClientRect(),column=el.closest('.markdown-document')||document.querySelector('.cm-content'),p=column.getBoundingClientRect(),style=getComputedStyle(column),left=p.left+parseFloat(style.paddingLeft),right=p.right-parseFloat(style.paddingRight);return {width:r.width,left:r.left-left,right:right-r.right,src:el.src} }''')


def run(page):
    page.goto(BASE)
    expect(page.locator('.cm-content')).to_be_visible()
    fixture = ARTIFACTS / 'image.png'
    png(fixture)
    page.locator('#image-input').set_input_files(str(fixture))
    expect(page.locator('.inline-image')).to_have_count(1)
    imported = saved(page)
    path = re.search(r'!\[[^\]]*\]\(([^)]+)\)', imported)[1]
    md = f'![说明]({path} "标题")'
    img = lambda width=None, alt='说明', height=None: f'<img src="{path}" alt="{alt}" title="标题"' + (f' width="{width}"' if width else '') + (f' height="{height}"' if height else '') + '>'
    forms = [md, img(300, height=200), '<p align="center">' + img() + '</p>', '<p align="right">' + img(240) + '</p>']
    for raw in forms:
        text = PREFIX + raw + SUFFIX
        source(page, text)
        select(page)
        for name in ('bold', 'italic', 'underline', 'strike', 'highlight', 'inlineCode', 'superscript', 'subscript', 'clearFormatting', 'link', 'quote', 'bullet', 'ordered', 'task', 'indent', 'outdent'):
            expect(page.locator(f'#format-bar [data-action="{name}"]')).to_be_disabled()
        expect(page.locator('#heading-button')).to_be_disabled()
        page.keyboard.insert_text('不得输入')
        saved(page, text)
        # Real pointer drag, live badge, rounded width and one-step undo.
        box = page.locator('.image-resize-handle').bounding_box()
        old_width = page.locator('.inline-image img').bounding_box()['width']
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.mouse.down()
        page.mouse.move(box['x'] + box['width'] / 2 + 37, box['y'] + box['height'] / 2, steps=8)
        badge = page.locator('.image-width-badge')
        expect(badge).to_be_visible()
        width = int(badge.inner_text().split()[0])
        assert abs(width - old_width - 37) <= 1 or width == round(page.locator('.inline-image').bounding_box()['width'])
        page.mouse.up()
        align = 'center' if 'align="center"' in raw else 'right' if 'align="right"' in raw else 'left'
        resized = img(width)
        if align != 'left':
            resized = f'<p align="{align}">{resized}</p>'
        saved(page, PREFIX + resized + SUFFIX)
        undo(page, text)
        page.keyboard.press('Meta+Shift+z')
        saved(page, PREFIX + resized + SUFFIX)
        undo(page, text)
        # Escape cancels an in-progress resize without writing Markdown.
        select(page)
        box = page.locator('.image-resize-handle').bounding_box()
        page.mouse.move(box['x'] + 5, box['y'] + 5)
        page.mouse.down()
        page.mouse.move(box['x'] - 30, box['y'] + 5)
        page.keyboard.press('Escape')
        page.mouse.up()
        saved(page, text)
        expect(badge).to_be_hidden()
        for target in ('center', 'right', 'left'):
            action(page, target)
            current = saved(page)
            assert current.startswith(PREFIX) and current.endswith(SUFFIX)
            if target == 'left':
                assert '<p align=' not in current
            else:
                assert f'<p align="{target}">' in current
            expect(page.locator(f'[data-image-action="{target}"]')).to_have_attribute('aria-pressed', 'true')
            # Same column width, same alignment in reading view.
            before = geometry(page, '.inline-image img')
            page.locator('[data-view="read"]').click()
            expect(page.locator('#preview-content img')).to_be_visible()
            after = geometry(page, '#preview-content img')
            assert before['src'] == after['src']
            for key in ('width', target if target in ('left', 'right') else 'left'):
                assert abs(before[key] - after[key]) <= 1, (before, after, target)
            page.locator('[data-view="single"]').click()
            select(page)
            undo(page, text)
        action(page, 'original')
        expected = md if align == 'left' else f'<p align="{align}">{img()}</p>'
        saved(page, PREFIX + expected + SUFFIX)
        undo(page, text)
        action(page, 'original')
        action(page, 'left')
        saved(page, PREFIX + md + SUFFIX)
        # Reset to the fixture to keep each remaining action independent.
        source(page, text)
        select(page)
        page.keyboard.press('Enter')
        alt = page.locator('.image-alt-popover input')
        expect(alt).to_have_value('说明')
        alt.fill('取消')
        page.keyboard.press('Escape')
        saved(page, text)
        action(page, 'alt')
        alt.fill('新说明')
        page.keyboard.press('Enter')
        saved(page, text.replace('说明', '新说明'))
        undo(page, text)
        action(page, 'alt')
        alt.dispatch_event('compositionstart')
        alt.fill('组字')
        alt.dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
        page.wait_for_timeout(900)
        assert api(page, 'State')['current']['content'] == text
        alt.dispatch_event('compositionend', {'data': '组字'})
        page.wait_for_timeout(50)
        saved(page, text)
        page.keyboard.press('Enter')
        saved(page, text.replace('说明', '组字'))
        undo(page, text)
        for delete in ('toolbar', 'Delete', 'Backspace'):
            select(page)
            if delete == 'toolbar':
                page.locator('[data-image-action="delete"]').click()
            else:
                page.keyboard.press(delete)
            saved(page, '前文  \n\n尾文\t ')
            undo(page, text, deleted=True)
        select(page)
        page.keyboard.press('Escape')
        page.keyboard.insert_text('续')
        saved(page, text.replace('尾文', '续尾文'))
        undo(page, text)
    # Container prefixes, block handles, source mode and escaped paths.
    for container in ('> ', '- ', '> - '):
        text = PREFIX + container + md + SUFFIX
        source(page, text)
        action(page, 'center')
        saved(page, PREFIX + container + '<p align="center">' + img() + '</p>' + SUFFIX)
        before = geometry(page, '.inline-image img')
        page.locator('[data-view="read"]').click()
        after = geometry(page, '#preview-content img')
        assert before['src'] == after['src']
        for key in ('width', 'left', 'right'):
            assert abs(before[key] - after[key]) <= 1, (container, before, after)
        page.locator('[data-view="single"]').click()
        select(page)
        undo(page, text)
    # Both real renderers must request the same escaped path. Only image byte loading is stubbed.
    data_url = 'data:image/png;base64,' + base64.b64encode(fixture.read_bytes()).decode()
    destinations = []
    expected_path = ['']
    def resolve_fixture(route):
        request = route.request.post_data_json
        if request.get('method') != 'ReadImage':
            route.continue_()
            return
        dest = request['args'][1]
        destinations.append(dest)
        assert unquote(dest) == unquote(expected_path[0]), (dest, expected_path[0])
        route.fulfill(json={'value': {'url': data_url}})
    page.route('**/api', resolve_fixture)
    for path_case in ('relative/图 片(a).png', '../中文/a%20b(1).png', 'images/a&b<".png'):
        expected_path[0] = path_case
        escaped = html.escape(path_case, quote=True)
        for raw_case in (f'![说明](<{escaped}>)', f'<img src="{escaped}" alt="说明" width="300">', f'<p align="right"><img src="{escaped}" alt="说明"></p>'):
            source(page, PREFIX + raw_case + SUFFIX)
            editor_src = page.locator('.inline-image img').get_attribute('src')
            page.locator('[data-view="read"]').click()
            image = page.locator('#preview-content img')
            expect(image).to_have_attribute('src', editor_src)
            assert unquote(image.get_attribute('data-image-source')) == unquote(path_case)
            page.locator('[data-view="single"]').click()
    assert destinations
    page.unroute('**/api', resolve_fixture)
    # Delete an image inside a container without removing its sibling paragraphs.
    for text, expected in ((PREFIX + '> 前段\n>\n> ' + md + '\n>\n> 后段' + SUFFIX, PREFIX + '> 前段\n>\n> 后段' + SUFFIX), (PREFIX + '- 前段\n\n  ' + md + '\n\n  后段' + SUFFIX, PREFIX + '- 前段\n\n  后段' + SUFFIX)):
        source(page, text)
        action(page, 'delete')
        saved(page, expected)
        undo(page, text, deleted=True)
    text = PREFIX + md + SUFFIX
    source(page, text)
    select(page)
    copied = page.locator('.image-selected').evaluate("el => { const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain') }")
    assert copied == md
    saved(page, text)
    page.locator('.image-selected').evaluate("el => el.dispatchEvent(new ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()}))")
    saved(page, '前文  \n\n尾文\t ')
    undo(page, text, deleted=True)
    select(page)
    page.locator('#insert-button').click()
    page.locator('#insert-menu [data-menu-action="quote"]').click()
    saved(page, PREFIX + md + '\n\n> ' + SUFFIX)
    page.keyboard.press('Meta+z')
    saved(page, text)
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+ArrowDown')
    page.locator('.inline-image').hover()
    expect(page.locator('#block-grip')).to_be_visible()
    page.locator('#block-grip').click()
    page.locator('#block-menu [data-menu-action="down"]').click()
    saved(page, PREFIX + '尾文\t ' + '\n\n' + md)
    page.keyboard.press('Meta+z')
    saved(page, text)
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+ArrowDown')
    page.locator('.inline-image').hover()
    page.locator('#block-grip').click()
    page.locator('#block-menu [data-menu-action="delete"]').click()
    saved(page, '前文  \n\n尾文\t ')
    undo(page, text, deleted=True)
    for theme in [t["id"] for t in THEMES]:
        set_theme(page, theme)
        select(page)
        page.screenshot(path=str(ARTIFACTS / f'image-{theme}.png'))
    set_theme(page, 'paper')  # back to the default for the steps below
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    expect(page.locator('.inline-image')).to_have_count(0)
    expect(page.locator('.image-toolbar')).to_have_count(0)
    assert md in page.locator('.cm-content').inner_text()
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+ArrowDown')
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('[data-view="single"]').click()
    # Positions are saved after a pause; reload only once the caret below the image is stored, or the restored selection reveals its source.
    end = lambda current: current['position']['anchor'] == current['position']['head'] == len(current['content'].encode('utf-16-le')) // 2
    saved_position(page, end)
    page.evaluate("localStorage.setItem('mygo:locale','en')")
    page.reload()
    select(page)
    expect(page.locator('.image-toolbar')).to_have_accessible_name('Image actions')
    assert [b.get_attribute('aria-label') for b in page.locator('.image-toolbar button').all()] == ['Align left', 'Align center', 'Align right', 'Original size', 'Alt text', 'Delete image']
    expect(page.locator('.image-resize-handle')).to_have_accessible_name('Resize image')
    print('PASS: image selection, resize/cancel, alignments, original size, alt/IME, delete/undo, reader geometry, containers, blocks, source and English')


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
