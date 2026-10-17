import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {parser,GFM} from '@lezer/markdown';
import {EditorState} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import * as editing from '../src/editing';

// These assertions fail when the toolbar's text commands are missing or modify neighbouring text.
assert.equal(typeof editing.clearFormatting,'function','clear formatting command');
assert.equal(typeof editing.indentList,'function','list indentation command');
const {Highlight,highlightPlugin}=await import('../src/marks');
const create=(doc:string,from=0,to=doc.length)=>EditorState.create({doc,selection:{anchor:from,head:to},extensions:markdown({base:markdownLanguage,extensions:[GFM,Highlight]})});
for(const [open,close] of [['==','=='],['<u>','</u>'],['<sup>','</sup>'],['<sub>','</sub>']]){
 let s=create('前文字后',1,3);s=s.update(editing.wrapSelection(s,open,close)).state;
 assert.equal(s.doc.toString(),'前'+open+'文字'+close+'后');
 s=s.update(editing.wrapSelection(s,open,close)).state;assert.equal(s.doc.toString(),'前文字后');
 s=create(open+'文字'+close);s=s.update(editing.wrapSelection(s,open,close)).state;assert.equal(s.doc.toString(),'文字');
}
for(const [doc,from,to,expected] of [
 ['# **粗 _斜_** ~~删~~ ==亮== `码` <u>线 <sup>上</sup></u> <sub>下</sub>',0,60,'# 粗 斜 删 亮 码 线 上 下'],
 ['- [**文字**](https://example.com/a_b?q=**x**) 后',0,100,'- 文字 后'],
 ['前 **abcdef** 后',6,8,'前 **ab**cd**ef** 后'],
 ['前 <u>abcdef</u> 后',7,9,'前 <u>ab</u>cd<u>ef</u> 后'],
 ['# 标题\n- 项目\n1. 项目\n> 引用',0,100,'# 标题\n- 项目\n1. 项目\n> 引用'],
 ['前 **word** 后',6,6,'前 word 后'],
 ['**one two**',6,9,'**one** two'],
 ['`a_b ==x==`',0,100,'a_b ==x=='],
 ['**ab*cd*ef**',5,7,'**ab**cd**ef**'],
 ['<u>word</u>',0,100,'word'],
 ['__bold__ _italic_ ***both***',0,100,'bold italic both'],
 ['[label](https://example.com/a_b)',18,28,'[label](https://example.com/a_b)'],
 ['```md\n**code** ==literal==\n```',0,100,'```md\n**code** ==literal==\n```'],
 ['| **head** |\n| --- |\n| ==cell== |',0,100,'| head |\n| --- |\n| cell |'],
 ['**一**\n\n中 ==二== 间\n\n<u>三</u>',2,22,'一\n\n中 二 间\n\n三'],
] as [string,number,number,string][]){
 const s=create(doc,Math.min(from,doc.length),Math.min(to,doc.length));
 assert.equal(s.update(editing.clearFormatting(s)).state.doc.toString(),expected,doc);
}
for(const [doc,pos,indented] of [
 ['- parent\n- item\n  - child\n    continuation\n- next',11,'- parent\n  - item\n    - child\n      continuation\n- next'],
 ['1. parent\n2. item\n   - child\n3. next',14,'1. parent\n   2. item\n      - child\n3. next'],
 ['10. parent\n11. item\n    - child',16,'10. parent\n    11. item\n        - child'],
] as [string,number,string][]){
 let s=create(doc,pos,pos);assert.equal(editing.inList(s),true);
 s=s.update(editing.indentList(s,1)).state;assert.equal(s.doc.toString(),indented);
 s=s.update(editing.indentList(s,-1)).state;assert.equal(s.doc.toString(),doc);
}
let s=create('paragraph',4,4);assert.equal(editing.inList(s),false);assert.equal(editing.indentList(s,1),null);
for(const doc of ['- item','1. item','- [ ] task']){
 for(const pos of [0,1,doc.length])assert.equal(editing.inList(create(doc,pos,pos)),true,doc+' at '+pos);
}
const md=new MarkdownIt({html:true}).use(highlightPlugin),lezer=parser.configure([GFM,Highlight]);
for(const text of ['==亮==','==**粗体**==','中文==高亮==文字']){
 assert.ok(md.render(text).includes('<mark>'),text);assert.ok(lezer.parse(text).toString().includes('Highlight('),text);
}
for(const text of ['`==literal==`','```\n==literal==\n```','\\==escaped==','== no ==','===no===']){
 assert.ok(!md.render(text).includes('<mark>'),text);assert.ok(!lezer.parse(text).toString().includes('Highlight('),text);
}
assert.equal(md.render('==a `==` b==').trim(),'<p><mark>a <code>==</code> b</mark></p>');
console.log('PASS: inline toggles, clear formatting/partial selection/word/links, list subtrees and shared highlight syntax');
