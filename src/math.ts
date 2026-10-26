import type {MarkdownConfig} from '@lezer/markdown';
import type {PluginSimple} from 'markdown-it';
import katex from 'katex';
import {messages} from './i18n';

const escaped=(text:string,pos:number)=>{let n=0;while(pos>0&&text[--pos]==='\\')n++;return n%2===1};
// Both adapters call these predicates on their paragraph's raw source. Native Markdown parsers own code, HTML tags and blocks, and link destinations.
export function inlineMathEnd(text:string,start:number):number{
 if(text[start]!=='$'||text[start+1]==='$'||!text[start+1]||/\s/.test(text[start+1])||escaped(text,start))return -1;
 for(let end=start+1;end<text.length&&text[end]!=='\n'&&text[end]!=='\r';end++){
  if(text[end]!=='$'||escaped(text,end))continue;
  // A non-closing dollar cannot be skipped to swallow currency or a later formula.
  return end>start+1&&!/\s/.test(text[end-1])&&!/[0-9]/.test(text[end+1]||'')?end+1:-1;
 }
 return -1;
}
export function displayMathBody(text:string):string|null{
 const raw=text.trimEnd();return raw.startsWith('$$')&&raw.length>=4&&raw.endsWith('$$')&&!escaped(raw,raw.length-2)?raw.slice(2,-2).trim():null;
}
export const mathFence=(text:string)=>/^(`{3,}|~{3,})[ \t]*math[ \t]*$/.exec(text);
export const MathSyntax:MarkdownConfig={
 defineNodes:['InlineMath','MathMark',{name:'MathBlock',block:true},{name:'MathFence',block:true},'MathText'],
 parseInline:[{name:'InlineMath',before:'Escape',parse(cx,next,pos){
  if(next!==36)return -1;
  if(cx.char(pos+1)===36){let end=pos+2;while(cx.char(end)===36)end++;return end}
  const end=inlineMathEnd(cx.text,pos-cx.offset);if(end<0)return -1;
  return cx.addElement(cx.elt('InlineMath',pos,cx.offset+end,[cx.elt('MathMark',pos,pos+1),cx.elt('MathText',pos+1,cx.offset+end-1),cx.elt('MathMark',cx.offset+end-1,cx.offset+end)]));
 }}],
 parseBlock:[{name:'MathBlock',before:'SetextHeading',leaf(_cx,leaf){
  if(!leaf.content.startsWith('$$'))return null;
  const bases=new Map<number,number>();
  return {nextLine(cx,line){bases.set(cx.lineStart,line.basePos);return false},finish(cx,leaf){
   if(displayMathBody(leaf.content)===null)return false;
   const end=leaf.start+leaf.content.trimEnd().length,parts=[];let at=leaf.start;
   // Split at physical lines so quote/list markers injected by Lezer never become TeX.
   for(const [i,line] of leaf.content.split('\n').entries()){
    const from=at+(i===0?2:bases.get(at)||0),to=Math.min(at+line.length,end-2);
    if(to>from)parts.push(cx.elt('MathText',from,to));at+=line.length+1;
   }
   cx.addLeafElement(leaf,cx.elt('MathBlock',leaf.start,end,parts));return true;
  }};
 }},{name:'MathFence',before:'FencedCode',parse(cx,line){
  if(line.indent-line.baseIndent>=4)return false;
  const open=mathFence(line.text.slice(line.pos));if(!open)return false;
  const from=cx.lineStart+line.pos,parts=[],depth=cx.depth,fence=open[1],indent=line.indent-line.baseIndent;let end=cx.lineStart+line.text.length;
  while(cx.nextLine()){
   // Parent quote/list boundaries terminate a fence just as they terminate native fenced code.
   if((line as unknown as {depth:number}).depth<depth)break;
   const raw=line.text.slice(line.pos),close=new RegExp('^'+fence[0]+'{'+fence.length+',}[ \\t]*$');
   end=cx.lineStart+line.text.length;
   if(line.indent-line.baseIndent<4&&close.test(raw)){cx.nextLine();break}
   const start=cx.lineStart+Math.min(line.pos,line.findColumn(line.baseIndent+indent));parts.push(cx.elt('MathText',start,end));
  }
  cx.addElement(cx.elt('MathFence',from,end,parts));return true;
 }}],
};
export const mathPlugin:PluginSimple=md=>{
 // Code spans, HTML tags, escapes and destinations are consumed by their own rules before a dollar is seen.
 md.inline.ruler.before('escape','liubai_math',(state,silent)=>{
  if(state.src[state.pos]!=='$')return false;
  const start=state.pos;
  if(state.src[start+1]==='$'){let end=start+2;while(state.src[end]==='$')end++;if(!silent)state.pending+=state.src.slice(start,end);state.pos=end;return true}
  const end=inlineMathEnd(state.src,start);if(end<0||end>state.posMax)return false;
  if(!silent){const token=state.push('math_inline','',0);token.content=state.src.slice(start+1,end-1)}state.pos=end;return true;
 });
 md.core.ruler.before('inline','liubai_math_blocks',state=>{
  for(let i=0;i<state.tokens.length;i++){
   const token=state.tokens[i],inline=state.tokens[i+1],close=state.tokens[i+2];
   if(token.type==='paragraph_open'&&inline?.type==='inline'&&close?.type==='paragraph_close'){
    const body=displayMathBody(inline.content);if(body===null)continue;
    token.type='math_block';token.tag='div';token.nesting=0;token.content=body;state.tokens.splice(i+1,2);
   }else if(token.type==='fence'&&token.info.trim()==='math'){token.type='math_block';token.tag='div';token.content=token.content.trim()}
  }
 });
 const placeholder=(tokens:Parameters<NonNullable<typeof md.renderer.rules.text>>[0],i:number,_options:unknown,env:any)=>{
  const token=tokens[i],index=(env.math??=[]).push({source:token.content,display:token.type==='math_block'})-1;
  const id=env.mathID??=Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  return `<${token.type==='math_block'?'div':'span'} class="md-math md-math-${id}-${index}"${md.renderer.renderAttrs(token)}></${token.type==='math_block'?'div':'span'}>`;
 };
 md.renderer.rules.math_inline=placeholder;md.renderer.rules.math_block=placeholder;
};


export type MathOutput='htmlAndMathml'|'mathml';
export interface MathResult {html:string;error?:string}
const errorColor='liubai-math-error-'+Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
// Least recently used, sized for every formula of a long document: split preview renders all of them again after each pause.
const cache=new Map<string,MathResult>(),escapeHTML=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const mathRenderStats={calls:0,hits:0};
export function renderMath(source:string,display:boolean,output:MathOutput='htmlAndMathml'):MathResult{
 const key=JSON.stringify([source,display,output]),cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);mathRenderStats.hits++;return cached}
 let result:MathResult;mathRenderStats.calls++;
 try{
  const html=katex.renderToString(source,{displayMode:display,output,throwOnError:false,trust:false,maxExpand:1000,maxSize:20,strict:'ignore',errorColor});
  // Parse errors include a title; unsupported/untrusted commands use errorColor. Neither path lets KaTeX's error markup reach a consumer.
  const error=/class="katex-error"[^>]*title="([^"]*)"/.exec(html);
  result=error?{html:escapeHTML(source),error:error[1].replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')}:html.includes('color:'+errorColor)||html.includes('mathcolor="'+errorColor+'"')?{html:escapeHTML(source),error:'unsupported'}:{html};
 }catch(error){result={html:escapeHTML(source),error:error instanceof Error?error.message:String(error)}}
 cache.set(key,result);if(cache.size>1024)cache.delete(cache.keys().next().value!);return result;
}
export function fillMath(element:HTMLElement,source:string,display:boolean,output?:MathOutput){
 const result=renderMath(source,display,output);element.innerHTML=result.html;element.classList.add(display?'math-display':'math-inline');
 if(result.error){element.classList.add('math-error');element.title=result.error==='unsupported'?messages.fFormulaUnsupported():result.error}
}
