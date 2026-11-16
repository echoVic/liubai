import {EditorState} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import type {SyntaxNode} from '@lezer/common';
import {Highlight} from './marks';
import {MathSyntax} from './math';
import {WikiSyntax} from './wiki-links';
import {linkTarget} from './editing';
import {unescapeAll} from 'markdown-it/lib/common/utils.mjs';

// The rendered caret counts visible UTF-16 units. Keep each unit's original source range,
// so hidden emphasis/link marks and decoded entities do not move the insertion point.
export function cellSourceOffset(source:string,offset:number,side:number,definitions=''):number{
 const prefix='| ',doc=prefix+source+' |\n| --- |\n\n'+definitions;
 const state=EditorState.create({doc,extensions:markdown({base:markdownLanguage,extensions:[GFM,Highlight,MathSyntax,WikiSyntax]})});
 const cell=syntaxTree(state).topNode.getChild('Table')?.getChild('TableHeader')?.getChild('TableCell');
 if(!cell)return Math.min(offset,source.length);
 const ranges:{from:number;to:number}[]=[];
 const append=(from:number,to:number,text?:string)=>{
  if(text!==undefined){for(let i=0;i<text.length;i++)ranges.push({from:from-prefix.length,to:to-prefix.length})}
  else for(let i=from;i<to;i++){
   if(state.sliceDoc(i,i+2)==='\\|')i++;
   ranges.push({from:i-prefix.length,to:i+1-prefix.length});
  }
 };
 function visit(node:SyntaxNode){
  if(node.name==='InlineMath'||node.name==='Image'){append(node.from,node.to,'\ufffc');return}
  if(node.name==='Entity'||node.name==='Escape'){append(node.from,node.to,unescapeAll(state.sliceDoc(node.from,node.to)));return}
  if(node.name==='InlineCode'){
   const marks=node.getChildren('CodeMark');let from=marks[0].to,to=marks.at(-1)!.from;
   if(state.sliceDoc(from,to).startsWith(' ')&&state.sliceDoc(from,to).endsWith(' ')&&/\S/.test(state.sliceDoc(from,to))){from++;to--}
   append(from,to);return;
  }
  if(node.name==='HTMLTag'){
   const tag=state.sliceDoc(node.from,node.to);
   if(/^<br\b/i.test(tag))append(node.from,node.to,'\n');
   else if(/^<img\b/i.test(tag))append(node.from,node.to,'\ufffc');
   return;
  }
  if(node.name==='Link'&&linkTarget(state,node)===null){append(node.from,node.to);return}
  if(/^(EmphasisMark|StrikethroughMark|HighlightMark|WikiMark|LinkMark|LinkLabel|LinkTitle|Comment|ProcessingInstruction)$/.test(node.name)||node.name==='URL'&&node.parent?.name==='Link')return;
  let at=node.from;
  for(let child=node.firstChild;child;child=child.nextSibling){append(at,child.from);visit(child);at=child.to}
  append(at,node.to);
 }
 visit(cell);
 offset=Math.max(0,Math.min(offset,ranges.length));
 return side>0&&offset<ranges.length?ranges[offset].from:offset?ranges[offset-1].to:ranges[0]?.from??0;
}

const atomic=(node:Node)=>node.nodeType===1&&(node as Element).matches('img,.math-inline,.math-display');
function visibleLength(node:Node):number{
 if(atomic(node)||node.nodeName==='BR')return 1;
 if(node.nodeType===Node.TEXT_NODE)return node.textContent?.length||0;
 return [...node.childNodes].reduce((length,child)=>length+visibleLength(child),0);
}
export function renderedCellOffset(cell:HTMLElement,x:number,y:number):{offset:number;side:number}|null{
 const doc=cell.ownerDocument,caret=doc.caretPositionFromPoint?.(x,y),range=caret?null:doc.caretRangeFromPoint?.(x,y);
 const target=caret?.offsetNode||range?.startContainer,offset=caret?.offset??range?.startOffset;
 if(!target||offset===undefined||!cell.contains(target))return null;
 let total=0,result:{offset:number;side:number}|null=null;
 function visit(node:Node):boolean{
  if(atomic(node)&&node.contains(target!)){
   const rect=(node as Element).getBoundingClientRect(),after=x>rect.left+rect.width/2;
   result={offset:total+(after?1:0),side:after?-1:1};return true;
  }
  if(node===target){
   const length=node.nodeType===Node.TEXT_NODE?offset!:[...node.childNodes].slice(0,offset).reduce((sum,child)=>sum+visibleLength(child),0);
   result={offset:total+length,side:offset===0?1:-1};return true;
  }
  if(atomic(node)||node.nodeName==='BR'||node.nodeType===Node.TEXT_NODE){total+=visibleLength(node);return false}
  return [...node.childNodes].some(visit);
 }
 visit(cell);return result;
}
