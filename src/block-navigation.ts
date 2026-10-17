import {EditorState,EditorSelection,type TransactionSpec} from '@codemirror/state';
import {syntaxTree,ensureSyntaxTree} from '@codemirror/language';
import {isolateHistory} from '@codemirror/commands';
import type {SyntaxNode} from '@lezer/common';
import {frontMatterRange} from './editing';
import {imageRanges} from './images';

// Blocks the caret can land in when it leaves a table or image.
const leafBlock=/^(?:Paragraph|Task|ATXHeading\d|SetextHeading\d|FencedCode|CodeBlock|HTMLBlock|CommentBlock|ProcessingInstructionBlock|HorizontalRule|LinkReference|Table)$/;
const blank=(text:string)=>!text.trim();
function skipSpace(state:EditorState,pos:number){const end=state.doc.lineAt(pos).to;while(pos<end&&/[ \t]/.test(state.sliceDoc(pos,pos+1)))pos++;return pos}
// The text next to the widget: the end of the block above, or the start of the block below.
function caretIn(state:EditorState,node:SyntaxNode,above:boolean){
 if(node.name==='FencedCode'){const code=node.getChildren('CodeText');return code.length?above?code.at(-1)!.to:code[0].from:state.doc.lineAt(node.from).to}
 if(node.name==='Task'&&!above)return skipSpace(state,node.getChild('TaskMarker')?.to??node.from);
 if(/^ATXHeading/.test(node.name)){
  const marks=node.getChildren('HeaderMark');
  if(!above)return skipSpace(state,marks[0]?.to??node.from);
  if(marks.length>1){let pos=marks.at(-1)!.from;while(pos>marks[0].to&&/[ \t]/.test(state.sliceDoc(pos-1,pos)))pos--;return pos}
 }
 if(/^SetextHeading/.test(node.name)&&above){const mark=node.getChild('HeaderMark');if(mark)return Math.max(node.from,state.doc.lineAt(mark.from).from-1)}
 return above?node.to:node.from;
}
// Null when there is no block to type in: the document edge, front matter, or another table or image.
function neighbour(state:EditorState,range:{from:number;to:number},above:boolean):number|null{
 const doc=state.doc,meta=frontMatterRange(state),step=above?-1:1;
 for(let n=doc.lineAt(above?range.from:range.to).number+step,seen=0;n>=1&&n<=doc.lines&&seen<100;n+=step,seen++){
  const line=doc.line(n);if(blank(line.text))continue;
  const tree=ensureSyntaxTree(state,line.to,50)||syntaxTree(state);
  let node:SyntaxNode|null=tree.resolveInner(line.from+line.text.trimEnd().length,-1);
  while(node&&!leafBlock.test(node.name))node=node.parent;
  if(!node)continue; // A container line without text, such as a bare '>'.
  return (node.name==='Table'||imageRanges(state).some(image=>image.from>=node!.from&&image.to<=node!.to))||(meta&&node.from<meta.to)?null:caretIn(state,node,above);
 }
 return null;
}
// Typing directly beside a widget can join its paragraph, so leaving where no block follows uses (or opens) an empty paragraph with blank lines on both sides.
function opening(state:EditorState,range:{from:number;to:number},above:boolean):{anchor:number;changes?:{from:number;insert:string}}{
 const doc=state.doc,edge=doc.lineAt(above?range.from:range.to),step=above?-1:1,near=edge.number+step,far=near+step;
 const exists=(n:number)=>n>=1&&n<=doc.lines,empty=(n:number)=>!exists(n)||blank(doc.line(n).text);
 if(!exists(near))return {anchor:above?0:edge.to+2,changes:{from:above?0:edge.to,insert:'\n\n'}};
 if(empty(near)&&!exists(far))return above?{anchor:0,changes:{from:0,insert:'\n'}}:{anchor:doc.length+1,changes:{from:doc.length,insert:'\n'}};
 if(empty(near)&&empty(far)&&empty(far+step))return {anchor:doc.line(far).from};
 const insert=empty(near)?'\n\n':'\n\n\n';
 return above?{anchor:edge.from+insert.length-2,changes:{from:edge.from,insert}}:{anchor:edge.to+2,changes:{from:edge.to,insert}};
}
// The nearest text beside a widget, for moving the caret without changing the document.
export function textBeside(state:EditorState,range:{from:number;to:number}):number|null{return neighbour(state,range,false)??neighbour(state,range,true)}
export function leaveBlock(state:EditorState,range:{from:number;to:number},above=false):TransactionSpec{
 const target=neighbour(state,range,above),{anchor,changes}=target===null?opening(state,range,above):{anchor:target,changes:undefined};
 return {changes,selection:EditorSelection.cursor(anchor,above?-1:1),annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:changes?'input.block':'select.block'};
}
