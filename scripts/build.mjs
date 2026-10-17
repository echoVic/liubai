import { build } from 'esbuild';
import {writeMermaidNotices} from './mermaid-notices.mjs';
import { mkdir,copyFile,readFile,writeFile,readdir,rm } from 'node:fs/promises';
await mkdir('web',{recursive:true});
// Mermaid's own dynamic imports are folded into one offline ESM chunk. Keep the existing app bundle intact.
const mermaid=await build({entryPoints:['src/mermaid-runtime.ts'],bundle:true,format:'esm',target:['safari16','chrome110'],minify:true,legalComments:'eof',write:false,metafile:true});
const {createHash}=await import('node:crypto');
const chunk='mermaid-runtime-'+createHash('sha256').update(mermaid.outputFiles[0].contents).digest('hex').slice(0,12)+'.js';
await writeFile('web/'+chunk,mermaid.outputFiles[0].contents);
await build({entryPoints:['src/app.ts','src/capture.ts'],bundle:true,format:'esm',target:['safari16','chrome110'],outdir:'web',minify:true,legalComments:'eof',plugins:[{
 name:'lazy-mermaid',setup(builder){builder.onResolve({filter:/^\.\/mermaid-runtime$/},()=>({path:'./'+chunk,external:true}))},
}]});
await writeMermaidNotices(Object.keys(mermaid.metafile.inputs));
// Keep only modern offline fonts. Stable asset names make repeat builds byte-identical.
await build({entryPoints:['src/style.css'],bundle:true,outfile:'web/style.css',minify:true,loader:{'.woff2':'file'},assetNames:'fonts/[name]',plugins:[{name:'katex-woff2',setup(build){build.onLoad({filter:/katex\.css$/},async args=>({contents:(await readFile(args.path,'utf8')).replace(/, url\([^)]*\.(?:woff|ttf)\) format\([^)]*\)/g,''),loader:'css',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))}))}}]});
await build({entryPoints:['src/capture.css'],bundle:true,outfile:'web/capture.css',minify:true});
await copyFile('src/capture.html','web/capture.html');
await copyFile('src/index.html','web/index.html');
await copyFile('src/boot.js','web/boot.js');
await writeFile('web/app.js',(await readFile('web/app.js','utf8')).replace(/[ \t]+$/gm,''));
// Keep the prior chunk available until the new app bundle has been written.
for(const name of await readdir('web'))if(/^mermaid-runtime-[a-f0-9]+\.js$/.test(name)&&name!==chunk)await rm('web/'+name);
console.log('留白前端已构建');
