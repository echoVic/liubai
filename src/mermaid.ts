import type {SyntaxNode} from '@lezer/common';
import type {MarkdownConfig} from '@lezer/markdown';
import type {MermaidConfig} from 'mermaid';
import {messages} from './i18n';
import {isDark,themes,type ThemeID} from './theme';

// Like MathFence, let the enclosing Markdown parser own quote/list depth and indentation.
export const MermaidSyntax:MarkdownConfig={
 defineNodes:[{name:'MermaidFence',block:true},'MermaidText'],
 parseBlock:[{name:'MermaidFence',before:'FencedCode',parse(cx,line){
  if(line.indent-line.baseIndent>=4)return false;
  const open=/^(`{3,}|~{3,})[ \t]*mermaid[ \t]*$/.exec(line.text.slice(line.pos));if(!open)return false;
  const from=cx.lineStart+line.pos,parts=[],depth=cx.depth,fence=open[1],indent=line.indent-line.baseIndent;let end=cx.lineStart+line.text.length;
  while(cx.nextLine()){
   if((line as unknown as {depth:number}).depth<depth)break;
   const raw=line.text.slice(line.pos),close=new RegExp('^'+fence[0]+'{'+fence.length+',}[ \\t]*$');
   end=cx.lineStart+line.text.length;
   if(line.indent-line.baseIndent<4&&close.test(raw)){cx.nextLine();break}
   const start=cx.lineStart+Math.min(line.pos,line.findColumn(line.baseIndent+indent));parts.push(cx.elt('MermaidText',start,end));
  }
  cx.addElement(cx.elt('MermaidFence',from,end,parts));return true;
 }}],
};
export function mermaidSource(node:SyntaxNode,slice:(from:number,to:number)=>string):string|null{
 return node.name==='MermaidFence'?node.getChildren('MermaidText').map(part=>slice(part.from,part.to)).join('\n').trimEnd():null;
}
export type MermaidTheme=ThemeID;
export interface MermaidResult {svg?:string;error?:string}
interface MermaidAPI {
 initialize:(config:MermaidConfig)=>void;
 render:(id:string,source:string)=>Promise<{svg:string}>;
}
export type MermaidRenderer=(source:string,theme:MermaidTheme)=>Promise<MermaidResult>;
const identifier=()=> 'liubai-mermaid-'+Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
export const mermaidFont="'Iowan Old Style', 'Songti SC', 'Noto Serif CJK SC', Georgia, serif";
export function createMermaidRenderer(load:()=>Promise<MermaidAPI>):MermaidRenderer{
 let api:Promise<MermaidAPI>|undefined,queue=Promise.resolve(),initialized:MermaidTheme|undefined;
 const cache=new Map<string,Promise<MermaidResult>>();
 return (source,theme)=>{
  const key=JSON.stringify([source,theme]),cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);return cached}
  const result=queue.then(async()=>{
   try{
    const mermaid=await (api??=load().catch(error=>{api=undefined;throw error}));
    if(initialized!==theme){
     mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:isDark(theme)?'dark':'default',fontFamily:mermaidFont,htmlLabels:false,arrowMarkerAbsolute:false,flowchart:{htmlLabels:false},suppressErrorRendering:true,
      // Diagram directives/front matter cannot override the safety, offline font or theme policy.
      secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','suppressErrorRendering','theme','themeVariables','themeCSS','fontFamily','htmlLabels','arrowMarkerAbsolute','flowchart','dompurifyConfig']});
     initialized=theme;
    }
    return {svg:(await mermaid.render(identifier(),source)).svg};
   }catch(error){return {error:error instanceof Error?error.message:String(error)}}
  });
  queue=result.then(()=>{});cache.set(key,result);if(cache.size>128)cache.delete(cache.keys().next().value!);return result;
 };
}
// Loading and evaluating Mermaid holds up the page for a moment, so it waits until the text around the first diagram
// has rendered. A hidden page renders no frames and waits at most 200 ms.
const painted=()=>new Promise<void>(resolve=>{if(typeof requestAnimationFrame!=='function')return resolve();requestAnimationFrame(()=>setTimeout(resolve,0));setTimeout(resolve,200)});
// This is the only runtime import of Mermaid. A plain document never evaluates it.
export const renderMermaid=createMermaidRenderer(async()=>{await painted();return (await import('./mermaid-runtime')).default});
export function mermaidTheme():MermaidTheme{
 const value=typeof document==='undefined'?'paper':document.documentElement.dataset.liubaiTheme;
 return themes.find(t=>t.id===value)?.id||'paper';
}
function uniqueSVG(svg:string):string{
 const prefix=identifier(),ids=new Map<string,string>(),tags=/<(?:[^<>"']|"[^"]*"|'[^']*')+>/g;
 // Mermaid serializes attributes with double quotes. Inspect tags only: a sequence label may literally say id="foo".
 for(const tag of svg.matchAll(tags))for(const match of tag[0].matchAll(/\sid="([^"]+)"/g))ids.set(match[1],prefix+'-'+ids.size);
 const references=(text:string)=>text.replace(/url\(["']?#([^\s)"']+)["']?\)/g,(all,id)=>ids.has(id)?'url(#'+ids.get(id)+')':all);
 return svg.replace(tags,tag=>tag.replace(/(\s)([\w:-]+)="([^"]*)"/g,(_all,space,name,value)=>{
  if(name==='id')value=ids.get(value)||value;
  else if(name==='href'||name==='xlink:href'){if(value.startsWith('#')&&ids.has(value.slice(1)))value='#'+ids.get(value.slice(1))}
  else if(name==='aria-labelledby'||name==='aria-describedby')value=value.split(/\s+/).map((id:string)=>ids.get(id)||id).join(' ');
  else value=references(value);
  return space+name+'="'+value+'"';
 })).replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/g,(_all,attrs,css)=>{
  // Hash selectors are rewritten only before a rule's opening brace, preserving color declarations.
  const scoped=references(css).replace(/([^{}]+)\{/g,(_rule,selector)=>selector.replace(/#([\w-]+)/g,(all:string,id:string)=>ids.has(id)?'#'+ids.get(id):all)+'{');
  return '<style'+attrs+'>'+scoped+'</style>';
 });
}
const mounts=new WeakMap<HTMLElement,MermaidMount>();
export class MermaidMount{
 ready:Promise<void>=Promise.resolve();
 private source='';
 private generation=0;
 private disposed=false;
 private observer:MutationObserver|undefined;
 // A fixed theme (exports print on white paper) ignores the app theme; otherwise diagrams follow it.
 constructor(readonly dom:HTMLElement,private changed:()=>void,private blocked=()=>false,private renderer:MermaidRenderer=renderMermaid,private fixedTheme?:MermaidTheme){
  mounts.set(dom,this);
  if(!fixedTheme&&typeof MutationObserver!=='undefined'){
   this.observer=new MutationObserver(()=>this.update(this.source));
   this.observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-liubai-theme']});
  }
 }
 update(source:string){
  this.source=source;const generation=++this.generation,theme=this.fixedTheme??mermaidTheme(),current=()=>!this.disposed&&generation===this.generation;
  const height=this.dom.getBoundingClientRect().height;if(height)this.dom.style.minHeight=height+'px';
  if(!this.dom.innerHTML)this.dom.textContent=messages.fDiagramLoading();
  this.ready=(async()=>{
   // Both mounting and late completion respect the editor's native and state IME guards.
   while(current()&&this.blocked())await new Promise(resolve=>setTimeout(resolve,50));
   if(!current())return;
   const result=await this.renderer(source,theme);
   while(current()&&this.blocked())await new Promise(resolve=>setTimeout(resolve,50));
   if(!current())return;
   this.dom.classList.toggle('mermaid-error',!!result.error);this.dom.dataset.theme=theme;
   if(result.svg)this.dom.innerHTML=uniqueSVG(result.svg);
   else this.dom.textContent=messages.fDiagramError((result.error||'').split('\n').filter(Boolean).slice(0,2).join(' ').slice(0,500));
   this.dom.style.minHeight='';this.changed();
  })();
 }
 dispose(){this.disposed=true;this.generation++;this.observer?.disconnect();mounts.delete(this.dom)}
}
export function disposeMermaid(root:HTMLElement){for(const dom of root.querySelectorAll<HTMLElement>('.rendered-mermaid'))mounts.get(dom)?.dispose()}
export async function waitMermaid(root:HTMLElement){
 for(const dom of root.querySelectorAll<HTMLElement>('.rendered-mermaid')){
  const mount=mounts.get(dom);if(!mount)continue;
  let ready:Promise<void>;do{ready=mount.ready;await ready}while(ready!==mount.ready);
 }
}
