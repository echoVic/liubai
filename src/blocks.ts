import {EditorState,type TransactionSpec} from '@codemirror/state';
import {syntaxTree,ensureSyntaxTree} from '@codemirror/language';
import {isolateHistory} from '@codemirror/commands';
import type {SyntaxNode} from '@lezer/common';
import {frontMatterRange,blockFormat,setHeading,codeBlock} from './editing';

export interface Block {from:number;to:number;kind:BlockType;depth:number;parent:number|null;children:number[]}
export type BlockType='paragraph'|'heading'|'quote'|'code'|'table'|'rule'|'html'|'listItem';
export type BlockConversion='paragraph'|'h1'|'h2'|'h3'|'bullet'|'ordered'|'task'|'quote'|'code';
type Range={from:number;to:number};
const lists=new WeakMap<Block,string>(),cache=new WeakMap<EditorState,Block[]>(),units=new WeakMap<EditorState,Block[]>();
const kind=(name:string):BlockType|null=>/^ATXHeading|^SetextHeading/.test(name)?'heading':({Paragraph:'paragraph',Blockquote:'quote',FencedCode:'code',CodeBlock:'code',Table:'table',HorizontalRule:'rule',HTMLBlock:'html',CommentBlock:'html',ProcessingInstructionBlock:'html',ListItem:'listItem'} as Record<string,BlockType>)[name]||null;
function collect(state:EditorState,from:number,to:number,full=false):Block[]{
 const tree=full?(ensureSyntaxTree(state,state.doc.length,60_000)||syntaxTree(state)):(ensureSyntaxTree(state,to,50)||syntaxTree(state)),meta=frontMatterRange(state),out:Block[]=[],indices=new Map<number,number>();
 tree.iterate({from,to,enter(ref){
  const n=ref.node;if(n.name==='Document')return;
  if(meta&&n.from<meta.to)return false;
  if(n.name==='BulletList'||n.name==='OrderedList')return;
  const k=kind(n.name);if(!k)return false;
  if(k!=='listItem'&&n.parent?.name!=='Document')return false;
  let ancestor:SyntaxNode|null=n.parent,parent:number|null=null,depth=0;
  if(k==='listItem'){
   for(;ancestor;ancestor=ancestor.parent)if(ancestor.name==='ListItem'){depth++;if(parent===null)parent=indices.get(ancestor.from)??null}else if(ancestor.name==='Blockquote')return false;
  }
  const b:Block={from:state.doc.lineAt(n.from).from,to:state.doc.lineAt(n.to).to,kind:k,depth,parent,children:[]};
  indices.set(n.from,out.length);if(parent!==null)out[parent].children.push(out.length);out.push(b);
  if(k==='listItem'){lists.set(b,n.parent!.from+':'+n.parent!.to);return}
  return false;
 }});return out;
}
export function blocksOf(state:EditorState):Block[]{let blocks=cache.get(state);if(!blocks){blocks=collect(state,0,state.doc.length,true);cache.set(state,blocks)}return blocks}
// Viewport queries never force a full parse or populate the document-wide cache.
export function visibleBlocks(state:EditorState,from:number,to:number){return collect(state,from,to)}
export function blockAt(state:EditorState,pos:number):Block|null{
 if(pos<0||pos>state.doc.length)return null;
 return visibleBlocks(state,state.doc.lineAt(pos).from,state.doc.lineAt(pos).to).filter(b=>b.from<=pos&&b.to>=pos).at(-1)||null;
}
export function sameBlockLevel(a:Block,b:Block){return a.depth===b.depth&&(a.kind==='listItem'||b.kind==='listItem'?a.kind===b.kind&&lists.get(a)===lists.get(b):true)}
function selected(state:EditorState,range:Range){
 const all=blocksOf(state),end=range.to>range.from?range.to-1:range.to;
 const first=all.find(b=>b.from===range.from)||all.filter(b=>b.from<=range.from&&b.to>=range.from).at(-1)||all.find(b=>b.from>=range.from&&b.from<=end);
 if(!first)return [];
 return all.filter(b=>b.depth===first.depth&&b.parent===first.parent&&b.from>=first.from&&b.from<=end);
}
function transaction(state:EditorState,from:number,to:number,insert:string,selection:Range,userEvent:string):TransactionSpec{
 return {changes:{from,to,insert},selection:{anchor:selection.from,head:selection.to},userEvent,annotations:isolateHistory.of('full'),scrollIntoView:true};
}
function siblings(state:EditorState,b:Block){return blocksOf(state).filter(other=>sameBlockLevel(b,other))}
// Top-level blocks in order, each top-level list as one unit: what a paragraph moves past.
function topLevel(state:EditorState):Block[]{
 let peers=units.get(state);if(peers)return peers;peers=[];
 for(const b of blocksOf(state)){
  if(b.depth)continue;
  const key=b.kind==='listItem'?lists.get(b):undefined,last=peers.at(-1);
  if(key&&last&&lists.get(last)===key){last.to=b.to;continue}
  if(key){const unit={...b,children:[]};lists.set(unit,key);peers.push(unit)}else peers.push(b);
 }
 units.set(state,peers);return peers;
}
// Where a dragged block can land: its list siblings, or the top-level units (a list counts as one).
export function dropTargets(state:EditorState,block:Block,from:number,to:number):Block[]{
 return block.kind==='listItem'?visibleBlocks(state,from,to).filter(b=>sameBlockLevel(block,b)):topLevel(state).filter(b=>b.to>=from&&b.from<=to);
}
// List items move among their siblings; anything else moves among top-level units.
function movable(state:EditorState,range:Range):{blocks:Block[];peers:Block[];list:boolean}|null{
 const chosen=selected(state,range);if(!chosen.length)return null;
 if(chosen.every(b=>b.kind==='listItem'&&sameBlockLevel(chosen[0],b)))return {blocks:chosen,peers:siblings(state,chosen[0]),list:true};
 const peers=topLevel(state),from=chosen[0].from,to=chosen.at(-1)!.to;
 return {blocks:peers.filter(b=>b.to>=from&&b.from<=to),peers,list:false};
}
function renumber(text:string,number:number){
 const m=/^(\s*)\d+([.)])(\s+)/.exec(text);if(!m)return text;
 const prefix=m[1]+number+m[2]+m[3],delta=prefix.length-m[0].length;
 return prefix+text.slice(m[0].length).split('\n').map((line,i)=>i&&line.trim()?delta>=0?' '.repeat(delta)+line:line.slice(Math.min(-delta,/^ */.exec(line)![0].length)):line).join('\n');
}
export function moveBlocks(state:EditorState,range:Range,dir:-1|1):TransactionSpec|null{
 const m=movable(state,range);if(!m)return null;
 const target=m.peers[m.peers.indexOf(dir<0?m.blocks[0]:m.blocks.at(-1)!)+dir];
 return target?moveBlocksTo(state,range,target,dir<0?'before':'after'):null;
}
export function moveBlocksTo(state:EditorState,range:Range,target:Block,place:'before'|'after'):TransactionSpec|null{
 const m=movable(state,range);if(!m)return null;
 const {blocks:chosen,peers}=m,first=chosen[0];if(m.list&&!sameBlockLevel(first,target))return null;
 // A target inside a list that is not being reordered stands for that whole list.
 const dest=peers.find(b=>b.from===target.from)||peers.find(b=>b.from<=target.from&&target.to<=b.to);if(!dest||chosen.includes(dest))return null;
 const order=peers.filter(b=>!chosen.includes(b));order.splice(order.indexOf(dest)+(place==='after'?1:0),0,...chosen);
 if(order.every((b,i)=>b===peers[i]))return null;
 let lo=0,hi=peers.length-1;while(order[lo]===peers[lo])lo++;while(order[hi]===peers[hi])hi--;
 const ordered=m.list&&/^\s*\d+[.)]\s/.test(state.sliceDoc(first.from,first.to));
 if(ordered){lo=0;hi=peers.length-1}
 const startNumber=Number(/^\s*(\d+)/.exec(state.sliceDoc(peers[0].from,peers[0].to))?.[1]||1);
 let insert='',selection={from:0,to:0};
 for(let i=lo;i<=hi;i++){
  if(i>lo)insert+=state.sliceDoc(peers[i-1].to,peers[i].from);
  let text=state.sliceDoc(order[i].from,order[i].to);if(ordered)text=renumber(text,startNumber+i);
  if(order[i]===chosen[0])selection.from=peers[lo].from+insert.length;
  insert+=text;if(order[i]===chosen.at(-1))selection.to=peers[lo].from+insert.length;
 }
 return transaction(state,peers[lo].from,peers[hi].to,insert,selection,'move.block');
}
function bodyOf(text:string,b:Block){
 if(b.kind==='heading')return text.replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/,'').replace(/[ \t]+#+[ \t]*$/,'').replace(/\n {0,3}(?:=+|-+)[ \t]*$/,'');
 if(b.kind==='quote')return text.replace(/^ {0,3}>[ \t]?/gm,'');
 if(b.kind==='code'){
  const fence=/^ {0,3}(`{3,}|~{3,})[^\n]*\n/.exec(text);
  if(fence)return text.slice(fence[0].length).replace(new RegExp('\\n {0,3}'+fence[1][0]+'{'+fence[1].length+',}[ \\t]*$'),'');
  return text.replace(/^(?: {4}|\t)/gm,'');
 }
 if(b.kind==='listItem')return text.replace(/^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\][ \t]*)?/,'$1');
 return text;
}
function format(text:string,to:BlockConversion,number:number){
 if(to==='paragraph')return text;
 if(to==='quote')return text.split('\n').map(l=>'> '+l).join('\n');
 const s=EditorState.create({doc:text,selection:{anchor:0,head:text.length}});
 if(to==='code'){
  const spec=codeBlock(s),result=s.update(spec).state.doc.toString();return result.endsWith('\n')?result.slice(0,-1):result;
 }
 if(/^h[123]$/.test(to))return s.update(setHeading(s,Number(to[1]),true)).state.doc.toString();
 let result=s.update(blockFormat(s,to as 'bullet'|'ordered'|'task'|'quote',true)).state.doc.toString();
 if(to==='ordered')result=result.replace(/^(\s*)\d+\./,(_,indent)=>indent+number+'.');return result;
}
export function convertBlocks(state:EditorState,range:Range,to:BlockConversion):TransactionSpec{
 const chosen=selected(state,range);if(!chosen.length)return {};
 const changes=chosen.map((b,i)=>{
  const raw=state.sliceDoc(b.from,b.to),body=bodyOf(raw,b);
  let insert:string;
  if(b.kind==='listItem'&&['bullet','ordered','task'].includes(to)){
   const line=body.split('\n')[0],rest=raw.slice(raw.indexOf('\n')<0?raw.length:raw.indexOf('\n'));
   insert=format(line,to,i+1);
   const oldPrefix=/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\][ \t]*)?/.exec(raw)?.[0].length||0;
   const newPrefix=/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\][ \t]*)?/.exec(insert)?.[0].length||0,delta=newPrefix-oldPrefix;
   insert+=rest.split('\n').map(l=>l.trim()?delta>=0?' '.repeat(delta)+l:l.slice(Math.min(-delta,/^ */.exec(l)![0].length)):l).join('\n');
  }else{
   const width=b.kind==='listItem'?(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\][ \t]*)?/.exec(raw)?.[0].length||0):0;
   const indent=b.kind==='listItem'?/^ */.exec(raw)![0]:'';
   const plain=width?body.split('\n').map((l,i)=>i?l.slice(Math.min(width,/^ */.exec(l)![0].length)):l.slice(indent.length)).join('\n'):body;
   insert=format(plain,to,i+1).split('\n').map(l=>indent+l).join('\n');
  }
  return {from:b.from,to:b.to,insert};
 });
 const changeSet=state.changes(changes),from=changes[0].from,toPos=changeSet.mapPos(changes.at(-1)!.to,1);
 return {changes:changeSet,selection:{anchor:from,head:toPos},userEvent:'input.format',annotations:isolateHistory.of('full'),scrollIntoView:true};
}
export function duplicateBlocks(state:EditorState,range:Range):TransactionSpec{
 const chosen=selected(state,range);if(!chosen.length)return {};
 const first=chosen[0],last=chosen.at(-1)!,peers=siblings(state,first),i=peers.indexOf(last),before=peers[peers.indexOf(first)-1],after=peers[i+1];
 const separator=after?state.sliceDoc(last.to,after.from):before?state.sliceDoc(before.to,first.from):'';
 const gap=separator&&!separator.trim()?separator:first.kind==='listItem'?'\n':'\n\n';
 const text=state.sliceDoc(first.from,last.to),from=last.to+gap.length;
 return transaction(state,last.to,last.to,gap+text,{from,to:from+text.length},'input.block');
}
export function deleteBlocks(state:EditorState,range:Range):TransactionSpec{
 const chosen=selected(state,range);if(!chosen.length)return {};
 const first=chosen[0],last=chosen.at(-1)!,all=blocksOf(state);
 const peers=all.filter(b=>b.depth===first.depth&&b.parent===first.parent);
 const previous=peers.filter(b=>b.to<first.from).at(-1),following=peers.find(b=>b.from>last.to);
 const before=previous&&!state.sliceDoc(previous.to,first.from).trim()?previous:null,after=following&&!state.sliceDoc(last.to,following.from).trim()?following:null;
 let from=after||!before?first.from:before.to,to=after?after.from:last.to;
 if(!before&&!after&&first.depth>0){if(state.sliceDoc(to,to+1)==='\n')to++;else if(state.sliceDoc(from-1,from)==='\n')from--}
 return transaction(state,from,to,'',{from,to:from},'delete.block');
}

export function insertParagraphBelow(state:EditorState,range:Range):TransactionSpec{
 const chosen=selected(state,range),last=chosen.at(-1);if(!last)return {};
 const from=last.to,tail=state.sliceDoc(from,Math.min(state.doc.length,from+2)),insert='\n\n'+(tail&&tail!=='\n\n'?'\n':'');
 return transaction(state,from,from,insert,{from:from+2,to:from+2},'input.block');
}
