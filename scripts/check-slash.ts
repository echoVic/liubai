import assert from 'node:assert/strict';
import {EditorState,StateField,StateEffect,Compartment} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {history,undo} from '@codemirror/commands';
import {blockRichMode} from '../src/block-ui';
import * as slash from '../src/slash';

assert.equal(typeof slash.filterSlashItems,'function','slash filtering must be implemented');
const ids=(query:string)=>slash.filterSlashItems(query).map(item=>item.id);
for(const query of ['标题','biaoti','bt','heading','HEADING'])assert.deepEqual(ids(query),['h1','h2','h3'],query);
for(const query of ['标题 2','biaoti2','bt2','h2'])assert.equal(ids(query)[0],'h2',query);
for(const [query,id] of [['正文','paragraph'],['zw','paragraph'],['wx','bullet'],['youxu','ordered'],['rwlb','task'],['yy','quote'],['daima','code'],['bg','table'],['image','image'],['fgx','rule'],['tsk','note']])assert.equal(ids(query)[0],id,query);
assert.deepEqual(ids('nothing-matches'),[]);
assert.equal(ids('').length,15);
const searches:[slash.SlashItemID,string[]][]=[
 ['paragraph',['正文','zhengwen','zw','body']],['h1',['标题 1','biaoti1','bt1','h1']],['h2',['标题 2','biaoti2','bt2','h2']],['h3',['标题 3','biaoti3','bt3','h3']],
 ['bullet',['无序列表','wuxuliebiao','wxlb','bulleted']],['ordered',['有序列表','youxuliebiao','yxlb','numbered']],['task',['任务列表','renwuliebiao','rwlb','task']],
 ['quote',['引用','yinyong','yy','blockquote']],['code',['代码块','daimakuai','dmk','code']],['table',['表格','biaoge','bg','table']],['image',['图片','tupian','tp','image']],
 ['mermaid',['图表','tubiao','tb','diagram','chart','mermaid','flowchart']],
 ['math',['公式','gongshi','gs','math','formula','latex','katex','tex']],
 ['rule',['分割线','fengexian','fgx','divider']],['note',['提示块','tishikuai','tsk','callout']],
];
for(const [id,queries] of searches)for(const query of queries)assert.equal(ids(query)[0],id,query);
assert.equal(ids('uote')[0],'quote','substring match');
assert.equal(ids('  BT2  ')[0],'h2','case and query whitespace');

// Literal fixtures catch wrong templates, cursor offsets and edits leaking into neighbouring text.
const fixtures:[slash.SlashItemID,string,number][]=[
 ['paragraph','',0],['h1','# ',2],['h2','## ',3],['h3','### ',4],['bullet','- ',2],['ordered','1. ',3],['task','- [ ] ',6],['quote','> ',2],
 ['code','```\n\n```',4],['math','$$\n\n$$',3],['mermaid','```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```',24],['table','|  |  |\n| --- | --- |\n|  |  |',2],['image','',0],['rule','---\n\n',5],['note','> [!NOTE]\n> ',12],
];
for(const [id,insert,cursor] of fixtures)for(const trigger of ['/','、','']){
 const before='before \t\n\n',after='\n\nafter  ',line=' \t'+trigger+(trigger?'query':'')+'  ';
 const state=EditorState.create({doc:before+line+after,selection:{anchor:before.length+line.length-2},extensions:history()});
 let next=state.update(slash.applySlashItem(state,id)).state;
 assert.equal(next.doc.toString(),before+insert+after,id);
 assert.equal(next.selection.main.head,before.length+cursor,id);
 assert.ok(next.selection.main.empty,id);
 assert.ok(undo({state:next,dispatch:tr=>next=tr.state}),id);
 assert.equal(next.doc.toString(),state.doc.toString(),id+' single undo');
}

