import AppKit
import WebKit

// Exercise the clipboard serializer in the desktop engine, then use AppKit's real HTML importer.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 1000, height: 800), styleMask: [.titled], backing: .buffered, defer: false)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 800))
window.contentView = web
window.orderFrontRegardless()
func fail(_ message: String) -> Never {
 FileHandle.standardError.write(Data((message + "\n").utf8));exit(1)
}
Task { @MainActor in
 let path = URL(fileURLWithPath: CommandLine.arguments[1])
 web.loadFileURL(path, allowingReadAccessTo: path.deletingLastPathComponent())
 for _ in 0..<100 {
  let ready = try? await web.evaluateJavaScript("typeof RichClipboardChecks !== 'undefined'")
  if ready as? Bool == true {break}
  try? await Task.sleep(nanoseconds: 50_000_000)
 }
 do {
  guard let report = try await web.callAsyncJavaScript("return await RichClipboardChecks.runRichClipboardChecks()", arguments: [:], in: nil, contentWorld: .page) as? [String: String],
        let html = report["html"], let text = report["text"] else {fail("no clipboard result")}
  let attributed = try NSAttributedString(data: Data(html.utf8), options: [.documentType: NSAttributedString.DocumentType.html], documentAttributes: nil)
  guard attributed.string.contains("中文标题"), attributed.string.contains("中文内容"),
        !attributed.string.contains(".node{"), attributed.string.components(separatedBy: "E=mc^2").count == 2 else {fail("AppKit clipboard import corrupted text: \(attributed.string)")}
  var attachments = 0
  attributed.enumerateAttribute(.attachment, in: NSRange(location: 0, length: attributed.length)) {value,_,_ in if value != nil {attachments += 1}}
  guard attachments == 1 else {fail("AppKit lost the diagram attachment")}
  let nativeHTML = try attributed.data(from: NSRange(location: 0, length: attributed.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.html])
  let reverse = try await web.callAsyncJavaScript("return RichClipboardChecks.runNativePasteChecks(html, plain)", arguments: ["html": String(decoding: nativeHTML, as: UTF8.self), "plain": attributed.string], in: nil, contentWorld: .page)
  print(report["result"]!)
  print("PASS: AppKit imports Chinese, one diagram attachment and one formula")
  print(reverse ?? "")
  if CommandLine.arguments.count > 2 {
   try Data(html.utf8).write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
   try Data(text.utf8).write(to: URL(fileURLWithPath: CommandLine.arguments[2] + ".txt"))
  }
  exit(0)
 } catch {fail("rich clipboard: \(error)")}
}
app.run()
