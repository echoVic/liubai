import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {EditorState} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {createBlockField,inlineDecorations,composing,setComposing} from '../src/editor';
import {blockAt,convertBlocks} from '../src/blocks';
import {applySlashItem,filterSlashItems,insertToolbarItem} from '../src/slash';

assert.ok(filterSlashItems('mermaid').some(i=>i.id==='mermaid'),'diagram insertion is available');
const {MermaidSyntax,mermaidSource,createMermaidRenderer,MermaidMount}=await import('../src/mermaid');
const {mermaidRanges}=await import('../src/images');
const create=(doc:string,pos=0,field=createBlockField(async()=>''))=>EditorState.create({doc,selection:{anchor:pos},extensions:[history(),markdown({base:markdownLanguage,extensions:[GFM,MermaidSyntax]}),composing,field]});
const cases:[string,string[]][]=[
 ['```mermaid\nflowchart LR\n A-->B\n```',['flowchart LR\n A-->B']],
 ['~~~mermaid\nflowchart LR\n A-->B\n~~~',['flowchart LR\n A-->B']],
 ['  ```mermaid\n  flowchart LR\n   A-->B\n  ```',['flowchart LR\n A-->B']],
 ['- ```mermaid\n  flowchart LR\n   A-->B\n  ```',['flowchart LR\n A-->B']],
 ['> ```mermaid\n> flowchart LR\n>  A-->B\n> ```',['flowchart LR\n A-->B']],
 ['> - ~~~mermaid\n>   flowchart LR\n>    A-->B\n>   ~~~',['flowchart LR\n A-->B']],
 ['```mermaid\nflowchart LR',['flowchart LR']],['```mermaid\n```',['']],
 ['````js\n```mermaid\nflowchart LR\n```\n````',[]],['    ```mermaid\n    A-->B\n    ```',[]],
 ['`mermaid`',[]],['```mermaid extra\nA-->B\n```',[]],['<div>\n```mermaid\nA-->B\n```\n</div>',[]],
];
const md=new MarkdownIt({html:true});
for(const [doc,expected] of cases){
 const state=create(doc);assert.deepEqual(mermaidRanges(state).map(r=>r.source),expected,doc);
 assert.deepEqual(md.parse(doc,{}).filter(t=>t.type==='fence'&&t.info.trim()==='mermaid').map(t=>t.content.trimEnd()),expected,'reader fence '+doc);
}
let loads=0,active=0,maxActive=0,theme='',initializations:string[]=[];
const renderer=createMermaidRenderer(async()=>{loads++;return {
 initialize(config){theme=config.theme!;initializations.push(theme);assert.equal(config.securityLevel,'strict');assert.equal(config.startOnLoad,false);assert.equal(config.arrowMarkerAbsolute,false,'export markers stay local');assert.ok(config.secure?.includes('arrowMarkerAbsolute'))},
 async render(id,source){active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;if(source==='bad')throw Error('syntax failure');return {svg:`<svg id="${id}">${source}:${theme}</svg>`}},
}});
assert.equal(loads,0,'creating a renderer never loads Mermaid');
const results=await Promise.all([renderer('A','paper'),renderer('B','paper'),renderer('A','paper')]);
assert.equal(results[0].error,undefined);assert.equal(loads,1);assert.equal(maxActive,1,'render calls are serialized');assert.equal(results[0],results[2],'pending requests deduplicate');
assert.equal(await renderer('A','paper'),results[0],'cache hit');
assert.match((await renderer('A','ink')).svg!,/A:dark/);assert.deepEqual(initializations,['default','dark']);
assert.match((await renderer('bad','ink')).error!,/syntax failure/);
const pending=new Map<string,(value:{svg:string})=>void>();
const element={className:'',dataset:{},style:{minHeight:''},getBoundingClientRect:()=>({height:123}),innerHTML:'',textContent:'',classList:{toggle(){}}} as unknown as HTMLElement;
const mount=new MermaidMount(element,()=>{},()=>false,(source)=>new Promise(resolve=>pending.set(source,resolve)));
mount.update('old');mount.update('new');pending.get('new')!({svg:'new'});await mount.ready;
assert.equal(element.innerHTML,'new');pending.get('old')!({svg:'stale'});await Promise.resolve();assert.equal(element.innerHTML,'new','late source never overwrites current SVG');
mount.update('disposed');mount.dispose();pending.get('disposed')!({svg:'late'});await Promise.resolve();assert.equal(element.innerHTML,'new','disposed render never inserts');

