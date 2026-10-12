import { build } from 'esbuild';
import { mkdir,copyFile,readFile,writeFile } from 'node:fs/promises';
await mkdir('web',{recursive:true});
await build({entryPoints:['src/app.ts'],bundle:true,format:'esm',target:['safari16','chrome110'],outfile:'web/app.js',minify:true,legalComments:'eof'});
await build({entryPoints:['src/style.css'],bundle:true,outfile:'web/style.css',minify:true});
await copyFile('src/index.html','web/index.html');
await copyFile('src/boot.js','web/boot.js');
await writeFile('web/app.js',(await readFile('web/app.js','utf8')).replace(/[ \t]+$/gm,''));
console.log('留白前端已构建');
