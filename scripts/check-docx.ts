// Fast OOXML checks without a browser; full delivery DOM/image coverage lives in check-preview.ts.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
const module=await import('../src/docx-export');
assert.equal(typeof module.exportDOCX,'function','Word exporter must exist');
// A minimal, detached DOM stand-in: the production traversal consumes only native node properties.
function el(tag:string,...children:any[]):any{
 const attributes:Record<string,string>={};
 const node:any={nodeType:1,tagName:tag.toUpperCase(),localName:tag,childNodes:children,children:children.filter(n=>n.nodeType===1),get textContent(){return children.map(n=>n.textContent).join('')},getAttribute:(key:string)=>attributes[key]??null,hasAttribute:(key:string)=>key in attributes,setAttribute:(key:string,value:string)=>attributes[key]=value,get id(){return attributes.id},classList:{contains:(value:string)=>(attributes.class||'').split(' ').includes(value)},style:{}};
 for(const child of children)child.parentElement=node;
 const descendants=():any[]=>node.children.flatMap((n:any)=>[n,...n.querySelectorAll('*')]);
 node.closest=(selector:string):any=>{for(let n=node;n;n=n.parentElement)if(selector.startsWith('.')?n.classList.contains(selector.slice(1)):n.localName===selector)return n;return null};
 node.querySelectorAll=(selector:string):any[]=>{
  if(selector===':scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]')return [...node.children,...(node.children[0]?.localName==='p'?node.children[0].children:[])].filter(n=>n.localName==='input');
  if(selector==='.footnotes li[id]')return descendants().filter(n=>n.localName==='li'&&n.id&&n.closest('.footnotes'));
  return descendants().filter(n=>selector.split(',').some(part=>part==='*'||n.localName===part||part.startsWith('annotation[')&&n.localName==='annotation'||part===n.localName+'[id]'&&n.id));
 };
 node.querySelector=(selector:string)=>node.querySelectorAll(selector)[0]||null;
 return node;
}
const attr=(node:any,values:Record<string,string>)=>{for(const [key,value] of Object.entries(values))node.setAttribute(key,value);return node};
const text=(textContent:string)=>({nodeType:3,textContent});
const root=el('article',attr(el('h1',text('中文 English')),{id:'heading'}),el('p',text('正文'),el('strong',text('bold'))),el('p',el('mark',text('marked')),attr(el('a',text('jump')),{href:'#heading'})));
const zip=await JSZip.loadAsync(await module.exportDOCX(root,'文稿','zh-CN'));
const xml=await zip.file('word/document.xml')!.async('string'),styles=await zip.file('word/styles.xml')!.async('string');
assert.match(xml,/<w:pStyle w:val="Heading1"/);assert.match(xml,/中文 English/);assert.match(xml,/<w:b\/>/);assert.match(xml,/<w:hyperlink[^>]*w:anchor="liubai_heading_1"/);assert.match(xml,/<w:highlight w:val="yellow"/);
assert.match(styles,/Times New Roman/);assert.match(styles,/宋体/);assert.match(styles,/黑体/);assert.match(styles,/w:line="360"/);
assert.match(await zip.file('docProps/core.xml')!.async('string'),/<dc:language>zh-CN<\/dc:language>/);
const cases=[el('mfrac',el('mn',text('1')),el('mi',text('x'))),el('msup',el('mi',text('x')),el('mn',text('2'))),el('mtable',el('mtr',el('mtd',el('mn',text('1'))),el('mtd',el('mn',text('2')))))];
for(const [i,formula] of cases.entries()){
 const math=el('math',formula),wrapper=el('span',math);wrapper.classList.contains=(s:string)=>s==='math-inline';wrapper.querySelector=(s:string)=>s==='math'?math:null;
 const out=await JSZip.loadAsync(await module.exportDOCX(el('article',el('p',wrapper)),'math'));
 assert.match(await out.file('word/document.xml')!.async('string'),[ /<m:f>/,/<m:sSup>/,/<m:m>/ ][i]);
}
// Numbering is real OOXML, starts/restarts survive, continuations are not renumbered.
const nested=attr(el('ol',el('li',text('seven')),el('li',text('eight'))),{start:'7'});
const list=attr(el('ol',el('li',el('p',text('three')),el('p',text('continuation')),el('ul',el('li',text('bullet'),nested))),el('li',text('four'))),{start:'3'});
const note=attr(el('li',el('p',text('footnote '),el('strong',text('bold')),attr(el('a',text('back')),{class:'footnote-backref'}))),{id:'fn1'});
const reference=()=>attr(el('sup',attr(el('a',text('1')),{href:'#fn1'})),{class:'footnote-ref'});
const cell=(tag:string,textValue:string,align:string)=>{const n=el(tag,text(textValue));n.style.textAlign=align;return n};
const fixture=el('article',attr(el('h1',text('中文 Word package')),{id:'sample'}),el('p',attr(el('span',el('math',...cases)),{class:'math-inline'})),list,el('ul',el('li',attr(el('input'),{type:'checkbox',checked:''}),text('done'))),el('p',reference(),text(' and '),reference()),attr(el('section',el('ol',note)),{class:'footnotes'}),el('table',el('thead',el('tr',cell('th','Header','center'))),el('tbody',el('tr',cell('td','Cell','right')))),el('details',el('summary',text('Summary')),text('loose content'),el('p',text('Body'))),el('blockquote',el('p',text('quote'))),attr(el('blockquote',attr(el('p',text('Warning')),{class:'markdown-alert-title'}),el('p',text('alert body'))),{class:'markdown-alert'}),el('pre',text('  code\n    next\n\ttab\n')),el('hr'),el('p',attr(el('a',text('external')),{href:'https://example.invalid/test'}),attr(el('a',text('local')),{href:'other.md'})));
const package2=await JSZip.loadAsync(await module.exportDOCX(fixture,'Blocks'));
const docXML=await package2.file('word/document.xml')!.async('string'),numXML=await package2.file('word/numbering.xml')!.async('string'),notesXML=await package2.file('word/footnotes.xml')!.async('string');
assert.equal((docXML.match(/<w:numPr>/g)||[]).length,5);assert.match(numXML,/w:start w:val="3"/);assert.match(numXML,/w:start w:val="7"/);assert.match(docXML,/w:ilvl w:val="2"/);
assert.match(docXML,/☑/);assert.match(docXML,/<w:tblHeader/);assert.match(docXML,/w:jc w:val="center"/);assert.match(docXML,/w:jc w:val="right"/);assert.ok(/<w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t[^>]*>Header/.test(docXML),'table header must be bold');
assert.equal((docXML.match(/<w:footnoteReference /g)||[]).length,2);assert.match(notesXML,/footnote /);assert.doesNotMatch(notesXML,/>back</);assert.doesNotMatch(docXML,/footnote /);
assert.match(docXML,/Summary/);assert.match(docXML,/loose content/);assert.match(docXML,/    next/);assert.match(docXML,/<w:tab\/>/);assert.match(docXML,/<w:pBdr>/);assert.match(docXML,/<w:shd/);assert.ok(/<w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t[^>]*>Warning/.test(docXML),'alert title must be bold');
const relationships=await package2.file('word/_rels/document.xml.rels')!.async('string');assert.match(relationships,/https:\/\/example.invalid\/test/);assert.doesNotMatch(relationships,/other.md/);
const badMath=el('math',el('mphantom',el('mi',text('x'))),el('annotation',text('\\phantom{x}'))),badWrapper=attr(el('span',badMath),{class:'math-inline'});
const fallback=await JSZip.loadAsync(await module.exportDOCX(el('article',el('p',badWrapper)),'fallback'));
assert.match(await fallback.file('word/document.xml')!.async('string'),/\\phantom\{x\}/);
if(process.env.LIUBAI_DOCX_ARTIFACT)await Bun.write(process.env.LIUBAI_DOCX_ARTIFACT,await module.exportDOCX(fixture,'中文 Word package'));
const huge=el('article',...Array.from({length:1000},()=>el('p',text('中'.repeat(100)))));
let ticks=0,maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++},0),start=performance.now();
try{const bytes=await module.exportDOCX(huge,'十万字');assert.ok(bytes.byteLength>0)}finally{clearInterval(timer)}
const ms=performance.now()-start;maxGap=Math.max(maxGap,performance.now()-last);assert.ok(ticks>0,'long export must yield to the event loop');assert.ok(ms<5000,`100,000 characters took ${ms}ms`);
console.log(`PASS: Word package, styles, native math; 100,000 Chinese characters ${ms.toFixed(0)} ms (${ticks} event-loop ticks, max gap ${maxGap.toFixed(0)} ms; DOM stand-in, Bun)`);
