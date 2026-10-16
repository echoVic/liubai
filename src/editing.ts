import {EditorState, type TransactionSpec} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';

export type BlockKind='heading'|'quote'|'bullet'|'ordered'|'task';
export function headingLevel(state:EditorState):number {
 const match=/^[ \t]*(#{1,6})[ \t]+/.exec(state.doc.lineAt(state.selection.main.head).text);
 return match?match[1].length:0;
}
export function setHeading(state:EditorState,level:number):TransactionSpec {
 const selection=state.selection.main;
 const first=state.doc.lineAt(selection.from).number;
 const last=state.doc.lineAt(Math.max(selection.from,selection.to-(selection.empty?0:1))).number;
 const changes=state.changes(Array.from({length:last-first+1},(_,i)=>{
  const line=state.doc.line(first+i),indent=/^[ \t]*/.exec(line.text)![0];
  const prefix=/^#{1,6}[ \t]+/.exec(line.text.slice(indent.length))?.[0]||'';
  return {from:line.from+indent.length,to:line.from+indent.length+prefix.length,insert:level?'#'.repeat(level)+' ':''};
 }));
 return {changes,selection:state.selection.map(changes,1),userEvent:'input.format'};
}
export function blockFormat(state:EditorState,kind:BlockKind):TransactionSpec {
 const selection=state.selection.main;
 const first=state.doc.lineAt(selection.from).number;
 const last=state.doc.lineAt(Math.max(selection.from,selection.to-(selection.empty?0:1))).number;
 const lines=Array.from({length:last-first+1},(_,i)=>state.doc.line(first+i));
 const own={heading:/^(\s*)#{1,6}\s+/,quote:/^(\s*)>\s?/,bullet:/^(\s*)[-+*]\s+(?!\[[ xX]\])/,ordered:/^(\s*)\d+[.)]\s+/,task:/^(\s*)[-+*]\s+\[[ xX]\]\s*/}[kind];
 const remove=lines.every(l=>!l.text.trim()||own.test(l.text));
 const changes=lines.filter(l=>l.text.trim()||lines.length===1).map((line,i)=>{
  const indent=/^\s*/.exec(line.text)![0];
  const body=line.text.slice(indent.length).replace(/^(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/,'');
  const prefix=remove?'':{heading:'## ',quote:'> ',bullet:'- ',ordered:`${i+1}. `,task:'- [ ] '}[kind];
  return {from:line.from,to:line.to,insert:indent+prefix+body};
 });
 return {changes,userEvent:'input.format'};
}
export function wrapSelection(state:EditorState,marker:string):TransactionSpec {
 const {from,to}=state.selection.main;const selected=state.sliceDoc(from,to);
 if(from>=marker.length&&state.sliceDoc(from-marker.length,from)===marker&&state.sliceDoc(to,to+marker.length)===marker)
  return {changes:[{from:from-marker.length,to:from},{from:to,to:to+marker.length}],selection:{anchor:from-marker.length,head:to-marker.length},userEvent:'input.format'};
 return {changes:{from,to,insert:marker+selected+marker},selection:{anchor:from+marker.length,head:to+marker.length},userEvent:'input.format'};
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
export function localDocumentLink(href:string):{path:string;fragment:string}|null {
 if(href.startsWith('#')||href.startsWith('//')||/^[a-z][a-z\d+.-]*:/i.test(href))return null;
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
 if(!safeLink(url))throw Error('请输入 https://、http://、mailto: 或 #标题 链接');
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
 cells.push(cell.trim());if(s.startsWith('|'))cells.shift();if(s.endsWith('|')&&!s.endsWith('\\|'))cells.pop();return cells;
}
export function parseTable(raw:string){
 const lines=raw.trim().split('\n');const rows=lines.filter((_,i)=>i!==1).map(splitCells);const aligns=(lines[1]?splitCells(lines[1]):[]).map(c=>/^:-+:$/.test(c)?'center':/-+:$/.test(c)?'right':/^:-+/.test(c)?'left':'');
 return {rows,aligns};
}
export function serializeTable(rows:string[][],aligns:string[]=[]){
 const count=rows[0]?.length||0;if(count<1)throw Error('表格至少需要一列');
 const line=(r:string[])=>'| '+Array.from({length:count},(_,i)=>(r[i]||'').replace(/\r?\n/g,' ').replace(/(?<!\\)\|/g,'\\|')).join(' | ')+' |';
 return [line(rows[0]),line(Array.from({length:count},(_,i)=>({center:':---:',right:'---:',left:':---'}[aligns[i]]||'---'))),...rows.slice(1).map(line)].join('\n');
}
