"""Rendered-cell caret, focus, source guards, thumbnails and reference updates in both engines."""
import base64
import struct
import zlib
from playwright.sync_api import sync_playwright, expect
from checklib import api, base_url, launch, wait_state

BASE = base_url()

def source(page, text):
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+a')
    page.keyboard.insert_text(text)
    wait_state(page,lambda state: state['current']['content']==text)
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('[data-view="single"]').click()
    expect(page.locator('.rendered-table')).to_have_count(1)


def png():
    def chunk(name, data):
        return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data))
    raw = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 512, 512, 8, 2, 0, 0, 0))
    raw += chunk(b'IDAT', zlib.compress((b'\0' + b'\x80\x90\xa0' * 512) * 512)) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(raw).decode()

with sync_playwright() as pw:
    for engine in (pw.chromium, pw.webkit):
        browser = launch(engine)
        page = browser.new_page(locale='zh-CN', viewport={'width': 1120, 'height': 820})
        page.goto(BASE)
        text = '| 模型 | 公式 |\n| --- | --- |\n| **粗体内容一二三四五六** | $x^2$ |\n\n尾文'
        source(page, text)
        cell = page.locator('.rendered-table [data-row="1"][data-column="0"]')
        point = cell.locator('strong').evaluate("""e=>{const r=document.createRange();r.setStart(e.firstChild,8);r.collapse(true);const b=r.getBoundingClientRect();return {x:b.x,y:b.y+b.height/2}}""")
        page.mouse.click(point['x'], point['y'])
        expect(cell).to_have_text('**粗体内容一二三四五六**')
        assert cell.evaluate('e=>getSelection().anchorNode===e.firstChild&&getSelection().anchorOffset===10'), engine.name
        # A window-level blur keeps this cell as activeElement. Its DOM and source caret must survive.
        cell.dispatch_event('blur')
        cell.dispatch_event('focus')
        assert cell.evaluate('e=>getSelection().anchorNode===e.firstChild&&getSelection().anchorOffset===10')
        page.locator('.cm-line').filter(has_text='尾文').click()
        expect(cell.locator('strong')).to_have_count(1)
        cell.dispatch_event('input', {'inputType': 'insertText', 'data': 'x'})
        page.wait_for_timeout(700)
        assert api(page, 'State')['current']['content'] == text, repr(api(page, 'State')['current']['content'])

        current=api(page,'State')['current']
        asset=api(page,'ImportImage',current['id'],'image.png',png().split(',',1)[1])
        image_text = f"| 图片 | 说明 |\n| --- | --- |\n| ![图片]({asset['destination']}) | 紧凑预览 |\n\n尾文"
        source(page, image_text)
        image_cell = page.locator('.rendered-table [data-row="1"][data-column="0"]')
        image = image_cell.locator('img')
        expect(image).to_be_visible()
        assert image.evaluate('e=>e.complete&&e.naturalWidth===512&&e.height<=80')
        before = image_cell.bounding_box()['height']
        image_cell.click()
        assert abs(image_cell.bounding_box()['height'] - before) <= 1, 'focus resized the image row'

        ref_text = '| [标签][ref] | **不变** |\n| --- | --- |\n| 值 | 其他 |\n\n[ref]: https://one.example\n\n[unused]: https://unused.example\n\n尾文'
        source(page, ref_text)
        link = page.locator('.rendered-table a')
        expect(link).to_have_attribute('href', 'https://one.example')
        page.locator('.rendered-table').evaluate("e=>{window.stableTable=e;window.stableCell=e.querySelector('th:nth-child(2)')}")
        definition = page.locator('.cm-line').filter(has_text='https://one.example')
        definition.click()
        page.keyboard.press('Home')
        page.keyboard.press('Shift+End')
        page.keyboard.insert_text('[ref]: https://two.example')
        expect(link).to_have_attribute('href', 'https://two.example')
        page.locator('.rendered-table strong').evaluate('e=>window.stableStrong=e')
        unused = page.locator('.cm-line').filter(has_text='https://unused.example')
        unused.click()
        page.keyboard.press('Home')
        page.keyboard.press('Shift+End')
        page.keyboard.insert_text('[unused]: https://other.example')
        assert page.evaluate("window.stableTable===document.querySelector('.rendered-table')&&window.stableCell===document.querySelector('.rendered-table th:nth-child(2)')"), 'unrelated reference replaced table DOM'
        assert page.evaluate('window.stableStrong===document.querySelector(".rendered-table strong")'), 'unused reference rerendered cell'
        expect(link).to_have_attribute('href', 'https://two.example')
        print('PASS:', engine.name, 'rendered caret, window blur, source-only input, image size and reference invalidation', flush=True)
        browser.close()
