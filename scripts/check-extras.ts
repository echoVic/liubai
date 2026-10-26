import assert from 'node:assert/strict';
import {EditorState,Compartment} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {foldEffect,foldedRanges,ensureSyntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {composing,setComposing,inlineDecorations,createBlockField,EditorView} from '../src/editor';
import {applySlashItem,insertToolbarItem,filterSlashItems} from '../src/slash';

assert.ok(filterSlashItems('zdk').some(i=>i.id==='details'),'details insertion is available');
const {extraRanges,insertFootnote,createDetailsFolding}=await import('../src/extras');
const create=(doc:string,pos=0,extra:any[]=[])=>EditorState.create({doc,selection:{anchor:pos},extensions:[history(),markdown({base:markdownLanguage,extensions:GFM}),composing,...extra]});
for(const [doc,types] of [
 ['> [!NOTE]\n> text',['note']],['> [!tIp]\n> text',['tip']],['- > [!IMPORTANT]\n  > text',['important']],
 ['> [!WARNING]\n> text',['warning']],['> > [!CAUTION]\n> > text',['caution']],
 ['> ordinary\n> [!NOTE]',[]],['> [!OTHER]',[]],['> [!NOTE]oops',[]],['```\n> [!NOTE]\n```',[]],
] as [string,string[]][])assert.deepEqual(extraRanges(create(doc)).callouts.map(c=>c.kind),types,doc);
// Moving the caret keeps the text and the tree: callouts, details and footnotes are reused, not rescanned over the whole document.
{
 const state=create('正文[^1]\n\n> [!NOTE]\n> 提示\n\n[^1]: 脚注',0),found=extraRanges(state);
 assert.equal(found.references.length,1);assert.equal(found.callouts.length,1);
 assert.equal(extraRanges(state.update({selection:{anchor:2}}).state),found,'a caret move reuses the collected ranges');
 assert.notEqual(extraRanges(state.update({changes:{from:0,insert:'新'}}).state),found,'an edit collects again');
}
const decorations=(state:EditorState)=>{const out:any[]=[];inlineDecorations(state,[{from:0,to:state.doc.length}]).between(0,state.doc.length,(from,to,d)=>out.push({from,to,...d.spec}));return out};
let doc='> [!NOTE]\n> body\n\ntail',state=create(doc,doc.length);
assert.equal(decorations(state).filter(d=>d.class==='md-callout markdown-alert-note').length,2);
assert.ok(decorations(state).some(d=>d.widget?.constructor.name==='CalloutWidget'));
assert.ok(!decorations(state.update({selection:{anchor:3}}).state).some(d=>d.widget?.constructor.name==='CalloutWidget'));
assert.ok(!decorations(create('> ordinary\n\ntail',16)).some(d=>d.class?.includes('md-callout')));

for(const [text,count] of [
 ['<details>\n<summary>T</summary>\n\nbody\n\n</details>',1],
 ['<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\nbody\n</details>\n\n</details>',2],
 ['<details>\nbody\n</details>',0],['<details>\n<summary>T</summary>\nbody',0],
 ['- <details>\n  <summary>T</summary>\n\n  body\n\n  </details>',1],
 ['> <details>\n> <summary>T</summary>\n> body\n> </details>',1],
 ['```\n<details>\n<summary>T</summary>\n</details>\n```',0],
 ['<details>\n\n<details>\n<summary>Inner</summary>\nx\n</details>\n</details>',1],
] as const){
 state=create(text);const ranges=extraRanges(state).details;assert.equal(ranges.length,count,text);
 for(const r of ranges){assert.equal(state.doc.lineAt(r.from).text.trim().replace(/^> /,''),'<summary>'+(/Outer/.test(state.doc.lineAt(r.from).text)?'Outer':/Inner/.test(state.doc.lineAt(r.from).text)?'Inner':'T')+'</summary>');assert.ok(r.to>r.from)}
}
doc='<details>\n<summary>T</summary>\n\nbody\n\n</details>\n\ntail';
const mode=new Compartment();state=create(doc,doc.length,[mode.of(createDetailsFolding(composing))]);
const fold=extraRanges(state).details[0];state=state.update({effects:foldEffect.of(fold)}).state;
assert.equal(foldedRanges(state).size,1);assert.equal(state.doc.toString(),doc,'fold is display only');
assert.ok(state.facet(EditorView.decorations).some(set=>{
 if(typeof set==='function')return false;let hidden=false;set.between(0,fold.summary,(from,to,d)=>{if(from===0&&to===fold.summary&&d.spec.widget===undefined)hidden=true});return hidden;
}),'collapsed details shows only its summary, including hiding the opening tag');
assert.equal(foldedRanges(create(doc,0,[createDetailsFolding(composing)])).size,0,'per view');
state=state.update({changes:{from:0,to:9,insert:'<div>'}}).state;assert.equal(foldedRanges(state).size,0,'invalid details unfolds');
state=create(doc,doc.length,[createDetailsFolding(composing)]).update({effects:foldEffect.of(fold)}).state;
state=state.update({changes:{from:0,insert:'before\n\n'}}).state;assert.equal(foldedRanges(state).size,1,'unrelated edits map folds');
state=state.update({selection:{anchor:state.doc.toString().indexOf('body')}}).state;assert.equal(foldedRanges(state).size,0,'jumping into hidden content reveals it');

for(const [text,n] of [['',1],['[^1] [^3]\n\n[^3]: three',2],['[^named] [^01]',1],['`[^1]`\n\n```\n[^2]: code\n```\n\n    [^3]: code',1],['\\[^1] [^2]',1],['[^1]: defined',2]] as const){
 const original=create(text,text.length);state=original.update(insertFootnote(original)).state;
 assert.ok(state.doc.toString().endsWith(`[^${n}]: `),text);assert.equal(state.selection.main.head,state.doc.length);assert.ok(state.selection.main.empty);
 assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),text,'one undo');
}
for(const [text,pos,want] of [['hello',2,'he[^1]llo\n\n[^1]: '],['body\n\n[^1]: old\n',4,'body[^2]\n\n[^1]: old\n\n[^2]: '],['',0,'[^1]\n\n[^1]: ']] as const){state=create(text,pos);state=state.update(insertFootnote(state)).state;assert.equal(state.doc.toString(),want)}
doc='text[^named] and [^missing] `[^named]`\n\n[^named]: definition <b>text</b>\n    continuation\n\ntail';state=create(doc,doc.length);
const notes=extraRanges(state);assert.equal(notes.references.filter(r=>notes.definitions.has(r.label)).length,1);assert.equal(notes.definitions.get('named')?.text,'definition <b>text</b>\ncontinuation');
assert.equal(decorations(state).filter(d=>d.widget?.constructor.name==='FootnoteWidget').length,1);
assert.equal(decorations(state).find(d=>d.widget?.constructor.name==='FootnoteWidget').widget.ignoreEvent(new Event('click')),false,'rendered references pass clicks to the jump handler');
assert.ok(decorations(state).some(d=>d.class==='md-footnote-definition'));
assert.equal(decorations(state.update({selection:{anchor:6}}).state).filter(d=>d.widget?.constructor.name==='FootnoteWidget').length,0);
for(const word of ['jiaozhu','jz','footnote','reference'])assert.ok(filterSlashItems(word).some(i=>i.id==='footnote'));
for(const word of ['zhediekuai','zdk','details','fold','collapse','toggle'])assert.ok(filterSlashItems(word).some(i=>i.id==='details'));
state=create('/zdk',4);state=state.update(applySlashItem(state,'details')).state;
assert.equal(state.doc.toString(),'<details>\n<summary>标题</summary>\n\n内容\n\n</details>');assert.equal(state.sliceDoc(state.selection.main.from,state.selection.main.to),'标题');
assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),'/zdk');
state=create('/jz',3);state=state.update(applySlashItem(state,'footnote')).state;assert.equal(state.doc.toString(),'[^1]\n\n[^1]: ');assert.equal(state.selection.main.head,state.doc.length);
assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),'/jz');
const field=createBlockField(async()=>'');doc='prose\n\n![a](a.png)\n\ntext[^1]\n\n[^1]: note';state=create(doc,0,[field]);
state=state.update({changes:{from:2,insert:'X'},selection:{anchor:3}}).state;
assert.equal(extraRanges(state).definitions.get('1')?.text,'note');assert.equal(decorations(state).filter(d=>d.widget?.constructor.name==='FootnoteWidget').length,1);
assert.equal(decorations(state).find(d=>d.widget?.constructor.name==='FootnoteWidget').widget.ignoreEvent(new Event('click')),false,'rendered references pass clicks to the jump handler');
state=state.update({effects:setComposing.of(true)}).state;assert.ok(state.field(composing));
// Widget-owned table contents must not receive overlapping inline replacements.
doc='lead\n\n| A |\n| --- |\n| [^x] |\n\n[^x]:     note';state=create(doc,0);
assert.equal(extraRanges(state).definitions.get('x')?.textFrom,doc.indexOf('note'));
const tableFrom=doc.indexOf('| A'),tableTo=doc.indexOf('\n\n[^x]');
assert.ok(!decorations(state).some(d=>d.from>=tableFrom&&d.from<tableTo),'table widget owns footnote text');
// Container insertions keep their reference at the user's target and share one history event.
const {editTable}=await import('../src/editing');
doc='| A | B |\n| --- | --- |\n| cell | other |\n\ntail';state=create(doc,0);
const tableEnd=doc.indexOf('\n\ntail');
state=state.update(insertFootnote(state,ref=>editTable(state,{from:0,to:tableEnd},1,0,'cell','cell'+ref))).state;
assert.equal(state.doc.toString(),'| A | B |\n| --- | --- |\n| cell[^1] | other |\n\ntail\n\n[^1]: ');
assert.equal(state.selection.main.head,state.doc.length);assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),doc);
doc='before\n\n![x](x.png)\n\ntail';state=create(doc,0);
state=state.update(insertToolbarItem(state,'footnote',{from:8,to:19})).state;
assert.equal(state.doc.toString(),'before\n\n![x](x.png)\n\n[^1]\n\ntail\n\n[^1]: ');
assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),doc);
// An offscreen marker must not create a replacement above the requested viewport.
doc='> [!NOTE]\n> body\n> second body\n\ntail';state=create(doc,doc.length);
const viewport=state.doc.line(2),visible:any[]=[];
inlineDecorations(state,[{from:viewport.from,to:viewport.to}]).between(0,doc.length,(from,to,d)=>visible.push({from,to,...d.spec}));
assert.ok(visible.every(d=>d.from>=viewport.from&&d.to<=viewport.to),'callout decorations stay in viewport');

