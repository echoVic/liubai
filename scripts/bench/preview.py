"""Preview rendering benchmark for one source tree, in Chrome (Python Playwright).

python3 scripts/bench/preview.py <repo-root>   — prints one JSON object per line.
Bundles <repo-root>/src/markdown.ts with esbuild and times renderMarkdown on a
README-style document (headings, lists, tables, code, images) in three variants:
plain Markdown, a README with one raw HTML block at the top (centred logo), and raw
HTML in every section. Documents with any raw HTML go through the sanitizer.
A fourth document, the rich notes of scripts/bench/documents.mjs without details or
diagrams, times math, callouts, footnotes and highlights (text in trees before 0.4).
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
here = Path(__file__).resolve().parent
ENTRY = """
import {renderMarkdown} from '%s';
import {rich} from '%s';
const section=(i:number,html:boolean)=>`## 第 ${i} 节\\n\\n这是一段带有**强调**、\\`代码\\`和[链接](https://example.com/${i})的正文，用来模拟真实文档。\\n\\n- 列表一\\n- 列表二\\n- [ ] 待办\\n\\n| 列一 | 列二 |\\n| --- | --- |\\n| 甲 | 乙 |\\n\\n\\`\\`\\`ts\\nconst value${i} = ${i} // 注释\\n\\`\\`\\`\\n\\n`+(html?`<p align="center"><img src="assets/logo-${i}.png" width="120"></p>\\n\\n`:'')+`![图 ${i}](images/${i}.png)\\n\\n`;
export function run(size:number,iterations:number,html:'none'|'top'|'every'|'rich'){
 let doc='';for(let i=0;html!=='rich'&&doc.length<size;i++)doc+=section(i,html==='every'||(html==='top'&&i===0));doc=html==='rich'?rich(size,{details:false,mermaid:false}):doc.slice(0,size);
 const resolve=()=> 'data:image/png;base64,iVBORw0KGgo=';
 for(let i=0;i<3;i++)renderMarkdown(doc,{resolve,external:'load'});
 let best=Infinity;
 for(let b=0;b<5;b++){const t=performance.now();for(let i=0;i<iterations;i++){const r=renderMarkdown(doc,{resolve,external:'load'});document.body.replaceChildren(r.root)}best=Math.min(best,(performance.now()-t)/iterations)}
 return best;
}
""" % ((root / "src" / "markdown.ts").as_posix(), (here / "documents.mjs").as_posix())

with tempfile.TemporaryDirectory(prefix="liubai-preview-bench-") as folder:
    entry = Path(folder) / "entry.ts"
    entry.write_text(ENTRY, encoding="utf-8")
    bundle = Path(folder) / "bench.js"
    esbuild = Path(__file__).resolve().parents[2] / "node_modules" / ".bin" / "esbuild"
    subprocess.run([str(esbuild), str(entry), "--bundle", "--platform=browser", "--format=iife", "--global-name=Bench", f"--outfile={bundle}", "--log-level=error"], check=True)
    legacy = "dompurify" not in (root / "src" / "markdown.ts").read_text(encoding="utf-8")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
        try:
            page = browser.new_page()
            page.set_content("<!doctype html><html><body></body></html>")
            page.add_script_tag(path=str(bundle))
            for html, scenario in (("none", "render-markdown"), ("top", "render-readme-html-header"), ("every", "render-html-every-section"), ("rich", "render-rich-notes")):
                for size in (20_000, 100_000):
                    ms = page.evaluate(f"() => Bench.run({size}, 10, '{html}')")
                    print(json.dumps({"suite": "preview", "tree": "legacy" if legacy else "modern", "scenario": scenario, "chars": size, "ms": round(ms, 3)}))
        finally:
            browser.close()
