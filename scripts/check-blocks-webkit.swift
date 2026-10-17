import AppKit
import WebKit

// Block handles, drag and the slash menu in WebKit, the engine of the desktop app, in an off-screen window.
// Pointer events are dispatched in the page: WebKit ignores native mouse events for windows that are not key.
let url = URL(string: CommandLine.arguments[1])!
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let size = NSSize(width: 1440, height: 900)
let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
window.acceptsMouseMovedEvents = true
let web = WKWebView(frame: NSRect(origin: .zero, size: size))
window.contentView = web
// Ordered in far off-screen so WebKit lays it out as visible; the app never activates and the window is never key.
window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
window.orderFrontRegardless()

func fail(_ m: String) -> Never { FileHandle.standardError.write(Data("blocks webkit: \(m)\n".utf8)); exit(1) }
@MainActor func js(_ s: String) async -> Any? {
  do { return try await web.callAsyncJavaScript(s, arguments: [:], in: nil, contentWorld: .page) } catch { fail("js error: \(error) in \(s.prefix(80))") }
}
@MainActor func wait(_ ms: UInt64) async { try? await Task.sleep(nanoseconds: ms * 1_000_000) }
@MainActor func mouse(_ type: String, _ x: Double, _ y: Double, buttons: Int = 0) async {
  _ = await js("const t=document.elementFromPoint(\(x),\(y))||document.body;t.dispatchEvent(new PointerEvent('\(type)',{bubbles:true,cancelable:true,composed:true,clientX:\(x),clientY:\(y),pointerId:1,pointerType:'mouse',isPrimary:true,button:\(type == "pointermove" ? -1 : 0),buttons:\(buttons)}));return true")
}
@MainActor func rect(_ text: String) async -> [String: Double] {
  guard let r = await js("const l=[...document.querySelectorAll('.cm-line')].find(e=>e.textContent==='\(text)');if(!l)return null;const b=l.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}") as? [String: Double] else { fail("no line \(text)") }
  return r
}
@MainActor func content() async -> String { (await js("return [...document.querySelectorAll('.cm-line')].map(e=>e.textContent).join('|')") as? String) ?? "" }

