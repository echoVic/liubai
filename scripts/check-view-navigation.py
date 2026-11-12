"""A queued mode restoration must yield to a later keyboard navigation."""
from playwright.sync_api import sync_playwright, expect
from checklib import base_url, evidence, launch

BASE = base_url()
OUT = evidence("liubai-view-navigation-qa-")
TEXT = "# 文档开头\n\n[[同名]]\n\n" + "\n\n".join(
    f"段落 {i}：" + "检查视图切换后的键盘定位。" * 12 for i in range(80))

with sync_playwright() as pw:
    browser = launch(pw.chromium)
    page = browser.new_page(viewport={"width": 1440, "height": 850}, locale="zh-CN")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until="networkidle")
    page.locator(".cm-content").focus()
    page.keyboard.insert_text(TEXT)
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    page.keyboard.press("Meta+End")
    page.wait_for_function("()=>document.querySelector('.editor-scroll').scrollTop>2000")
    page.locator('[data-view="read"]').click()
    expect(page.locator(".editor-pane")).to_be_hidden()
    page.evaluate("()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
    print("before", page.locator(".editor-scroll").evaluate("e=>e.scrollTop"), flush=True)
    # Hold just the pending frame. Keyboard input can arrive before the next
    # paint in a real window, so it must take priority over the old scroll.
    page.evaluate("""()=>{
      window.__frames=[];window.__originalFrame=window.requestAnimationFrame;
      window.requestAnimationFrame=fn=>{window.__frames.push(fn);return -window.__frames.length};
    }""")
    page.locator('[data-view="single"]').click()
    page.locator(".cm-content").focus()
    page.keyboard.press("Meta+Home")
    print("keyboard", page.evaluate("()=>({head:getSelection()?.anchorNode?.textContent,offset:getSelection()?.anchorOffset,frames:window.__frames.length})"), flush=True)
    page.evaluate("""()=>{window.requestAnimationFrame=window.__originalFrame;
      const queued=window.__frames;window.__frames=[];for(const fn of queued)fn(performance.now());
    }""")
    page.evaluate("""()=>new Promise(resolve=>{
      let n=0;function frame(){if(++n>=12)resolve();else requestAnimationFrame(frame)}
      requestAnimationFrame(frame);
    })""")
    data = page.evaluate("""()=>{
     const scroll=document.querySelector('.editor-scroll'),line=document.querySelector('.cm-line');
     return {scroll:scroll.scrollTop,top:scroll.getBoundingClientRect().top,line:line.getBoundingClientRect().top,
             head:getSelection()?.anchorNode?.textContent,offset:getSelection()?.anchorOffset};
    }""")
    print("after", data, flush=True)
    page.screenshot(path=str(OUT / "home-after-layout.png"))
    browser.close()
assert data["scroll"] < 100, "queued layout restoration overrode the user's Home navigation"
print("PASS: Home after a mode switch wins over its queued scroll restoration")

# Clipboard permission can resolve after the user has entered reading mode.
with sync_playwright() as pw:
    browser = launch(pw.chromium)
    page = browser.new_page(viewport={"width": 1200, "height": 800}, locale="zh-CN")
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until="networkidle")
    page.locator('[data-view="single"]').click()
    page.locator('.cm-content').focus()
    page.keyboard.press('Meta+A')
    page.keyboard.insert_text('剪贴板等待期间保留原文')
    expect(page.locator('#save-status')).to_have_text('草稿已保存')
    page.evaluate("""()=>{window.__pasteRequested=false;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>{
        window.__pasteRequested=true;return new Promise(resolve=>window.__finishPaste=resolve);
      }}});
    }""")
    page.keyboard.press('Meta+k')
    page.locator('#command-search').fill('粘贴为纯文本')
    page.locator('#command-list button').first.click()
    page.wait_for_function('()=>window.__pasteRequested')
    page.locator('[data-view="read"]').click()
    expect(page.locator('.editor-pane')).to_be_hidden()
    page.evaluate("()=>window.__finishPaste('不应写入阅读模式')")
    page.wait_for_timeout(350)
    expect(page.locator('.preview-scroll')).not_to_contain_text('不应写入阅读模式')
    page.locator('[data-view="single"]').click()
    expect(page.locator('.cm-content')).to_have_text('剪贴板等待期间保留原文')
    browser.close()
assert not errors, errors
print('PASS: clipboard completion in reading mode preserves the document')
