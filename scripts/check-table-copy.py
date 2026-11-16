"""Real browser clipboard writes after delayed table preparation, without replacing navigator.clipboard."""
import re
import time
from playwright.sync_api import sync_playwright, expect
from checklib import api, base_url, launch, wait_state, BRIDGE

BASE=base_url()

def source(page,text):
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+a')
    page.keyboard.insert_text(text)
    wait_state(page,lambda state:state['current']['content']==text)
    page.locator('#format-bar [data-action="source"]').click()
    page.locator('[data-view="single"]').click()

def copy(page):
    page.locator('.table-menu-button').click()
    page.locator('.table-menu:not([hidden]) [data-menu-action=copyRich]').click()

with sync_playwright() as pw:
    for engine in (pw.chromium,pw.webkit):
        browser=launch(engine)
        page=browser.new_page(locale='zh-CN')
        calls=[]
        def delayed(route):
            request=route.request
            data=request.post_data_json
            calls.append(data['method'])
            if data['method']=='TableDelivery':
                assert 'missing-outside.png' not in data['args'][1]
                time.sleep(5.5)
            route.continue_()
        page.route('**/api',delayed)
        page.goto(BASE)
        table='| 模型 | 公式 |\n| --- | --- |\n| **模型甲**[^first] | $x^2$ |'
        text=table+'\n\n[^first]: 第一条说明[^second]。\n\n[^second]: 第二条说明。\n\n![无关图片](missing-outside.png)\n\n尾文'
        source(page,text)
        copy(page)
        expect(page.locator('#ready-dialog')).to_be_visible(timeout=20000)
        expect(page.locator('#missing-dialog')).not_to_be_visible()
        expect(page.locator('#print-document table strong')).to_have_text('模型甲')
        expect(page.locator('#print-document .footnotes')).to_contain_text('第一条说明')
        expect(page.locator('#print-document .footnotes')).to_contain_text('第二条说明')
        page.locator('#ready-go').click()
        expect(page.locator('#ready-dialog')).not_to_be_visible()
        assert 'Delivery' not in calls,'table copy fetched whole-document images'
        # Paste using the real clipboard. This also exercises the browser's write permission/gesture path.
        page.evaluate("()=>{const box=document.createElement('textarea');box.id='clipboard-probe';document.body.append(box)}")
        page.locator('#clipboard-probe').focus()
        page.keyboard.press('Meta+v')
        expect(page.locator('#clipboard-probe')).to_have_value(re.compile('模型甲'))
        pasted=page.locator('#clipboard-probe').input_value()
        assert '尾文' not in pasted and 'x^2' in pasted
        assert '第一条说明' in pasted and '第二条说明' in pasted
        page.locator('#clipboard-probe').evaluate('e=>e.remove()')
        selected=table.replace('**模型甲**','![缺失](missing-selected.png)')
        source(page,selected+'\n\n![无关图片](missing-outside.png)\n\n尾文')
        copy(page)
        expect(page.locator('#missing-dialog')).to_be_visible(timeout=20000)
        expect(page.locator('#missing-list')).to_have_text('missing-selected.png')
        page.locator('#export-anyway').click()
        expect(page.locator('#ready-dialog')).to_be_visible(timeout=20000)
        expect(page.locator('#ready-info')).to_contain_text('缺失')
        page.locator('#ready-go').click()
        expect(page.locator('#ready-dialog')).not_to_be_visible()
        print('PASS:',engine.name,'real clipboard/paste after delayed preparation, table-only delivery and selected-image warning',flush=True)
        browser.close()

    browser=launch(pw.chromium)
    page=browser.new_page(locale='zh-CN')
    page.add_init_script(BRIDGE)
    selections=[]
    def record(request):
        if request.url.endswith('/api') and request.post_data:
            data=request.post_data_json
            if data['method']=='TableDelivery': selections.append(data['args'])
    page.on('request',record)
    page.goto(BASE)
    text='| A图片 |\n| --- |\n| ![缺失](missing-selected.png) |\n\n尾文'
    source(page,text)
    original=api(page,'State')['current']['id']
    copy(page)
    expect(page.locator('#missing-dialog')).to_be_visible()
    other=api(page,'New')
    other=api(page,'Rename',other['current']['id'],'另一份文稿')
    page.evaluate("next=>window.__settingsEvents['liubai:opened'](next)",other)
    expect(page.locator('#doc-title')).to_have_text('另一份文稿')
    page.locator('#export-anyway').click()
    expect(page.locator('#ready-dialog')).to_be_visible()
    assert selections[-1][0]==original,'missing-image retry changed the owning document'
    assert api(page,'State')['current']['id']==other['current']['id'],'copy activated another document'
    expect(page.locator('#print-document table')).to_contain_text('A图片')
    print('PASS: missing-image retry keeps the original document after a desktop open event',flush=True)
    browser.close()
