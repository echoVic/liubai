"""Word export regression. Run via scripts/e2e.sh check-docx (fresh server/data)."""
from pathlib import Path
import re
import zipfile
from xml.etree import ElementTree as ET
from playwright.sync_api import expect, sync_playwright
from checklib import base_url, evidence, launch, save_failure

BASE = base_url()
ARTIFACTS = evidence('liubai-docx-qa-')
TEXT = '# 中文 Word\n\n正文 **bold** 与 $\\frac{1}{x}$。\n\n3. 三\n4. 四\n\n脚注[^1]\n\n[^1]: 注释 English\n'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math'}


def replace(page, text):
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+a')
    page.keyboard.insert_text(text)
    expect(page.locator('#save-status')).to_have_text(re.compile('^(草稿已保存|Draft saved)$'))
    response = page.request.post(BASE + '/api', data={'method': 'State', 'args': []}, headers={'Origin': BASE})
    assert response.ok and response.json()['value']['current']['content'] == text


def check_download(page, name):
    with page.expect_download() as pending:
        page.locator('#ready-go').click()
    download = pending.value
    assert download.suggested_filename.endswith('.docx'), download.suggested_filename
    path = ARTIFACTS / name
    download.save_as(str(path))
    with zipfile.ZipFile(path) as package:
        assert package.testzip() is None
        assert '[Content_Types].xml' in package.namelist()
        xml = ET.fromstring(package.read('word/document.xml'))
        assert xml.find('.//w:pStyle[@w:val="Heading1"]', NS) is not None
        assert xml.find('.//m:f', NS) is not None
        assert xml.find('.//w:footnoteReference', NS) is not None
        assert '注释 English' in ''.join(ET.fromstring(package.read('word/footnotes.xml')).itertext())
    return path


def run(page):
    requests, violations = [], []
    page.on('request', lambda request: requests.append(request.url))
    page.add_init_script("document.addEventListener('securitypolicyviolation',e=>console.error('CSP violation: '+e.violatedDirective+' '+e.blockedURI))")
    page.on('console', lambda message: violations.append(message.text) if message.text.startswith('CSP violation:') else None)
    page.goto(BASE)
    expect(page.locator('.cm-content')).to_be_visible()
    page.locator('[data-view="split"]').click()
    source = page.locator('#format-bar [data-action="source"]')
    if source.get_attribute('aria-pressed') != 'true':
        source.click()
    replace(page, TEXT)
    page.locator('[data-view="read"]').click()
    page.locator('.export-button').click()
    page.locator('[data-deliver="html"]').click()
    expect(page.locator('#ready-dialog')).to_be_visible()
    with page.expect_download():
        page.locator('#ready-go').click()
    assert not any(re.search(r'/docx-export-[a-f0-9]+\.js', url) for url in requests), requests
    page.locator('.export-button').click()
    expect(page.locator('[data-deliver="docx"]')).to_contain_text('Word 文稿（.docx）')
    page.locator('[data-deliver="docx"]').click()
    expect(page.locator('#ready-info')).to_contain_text('可编辑的 Word 文稿')
    expect(page.locator('#ready-go')).to_have_text('下载 Word 文稿')
    assert not any(re.search(r'/docx-export-[a-f0-9]+\.js', url) for url in requests), requests
    check_download(page, 'dialog.docx')
    chunks = [url for url in requests if re.search(r'/docx-export-[a-f0-9]+\.js', url)]
    assert len(chunks) == 1, chunks
    # The command palette follows the same preparation and download flow.
    page.keyboard.press('Meta+k')
    page.locator('#command-search').fill('导出 Word 文稿')
    page.locator('#command-list button').click()
    expect(page.locator('#ready-dialog')).to_be_visible()
    check_download(page, 'command.docx')
    # Missing-image confirmation is shared with other exports.
    page.locator('[data-view="single"]').click()
    replace(page, TEXT + '\n![missing](not-here.png)')
    page.locator('.export-button').click()
    page.locator('[data-deliver="docx"]').click()
    expect(page.locator('#missing-dialog')).to_be_visible()
    page.locator('#export-anyway').click()
    expect(page.locator('#ready-info')).to_contain_text('缺失')
    check_download(page, 'missing.docx')
    page.evaluate("localStorage.setItem('mygo:locale','en')")
    page.reload()
    expect(page.locator('.cm-content')).to_be_visible()
    page.locator('.export-button').click()
    expect(page.locator('[data-deliver="docx"]')).to_contain_text('Word Document (.docx)')
    page.locator('[data-deliver="docx"]').click()
    page.locator('#export-anyway').click()
    expect(page.locator('#ready-info')).to_contain_text('An editable Word document')
    expect(page.locator('#ready-go')).to_have_text('Download Word Document')
    check_download(page, 'english.docx')
    page.keyboard.press('Meta+k')
    page.locator('#command-search').fill('Export Word Document')
    expect(page.locator('#command-list button')).to_have_count(1)
    page.keyboard.press('Escape')
    # The HTML export escapes the title rather than dropping & < >, and names the file after it.
    replace(page, '# R&D <笔记>\n\n正文\n')
    page.locator('.export-button').click()
    page.locator('[data-deliver="html"]').click()
    expect(page.locator('#ready-dialog')).to_be_visible()
    with page.expect_download() as pending:
        page.locator('#ready-go').click()
    html = Path(pending.value.path()).read_text(encoding='utf-8')
    assert '<title>R&amp;D &lt;笔记&gt;</title>' in html, html[:300]
    assert pending.value.suggested_filename.startswith('R&D'), pending.value.suggested_filename
    assert not violations, violations
    print('PASS: Word lazy chunk, dialog/palette/download, missing image confirmation, OOXML, English and CSP')


with sync_playwright() as playwright:
    browser = launch(playwright.chromium)
    page = browser.new_page(locale='zh-CN', viewport={'width': 1120, 'height': 820})
    page.set_default_timeout(15000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        run(page)
        assert not errors, errors
    except Exception:
        save_failure(ARTIFACTS, page, errors)
        raise
    finally:
        browser.close()