const setComposing=StateEffect.define<boolean>(),setFocus=StateEffect.define<boolean>();
const composing=StateField.define({create:()=>false,update:(v,tr)=>tr.effects.reduce((v,e)=>e.is(setComposing)?e.value:v,v)});
const focus=StateField.define({create:()=>false,update:(v,tr)=>tr.effects.reduce((v,e)=>e.is(setFocus)?e.value:v,v)});
const field=slash.createSlashState(composing,focus),mode=new Compartment();
const create=(doc='',pos=doc.length,rich=true,readOnly=false)=>EditorState.create({doc,selection:{anchor:pos},extensions:[composing,focus,field,mode.of(rich?blockRichMode.of(true):[]),EditorState.readOnly.of(readOnly)]});
const type=(s:EditorState,text:string)=>s.update({changes:{from:s.selection.main.from,insert:text},selection:{anchor:s.selection.main.head+text.length},userEvent:'input.type'}).state;
for(const trigger of ['/','、']){
 for(const [doc,pos] of [['',0],[' \t',0],[' \t',2],['before\n\n\nafter',8]] as [string,number][]){
  let s=type(create(doc,pos),trigger);assert.ok(s.field(field),trigger+' empty line');
  s=type(s,'bt');assert.deepEqual(s.field(field)?.items.map(item=>item.id),['h1','h2','h3']);
  s=s.update({effects:slash.slashSelect.of(1)}).state;assert.equal(s.field(field)?.index,1);
  s=s.update({effects:slash.slashClose.of(null)}).state;assert.equal(s.field(field),null);assert.ok(s.doc.toString().includes(trigger+'bt'));
  s=type(s,'1');assert.equal(s.field(field),null,'Escape dismissal must stick');
 }
 for(const doc of ['text','text ','/','、'])assert.equal(type(create(doc),trigger).field(field),null,'middle of line');
 assert.equal(type(create('',0,false),trigger).field(field),null,'source mode');
 assert.equal(type(create('',0,true,true),trigger).field(field),null,'read only');
 for(const effect of [setComposing.of(true),setFocus.of(true)])assert.equal(type(create().update({effects:effect}).state,trigger).field(field),null);
 let s=type(create(),trigger);s=type(s,'no-match');assert.equal(s.field(field),null,'no match closes');
 s=type(create(),trigger);s=s.update({effects:setComposing.of(true)}).state;assert.equal(s.field(field),null,'composition closes an open menu');
 s=type(create(),trigger);s=s.update({effects:mode.reconfigure([])}).state;assert.equal(s.field(field),null,'mode change closes');
 s=type(create(),trigger);s=type(s,'\n');assert.equal(s.field(field),null,'newline closes');
 s=type(create(),trigger);s=s.update({selection:{anchor:0}}).state;assert.equal(s.field(field),null,'moving away closes');
 s=type(create(),trigger);s=s.update({changes:{from:0,to:1},selection:{anchor:0},userEvent:'delete.backward'}).state;assert.equal(s.field(field),null,'deleting the trigger closes');
 s=create().update({effects:setComposing.of(true)}).state;s=type(s,trigger);s=s.update({effects:setComposing.of(false)}).state;assert.equal(s.field(field),null,'compositionend must not reopen');
 assert.equal(create().update({changes:{from:0,insert:trigger},selection:{anchor:1},userEvent:'input.paste'}).state.field(field),null,'paste does not trigger');
}
let s=create('before\n\n\nafter',8).update({effects:slash.slashOpen.of(null)}).state;
assert.equal(s.field(field)?.items.length,15,'plus opens on an empty paragraph without a trigger');
s=type(s,'table');assert.equal(s.field(field)?.items[0].id,'table');
s=s.update(slash.applySlashItem(s,'table')).state;assert.equal(s.field(field),null,'applying closes');
console.log('PASS: slash search, all templates/cursors/undo/neighbours, punctuation, composition, mode/read-only guards, dismissal and plus state');

assert.equal(typeof slash.insertToolbarItem,'function','toolbar inserts independently of slash trigger');
for(const [doc,pos,expected] of [['',0,'> '],['before\ncontinued\n\nafter',3,'before\ncontinued\n\n> \n\nafter']] as const){
 const state=EditorState.create({doc,selection:{anchor:pos},extensions:markdown()}),next=state.update(slash.insertToolbarItem(state,'quote')).state;
 assert.equal(next.doc.toString(),expected);
}

const raw='| A | B |\n| --- | --- |\n| a | b |',prefix='before\n\n',suffix='\n\nafter';
for(const [id,block] of [['quote','> '],['code','```\n\n```'],['table','|  |  |\n| --- | --- |\n|  |  |']] as const){
 const state=EditorState.create({doc:prefix+raw+suffix,selection:{anchor:0},extensions:[history(),markdown({extensions:GFM})]});
 let next=state.update(slash.insertToolbarItem(state,id,{from:prefix.length,to:prefix.length+raw.length})).state;
 assert.equal(next.doc.toString(),prefix+raw+'\n\n'+block+suffix,'toolbar must insert below the focused table, not at the CodeMirror cursor');
 assert.ok(undo({state:next,dispatch:tr=>next=tr.state}));assert.equal(next.doc.toString(),state.doc.toString(),'one undo restores table insertion');
}
