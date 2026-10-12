import { EditorState, Compartment, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, type DecorationSet, keymap, placeholder } from '@codemirror/view';
import { history,historyKeymap,defaultKeymap,indentWithTab,undo,redo } from '@codemirror/commands';
import { markdown,markdownLanguage,markdownKeymap } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxTree,syntaxHighlighting,HighlightStyle,bracketMatching,indentOnInput } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { searchKeymap,highlightSelectionMatches,openSearchPanel } from '@codemirror/search';
import { GFM } from '@lezer/markdown';
import MarkdownIt from 'markdown-it';
import type { Doc } from './types';
import {safeLink} from './editing';

const md=new MarkdownIt({html:false,linkify:false});
export const mode=new Compartment();
export const setComposing=StateEffect.define<boolean>();
export const composing=StateField.define<boolean>({create:()=>false,update:(v,tr)=>tr.effects.reduce((a,e)=>e.is(setComposing)?e.value:a,v)});
export const setFocus=StateEffect.define<boolean>();
const focusField=StateField.define<boolean>({create:()=>false,update:(v,tr)=>tr.effects.reduce((a,e)=>e.is(setFocus)?e.value:a,v)});
const focusDecorations=EditorView.decorations.compute(['doc','selection',focusField,composing],state=>{
 if(!state.field(focusField)||state.field(composing))return Decoration.none;
 let from=state.selection.main.from,to=state.selection.main.to;
 if(from===to){let n=syntaxTree(state).resolveInner(from,-1);while(n.parent&&n.parent.name!=='Document')n=n.parent;if(n.name!=='Document'){from=n.from;to=n.to}}
 const first=state.doc.lineAt(from).number,last=state.doc.lineAt(to).number,b=new RangeSetBuilder<Decoration>();
 for(let i=1;i<=state.doc.lines;i++){const l=state.doc.line(i);b.add(l.from,l.from,Decoration.line({class:i>=first&&i<=last?'focus-active':'focus-dim'}))}return b.finish();
});
class TaskWidget extends WidgetType {
 constructor(readonly from:number,readonly checked:boolean){super()}
 eq(o:TaskWidget){return o.from===this.from&&o.checked===this.checked}
 toDOM(view:EditorView){const input=document.createElement('input');input.type='checkbox';input.checked=this.checked;input.className='task-check';input.setAttribute('aria-label',this.checked?'标记为未完成':'标记为已完成');input.onmousedown=e=>e.preventDefault();input.onchange=()=>{if(view.state.readOnly){input.checked=this.checked;return}view.dispatch({changes:{from:this.from,to:this.from+3,insert:input.checked?'[x]':'[ ]'},userEvent:'input.task'});view.focus()};return input}
 ignoreEvent(){return true}
}

