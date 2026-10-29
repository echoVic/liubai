import {renderDelivery} from '../src/delivery';
import {renderMarkdown,sanitizeStats,splitFrontMatter} from '../src/markdown';
import {EditorState} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {frontMatterRange,headings} from '../src/editing';
import {inlineDecorations,blockDecorations} from '../src/editor';
import {highlightCodeBlocks} from '../src/highlight';

function assert(condition: unknown, message: string): asserts condition {
 if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
 if (actual!==expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function deferred<T>(){
 let resolve!: (value:T)=>void;
 const promise=new Promise<T>(done=>{resolve=done});
 return {promise,resolve};
}

export function runFrontMatterChecks():string {
 const doc='---\n# 属性\n\n![图](a.png)\n\n| a |\n| - |\n| b |\n---\n\n# 正文';
 const state=EditorState.create({doc,selection:{anchor:doc.length},extensions:[markdown({base:markdownLanguage,extensions:GFM})]});
 const end=doc.indexOf('\n\n# 正文');
 equal(frontMatterRange(state)?.to,end,'front matter editor range');
 equal(headings(state).map(heading=>heading.text).join(','),'正文','front matter leaked into the outline');
 let lines=0;
 inlineDecorations(state,[{from:0,to:state.doc.length}]).between(0,end,(from,to,value)=>{
  if(from>=end)return;
  equal(from,to,'front matter has an inline mark or widget');
  equal(value.spec.class,'md-front-matter','front matter has Markdown decorations');
  lines++;
 });
 equal(lines,9,'front matter lines are not styled');
 blockDecorations(state,async()=> '').between(0,end,()=>{throw Error('front matter has a block widget')});
 const visible=state.doc.line(4);
 let visibleLines=0;
 inlineDecorations(state,[{from:visible.from,to:visible.to}]).between(0,state.doc.length,(from)=>{
  equal(from,visible.from,'front matter decoration escaped the viewport');
  visibleLines++;
 });
 equal(visibleLines,1,'visible front matter line lacks styling');
 equal(splitFrontMatter('---\nkey: value\n...\n# 正文').lines,3,'ellipsis front matter terminator');
 equal(splitFrontMatter('---\nunclosed').raw,null,'unclosed front matter was hidden');
 equal(splitFrontMatter('text\n---\ntitle: value\n---').raw,null,'non-leading front matter was hidden');
 equal(splitFrontMatter('---\n'+'key\n'.repeat(199)+'---').raw,null,'front matter beyond 200 lines was hidden');
 const boundary='---\n'+'key\n'.repeat(198)+'...';
 equal(splitFrontMatter(boundary).lines,200,'front matter closing line 200 was rejected');
 equal(frontMatterRange(EditorState.create({doc:boundary}))?.to,boundary.length,'editor front matter boundary differs');
 equal(frontMatterRange(EditorState.create({doc:'---\nunclosed'})),null,'editor hid unclosed front matter');
 return 'front matter editor and parser checks passed';
}

export async function runPreviewChecks(): Promise<string> {
 runFrontMatterChecks();
 const markdown=[
  '# 中文标题',
  '',
  '> 引用',
  '>',
  '> - 外层',
  '>   - 内层',
  '',
  '```ts',
  'const value = "<特殊字符>";',
  '```',
  '',
  '| 项目 | 说明 |',
  '| --- | --- |',
  '| 甲 | 乙 |',
  '',
  '- [ ] 待办',
  '- [x] 完成',
  '',
  '![本地图](<图片 目录/示例(一).png>)',
  '',
  '    indented code',
 ].join('\n');
 const original=markdown;
 const localURL='data:image/png;base64,iVBORw0KGgo=';
 const rendered=renderMarkdown(markdown,{
  resolve:destination=>destination.includes('%E5%9B%BE%E7%89%87')?localURL:undefined,
  external:'load',
 });
 equal(markdown,original,'rendering changed the source Markdown');
 equal(rendered.root.tagName,'ARTICLE','renderer root is not semantic');
 equal(rendered.root.querySelector('h1')?.textContent,'中文标题','heading did not render');
 assert(rendered.root.querySelector('blockquote ul ul'),'nested list in quote did not render');
 equal(rendered.root.querySelector('pre')?.textContent,'const value = "<特殊字符>";\n','fenced code changed');
 assert(rendered.root.querySelector('table tbody td'),'table did not render');
 const heading=rendered.root.querySelector('h1')!;
 equal(heading.dataset.line,'0','heading start line');
 equal(heading.dataset.lineEnd,'0','heading end line');
 const quote=rendered.root.querySelector('blockquote')!;
 equal(quote.dataset.line,'2','quote start line');
 equal(quote.dataset.lineEnd,'5','quote end line');
 const fence=rendered.root.querySelector('pre')!;
 equal(fence.dataset.line,'7','fence start line');
 equal(fence.dataset.lineEnd,'9','fence end line');
 const codeBlocks=rendered.root.querySelectorAll('pre');
 equal(codeBlocks[1]?.dataset.line,'20','indented code start line');
 equal(codeBlocks[1]?.dataset.lineEnd,'20','indented code end line');
 const table=rendered.root.querySelector('table')!;
 equal(table.dataset.line,'11','table start line');
 equal(table.dataset.lineEnd,'13','table end line');
 for(const block of rendered.root.querySelectorAll<HTMLElement>('[data-line]')){
  assert(block.hasAttribute('data-line-end'),'mapped visible block lacks an end line');
 }
 assert(!rendered.root.querySelector('li > p[data-line]'),'hidden tight-list paragraph became an anchor');
 const tasks=[...rendered.root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
 equal(tasks.length,2,'task markers were not rendered as checkboxes');
 assert(tasks.every(task=>task.disabled),'task checkbox is editable');
 assert(!tasks[0].checked&&tasks[1].checked,'task checkbox state is wrong');
 equal(rendered.root.querySelector('img')?.getAttribute('src'),localURL,'synchronous image was not installed before return');
 await rendered.ready;

 const continuationSource='- first\n\n  [ ] continuation';
 const continuation=renderMarkdown(continuationSource,{resolve:()=>undefined,external:'load'});
 equal(continuationSource,'- first\n\n  [ ] continuation','continuation rendering changed the source Markdown');
 assert(!continuation.root.querySelector('input[type=checkbox]'),'continuation marker became a task checkbox');
 equal(continuation.root.querySelectorAll('p')[1]?.textContent,'[ ] continuation','continuation marker was removed from plain text');

 const looseTaskSource='- [ ] first\n\n  continuation';
 const looseTask=renderMarkdown(looseTaskSource,{resolve:()=>undefined,external:'load'});
 equal(looseTaskSource,'- [ ] first\n\n  continuation','loose task rendering changed the source Markdown');
 const looseCheckbox=looseTask.root.querySelector<HTMLInputElement>('input[type=checkbox]');
 assert(looseCheckbox?.disabled,'loose task checkbox is missing or editable');
 equal(looseCheckbox.parentElement,looseTask.root.querySelector('li > p'),'loose task checkbox is not inside the first paragraph');
 assert(!looseTask.root.querySelector('li > input[type=checkbox]'),'loose task checkbox was inserted outside its paragraph');

 const codeTaskSource='- `[ ] code`';
 const codeTask=renderMarkdown(codeTaskSource,{resolve:()=>undefined,external:'load'});
 equal(codeTaskSource,'- `[ ] code`','code task rendering changed the source Markdown');
 assert(!codeTask.root.querySelector('input[type=checkbox]'),'code token became a task checkbox');
 equal(codeTask.root.querySelector('code')?.textContent,'[ ] code','code token content changed');

 const semantic=renderMarkdown([
  '# H1',
  '## H2',
  '### H3',
  '#### H4',
  '##### H5',
  '###### H6',
  '',
  'Paragraph with `code` and [link](https://example.invalid).',
  '',
  '> Quote',
  '',
  '```',
  'block',
  '```',
  '',
  '| A |',
  '| - |',
  '| B |',
  '',
  '- bullet',
  '',
  '1. ordered',
  '',
  '- [ ] task',
  '',
  '![image](image.png)',
 ].join('\n'),{resolve:()=>localURL,external:'load'});
 for(let level=1;level<=6;level++)assert(semantic.root.querySelector(`h${level}.md-h${level}`),`heading ${level} semantic class is missing`);
 const semanticSelectors=['p.md-p','blockquote.md-quote','pre.md-pre','code.md-inline-code','table.md-table','ul.md-ul','ol.md-ol','li.md-task','a.md-link','img.md-image'];
 for(const selector of semanticSelectors)assert(semantic.root.querySelector(selector),`${selector} semantic class is missing`);

 const pending=deferred<string|undefined>();
 const stale=renderMarkdown('![旧图](旧图.png)',{resolve:()=>pending.promise,external:'load'});
 const staleImage=stale.root.querySelector('img')!;
 assert(!staleImage.hasAttribute('src'),'unreviewed async image received src');
 stale.dispose();
 pending.resolve('data:image/png;base64,stale');
 await stale.ready;
 assert(!staleImage.hasAttribute('src'),'disposed image callback mutated stale DOM');

 const missing=renderMarkdown('![缺图](缺图.png)',{resolve:async()=>undefined,external:'load'});
 assert(!missing.root.querySelector('img')?.hasAttribute('src'),'missing image started a request');
 await missing.ready;
 assert(missing.root.textContent?.includes('图片缺失：缺图'),'missing image has no explicit notice');

 const failed=renderMarkdown('![坏图](坏图.png)',{resolve:async()=>{throw Error('read failed')},external:'load'});
 await failed.ready;
 assert(failed.root.textContent?.includes('图片无法读取：坏图'),'failed image has no explicit notice');

 const external=renderMarkdown('![外链图](https://example.invalid/image.png)',{resolve:()=>{throw Error('external resolver called')},external:'load'});
 equal(external.root.querySelector('img')?.getAttribute('src'),'https://example.invalid/image.png','preview external image was not allowed');
 await external.ready;

 const delivery=renderDelivery({
  title:'Renderer check',
  content:'# 交付标题\n\n正文含有 `代码` 和 [链接](https://example.invalid/page)。\n\n> 引用\n\n```\n代码块\n```\n\n| 表格 |\n| --- |\n| 内容 |\n\n- 列表\n\n1. 有序列表\n\n- [x] 已完成\n\n![本地图](<图片 目录/示例(一).png>)\n\n![外链图](https://example.invalid/image.png)\n',
  images:{'图片 目录/示例(一).png':localURL},
  missing:[],
  external:1,
 });
 const task=delivery.querySelector<HTMLInputElement>('input[type=checkbox]');
 assert(task, 'task marker was not rendered as a checkbox');
 assert(task.disabled&&task.checked, 'completed task checkbox must be checked and readonly');
 equal(delivery.querySelector('img')?.getAttribute('src'),localURL,'delivery local image was not installed synchronously');
 assert(!delivery.querySelector('img[src^="http"]'),'delivery started an external image request');
 equal(delivery.querySelector<HTMLAnchorElement>('a[href="https://example.invalid/image.png"]')?.textContent,'外链图（联网查看）','delivery external image was not converted to a link');
 assert(delivery.querySelector('a[href="https://example.invalid/image.png"]')?.parentElement?.classList.contains('delivery-image-note'),'delivery image notice styling changed');
 assert(!delivery.querySelector('.markdown-document, .markdown-image-note, .task-list, .task-list-item'),'preview classes leaked into delivery');
 assert(!delivery.querySelector('.md-h1, .md-h2, .md-h3, .md-h4, .md-h5, .md-h6, .md-p, .md-quote, .md-pre, .md-inline-code, .md-table, .md-ul, .md-ol, .md-task, .md-link, .md-image'),'preview semantic classes leaked into delivery');
 equal(delivery.querySelector('h1')?.getAttribute('style'),'font-size:30px;line-height:1.5;margin:24px 0 18px;','delivery heading print styles changed');
 assert(delivery.style.fontFamily.includes('PingFang SC'),'delivery root print styles changed');
 const reader=renderMarkdown([
  '---','title: 周报','tags: [a]','---','',
  '<p align="center"><img src="logo.png" width="120" onerror="window.__xss=2"></p>','',
  '<script>window.__xss=1</script>','',
  '<a href="javascript:alert(1)">坏链接</a> <span style="position:fixed">样式</span> <kbd>⌘</kbd>','',
  '访问 https://github.com/egoist/mygo 或查看 README.md。','',
  '脚注引用[^1]。','',
  '> [!NOTE]','> 这是一条说明。','',
  '[^1]: 脚注内容',
 ].join('\n'),{resolve:destination=>destination==='logo.png'?localURL:undefined,external:'load'});
 const meta=reader.root.querySelector<HTMLElement>('details.md-front-matter');
 assert(meta?.textContent?.includes('title: 周报'),'front matter is not shown as document properties');
 equal(meta.dataset.line,'0','front matter start line');
 const logo=reader.root.querySelector<HTMLImageElement>('p[align="center"] img');
 equal(logo?.getAttribute('src'),localURL,'HTML image did not go through the image resolver');
 equal(logo?.getAttribute('width'),'120','HTML image width was dropped');
 assert(!logo?.hasAttribute('onerror'),'event handler survived sanitizing');
 assert(!reader.root.querySelector('script')&&!(window as any).__xss,'script survived sanitizing');
 assert(!reader.root.querySelector('a[href^="javascript"]'),'javascript link survived sanitizing');
 assert(!reader.root.querySelector('[style]'),'style attribute survived sanitizing');
 assert(reader.root.querySelector('kbd'),'kbd was dropped');
 const www=renderMarkdown('www.example.com/path README.md user@example.com',{resolve:()=>undefined,external:'load'});
 assert(www.root.querySelector('a[href="http://www.example.com/path"]'),'www URL was not linked');
 equal(www.root.querySelectorAll('a').length,1,'bare filename or email was linked');
 const bare=reader.root.querySelector<HTMLAnchorElement>('a[href="https://github.com/egoist/mygo"]');
 assert(bare,'bare URL was not linked');
 equal(bare.closest<HTMLElement>('p')?.dataset.line,'11','line mapping ignores the front matter offset');
 assert(!reader.root.querySelector('a[href*="README.md"]'),'a file name was linked as a domain');
 assert(reader.root.querySelector('sup a[href="#fn1"]')&&reader.root.querySelector('#fn1'),'footnote did not render');
 const alertBlock=reader.root.querySelector('blockquote.markdown-alert.markdown-alert-note');
 equal(alertBlock?.querySelector('.markdown-alert-title')?.textContent,'说明','GitHub alert title missing');
 assert(!alertBlock?.textContent?.includes('[!NOTE]'),'alert marker left in the text');
 await reader.ready;
 // Draft images use the internal liubai-asset: scheme; sanitizing must keep the source so it can resolve.
 const draftImage=renderMarkdown('![草稿图](liubai-asset:abc.png)',{resolve:destination=>destination==='liubai-asset:abc.png'?localURL:undefined,external:'load'});
 equal(draftImage.root.querySelector('img')?.getAttribute('src'),localURL,'draft image source was stripped by the sanitizer');
 const exported=renderDelivery({title:'t',content:'---\ntitle: 周报\n---\n\n# 正文',images:{},missing:[],external:0});
 assert(!exported.textContent?.includes('title: 周报'),'front matter leaked into delivery');
 equal(exported.querySelector('h1')?.id,'正文','delivery heading has no anchor id');

 const noMeta={resolve:()=>undefined,external:'load' as const};
 const mapped=renderMarkdown('---\ntitle: value\n---\n\n```ts\ncode\n```\n\n    indented',noMeta);
 const mappedCode=mapped.root.querySelectorAll('pre[data-line]');
 equal(mappedCode[0]?.getAttribute('data-line'),'4','front matter fence offset');
 equal(mappedCode[1]?.getAttribute('data-line'),'8','front matter indented code offset');
 const hardened=renderMarkdown('<input type=text><input type=checkbox checked><span class="foreign md-ok language-ts footnote-ref markdown-alert-tip" data-extra="x">text</span>',noMeta);
 assert(!hardened.root.querySelector('input:not([type=checkbox])'),'non-checkbox input survived');
 assert(hardened.root.querySelector<HTMLInputElement>('input')?.disabled,'HTML checkbox is editable');
 const span=hardened.root.querySelector('span');
 equal(span?.className,'md-ok language-ts footnote-ref markdown-alert-tip','class filtering failed');
 assert(!span?.hasAttribute('data-extra'),'unlisted data attribute survived');
 for(const [type,title] of [['TIP','提示'],['IMPORTANT','重要'],['WARNING','警告'],['CAUTION','注意']]){
  const alert=renderMarkdown('> [!'+type.toLowerCase()+']\n> **正文**',noMeta);
  equal(alert.root.querySelector('.markdown-alert-title')?.textContent,title,'alert title '+type);
  equal(alert.root.querySelector('strong')?.textContent,'正文','alert inline content changed');
 }
 const htmlPending=deferred<string|undefined>();
 const inertHTML=renderMarkdown('<img src="local.png">',{resolve:()=>htmlPending.promise,external:'load'});
 assert(!inertHTML.root.querySelector('img')?.hasAttribute('src'),'HTML image started a request before resolution');
 htmlPending.resolve(localURL);
 await inertHTML.ready;
 equal(inertHTML.root.querySelector('img')?.getAttribute('src'),localURL,'async HTML image resolver was not used');
 const normalized=renderMarkdown('<img src="图 片.png">',{resolve:source=>source==='%E5%9B%BE%20%E7%89%87.png'?localURL:undefined,external:'load'});
 equal(normalized.root.querySelector('img')?.getAttribute('src'),localURL,'HTML image source was not normalized');
 const deliveryAnchors=renderDelivery({title:'t',content:'# 同一标题\n\n# 同一标题',images:{},missing:[],external:0});
 equal(deliveryAnchors.querySelectorAll('h1')[1]?.id,'同一标题-1','duplicate delivery heading slug');
 const code=renderMarkdown('```ts\nconst a: number = 1 // note\n```',{resolve:()=>undefined,external:'load'});
 await highlightCodeBlocks(code.root,()=>true);
 assert(code.root.querySelector('pre code .tok-keyword'),'code block was not highlighted');
 equal(code.root.querySelector('pre code')?.textContent,'const a: number = 1 // note\n','highlighting changed the code text');
 const staleCode=renderMarkdown('```ts\nconst b = 2\n```',{resolve:()=>undefined,external:'load'});
 await highlightCodeBlocks(staleCode.root,()=>false);
 assert(!staleCode.root.querySelector('.tok-keyword'),'stale render was highlighted');
 const pendingCode=renderMarkdown('```ts\nconst c = 3\n```',noMeta);
 let active=true;
 const highlighting=highlightCodeBlocks(pendingCode.root,()=>active);
 active=false;
 await highlighting;
 assert(!pendingCode.root.querySelector('.tok-keyword'),'render invalidated during language loading was highlighted');
 const plainCode=renderMarkdown('```liubai-unknown-language\nunchanged\n```\n\n```\nconst plain = 1\n```',noMeta);
 const plainHTML=plainCode.root.innerHTML;
 await highlightCodeBlocks(plainCode.root,()=>true);
 equal(plainCode.root.innerHTML,plainHTML,'unknown or unlabelled code was changed');
 const oversizedCode=renderMarkdown('```ts\n//'+'x'.repeat(99999)+'\n```',noMeta);
 const oversizedHTML=oversizedCode.root.innerHTML;
 await highlightCodeBlocks(oversizedCode.root,()=>true);
 equal(oversizedCode.root.innerHTML,oversizedHTML,'oversized code was changed');
 const footnoteDelivery=renderDelivery({title:'t',content:'正文[^1]\n\n---\n\n[^1]: 注释',images:{},missing:[],external:0});
 equal(footnoteDelivery.querySelectorAll('hr').length,2,'delivery thematic break and footnote separator');
 assert([...footnoteDelivery.querySelectorAll('hr')].every(hr=>/border-top:1px solid/.test(hr.getAttribute('style')||'')),'delivery separator keeps the browser default style');
 assert(!/border/.test(footnoteDelivery.querySelector('section.footnotes')?.getAttribute('style')||''),'delivery footnotes have a second separator');
 const deliveryCode=renderDelivery({title:'t',content:'```ts\nconst a = 1\n```',images:{},missing:[],external:0});
 assert(!deliveryCode.querySelector('code span'),'delivery code was highlighted');
 const plainSanitizeCalls=sanitizeStats.calls;
 const longMarkdown=renderMarkdown([
  '---','title: <img src=x onerror=alert(1)>','---','',
  '# Long Markdown','',
  'Plain text with **emphasis**, `code` and a footnote[^long].\n\n'.repeat(2000),
  '- First item','- Second item','',
  '| Column | Value |','| --- | --- |','| A | B |','',
  '- [ ] Pending','- [x] Done','',
  '> [!NOTE]','> Alert body.','',
  '![Local image](long.png)','',
  '[^long]: Footnote content.',
 ].join('\n'),{resolve:destination=>destination==='long.png'?localURL:undefined,external:'load'});
 equal(sanitizeStats.calls,plainSanitizeCalls,'plain Markdown unnecessarily invoked the sanitizer');
 const longTasks=[...longMarkdown.root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
 equal(longTasks.length,2,'plain Markdown task checkboxes are missing');
 assert(longTasks.every(task=>task.disabled),'plain Markdown task checkbox is editable');
 equal(longMarkdown.root.querySelector('.markdown-alert-title')?.textContent,'说明','plain Markdown alert title is missing');
 equal(longMarkdown.root.querySelector('img')?.getAttribute('src'),localURL,'plain Markdown image was not resolved');
 assert(!longMarkdown.root.querySelector('details img'),'front matter HTML was not escaped');
 await longMarkdown.ready;

 const htmlSanitizeCalls=sanitizeStats.calls;
 const authorHTML=renderMarkdown('<kbd>⌘</kbd>\n\n<img src=x onerror=alert(1)>',{resolve:()=>localURL,external:'load'});
 assert(sanitizeStats.calls>htmlSanitizeCalls,'author HTML did not invoke the sanitizer');
 equal(authorHTML.root.querySelector('kbd')?.textContent,'⌘','author HTML kbd was dropped');
 assert(authorHTML.root.querySelector('img'),'author HTML image was dropped');
 assert(!authorHTML.root.querySelector('[onerror]'),'author HTML event handler survived sanitizing');
 await authorHTML.ready;
 const alignedTable='| 左 | 中 | 右 |\n| :-- | :-: | --: |\n| a | b | c |';
 for(const [label,source] of [['plain Markdown',alignedTable],['author HTML',alignedTable+'\n\n<kbd>x</kbd>\n\n<table><tr><td style="color:red;text-align:right">d</td></tr></table>']]){
  const aligned=renderMarkdown(source,{resolve:()=>undefined,external:'load'});
  equal([...aligned.root.querySelectorAll<HTMLElement>('table.md-table td')].map(cell=>cell.style.textAlign).join(),'left,center,right',`${label} table alignment was dropped`);
  assert(![...aligned.root.querySelectorAll('[style]')].some(element=>!/^T[HD]$/.test(element.tagName)||/color/.test(element.getAttribute('style')||'')),`${label} kept an unsafe style`);
 }
 const plainCalls=sanitizeStats.calls;
 const unsafeMarkdown=renderMarkdown('[脚本](javascript:alert(1)) [数据](data:text/html;base64,PGI+eDwvYj4=) ![<img src=x onerror=alert(1)>](a.png)\n\n`<script>alert(1)</script>`',{resolve:()=>undefined,external:'load'});
 equal(sanitizeStats.calls,plainCalls,'escaped Markdown invoked the sanitizer');
 assert(!unsafeMarkdown.root.querySelector('a[href^="javascript"], a[href^="data"], script, [onerror]'),'plain Markdown produced an unsafe element');
 equal(unsafeMarkdown.root.querySelector('code')?.textContent,'<script>alert(1)</script>','inline code was not escaped');
 await unsafeMarkdown.ready;
 const inlineMarks='==**亮**== <u>线</u> <sup>上</sup> <sub>下</sub> `==literal==`';
 const marksView=renderMarkdown(inlineMarks,{resolve:()=>undefined,external:'load'});
 const marksExport=renderDelivery({title:'marks',content:inlineMarks,images:{},missing:[],external:0});
 for(const root of [marksView.root,marksExport]){
  for(const tag of ['mark','u','sup','sub'])equal(root.querySelectorAll(tag).length,1,'inline '+tag+' is rendered');
  equal(root.querySelector('code')?.textContent,'==literal==','code remains literal');
  equal(root.querySelector('mark strong')?.textContent,'亮','highlight retains nested emphasis');
 }
 assert(marksExport.querySelector('mark')!.getAttribute('style')!.includes('background'),'export highlight style');
 await marksView.ready;
 // Resized and aligned images are raw HTML; their app asset source must survive sanitizing in the reader and exports.
 const sized='<p align="center"><img src="liubai-asset:abc.png" alt="图" width="300"></p>';
 const pixel='data:image/png;base64,iVBORw0KGgo=';
 const sizedView=renderMarkdown(sized,{resolve:source=>source==='liubai-asset:abc.png'?pixel:undefined,external:'load'});
 const sizedImage=sizedView.root.querySelector('img')!;
 equal(sizedImage?.getAttribute('src'),pixel,'asset source is kept and resolved');
 equal(sizedImage.getAttribute('width'),'300','image width survives');equal(sizedImage.closest('p')?.getAttribute('align'),'center','alignment survives');
 assert(!renderMarkdown('<img src="javascript:alert(1)">',{resolve:()=>undefined,external:'load'}).root.querySelector('[data-image-source^="javascript"]'),'scripts stay out of image sources');
 await sizedView.ready;
 // KaTeX HTML must be installed after sanitizing: author HTML never gains its style/class privileges.
 const formulaSource='$x^2$\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```math\ny+1\n```\n\n$\\frac{$\n\n$5 和 $10\n\n<span style="position:fixed" class="katex forged">author</span><script>window.__mathXSS=1</script>';
 const math=renderMarkdown(formulaSource,{resolve:()=>undefined,external:'load'}).root;
 equal(math.querySelectorAll('.katex').length,3,'reader formulas lost to sanitizer');
 assert(math.querySelector('.katex [style]'),'trusted KaTeX layout styles are missing');
 equal(math.querySelector('.math-error')?.textContent,'\\frac{','invalid math source fallback');
 assert(math.querySelector('.math-error')?.getAttribute('title')?.includes('KaTeX'),'math error lacks diagnostic');
 assert(math.textContent?.includes('$5 和 $10'),'currency became math');
 const author=[...math.querySelectorAll('span')].find(el=>el.textContent==='author');
 assert(author&&!author.hasAttribute('style')&&!author.classList.contains('katex'),'author HTML gained KaTeX privileges');
 assert(!math.querySelector('script')&&!(window as any).__mathXSS,'math placeholders bypassed author sanitizing');
 equal(math.querySelector<HTMLElement>('.math-display')?.dataset.line,'2','display formula line map');
 for(const output of ['mathml','htmlAndMathml'] as const){
  const result=renderDelivery({title:'math',content:formulaSource,images:{},missing:[],external:0},output);
  equal(result.querySelectorAll('math').length,3,'delivery math missing');
  if(output==='mathml'){assert(!result.querySelector('.katex-html'),'portable delivery depends on KaTeX CSS');assert(!result.innerHTML.includes('KaTeX_Main'),'portable delivery depends on fonts')}
  else assert(result.querySelector('.katex-html'),'PDF must use the same HTML as the reader');
 }
 const wikiSource='中😀 [[目标😀]] [[<img src=x onerror=alert(1)>]]\n\n<span title="[[属性]]">[[正文]]</span><script>window.__wikiXSS=1</script>\n\n`[[代码]]` $[[公式]]$';
 const wiki=renderMarkdown(wikiSource,{resolve:()=>undefined,external:'load',wikiLinks:'interactive'});
 equal(wiki.root.querySelectorAll('a.md-wiki-link').length,3,'interactive Wiki links survive author HTML sanitizing');
 assert(!wiki.root.querySelector('script,img,[onerror]'),'Wiki title became executable markup');
 assert(wiki.root.querySelector('a')?.getAttribute('href')?.startsWith('liubai-wiki:'),'Wiki protocol missing');
 equal(wiki.root.querySelector('code')?.textContent,'[[代码]]','Wiki in code remains literal');
 const wikiExport=renderDelivery({title:'wiki',content:wikiSource,images:{},missing:[],external:0});
 assert(wikiExport.textContent?.includes('[[目标😀]]'),'export changed raw reference');
 assert(!wikiExport.outerHTML.includes('liubai-wiki:'),'export leaked generated internal Wiki URL');
 const forged=renderDelivery({title:'wiki',content:'<a href="liubai-wiki:目标">raw link</a>\n\n[Markdown link](liubai-wiki:目标)',images:{},missing:[],external:0});
 assert(!forged.outerHTML.includes('liubai-wiki:'),'export leaked author-supplied internal Wiki URL');
 return 'shared renderer and delivery DOM checks passed';
}

export async function runDOCXChecks():Promise<string>{
 const {exportDOCX}=await import('../src/docx-export'),{default:JSZip}=await import('jszip');
 const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=1000;canvas.getContext('2d')!.fillRect(0,0,2000,1000);
 const png=canvas.toDataURL('image/png'),svg='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="green"/></svg>');
 const content=[
  '---','title: 隐藏属性','---','',...Array.from({length:6},(_,i)=>'#'.repeat(i+1)+' 标题 '+(i+1)+' Heading'),'',
  '**加粗 bold** *斜体 italic* <u>下划线</u> ~~删除~~ ==高亮== `inline code` <sup>上标</sup> <sub>下标</sub>  ','换行 [远端](https://example.invalid/word) [本地](notes.md#h) [章节](#标题-1-heading)。','',
  '跨文稿 [[目标😀]] 与 <a href="liubai-wiki:目标">作者内部链接</a>。','',
  '3. 第三项','   - 嵌套 bullet','','     7. 七','     8. 八','4. 第四项','','- [ ] 待办','- [x] 完成','',
  '> 引用第一段','>','> 引用第二段','','> [!WARNING]','> 警告正文','','```ts','  const x = 1;','    next();','```','','    indented code','','---','',
  '<details><summary>更多 Details</summary><p>折叠正文</p></details>','',
  '| 左列 | 中列 | 右列 |','| :--- | :---: | ---: |','| 甲 | English | 乙 |','',
  '![宽图](wide.png)','','<p align="center"><img src="wide.png" width="120"></p>','','![矢量图](vector.svg)','','![缺图](missing.png)','',
  '$\\frac{1}{x}$ 与 $x^2$、$x_i$、$x_i^2$、$\\sqrt{x}$、$\\sqrt[3]{x}$、$\\hat{x}$。','',
  '$$\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$$','',
  '$$\\sum_{i=1}^n i$$','',
  '$\\phantom{x}$','',
  '```mermaid','flowchart LR','  A[开始] --> B[结束]','```','',
  '脚注位置[^one] 和重复[^one]。','',
  '[^one]: 脚注 **内容** English。','',
 ].join('\n');
 const root=renderDelivery({title:'Word 中文',content,images:{'wide.png':png,'vector.svg':svg},missing:['missing.png'],external:0});
 await (await import('../src/delivery')).waitImages(root);
 const bytes=await exportDOCX(root,'Word 中文','zh-CN'),zip=await JSZip.loadAsync(bytes);
 const read=async(path:string)=>{const f=zip.file(path);assert(f,'missing '+path);return f.async('string')};
 const xml=await read('word/document.xml'),styles=await read('word/styles.xml'),numbering=await read('word/numbering.xml'),notes=await read('word/footnotes.xml'),rels=await read('word/_rels/document.xml.rels');
 const dom=(xml:string)=>new DOMParser().parseFromString(xml,'application/xml');
 const documentXML=dom(xml),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',mathNS='http://schemas.openxmlformats.org/officeDocument/2006/math';
 const all=(name:string)=>[...documentXML.getElementsByTagNameNS(ns,name)];
 for(let level=1;level<=6;level++)assert(xml.includes('w:val="Heading'+level+'"'),'native heading '+level);
 for(const expected of ['Times New Roman','宋体','黑体','w:sz w:val="22"','w:line="360"','w:eastAsia="zh-CN"'])assert(styles.includes(expected),'Word style '+expected);
 for(const tag of ['b','i','u','strike','highlight'])assert(all(tag).length,'inline '+tag);
 for(const value of ['superscript','subscript'])assert(xml.includes('w:val="'+value+'"'),'vertical '+value);
 assert(xml.includes('☐')&&xml.includes('☑'),'task glyphs');assert(xml.includes('  const x = 1;')&&xml.includes('    next();'),'code whitespace');assert(xml.includes('indented code'),'indented code');
 assert(all('br').length,'hard break');assert(all('pBdr').length>=3,'quotes/alerts/rules borders');assert(all('shd').length,'shading');
 assert(xml.includes('警告')&&xml.includes('警告正文')&&xml.includes('更多 Details')&&xml.includes('折叠正文'),'alerts and details');assert(!xml.includes('隐藏属性'),'front matter hidden');
 assert(numbering.includes('w:start w:val="3"')&&numbering.includes('w:start w:val="7"'),'ordered starts');assert(numbering.includes('w:ilvl="2"')&&xml.includes('w:ilvl w:val="2"'),'nested list levels');
 assert(all('tblHeader').filter(el=>el.getAttributeNS(ns,'val')!=='off').length===1,'repeated header');assert(all('tr')[0].getElementsByTagNameNS(ns,'b').length===3,'bold table header');for(const value of ['left','center','right'])assert(xml.includes('w:jc w:val="'+value+'"'),'table alignment '+value);
 assert(rels.includes('https://example.invalid/word')&&!rels.includes('notes.md'),'external hyperlink only');assert(xml.includes('本地'),'local link text');assert(all('hyperlink').some(el=>el.hasAttributeNS(ns,'anchor')),'internal heading link');
 assert(xml.includes('[[目标😀]]')&&!xml.includes('liubai-wiki:')&&!rels.includes('liubai-wiki:'),'Word retains raw Wiki text without an internal relationship');
 for(const tag of ['f','sSup','sSub','sSubSup','rad','acc','m','limLow','limUpp'])assert(documentXML.getElementsByTagNameNS(mathNS,tag).length,'OMML '+tag);
 assert(xml.includes('\\phantom{x}')&&xml.includes('Menlo'),'unsupported math uses TeX');assert(xml.includes('图片缺失'),'missing image note');
 assert(notes.includes('脚注')&&notes.includes('English')&&notes.includes('<w:b/>'),'footnote definition formatting');equal(all('footnoteReference').length,2,'reference positions');assert(!xml.includes('脚注 内容 English'),'definitions omitted from body');
 const extentNS='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
 const extents=[...documentXML.getElementsByTagNameNS(extentNS,'extent')];equal(extents.length,4,'embedded images and Mermaid');
 const maxWidth=(11906-2880)*635;assert(extents.every(e=>Number(e.getAttribute('cx'))<=maxWidth),'images exceed text width');assert(extents.some(e=>Number(e.getAttribute('cx'))===120*9525),'explicit width at 96dpi');
 const media=Object.keys(zip.files).filter(path=>/^word\/media\/.+\.png$/.test(path));assert(media.length>=3,'PNG raster images');
 for(const path of media){const data=await zip.file(path)!.async('uint8array');equal([...data.slice(0,8)].join(','),'137,80,78,71,13,10,26,10','PNG magic '+path)}
 const huge=renderDelivery({title:'长文',content:('中'.repeat(100)+'\n\n').repeat(1000),images:{},missing:[],external:0});
 let ticks=0,maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++},0),start=performance.now();await exportDOCX(huge,'十万字');const elapsed=performance.now()-start;maxGap=Math.max(maxGap,performance.now()-last);clearInterval(timer);assert(ticks>0,'export yields');assert(elapsed<5000,'100k conversion exceeds five seconds: '+elapsed);
 return `Word DOM/OOXML checks passed; 100,000 Chinese characters ${elapsed.toFixed(0)} ms (${ticks} event-loop ticks, max gap ${maxGap.toFixed(0)} ms)`;
}
