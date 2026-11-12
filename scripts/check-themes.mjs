// Contrast, distinctness, shadow and list checks for every theme in src/themes.css. Usage: node scripts/check-themes.mjs
import {readFile} from 'node:fs/promises';
const css=await readFile('src/themes.css','utf8'),list=JSON.parse(await readFile('src/themes.json','utf8'));
const blocks=new Map();
for(const m of css.matchAll(/(?:^|\n)(?::root,)?\[data-liubai-theme=(\w+)\]\{([^}]*)\}/g)){const vars={scheme:m[2].match(/color-scheme:(\w+)/)?.[1]};for(const [,k,v] of m[2].matchAll(/--([\w-]+):([^;]+)/g))vars[k]=v.trim();blocks.set(m[1],vars)}
const linear=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
const lum=h=>{const [r,g,b]=linear(h);return .2126*r+.7152*g+.0722*b};
const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)};
const oklab=h=>{const [r,g,b]=linear(h),l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s]};
const apart=(a,b)=>{const p=oklab(a),q=oklab(b);return 100*Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])};
// The floors every existing theme already meets; new themes may not go below them.
const rules=[['foreground','card',11],['muted-foreground','card',5],['link','card',5.5],['primary','card',4.5],['quote','card',5.5],['foreground','selection',5],['foreground','highlight',5],['primary-foreground','primary',4.5],['destructive','card',4.5],['ring','card',3],['ring','popover',3]];
const night=[['syntax-keyword','card',7],['syntax-string','card',7],['syntax-type','card',7]];
// Fills, hairlines and marks drawn on another role must differ from it, or the hover, separator, current item, search hit or code well disappears.
// Contrast ratio misses a change of hue (a yellow mark on white), so these use the OKLab distance x100, where 2 is about the smallest step seen side by side.
// Each floor is the weakest such distance in the Hours and Seasons themes, rounded down to 0.5: accent on popover 4.4 (lamp), border on popover 7.7 (moon),
// highlight on muted 5.4 and on selection 4.0 (autumn), code on card 2.5 (indigo), accent on the muted track 1.6 (autumn), the muted track and table head on card 2 (as code; GitHub's own subtle canvas is 2.2), destructive beside primary 4.8 (dawn).
const distinct=[['accent','popover',4],['accent','card',4],['border','popover',7.5],['border','card',7.5],['highlight','card',5],['highlight','popover',5],['highlight','muted',5],['highlight','code',5],['highlight','selection',3.5],['code','card',2],['accent','muted',1.5],['muted','card',2],['destructive','primary',4.5]];
// A shadow or scrim must darken what it falls on. A dark theme's foreground is light, so --shadow is set once per colour scheme, not mixed from --foreground.
const shadows={light:css.match(/(?:^|\n):root\{[^}]*--shadow:([^;}]+)/)?.[1],dark:css.match(/\n\[data-liubai-scheme=dark\]\{[^}]*--shadow:([^;}]+)/)?.[1]};
let failures=0;const fail=s=>{console.error('FAIL: '+s);failures++};
const ids=list.map(t=>t.id);
for(const id of ids)if(!blocks.has(id))fail('themes.css 缺少 '+id);
for(const id of blocks.keys())if(!ids.includes(id))fail('themes.json 缺少 '+id);
for(const t of list){const v=blocks.get(t.id);if(!v)continue;
 if(v.scheme!==(t.dark?'dark':'light'))fail(t.id+' 的 color-scheme 与清单不符');
 if(!/^var\(--font-(song|hei)\)$/.test(v['font-body']||''))fail(t.id+' 没有声明 --font-body');
 for(const [fg,bg,min] of [...rules,...(t.dark?night:[])]){if(!/^#[0-9a-f]{6}$/i.test(v[fg]||'')||!/^#[0-9a-f]{6}$/i.test(v[bg]||'')){fail(t.id+' 缺少 --'+fg+' 或 --'+bg);continue}const r=ratio(v[fg],v[bg]);if(r<min)fail(`${t.id} --${fg} / --${bg} = ${r.toFixed(2)}，低于 ${min}`)}
 const shadow=((t.dark&&shadows.dark)||shadows.light||'').trim().replace('var(--foreground)',v.foreground||'').replace(/^#(\w)(\w)(\w)$/,'#$1$1$2$2$3$3');
 if(!/^#[0-9a-f]{6}$/i.test(shadow))fail(t.id+' 的 --shadow 无法解析');else for(const bg of ['card','popover'])if(/^#[0-9a-f]{6}$/i.test(v[bg]||'')&&lum(shadow)>=lum(v[bg]))fail(`${t.id} 的 --shadow 不比 --${bg} 暗`);
 for(const [a,b,min] of distinct){if(!/^#[0-9a-f]{6}$/i.test(v[a]||'')||!/^#[0-9a-f]{6}$/i.test(v[b]||'')){fail(t.id+' 缺少 --'+a+' 或 --'+b);continue}const d=apart(v[a],v[b]);if(d<min)fail(`${t.id} --${a} / --${b} 色差 ${d.toFixed(1)}，低于 ${min}`)}
}
if(failures)process.exitCode=1;else console.log(`PASS: ${ids.length} 套主题的对比度、色差、阴影与清单一致`);
