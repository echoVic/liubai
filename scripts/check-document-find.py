"""Document find/replace and reader search. Run against an isolated -web server.

For reader-only RED/GREEN without a server, pass --reader-module PATH to a private
IIFE bundle exporting createReaderFind and SearchQuery as readerFixture.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1].rstrip("/")
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-find-"))
WHITESPACE = (
    '<section id="find-whitespace-fixture">'
    '<p data-find="soft">📝 softalpha\nsoftbeta suffix</p>'
    '<p data-find="spaces">📝 repeatalpha  repeatbeta   suffix</p>'
    '<p data-find="inline">📝 <span>inlinealpha </span><em> \n\t</em><a> inlinebeta</a> suffix</p>'
    '<p data-find="nbsp">nbspalpha\u00a0\u00a0nbspbeta</p>'
    '<p data-find="one-nbsp">onealpha\u00a0onebeta</p>'
    '<pre data-find="pre"><code>📝 prealpha  <span>prebeta</span>\n\tpregamma</code></pre>'
    '<p data-find="code">📝 <code>codealpha  <span>codebeta</span></code> suffix</p>'
    '<p data-find="edges">  edgealpha <span> </span></p><p> edgebeta  </p>'
    '<p>breakalpha<br>breakbeta</p>'
    '</section>'
)
CONTENT = (
    '---\ntags: ["隐藏属性"]\n---\n\n# 查找体验\n\n'
    '留白 **中文** 📝，留白。\n\nApple apple pineapple\n\n甲**乙**丙\n\n'
    'renderalpha\nrenderbeta\n\nrendergamma  renderdelta\n\n'
    '<details><summary>折叠标题</summary><p>藏起来的文字</p></details>\n\n'
    '| 名称 | 内容 |\n| --- | --- |\n| 表格 | 中文 📝 |\n\n'
    '```js\nconst example = "代码命中";\n```\n\n'
    + "\n\n".join(f"第 {i} 段：阅读时自由滚动。" for i in range(50))
    + "\n\n远处的命中\n"
)


def api(page, method, *args):
    result = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE}).json()
    assert not result.get("error"), result
    return result["value"]


def check_reader_whitespace(page):
    query, count = page.locator("#find-query"), page.locator("#find-count")
    page.evaluate("""html => {
      document.querySelector('#preview-content').insertAdjacentHTML('beforeend', html);
      window.findWhitespaceRects = Range.prototype.getClientRects;
      window.findWhitespaceRanges = [];
      Range.prototype.getClientRects = function() {
        if (this.startContainer.parentElement?.closest('#find-whitespace-fixture'))
          window.findWhitespaceRanges.push(this.cloneRange());
        return window.findWhitespaceRects.call(this);
      };
    }""", WHITESPACE)
    evidence, failures = [], []
    # Every positive case checks the exact UTF-16 endpoints used by the painter,
    # and verifies that the actual overlay covers those browser text rectangles.
    cases = [
        ("soft", "softalpha softbeta", "softalpha\nsoftbeta", False),
        ("soft", "📝 softalpha softbeta", "📝 softalpha\nsoftbeta", False),
        ("soft", "softbeta suffix", "softbeta suffix", False),
        ("spaces", "repeatalpha repeatbeta", "repeatalpha  repeatbeta", False),
        ("spaces", "repeatbeta suffix", "repeatbeta   suffix", False),
        ("spaces", "repeatalpha( )repeatbeta", "repeatalpha  repeatbeta", True),
        ("inline", "inlinealpha inlinebeta", "inlinealpha  \n\t inlinebeta", False),
        ("inline", "inlinebeta suffix", "inlinebeta suffix", False),
        ("inline", "inlinealpha ", "inlinealpha  \n\t ", False),
        ("inline", " inlinebeta", "  \n\t inlinebeta", False),
        ("nbsp", "nbspalpha nbspbeta", None, False),
        ("nbsp", "nbspalpha\u00a0\u00a0nbspbeta", "nbspalpha\u00a0\u00a0nbspbeta", False),
        # CodeMirror literal search uses NFKD; regex distinguishes a single NBSP.
        ("one-nbsp", "onealpha onebeta", None, True),
        ("one-nbsp", "onealpha\u00a0onebeta", "onealpha\u00a0onebeta", True),
        ("pre", "prealpha prebeta", None, False),
        ("pre", "prealpha  prebeta", "prealpha  prebeta", False),
        ("pre", r"prebeta\n\tpregamma", "prebeta\n\tpregamma", True),
        ("code", "codealpha codebeta", None, False),
        ("code", "codealpha  codebeta", "codealpha  codebeta", False),
        ("edges", "edgealpha edgebeta", None, False),
        ("edges", "edgealpha ", None, False),
        ("edges", " edgebeta", None, False),
        ("edges", "breakalpha breakbeta", None, False),
    ]
    try:
        for name, phrase, raw, regexp in cases:
            try:
                query.fill("")
                toggle = page.locator("#find-regexp")
                if toggle.get_attribute("aria-pressed") != str(regexp).lower():
                    toggle.click()
                page.evaluate("window.findWhitespaceRanges = []")
                query.fill(phrase)
                page.evaluate("() => new Promise(resolve => requestAnimationFrame(resolve))")
                expect(count).to_have_text("1 / 1" if raw is not None else "未找到")
                if raw is None:
                    expect(page.locator(".reader-find-current")).to_have_count(0)
                    continue
                result = page.evaluate("""({name, raw}) => {
                  const el = document.querySelector(`[data-find="${name}"]`);
                  const from = el.textContent.indexOf(raw), to = from + raw.length;
                  if (from < 0) throw Error('Missing expected raw text');
                  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                  const expected = document.createRange(); let offset = 0, started = false;
                  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
                    if (!started && offset + node.length > from) {
                      expected.setStart(node, from - offset); started = true;
                    }
                    if (started && offset + node.length >= to) {
                      expected.setEnd(node, to - offset); break;
                    }
                    offset += node.length;
                  }
                  const range = window.findWhitespaceRanges.find(r =>
                    r.compareBoundaryPoints(Range.START_TO_START, expected) === 0 &&
                    r.compareBoundaryPoints(Range.END_TO_END, expected) === 0);
                  const rects = Array.from(window.findWhitespaceRects.call(expected)).filter(r => r.width > 0);
                  const marks = Array.from(document.querySelectorAll('.reader-find-current')).map(el => el.getBoundingClientRect());
                  return {name, raw, mapped: !!range, start: expected.startOffset, end: expected.endOffset,
                    painted: marks.length, covered: rects.length > 0 && rects.every(r => marks.some(m =>
                      m.left <= r.left + 1 && m.right >= r.right - 1 &&
                      m.top <= r.top + 1 && m.bottom >= r.bottom - 1))};
                }""", {"name": name, "raw": raw})
                assert result["mapped"] and result["covered"], result
                evidence.append(result)
                if phrase == "inlinealpha inlinebeta":
                    page.screenshot(path=str(ARTIFACTS / "reader-whitespace.png"))
            except AssertionError as error:
                failures.append(f"{name} {phrase!r}: {str(error).split('Call log:')[0]}")
        (ARTIFACTS / "reader-whitespace.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
        print("Whitespace evidence:", ARTIFACTS)
        assert not failures, "\n".join(failures)
    finally:
        page.evaluate("""() => {
          Range.prototype.getClientRects = window.findWhitespaceRects;
          document.querySelector('#find-whitespace-fixture').remove();
        }""")
        query.fill("")
        if page.locator("#find-regexp").get_attribute("aria-pressed") == "true":
            page.locator("#find-regexp").click()


with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"), headless=True)
    page = browser.new_page(locale="zh-CN", viewport={"width": 1120, "height": 820})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    if BASE == "--reader-module":
        page.set_content("""<style>
          .preview-scroll{position:relative;height:650px;overflow:auto}
          #preview-content{padding:20px;font:18px/1.6 sans-serif}
          .reader-find-highlights{position:absolute;inset:0;pointer-events:none}
          .reader-find-match{position:absolute;background:#ffd96680}
        </style><input id="find-query"><button id="find-regexp" aria-pressed="false">.*</button>
        <span id="find-count"></span><div class="preview-scroll"><div id="preview-content"></div></div>""")
        page.add_script_tag(path=sys.argv[2])
        page.evaluate("""() => {
          const {createReaderFind, SearchQuery} = readerFixture;
          const input = document.querySelector('#find-query'), toggle = document.querySelector('#find-regexp');
          const reader = createReaderFind(document.querySelector('#preview-content'), document.querySelector('.preview-scroll'),
            () => {document.querySelector('#find-count').textContent = reader.result.matches.length ? '1 / ' + reader.result.matches.length : '未找到'});
          input.oninput = () => reader.set(new SearchQuery({search:input.value, literal:true,
            regexp:toggle.getAttribute('aria-pressed') === 'true'}), true, true);
          toggle.onclick = () => {toggle.setAttribute('aria-pressed', String(toggle.getAttribute('aria-pressed') !== 'true')); input.oninput()};
        }""")
        check_reader_whitespace(page)
        assert not errors, errors
        browser.close()
        print("PASS: isolated real-browser reader whitespace, UTF-16 Range mapping and overlay geometry")
        print("Evidence:", ARTIFACTS)
        sys.exit(0)
    page.goto(BASE)
    current = api(page, "New")["current"]
    api(page, "UpdateAppearance", {"layout": "single", "source": False})
    api(page, "Update", {"id": current["id"], "revision": current["revision"], "content": CONTENT, "position": {}})
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    entry = page.locator("#document-find-button")
    expect(entry).to_be_visible()
    expect(entry).to_have_text("查找")
    desk_before = page.locator(".desk").bounding_box()
    entry.click()
    bar = page.locator("#document-find")
    query = page.locator("#find-query")
    count = page.locator("#find-count")
    expect(bar).to_be_visible()
    expect(query).to_be_focused()
    desk_after = page.locator(".desk").bounding_box()
    assert abs(desk_before["y"] - desk_after["y"]) < 1, (desk_before, desk_after)
    assert abs(desk_before["height"] - desk_after["height"]) < 1
    assert bar.evaluate("el => getComputedStyle(el).position") == "fixed"
    assert bar.bounding_box()["width"] <= 440 and bar.bounding_box()["height"] < 120
    assert bar.bounding_box()["y"] >= desk_after["y"]
    expect(page.locator(".cm-search")).to_have_count(0)
    query.fill("留白")
    expect(count).to_have_text("1 / 2")
    query.press("Enter")
    expect(count).to_have_text("2 / 2")
    query.press("Shift+Enter")
    expect(count).to_have_text("1 / 2")
    assert page.locator(".cm-searchMatch").count() >= 1
    page.locator("#find-replace-toggle").focus()
    page.keyboard.press("Enter")
    expect(page.locator("#find-replacement")).to_be_focused()
    page.locator("#find-replacement").fill("Liubai")
    page.locator("#find-replace-next").click()
    expect(count).to_have_text("1 / 1")
    page.keyboard.press("Escape")
    page.keyboard.press("Meta+z")
    page.keyboard.press("Meta+f")
    expect(count).to_have_text("1 / 2")
    page.locator("#find-replace-all").click()
    expect(count).to_have_text("未找到")
    page.keyboard.press("Escape")
    expect(bar).to_be_hidden()
    page.keyboard.press("Meta+z")
    page.keyboard.press("Meta+f")
    expect(query).to_be_focused()
    expect(count).to_have_text("1 / 2")
    page.locator('[data-view="read"]').click()
    expect(page.locator("#preview-content")).to_be_visible()
    expect(bar).to_be_visible()
    expect(query).to_have_value("留白")
    expect(page.locator("#find-replace-toggle")).to_be_hidden()
    expect(page.locator("#find-replace-row")).to_be_hidden()
    query.fill("甲乙丙")
    expect(count).to_have_text("1 / 1")
    expect(page.locator(".reader-find-current").first).to_be_visible()
    assert page.locator("#preview-content mark").count() == 0
    query.fill("中文 📝")
    expect(count).to_have_text("1 / 2")
    query.press("Enter")
    expect(count).to_have_text("2 / 2")
    query.fill("代码命中")
    expect(count).to_have_text("1 / 1")
    for phrase in ["renderalpha renderbeta", "rendergamma renderdelta"]:
        query.fill(phrase)
        expect(count).to_have_text("1 / 1")
        expect(page.locator(".reader-find-current").first).to_be_visible()
    check_reader_whitespace(page)
    query.fill("隐藏属性")
    expect(count).to_have_text("未找到")
    query.fill("藏起来的文字")
    expect(count).to_have_text("未找到")
    page.locator("#preview-content details:not(.md-front-matter) summary").click()
    expect(count).to_have_text("1 / 1")
    query.fill("apple")
    expect(count).to_have_text("1 / 3")
    page.locator("#find-case").click()
    expect(count).to_have_text("1 / 2")
    page.locator("#find-word").click()
    expect(count).to_have_text("1 / 1")
    query.fill("中文|代码命中")
    page.locator("#find-word").click()
    page.locator("#find-regexp").click()
    expect(count).to_have_text("1 / 3")
    query.fill("[")
    expect(count).to_have_text("正则表达式无效")
    expect(query).to_have_attribute("aria-invalid", "true")
    page.locator("#find-regexp").click()
    page.locator("#find-case").click()
    query.fill("远处的命中")
    expect(count).to_have_text("1 / 1")
    assert page.locator(".preview-scroll").evaluate("el => el.scrollTop") > 1500
    page.locator(".preview-scroll").evaluate("el => {el.scrollTop=400;el.dispatchEvent(new Event('scroll'))}")
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    assert abs(page.locator(".preview-scroll").evaluate("el => el.scrollTop") - 400) < 2
    # Closing and reopening in reading mode uses the same app shortcut.
    page.keyboard.press("Escape")
    expect(bar).to_be_hidden()
    expect(page.locator(".reader-find-current")).to_have_count(0)
    page.keyboard.press("Meta+f")
    expect(query).to_be_focused()
    query.fill("留白")
    expect(count).to_have_text("1 / 2")
    page.keyboard.press("Meta+g")
    expect(count).to_have_text("2 / 2")
    page.keyboard.press("Meta+Shift+g")
    expect(count).to_have_text("1 / 2")
    page.evaluate("() => Promise.all(document.querySelector('#document-find').getAnimations().map(a => a.finished))")
    page.screenshot(path=str(ARTIFACTS / "reader-find.png"))
    page.locator('[data-view="split"]').click()
    expect(page.locator("#find-replace-toggle")).to_be_visible()
    expect(count).to_have_text("1 / 2")
    page.screenshot(path=str(ARTIFACTS / "editor-find.png"))
    for width in [820, 680, 480, 360]:
        page.set_viewport_size({"width": width, "height": 820})
        expect(entry).to_be_visible()
        expect(query).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert bar.evaluate("el => el.scrollWidth <= el.clientWidth"), width
    # A new document clears old matches, without clearing the search phrase.
    page.keyboard.press("Escape")
    page.keyboard.press("Meta+n")
    page.keyboard.press("Meta+f")
    expect(query).to_have_value("留白")
    expect(count).to_have_text("未找到")
    page.evaluate("""() => {
      localStorage.setItem('mygo:locale','en');
      window.dispatchEvent(new StorageEvent('storage',{key:'mygo:locale'}));
      document.documentElement.dataset.liubaiTheme='ink';
      document.documentElement.dataset.liubaiScheme='dark';
    }""")
    expect(entry).to_have_text("Find")
    expect(count).to_have_text("No matches")
    page.locator("#find-regexp").click()
    query.fill("[")
    expect(count).to_have_text("Invalid regular expression")
    assert bar.evaluate("el => el.scrollWidth <= el.clientWidth")
    assert bar.bounding_box()["x"] >= 0 and bar.bounding_box()["x"] + bar.bounding_box()["width"] <= 360
    page.screenshot(path=str(ARTIFACTS / "find-dark-english-compact.png"))
    assert not errors, errors
    browser.close()
    print("PASS: floating layout, find entry, shortcuts, navigation, replacement undo, reading highlights, inline/table/code text, collapsed content, options, invalid regex, scroll, mode/document changes, responsive layout, English and dark theme")
    print("Evidence:", ARTIFACTS)
