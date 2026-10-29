import {Text as DocumentText} from '@codemirror/state';
import {SearchQuery} from '@codemirror/search';
import {findMatches,type FindMatch} from './find-query';

type Point={node:Text;offset:number;block:Element};
type Segment={from:number;to:number;start:Point;end:Point};
type ReaderMatch=FindMatch&{first:Segment;last:Segment};
const blocks=new Set('P H1 H2 H3 H4 H5 H6 LI PRE TD TH SUMMARY DIV BLOCKQUOTE SECTION UL OL TABLE TR DETAILS BR'.split(' '));
const excluded='.md-front-matter,.md-math,.rendered-mermaid,.footnote-backref,[aria-hidden=true],svg,math,script,style';

// Offsets stay in UTF-16, as in DOM Range and CodeMirror. Inline formatting adds
// no separators; block boundaries do, so phrases can span emphasis and links.
function readerText(host:HTMLElement){
 let text='',space:Segment|undefined;const segments:Segment[]=[];
 const boundary=()=>{space=undefined;if(text&&!text.endsWith('\n'))text+='\n'};
 const append=(value:string,start:Point,end:Point)=>{
  segments.push({from:text.length,to:text.length+value.length,start,end});text+=value;
 };
 const flush=()=>{if(space){segments.push(space);text+=' ';space=undefined}};
 const visit=(node:Node,block:Element,preserve=false)=>{
  if(node instanceof Text){
   if(preserve){
    if(node.length){flush();append(node.data,{node,offset:0,block},{node,offset:node.length,block})}
   }else for(const part of node.data.matchAll(/[ \t\n\r\f]+|[^ \t\n\r\f]+/g)){
    const value=part[0],start={node,offset:part.index,block},end={node,offset:part.index+value.length,block};
    if(/^[ \t\n\r\f]/.test(value)){
     // A collapsed space may span several inline nodes. Defer it so block-edge
     // whitespace is omitted, and retain both ends of the complete DOM run.
     if(space)space.end=end;
     else if(text&&!text.endsWith('\n'))space={from:text.length,to:text.length+1,start,end};
    }else {flush();append(value,start,end)}
   }
   return;
  }
  if(!(node instanceof HTMLElement)||node.matches(excluded)||node.hidden||node.style.display==='none')return;
  const separate=blocks.has(node.tagName);
  if(separate)boundary();
  preserve ||= node.tagName==='PRE'||node.tagName==='CODE'||['pre','pre-wrap','break-spaces'].includes(getComputedStyle(node).whiteSpace);
  const children=node instanceof HTMLDetailsElement&&!node.open?Array.from(node.children).filter(el=>el.tagName==='SUMMARY'):Array.from(node.childNodes);
  for(const child of children)visit(child,separate?node:block,preserve);
  if(separate)boundary();
 };
 visit(host,host);
 return {document:DocumentText.of(text.split('\n')),segments};
}

