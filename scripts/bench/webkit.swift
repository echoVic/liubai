import AppKit
import WebKit
import Darwin

// Editing in WebKit, the engine of the desktop app: the tree's own app and web server, in an off-screen window.
// Usage: webkit-bench <base-url> <document.md>...   — prints one JSON object per line.
// With PROBE=<file.js>, runs that function body after opening each document instead of the scenarios
// below and prints the object it returns.
// Events are dispatched in the page, since WebKit ignores native events for windows that are not key.
let base = URL(string: CommandLine.arguments[1])!
let documents = CommandLine.arguments.dropFirst(2).map { URL(fileURLWithPath: $0) }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let size = NSSize(width: 1440, height: 900)
let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
// Ordered in far off-screen so WebKit lays it out as visible; the app never activates and the window is never key.
window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
window.orderFrontRegardless()

// Installed in every page before the app's scripts. frame() resolves after the next frame has been rendered:
// start is when its animation-frame callbacks begin, done is the first task after rendering.
let instrumentation = #"""
(()=>{
 const b=window.__bench={gaps:[]};
 b.frame=()=>new Promise(r=>requestAnimationFrame(()=>{const start=performance.now(),c=new MessageChannel();c.port1.onmessage=()=>r({start,done:performance.now()});c.port2.postMessage(0)}));
 // Opening: from navigation start until the first frame that shows document lines has rendered (the task after this
 // frame's rendering), then the longest frame gap over the next 3 s.
 const watch=from=>{let last=from;const tick=()=>{const now=performance.now();b.gaps.push(now-last);last=now;if(now-from<3000)requestAnimationFrame(tick);else b.settled=true};requestAnimationFrame(tick)};
 const look=()=>{const c=document.querySelector('.cm-content');if(c&&c.querySelectorAll('.cm-line').length>5){b.content=performance.now();const m=new MessageChannel();m.port1.onmessage=()=>{b.painted=performance.now();watch(b.painted)};m.port2.postMessage(0);return}requestAnimationFrame(look)};
 requestAnimationFrame(look);
})();
"""#

func fail(_ m: String) -> Never { FileHandle.standardError.write(Data("webkit bench: \(m)\n".utf8)); exit(1) }
var web: WKWebView!
// A crash stops the run; a navigation nobody asked for would invalidate a measurement, so it is reported.
final class Watcher: NSObject, WKNavigationDelegate {
  var expected = "about:blank", finished = false
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finished = true }
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    let target = action.request.url?.absoluteString ?? ""
    if action.targetFrame?.isMainFrame != false && target != expected { FileHandle.standardError.write(Data("webkit bench: unexpected navigation to \(target) (\(action.navigationType.rawValue))\n".utf8)) }
    decisionHandler(.allow)
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { fail("the web process terminated") }
}
let watcher = Watcher()
// Returns once the new page has loaded, so polling never reads the page it replaces.
@MainActor func load(_ url: URL) async {
  watcher.expected = url.absoluteString; watcher.finished = false; web.load(URLRequest(url: url))
  let start = Date()
  while !watcher.finished { if Date().timeIntervalSince(start) > 60 { fail("\(url) did not load") }; try? await Task.sleep(nanoseconds: 20_000_000) }
}
@MainActor func freshView() {
  let config = WKWebViewConfiguration()
  // In memory only: nothing persists between documents, runs or trees.
  config.websiteDataStore = .nonPersistent()
  config.userContentController.addUserScript(WKUserScript(source: instrumentation, injectionTime: .atDocumentStart, forMainFrameOnly: true))
  web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
  web.navigationDelegate = watcher
  window.contentView = web
}
@MainActor func js(_ s: String, _ args: [String: Any] = [:]) async -> Any? {
  do { return try await web.callAsyncJavaScript(s, arguments: args, in: nil, contentWorld: .page) } catch { fail("js error: \(error) in \(s.prefix(80))") }
}
@MainActor func wait(_ ms: UInt64) async { try? await Task.sleep(nanoseconds: ms * 1_000_000) }
@MainActor func until(_ condition: String, timeout: Double = 60) async {
  let start = Date()
  while (await js("return !!(\(condition))") as? Bool) != true {
    if Date().timeIntervalSince(start) > timeout { fail("timed out waiting for \(condition)") }
    await wait(50)
  }
}
// The page's web process, as the system accounts it (what Activity Monitor shows as memory).
@MainActor func footprint() -> Double? {
  guard let pid = web.value(forKey: "_webProcessIdentifier") as? Int32, pid > 0 else { return nil }
  var info = rusage_info_v4()
  let ok = withUnsafeMutablePointer(to: &info) { $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) } }
  return ok == 0 ? (Double(info.ri_phys_footprint) / 1_048_576 * 10).rounded() / 10 : nil
}
// Seeds the current document through the web backend while no page is open, so the app cannot save over it.
// An ephemeral session leaves no cache or cookie store under ~/Library.
let session = URLSession(configuration: .ephemeral)
func api(_ method: String, _ args: [Any]) async -> [String: Any] {
  var request = URLRequest(url: base.appendingPathComponent("api"))
  request.httpMethod = "POST"
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  request.httpBody = try! JSONSerialization.data(withJSONObject: ["method": method, "args": args])
  guard let (data, _) = try? await session.data(for: request),
        let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { fail("\(method) failed") }
  if let error = reply["error"] as? String { fail("\(method): \(error)") }
  return reply
}
func emit(_ row: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!); fflush(stdout)
}
func median(_ v: [Double]) -> Double { let s = v.sorted(); return s.isEmpty ? 0 : s[s.count / 2] }
func p95(_ v: [Double]) -> Double { let s = v.sorted(); return s.isEmpty ? 0 : s[min(s.count - 1, Int((Double(s.count) * 0.95).rounded(.up)) - 1)] }
func ms(_ v: Double) -> Double { (v * 100).rounded() / 100 }

// A prose line near the middle, away from tables and images, scrolled to the centre with the caret in it.
let caret = #"""
const view=document.querySelector('.cm-content').cmTile.root.view,doc=view.state.doc;
let line=doc.lineAt(Math.floor(doc.length/2));while(line.number<doc.lines&&!line.text.startsWith('另一段'))line=doc.line(line.number+1);
const pos=line.from+10;view.focus();view.dispatch({selection:{anchor:pos},effects:view.constructor.scrollIntoView(pos,{y:'center'})});
await new Promise(r=>setTimeout(r,1500));return pos;
"""#
// Typing goes through the browser's editing and CodeMirror's DOM observer, like a keystroke; work counts the
// synchronous part (input, state update, app listeners, style and layout) plus the next frame's callbacks and rendering.
let typing = #"""
const b=window.__bench,view=document.querySelector('.cm-content').cmTile.root.view,sync=[],work=[],latency=[];let misses=0;
for(let i=0;i<count;i++){
 const f=b.frame(),expected=view.state.doc.length+1,t0=performance.now();
 document.execCommand('insertText',false,'字');
 await Promise.resolve();
 if(view.state.doc.length!==expected){misses++;view.observer.flush()}
 void view.contentDOM.offsetHeight;
 const t1=performance.now(),{start,done}=await f;
 sync.push(t1-t0);work.push(t1-t0+done-start);latency.push(done-t0);
 await new Promise(r=>setTimeout(r,gap));
}
// What runs once typing pauses (outline, word count, saving): the longest frame gap over the next 1.5 s.
const gaps=[],from=performance.now();let last=from;
await new Promise(r=>{const tick=()=>{const now=performance.now();gaps.push(now-last);last=now;if(now-from<1500)requestAnimationFrame(tick);else r()};requestAnimationFrame(tick)});
return {sync,work,latency,misses,inserted:view.state.sliceDoc(pos,pos+count)==='字'.repeat(count),pause:Math.max(...gaps)};
"""#
let arrows = #"""
const b=window.__bench,view=document.querySelector('.cm-content').cmTile.root.view,work=[],latency=[];let moved=0;
for(let i=0;i<count;i++){
 const f=b.frame(),head=view.state.selection.main.head,up=i%2===1,t0=performance.now();
 view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:up?'ArrowUp':'ArrowDown',code:up?'ArrowUp':'ArrowDown',keyCode:up?38:40,bubbles:true,cancelable:true}));
 void view.contentDOM.offsetHeight;
 const t1=performance.now(),{start,done}=await f;
 if(view.state.selection.main.head!==head)moved++;
 work.push(t1-t0+done-start);latency.push(done-t0);
 await new Promise(r=>setTimeout(r,gap));
}
return {work,latency,moved};
"""#
// Scrolling: the scroll event (where CodeMirror measures and renders new lines) through the end of the frame.
let scrolling = #"""
// The editor's scrolling ancestor: .editor-scroll since 0.1.5, .editor-pane before.
const b=window.__bench,work=[],latency=[];let scroller=document.querySelector('.cm-content');
while(scroller&&!(scroller.scrollHeight>scroller.clientHeight+10&&/auto|scroll/.test(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;
scroller.scrollTop=0;await new Promise(r=>setTimeout(r,800));
for(let i=0;i<count;i++){
 const f=b.frame(),top=scroller.scrollTop;let at=0;const seen=()=>{if(!at)at=performance.now()};
 document.addEventListener('scroll',seen,{capture:true});
 const t0=performance.now();scroller.scrollTop=top+step;
 const {start,done}=await f;document.removeEventListener('scroll',seen,{capture:true});
 if(scroller.scrollTop===top)break;
 work.push(done-(at||start));latency.push(done-t0);
 await new Promise(r=>setTimeout(r,gap));
}
return {work,latency};
"""#
let idle = #"""
const gaps=[];let last=performance.now();
await new Promise(r=>{const tick=()=>{const now=performance.now();gaps.push(now-last);last=now;if(gaps.length<90)requestAnimationFrame(tick);else r()};requestAnimationFrame(tick)});
return gaps.slice(10).sort((a,b)=>a-b)[40];
"""#

Task { @MainActor in
  for file in documents {
    guard let content = try? String(contentsOf: file, encoding: .utf8) else { fail("cannot read \(file.path)") }
    let name = file.deletingPathExtension().lastPathComponent, parts = name.split(separator: "-")
    let kind = String(parts[0]), chars = Int(parts[1])!, suffix = kind == "rich" ? "-rich" : ""
    let row = { (scenario: String, value: Double) in emit(["suite": "webkit", "scenario": scenario + suffix, "chars": chars, "ms": ms(value)]) }
    freshView()
    await load(URL(string: "about:blank")!)
    // WebKit stops rendering occluded windows, which every window is while the screen is locked or the display sleeps.
    if (await js("return await new Promise(r=>{requestAnimationFrame(()=>r(true));setTimeout(()=>r(false),2000)})") as? Bool) != true { fail("no animation frames; unlock the screen or wake the display and run again") }
    let state = await api("State", [])
    guard let current = (state["value"] as? [String: Any])?["current"] as? [String: Any], let id = current["id"] as? String, let revision = current["revision"] as? Int else { fail("no current document") }
    _ = await api("Update", [["id": id, "revision": revision, "content": content, "position": ["anchor": 0, "head": 0, "scroll": 0, "source": false]]])
    var opens: [Double] = [], hitches: [Double] = []
    for _ in 0..<3 {
      await load(base)
      await until("window.__bench&&window.__bench.painted")
      await until("window.__bench.settled", timeout: 30)
      guard let open = await js("const b=window.__bench;return {painted:b.painted,hitch:Math.max(...b.gaps),length:document.querySelector('.cm-content').cmTile.root.view.state.doc.length}") as? [String: Any] else { fail("no open timing") }
      if (open["length"] as? Int) != content.utf16.count { fail("\(name): the editor holds \(open["length"] ?? "?") characters, expected \(content.utf16.count)") }
      opens.append(open["painted"] as! Double); hitches.append(open["hitch"] as! Double)
    }
    row("open", median(opens)); row("open-hitch", median(hitches))
    if let probe = ProcessInfo.processInfo.environment["PROBE"] {
      guard let script = try? String(contentsOfFile: probe, encoding: .utf8), let result = await js(script) as? [String: Any] else { fail("probe \(probe) failed") }
      emit(["suite": "probe", "document": name, "result": result]); continue
    }
    if chars == 100_000 && kind == "writing", let frame = await js(idle) as? Double { emit(["suite": "webkit", "scenario": "idle-frame-interval", "chars": 0, "ms": ms(frame)]) }
    if let mb = footprint() { row("memory-mb", mb) }
    guard let pos = await js(caret) as? Int else { fail("no caret") }
    guard let t = await js(typing, ["count": 60, "gap": 60, "pos": pos]) as? [String: Any], let work = t["work"] as? [Double], let latency = t["latency"] as? [Double], let sync = t["sync"] as? [Double] else { fail("typing failed") }
    if (t["inserted"] as? Bool) != true { fail("\(name): typed characters did not land at the caret") }
    if let misses = t["misses"] as? Int, misses > 0 { FileHandle.standardError.write(Data("webkit bench: \(name): \(misses) keystrokes were read after the microtask\n".utf8)) }
    row("keystroke-sync", median(sync)); row("keystroke-work", median(work)); row("keystroke-work-p95", p95(work)); row("keystroke-latency", median(latency)); row("keystroke-latency-p95", p95(latency))
    row("pause-hitch", t["pause"] as! Double)
    // Most writing happens at the end of a paragraph.
    guard let end = await js("const view=document.querySelector('.cm-content').cmTile.root.view,pos=view.state.doc.lineAt(view.state.selection.main.head).to;view.dispatch({selection:{anchor:pos}});await new Promise(r=>setTimeout(r,1500));return pos") as? Int,
          let te = await js(typing, ["count": 60, "gap": 60, "pos": end]) as? [String: Any], let endWork = te["work"] as? [Double] else { fail("typing at the end of a paragraph failed") }
    if (te["inserted"] as? Bool) != true { fail("\(name): characters typed at the end of a paragraph did not land there") }
    row("keystroke-end-work", median(endWork)); row("keystroke-end-work-p95", p95(endWork))
    guard let a = await js(arrows, ["count": 60, "gap": 60]) as? [String: Any], let aw = a["work"] as? [Double], let al = a["latency"] as? [Double] else { fail("arrow keys failed") }
    if (a["moved"] as? Int ?? 0) < 50 { fail("\(name): arrow keys moved the caret only \(a["moved"] ?? 0) times") }
    row("arrow-work", median(aw)); row("arrow-work-p95", p95(aw)); row("arrow-latency", median(al))
    guard let s = await js(scrolling, ["count": 40, "step": 600, "gap": 30]) as? [String: Any], let sw = s["work"] as? [Double], let sl = s["latency"] as? [Double], sw.count >= 30 else { fail("\(name): scrolling failed") }
    row("scroll-work", median(sw)); row("scroll-work-p95", p95(sw)); row("scroll-latency", median(sl))
    // Garbage collection runs when it likes, so take the lowest of six samples over the next 6 s.
    var samples: [Double] = []
    for _ in 0..<6 { await wait(1000); if let mb = footprint() { samples.append(mb) } }
    if let low = samples.min() { row("memory-mb-after-editing", low) }
  }
  exit(0)
}
app.run()