// Definitions can contain multiple paragraphs, as markdown-it-footnote exports do.
doc='body[^1]\n\n[^1]: first\n\n    second paragraph\n\ntail';state=create(doc,doc.length);
assert.equal(extraRanges(state).definitions.get('1')?.text,'first\n\nsecond paragraph');
// A keystroke in plain prose only shifts callouts, details and footnotes, so their ranges are mapped instead of
// scanning the whole document again. Whatever an edit does, the result must equal a fresh scan of the new text.
{
 const {richExtensions}=await import('../src/editor');const {Highlight}=await import('../src/marks');const {MathSyntax}=await import('../src/math');const {MermaidSyntax}=await import('../src/mermaid');
 const {rich}=await import('./bench/documents.mjs');
 const extensions=[markdown({base:markdownLanguage,extensions:[GFM,Highlight,MathSyntax,MermaidSyntax]}),composing,richExtensions(async()=>'')];
 const parsed=(s:EditorState)=>{ensureSyntaxTree(s,s.doc.length,60_000);return s.update({}).state};
 const scan=(doc:string)=>extraRanges(parsed(EditorState.create({doc,extensions})));
 // Prose next to every kind of marker, plus front matter, indented continuations and footnote-like text in code.
 const text='---\ntitle: 笔记\n---\n\n'+rich(5000)+'\n\n[^9]: 第一行\n\n    缩进的续行\n\n普通的一段正文，后面还有 `[^code]` 和 [^x y] 这样的文字。\n\n> [!TIP]\n> 提示\n\n收尾的一段。\n';
 let state=parsed(EditorState.create({doc:text,extensions}));
 // A plain keystroke reuses what the previous scan found.
 const before=extraRanges(state),at=text.indexOf('收尾的一段')+2,typed=state.update({changes:{from:at,insert:'字'},selection:{anchor:at+1}}).state;
 assert.equal(extraRanges(typed).labels,before.labels,'a plain keystroke maps the ranges');
 assert.deepEqual(extraRanges(typed),scan(typed.doc.toString()),'mapped ranges equal a fresh scan');
 // Typing after the given text: in a callout's lazy line, a details body or a line after a footnote definition only
 // shifts them. A "..." line closing front matter hides the footnote above it, and an indented line continues the
 // footnote definition above it, so those edits are scanned again.
 for(const [doc,after,insert,mapped] of [
  ['> [!NOTE]\n> 提示\n懒惰的续行\n\n正文',"懒惰的续",'字',true],
  ['<details>\n<summary>标题</summary>\n\n折叠的正文\n\n</details>\n',"折叠的正",'字',true],
  ['写到段落末尾\n\n> [!NOTE]\n> 提示',"写到段落末尾",'字',true],
  ['[^1]: 注\n续写的一行\n\n正文 [^1]\n',"续写的一",'字',true],
  ['---\n正文 [^1]\n..\n\n[^1]: 注\n',".",'.',false],
  ['正文\n[^1]: 注\n    缩进的续行\n\n正文 [^1]\n',"缩进的",'字',false],
 ] as [string,string,string,boolean][]){
  const start=parsed(EditorState.create({doc,extensions})),found=extraRanges(start),at=doc.indexOf(after)+after.length;
  const next=parsed(start.update({changes:{from:at,insert},selection:{anchor:at+insert.length}}).state);
  assert.deepEqual(extraRanges(next),scan(next.doc.toString()),doc);
  assert.equal(extraRanges(next).labels===found.labels,mapped,(mapped?'maps ':'scans again: ')+doc);
 }
 let seed=1;const random=(n:number)=>{seed=(seed*1103515245+12345)%2147483648;return seed%n};
 const inserts=['字','a',' ','[','[^','^',']','!','<','>','`','$','~','\\','|','    ','\n','x]','[^3]','-','#','*','：'];
 for(let i=0;i<400;i++){
  extraRanges(state);
  const from=random(state.doc.length+1),remove=random(4)===0?Math.min(state.doc.length-from,1+random(3)):0,insert=remove?'':inserts[random(inserts.length)];
  const next=parsed(state.update({changes:{from,to:from+remove,insert},selection:{anchor:from+insert.length}}).state);
  assert.deepEqual(extraRanges(next),scan(next.doc.toString()),`edit ${i}: ${JSON.stringify(insert)} at ${from}, removing ${remove}`);
  state=next;
 }
}
// Bound the actual visible-decoration work on a long document containing thousands of references.
const long=('word [^named] **bold** text text text text text text text text text text text\n\n').repeat(4000)+'[^named]: note';
state=create(long,0);ensureSyntaxTree(state,state.doc.length,60_000);state=state.update({}).state;
let best=Infinity;
for(let i=0;i<3;i++){
 state=state.update({changes:{from:0,insert:'x'},selection:{anchor:1}}).state;ensureSyntaxTree(state,state.doc.length,60_000);
 const start=performance.now();inlineDecorations(state,[{from:0,to:6000}]);best=Math.min(best,performance.now()-start);
}
console.log('Long footnote document visible decorations: '+best.toFixed(2)+' ms');
assert.ok(best<15,'footnote-heavy visible decorations stay within the unchanged 300k budget');

console.log('PASS: callouts/viewport, details ranges/fold lifecycle, footnote labels/insertion/caret/undo/cells/images/multiline/performance, templates, prose mapping and mapped extras');
