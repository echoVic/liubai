import assert from 'node:assert/strict';
import {EditorState,type TransactionSpec} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {blocksOf,blockAt,moveBlocks,moveBlocksTo,convertBlocks,duplicateBlocks,deleteBlocks,insertParagraphBelow} from '../src/blocks';
const create=(doc:string)=>EditorState.create({doc,extensions:[history(),markdown({base:markdownLanguage,extensions:GFM})]});
const range=(s:EditorState,text:string)=>{const from=s.doc.toString().indexOf(text);assert.ok(from>=0,text);return {from,to:from+text.length}};
function apply(s:EditorState,spec:TransactionSpec|null,expected:string){
 assert.ok(spec);let next=s.update(spec).state;assert.equal(next.doc.toString(),expected);
 assert.ok(undo({state:next,dispatch:tr=>next=tr.state}));assert.equal(next.doc.toString(),s.doc.toString());return s.update(spec).state;
}
const examples:[string,string][]=[['one\ntwo','paragraph'],['# title','heading'],['title\n===','heading'],['> [!NOTE]\n> hi','quote'],['```ts\ncode\n```','code'],['    indented\n    code','code'],['| a | b |\n| - | - |\n| c | d |','table'],['***','rule'],['<div>\nhtml\n</div>','html']];
for(const [doc,kind] of examples){const s=create(doc),b=blocksOf(s);assert.equal(b.length,1,doc);assert.equal(b[0].kind,kind);assert.deepEqual([b[0].from,b[0].to],[0,doc.length]);assert.equal(blockAt(s,1)?.kind,kind)}
let s=create('- a\n  - child\n    - grandchild\n- b'),bs=blocksOf(s);
assert.deepEqual(bs.map(b=>b.depth),[0,1,2,0]);assert.deepEqual(bs.map(b=>b.parent),[null,0,1,null]);assert.deepEqual(bs[0].children,[1]);assert.equal(blockAt(s,8)?.depth,1);
assert.equal(blockAt(create('a\n\n b'),2),null);
s=create('first\n\nsecond\n\nthird');
let next=apply(s,moveBlocks(s,range(s,'second'),-1),'second\n\nfirst\n\nthird');assert.equal(next.sliceDoc(next.selection.main.from,next.selection.main.to),'second');
apply(s,moveBlocks(s,range(s,'second'),1),'first\n\nthird\n\nsecond');
apply(s,moveBlocksTo(s,range(s,'third'),blocksOf(s)[0],'before'),'third\n\nfirst\n\nsecond');
apply(s,moveBlocksTo(s,range(s,'first'),blocksOf(s)[2],'after'),'second\n\nthird\n\nfirst');
assert.equal(moveBlocks(s,range(s,'first'),-1),null);assert.equal(moveBlocksTo(s,range(s,'first'),blocksOf(s)[0],'after'),null);
s=create('a\n\n\n b\n\t\n\nc');apply(s,moveBlocks(s,range(s,' b'),-1),' b\n\n\na\n\t\n\nc');
s=create('- a\n  - child\n- b\n- c');apply(s,moveBlocks(s,range(s,'- a'),1),'- b\n- a\n  - child\n- c');
assert.equal(moveBlocks(s,range(s,'child'),1),null);assert.equal(moveBlocksTo(s,range(s,'- b'),blocksOf(s)[1],'before'),null);
s=create('- a\n\n- b\n\n- c');apply(s,moveBlocks(s,range(s,'- b'),1),'- a\n\n- c\n\n- b');
s=create('7) a\n   - child\n8) b\n9) c');next=apply(s,moveBlocks(s,range(s,'8) b'),-1),'7) b\n8) a\n   - child\n9) c');assert.equal(next.sliceDoc(next.selection.main.from,next.selection.main.to),'7) b');
s=create('- a\n- b\n\nparagraph\n\n- c');assert.equal(moveBlocks(s,range(s,'- b'),1),null);
// Moving a paragraph across a list keeps the list whole and in place among the other blocks.
s=create('# t\n\np1\n\np2\n\n- l1\n  - c\n- l2\n\n> q\n\np3');
apply(s,moveBlocksTo(s,range(s,'p3'),blocksOf(s).find(b=>s.sliceDoc(b.from,b.to)==='p1')!,'before'),'# t\n\np3\n\np1\n\np2\n\n- l1\n  - c\n- l2\n\n> q');
apply(s,moveBlocks(s,range(s,'p2'),1),'# t\n\np1\n\n- l1\n  - c\n- l2\n\np2\n\n> q\n\np3');
apply(s,moveBlocks(s,range(s,'> q'),-1),'# t\n\np1\n\np2\n\n> q\n\n- l1\n  - c\n- l2\n\np3');
// Dropping on a list item of another level means before/after that whole list.
apply(s,moveBlocksTo(s,range(s,'p3'),blocksOf(s).find(b=>s.sliceDoc(b.from,b.to)==='  - c')!,'before'),'# t\n\np1\n\np2\n\np3\n\n- l1\n  - c\n- l2\n\n> q');
// An ordered list moved as a whole is not renumbered, and paragraphs are never renumbered.
s=create('3. x\n4. y\n\npara');apply(s,moveBlocks(s,range(s,'para'),-1),'para\n\n3. x\n4. y');
s=create('a\n\nb\n\nc\n\nd');next=apply(s,moveBlocks(s,{from:3,to:7},-1),'b\n\nc\n\na\n\nd');assert.equal(next.sliceDoc(next.selection.main.from,next.selection.main.to),'b\n\nc');
for(const [to,expected] of [['paragraph','body'],['h1','# body'],['h2','## body'],['h3','### body'],['bullet','- body'],['ordered','1. body'],['task','- [ ] body'],['quote','> body'],['code','```\nbody\n```']] as const){s=create('body');next=apply(s,convertBlocks(s,{from:0,to:4},to),expected);assert.equal(next.selection.main.from,0);assert.equal(next.selection.main.to,expected.length)}
for(const doc of ['# body','body\n----','> body','- [x] body','3. body','```js\nbody\n```','    body']){s=create(doc);apply(s,convertBlocks(s,{from:0,to:doc.length},'paragraph'),'body')}
s=create('a\n\nb\n\nc');apply(s,convertBlocks(s,{from:0,to:s.doc.length},'task'),'- [ ] a\n\n- [ ] b\n\n- [ ] c');apply(s,convertBlocks(s,{from:0,to:s.doc.length},'ordered'),'1. a\n\n2. b\n\n3. c');
s=create('- a\n  - child\n- b');apply(s,convertBlocks(s,range(s,'- a'),'task'),'- [ ] a\n      - child\n- b');
s=create('a\n\nb\n\nc');apply(s,duplicateBlocks(s,range(s,'b')),'a\n\nb\n\nb\n\nc');apply(s,deleteBlocks(s,range(s,'b')),'a\n\nc');apply(s,deleteBlocks(s,range(s,'a')),'b\n\nc');apply(s,deleteBlocks(s,range(s,'c')),'a\n\nb');
s=create('- a\n  - child\n- b');apply(s,duplicateBlocks(s,range(s,'- a')),'- a\n  - child\n- a\n  - child\n- b');apply(s,deleteBlocks(s,range(s,'- a')),'- b');
s=create('---\ntitle: Keep\n---\n\na\n\nb\n\n<!-- untouched -->\n');assert.equal(blocksOf(s)[0].from,21);assert.equal(blockAt(s,5),null);
apply(s,moveBlocks(s,range(s,'b\n\n'),-1),'---\ntitle: Keep\n---\n\nb\n\na\n\n<!-- untouched -->\n');
apply(s,convertBlocks(s,{from:0,to:s.doc.length},'h2'),'---\ntitle: Keep\n---\n\n## a\n\n## b\n\n## <!-- untouched -->\n');
assert.equal(create('---\nx: y\n---').update(deleteBlocks(create('---\nx: y\n---'),{from:0,to:13})).state.doc.toString(),'---\nx: y\n---');
// Consecutive format operations and preceding typing are separate undo steps.
s=create('a');s=s.update({changes:{from:1,insert:'b'},userEvent:'input.type'}).state;
s=s.update(convertBlocks(s,{from:0,to:2},'h1')).state;const h1=s.doc.toString();s=s.update(convertBlocks(s,{from:0,to:s.doc.length},'h2')).state;
assert.ok(undo({state:s,dispatch:tr=>s=tr.state}));assert.equal(s.doc.toString(),h1);assert.ok(undo({state:s,dispatch:tr=>s=tr.state}));assert.equal(s.doc.toString(),'ab');
const long=create('paragraph\n\n'.repeat(10000));assert.equal(blocksOf(long).length,10000);assert.equal(blockAt(long,long.doc.length-4)?.kind,'paragraph');
console.log('PASS: block recognition, nesting, moves, separators, conversions, duplicates, deletion, isolated undo, front matter and full long-document tree');
s=create('before\n\n- keep\n  - child\n\nafter');
apply(s,deleteBlocks(s,range(s,'before')),'- keep\n  - child\n\nafter');
apply(s,duplicateBlocks(s,range(s,'before')),'before\n\nbefore\n\n- keep\n  - child\n\nafter');
apply(s,deleteBlocks(s,range(s,'after')),'before\n\n- keep\n  - child');
s=create('- a\n  continuation\n  - child\n- b');
apply(s,convertBlocks(s,range(s,'- a'),'code'),'```\na\ncontinuation\n- child\n```\n- b');
apply(s,convertBlocks(s,range(s,'- a'),'quote'),'> a\n> continuation\n> - child\n- b');
s=create('one\n\ntwo');const tr=s.update(moveBlocks(s,range(s,'two'),-1)!);let touched:{from:number;to:number}[]=[];tr.changes.iterChangedRanges((from,to)=>touched.push({from,to}));assert.deepEqual(touched,[{from:0,to:8}]);
console.log('PASS: neighbouring lists survive duplicate/delete; multiline list conversions include their subtree');

