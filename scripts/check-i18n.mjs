import ts from 'typescript';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';

const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
async function files(dir){const entries=await readdir(dir,{withFileTypes:true});const found=[];for(const e of entries){if(['.git','node_modules','locales','.superpowers'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())found.push(...await files(p));else if(e.name.endsWith('.go')&&!e.name.endsWith('_test.go'))found.push(p)}return found}
const targets=process.argv.slice(2);if(!targets.length){targets.push(...await files('.'));for(const name of await readdir('src'))if(/\.(ts|html)$/.test(name))targets.push(path.join('src',name))}
let failures=0;
for(const file of targets){
 const source=await readFile(file,'utf8'),lines=source.split('\n'),reported=new Set();
 function check(text,start){for(const match of text.matchAll(new RegExp(cjk,'gu'))){const line=source.slice(0,start+match.index).split('\n').length;if(lines[line-1].includes('// i18n-ignore')||reported.has(line))continue;reported.add(line);console.error(`${file}:${line}: untranslated CJK literal`);failures++}}
 if(file.endsWith('.ts')){
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  function walk(n){if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||n.kind===ts.SyntaxKind.TemplateHead||n.kind===ts.SyntaxKind.TemplateMiddle||n.kind===ts.SyntaxKind.TemplateTail)check(n.getText(tree),n.getStart(tree));ts.forEachChild(n,walk)}walk(tree);
 }else if(file.endsWith('.go')){
  const tokens=/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`[^`]*`/g;
  for(const token of source.matchAll(tokens))if(!token[0].startsWith('//')&&!token[0].startsWith('/*'))check(token[0],token.index);
 }else{
  for(const token of source.matchAll(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)){
   if(token[0].startsWith('<!--'))continue;
   if(token[0].startsWith('<')){for(const attr of token[0].matchAll(/[^\s=<>]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g))check(attr[0],token.index+attr.index)}else check(token[0],token.index);
  }
 }
}
if(failures)process.exitCode=1;else console.log(`PASS: no untranslated CJK literals in ${targets.length} files`);
