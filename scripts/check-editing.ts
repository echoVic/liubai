import assert from 'node:assert/strict';
import {statusFailed} from '../src/i18n';
assert.equal(statusFailed({statusCode:'fileReadOnly',status:'File saved',conflict:false}),true);
import {EditorState} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {blockFormat,setHeading,headingLevel,wrapSelection,makeLink,safeLink,serializeTable,parseTable,headings,linkAt} from '../src/editing';
const create=(doc:string,from=0,to=doc.length)=>EditorState.create({doc,selection:{anchor:from,head:to},extensions:[history(),markdown({base:markdownLanguage,extensions:GFM})]});
let s=create('第一行\n第二行\n不选这行',1,8);s=s.update(blockFormat(s,'task')).state;
assert.equal(s.doc.toString(),'- [ ] 第一行\n- [ ] 第二行\n不选这行');
let t=s;s=s.update(blockFormat(s,'task')).state;assert.equal(s.doc.toString(),'第一行\n第二行\n不选这行');
assert.ok(undo({state:t,dispatch:tr=>t=tr.state}));assert.equal(t.doc.toString(),'第一行\n第二行\n不选这行');
s=create('文字',0,2);s=s.update(wrapSelection(s,'**')).state;assert.equal(s.doc.toString(),'**文字**');s=s.update(wrapSelection(s,'**')).state;assert.equal(s.doc.toString(),'文字');
for(const marker of ['~~','`']){
 s=create('前文字后',1,3);s=s.update(wrapSelection(s,marker)).state;
 assert.equal(s.doc.toString(),'前'+marker+'文字'+marker+'后');assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),'文字');
 s=s.update(wrapSelection(s,marker)).state;assert.equal(s.doc.toString(),'前文字后');assert.deepEqual([s.selection.main.anchor,s.selection.main.head],[1,3]);
}
for(let level=1;level<=6;level++){
 s=create('标题正文',1,3);s=s.update(setHeading(s,level)).state;
 assert.equal(s.doc.toString(),'#'.repeat(level)+' 标题正文');assert.equal(headingLevel(s),level);
 assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),'题正');
 s=s.update(setHeading(s,level===1?3:1)).state;
 assert.equal(s.doc.toString(),(level===1?'###':'#')+' 标题正文');assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),'题正');
 s=s.update(setHeading(s,0)).state;assert.equal(s.doc.toString(),'标题正文');assert.equal(headingLevel(s),0);
 assert.deepEqual([s.selection.main.anchor,s.selection.main.head],[1,3]);
}
s=create('# 第一行\n### 第二行\n正文\n不选这行',2,17);s=s.update(setHeading(s,2)).state;
assert.equal(s.doc.toString(),'## 第一行\n## 第二行\n## 正文\n不选这行');
assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),'第一行\n## 第二行\n## 正文\n');
s=s.update(setHeading(s,0)).state;assert.equal(s.doc.toString(),'第一行\n第二行\n正文\n不选这行');assert.deepEqual([s.selection.main.anchor,s.selection.main.head],[0,11]);
s=create('  ####  标题\n正文',9,8);s=s.update(setHeading(s,2)).state;
assert.equal(s.doc.toString(),'  ## 标题\n正文');assert.deepEqual([s.selection.main.anchor,s.selection.main.head],[6,5]);
assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),'标');
s=create('正文',0,0);s=s.update(setHeading(s,1)).state;assert.equal(s.selection.main.head,2);
s=create('### 标题',1,1);s=s.update(setHeading(s,0)).state;assert.equal(s.selection.main.head,0);
s=create('',0,0);s=s.update(setHeading(s,6)).state;assert.equal(s.doc.toString(),'###### ');assert.equal(s.selection.main.head,7);
for(const [line,level] of [['正文',0],['#无空格',0],['####### 太多',0],['  ###### 标题',6],['##\t标题',2]] as const)assert.equal(headingLevel(create(line,0,0)),level);
s=create('# 标题\n正文',0,0);assert.equal(headingLevel(s),1);s=s.update({selection:{anchor:s.doc.length}}).state;assert.equal(headingLevel(s),0);
console.log('标题设置、级别识别、选区保持、删除线与行内代码切换检查通过');
assert.equal(safeLink('javascript:alert(1)'),false);assert.equal(safeLink('file:///private/test'),false);assert.equal(safeLink('#标题'),true);
const link=makeLink('中文[标题]','https://example.com/a_(b)');s=create(link,4,4);assert.equal(linkAt(s)?.url,'https://example.com/a_(b)');
assert.equal(linkAt(s)?.text,'中文[标题]');assert.equal(makeLink(linkAt(s)!.text,linkAt(s)!.url),link);
const rows=[['项目','说明'],['中文|说明','`code`'],['最后一行','文本']];const raw=serializeTable(rows,['left','right']);const parsed=parseTable(raw);assert.equal(parsed.rows.length,3);assert.equal(parsed.aligns[1],'right');assert.equal(parsed.rows[1][0],'中文\\|说明');assert.equal(serializeTable(parsed.rows,parsed.aligns),raw);
s=create('# 第一标题\n\n```md\n# 假标题\n```\n\n## 第二标题');assert.deepEqual(headings(s).map(h=>h.text),['第一标题','第二标题']);
console.log('列表范围与撤销、强调切换、链接协议和转义、表格往返与真实大纲检查通过');
// Multiple sequential replacements should retain an isolated undo step.
const {isolateHistory}=await import('@codemirror/commands');
s=create('前 留白 后',2,4);
s=s.update({changes:{from:2,to:4,insert:makeLink('留白','https://example.com/a')},annotations:isolateHistory.of('full')}).state;
const first=s.doc.toString();s=s.update({changes:{from:2,to:s.doc.length-2,insert:makeLink('留白','https://example.com/b')},annotations:isolateHistory.of('full')}).state;
assert.ok(undo({state:s,dispatch:tr=>s=tr.state}));assert.equal(s.doc.toString(),first);

