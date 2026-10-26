import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {parser,GFM} from '@lezer/markdown';
import {EditorState} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import * as editing from '../src/editing';
import {Highlight} from '../src/marks';
import {imageAltText} from '../src/images';
import {blockAt,duplicateBlocks,convertBlocks} from '../src/blocks';
import {createBlockField,inlineDecorations,composing,setComposing} from '../src/editor';
import {applySlashItem,filterSlashItems,insertToolbarItem} from '../src/slash';

assert.equal(typeof editing.insertMath,'function','formula toolbar command exists');
const {MathSyntax,mathPlugin,renderMath,mathRenderStats}=await import('../src/math');
// A DOM stand-in lets the real widget prove that lazy mounting never invokes KaTeX during either IME guard.
const {MathWidget}=await import('../src/math-ui'),originalDocument=globalThis.document;
try{
 for(const [viewComposing,stateComposing] of [[true,false],[false,true]]){
  globalThis.document={createElement:()=>({classList:{add(){}},addEventListener(){},isConnected:false})} as unknown as Document;
  const state=EditorState.create({extensions:composing}).update({effects:setComposing.of(stateComposing)}).state;
  const widget=new MathWidget('IMEguard'+Number(viewComposing),true,0,composing),calls=mathRenderStats.calls;
  const dom=widget.toDOM({state,composing:viewComposing} as any);widget.destroy(dom);
  assert.equal(mathRenderStats.calls,calls,'lazy mount must defer KaTeX while composing');
 }
}finally{globalThis.document=originalDocument}
const lezer=parser.configure([GFM,Highlight,MathSyntax]),md=new MarkdownIt({html:true}).use(mathPlugin);
// Literal expectations protect both adapters from agreeing on an incorrect shared rule. Text between inline HTML tags is Markdown, so formulas there render; tags, comments and HTML blocks never do.
const cases:[string,string[],string[]][]=[
 ['$x^2$',['x^2'],[]],['中文$a+b$中文',['a+b'],[]],['a$b',[],[]],['$5 和 $10',[],[]],['$ x $',[],[]],
 ['$x $',[],[]],['$ x$',[],[]],['$x$2',[],[]],['$x$ a',['x'],[]],['$x$中',['x'],[]],
 ['$x$ $y$',['x','y'],[]],['$x$$y$',['x','y'],[]],['$x\ny$',[],[]],['$x',[],[]],['unclosed $',[],[]],
 ['\\$x$',[],[]],['$\\$5$',['\\$5'],[]],['$a\\$b$',['a\\$b'],[]],['$a\\\\$',['a\\\\'],[]],
 ['`$x$`',[],[]],['`` $x$ ``',[],[]],['```js\n$x$\n```',[],[]],['    $x$',[],[]],
 ['[label](https://example.test/$x$)',[],[]],['[$x$](a)',['x'],[]],['<span title="$x$">text</span>',[],[]],
 ['<div>\n$x$\n</div>',[],[]],['<span>$x$</span>',['x'],[]],['<!-- $x$ -->',[],[]],
 ['$$x^2$$',[],['x^2']],['$$\n\\int_0^1 x\\,dx\n$$',[],['\\int_0^1 x\\,dx']],
 ['$$x$$\ncontinued',[],[]],['before $$x$$',[],[]],['$$x',[],[]],['$$x\\$$',[],[]],
 ['```math\nx^2\n```',[],['x^2']],['```math\nx^2',[],['x^2']],['```math extra\nx\n```',[],[]],
 ['~~~math\nx+y\n~~~',[],['x+y']],['> $$x$$',[],['x']],['- $$x$$',[],['x']],
 ['> $$\n> x+y\n> $$',[],['x+y']],['# $x$',['x'],[]],['\\\\$x$',['x'],[]],['$a\t$',[],[]],
 ['`<span>` $x$',['x'],[]],['[link](<span>) $x$',['x'],[]],['[a](url \"<span>\") $x$',['x'],[]],
 ['<span>`</span>` $x$</span>',['x'],[]],['\\<span> $x$',['x'],[]],['$\\text{<span>}$ $x$',['\\text{<span>}','x'],[]],
 ['<span +> $x$',['x'],[]],
 ['![<span>](x) $y$',['y'],[]],['<span>![</span>](x) $y$</span>',['y'],[]],
 ['![<span>] $y$',['y'],[]],['![<span>] $y$\n\n[<span>]: x',['y'],[]],['![<span>][ref] $y$\n\n[ref]: x',['y'],[]],
 ['<span>![bad $y$',['y'],[]],['![<span> $x$](x) $y$',['x','y'],[]],['![x $x$](x) $y$',['x','y'],[]],
 ['```math\na\n\n\\bad\n```',[],['a\n\n\\bad']],['  ```math\n  a\n  b\n  ```',[],['a\nb']],['$$a\n  b$$',[],['a\n  b']],
 ['$$x$$\n\n$$y$$',[],['x','y']],['$$\nx\n\n$$',[],[]],
];
for(const [source,inline,block] of cases){
 const actualInline:string[]=[],actualBlock:string[]=[];
 const tree=lezer.parse(source);tree.iterate({enter:n=>{
  if(n.name==='InlineMath')actualInline.push(source.slice(n.from+1,n.to-1));
  if(n.name==='MathBlock'||n.name==='MathFence'){
   const body=n.node.getChildren('MathText').map(t=>source.slice(t.from,t.to)).join('\n').trim();actualBlock.push(body);
  }
 }});
 assert.deepEqual(actualInline,inline,'Lezer inline '+JSON.stringify(source)+' '+tree.toString());assert.deepEqual(actualBlock,block,'Lezer block '+JSON.stringify(source));
 const flatten=(tokens:ReturnType<typeof md.parse>):ReturnType<typeof md.parse>=>tokens.flatMap(t=>[t,...flatten(t.children||[])]),flat=flatten(md.parse(source,{}));
 assert.deepEqual(flat.filter(t=>t.type==='math_inline').map(t=>t.content),inline,'markdown-it inline '+JSON.stringify(source));
 assert.deepEqual(flat.filter(t=>t.type==='math_block').map(t=>t.content),block,'markdown-it block '+JSON.stringify(source));
}
const alt=md.parse('![图 $x$](a.png)',{})[1].children![0].children!;assert.equal(imageAltText(alt),'图 $x$','math parsing preserves image alt source');
const first=renderMath('x^2',false);assert.match(first.html,/class="katex"/);assert.equal(first.error,undefined);
assert.equal(renderMath('x^2',false),first,'cache reuses the result');
assert.notEqual(renderMath('x^2',true),first);assert.match(renderMath('x^2',true).html,/katex-display/);
const native=renderMath('x^2',false,'mathml');assert.match(native.html,/<math /);assert.ok(!native.html.includes('katex-html'));assert.ok(!native.html.includes('style='));
const bad=renderMath('\\notARealCommand',false);assert.ok(bad.error);assert.equal(bad.html,'\\notARealCommand');
const untrusted=renderMath('\\href{javascript:alert(1)}{x}',false);assert.ok(!untrusted.html.includes('href='),'untrusted commands cannot make links');assert.ok(untrusted.error,'untrusted commands show source and a diagnostic');assert.equal(untrusted.html,'\\href{javascript:alert(1)}{x}');
assert.ok(!renderMath('\\htmlStyle{color:red}{x}',false).html.includes('style="color:red'),'trust stays off');
for(let i=0;i<1100;i++)renderMath('x+'+i,false);
assert.notEqual(renderMath('x^2',false),first,'bounded LRU evicts old results');
const hot=renderMath('hot',false);for(let i=0;i<140;i++){renderMath('y+'+i,false);renderMath('hot',false)}assert.equal(renderMath('hot',false),hot,'cache hits refresh recency');

