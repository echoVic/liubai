import {messages} from './i18n';
import {EditorState, type TransactionSpec} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';
import {syntaxTree,ensureSyntaxTree} from '@codemirror/language';
import type {SyntaxNode} from '@lezer/common';
import {inlineTagPairs,tagHosts} from './marks';
import {windows} from './platform';

export type BlockKind='heading'|'quote'|'bullet'|'ordered'|'task';
export function headingLevel(state:EditorState):number {
 const match=/^[ \t]*(#{1,6})[ \t]+/.exec(state.doc.lineAt(state.selection.main.head).text);
 return match?match[1].length:0;
}
export function setHeading(state:EditorState,level:number,preserveBody=false):TransactionSpec {
 const selection=state.selection.main;
 const first=state.doc.lineAt(selection.from).number;
 const last=state.doc.lineAt(Math.max(selection.from,selection.to-(selection.empty?0:1))).number;
 const changes=state.changes(Array.from({length:last-first+1},(_,i)=>{
  const line=state.doc.line(first+i),indent=/^[ \t]*/.exec(line.text)![0];
  const prefix=preserveBody?'':/^#{1,6}[ \t]+/.exec(line.text.slice(indent.length))?.[0]||'';
  return {from:line.from+indent.length,to:line.from+indent.length+prefix.length,insert:level?'#'.repeat(level)+' ':''};
 }));
 return {changes,selection:state.selection.map(changes,1),userEvent:'input.format'};
}
export function blockFormat(state:EditorState,kind:BlockKind,preserveBody=false):TransactionSpec {
 const selection=state.selection.main;
 const first=state.doc.lineAt(selection.from).number;
 const last=state.doc.lineAt(Math.max(selection.from,selection.to-(selection.empty?0:1))).number;
 const lines=Array.from({length:last-first+1},(_,i)=>state.doc.line(first+i));
 const own={heading:/^(\s*)#{1,6}\s+/,quote:/^(\s*)>\s?/,bullet:/^(\s*)[-+*]\s+(?!\[[ xX]\])/,ordered:/^(\s*)\d+[.)]\s+/,task:/^(\s*)[-+*]\s+\[[ xX]\]\s*/}[kind];
 const remove=!preserveBody&&lines.every(l=>!l.text.trim()||own.test(l.text));
 const changes=lines.filter(l=>l.text.trim()||lines.length===1).map((line,i)=>{
  const indent=/^\s*/.exec(line.text)![0];
  const body=preserveBody?line.text.slice(indent.length):line.text.slice(indent.length).replace(/^(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/,'');
  const prefix=remove?'':{heading:'## ',quote:'> ',bullet:'- ',ordered:`${i+1}. `,task:'- [ ] '}[kind];
  return {from:line.from,to:line.to,insert:indent+prefix+body};
 });
 return {changes,userEvent:'input.format'};
}
export const inlineMarkers:Record<string,[string,string]>={bold:['**','**'],italic:['_','_'],underline:['<u>','</u>'],strike:['~~','~~'],highlight:['==','=='],inlineCode:['`','`'],superscript:['<sup>','</sup>'],subscript:['<sub>','</sub>']};
export function wrapSelection(state:EditorState,open:string,close=open):TransactionSpec {
 const {from,to}=state.selection.main,selected=state.sliceDoc(from,to);
 if(from>=open.length&&state.sliceDoc(from-open.length,from)===open&&state.sliceDoc(to,to+close.length)===close)
  return {changes:[{from:from-open.length,to:from},{from:to,to:to+close.length}],selection:{anchor:from-open.length,head:to-open.length},userEvent:'input.format'};
 const wrapped=selected.length>=open.length+close.length&&selected.startsWith(open)&&selected.endsWith(close);
 const insert=wrapped?selected.slice(open.length,-close.length):open+selected+close,anchor=from+(wrapped?0:open.length);
 return {changes:{from,to,insert},selection:{anchor,head:anchor+(wrapped?insert.length:selected.length)},userEvent:'input.format'};
}
interface InlineWrapper {from:number;to:number;openTo:number;closeFrom:number}
export function clearFormatting(state:EditorState):TransactionSpec {
 let {from,to}=state.selection.main;
 if(from===to){
  const line=state.doc.lineAt(from),offset=from-line.from,word=/[\p{L}\p{N}]+/gu;
  for(const match of line.text.matchAll(word))if(match.index!<=offset&&match.index!+match[0].length>=offset){from=line.from+match.index!;to=from+match[0].length;break}
 }
 if(from===to)return {};
 const tree=ensureSyntaxTree(state,to,200)||syntaxTree(state),wrappers:InlineWrapper[]=[];
 // Inline formatting never leaves its block, so only the blocks around the selection are read.
 let lo=from,hi=to;
 for(const [pos,side] of [[from,1],[to,-1]] as const)for(let n:SyntaxNode|null=tree.resolveInner(pos,side);n&&n.parent;n=n.parent)if(/^(Document|Blockquote|BulletList|OrderedList|ListItem)$/.test(n.parent.name)){lo=Math.min(lo,n.from);hi=Math.max(hi,n.to);break}
 tree.iterate({from:lo,to:hi,enter(ref){
  const name=ref.name;
  if(name==='FencedCode'||name==='CodeBlock'||name==='HTMLBlock')return false;
  const marker=({StrongEmphasis:'EmphasisMark',Emphasis:'EmphasisMark',Strikethrough:'StrikethroughMark',Highlight:'HighlightMark',InlineCode:'CodeMark'} as Record<string,string>)[name];
  if(!marker&&name!=='Link'&&!tagHosts.test(name))return;
  const n=ref.node;
  for(const pair of inlineTagPairs(n,(a,b)=>state.sliceDoc(a,b)))wrappers.push(pair);
  if(marker){const marks=n.getChildren(marker);if(marks.length>=2)wrappers.push({from:n.from,to:n.to,openTo:marks[0].to,closeFrom:marks.at(-1)!.from})}
  if(name==='Link'){
   const marks=n.getChildren('LinkMark');if(marks.length>=2)wrappers.push({from:n.from,to:n.to,openTo:marks[0].to,closeFrom:marks[1].from});
  }
 }});
 // Render the affected wrappers recursively; split a partially cleared mark around the selection.
 function render(start:number,end:number,list:InlineWrapper[]):string{
  let output='',pos=start;
  for(let i=0;i<list.length;i++){
   const w=list[i];if(w.to<=pos||w.from>=end)continue;
   const children:InlineWrapper[]=[];while(i+1<list.length&&list[i+1].from>=w.openTo&&list[i+1].to<=w.closeFrom)children.push(list[++i]);
   output+=state.sliceDoc(pos,Math.max(pos,w.from));
   const innerFrom=Math.max(start,w.openTo),innerTo=Math.min(end,w.closeFrom),a=Math.max(innerFrom,from),b=Math.min(innerTo,to),open=state.sliceDoc(w.from,w.openTo),close=state.sliceDoc(w.closeFrom,w.to);
   if(innerFrom>=innerTo){pos=Math.min(end,w.to);continue}
   if(a<b){
    const wrap=(text:string)=>{const match=/^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;return match[1]+(match[2]?open+match[2]+close:'')+match[3]};
    // Links clear to their label; never parse or alter the destination as formatting.
    if(open==='[')output+=render(innerFrom,innerTo,children);
    else output+=wrap(render(innerFrom,a,children))+render(a,b,children)+wrap(render(b,innerTo,children));
   }else output+=open+render(innerFrom,innerTo,children)+close;
   pos=Math.min(end,w.to);
  }
  return output+state.sliceDoc(pos,end);
 }
 wrappers.sort((a,b)=>a.from-b.from||b.to-a.to);
 // Limit the replacement to whole wrappers that meet the selection, retaining unrelated blocks verbatim.
 const relevant=wrappers.filter(w=>w.openTo<to&&w.closeFrom>from);
 if(!relevant.length)return {};
 const start=Math.min(from,...relevant.map(w=>w.from)),end=Math.max(to,...relevant.map(w=>w.to)),insert=render(start,end,wrappers.filter(w=>w.from>=start&&w.to<=end));
 return {changes:{from:start,to:end,insert},selection:{anchor:start,head:start+insert.length},userEvent:'input.format'};
}
function listItem(state:EditorState,pos:number):SyntaxNode|null {
 const tree=ensureSyntaxTree(state,pos,50)||syntaxTree(state);
 for(let n:SyntaxNode|null=tree.resolveInner(Math.min(pos+1,state.doc.lineAt(pos).to),-1);n;n=n.parent)if(n.name==='ListItem')return n;
 return null;
}
export function inList(state:EditorState){return !!listItem(state,state.selection.main.head)}
export function indentList(state:EditorState,direction:1|-1):TransactionSpec|null {
 const {from,to}=state.selection.main,first=listItem(state,from);if(!first)return null;
 const roots:SyntaxNode[]=[];
 const last=state.doc.lineAt(Math.max(from,to-1)).number;
 for(let line=state.doc.lineAt(from).number;line<=last;line++){
  const item=listItem(state,state.doc.line(line).to);if(item&&!roots.some(root=>root.from<=item.from&&root.to>=item.to))roots.push(item);
 }
 const changes:{from:number;to:number;insert:string}[]=[];
 for(const item of roots){
  const line=state.doc.lineAt(item.from),indent=/^[ \t]*/.exec(line.text)![0].length;
  const parent=item.parent?.parent?.name==='ListItem'?item.parent.parent:null;
  const marker=(node:SyntaxNode)=>/^([-+*]|\d+[.)])[ \t]+/.exec(state.sliceDoc(node.from,state.doc.lineAt(node.from).to))?.[0].length||2;
  const previous=item.prevSibling;
  const width=direction<0&&parent?marker(parent):previous?.name==='ListItem'?marker(previous):parent?marker(parent):marker(item);
  for(let n=line.number;n<=state.doc.lineAt(item.to).number;n++){
   const child=state.doc.line(n),spaces=/^[ \t]*/.exec(child.text)![0].length;
   const remove=direction<0?Math.min(width,indent,spaces):0;
   changes.push({from:child.from,to:child.from+remove,insert:direction>0?' '.repeat(width):''});
  }
 }
 const set=state.changes(changes);
 return {changes:set,selection:state.selection.map(set,1),userEvent:'input.indent'};
}
export function insertMath(state:EditorState,inline=false):TransactionSpec {
 const {from,to}=state.selection.main,selected=state.sliceDoc(from,to),display=!inline&&from===to&&!state.doc.lineAt(from).text.trim();
 const insert=selected?'$'+selected+'$':display?'$$\n\n$$':'$$',start=from+(display?3:1);
 return {changes:{from,to,insert},selection:{anchor:start,head:start+selected.length},userEvent:'input.format',annotations:isolateHistory.of('full')};
}
export function codeBlock(state:EditorState):TransactionSpec {
 const {from,to}=state.selection.main;const selected=state.sliceDoc(from,to);
 const fence='`'.repeat(Math.max(3,...[...selected.matchAll(/`+/g)].map(m=>m[0].length+1)));
 const before=from>0&&state.sliceDoc(from-1,from)!=='\n'?'\n\n':'';
 const after=to<state.doc.length&&state.sliceDoc(to,to+1)!=='\n'?'\n\n':'\n';
 const start=before+fence+'\n';
 return {changes:{from,to,insert:start+selected+'\n'+fence+after},selection:{anchor:from+start.length,head:from+start.length+selected.length},userEvent:'input.format'};
}
export function safeLink(raw:string):boolean {
 const value=raw.trim();if(!value||/[\u0000-\u0020\u007f<>]/.test(value))return false;
 return /^(https?:\/\/|mailto:|#)/i.test(value);
}
// On Windows, C:\notes\b.md is a path, not a URL with the scheme c; the reading view escapes its backslashes.
export function localDocumentLink(href:string,drivePaths=windows):{path:string;fragment:string}|null {
 let plain=href;try{plain=decodeURIComponent(href)}catch{}
 if(href.startsWith('#')||href.startsWith('//')||/^[a-z][a-z\d+.-]*:/i.test(href)&&!(drivePaths&&/^[a-z]:[\\/]/i.test(plain)))return null;
 const path=href.split(/[?#]/,1)[0];let decoded=path;
 try{decoded=decodeURIComponent(path)}catch{}
 if(!/\.(md|markdown|mdown|mkd|txt)$/i.test(decoded))return null;
 const hash=href.indexOf('#');let fragment=hash<0?'':href.slice(hash+1);
 try{fragment=decodeURIComponent(fragment)}catch{}
 return {path,fragment};
}
export function linkAt(state:EditorState){
 let n=syntaxTree(state).resolveInner(state.selection.main.head,-1);
 for(;n;n=n.parent!){if(n.name==='Link'){
  const raw=state.sliceDoc(n.from,n.to);const m=/^\[([\s\S]*)\]\((?:<([^>]+)>|([^\s]+?))(?:\s+['"].*['"])?\)$/.exec(raw);
  return m?{from:n.from,to:n.to,text:m[1].replace(/\\([\[\]\\])/g,'$1'),url:m[2]||m[3]}:null;
 }}return null;
}
export function makeLink(text:string,url:string){
 if(!safeLink(url))throw Error(messages.fEnterAnHttpsHttpMailtoOrHeadingLink());
 return `[${text.replace(/[\[\]\\]/g,'\\$&').replace(/\n/g,' ')}](<${url.trim()}>)`;
}
export function frontMatterRange(state:EditorState):{from:number;to:number}|null {
 if(state.doc.line(1).text!=='---'||state.doc.lines<2)return null;
 for(let i=2;i<=Math.min(200,state.doc.lines);i++){
  const line=state.doc.line(i);
  if(line.text==='---'||line.text==='...')return {from:0,to:line.to};
 }
 return null;
}
export function headings(state:EditorState){
 const out:{from:number;text:string;level:number;slug:string}[]=[];const used=new Map<string,number>();
 const meta=frontMatterRange(state);
 syntaxTree(state).iterate({enter(n){if(meta&&n.from<meta.to&&n.name!=='Document')return false;if(/^(ATX|Setext)Heading/.test(n.name)){
  const raw=state.sliceDoc(n.from,n.to);const text=raw.replace(/^#{1,6}\s+/,'').replace(/\n[=-]+\s*$/,'').replace(/\s+#+\s*$/,'');
  const base=text.toLowerCase().replace(/[\p{P}\p{S}]/gu,'').trim().replace(/\s+/g,'-');const count=used.get(base)||0;used.set(base,count+1);
  out.push({from:n.from,text,level:Number(n.name.slice(-1))||1,slug:base+(count?'-'+count:'')});return false;
 }} });return out;
}
export function tableAt(state:EditorState){let n=syntaxTree(state).resolveInner(state.selection.main.head,-1);for(;n;n=n.parent!){if(n.name==='Table')return {from:n.from,to:n.to,raw:state.sliceDoc(n.from,n.to)}}return null}
export function splitCells(line:string){
 const s=line.trim();let cells:string[]=[],cell='',escaped=false;
 for(let i=0;i<s.length;i++){const c=s[i];if(c==='|'&&!escaped){cells.push(cell.trim());cell=''}else cell+=c;escaped=c==='\\'&&!escaped;if(c!=='\\')escaped=false;}
 cells.push(cell.trim());if(s.startsWith('|'))cells.shift();if(s.endsWith('|')&&/^(?:\\\\)*$/.test(/\\*$/.exec(s.slice(0,-1))![0]))cells.pop();return cells;
}
export function parseTable(raw:string){
 const lines=raw.trim().split('\n'),prefix=/^[ \t>]*/.exec(lines[1]||'')![0];
 // Lezer starts the range after the first container marker, but includes later ones.
 const content=lines.map((line,i)=>i&&prefix&&line.startsWith(prefix)?line.slice(prefix.length):line);
 const rows=content.filter((_,i)=>i!==1).map(splitCells),aligns=(content[1]?splitCells(content[1]):[]).map(c=>/^:-+:$/.test(c)?'center':/-+:$/.test(c)?'right':/^:-+/.test(c)?'left':'');
 return {rows,aligns,prefix};
}
export function serializeTable(rows:string[][],aligns:string[]=[],prefix=''){
 const count=rows[0]?.length||0;if(count<1)throw Error(messages.fATableNeedsAtLeastOneColumn());
 const line=(r:string[])=>'| '+Array.from({length:count},(_,i)=>(r[i]||'').replace(/\r?\n/g,' ').replace(/(\\*)\|/g,(pipe,slashes:string)=>slashes.length%2?pipe:slashes+'\\|')).join(' | ')+' |';
 return [line(rows[0]),line(Array.from({length:count},(_,i)=>({center:':---:',right:'---:',left:':---'}[aligns[i]]||'---'))),...rows.slice(1).map(line)].join('\n'+prefix);
}

export type TableAction='cell'|'rowAbove'|'rowBelow'|'columnLeft'|'columnRight'|'deleteRow'|'deleteColumn'|'left'|'center'|'right'|'deleteTable';
export function editTable(state:EditorState,range:{from:number;to:number},row:number,column:number,action:TableAction,value=''):TransactionSpec{
 const {rows,aligns,prefix}=parseTable(state.sliceDoc(range.from,range.to)),count=rows[0].length;
 // Missing trailing cells in valid Markdown tables behave like empty cells.
 for(const r of rows)while(r.length<count)r.push('');
 if(action==='cell')rows[row][column]=value;
 else if(action==='rowAbove'||action==='rowBelow')rows.splice(row+(action==='rowBelow'?1:0),0,Array(count).fill(''));
 else if(action==='columnLeft'||action==='columnRight'){
  const at=column+(action==='columnRight'?1:0);for(const r of rows)r.splice(at,0,'');aligns.splice(at,0,'');
 }else if(action==='deleteRow')rows.splice(row,1);
 else if(action==='deleteColumn'){for(const r of rows)r.splice(column,1);aligns.splice(column,1)}
 else if(action!=='deleteTable')aligns[column]=action;
 const insert=action==='deleteTable'||!rows.length||!rows[0].length?'':serializeTable(rows,aligns,prefix);
 return {changes:{from:range.from,to:range.to,insert},selection:{anchor:range.from+(insert?2:0)},userEvent:action==='cell'?'input.type.table':'input.table',annotations:action==='cell'?[]:isolateHistory.of('full')};
}
export function insertTable(state:EditorState,range:{from:number;to:number}=state.selection.main,trailing=true):TransactionSpec{
 const {from,to}=range,left=state.sliceDoc(Math.max(0,from-2),from),right=state.sliceDoc(to,Math.min(state.doc.length,to+2));
 const before=from&&!left.endsWith('\n\n')?left.endsWith('\n')?'\n':'\n\n':'';
 const after=to<state.doc.length?right.startsWith('\n\n')?'':right.startsWith('\n')?'\n':'\n\n':trailing?'\n':'';
 return {changes:{from,to,insert:before+serializeTable([['',''],['','']])+after},selection:{anchor:from+before.length+2},userEvent:'input.table',annotations:isolateHistory.of('full'),scrollIntoView:true};
}