const colours=HighlightStyle.define([
 {tag:tags.heading,color:'var(--foreground)',fontWeight:'600'},
 {tag:tags.strong,fontWeight:'700'}, {tag:tags.emphasis,fontStyle:'italic'},
 {tag:[tags.keyword,tags.bool,tags.null],color:'var(--primary)'},
 {tag:[tags.string,tags.regexp],color:'var(--quote)'},
 {tag:[tags.comment,tags.meta],color:'var(--muted-foreground)'},
 {tag:[tags.link,tags.url],color:'var(--link)'},
 {tag:[tags.number,tags.atom],color:'var(--primary)'}
]);
class ImageWidget extends WidgetType{
 constructor(readonly dest:string,readonly alt:string,readonly resolve:(dest:string)=>Promise<string>){super()}
 eq(o:ImageWidget){return o.dest===this.dest&&o.alt===this.alt}
 toDOM(){const wrap=document.createElement('figure');wrap.className='inline-image';const img=new Image();img.alt=this.alt;img.loading='lazy';wrap.append(img);this.resolve(this.dest).then(url=>{img.src=url}).catch(()=>{const msg=document.createElement('span');msg.textContent='图片暂时无法读取 · '+this.alt;wrap.replaceChildren(msg)});img.onerror=()=>{wrap.textContent='图片资源缺失 · '+this.alt};return wrap}
 ignoreEvent(){return false}
}
class TableWidget extends WidgetType{
 constructor(readonly raw:string,readonly from:number,readonly edit?:()=>void){super()}
 eq(o:TableWidget){return o.raw===this.raw&&o.from===this.from}
 toDOM(view:EditorView){const el=document.createElement('div');el.className='rendered-table';el.innerHTML=md.render(this.raw);const b=document.createElement('button');b.className='table-edit';b.textContent='编辑表格';b.onmousedown=e=>e.preventDefault();b.onclick=()=>{view.dispatch({selection:{anchor:this.from+1}});this.edit?.()};el.append(b);return el}
 ignoreEvent(){return true}
}
export function richExtensions(resolve:(dest:string)=>Promise<string>,editTable?:()=>void){
 const build=(state:EditorState)=>{
  const ranges:{from:number;to:number;dec:Decoration}[]=[];const active=new Set<number>();
  for(const sel of state.selection.ranges){let line=state.doc.lineAt(sel.from);while(line.from<=sel.to){active.add(line.number);if(line.number===state.doc.lines)break;line=state.doc.line(line.number+1)}}
  const touched=(from:number,to:number)=>{for(let n=state.doc.lineAt(from).number;n<=state.doc.lineAt(to).number;n++)if(active.has(n))return true;return false};
  const marked=new Set<string>();const lineClass=(pos:number,cls:string)=>{const line=state.doc.lineAt(pos);const k=line.from+cls;if(!marked.has(k)){marked.add(k);ranges.push({from:line.from,to:line.from,dec:Decoration.line({class:cls})})}};
  syntaxTree(state).iterate({enter:n=>{
   const name=n.name;const raw=state.sliceDoc(n.from,n.to);
   if(/^ATXHeading[1-6]$/.test(name)){lineClass(n.from,'md-heading md-h'+name.slice(-1))}
   if(name==='Blockquote'){for(let nline=state.doc.lineAt(n.from).number;nline<=state.doc.lineAt(n.to).number;nline++)lineClass(state.doc.line(nline).from,'md-quote')}
   if(name==='FencedCode'){for(let i=state.doc.lineAt(n.from).number;i<=state.doc.lineAt(n.to).number;i++)lineClass(state.doc.line(i).from,'md-code-line')}
   if(name==='Link'){
    const token=md.parseInline(raw,{})[0]?.children?.find(t=>t.type==='link_open');const href=token?.attrGet('href')||'';
    ranges.push({from:n.from,to:n.to,dec:Decoration.mark({class:'md-link',attributes:{'data-href':href,title:'⌘ / Ctrl 点击打开链接'}})});
   }
   if(name==='InlineCode')ranges.push({from:n.from,to:n.to,dec:Decoration.mark({class:'md-inline-code'})});
   if(name==='TaskMarker'&&!touched(n.from,n.to)){ranges.push({from:n.from,to:n.to,dec:Decoration.replace({widget:new TaskWidget(n.from,raw.toLowerCase()==='[x]')})});return false}
   if(!touched(n.from,n.to)&&n.node.parent?.name==='Link'&&['LinkMark','URL','LinkTitle'].includes(name))ranges.push({from:n.from,to:n.to,dec:Decoration.replace({})});
   if(name==='Image'&&!touched(n.from,n.to)){
    const token=md.parseInline(raw,{})[0]?.children?.find(t=>t.type==='image');const dest=token?.attrGet('src');const line=state.doc.lineAt(n.from);
    if(dest&&state.sliceDoc(line.from,line.to).trim()===raw.trim()){ranges.push({from:n.from,to:n.to,dec:Decoration.replace({widget:new ImageWidget(dest,token?.content||'图片',resolve),block:true})});return false}
   }
   if(name==='Table'&&!touched(n.from,n.to)){ranges.push({from:n.from,to:n.to,dec:Decoration.replace({widget:new TableWidget(raw,n.from,editTable),block:true})});return false}
   if(!touched(n.from,n.to)&&['HeaderMark','EmphasisMark','CodeMark','QuoteMark','StrikethroughMark'].includes(name))ranges.push({from:n.from,to:n.to,dec:Decoration.replace({})});
  }});
  const builder=new RangeSetBuilder<Decoration>();ranges.sort((a,b)=>a.from-b.from||a.dec.startSide-b.dec.startSide||a.to-b.to);let blockTo=-1;
  for(const r of ranges){if(r.from<blockTo)continue;builder.add(r.from,r.to,r.dec);if(r.dec.spec.block)blockTo=r.to}return builder.finish() as DecorationSet;
 };
 return StateField.define<DecorationSet>({
  create:build,
  update(value,tr){if(tr.state.field(composing))return value.map(tr.changes);return build(tr.state)},
  provide:field=>EditorView.decorations.from(field)
 });
}
export function createEditor(parent:HTMLElement,doc:Doc,resolve:(dest:string)=>Promise<string>,onChange:(content:boolean)=>void,onImage:(files:File[],position?:number)=>void,onCompose:(active:boolean)=>void,onLink:(url:string)=>void,onTable:()=>void){
 const state=EditorState.create({doc:doc.content,selection:{anchor:Math.min(doc.position.anchor||0,doc.content.length),head:Math.min(doc.position.head||0,doc.content.length)},extensions:[
  history(),composing,focusField,focusDecorations,markdown({base:markdownLanguage,codeLanguages:languages,extensions:GFM}),syntaxHighlighting(colours),bracketMatching(),indentOnInput(),highlightSelectionMatches(),
  keymap.of([...markdownKeymap,...historyKeymap,...searchKeymap,...defaultKeymap,indentWithTab]),
  mode.of(doc.position.source?[]:richExtensions(resolve,onTable)),EditorView.lineWrapping,placeholder('从一句话开始……'),
  EditorView.contentAttributes.of({'aria-label':'文稿正文','spellcheck':'false'}),
  EditorView.updateListener.of(u=>{if(u.docChanged||u.selectionSet)onChange(u.docChanged)}),
  EditorView.domEventHandlers({
   compositionstart:(_e,v)=>{v.dispatch({effects:setComposing.of(true)});onCompose(true);return false},
   compositionend:(_e,v)=>{setTimeout(()=>{if(v.dom.isConnected){v.dispatch({effects:setComposing.of(false)});onCompose(false)}},0);return false},
   click:(event)=>{const a=(event.target as HTMLElement).closest<HTMLElement>('[data-href]');if(a&&(event.metaKey||event.ctrlKey)&&safeLink(a.dataset.href||'')){event.preventDefault();onLink(a.dataset.href!);return true}return false},
   paste:(event)=>{const files=Array.from(event.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();onImage(files);return true}return false},drop:(event,view)=>{const files=Array.from(event.dataTransfer?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();onImage(files,view.posAtCoords({x:event.clientX,y:event.clientY})??undefined);return true}return false}})
 ]});return new EditorView({state,parent});
}
export {undo,redo,openSearchPanel,EditorState,EditorView};