Task { @MainActor in
  web.load(URLRequest(url: url))
  for _ in 0..<100 { if (await js("return !!document.querySelector('.cm-content')") as? Bool) == true { break }; await wait(100) }
  _ = await js("const c=document.querySelector('.cm-content');c.focus();document.execCommand('selectAll');document.execCommand('insertText',false,'# 标题\\n\\n第一段。\\n\\n第二段。\\n\\n- 甲\\n  - 乙\\n- 丙\\n\\n第三段。');return true")
  await wait(1500)
  var report: [String: Any] = ["typed": await content()]
  let p2 = await rect("第二段。")
  await mouse("pointermove", p2["x"]! + 40, p2["y"]! + p2["h"]! / 2); await wait(400)
  let grip = await js("const g=document.querySelector('#block-grip');const o=document.querySelector('.block-handles');if(!g||o.hidden)return null;const b=g.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}") as? [String: Double]
  report["hoverShowsGrip"] = grip != nil
  if let g = grip { report["gripAligned"] = abs(g["y"]! - p2["y"]!) < 12 && g["x"]! + g["w"]! <= p2["x"]! }
  let p3 = await rect("第三段。")
  await mouse("pointermove", p3["x"]! + 40, p3["y"]! + p3["h"]! / 2); await wait(300)
  guard let g3 = await js("const g=document.querySelector('#block-grip');const b=g.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}") as? [String: Double] else { fail("no grip for 第三段") }
  let p1 = await rect("第一段。")
  let gx = g3["x"]! + g3["w"]! / 2, gy = g3["y"]! + g3["h"]! / 2
  await mouse("pointerdown", gx, gy, buttons: 1)
  let steps = 14
  for i in 1...steps { let t = Double(i) / Double(steps); await mouse("pointermove", gx + (p1["x"]! + 20 - gx) * t, gy + (p1["y"]! + 2 - gy) * t, buttons: 1); await wait(16) }
  await wait(200)
  report["insertionVisible"] = (await js("return !document.querySelector('.block-insertion').hidden") as? Bool) ?? false
  await mouse("pointerup", p1["x"]! + 20, p1["y"]! + 2); await wait(800)
  report["afterDrag"] = await content()
  // The slash menu opens on an empty line in WebKit too.
  _ = await js("const c=document.querySelector('.cm-content');c.focus();document.execCommand('selectAll');document.execCommand('insertText',false,'第一段。\\n\\n');return true"); await wait(300)
  _ = await js("document.execCommand('insertText',false,'/');return true"); await wait(400)
  report["slashMenu"] = (await js("const m=document.querySelector('[role=listbox]');return !!m&&m.getBoundingClientRect().height>0") as? Bool) ?? false
  // A nested editable table cell must write through to the Markdown document in WKWebView.
  _ = await js("const c=document.querySelector('.cm-content');c.focus();document.execCommand('selectAll');document.execCommand('insertText',false,'前文。\\n\\n| 表头 | 说明 |\\n| --- | --- |\\n| 甲 | 乙 |\\n\\n尾文。');return true")
  await wait(500)
  report["tableInput"] = (await js("const c=document.querySelector('.rendered-table [data-row=\"1\"][data-column=\"0\"]');if(!c)return false;const b=c.getBoundingClientRect();for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){const EventClass=type.startsWith('pointer')?PointerEvent:MouseEvent;c.dispatchEvent(new EventClass(type,{bubbles:true,cancelable:true,clientX:b.x+10,clientY:b.y+10}));}c.focus();const r=document.createRange();r.selectNodeContents(c);r.collapse(false);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);document.execCommand('insertText',false,'WK');return document.activeElement===c&&c.textContent==='甲WK'") as? Bool) ?? false
  await wait(1500)
  report["tableMarkdown"] = (await js("const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'State',args:[]})});return (await r.json()).value.current.content") as? String) ?? ""
  // Use the API to import a real PNG, then resize its widget using PointerEvents in WebKit.
  report["imageFixture"] = (await js("const content=document.querySelector('.cm-content');content.focus();document.execCommand('selectAll');document.execCommand('insertText',false,'图片前文。\\n\\n图片后文。');const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;canvas.getContext('2d').fillRect(0,0,400,200);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const input=document.querySelector('#image-input'),dt=new DataTransfer();dt.items.add(new File([blob],'webkit.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true") as? Bool) ?? false
  await wait(1200)
  report["imageSelected"] = (await js("const img=document.querySelector('.inline-image img');if(!img)return false;const b=img.getBoundingClientRect();for(const type of ['pointerdown','pointerup','click'])img.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:b.x+10,clientY:b.y+10,pointerId:2,pointerType:'mouse',button:0}));return !!document.querySelector('.image-selected .image-resize-handle:not([hidden])')") as? Bool) ?? false
  report["imageResizeBadge"] = (await js("const h=document.querySelector('.image-resize-handle');if(!h||h.hidden)return false;const b=h.getBoundingClientRect(),img=document.querySelector('.inline-image img');window.imageExpectedWidth=Math.round(img.getBoundingClientRect().width-61);h.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:b.x+5,clientY:b.y+5,pointerId:2,pointerType:'mouse',button:0,buttons:1}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:b.x-56,clientY:b.y+5,pointerId:2,pointerType:'mouse',buttons:1}));const badge=document.querySelector('.image-width-badge'),shown=!badge.hidden&&badge.textContent===window.imageExpectedWidth+' px';window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,clientX:b.x-56,clientY:b.y+5,pointerId:2,pointerType:'mouse',button:0}));return shown") as? Bool) ?? false
  await wait(1500)
  report["imageWidthWritten"] = (await js("const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'State',args:[]})});const text=(await r.json()).value.current.content;return text.includes('width=\"'+window.imageExpectedWidth+'\"')") as? Bool) ?? false
  let data = try! JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
  FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
  exit(0)
}
app.run()
