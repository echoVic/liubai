import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import {parser,GFM} from '@lezer/markdown';
import {EditorState} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {MathSyntax,mathPlugin} from '../src/math';
import {WikiSyntax,wikiPlugin,wikiAt,wikiURL,wikiTarget,wikiNodeAllowed} from '../src/wiki-links';
import {splitFrontMatter} from '../src/markdown';
import {frontMatterRange,safeLink} from '../src/editing';
import {inlineDecorations,composing} from '../src/editor';
import * as tableUI from '../src/table-ui';

assert.deepEqual(wikiAt('中😀 [[ 目标😀 ]] 后',4),{target:'目标😀',end:14});
for(const raw of ['[[]]','[[ ]]','[[a|b]]','[[[a]]]','[[a\nb]]','[[a]]]',String.raw`\[[a]]`,'[[a[b]]','[[a]]'+']','[['+'😀'.repeat(257)+']]']){
 assert.equal(wikiAt(raw,raw.indexOf('[[')),null,raw);
}
for(const raw of ['[[\uD800]]','[[\uDC00]]','[[\uD800a]]','[[a\uDC00]]','[[\uD800\uD800]]']){
 assert.equal(wikiAt(raw,0),null,'unpaired surrogate '+JSON.stringify(raw));
}
assert.equal(wikiAt('[[😀]]',0)?.target,'😀');
assert.equal(wikiAt('[['+'😀'.repeat(256)+']]',0)?.target.length,512);
for(const title of ['中文😀','javascript:alert(1)','../目标.md','#标题','<img src=x onerror=alert(1)>']){
 const url=wikiURL(title);assert.equal(wikiTarget(url),title);assert.equal(safeLink(url),false,'internal URL stays outside external allowlist');
}
for(const url of ['https://a','liubai-wiki:%E0%A4%A','liubai-wiki:','liubai-wiki:a%7Cb','liubai-wiki:a%0Ab','liubai-wiki:\uD800','liubai-wiki:%ED%A0%80'])assert.equal(wikiTarget(url),null,url);
type Reference={target:string;raw:string};
type WikiCase={name:string;content:string;references:Reference[];renderedReferences?:Reference[]};
const basic:WikiCase[]=[
 {name:'prose',content:'中😀 [[目标]] 和 [[ 另一个 ]]',references:[{target:'目标',raw:'[[目标]]'},{target:'另一个',raw:'[[ 另一个 ]]'}]},
 {name:'literal',content:'`[[代码]]` $[[公式]]$ [a [[标签]]](x) ![图 [[图片]]](x) <span title="[[属性]]">[[正文]]</span>',references:[{target:'正文',raw:'[[正文]]'}]},
 {name:'front matter whitespace',content:'---\ntags: ["[[属性]]"]\n--- \n\n[[正文]]',references:[{target:'正文',raw:'[[正文]]'}]},
];
const fixturePath=new URL('../testdata/wiki-links.json',import.meta.url);
const cases:WikiCase[]=existsSync(fixturePath)?JSON.parse(readFileSync(fixturePath,'utf8')):basic;
const lezer=parser.configure([GFM,MathSyntax,WikiSyntax]);
const md=new MarkdownIt({html:true,linkify:true}).use(mathPlugin).use(wikiPlugin).use(footnote);
function referencesIn(tokens:ReturnType<MarkdownIt['parse']>):Reference[]{
 return tokens.flatMap(token=>token.type==='wiki_link'?[{target:token.meta.target,raw:token.content}]:
  token.type==='image'?[]:referencesIn(token.children||[]));
}
// Footnotes move to the rendered tail. Check semantic source order before that native relocation.
md.core.ruler.before('footnote_tail','check_wiki_source_order',state=>{
 state.env.wikiSourceReferences=referencesIn(state.tokens);
});
for(const test of [...basic,...cases]){
 const state=EditorState.create({doc:test.content});
 const tree=lezer.parse(test.content),meta=frontMatterRange(state),actual:{target:string;raw:string}[]=[];
 tree.iterate({enter:n=>{
  if(meta&&n.to<=meta.to&&n.name!=='Document')return false;
  if(n.name==='WikiLink'&&wikiNodeAllowed(n.node)){
   const raw=test.content.slice(n.from,n.to),match=wikiAt(raw,0);assert(match);
   actual.push({target:match.target,raw});
  }
 }});
 assert.deepEqual(actual,test.references,'Lezer '+test.name+' '+tree.toString());
 const env:{wikiSourceReferences?:Reference[]}={},tokens=md.parse(splitFrontMatter(test.content).body,env);
 assert.deepEqual(env.wikiSourceReferences,test.references,'markdown-it source order '+test.name);
 const rendered=test.renderedReferences??test.references;
 assert.deepEqual(referencesIn(tokens).map(ref=>JSON.stringify(ref)).sort(),rendered.map(ref=>JSON.stringify(ref)).sort(),
  'markdown-it native rendered references after footnote relocation '+test.name);
 const plain=md.render(splitFrontMatter(test.content).body,{});
 assert(!plain.includes('liubai-wiki:'),'default portable rendering '+test.name);
 const html=md.render(splitFrontMatter(test.content).body,{wikiLinks:'interactive'});
 assert.equal((html.match(/class="md-link md-wiki-link"/g)||[]).length,rendered.length,test.name);
}
const native=md.render('[[Hidden]](https://example.test) ![[Hidden]](image.png) [[Hidden]][ref]\n\n[ref]: https://example.test',{wikiLinks:'interactive'});
assert.equal((native.match(/href="https:\/\/example.test"/g)||[]).length,2,'native wiki-shaped link labels stay ordinary links');
assert(native.includes('<img src="image.png"'),'native wiki-shaped image label stays an image');
assert(!native.includes('liubai-wiki:'),'native labels never render an internal URL');
const nested=md.render('[[Outer `[[Code]]` $[[Math]]$ [[Inner]] tail]] [[Visible]]',{wikiLinks:'interactive'});
assert(nested.includes('<code>[[Code]]</code>'),'invalid nested region retains native code');
assert(nested.includes('class="md-math '),'invalid nested region retains native math');
assert.equal((nested.match(/class="md-link md-wiki-link"/g)||[]).length,1,'only the link after a balanced invalid region renders');
assert(!md.render('[[\uD800]] [[\uDC00]]',{wikiLinks:'interactive'}).includes('liubai-wiki:'),'invalid scalar names render safely');
const doc='前\n\n[[目标]]\n\n[正常](https://example.test)\n\n尾';
const state=EditorState.create({doc,extensions:[composing,markdown({base:markdownLanguage,extensions:[GFM,MathSyntax,WikiSyntax]})]});
const hrefs:string[]=[];inlineDecorations(state,[{from:0,to:doc.length}]).between(0,doc.length,(_a,_b,dec)=>{
 if(dec.spec.attributes?.['data-href'])hrefs.push(dec.spec.attributes['data-href']);
});
assert(hrefs.includes(wikiURL('目标')),'rich editor decorates Wiki link');
assert(hrefs.includes('https://example.test'),'ordinary link retained');
{
 const source='before\n\n| Head [[First]] then [[Second]] | Other |\n| --- | --- |\n| | x\\| 😀 [[Body]] |\n\nafter';
 const editor=EditorState.create({doc:source,extensions:[composing,markdown({base:markdownLanguage,extensions:[GFM,MathSyntax,WikiSyntax]})]});
 const from=source.indexOf('|'),header='Head [[First]] then [[Second]]',body='x\\| 😀 [[Body]]';
 const hit=(row:number,column:number,text:string,offset:number,state=editor,start=from)=>
  tableUI.tableWikiLinkAt?.(state,start,row,column,text,offset);
 assert.deepEqual(hit(0,0,header,header.indexOf('First')),{from:5,to:14,url:wikiURL('First')},'rich table clicks the first semantic Wiki reference');
 assert.deepEqual(hit(0,0,header,header.indexOf('Second')),{from:20,to:30,url:wikiURL('Second')},'rich table clicks the second reference without using the selection');
 assert.equal(hit(0,0,header,0),null,'plain cell text is not a link');
 assert.equal(hit(0,0,header+'pending',7),null,'uncommitted DOM cannot navigate stale source');
 assert.equal(hit(0,0,header,-1),null,'out-of-cell offset');
 assert.equal(hit(1,0,'',0),null,'empty column is not a link');
 assert.deepEqual(hit(1,1,body,body.indexOf('Body')),{from:7,to:15,url:wikiURL('Body')},'empty preceding columns, escaped pipes and emoji preserve UTF-16 positions');
 for(const text of ['`[[Code]]`','$[[Math]]$','<span title="[[HTML]]">text</span>','[text [[Label]]](url)','![text [[Alt]]](image.png)','[text](dest/[[Destination]])','[[Native]](url)','[[Native]][ref]','\\[[Escaped]]']){
  const source='| '+text+' |\n| --- |\n| row |\n\n[ref]: https://example.test';
  const state=EditorState.create({doc:source,extensions:[composing,markdown({base:markdownLanguage,extensions:[GFM,MathSyntax,WikiSyntax]})]});
  for(let offset=0;offset<=text.length;offset++)assert.equal(hit(0,0,text,offset,state,0),null,'native Markdown exclusion '+text+' at '+offset);
 }
 for(const source of ['> | [[Nested]] |\n> | --- |\n> | row |','> - | [[Nested]] |\n>   | --- |\n>   | row |']){
  const state=EditorState.create({doc:source,extensions:[composing,markdown({base:markdownLanguage,extensions:[GFM,MathSyntax,WikiSyntax]})]});
  assert.deepEqual(hit(0,0,'[[Nested]]',4,state,source.indexOf('|')),{from:0,to:10,url:wikiURL('Nested')},'nested table uses original source positions');
 }
 let state=EditorState.create({doc:'| [[Native]][ref] |\n| --- |\n| row |\n\n[ref]: https://example.test',extensions:[composing,markdown({base:markdownLanguage,extensions:[GFM,MathSyntax,WikiSyntax]})]});
 assert.equal(hit(0,0,'[[Native]][ref]',4,state,0),null,'full-document reference definition excludes a native label');
 const end=state.doc.toString().indexOf('\n\n');
 state=state.update({changes:{from:end,to:state.doc.length,insert:''}}).state;
 assert.deepEqual(hit(0,0,'[[Native]][ref]',4,state,0),{from:0,to:10,url:wikiURL('Native')},'removing remote definition enables the native Wiki node');
 assert.equal(editor.doc.toString(),source,'table hit testing never edits source');
}
{
 let state=EditorState.create({doc:'[[Alpha]][ref] '+ 'plain prose '.repeat(100)+'\n\n'+'middle prose '.repeat(600)+'\n\n[ref]: https://example.test',extensions:[composing,markdown({base:markdownLanguage,extensions:[GFM,MathSyntax,WikiSyntax]})]});
 const count=()=>{
  ensureSyntaxTree(state,state.doc.length,5000);
  let found=0;inlineDecorations(state,[{from:0,to:state.doc.length}]).between(0,state.doc.length,(_a,_b,dec)=>{if(wikiTarget(dec.spec.attributes?.['data-href']||''))found++});
  return found;
 };
 assert.equal(count(),0,'resolved native reference');
 const end=state.doc.toString().lastIndexOf('\n\n');
 state=state.update({changes:{from:end,to:state.doc.length,insert:'\n\nplain'}}).state;
 assert.equal(count(),1,'removing a definition outside the paragraph updates Wiki semantics');
 state=state.update({changes:{from:end,to:state.doc.length,insert:'\n\n[ref]: https://example.test'}}).state;
 assert.equal(count(),0,'restoring a definition invalidates reused Wiki nodes');
}
for(const content of cases.filter(test=>test.name.startsWith('footnote-continuation'))){
 const editor=EditorState.create({doc:content.content,extensions:[composing,markdown({base:markdownLanguage,extensions:[GFM,MathSyntax,WikiSyntax]})]});
 const decorated:Reference[]=[];
 inlineDecorations(editor,[{from:0,to:content.content.length}]).between(0,content.content.length,(from,to,dec)=>{
  const href=dec.spec.attributes?.['data-href'],target=href&&wikiTarget(href);
  if(target)decorated.push({target,raw:content.content.slice(from,to)});
 });
 assert.deepEqual(decorated,content.references,'rich editor original UTF-16 footnote ranges '+content.name);
}
console.log(`PASS: ${cases.length} shared Wiki cases, strict internal URL, portable render and rich editor`);
