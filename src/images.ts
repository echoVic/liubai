import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import {EditorState,type ChangeDesc,type TransactionSpec} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';
import {syntaxTree} from '@codemirror/language';
import type {Tree} from '@lezer/common';
import {blockAt,deleteBlocks} from './blocks';

export interface ImageModel {src:string;alt:string;title?:string;width?:number;height?:number;align:'left'|'center'|'right'}
export type ImageAction='resize'|'left'|'center'|'right'|'original'|'alt'|'delete';
export interface ImageRange {from:number;to:number;raw:string;image:ImageModel;quotes:number;listEms:number}
const parser=new MarkdownIt(),decode=parser.utils.unescapeAll;
const escapeHTML=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escapeMarkdown=(s:string)=>s.replace(/\\/g,'\\\\').replace(/[\[\]*_`!~]/g,'\\$&').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\r\n]/g,' ');
export function imageAltText(tokens:Token[]):string{return tokens.map(token=>token.type==='image'?imageAltText(token.children||[]):['text','text_special','code_inline','html_inline'].includes(token.type)?token.content:['softbreak','hardbreak'].includes(token.type)?'\n':'').join('')}
const parsed=new Map<string,ImageModel|null>();
export function parseImage(raw:string):ImageModel|null{
 if(!/^\s*(?:!\[|<img\b|<p\b)/i.test(raw))return null;
 if(parsed.has(raw))return parsed.get(raw)!;
 const image=readImage(raw);if(parsed.size>=512)parsed.clear();parsed.set(raw,image);return image;
}
function readImage(raw:string):ImageModel|null{
 if(!/^\s*(?:!\[|<img\b|<p\b)/i.test(raw))return null;
 let text=raw.trim(),align:ImageModel['align']='left';
 const wrapper=/^<p\s+align\s*=\s*["'](left|center|right)["']\s*>\s*([\s\S]*?)\s*<\/p>$/i.exec(text);
 if(wrapper){align=wrapper[1].toLowerCase() as ImageModel['align'];text=wrapper[2]}
 if(/^<img\b/i.test(text)){
  const tag=/^<img\s+((?:[^"'<>]|"[^"]*"|'[^']*')*)\/?\s*>$/i.exec(text);if(!tag)return null;
  const attrs:Record<string,string>={};let rest=tag[1].replace(/\/\s*$/,'');
  while(rest.trim()){
   const attr=/^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))\s*/.exec(rest);if(!attr)return null;
   const key=attr[1].toLowerCase();if(!['src','alt','title','width','height'].includes(key)||key in attrs)return null;
   // HTML attributes decode entities but do not interpret Markdown backslash escapes.
   attrs[key]=decode((attr[2]??attr[3]??attr[4]).replace(/\\/g,'\\\\'));rest=rest.slice(attr[0].length);
  }
  if(!attrs.src)return null;
  const size=(key:string)=>/^\d+(?:\.\d+)?$/.test(attrs[key]||'')&&Number(attrs[key])>0?Number(attrs[key]):undefined;
  return {src:attrs.src,alt:attrs.alt||'',...(attrs.title!==undefined?{title:attrs.title}:{}),...(size('width')?{width:size('width')}:{}),...(size('height')?{height:size('height')}:{}),align};
 }
 if(wrapper)return null;
 const tokens=parser.parse(text,{}),children=tokens.length===3&&tokens[0].type==='paragraph_open'?tokens[1].children:null;
 if(children?.length!==1||children[0].type!=='image')return null;
 const token=children[0],src=token.attrGet('src');if(!src)return null;
 const title=token.attrGet('title');
 return {src,alt:imageAltText(token.children||[]),...(title!==null?{title}:{}),align};
}
// Keep raw destinations (including existing percent escapes) for both the backend and serializer.
parser.normalizeLink=s=>s;
export function serializeImage(image:ImageModel):string{
 const {src,alt,title,width,height,align}=image;
 if(align==='left'&&width===undefined&&height===undefined){
  const dest=escapeHTML(src).replace(/\\/g,'\\\\'),path=/[\s()<>]/.test(src)?'<'+dest+'>':dest;
  return '!['+escapeMarkdown(alt)+']('+path+(title!==undefined?' "'+escapeHTML(title).replace(/\\/g,'\\\\')+'"':'')+')';
 }
 const img='<img src="'+escapeHTML(src)+'" alt="'+escapeHTML(alt)+'"'+(title!==undefined?' title="'+escapeHTML(title)+'"':'')+(width!==undefined?' width="'+Math.round(width)+'"':'')+(height!==undefined?' height="'+height+'"':'')+'>';
 return align==='left'?img:'<p align="'+align+'">'+img+'</p>';
}
const ranges=new WeakMap<EditorState,{tree:Tree;images:ImageRange[];tables:{from:number;to:number}[]}>();
export function imageRanges(state:EditorState):ImageRange[]{
 const tree=syntaxTree(state),cached=ranges.get(state);if(cached?.tree===tree)return cached.images;
 const out:ImageRange[]=[],tables:{from:number;to:number}[]=[];
 // Images and tables share one tree walk; ordinary prose never goes through the image parser.
 tree.iterate({enter:n=>{
  if(['Document','BulletList','OrderedList','ListItem','Blockquote'].includes(n.name))return;
  if(n.name==='Table'){tables.push({from:n.from,to:n.to});return false}
  if(!['Paragraph','Task','HTMLBlock'].includes(n.name))return false;
  const node=n.node;let candidates:Set<number>|undefined;
  if(n.name==='HTMLBlock'){
   candidates=new Set();for(let i=state.doc.lineAt(n.from).number,last=state.doc.lineAt(n.to).number;i<=last;i++)candidates.add(i);
  }else for(let child=node.firstChild;child;child=child.nextSibling){
   if(child.name==='Image'||child.name==='HTMLTag')(candidates??=new Set()).add(state.doc.lineAt(child.from).number);
  }
  if(!candidates)return false;
  for(const i of candidates){
   const line=state.doc.line(i),start=n.name==='Task'&&line.from<=n.from?node.getChild('TaskMarker')!.to:Math.max(n.from,line.from);
   const text=state.sliceDoc(start,line.to),prefix=/^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?[ \t]*/.exec(text)![0];
   const raw=text.slice(prefix.length).trimEnd(),image=parseImage(raw);if(!image)continue;
   let quotes=0,listEms=0;for(let parent=node.parent;parent;parent=parent.parent){if(parent.name==='Blockquote')quotes++;else if(parent.name==='BulletList'||parent.name==='OrderedList')listEms+=parent.getChildren('ListItem').some(item=>item.getChild('Task'))?0.2:1.7}
   out.push({from:start+prefix.length,to:line.to-(text.length-prefix.length-raw.length),raw,image,quotes,listEms});
  }
  return false;
 }});ranges.set(state,{tree,images:out,tables});return out;
}
// Called only when an edit is confined to unchanged prose syntax; all widget source remains byte-identical.
export function mapImageRanges(before:EditorState,after:EditorState,changes:ChangeDesc){
 const cached=ranges.get(before);if(!cached||cached.tree!==syntaxTree(before))return false;
 const map=(range:{from:number;to:number})=>({from:changes.mapPos(range.from,1),to:changes.mapPos(range.to,-1)});
 ranges.set(after,{tree:syntaxTree(after),images:cached.images.map(image=>({...image,...map(image)})),tables:cached.tables.map(map)});return true;
}
export function clampImageWidth(width:number,column:number){const max=Math.max(1,Math.floor(column));return Math.min(max,Math.max(Math.min(48,max),Math.round(width)))}
export function tableRanges(state:EditorState){imageRanges(state);return ranges.get(state)!.tables}
function deleteImage(state:EditorState,range:{from:number;to:number}):TransactionSpec{
 const doc=state.doc,line=doc.lineAt(range.from),block=blockAt(state,range.from);
 if(!block||block.from===line.from&&block.to===line.to)return deleteBlocks(state,range);
 const empty=(text:string)=>/^[ \t]*(?:>[ \t]*)*$/.test(text),prefix=state.sliceDoc(line.from,range.from);
 let from=line.from,to=Math.min(doc.length,line.to+1),insert='';
 if(block.from===line.from&&/(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/.test(prefix)){
  // Promote the next paragraph into the item's first line, keeping its list and quote markers.
  for(let n=line.number+1;n<=doc.lines&&doc.line(n).from<=block.to;n++){
   const next=doc.line(n);if(empty(next.text))continue;
   to=next.from+/^(?:[ \t]*>[ \t]?)*[ \t]*/.exec(next.text)![0].length;insert=prefix;break;
  }
 }else if(line.number<doc.lines&&doc.line(line.number+1).from<=block.to&&empty(doc.line(line.number+1).text))to=Math.min(doc.length,doc.line(line.number+1).to+1);
 else if(line.number>1&&doc.line(line.number-1).from>=block.from&&empty(doc.line(line.number-1).text))from=doc.line(line.number-1).from;
 return {changes:{from,to,insert},selection:{anchor:from+insert.length},userEvent:'delete.image',annotations:isolateHistory.of('full')};
}
export function editImage(state:EditorState,range:{from:number;to:number},action:ImageAction,value?:string|number):TransactionSpec{
 if(action==='delete')return deleteImage(state,range);
 const original=parseImage(state.sliceDoc(range.from,range.to));if(!original)return {};const image={...original};
 if(action==='resize'){image.width=Math.round(Number(value));delete image.height}
 else if(action==='original'){delete image.width;delete image.height}
 else if(action==='alt')image.alt=String(value??'').replace(/[\r\n]/g,' ');
 else image.align=action;
 return {changes:{...range,insert:serializeImage(image)},userEvent:'input.image',annotations:isolateHistory.of('full')};
}
