import { build } from 'esbuild';
import {writeMermaidNotices} from './mermaid-notices.mjs';
import { mkdir,copyFile,readFile,writeFile,readdir,rm } from 'node:fs/promises';
await mkdir('web',{recursive:true});
// Mermaid's own dynamic imports are folded into one offline ESM chunk. Keep the existing app bundle intact.
const mermaid=await build({entryPoints:['src/mermaid-runtime.ts'],bundle:true,format:'esm',target:['safari16','chrome110'],minify:true,legalComments:'eof',write:false,metafile:true});
const {createHash}=await import('node:crypto');
const chunk='mermaid-runtime-'+createHash('sha256').update(mermaid.outputFiles[0].contents).digest('hex').slice(0,12)+'.js';
await writeFile('web/'+chunk,mermaid.outputFiles[0].contents);
// docx embeds JSZip's legacy setImmediate shim. Only its unused string-callback path
// compiles code; replace that path with a TypeError, keeping function callbacks and CSP intact.
const docx=await build({entryPoints:['src/docx-export.ts'],bundle:true,format:'esm',target:['safari16','chrome110'],minify:true,legalComments:'eof',write:false,metafile:true,plugins:[{
 name:'docx-csp',setup(builder){builder.onLoad({filter:/docx\/dist\/index\.mjs$/},async args=>{
  const source=await readFile(args.path,'utf8'),legacy='e = new Function("" + e)';
  if(source.split(legacy).length!==2)throw Error('Review docx JSZip CSP shim after upgrading');
  return {contents:source.replace(legacy,'(()=>{throw new TypeError("Expected a function callback")})()'),loader:'js',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))};
 })},
}]});
if(/\bnew Function\s*\(|\beval\s*\(/.test(docx.outputFiles[0].text))throw Error('Word chunk contains runtime code generation');
const docxChunk='docx-export-'+createHash('sha256').update(docx.outputFiles[0].contents).digest('hex').slice(0,12)+'.js';
await writeFile('web/'+docxChunk,docx.outputFiles[0].contents);
// Code that only some documents need, such as each code block language's grammar, loads on demand from chunks/.
const app=await build({entryPoints:['src/app.ts','src/capture.ts'],bundle:true,format:'esm',splitting:true,chunkNames:'chunks/[name]-[hash]',target:['safari16','chrome110'],outdir:'web',minify:true,legalComments:'eof',metafile:true,plugins:[{
 name:'lazy-mermaid',setup(builder){builder.onResolve({filter:/^\.\/mermaid-runtime$/},()=>({path:'./'+chunk,external:true}));builder.onResolve({filter:/^\.\/docx-export$/},()=>({path:'./'+docxChunk,external:true}))},
}]});
await writeMermaidNotices([...Object.keys(mermaid.metafile.inputs),...Object.keys(docx.metafile.inputs)]);
// Keep only modern offline fonts. Stable asset names make repeat builds byte-identical.
await build({entryPoints:['src/style.css'],bundle:true,outfile:'web/style.css',minify:true,loader:{'.woff2':'file'},assetNames:'fonts/[name]',plugins:[{name:'katex-woff2',setup(build){build.onLoad({filter:/katex\.css$/},async args=>({contents:(await readFile(args.path,'utf8')).replace(/, url\([^)]*\.(?:woff|ttf)\) format\([^)]*\)/g,''),loader:'css',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))}))}}]});
await build({entryPoints:['src/capture.css'],bundle:true,outfile:'web/capture.css',minify:true});
await copyFile('src/capture.html','web/capture.html');
await copyFile('src/index.html','web/index.html');
await build({entryPoints:['src/boot.ts'],bundle:true,format:'iife',target:['safari16','chrome110'],outfile:'web/boot.js',minify:true});
// A classic worker script, which every WebView here can start.
await build({entryPoints:['src/stats-worker.ts'],bundle:true,format:'iife',target:['safari16','chrome110'],outfile:'web/stats-worker.js',minify:true});
const scripts=Object.keys(app.metafile.outputs).filter(name=>name.endsWith('.js'));
for(const name of scripts)await writeFile(name,(await readFile(name,'utf8')).replace(/[ \t]+$/gm,''));
// Keep the prior chunk available until the new app bundle has been written.
for(const name of await readdir('web'))if(/^(mermaid-runtime|docx-export)-[a-f0-9]+\.js$/.test(name)&&name!==chunk&&name!==docxChunk)await rm('web/'+name);
for(const name of await readdir('web/chunks'))if(!scripts.includes('web/chunks/'+name))await rm('web/chunks/'+name);
console.log('留白前端已构建；Word chunk '+docxChunk+' ('+docx.outputFiles[0].contents.byteLength+' bytes)');