// Cached SVG insertion owns fresh IDs, including markers, CSS scopes and accessibility references.
const svg='<svg id="diagram" aria-labelledby="title"><style>#diagram .node{fill:#abc}</style><title id="title">#diagram label id="fake" href="#arrow" url(#arrow)</title><marker id="arrow"></marker><path marker-end="url(#arrow)"/><use href="#arrow"/></svg>';
const elements=[0,1].map(()=>({className:'',dataset:{},style:{minHeight:''},getBoundingClientRect:()=>({height:90}),innerHTML:'',textContent:'',classList:{toggle(){}}} as unknown as HTMLElement));
const copies=elements.map(el=>new MermaidMount(el,()=>{},()=>false,async()=>({svg})));
for(const copy of copies)copy.update('same');await Promise.all(copies.map(copy=>copy.ready));
const ids=elements.map(el=>[...el.innerHTML.matchAll(/<[^>]+\sid="([^"]+)"/g)].map(m=>m[1]));
assert.equal(new Set(ids.flat()).size,6,'every insertion owns its SVG ids');
for(const [i,el] of elements.entries()){
 assert.ok(el.innerHTML.includes('url(#'+ids[i][2]+')'));assert.ok(el.innerHTML.includes('href="#'+ids[i][2]+'"'));
 assert.ok(el.innerHTML.includes('aria-labelledby="'+ids[i][1]+'"'));assert.ok(el.innerHTML.includes('#'+ids[i][0]+' .node'));
 assert.ok(el.innerHTML.includes('fill:#abc'));assert.ok(el.innerHTML.includes('>#diagram label id="fake" href="#arrow" url(#arrow)</title>'),'node text is preserved');
 copies[i].dispose();
}
let blocked=true,started=false;
const guarded=new MermaidMount(elements[0],()=>{},()=>blocked,async()=>{started=true;return {svg:'after IME'}});
guarded.update('IME');await Promise.resolve();assert.equal(started,false,'IME never starts the loader');blocked=false;await guarded.ready;assert.equal(elements[0].innerHTML,'after IME');guarded.dispose();
let finish:(value:{svg:string})=>void=()=>{};
const lateGuard=new MermaidMount(elements[0],()=>{},()=>blocked,()=>new Promise(resolve=>finish=resolve));lateGuard.update('late IME');blocked=true;finish({svg:'after late IME'});await Promise.resolve();assert.equal(elements[0].innerHTML,'after IME','late results wait for composition');blocked=false;await lateGuard.ready;assert.equal(elements[0].innerHTML,'after late IME');lateGuard.dispose();

for(const word of ['图表','tubiao','tb','diagram','chart','mermaid','flowchart'])assert.ok(filterSlashItems(word).some(i=>i.id==='mermaid'),word);
const template='```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```';
for(const toolbar of [false,true]){
 let state=create('/tb',3);state=state.update(toolbar?insertToolbarItem(state,'mermaid'):applySlashItem(state,'mermaid')).state;
 // Toolbar inserts below non-empty prose; slash replaces its trigger line.
 assert.equal(state.doc.toString(),toolbar?'/tb\n\n'+template:template);assert.equal(state.doc.lineAt(state.selection.main.head).text,'  A[开始] --> B[结束]');
 assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),'/tb','one undo');
}
const doc='前文\n\n'+template+'\n\n尾文',field=createBlockField(async()=>'');
const widgets=(s:EditorState,f=field)=>{const out:any[]=[];s.field(f).between(0,s.doc.length,(from,to,d)=>{if(d.spec.widget?.constructor.name==='MermaidWidget')out.push({from,to,source:d.spec.widget.source,widgetFrom:d.spec.widget.from})});return out};
assert.equal(blockAt(create(doc),doc.indexOf('A['))?.kind,'code','diagram remains a navigable fenced block');
assert.equal(create(doc).update(convertBlocks(create(doc),blockAt(create(doc),doc.indexOf('A['))!,'paragraph')).state.doc.toString(),'前文\n\nflowchart LR\n  A[开始] --> B[结束]\n\n尾文');
let state=create(doc,0,field);assert.equal(widgets(state).length,1,'diagram away from caret');
assert.equal(inlineDecorations(state,[{from:0,to:doc.length}]).size,0,'inline decorations do not enter rendered fences');
state=state.update({selection:{anchor:doc.indexOf('A[')}}).state;assert.equal(widgets(state).length,0,'caret shows source');
state=state.update({effects:setComposing.of(true)}).state;const frozen=state.field(field);state=state.update({selection:{anchor:0}}).state;assert.equal(state.field(field),frozen);state=state.update({effects:setComposing.of(false)}).state;assert.equal(widgets(state).length,1);
for(const change of [{from:1,insert:'续'},{from:doc.indexOf('A['),insert:'X'},{from:0,to:2,insert:'```mermaid\nX\n```'}]){
 let s=create(doc,0,field);ensureSyntaxTree(s,s.doc.length,5000);s=s.update({changes:change,selection:{anchor:change.from+change.insert.length}}).state;
 const fresh=createBlockField(async()=>''),rebuilt=create(s.doc.toString(),s.selection.main.head,fresh);assert.deepEqual(widgets(s),widgets(rebuilt,fresh),'mapped index matches fresh parse');
}
assert.equal(mermaidSource(new MarkdownIt().parse('```js\nx\n```',{})[0] as any,()=>''),null);
console.log('PASS: Mermaid detection, lazy serialized/cache/theme/error rendering, stale/disposed results, commands/undo, caret/IME and prose mapping');
