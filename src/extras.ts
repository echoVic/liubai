import {EditorState,StateField,type ChangeDesc,type Text,type TransactionSpec} from '@codemirror/state';
import {Decoration,EditorView,type DecorationSet} from '@codemirror/view';
import {isolateHistory} from '@codemirror/commands';
import {syntaxTree,codeFolding,foldedRanges,unfoldEffect,foldService} from '@codemirror/language';
import type {Tree,SyntaxNode} from '@lezer/common';
import {frontMatterRange} from './editing';

export type CalloutKind='note'|'tip'|'important'|'warning'|'caution';
export interface CalloutRange {from:number;to:number;markerFrom:number;markerTo:number;kind:CalloutKind}
export interface DetailsRange {from:number;to:number;summary:number;start:number}
export interface FootnoteRange {from:number;to:number;label:string}
export interface FootnoteDefinition extends FootnoteRange {textFrom:number;text:string}
interface Extras {callouts:CalloutRange[];details:DetailsRange[];references:FootnoteRange[];definitions:Map<string,FootnoteDefinition>;labels:Set<string>}
// Keyed by the text, which a caret move keeps along with the tree.
const cache=new WeakMap<Text,{tree:Tree;ranges:Extras}>();
const markers=/\[!|\[\^|<details/i;
// Whether the document may contain a callout, footnote or details marker, kept per change instead of rescanning every keystroke.
// Markers are at most 8 characters, so a margin around each change sees any marker it created; deleting one triggers a rescan.
export const extraMarkers=StateField.define<boolean>({
 create:state=>markers.test(state.doc.toString()),
 update(value,tr){
  if(!tr.docChanged)return value;
  let created=false,removed=false;
  tr.changes.iterChanges((fromA,toA,fromB,toB)=>{
   if(value&&!removed)removed=markers.test(tr.startState.sliceDoc(Math.max(0,fromA-8),Math.min(tr.startState.doc.length,toA+8)));
   if(!created)created=markers.test(tr.state.sliceDoc(Math.max(0,fromB-8),Math.min(tr.state.doc.length,toB+8)));
  });
  return created||(value&&(!removed||markers.test(tr.state.doc.toString())));
 }
});
// Code, math, diagrams, HTML and link targets never hold footnotes.
const literal=/^(FencedCode|CodeBlock|InlineCode|MathBlock|MathFence|InlineMath|MermaidFence|Escape|Image|Autolink|URL|HTMLBlock|CommentBlock|ProcessingInstructionBlock)$/;
const containers=/^(Document|BulletList|OrderedList|ListItem|Blockquote)$/;
export function extraRanges(state:EditorState):Extras{
 const tree=syntaxTree(state),cached=cache.get(state.doc);if(cached?.tree===tree)return cached.ranges;
 const result:Extras={callouts:[],details:[],references:[],definitions:new Map(),labels:new Set()};
 const present=state.field(extraMarkers,false);
 if(present===undefined?markers.test(state.doc.toString()):present){
  const text=state.doc.toString(),html:{from:number;to:number;scope:string}[]=[],meta=frontMatterRange(state);
  // Block level only: callouts are quotes and details are HTML blocks, so inline nodes are never visited.
  tree.iterate({enter:n=>{
   if(meta&&n.from<meta.to&&n.name!=='Document')return false;
   if(n.name==='HTMLBlock'){
    let scope='';for(let p=n.node.parent;p&&p.name!=='Document';p=p.parent)scope+=p.name+':'+p.from+'/';
    html.push({from:n.from,to:n.to,scope});return false;
   }
   if(n.name==='Blockquote'){
    const paragraph=n.node.getChild('Paragraph');
    if(paragraph&&paragraph.from===n.node.firstChild?.nextSibling?.from){
     const line=state.doc.lineAt(paragraph.from),match=/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?=[ \t]|$)/i.exec(state.sliceDoc(paragraph.from,line.to));
     if(match)result.callouts.push({from:n.from,to:n.to,markerFrom:paragraph.from,markerTo:paragraph.from+match[0].length,kind:match[1].toLowerCase() as CalloutKind});
    }
   }
   return containers.test(n.name);
  }});
  const blocked=(from:number)=>{
   if(meta&&from<meta.to)return true;
   for(let node:SyntaxNode|null=tree.resolveInner(from,1);node;node=node.parent)if(literal.test(node.name))return true;
   return false;
  };
  // Only HTML block lines can introduce details; raw tags inside code or prose cannot fold.
  const stacks=new Map<string,{start:number;summary?:number;from?:number}[]>();
  for(const block of html){
   const stack=stacks.get(block.scope)||[];stacks.set(block.scope,stack);
   for(let i=state.doc.lineAt(block.from).number,last=state.doc.lineAt(block.to).number;i<=last;i++){
    const line=state.doc.line(i),body=state.sliceDoc(Math.max(line.from,block.from),line.to).replace(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/,'');
    if(/^<details(?:\s+[^<>]*)?>\s*$/i.test(body))stack.push({start:line.from});
    else if(/^<summary(?:\s+[^<>]*)?>.*<\/summary>\s*$/i.test(body)&&stack.length){const item=stack.at(-1)!;if(item.summary===undefined){item.summary=line.from;item.from=line.to}}
    else if(/^<\/details>\s*$/i.test(body)&&stack.length){const item=stack.pop()!;if(item.from!==undefined)result.details.push({start:item.start,summary:item.summary!,from:item.from,to:line.to})}
   }
  }
  for(const match of text.matchAll(/\[\^([^\s\[\]]+)\]/g)){
   const from=match.index!,to=from+match[0].length;if(blocked(from))continue;
   const label=match[1];result.labels.add(label);
   const line=state.doc.lineAt(from),prefix=state.sliceDoc(line.from,from);
   if(text[to]===':'&&/^(?:[ \t]*>[ \t]?)*[ \t]{0,3}(?:(?:[-+*]|\d+[.)])[ \t]+)?$/.test(prefix)){
    const textFrom=to+1+/^[ \t]*/.exec(state.sliceDoc(to+1,line.to))![0].length;let end=line.to,body=state.sliceDoc(textFrom,end),blanks=0;
    for(let i=line.number+1;i<=state.doc.lines;i++){
     const next=state.doc.line(i);if(!next.text.trim()){blanks++;continue}if(!/^(?: {4}|\t)/.test(next.text))break;
     body+='\n'.repeat(blanks+1)+next.text.replace(/^(?: {4}|\t)/,'');blanks=0;end=next.to;
    }
    result.definitions.set(label,{from,to:end,label,textFrom,text:body});
   }else result.references.push({from,to,label});
  }
 }
 result.details.sort((a,b)=>a.from-b.from);cache.set(state.doc,{tree,ranges:result});return result;
}
// A line with any of these can hold, open or close a callout, details block, footnote, code or math; indentation can
// continue a footnote or make code.
const unsafeLine=/[\[\]<>`$~\\]|^[ \t]/;
// For an edit inside one paragraph (see proseEdit in editor.ts) on lines without such characters, outside front matter:
// it cannot add, remove or change a callout, details block or footnote, only shift them. (Footnote definitions only span
// lines with "[" or indentation, and blank lines.) Map the ranges collected for the previous text instead of scanning
// the whole document again.
export function mapExtraRanges(before:EditorState,after:EditorState,changes:ChangeDesc){
 const cached=cache.get(before.doc);if(!cached||cached.tree!==syntaxTree(before))return false;
 const {ranges}=cached,metaBefore=frontMatterRange(before),metaAfter=frontMatterRange(after);let safe=true;
 changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
  const a=before.doc.lineAt(fromA),b=after.doc.lineAt(fromB);
  if(a.to<toA||b.to<toB||unsafeLine.test(a.text)||unsafeLine.test(b.text)||metaBefore&&fromA<=metaBefore.to||metaAfter&&fromB<=metaAfter.to)safe=false;
 });
 if(!safe)return false;
 const map=(pos:number,assoc:-1|1)=>changes.mapPos(pos,assoc),definitions=new Map<string,FootnoteDefinition>();
 for(const [label,d] of ranges.definitions)definitions.set(label,{...d,from:map(d.from,-1),to:map(d.to,1),textFrom:map(d.textFrom,-1)});
 cache.set(after.doc,{tree:syntaxTree(after),ranges:{
  callouts:ranges.callouts.map(c=>({...c,from:map(c.from,-1),to:map(c.to,1),markerFrom:map(c.markerFrom,-1),markerTo:map(c.markerTo,1)})),
  details:ranges.details.map(d=>({...d,from:map(d.from,-1),to:map(d.to,1),summary:map(d.summary,-1),start:map(d.start,-1)})),
  references:ranges.references.map(r=>({...r,from:map(r.from,-1),to:map(r.to,1)})),
  definitions,labels:ranges.labels,
 }});
 return true;
}
export function insertFootnote(state:EditorState,reference?:(ref:string)=>TransactionSpec):TransactionSpec{
 let n=1;const labels=extraRanges(state).labels;while(labels.has(String(n)))n++;
 const ref='[^'+n+']',first=state.update(reference?reference(ref):state.replaceSelection(ref)),body=first.state.doc.toString(),separator=body.endsWith('\n\n')?'':body.endsWith('\n')?'\n':'\n\n';
 const last=first.state.update({changes:{from:body.length,insert:separator+ref+': '}});
 return {changes:first.changes.compose(last.changes),selection:{anchor:last.state.doc.length},userEvent:'input.footnote',annotations:isolateHistory.of('full'),scrollIntoView:true};
}
export function createDetailsFolding(composing:StateField<boolean>){
 const openings=(state:EditorState)=>{
  const folds=foldedRanges(state);if(!folds.size)return Decoration.none;
  const details=extraRanges(state).details,ranges:ReturnType<Decoration['range']>[]=[];
  folds.between(0,state.doc.length,(from,to)=>{const block=details.find(r=>r.from===from&&r.to===to);if(block&&block.start<block.summary)ranges.push(Decoration.replace({}).range(block.start,block.summary))});
  return Decoration.set(ranges,true);
 };
 const openingField=StateField.define<DecorationSet>({create:openings,update:(value,tr)=>tr.state.field(composing)?value.map(tr.changes):openings(tr.state),provide:field=>EditorView.decorations.from(field)});
 return [codeFolding(),openingField,foldService.of((state,from)=>{const range=extraRanges(state).details.find(r=>r.summary===from);return range?{from:range.from,to:range.to}:null}),EditorState.transactionExtender.of(tr=>{
  if(tr.state.field(composing))return null;
  const ranges=foldedRanges(tr.state);if(!ranges.size)return null;
  const valid=extraRanges(tr.state).details,effects:ReturnType<typeof unfoldEffect.of>[]=[];
  ranges.between(0,tr.state.doc.length,(from,to)=>{
   if(!valid.some(r=>r.from===from&&r.to===to)||tr.selection&&tr.state.selection.ranges.some(s=>s.from<to&&s.to>from))effects.push(unfoldEffect.of({from,to}));
  });return effects.length?{effects}:null;
 })];
}
