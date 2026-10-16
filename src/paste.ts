import TurndownService from 'turndown';
import {gfm} from 'turndown-plugin-gfm';
import type {EditorState,TransactionSpec} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';

export function pasteText(state:EditorState,text:string):TransactionSpec{
 return {...state.replaceSelection(text),userEvent:'input.paste',annotations:isolateHistory.of('full'),scrollIntoView:true};
}
export function replacePasteImage(state:EditorState,placeholder:string,text:string):TransactionSpec{
 const from=state.doc.toString().indexOf(placeholder);if(from<0)return {};
 // CodeMirror's compose event joins an asynchronous replacement to the original
 // input even past the history timeout. Image import locks editing until it ends.
 return {changes:{from,to:from+placeholder.length,insert:text},userEvent:'input.type.compose',annotations:isolateHistory.of('after')};
}

export interface PasteImage {placeholder:string;dataUrl:string;alt:string}
// The page's CSP (connect-src 'self') blocks fetch() of data: URLs, so decode them here.
export function dataUrlBlob(url:string):Blob{
 const match=/^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(url);if(!match)throw Error('图片无法读取');
 const bytes=/;base64/i.test(match[2])?Uint8Array.from(atob(match[3].replace(/\s/g,'')),char=>char.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(match[3]));
 return new Blob([bytes],{type:match[1]||'application/octet-stream'});
}
const block=/^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BODY|DIV|H[1-6]|LI|OL|P|PRE|SECTION|TABLE|TD|TH|UL)$/;
const punctuation=/[\p{P}\p{S}]/u;
const word=(node:HTMLElement)=>node.nodeName==='P'&&/mso-list\s*:/i.test(node.getAttribute('style')||'');
const style=(node:HTMLElement,name:string)=>(node.getAttribute('style')||'').match(new RegExp('(?:^|;)\\s*'+name+'\\s*:\\s*([^;]+)','i'))?.[1].trim().toLowerCase()||'';
function formats(node:HTMLElement):string[]{
 const weight=style(node,'font-weight'),result:string[]=[];
 if((['B','STRONG'].includes(node.nodeName)&&(!weight||weight==='bolder'))||weight==='bold'||Number.parseInt(weight,10)>=600)result.push('**');
 if(['I','EM'].includes(node.nodeName)||style(node,'font-style')==='italic')result.push('*');
 if(['S','STRIKE','DEL'].includes(node.nodeName)||/\bline-through\b/.test(style(node,'text-decoration')+' '+style(node,'text-decoration-line')))result.push('~~');
 return result;
}
function neighbour(node:Node,direction:'previousSibling'|'nextSibling'):string{
 for(let current:Node|null=node;current&&!block.test(current.nodeName);current=current.parentNode){
  for(let sibling=current[direction];sibling;sibling=sibling[direction]){
   if(block.test(sibling.nodeName))return '';
   const text=sibling.textContent||'';if(text)return direction==='previousSibling'?Array.from(text).at(-1)!:Array.from(text)[0];
  }
 }
 return '';
}
function emphasis(content:string,node:HTMLElement,marker:string):string{
 for(let parent=node.parentElement;parent&&!block.test(parent.nodeName);parent=parent.parentElement)if(formats(parent).includes(marker))return content;
 const continues=(sibling:Node|null)=>sibling?.nodeType===1&&formats(sibling as HTMLElement).join(',')===formats(node).join(',');
 const opening=continues(node.previousSibling)?'':marker,closing=continues(node.nextSibling)?'':marker;
 let before='',after='';
 const crowded=(text:string)=>!!text&&!/[\s\p{P}\p{S}]/u.test(text);
 const movable=(token:string)=>punctuation.test(token)&&(token.length>1||!/[*_~`\\]/.test(token));
 if(opening&&crowded(neighbour(node,'previousSibling')))while(content){const token=content.match(/^\\[\p{P}\p{S}]/u)?.[0]||Array.from(content)[0];if(!movable(token))break;before+=token;content=content.slice(token.length)}
 if(closing&&crowded(neighbour(node,'nextSibling')))while(content){const token=content.match(/\\[\p{P}\p{S}]$/u)?.[0]||Array.from(content).at(-1)!;if(!movable(token))break;after=token+after;content=content.slice(0,-token.length)}
 return before+(content?opening+content+closing:'')+after;
}
function ordinal(marker:string):number{
 if(/^\d/.test(marker))return Number.parseInt(marker,10);
 const letters=marker.replace(/[.)]/g,'').toLowerCase();
 if(/^[ivxlcdm]+$/.test(letters)){
  const values:Record<string,number>={i:1,v:5,x:10,l:50,c:100,d:500,m:1000};let result=0,last=0;
  for(const char of Array.from(letters).reverse()){const value=values[char];result+=value<last?-value:value;last=value}return result;
 }
 return letters.charCodeAt(0)-96;
}
export function htmlToMarkdown(html:string,plain:string):{markdown:string;images:PasteImage[]}{
 const images:PasteImage[]=[];let plainCode=false;
 const service=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'*',strongDelimiter:'**',linkStyle:'inlined'});
 service.use(gfm);
 service.addRule('table',{
  filter:'table',replacement:(content,input)=>{
   const table=input as HTMLTableElement;if(!table.rows.length)return '';
   const rows=content.trim().replace(/\n{2,}/g,'\n').split('\n');
   if(!/^\|[ :|-]+\|$/.test(rows[1]||''))rows.splice(1,0,'| '+Array.from(table.rows[0].cells).map(cell=>({left:':--',right:'--:',center:':-:'}[cell.getAttribute('align')||'']||'---')).join(' | ')+' |');
   return '\n\n'+rows.join('\n')+'\n\n';
  }
 });
 service.addRule('listItem',{
  filter:'li',replacement:(content,node)=>{
   const parent=node.parentNode as HTMLElement;
   const prefix=parent.nodeName==='OL'?String(Number(parent.getAttribute('start')||1)+Array.from(parent.children).indexOf(node as HTMLElement))+'. ':'- ';
   return prefix+content.replace(/^\n+/,'').replace(/\n+$/,'\n').replace(/\n/g,'\n    ')+(node.nextSibling?'\n':'');
  }
 });
 service.addRule('wordList',{
  filter:word,replacement:(content,input)=>{
   const node=input as HTMLElement;
   const marker=Array.from(node.getElementsByTagName('span')).find(span=>style(span,'mso-list')==='ignore')?.textContent?.trim()||'';
   const level=Number((node.getAttribute('style')||'').match(/\blevel(\d+)/i)?.[1]||1);
   const prefix=/^(\d+|[a-z]+)[.)]$/i.test(marker)?ordinal(marker)+'. ':'- ';
   return '\n'+'    '.repeat(Math.max(0,Math.min(level-1,20)))+prefix+content.trim()+'\n';
  }
 });
 service.addRule('wordMarker',{filter:node=>style(node,'mso-list')==='ignore',replacement:()=>''});
 service.addRule('styledEmphasis',{
  filter:node=>style(node,'mso-list')!=='ignore'&&(['B','STRONG','I','EM','S','STRIKE','DEL'].includes(node.nodeName)||node.nodeName==='SPAN'),
  replacement:(content,input)=>{
   const node=input as HTMLElement;
   for(const marker of formats(node))content=emphasis(content,node,marker);
   return content;
  }
 });
 service.addRule('fencedLanguage',{
  filter:node=>node.nodeName==='PRE'&&node.firstChild?.nodeName==='CODE',
  replacement:(_content,input)=>{
   const node=input as HTMLElement;
   const code=node.firstChild as HTMLElement,language=(code.getAttribute('class')||node.getAttribute('class')||'').match(/\b(?:language|lang)-([\w+-]+)/)?.[1]||'';
   const text=(code.textContent||'').replace(/\n$/,'');
   const fence='`'.repeat(Math.max(3,...(text.match(/`+/g)||[]).map(run=>run.length+1)));
   return '\n\n'+fence+language+'\n'+text+'\n'+fence+'\n\n';
  }
 });
 service.addRule('image',{
  filter:'img',replacement:(_content,input)=>{
   const node=input as HTMLElement;
   const source=node.getAttribute('src')||'',alt=node.getAttribute('alt')||'';
   const own=node.getAttribute('data-image-source')||'';
   const escape=(text:string)=>text.replace(/[\\[\]]/g,'\\$&').replace(/[\r\n]/g,' ');
   if(/^data:image\//i.test(source)){
    let placeholder='LIUBAI-PASTE-IMAGE-'+Math.random().toString(36).slice(2)+'-'+images.length+'-END';while(html.includes(placeholder)||plain.includes(placeholder))placeholder+='-';
    images.push({placeholder,dataUrl:source,alt});return placeholder;
   }
   const destination=own&&!/^(?:[a-z][\w+.-]*:|\/\/)/i.test(own.replace(/^liubai-asset:/,''))?own:source;
   if(/^https?:\/\//i.test(destination)||destination===own&&!!own)return '!['+escape(alt)+']('+destination.replace(/ /g,'%20').replace(/\(/g,'%28').replace(/\)/g,'%29')+')';
   return escape(alt);
  }
 });
 service.addRule('codeEditor',{
  filter:node=>{
   if(/\bcm-(?:content|line)\b/.test(node.getAttribute('class')||'')){plainCode=true;return true}
   if(!/\bpre(?:-wrap)?\b/.test(style(node,'white-space'))||!/monospace|menlo|consolas|courier/i.test(style(node,'font-family')))return false;
   if(Array.from(node.getElementsByTagName('*')).some(child=>block.test(child.nodeName)))return false;
   plainCode=true;return true;
  },replacement:()=>''
 });
 service.remove(node=>['HEAD','META','STYLE','SCRIPT','TITLE','O:P'].includes(node.nodeName));
 const markdown=service.turndown(html);
 const unescaped=markdown.replace(/\\([!-/:-@[-`{-~])/g,'$1');
 const comparable=(text:string)=>text.replace(/\r\n?/g,'\n').replace(/\n+/g,'\n').trim();
 return {markdown:plainCode||!images.length&&comparable(unescaped)===comparable(plain)?plain:markdown,images:plainCode?[]:images};
}
