import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
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

const md=new MarkdownIt({html:false,linkify:false});
export const mode=new Compartment();
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
 constructor(readonly raw:string){super()}
 eq(o:TableWidget){return o.raw===this.raw}
 toDOM(){const el=document.createElement('div');el.className='rendered-table';el.innerHTML=md.render(this.raw);return el}
 ignoreEvent(){return false}
}
export function richExtensions(resolve:(dest:string)=>Promise<string>){
 return EditorView.decorations.compute(['doc','selection'],state=>{
  const ranges:{from:number;to:number;dec:Decoration}[]=[];const active=new Set<number>();
  for(const sel of state.selection.ranges){let line=state.doc.lineAt(sel.from);while(line.from<=sel.to){active.add(line.number);if(line.number===state.doc.lines)break;line=state.doc.line(line.number+1)}}
  const touched=(from:number,to:number)=>{for(let n=state.doc.lineAt(from).number;n<=state.doc.lineAt(to).number;n++)if(active.has(n))return true;return false};
  const marked=new Set<string>();const lineClass=(pos:number,cls:string)=>{const line=state.doc.lineAt(pos);const k=line.from+cls;if(!marked.has(k)){marked.add(k);ranges.push({from:line.from,to:line.from,dec:Decoration.line({class:cls})})}};
  syntaxTree(state).iterate({enter:n=>{
   const name=n.name;const raw=state.sliceDoc(n.from,n.to);
   if(/^ATXHeading[1-6]$/.test(name)){lineClass(n.from,'md-heading md-h'+name.slice(-1))}
   if(name==='Blockquote'){for(let nline=state.doc.lineAt(n.from).number;nline<=state.doc.lineAt(n.to).number;nline++)lineClass(state.doc.line(nline).from,'md-quote')}
   if(name==='FencedCode'){for(let i=state.doc.lineAt(n.from).number;i<=state.doc.lineAt(n.to).number;i++)lineClass(state.doc.line(i).from,'md-code-line')}
   if(name==='Link')ranges.push({from:n.from,to:n.to,dec:Decoration.mark({class:'md-link'})});
   if(name==='Image'&&!touched(n.from,n.to)){
    const token=md.parseInline(raw,{})[0]?.children?.find(t=>t.type==='image');const dest=token?.attrGet('src');const line=state.doc.lineAt(n.from);
    if(dest&&state.sliceDoc(line.from,line.to).trim()===raw.trim()){ranges.push({from:n.from,to:n.to,dec:Decoration.replace({widget:new ImageWidget(dest,token?.content||'图片',resolve),block:true})});return false}
   }
   if(name==='Table'&&!touched(n.from,n.to)){ranges.push({from:n.from,to:n.to,dec:Decoration.replace({widget:new TableWidget(raw),block:true})});return false}
   if(!touched(n.from,n.to)&&['HeaderMark','EmphasisMark','CodeMark','QuoteMark','StrikethroughMark'].includes(name))ranges.push({from:n.from,to:n.to,dec:Decoration.replace({})});
  }});
  const builder=new RangeSetBuilder<Decoration>();ranges.sort((a,b)=>a.from-b.from||a.dec.startSide-b.dec.startSide||a.to-b.to);let blockTo=-1;
  for(const r of ranges){if(r.from<blockTo)continue;builder.add(r.from,r.to,r.dec);if(r.dec.spec.block)blockTo=r.to}return builder.finish() as DecorationSet;
 });
}
export function createEditor(parent:HTMLElement,doc:Doc,resolve:(dest:string)=>Promise<string>,onChange:()=>void,onImage:(files:File[],position?:number)=>void){
 const state=EditorState.create({doc:doc.content,selection:{anchor:Math.min(doc.position.anchor||0,doc.content.length),head:Math.min(doc.position.head||0,doc.content.length)},extensions:[
  history(),markdown({base:markdownLanguage,codeLanguages:languages,extensions:GFM}),syntaxHighlighting(colours),bracketMatching(),indentOnInput(),highlightSelectionMatches(),
  keymap.of([...markdownKeymap,...historyKeymap,...searchKeymap,...defaultKeymap,indentWithTab]),
  mode.of(doc.position.source?[]:richExtensions(resolve)),EditorView.lineWrapping,placeholder('从一句话开始……'),
  EditorView.contentAttributes.of({'aria-label':'文稿正文','spellcheck':'false'}),
  EditorView.updateListener.of(u=>{if(u.docChanged||u.selectionSet)onChange()}),
  EditorView.domEventHandlers({paste:(event)=>{const files=Array.from(event.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();onImage(files);return true}return false},drop:(event,view)=>{const files=Array.from(event.dataTransfer?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();onImage(files,view.posAtCoords({x:event.clientX,y:event.clientY})??undefined);return true}return false}})
 ]});return new EditorView({state,parent});
}
export {undo,redo,openSearchPanel,EditorState,EditorView};