const {countWords}=await import('../src/stats');
assert.equal(countWords("# 标题\n\n这是**加粗**和[链接](https://example.com/a)。Hello world, it's 2026."),13);
assert.equal(countWords('---\ntitle: 不计\n---\n\n正文'),2);
assert.equal(countWords('![图片说明](a.png)\n\n<span>内联</span>'),2);
assert.equal(countWords('```js\nconst a = 1\n```'),3);
assert.equal(countWords('- [x] 完成 https://example.com/x'),2);
console.log('字数统计检查通过');
assert.equal(countWords('かな カナ 한글 中文 hello-world café 42 don’t'),13);
assert.equal(countWords('<!-- 不计\n注释 -->\n[ref]: https://example.com/不计\n\n[正文][ref]\n| --- | :---: |\n1. [ ] 完成 www.example.com/不计'),4);
assert.equal(countWords('---\r\ntitle: 不计\r\n...\r\n\r\n正文\n~~~ts\nconst a = 1\n~~~'),5);

const {localDocumentLink}=await import('../src/editing');
assert.deepEqual(localDocumentLink('docs/guide.md#安装'),{path:'docs/guide.md',fragment:'安装'});
assert.deepEqual(localDocumentLink('docs/%E5%AE%89%E8%A3%85.md#%E5%AE%89%E8%A3%85'),{path:'docs/%E5%AE%89%E8%A3%85.md',fragment:'安装'});
assert.deepEqual(localDocumentLink('./a b.markdown'),{path:'./a b.markdown',fragment:''});
for(const href of ['https://example.com/a.md','#标题','images/a.png','mailto:a@b.c','//cdn.example.com/a.md'])assert.equal(localDocumentLink(href),null,href);
for(const path of ['a.MD','a.MDOWN','a.mkd','a.txt','docs/a%2Emd','100%25.md','bad%ZZ.md'])assert.deepEqual(localDocumentLink(path+'?raw=1#%E6%A0%87%E9%A2%98'),{path,fragment:'标题'});
assert.deepEqual(localDocumentLink('a.md#bad%ZZ'),{path:'a.md',fragment:'bad%ZZ'});
assert.deepEqual(localDocumentLink('a.md?next=other.md#one#two'),{path:'a.md',fragment:'one#two'});
for(const href of ['', '?file=a.md', 'a.png?file=a.md', 'a.md.exe', 'javascript:a.md', 'file:///a.md'])assert.equal(localDocumentLink(href),null,href);
console.log('相对文稿链接识别检查通过');
