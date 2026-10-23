import {messages,activeLocale} from './i18n';
import { EditorState, Compartment, RangeSetBuilder, StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state';
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
import {ImageWidget,imageSelection,imageSelected} from './image-ui';
import {imageRanges,tableRanges,mathRanges,mermaidRanges,mapImageRanges} from './images';
import type { Doc } from './types';
import {createBlockUI,blockRichMode,type BlockUIOptions} from './block-ui';
import {createSlashMenu} from './slash';
import {Highlight,inlineTagPairs,tagHosts} from './marks';
import {MathSyntax} from './math';
import {MathWidget} from './math-ui';
import {MermaidWidget} from './mermaid-ui';
import {MermaidSyntax} from './mermaid';
import {extraRanges,extraMarkers,createDetailsFolding} from './extras';
import {CalloutWidget,DetailsWidget,FootnoteWidget,detailsExpanded,footnoteInteractions} from './extras-ui';
import {indentList,safeLink,localDocumentLink,frontMatterRange} from './editing';
import {htmlToMarkdown,pasteText,replacePasteImage,type PasteImage} from './paste';
import {keyLabel} from './platform';
// Links open on a click with ⌘ on macOS, Ctrl elsewhere.
const linkModifier=keyLabel('Mod');

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
 {tag:[tags.keyword,tags.bool,tags.null],color:'var(--syntax-keyword)'},
 {tag:[tags.string,tags.regexp],color:'var(--syntax-string)'},
 {tag:[tags.comment,tags.meta],color:'var(--muted-foreground)'},
 {tag:[tags.link,tags.url],color:'var(--link-text,var(--link))'},
 {tag:[tags.number,tags.atom],color:'var(--syntax-keyword)'}
]);
function selectedLines(state:EditorState){
 const lines=state.selection.ranges.map(sel=>({from:state.doc.lineAt(sel.from).from,to:state.doc.lineAt(sel.to).to}));
 return (from:number,to:number)=>lines.some(line=>from<=line.to&&to>=line.from);
}
function destination(state:EditorState,node:SyntaxNode){
 const url=node.getChild('URL');if(!url)return '';
 return state.sliceDoc(url.from,url.to).replace(/^<(.*)>$/s,'$1').replace(/\\([!-/:-@[-`{-~])/g,'$1');
}
export function blockDecorations(state:EditorState,resolve:(dest:string)=>Promise<string>):DecorationSet{
 const decorations:{from:number;to:number;dec:Decoration}[]=[],touched=selectedLines(state),meta=frontMatterRange(state);
 for(const image of imageRanges(state)){
  if(meta&&image.from<meta.to||touched(image.from,image.to)&&!imageSelected(state,image.from))continue;
  decorations.push({...image,dec:Decoration.replace({widget:new ImageWidget(image.raw,image.from,resolve,composing,imageSelected(state,image.from),state.readOnly,image.quotes,image.listEms),block:true})});
 }
 for(const table of tableRanges(state)){
  if(meta&&table.from<meta.to)continue;
  decorations.push({...table,dec:Decoration.replace({widget:new TableWidget(state.sliceDoc(table.from,table.to),table.from,composing,state.readOnly),block:true})});
 }
 for(const formula of mathRanges(state)){
  if(meta&&formula.from<meta.to||touched(formula.from,formula.to))continue;
  decorations.push({...formula,dec:Decoration.replace({widget:new MathWidget(formula.source,true,formula.from,composing),block:true})});
 }
 for(const diagram of mermaidRanges(state)){
  if(meta&&diagram.from<meta.to||touched(diagram.from,diagram.to))continue;
  decorations.push({...diagram,dec:Decoration.replace({widget:new MermaidWidget(diagram.source,diagram.from,composing),block:true})});
 }
 const builder=new RangeSetBuilder<Decoration>();for(const d of decorations.sort((a,b)=>a.from-b.from))builder.add(d.from,d.to,d.dec);return builder.finish();
}
// Ordinary single-line prose edits cannot change image, table, math or Mermaid widgets. Map their ranges rather than rebuilding every widget in a long document.
function proseEdit(tr:Transaction){
 if(!tr.docChanged||tr.reconfigured||tr.startState.field(composing)||tr.startState.readOnly!==tr.state.readOnly||tr.startState.field(imageSelection,false)!==tr.state.field(imageSelection,false)||syntaxTree(tr.startState).length!==tr.startState.doc.length||syntaxTree(tr.state).length!==tr.state.doc.length)return false;
 const paragraph=(state:EditorState,pos:number)=>{let node:SyntaxNode|null=syntaxTree(state).resolveInner(pos,1);while(node&&node.name!=='Paragraph')node=node.parent;return node};
 let safe=true;const paragraphs:SyntaxNode[]=[];
 tr.changes.iterChanges((from,to,nextFrom,nextTo,inserted)=>{
  if(!safe)return;const before=paragraph(tr.startState,from),after=paragraph(tr.state,nextFrom);
  if(inserted.lines>1||tr.startState.sliceDoc(from,to).includes('\n')||!before||!after||before.to<to||after.to<nextTo||tr.changes.mapPos(before.from,-1)!==after.from||tr.changes.mapPos(before.to,1)!==after.to||before.getChild('Image')||before.getChild('HTMLTag')||after.getChild('Image')||after.getChild('HTMLTag'))safe=false;
  else paragraphs.push(after);
 });
 return safe&&tr.state.selection.ranges.every(sel=>sel.empty&&paragraphs.some(node=>node.from<=sel.head&&sel.head<=node.to));
}
export function createBlockField(resolve:(dest:string)=>Promise<string>):StateField<DecorationSet>{
 return StateField.define<DecorationSet>({
  create:state=>blockDecorations(state,resolve),
  update(value,tr){
   if(tr.state.field(composing))return value.map(tr.changes);
   if(proseEdit(tr)&&mapImageRanges(tr.startState,tr.state,tr.changes))return blockDecorations(tr.state,resolve);
   if(!tr.docChanged&&!tr.selection&&tr.startState.field(imageSelection,false)===tr.state.field(imageSelection,false)&&tr.startState.readOnly===tr.state.readOnly&&!tr.startState.field(composing)&&syntaxTree(tr.startState)===syntaxTree(tr.state))return value;
   return blockDecorations(tr.state,resolve);
  },
  provide:field=>EditorView.decorations.from(field)
 });
}
export function inlineDecorations(state:EditorState,ranges:readonly {from:number;to:number}[]):DecorationSet{
 const decorations:{from:number;to:number;dec:Decoration}[]=[],touched=selectedLines(state),marked=new Set<string>(),meta=frontMatterRange(state),images=imageRanges(state).filter(i=>ranges.some(range=>i.from<=range.to&&i.to>=range.from)&&(!touched(i.from,i.to)||imageSelected(state,i.from)));
 const diagrams=mermaidRanges(state).filter(d=>!touched(d.from,d.to));
 const tables=tableRanges(state);
 const extras=extraRanges(state),numbers=new Map<string,number>();
 for(const ref of extras.references)if(extras.definitions.has(ref.label)&&!numbers.has(ref.label))numbers.set(ref.label,numbers.size+1);
 const active=(from:number,to:number)=>state.selection.ranges.some(sel=>sel.from<=to&&sel.to>=from);
 for(const range of ranges){
  const lineClass=(from:number,to:number,cls:string)=>{
   const first=state.doc.lineAt(Math.max(from,range.from)).number,last=state.doc.lineAt(Math.min(to,range.to)).number;
   for(let i=first;i<=last;i++){const line=state.doc.line(i),key=line.from+cls;if(!marked.has(key)){marked.add(key);decorations.push({from:line.from,to:line.from,dec:Decoration.line({class:cls})})}}
  };
  for(const callout of extras.callouts){
   if(callout.from>range.to||callout.to<range.from)continue;
   lineClass(callout.from,callout.to,'md-callout markdown-alert-'+callout.kind);
   const key=callout.markerFrom+':callout';
   if(callout.markerFrom>=range.from&&callout.markerTo<=range.to&&!touched(callout.markerFrom,callout.markerTo)&&!marked.has(key)){marked.add(key);decorations.push({from:callout.markerFrom,to:callout.markerTo,dec:Decoration.replace({widget:new CalloutWidget(callout.kind)})})}
  }
  for(const detail of extras.details)if(detail.summary>=range.from&&detail.summary<=range.to&&!marked.has(detail.summary+':details')){
   marked.add(detail.summary+':details');decorations.push({from:detail.summary,to:detail.summary,dec:Decoration.widget({widget:new DetailsWidget(detail,detailsExpanded(state,detail),composing),side:-1})});
  }
  for(const definition of extras.definitions.values())if(definition.from<=range.to&&definition.to>=range.from)lineClass(definition.from,definition.to,'md-footnote-definition');
  for(const ref of extras.references){
   const key=ref.from+':footnote';if(ref.from<range.from||ref.to>range.to||!numbers.has(ref.label)||active(ref.from,ref.to)||tables.some(t=>ref.from>=t.from&&ref.to<=t.to)||marked.has(key))continue;
   marked.add(key);decorations.push({from:ref.from,to:ref.to,dec:Decoration.replace({widget:new FootnoteWidget(ref.label,numbers.get(ref.label)!,ref.from)})});
  }
  if(meta&&range.from<=meta.to)lineClass(meta.from,meta.to,'md-front-matter');
  // Only visible replacements can own syntax nodes. Index their intervals instead of
  // searching every footnote in a long document for each visible node.
  const hidden=decorations.filter(d=>d.dec.spec.widget instanceof FootnoteWidget||d.dec.spec.widget instanceof CalloutWidget).sort((a,b)=>a.from-b.from);
  const hiddenNode=(from:number,to:number)=>{
   let lo=0,hi=hidden.length;while(lo<hi){const mid=(lo+hi)>>>1;if(hidden[mid].from<=from)lo=mid+1;else hi=mid}
   const owner=hidden[lo-1];return owner&&from>=owner.from&&to<=owner.to;
  };
  syntaxTree(state).iterate({from:range.from,to:range.to,enter:n=>{
   if(meta&&n.from<meta.to&&n.name!=='Document')return false;
   if(n.to<=range.from||n.from>=range.to)return false;
   const name=n.name;
   if(hiddenNode(n.from,n.to))return false;
   if(images.some(image=>n.from>=image.from&&n.to<=image.to))return false;
   if(tagHosts.test(name))for(const pair of inlineTagPairs(n.node,(a,b)=>state.sliceDoc(a,b))){
    const key=pair.from+':tag';if(marked.has(key))continue;marked.add(key);
    if(pair.closeFrom>pair.openTo)decorations.push({from:pair.openTo,to:pair.closeFrom,dec:Decoration.mark({class:pair.tag==='u'?'md-underline':'md-'+pair.tag})});
    if(!active(pair.from,pair.to))for(const [from,to] of [[pair.from,pair.openTo],[pair.closeFrom,pair.to]])decorations.push({from,to,dec:Decoration.replace({})});
   }
   if(name==='MathBlock'||name==='MathFence'||diagrams.some(d=>n.from>=d.from&&n.to<=d.to))return false;
   if(name==='InlineMath'){
    if(!touched(n.from,n.to)&&!marked.has(n.from+':math')){marked.add(n.from+':math');decorations.push({from:n.from,to:n.to,dec:Decoration.replace({widget:new MathWidget(state.sliceDoc(n.from+1,n.to-1),false,n.from,composing)})})}
    return false;
   }
   if(name==='Highlight'){
    const marks=n.node.getChildren('HighlightMark');if(marks.length===2)decorations.push({from:marks[0].to,to:marks[1].from,dec:Decoration.mark({class:'md-highlight'})});
    if(!active(n.from,n.to))for(const mark of marks)decorations.push({from:mark.from,to:mark.to,dec:Decoration.replace({})});
   }
   if(name==='Table')return false;
   if(/^ATXHeading[1-6]$/.test(name))lineClass(n.from,n.from,'md-heading md-h'+name.slice(-1));
   if(name==='Blockquote')lineClass(n.from,n.to,'md-quote');
   if(name==='FencedCode'||name==='MermaidFence')lineClass(n.from,n.to,'md-code-line');
   const add=(dec:Decoration)=>{const key=n.from+':'+n.to+':'+name;if(!marked.has(key)){marked.add(key);decorations.push({from:n.from,to:n.to,dec})}};
   if(name==='Link')add(Decoration.mark({class:'md-link',attributes:{'data-href':destination(state,n.node),title:messages.fCtrlClickToOpenTheLink(linkModifier)}}));
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
   if(update.docChanged||update.viewportChanged||update.selectionSet||update.startState.field(imageSelection,false)!==update.state.field(imageSelection,false)||update.startState.field(composing)||update.transactions.some(tr=>tr.effects.length)||syntaxTree(update.startState)!==syntaxTree(update.state))this.decorations=inlineDecorations(update.state,update.view.visibleRanges);
  }
 },{decorations:plugin=>plugin.decorations});
 return [blockRichMode.of(true),imageSelection,extraMarkers,createDetailsFolding(composing),footnoteInteractions(composing),createBlockField(resolve),inlinePlugin];
}
export function createEditor(parent:HTMLElement,doc:Doc,resolve:(dest:string)=>Promise<string>,onChange:(content:boolean)=>void,onImage:(files:File[],position?:number)=>void,onCompose:(active:boolean)=>void,onLink:(url:string)=>void,onOpenFiles:(files:File[])=>void,onPasteImage:(image:PasteImage)=>Promise<string>,onPasteError:(error:unknown)=>void,blocks?:BlockUIOptions){
 const state=EditorState.create({doc:doc.content,selection:{anchor:Math.min(doc.position.anchor||0,doc.content.length),head:Math.min(doc.position.head||0,doc.content.length)},extensions:[
  tableComposition.of((view,active,commit)=>{view.dispatch({effects:setComposing.of(active)});commit?.();onCompose(active)}),
  history(),composing,focusField,focusDecorations,createSlashMenu(composing,focusField,()=>blocks?.action('image')),blocks?createBlockUI(composing,focusField,blocks):[],markdown({base:markdownLanguage,codeLanguages:languages,extensions:[GFM,Highlight,MathSyntax,MermaidSyntax]}),syntaxHighlighting(colours),bracketMatching(),indentOnInput(),highlightSelectionMatches(),
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
