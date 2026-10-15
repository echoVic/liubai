import { EditorState, Compartment, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, type DecorationSet, type ViewUpdate, keymap, placeholder } from '@codemirror/view';
import { history,historyKeymap,defaultKeymap,indentWithTab,undo,redo } from '@codemirror/commands';
import { markdown,markdownLanguage,markdownKeymap } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxTree,syntaxHighlighting,HighlightStyle,bracketMatching,indentOnInput } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { searchKeymap,highlightSelectionMatches,openSearchPanel } from '@codemirror/search';
import { GFM } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import MarkdownIt from 'markdown-it';
import type { Doc } from './types';
import {safeLink} from './editing';

const md=new MarkdownIt({html:false,linkify:false});
export const mode=new Compartment();
export const setComposing=StateEffect.define<boolean>();
export const composing=StateField.define<boolean>({create:()=>false,update:(v,tr)=>tr.effects.reduce((a,e)=>e.is(setComposing)?e.value:a,v)});
export const setFocus=StateEffect.define<boolean>();
const focusField=StateField.define<boolean>({create:()=>false,update:(v,tr)=>tr.effects.reduce((a,e)=>e.is(setFocus)?e.value:a,v)});
function activeLines(state:EditorState):DecorationSet{
 if(!state.field(focusField))return Decoration.none;
 let from=state.selection.main.from,to=state.selection.main.to;
 if(from===to){let n=syntaxTree(state).resolveInner(from,-1);while(n.parent&&n.parent.name!=='Document')n=n.parent;if(n.name!=='Document'){from=n.from;to=n.to}}
 const first=state.doc.lineAt(from).number,last=state.doc.lineAt(to).number,b=new RangeSetBuilder<Decoration>();
 for(let i=first;i<=last;i++){const l=state.doc.line(i);b.add(l.from,l.from,Decoration.line({class:'focus-active'}))}return b.finish();
}
const focusDecorations=StateField.define<DecorationSet>({
 create:activeLines,
 update(value,tr){
  if(tr.state.field(composing))return value.map(tr.changes);
  if(!tr.docChanged&&!tr.selection&&tr.startState.field(focusField)===tr.state.field(focusField)&&!tr.startState.field(composing)&&syntaxTree(tr.startState)===syntaxTree(tr.state))return value;
  return activeLines(tr.state);
 },
 provide:field=>EditorView.decorations.from(field)
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
function selectedLines(state:EditorState){
 const lines=state.selection.ranges.map(sel=>({from:state.doc.lineAt(sel.from).from,to:state.doc.lineAt(sel.to).to}));
 return (from:number,to:number)=>lines.some(line=>from<=line.to&&to>=line.from);
}
function destination(state:EditorState,node:SyntaxNode){
 const url=node.getChild('URL');if(!url)return '';
 return state.sliceDoc(url.from,url.to).replace(/^<(.*)>$/s,'$1').replace(/\\([!-/:-@[-`{-~])/g,'$1');
}
function imageOnLine(state:EditorState,node:SyntaxNode){
 const line=state.doc.lineAt(node.from);
 return node.to<=line.to&&(node.from===line.from||!state.sliceDoc(line.from,node.from).trim())&&(node.to===line.to||!state.sliceDoc(node.to,line.to).trim());
}
export function blockDecorations(state:EditorState,resolve:(dest:string)=>Promise<string>,editTable?:()=>void):DecorationSet{
 const builder=new RangeSetBuilder<Decoration>(),touched=selectedLines(state);
 syntaxTree(state).iterate({enter:n=>{
  if(['Document','BulletList','OrderedList','ListItem','Blockquote'].includes(n.name))return;
  if(n.name==='Table'&&!touched(n.from,n.to))builder.add(n.from,n.to,Decoration.replace({widget:new TableWidget(state.sliceDoc(n.from,n.to),n.from,editTable),block:true}));
  if(n.name==='Paragraph')for(const image of n.node.getChildren('Image')){
   if(touched(image.from,image.to)||!imageOnLine(state,image))continue;
   const dest=destination(state,image),end=image.getChildren('LinkMark')[1];
   if(dest)builder.add(image.from,image.to,Decoration.replace({widget:new ImageWidget(dest,end?state.sliceDoc(image.from+2,end.from):'图片',resolve),block:true}));
  }
  return false;
 }});
 return builder.finish();
}
export function createBlockField(resolve:(dest:string)=>Promise<string>,editTable?:()=>void):StateField<DecorationSet>{
 return StateField.define<DecorationSet>({
  create:state=>blockDecorations(state,resolve,editTable),
  update(value,tr){
   if(tr.state.field(composing))return value.map(tr.changes);
   if(!tr.docChanged&&!tr.selection&&!tr.startState.field(composing)&&syntaxTree(tr.startState)===syntaxTree(tr.state))return value;
   return blockDecorations(tr.state,resolve,editTable);
  },
  provide:field=>EditorView.decorations.from(field)
 });
}
export function inlineDecorations(state:EditorState,ranges:readonly {from:number;to:number}[]):DecorationSet{
 const decorations:{from:number;to:number;dec:Decoration}[]=[],touched=selectedLines(state),marked=new Set<string>();
 for(const range of ranges){
  const lineClass=(from:number,to:number,cls:string)=>{
   const first=state.doc.lineAt(Math.max(from,range.from)).number,last=state.doc.lineAt(Math.min(to,range.to)).number;
   for(let i=first;i<=last;i++){const line=state.doc.line(i),key=line.from+cls;if(!marked.has(key)){marked.add(key);decorations.push({from:line.from,to:line.from,dec:Decoration.line({class:cls})})}}
  };
  syntaxTree(state).iterate({from:range.from,to:range.to,enter:n=>{
   if(n.to<=range.from||n.from>=range.to)return false;
   const name=n.name;
   if(name==='Table'&&!touched(n.from,n.to))return false;
   if(name==='Image'&&!touched(n.from,n.to)&&imageOnLine(state,n.node)&&destination(state,n.node))return false;
   if(/^ATXHeading[1-6]$/.test(name))lineClass(n.from,n.from,'md-heading md-h'+name.slice(-1));
   if(name==='Blockquote')lineClass(n.from,n.to,'md-quote');
   if(name==='FencedCode')lineClass(n.from,n.to,'md-code-line');
   const add=(dec:Decoration)=>{const key=n.from+':'+n.to+':'+name;if(!marked.has(key)){marked.add(key);decorations.push({from:n.from,to:n.to,dec})}};
   if(name==='Link')add(Decoration.mark({class:'md-link',attributes:{'data-href':destination(state,n.node),title:'⌘ / Ctrl 点击打开链接'}}));
   if(name==='InlineCode')add(Decoration.mark({class:'md-inline-code'}));
   if(!touched(n.from,n.to)){
    if(name==='TaskMarker'){add(Decoration.replace({widget:new TaskWidget(n.from,state.sliceDoc(n.from,n.to).toLowerCase()==='[x]')}));return false}
    if((n.node.parent?.name==='Link'&&['LinkMark','URL','LinkTitle'].includes(name))||['HeaderMark','EmphasisMark','CodeMark','QuoteMark','StrikethroughMark'].includes(name))add(Decoration.replace({}));
   }
  }});
 }
 const builder=new RangeSetBuilder<Decoration>();decorations.sort((a,b)=>a.from-b.from||a.dec.startSide-b.dec.startSide||a.to-b.to);
 for(const r of decorations)builder.add(r.from,r.to,r.dec);return builder.finish();
}
export function richExtensions(resolve:(dest:string)=>Promise<string>,editTable?:()=>void):Extension{
 const inlinePlugin=ViewPlugin.fromClass(class{
  decorations:DecorationSet;
  constructor(view:EditorView){this.decorations=inlineDecorations(view.state,view.visibleRanges)}
  update(update:ViewUpdate){
   if(update.state.field(composing)){this.decorations=this.decorations.map(update.changes);return}
   if(update.docChanged||update.viewportChanged||update.selectionSet||update.startState.field(composing)||syntaxTree(update.startState)!==syntaxTree(update.state))this.decorations=inlineDecorations(update.state,update.view.visibleRanges);
  }
 },{decorations:plugin=>plugin.decorations});
 return [createBlockField(resolve,editTable),inlinePlugin];
}
export function createEditor(parent:HTMLElement,doc:Doc,resolve:(dest:string)=>Promise<string>,onChange:(content:boolean)=>void,onImage:(files:File[],position?:number)=>void,onCompose:(active:boolean)=>void,onLink:(url:string)=>void,onTable:()=>void){
 const state=EditorState.create({doc:doc.content,selection:{anchor:Math.min(doc.position.anchor||0,doc.content.length),head:Math.min(doc.position.head||0,doc.content.length)},extensions:[
  history(),composing,focusField,focusDecorations,markdown({base:markdownLanguage,codeLanguages:languages,extensions:GFM}),syntaxHighlighting(colours),bracketMatching(),indentOnInput(),highlightSelectionMatches(),
  EditorView.editorAttributes.of(view=>({class:view.state.field(focusField)?'cm-focus-on':''})),
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