const create=(doc:string,from=0,to=from,field?:ReturnType<typeof createBlockField>)=>EditorState.create({doc,selection:{anchor:from,head:to},extensions:[history(),markdown({base:markdownLanguage,extensions:[GFM,Highlight,MathSyntax]}),composing,...field?[field]:[]]});
for(const [doc,from,to,expected,anchor,head] of [
 ['前xy后',1,3,'前$xy$后',2,4],['',0,0,'$$\n\n$$',3,3],['前\n\n后',2,2,'前\n$$\n\n$$\n后',5,5],['前后',1,1,'前$$后',2,2],
] as const){
 let state=create(doc,from,to);state=state.update(editing.insertMath(state)).state;assert.equal(state.doc.toString(),expected);assert.equal(state.selection.main.anchor,anchor);assert.equal(state.selection.main.head,head);
 assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),doc,'one undo');
}
for(const raw of ['$$\nx^2\n$$','```math\nx^2\n```']){
 let s=create('前\n\n'+raw+'\n\n后',6),block=blockAt(s,6);assert.ok(block,'math is an editable block');
 assert.equal(s.update(convertBlocks(s,block,'paragraph')).state.doc.toString(),'前\n\nx^2\n\n后','convert formula to body text');
 const inserted=s.update(insertToolbarItem(s,'math')).state;
 assert.equal(inserted.doc.toString(),'前\n\n'+raw+'\n\n$$\n\n$$\n\n后','insert menu places formula below the whole math block');
 s=s.update(duplicateBlocks(s,block)).state;assert.equal(s.doc.toString(),'前\n\n'+raw+'\n\n'+raw+'\n\n后');
 assert.ok(undo({state:s,dispatch:tr=>s=tr.state}));assert.equal(s.doc.toString(),'前\n\n'+raw+'\n\n后');
}
for(const word of ['公式','gongshi','gs','math','formula','latex','katex','tex'])assert.ok(filterSlashItems(word).some(i=>i.id==='math'),word);
let slash=create('/math',5);slash=slash.update(applySlashItem(slash,'math')).state;assert.equal(slash.doc.toString(),'$$\n\n$$');assert.equal(slash.selection.main.head,3);assert.ok(undo({state:slash,dispatch:tr=>slash=tr.state}));assert.equal(slash.doc.toString(),'/math');
let below=create('前\n\n![a](a.png)\n\n后');below=below.update(insertToolbarItem(below,'math',{from:3,to:14})).state;assert.equal(below.doc.toString(),'前\n\n![a](a.png)\n\n$$\n\n$$\n\n后');
const widgets=(state:EditorState,field?:ReturnType<typeof createBlockField>,ranges=[{from:0,to:state.doc.length}])=>{
 const out:{from:number;to:number;widget:any}[]=[];const set=field?state.field(field):inlineDecorations(state,ranges);
 set.between(0,state.doc.length,(from,to,value)=>{if(value.spec.widget?.constructor.name==='MathWidget')out.push({from,to,widget:value.spec.widget})});return out;
};
const doc='前\n\n$x$\n\n$$\ny^2\n$$\n\n```math\nz\n```\n\n`$code$`\n\n尾',field=createBlockField(async()=>'');
let state=create(doc,0,0,field);assert.equal(widgets(state).length,1);assert.equal(widgets(state,field).length,2);
assert.equal(widgets(state,undefined,[{from:0,to:1}]).length,0,'no inline widgets outside viewport');assert.equal(mathRenderStats.calls>0,true);
const calls=mathRenderStats.calls;widgets(state);widgets(state,field);assert.equal(mathRenderStats.calls,calls,'decoration construction never runs KaTeX');
state=state.update({selection:{anchor:4}}).state;assert.equal(widgets(state).length,0,'caret line reveals inline source');
state=state.update({selection:{anchor:doc.indexOf('y^2')}}).state;assert.equal(widgets(state,field).length,1,'caret in any display line reveals whole source');
state=state.update({effects:setComposing.of(true)}).state;const frozen=state.field(field);state=state.update({selection:{anchor:0}}).state;assert.equal(state.field(field),frozen,'IME preserves widgets');
state=state.update({effects:setComposing.of(false)}).state;assert.equal(widgets(state,field).length,2);
// A mapped math index must be identical to a fresh parse after prose and structural edits.
for(const change of [{from:1,insert:'续'},{from:0,to:1,insert:'$new$'},{from:0,to:1,insert:'$$new$$'},{from:doc.indexOf('y^2'),insert:'a+'}]){
 let s=create(doc,0,0,field);ensureSyntaxTree(s,s.doc.length,5000);s=s.update({changes:change,selection:{anchor:change.from+change.insert.length}}).state;
 const freshField=createBlockField(async()=>''),fresh=create(s.doc.toString(),s.selection.main.head,s.selection.main.head,freshField);
 const simple=(s:EditorState,f:typeof field)=>widgets(s,f).map(w=>({from:w.from,to:w.to,source:w.widget.source,widgetFrom:w.widget.from}));
 assert.deepEqual(simple(s,field),simple(fresh,freshField),'prose mapping agrees with rebuild');
}
// Split preview renders the whole document again after every pause. Each of a few hundred different formulas
// must come from the cache the second time instead of being typeset again.
{
 const sources=Array.from({length:300},(_,i)=>`\\int_0^{${i}} x^{2}\\,dx`);
 for(const source of sources)renderMath(source,true);
 const calls=mathRenderStats.calls;
 for(const source of sources)renderMath(source,true);
 assert.equal(mathRenderStats.calls,calls,'a second render of 300 different formulas typesets none of them again');
}
console.log(`PASS: ${cases.length} shared math cases, safe cached KaTeX/MathML/errors, commands/undo/slash and caret/IME/viewport/mapped decorations`);
