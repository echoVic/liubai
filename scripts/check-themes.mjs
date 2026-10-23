// Contrast and list checks for every theme in src/themes.css. Usage: node scripts/check-themes.mjs
import {readFile} from 'node:fs/promises';
const css=await readFile('src/themes.css','utf8'),list=JSON.parse(await readFile('src/themes.json','utf8'));
const blocks=new Map();
for(const m of css.matchAll(/(?:^|\n)(?::root,)?\[data-liubai-theme=(\w+)\]\{([^}]*)\}/g)){const vars={scheme:m[2].match(/color-scheme:(\w+)/)?.[1]};for(const [,k,v] of m[2].matchAll(/--([\w-]+):([^;]+)/g))vars[k]=v.trim();blocks.set(m[1],vars)}
const lum=h=>{const [r,g,b]=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};
const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)};
// The floors every existing theme already meets; new themes may not go below them.
const rules=[['foreground','card',11],['muted-foreground','card',5],['link','card',5.5],['primary','card',4.5],['quote','card',5.5],['foreground','selection',5],['foreground','highlight',5],['primary-foreground','primary',4.5],['destructive','card',4.5],['ring','card',3]];
const night=[['syntax-keyword','card',7],['syntax-string','card',7],['syntax-type','card',7]];
let failures=0;const fail=s=>{console.error('FAIL: '+s);failures++};
const ids=list.map(t=>t.id);
for(const id of ids)if(!blocks.has(id))fail('themes.css 缺少 '+id);
for(const id of blocks.keys())if(!ids.includes(id))fail('themes.json 缺少 '+id);
for(const t of list){const v=blocks.get(t.id);if(!v)continue;
 if(v.scheme!==(t.dark?'dark':'light'))fail(t.id+' 的 color-scheme 与清单不符');
 if(!/^var\(--font-(song|hei)\)$/.test(v['font-body']||''))fail(t.id+' 没有声明 --font-body');
 for(const [fg,bg,min] of [...rules,...(t.dark?night:[])]){if(!/^#[0-9a-f]{6}$/i.test(v[fg]||'')||!/^#[0-9a-f]{6}$/i.test(v[bg]||'')){fail(t.id+' 缺少 --'+fg+' 或 --'+bg);continue}const r=ratio(v[fg],v[bg]);if(r<min)fail(`${t.id} --${fg} / --${bg} = ${r.toFixed(2)}，低于 ${min}`)}
}
if(failures)process.exitCode=1;else console.log(`PASS: ${ids.length} 套主题的对比度与清单一致`);
