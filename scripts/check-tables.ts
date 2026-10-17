import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import * as editing from '../src/editing';
import * as tableUI from '../src/table-ui';
import {syntaxTree} from '@codemirror/language';

assert.equal(typeof editing.editTable,'function','table edits must be available without the dialog');
const prefix='---\ntitle: 原文\n---\n\n前文  \n\n',suffix='\n\n尾文\t \n';
const raw='| **头** | `code` |\n| :--- | ---: |\n| a\\|b | [链接](x) |\n| 尾 | 不变 |';
const create=()=>EditorState.create({doc:prefix+raw+suffix,extensions:[history(),markdown({base:markdownLanguage,extensions:GFM})]});
const range={from:prefix.length,to:prefix.length+raw.length};
function check(action:editing.TableAction,row:number,column:number,rows:string[][],aligns=['left','right'],value=''){
 let state=create();const tr=state.update(editing.editTable(state,range,row,column,action,value));
 let count=0;tr.changes.iterChanges((from,to)=>{count++;assert.equal(from,range.from);assert.equal(to,range.to)});assert.equal(count,1,'replace exactly the table range');
 state=tr.state;assert.equal(state.doc.toString(),prefix+(rows.length?editing.serializeTable(rows,aligns):'')+suffix,'surrounding bytes remain identical');
 assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),prefix+raw+suffix,'one undo restores exact original');
}
const rows=editing.parseTable(raw).rows;
assert.deepEqual(rows,[['**头**','`code`'],['a\\|b','[链接](x)'],['尾','不变']]);
check('rowAbove',1,0,[rows[0],['',''],rows[1],rows[2]]);
check('rowBelow',1,0,[rows[0],rows[1],['',''],rows[2]]);
check('rowAbove',0,0,[['',''],...rows]);
check('deleteRow',0,0,rows.slice(1));
check('deleteRow',2,0,rows.slice(0,2));
check('columnLeft',1,1,rows.map(r=>[r[0],'',r[1]]),['left','','right']);
check('columnRight',1,1,rows.map(r=>[...r,'']),['left','right','']);
check('deleteColumn',1,0,rows.map(r=>[r[1]]),['right']);
for(const align of ['left','center','right'] as const)check(align,1,0,rows,[align,'right']);
check('deleteTable',1,0,[]);
check('cell',1,1,[rows[0],[rows[1][0],'**新** | `inline`'],rows[2]],undefined,'**新** | `inline`');
for(const action of ['deleteRow','deleteColumn'] as const){
 const state=EditorState.create({doc:'| a |\n| --- |',extensions:[history()]});
 assert.equal(state.update(editing.editTable(state,{from:0,to:state.doc.length},0,0,action)).state.doc.toString(),'');
}
const escaped=editing.serializeTable([['a','b'],['\\\\|','existing\\|pipe']]);
assert.deepEqual(editing.parseTable(escaped).rows,[['a','b'],['\\\\\\|','existing\\|pipe']],'pipes following an even number of backslashes are escaped too');
assert.equal(editing.serializeTable(editing.parseTable(escaped).rows),escaped,'serialization is idempotent');
let state=create();state=state.update(editing.editTable(state,range,1,1,'cell','first')).state;
const first=state.doc.toString(),newRange={from:range.from,to:state.doc.length-suffix.length};
state=state.update(editing.editTable(state,newRange,1,1,'center')).state;
assert.notEqual(state.doc.toString(),first);
assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),first,'menu changes do not merge with cell typing');
let inserted=EditorState.create({doc:'前文后文',selection:{anchor:2},extensions:[history()]});
inserted=inserted.update(editing.insertTable(inserted)).state;
assert.equal(inserted.doc.toString(),'前文\n\n|  |  |\n| --- | --- |\n|  |  |\n\n后文');
assert.equal(inserted.selection.main.head,6,'insert selection is in the first header cell');
assert.ok(undo({state:inserted,dispatch:tr=>inserted=tr.state}));assert.equal(inserted.doc.toString(),'前文后文');