s=create('a\n\nb');next=apply(s,insertParagraphBelow(s,range(s,'a')),'a\n\n\n\nb');assert.equal(next.selection.main.head,3);
s=create('last');next=apply(s,insertParagraphBelow(s,range(s,'last')),'last\n\n');assert.equal(next.selection.main.head,6);
s=create('```\n- keep literal\n1. keep too\n```');apply(s,convertBlocks(s,{from:0,to:s.doc.length},'bullet'),'- - keep literal\n- 1. keep too');
s=create('```\n# literal\n```');apply(s,convertBlocks(s,{from:0,to:s.doc.length},'h2'),'## # literal');
s=create('- before\n- parent\n  - child');apply(s,deleteBlocks(s,range(s,'child')),'- before\n- parent');
s=create('intro\n\n- parent\n  - child');apply(s,deleteBlocks(s,range(s,'child')),'intro\n\n- parent');
s=create('- parent\n  - child\n  - next\n- tail');apply(s,convertBlocks(s,range(s,'child'),'quote'),'- parent\n  > child\n  - next\n- tail');apply(s,convertBlocks(s,range(s,'child'),'code'),'- parent\n  ```\n  child\n  ```\n  - next\n- tail');
s=create('- parent\n  - a\n  - b\n  - c\n- tail');apply(s,convertBlocks(s,{from:s.doc.toString().indexOf('  - a'),to:s.doc.toString().indexOf('\n- tail')},'ordered'),'- parent\n  1. a\n  2. b\n  3. c\n- tail');
s=create('9. a\n   - child\n10. b\n    - keep\n11. c');apply(s,moveBlocks(s,range(s,'11. c'),-1),'9. a\n   - child\n10. c\n11. b\n    - keep');
s=create('9. a\n   - child\n10. b');apply(s,moveBlocks(s,range(s,'9. a'),1),'9. b\n10. a\n    - child');
s=create('x\n\n~~~ts\n````\n~~~\n\ny');apply(s,convertBlocks(s,range(s,'~~~ts'),'code'),'x\n\n`````\n````\n`````\n\ny');
const {visibleBlocks}=await import('../src/blocks');
s=create('a\n\nb\n\nc');assert.deepEqual(visibleBlocks(s,3,4).map(b=>s.sliceDoc(b.from,b.to)),['b']);
assert.ok(visibleBlocks(long,long.doc.length-30,long.doc.length).length<5,'viewport queries do not materialize the full document');
console.log('PASS: viewport-only queries, nested ancestor preservation, ordered digit-width changes, safe fences and paragraph insertion');
