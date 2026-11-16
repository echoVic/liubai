import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {syntaxTree,ensureSyntaxTree} from '@codemirror/language';
import {WikiSyntax} from '../src/wiki-links';
import {tableReferences} from '../src/table-references';
import {parser} from '../src/markdown';

const state=(doc:string)=>EditorState.create({doc,extensions:markdown({base:markdownLanguage,extensions:[GFM,WikiSyntax]})});
function references(cell:string,definitions:string){
 const table='| 表头 |\n| --- |\n| '+cell+' |';
 const s=state(table+'\n\n'+definitions);
 return {text:tableReferences(s,0,table.length),table,s};
}
{
 const {text,table}=references('[name][a&b]','[a&amp;b]: https://wrong.example\n[a&b]: https://correct.example');
 const html=parser.render(table+'\n\n'+text);
 assert.ok(html.includes('href="https://correct.example"'));
 assert.ok(!text.includes('https://wrong.example'));
}
{
 const {text}=references('[name][a\\*b]','[a*b]: https://wrong.example\n[a\\*b]: https://correct.example');
 assert.ok(text.includes('https://correct.example'));
 assert.ok(!text.includes('https://wrong.example'));
}
{
 const {text,table}=references('[![alt][picture]](https://example.com)','[picture]: image.png');
 assert.ok(parser.render(table+'\n\n'+text).includes('data-image-source="image.png"'));
}
{
 const table='| [label][late] |\n| --- |\n| value |';
 const s=state(table+'\n\n'+('Plain paragraph **with inline formatting**.\n\n').repeat(15000)+'[late]: https://late.example');
 assert.ok(syntaxTree(s).length<s.doc.length,'fixture must begin with an incomplete tree');
 const before=tableReferences(s,0,table.length);
 assert.ok(before.includes('[late]: https://late.example'),'copy sees a definition past the initial parse region');
 ensureSyntaxTree(s,s.doc.length,60000);
 assert.equal(tableReferences(s,0,table.length),before,'finishing the editor parse preserves complete cached definitions');
}
console.log('PASS: raw reference labels, nested images, complete definition cache');