// A nested table owns neither its initial container marker nor surrounding prose.
for(const [source,from,prefix] of [
 ['> | a | b |\n> | --- | --- |\n> | c | d |',2,'> '],
 ['- | a | b |\n  | --- | --- |\n  | c | d |',2,'  '],
 ['> - | a | b |\n>   | --- | --- |\n>   | c | d |',4,'>   '],
] as const){
 let nested=EditorState.create({doc:source,extensions:[history(),markdown({base:markdownLanguage,extensions:GFM})]});
 nested=nested.update(editing.editTable(nested,{from,to:source.length},1,1,'cell','CHANGED')).state;
 assert.equal(nested.doc.toString(),source.replace('c | d','c | CHANGED'),'preserve nested table container '+prefix);
 assert.ok(undo({state:nested,dispatch:tr=>nested=tr.state}));assert.equal(nested.doc.toString(),source);
}
for(const source of ['| old |\n| --- |\n| row |\n','| old |\n| --- |\n| row |\n\n']){
 const base=EditorState.create({doc:source,selection:{anchor:source.length},extensions:[markdown({base:markdownLanguage,extensions:GFM})]});
 const inserted=base.update(editing.insertTable(base)).state;let count=0;
 syntaxTree(inserted).iterate({enter:n=>{if(n.name==='Table')count++}});
 assert.equal(count,2,'inserting a table beside another table preserves two tables');
}
// Leaving a table moves into the neighbouring text; where there is none it uses or opens an empty paragraph, never a line that would join the table.
const t='| a |\n| --- |\n| b |';
function leave(doc:string,above:boolean,from=doc.indexOf(t),to=from+t.length){
 let s=EditorState.create({doc,extensions:[history(),markdown({base:markdownLanguage,extensions:GFM})]});
 s=s.update(tableUI.leaveTable(s,{from,to},above)).state;return s;
}
const tables=(s:EditorState)=>{let n=0;syntaxTree(s).iterate({enter:node=>{if(node.name==='Table')n++}});return n};
for(const [doc,above,expected,head,label] of [
 ['前文\n\n'+t+'\n\n尾文',false,null,('前文\n\n'+t+'\n\n').length,'start of the paragraph below'],
 ['前文\n\n'+t+'\n\n尾文',true,null,2,'end of the paragraph above'],
 ['# 标题 #\n\n'+t+'\n\n## 下文',true,null,4,'end of heading text, before closing marks'],
 ['# 标题\n\n'+t+'\n\n## 下文',false,null,('# 标题\n\n'+t+'\n\n## ').length,'heading text, after its marks'],
 ['标题\n===\n\n'+t,true,null,2,'setext heading text'],
 [t+'\n\n- [ ] 任务',false,null,(t+'\n\n- [ ] ').length,'task text'],
 [t+'\n\n> 引用',false,null,(t+'\n\n> ').length,'quote text'],
 ['```js\nconst a\n```\n\n'+t+'\n\n```\nnext\n```',true,null,13,'last code line above'],
 ['```js\nconst a\n```\n\n'+t+'\n\n```\nnext\n```',false,null,('```js\nconst a\n```\n\n'+t+'\n\n```\n').length,'first code line below'],
 [t+'\n\n```\n```',false,null,(t+'\n\n```').length,'empty code block'],
 [t,false,t+'\n\n',t.length+2,'end of document'],
 [t+'\n',false,t+'\n\n',t.length+2,'trailing newline'],
 [t+'\n\n',false,t+'\n\n',t.length+2,'existing empty paragraph'],
 [t+'\n\n后文',true,'\n\n'+t+'\n\n后文',0,'start of document'],
 ['\n'+t,true,'\n\n'+t,0,'blank first line'],
 [t+'\n\n'+t,false,t+'\n\n\n\n'+t,t.length+2,'table below'],
 ['---\ntitle: x\n---\n\n'+t,true,'---\ntitle: x\n---\n\n\n\n'+t,18,'front matter above'],
] as const){
 const s=leave(doc,above,above&&doc.indexOf(t)!==doc.lastIndexOf(t)?doc.lastIndexOf(t):doc.indexOf(t));
 assert.equal(s.doc.toString(),expected??doc,label+': document');assert.equal(s.selection.main.head,head,label+': caret');
 if(expected===null)continue;
 // Typing at the caret makes its own paragraph and leaves every table intact; one undo removes the opened paragraph.
 const typed=s.update({changes:{from:head,insert:'正文'}}).state,count=tables(leave(doc,above));
 assert.equal(tables(typed),count,label+': tables intact');
 let node:ReturnType<typeof syntaxTree>['topNode']|null=syntaxTree(typed).resolveInner(head+1,1);while(node&&!['Paragraph','Table'].includes(node.name))node=node.parent;
 assert.equal(node?.name,'Paragraph',label+': typed text is a paragraph');
 if(expected!==doc){let u=s;assert.ok(undo({state:u,dispatch:tr=>u=tr.state}));assert.equal(u.doc.toString(),doc,label+': one undo')}
}
const quoted='> | a |\n> | --- |\n> | b |';
assert.equal(leave(quoted,false,2,quoted.length).doc.toString(),quoted+'\n\n','a nested table at the end opens a paragraph after its container');
assert.deepEqual(tableUI.tableAround(leave(t+'\n\n',false),t.length),{from:0,to:t.length});
assert.equal(tableUI.tableAround(EditorState.create({doc:'正文',extensions:[markdown({base:markdownLanguage,extensions:GFM})]}),2),null);
console.log('table checks passed');
