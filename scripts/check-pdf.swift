import AppKit
import WebKit
import PDFKit

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("PDF check: \(message)\n".utf8))
  exit(1)
}

func json(_ value: [String: Any]) {
  do {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  } catch {
    fail("cannot encode JSON: \(error)")
  }
}

func document(_ path: String) -> PDFDocument {
  guard let pdf = PDFDocument(url: URL(fileURLWithPath: path)), pdf.pageCount > 0 else {
    fail("cannot read PDF: \(path)")
  }
  return pdf
}

func inspect(_ path: String) {
  let pdf = document(path)
  let size = pdf.page(at: 0)!.bounds(for: .mediaBox).size
  let texts = (0..<pdf.pageCount).map { pdf.page(at: $0)!.string ?? "" }
  let lines = texts.map { text in
    text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }
  json(["pages": pdf.pageCount, "size": ["width": size.width, "height": size.height],
        "lines": lines, "text": texts.joined(separator: "\n")])
}

func pixels(_ page: CGPDFPage) -> (Int, Int, [UInt8]) {
  let scale: CGFloat = 2
  let size = page.getBoxRect(.mediaBox).size
  let width = Int(ceil(size.width * scale)), height = Int(ceil(size.height * scale))
  guard width > 0, height > 0 else { fail("invalid PDF page size") }
  var bytes = [UInt8](repeating: 255, count: width * height * 4)
  bytes.withUnsafeMutableBytes { buffer in
    guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                                  bitsPerComponent: 8, bytesPerRow: width * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      fail("cannot create PDF rendering context")
    }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: scale, y: scale)
    context.concatenate(page.getDrawingTransform(.mediaBox, rect: CGRect(origin: .zero, size: size), rotate: 0, preserveAspectRatio: true))
    context.drawPDFPage(page)
  }
  return (width, height, bytes)
}

func compare(_ first: String, _ second: String) {
  guard let a = CGPDFDocument(URL(fileURLWithPath: first) as CFURL), a.numberOfPages > 0,
        let b = CGPDFDocument(URL(fileURLWithPath: second) as CFURL), b.numberOfPages > 0 else {
    fail("cannot read PDFs for comparison")
  }
  var maxDiff = a.numberOfPages == b.numberOfPages ? 0 : 255
  for index in 1...min(a.numberOfPages, b.numberOfPages) {
    guard let pageA = a.page(at: index), let pageB = b.page(at: index) else { fail("cannot read page \(index)") }
    let (widthA, heightA, bytesA) = pixels(pageA)
    let (widthB, heightB, bytesB) = pixels(pageB)
    if widthA != widthB || heightA != heightB || pageA.getBoxRect(.mediaBox) != pageB.getBoxRect(.mediaBox) {
      maxDiff = 255
      continue
    }
    for offset in bytesA.indices {
      maxDiff = max(maxDiff, abs(Int(bytesA[offset]) - Int(bytesB[offset])))
    }
  }
  json(["pages": a.numberOfPages, "identical": maxDiff == 0, "maxDiff": maxDiff])
}

final class Printer: NSObject, WKNavigationDelegate {
  let web: WKWebView
  let window: NSWindow
  let output: URL
  var operation: NSPrintOperation?
  var timeout: Timer?
  var printing = false

  init(_ html: URL, _ output: URL) {
    self.output = output
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1120, height: 820), configuration: configuration)
    window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    window.contentView = web
    web.configuration.preferences.setValue(true, forKey: "shouldPrintBackgrounds")
    web.navigationDelegate = self
    timeout = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { _ in
      fail("WebKit did not reach document.title === 'ready' within 20 seconds")
    }
    web.loadFileURL(html, allowingReadAccessTo: html.deletingLastPathComponent())
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { poll() }

  func poll() {
    web.evaluateJavaScript("document.title") { value, error in
      if let error = error { fail("cannot poll document title: \(error)") }
      let title = value as? String ?? ""
      if title == "ready" {
        self.timeout?.invalidate()
        self.printPDF()
      } else if title.hasPrefix("error:") {
        fail("fixture failed: \(title)")
      } else {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.poll() }
      }
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fail("WebKit navigation failed: \(error)")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    fail("WebKit could not load HTML: \(error)")
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { fail("WebKit content process terminated") }

  func printPDF() {
    guard !printing else { return }
    printing = true
    let info = NSPrintInfo.shared.copy() as! NSPrintInfo
    info.jobDisposition = .save
    info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = output
    info.paperSize = NSSize(width: 8.27 * 72, height: 11.69 * 72)
    info.orientation = .portrait
    for margin in [\NSPrintInfo.topMargin, \NSPrintInfo.bottomMargin, \NSPrintInfo.leftMargin, \NSPrintInfo.rightMargin] {
      info[keyPath: margin] = 0.4 * 72
    }
    info.horizontalPagination = .fit
    info.verticalPagination = .automatic
    info.isHorizontallyCentered = false
    info.isVerticallyCentered = false
    let op = web.printOperation(with: info)
    operation = op
    op.showsPrintPanel = false
    op.showsProgressPanel = false
    op.view?.frame = web.bounds
    timeout = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in fail("WebKit PDF printing timed out after 30 seconds") }
    op.runModal(for: window, delegate: self, didRun: #selector(done(_:success:contextInfo:)), contextInfo: nil)
  }

  @objc func done(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
    timeout?.invalidate()
    guard success, let pdf = PDFDocument(url: output), pdf.pageCount > 0 else { fail("WebKit PDF printing failed") }
    exit(0)
  }
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "print" where args.count == 4:
  let html = URL(fileURLWithPath: args[2]).standardizedFileURL
  guard FileManager.default.fileExists(atPath: html.path) else { fail("HTML file does not exist: \(html.path)") }
  let app = NSApplication.shared
  app.setActivationPolicy(.prohibited)
  let printer = Printer(html, URL(fileURLWithPath: args[3]).standardizedFileURL)
  withExtendedLifetime(printer) { app.run() }
case "inspect" where args.count == 3:
  inspect(args[2])
case "compare" where args.count == 4:
  compare(args[2], args[3])
default:
  fail("usage: check-pdf print <page.html> <out.pdf> | inspect <file.pdf> | compare <a.pdf> <b.pdf>")
}
