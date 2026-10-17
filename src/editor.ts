import {messages,activeLocale} from './i18n';
import { EditorState, Compartment, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, type DecorationSet, type ViewUpdate, keymap, placeholder } from '@codemirror/view';
import { history,historyKeymap,defaultKeymap,indentWithTab,undo,redo } from '@codemirror/commands';
import { markdown,markdownLanguage,markdownKeymap } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxTree,syntaxHighlighting,HighlightStyle,bracketMatching,indentOnInput } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { searchKeymap,highlightSelectionMatches,openSearchPanel,closeSearchPanel } from '@codemirror/search';
import { GFM } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import {TableWidget,tableComposition} from './table-ui';
import type { Doc } from './types';
import {createBlockUI,blockRichMode,type BlockUIOptions} from './block-ui';
import {createSlashMenu} from './slash';
import {Highlight,inlineTagPairs,tagHosts} from './marks';
import {indentList,safeLink,localDocumentLink,frontMatterRange} from './editing';
import {htmlToMarkdown,pasteText,replacePasteImage,type PasteImage} from './paste';

export const mode=new Compartment();
export const editorLocale=new Compartment();
export function localizedEditor(){return [placeholder(messages.fStartWithASentence()),EditorView.contentAttributes.of({'aria-label':messages.fDocumentText(),'spellcheck':'false'}),EditorState.phrases.of({
 'next':messages.fNext(),'previous':messages.fPrevious(),'all':messages.fAll(),'match case':messages.fMatchCase(),'regexp':messages.fRegexp(),'by word':messages.fWholeWord(),'replace':messages.fReplace(),'replace all':messages.fReplaceAll(),'Go to line':messages.fGoToLine(),'go':messages.fGo(),'current match':messages.fCurrentMatch(),'on line':messages.fOnLine(),'replaced match on line $':messages.fReplacedOnLine('$'),'replaced $ matches':messages.fReplacements('$'),
 'Find':messages.fFind(),'Replace':messages.fReplace(),'Next':messages.fNext(),'Previous':messages.fPrevious(),'All':messages.fAll(),'Match case':messages.fMatchCase(),'Regular expression':messages.fRegexp(),'By word':messages.fWholeWord(),'Replace all':messages.fReplaceAll(),'close':messages.fClose(),'Find:':messages.fFindLabel(),'Replace:':messages.fReplaceLabel(),
})]}
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
 readonly locale=activeLocale;
 constructor(readonly from:number,readonly checked:boolean){super()}
 eq(o:TaskWidget){return o.locale===this.locale&&o.from===this.from&&o.checked===this.checked}
 toDOM(view:EditorView){const input=document.createElement('input');input.type='checkbox';input.checked=this.checked;input.className='task-check';input.setAttribute('aria-label',this.checked?messages.fMarkAsIncomplete():messages.fMarkAsComplete());input.onmousedown=e=>e.preventDefault();input.onchange=()=>{if(view.state.readOnly){input.checked=this.checked;return}view.dispatch({changes:{from:this.from,to:this.from+3,insert:input.checked?'[x]':'[ ]'},userEvent:'input.task'});view.focus()};return input}
 ignoreEvent(){return true}
}

