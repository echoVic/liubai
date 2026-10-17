import { build } from 'esbuild';
import { mkdir,copyFile,readFile,writeFile } from 'node:fs/promises';
await mkdir('web',{recursive:true});
await build({entryPoints:['src/app.ts','src/capture.ts'],bundle:true,format:'esm',target:['safari16','chrome110'],outdir:'web',minify:true,legalComments:'eof'});
// Keep only modern offline fonts. Stable asset names make repeat builds byte-identical.
await build({entryPoints:['src/style.css'],bundle:true,outfile:'web/style.css',minify:true,loader:{'.woff2':'file'},assetNames:'fonts/[name]',plugins:[{name:'katex-woff2',setup(build){build.onLoad({filter:/katex\.css$/},async args=>({contents:(await readFile(args.path,'utf8')).replace(/, url\([^)]*\.(?:woff|ttf)\) format\([^)]*\)/g,''),loader:'css',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))}))}}]});
await build({entryPoints:['src/capture.css'],bundle:true,outfile:'web/capture.css',minify:true});
await copyFile('src/capture.html','web/capture.html');
await copyFile('src/index.html','web/index.html');
await copyFile('src/boot.js','web/boot.js');
await writeFile('web/app.js',(await readFile('web/app.js','utf8')).replace(/[ \t]+$/gm,''));
console.log('留白前端已构建');