export function createReaderFind(host:HTMLElement,scroll:HTMLElement,onChange:()=>void){
 const overlay=document.createElement('div');overlay.className='reader-find-highlights';overlay.setAttribute('aria-hidden','true');scroll.append(overlay);
 let query=new SearchQuery({search:''}),active=false,index=-1,frame=0,rebuildPending=false,selectPending=false;
 let source:ReturnType<typeof readerText>|undefined;
 let matches:ReaderMatch[]=[],limited=false;
 const rebuild=()=>{
  source ??= readerText(host);const result=findMatches(query,source.document);limited=result.limited;
  let first=0,last=0;matches=[];
  for(const match of result.matches){
   while(first<source.segments.length&&source.segments[first].to<=match.from)first++;
   last=Math.max(first,last);
   while(last<source.segments.length&&source.segments[last].to<match.to)last++;
   const a=source.segments[first],b=source.segments[last];
   if(a&&b&&a.from<=match.from&&b.from<match.to)matches.push({...match,first:a,last:b});
  }
  index=matches.length?Math.min(Math.max(index,0),matches.length-1):-1;
 };
 const range=(match:ReaderMatch)=>{
  const r=document.createRange(),start=match.first.start,end=match.last.end;
  r.setStart(start.node,start.offset+match.from-match.first.from);r.setEnd(end.node,end.offset-(match.last.to-match.to));return r;
 };
 const reveal=()=>{
  const match=matches[index];if(!match)return;
  const rect=range(match).getBoundingClientRect(),viewport=scroll.getBoundingClientRect();
  if(rect.top<viewport.top+24||rect.bottom>viewport.bottom-24)scroll.scrollTop+=rect.top-viewport.top-scroll.clientHeight*.35;
 };
 const paint=()=>{
  overlay.replaceChildren();
  if(!active)return;
  const viewport=scroll.getBoundingClientRect(),fragment=document.createDocumentFragment(),boxes=new Map<Element,DOMRect>();
  const box=(el:Element)=>{let rect=boxes.get(el);if(!rect){rect=el.getBoundingClientRect();boxes.set(el,rect)}return rect};
  for(const [i,match] of matches.entries()){
   if(box(match.last.end.block).bottom<viewport.top||box(match.first.start.block).top>viewport.bottom)continue;
   // Ranges spanning inline elements may include both their box and the same
   // text box. Merge overlapping rectangles to keep the highlight even.
   const rects=Array.from(range(match).getClientRects()).filter(r=>r.width).sort((a,b)=>a.top-b.top||a.left-b.left);
   const merged:{left:number;right:number;top:number;bottom:number;width:number;height:number}[]=[];
   for(const r of rects){
    const previous=merged[merged.length-1];
    if(previous&&Math.abs(previous.top-r.top)<1&&Math.abs(previous.height-r.height)<1&&r.left<=previous.right+1){previous.right=Math.max(previous.right,r.right);previous.width=previous.right-previous.left}
    else merged.push({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
   }
   for(const rect of merged){
    if(!rect.width||rect.bottom<viewport.top||rect.top>viewport.bottom)continue;
    const mark=document.createElement('span');mark.className='reader-find-match'+(i===index?' reader-find-current':'');
    mark.style.cssText=`left:${rect.left-viewport.left+scroll.scrollLeft}px;top:${rect.top-viewport.top+scroll.scrollTop}px;width:${rect.width}px;height:${rect.height}px`;
    fragment.append(mark);
   }
  }
  overlay.append(fragment);
 };
 const schedule=(reindex=false,select=false)=>{
  rebuildPending ||= reindex;selectPending ||= select;
  if(frame||!active)return;
  frame=requestAnimationFrame(()=>{
   frame=0;if(!active)return;
   if(rebuildPending){rebuildPending=false;rebuild();onChange()}
   if(selectPending){selectPending=false;reveal()}
   paint();
  });
 };
 const invalidate=()=>{source=undefined;schedule(true)};
 const mutations=new MutationObserver(invalidate);mutations.observe(host,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['open','hidden','style','aria-hidden']});
 const resize=new ResizeObserver(()=>schedule());resize.observe(host);resize.observe(scroll);
 scroll.addEventListener('scroll',()=>schedule(),{passive:true});
 host.addEventListener('toggle',invalidate,true);
 // Capturing scroll also updates rectangles inside horizontally scrolling code.
 host.addEventListener('scroll',()=>schedule(),true);
 return {
  get result(){return {matches,limited,index}},
  set(next:SearchQuery,enabled:boolean,select=false){
   const changed=!query.eq(next)||enabled!==active;query=next;active=enabled;
   if(!active){cancelAnimationFrame(frame);frame=0;overlay.replaceChildren();matches=[];source=undefined;index=-1;return}
   if(changed){index=-1;rebuildPending=true}
   schedule(true,select);
  },
  move(direction:1|-1){
   if(rebuildPending){rebuildPending=false;rebuild()}
   if(matches.length)index=(index+direction+matches.length)%matches.length;
   reveal();paint();onChange();
  },
 };
}