const colours=HighlightStyle.define([
 {tag:tags.heading,color:'var(--foreground)',fontWeight:'600'},
 {tag:tags.strong,fontWeight:'700'}, {tag:tags.emphasis,fontStyle:'italic'}, {tag:tags.strikethrough,textDecoration:'line-through'},
 {tag:[tags.keyword,tags.bool,tags.null],color:'var(--primary)'},
 {tag:[tags.string,tags.regexp],color:'var(--quote)'},
 {tag:[tags.comment,tags.meta],color:'var(--muted-foreground)'},
 {tag:[tags.link,tags.url],color:'var(--link)'},
 {tag:[tags.number,tags.atom],color:'var(--primary)'}
]);
class ImageWidget extends WidgetType{
 readonly locale=activeLocale;
 constructor(readonly dest:string,readonly alt:string,readonly resolve:(dest:string)=>Promise<string>){super()}
 eq(o:ImageWidget){return o.locale===this.locale&&o.dest===this.dest&&o.alt===this.alt}
 toDOM(){const wrap=document.createElement('figure');wrap.className='inline-image';const img=new Image();img.alt=this.alt;img.loading='lazy';wrap.append(img);this.resolve(this.dest).then(url=>{img.src=url}).catch(()=>{const msg=document.createElement('span');msg.textContent=messages.fImageTemporarilyUnreadable(this.alt);wrap.replaceChildren(msg)});img.onerror=()=>{wrap.textContent=messages.fImageResourceMissing(this.alt)};return wrap}
 ignoreEvent(){return false}
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
export function blockDecorations(state:EditorState,resolve:(dest:string)=>Promise<string>):DecorationSet{
 const builder=new RangeSetBuilder<Decoration>(),touched=selectedLines(state),meta=frontMatterRange(state);
 syntaxTree(state).iterate({enter:n=>{
  if(meta&&n.from<meta.to&&n.name!=='Document')return false;
  if(['Document','BulletList','OrderedList','ListItem','Blockquote'].includes(n.name))return;
  if(n.name==='Table')builder.add(n.from,n.to,Decoration.replace({widget:new TableWidget(state.sliceDoc(n.from,n.to),n.from,composing,state.readOnly),block:true}));
  if(n.name==='Paragraph')for(const image of n.node.getChildren('Image')){
   if(touched(image.from,image.to)||!imageOnLine(state,image))continue;
   const dest=destination(state,image),end=image.getChildren('LinkMark')[1];
   if(dest)builder.add(image.from,image.to,Decoration.replace({widget:new ImageWidget(dest,end?state.sliceDoc(image.from+2,end.from):messages.fImage(),resolve),block:true}));
  }
  return false;
 }});
 return builder.finish();
}
export function createBlockField(resolve:(dest:string)=>Promise<string>):StateField<DecorationSet>{
 return StateField.define<DecorationSet>({
  create:state=>blockDecorations(state,resolve),
  update(value,tr){
   if(tr.state.field(composing))return value.map(tr.changes);
   if(!tr.docChanged&&!tr.selection&&tr.startState.readOnly===tr.state.readOnly&&!tr.startState.field(composing)&&syntaxTree(tr.startState)===syntaxTree(tr.state))return value;
   return blockDecorations(tr.state,resolve);
  },
  provide:field=>EditorView.decorations.from(field)
 });
}
export function inlineDecorations(state:EditorState,ranges:readonly {from:number;to:number}[]):DecorationSet{
 const decorations:{from:number;to:number;dec:Decoration}[]=[],touched=selectedLines(state),marked=new Set<string>(),meta=frontMatterRange(state);
 const active=(from:number,to:number)=>state.selection.ranges.some(sel=>sel.from<=to&&sel.to>=from);
 for(const range of ranges){
  const lineClass=(from:number,to:number,cls:string)=>{
   const first=state.doc.lineAt(Math.max(from,range.from)).number,last=state.doc.lineAt(Math.min(to,range.to)).number;
   for(let i=first;i<=last;i++){const line=state.doc.line(i),key=line.from+cls;if(!marked.has(key)){marked.add(key);decorations.push({from:line.from,to:line.from,dec:Decoration.line({class:cls})})}}
  };
  if(meta&&range.from<=meta.to)lineClass(meta.from,meta.to,'md-front-matter');
  syntaxTree(state).iterate({from:range.from,to:range.to,enter:n=>{
   if(meta&&n.from<meta.to&&n.name!=='Document')return false;
   if(n.to<=range.from||n.from>=range.to)return false;
   const name=n.name;
   if(tagHosts.test(name))for(const pair of inlineTagPairs(n.node,(a,b)=>state.sliceDoc(a,b))){
    const key=pair.from+':tag';if(marked.has(key))continue;marked.add(key);
    if(pair.closeFrom>pair.openTo)decorations.push({from:pair.openTo,to:pair.closeFrom,dec:Decoration.mark({class:pair.tag==='u'?'md-underline':'md-'+pair.tag})});
    if(!active(pair.from,pair.to))for(const [from,to] of [[pair.from,pair.openTo],[pair.closeFrom,pair.to]])decorations.push({from,to,dec:Decoration.replace({})});
   }
   if(name==='Highlight'){
    const marks=n.node.getChildren('HighlightMark');if(marks.length===2)decorations.push({from:marks[0].to,to:marks[1].from,dec:Decoration.mark({class:'md-highlight'})});
    if(!active(n.from,n.to))for(const mark of marks)decorations.push({from:mark.from,to:mark.to,dec:Decoration.replace({})});
   }
   if(name==='Table')return false;
   if(name==='Image'&&!touched(n.from,n.to)&&imageOnLine(state,n.node)&&destination(state,n.node))return false;
   if(/^ATXHeading[1-6]$/.test(name))lineClass(n.from,n.from,'md-heading md-h'+name.slice(-1));
   if(name==='Blockquote')lineClass(n.from,n.to,'md-quote');
   if(name==='FencedCode')lineClass(n.from,n.to,'md-code-line');
   const add=(dec:Decoration)=>{const key=n.from+':'+n.to+':'+name;if(!marked.has(key)){marked.add(key);decorations.push({from:n.from,to:n.to,dec})}};
   if(name==='Link')add(Decoration.mark({class:'md-link',attributes:{'data-href':destination(state,n.node),title:messages.fCtrlClickToOpenTheLink()}}));
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
export function richExtensions(resolve:(dest:string)=>Promise<string>):Extension{
 const inlinePlugin=ViewPlugin.fromClass(class{
  decorations:DecorationSet;
  constructor(view:EditorView){this.decorations=inlineDecorations(view.state,view.visibleRanges)}
  update(update:ViewUpdate){
   if(update.state.field(composing)){this.decorations=this.decorations.map(update.changes);return}
   if(update.docChanged||update.viewportChanged||update.selectionSet||update.startState.field(composing)||syntaxTree(update.startState)!==syntaxTree(update.state))this.decorations=inlineDecorations(update.state,update.view.visibleRanges);
  }
 },{decorations:plugin=>plugin.decorations});
 return [blockRichMode.of(true),createBlockField(resolve),inlinePlugin];
}
export function createEditor(parent:HTMLElement,doc:Doc,resolve:(dest:string)=>Promise<string>,onChange:(content:boolean)=>void,onImage:(files:File[],position?:number)=>void,onCompose:(active:boolean)=>void,onLink:(url:string)=>void,onOpenFiles:(files:File[])=>void,onPasteImage:(image:PasteImage)=>Promise<string>,onPasteError:(error:unknown)=>void,blocks?:BlockUIOptions){
 const state=EditorState.create({doc:doc.content,selection:{anchor:Math.min(doc.position.anchor||0,doc.content.length),head:Math.min(doc.position.head||0,doc.content.length)},extensions:[
  tableComposition.of((view,active,commit)=>{view.dispatch({effects:setComposing.of(active)});commit?.();onCompose(active)}),
  history(),composing,focusField,focusDecorations,createSlashMenu(composing,focusField,()=>blocks?.action('image')),blocks?createBlockUI(composing,focusField,blocks):[],markdown({base:markdownLanguage,codeLanguages:languages,extensions:[GFM,Highlight]}),syntaxHighlighting(colours),bracketMatching(),indentOnInput(),highlightSelectionMatches(),
  EditorView.editorAttributes.of(view=>({class:view.state.field(focusField)?'cm-focus-on':''})),
  // ⌘U underlines like the toolbar, so CodeMirror's undo-selection binding is dropped.
  keymap.of([...(blocks?[{key:'Alt-Shift-ArrowUp',run:()=>{blocks.action('up');return true}},{key:'Alt-Shift-ArrowDown',run:()=>{blocks.action('down');return true}},{key:'Mod-/',run:()=>{blocks.action('menu');return true}}]:[]),...([1,-1] as const).map(direction=>({key:direction>0?'Tab':'Shift-Tab',run:(view:EditorView)=>{if(view.composing||view.state.field(composing)||view.state.readOnly)return false;const spec=indentList(view.state,direction);if(!spec)return false;view.dispatch(spec);return true}})),...markdownKeymap,...historyKeymap.filter(binding=>binding.key!=='Mod-u'),...searchKeymap,...defaultKeymap,indentWithTab]),
  mode.of(doc.position.source?[]:richExtensions(resolve)),EditorView.lineWrapping,editorLocale.of(localizedEditor()),
  EditorView.updateListener.of(u=>{if(u.docChanged||u.selectionSet)onChange(u.docChanged)}),
  EditorView.domEventHandlers({
   compositionstart:(_e,v)=>{v.dispatch({effects:setComposing.of(true)});onCompose(true);return false},
   compositionend:(_e,v)=>{setTimeout(()=>{if(v.dom.isConnected){v.dispatch({effects:setComposing.of(false)});onCompose(false)}},0);return false},
   click:(event)=>{const a=(event.target as HTMLElement).closest<HTMLElement>('[data-href]');if(a&&(event.metaKey||event.ctrlKey)&&(safeLink(a.dataset.href||'')||localDocumentLink(a.dataset.href||''))){event.preventDefault();onLink(a.dataset.href!);return true}return false},
   paste:(event,view)=>{
    if(view.state.readOnly)return false;
    const clipboard=event.clipboardData,files=Array.from(clipboard?.files||[]).filter(f=>f.type.startsWith('image/'));
    if(files.length){event.preventDefault();onImage(files);return true}
    const html=clipboard?.getData('text/html');if(!html)return false;
    try{
     const result=htmlToMarkdown(html,clipboard?.getData('text/plain')||'');
     event.preventDefault();view.dispatch(pasteText(view.state,result.markdown));
     void (async()=>{for(const image of result.images){
      let text:string;try{text=await onPasteImage(image)}catch(error){text=image.alt;onPasteError(error)}
      if(!view.dom.isConnected)break;
      const from=view.state.doc.toString().indexOf(image.placeholder);if(from<0)continue;
      view.dispatch(replacePasteImage(view.state,image.placeholder,text));
     }})();return true;
    }catch(error){onPasteError(error);return false}
   },
   drop:(event,view)=>{
    const files=Array.from(event.dataTransfer?.files||[]),documents=files.filter(f=>/\.(md|markdown|mdown|mkd|txt)$/i.test(f.name));
    if(documents.length){event.preventDefault();onOpenFiles(documents);return true}
    const images=files.filter(f=>f.type.startsWith('image/'));if(images.length){event.preventDefault();onImage(images,view.posAtCoords({x:event.clientX,y:event.clientY})??undefined);return true}return false;
   }})
 ]});return new EditorView({state,parent});
}
export {undo,redo,openSearchPanel,closeSearchPanel,EditorState,EditorView};
