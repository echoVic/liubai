import {Facet,EditorState,StateField,type TransactionSpec} from '@codemirror/state';
import {EditorView,WidgetType} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';
import type {SyntaxNode} from '@lezer/common';
import {undo,redo,isolateHistory} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {Highlight} from './marks';
import {wrapSelection,insertMath,clearFormatting,inlineMarkers,editTable,parseTable,frontMatterRange,type TableAction} from './editing';
import {messages,activeLocale} from './i18n';
import {insertFootnote} from './extras';
import {attachMenu} from './menu';
import {wikiAt,wikiURL,wikiNodeAllowed} from './wiki-links';
import {keyLabel} from './platform';

// The editor clears its IME guard, commits the cell, then resumes saves and queued actions.
export const tableComposition=Facet.define<(view:EditorView,active:boolean,commit?:()=>void)=>void>();
export const tableLink=Facet.define<(url:string)=>void>();
// Keep the document parser's native contexts and reference definitions, not a cell-only parse.
export function tableWikiLinkAt(state:EditorState,from:number,row:number,column:number,text:string,offset:number):{from:number;to:number;url:string}|null{
 if(![from,row,column,offset].every(Number.isInteger)||from<0||from>=state.doc.length||row<0||column<0||offset<0||offset>text.length)return null;
 const meta=frontMatterRange(state);if(meta&&from<meta.to)return null;
 let table:SyntaxNode|null=syntaxTree(state).resolveInner(from,1);
 while(table&&table.name!=='Table')table=table.parent;
 if(!table||table.from!==from)return null;
 const line=row===0?table.getChild('TableHeader'):table.getChildren('TableRow')[row-1];if(!line)return null;
 let index=0;
 for(let cell=line.firstChild;cell;cell=cell.nextSibling){
  // Empty cells have no TableCell node. Delimiters still retain their column.
  if(cell.name==='TableDelimiter'){if(cell.from!==line.from)index++;continue}
  if(cell.name!=='TableCell'||index!==column)continue;
  const source=state.sliceDoc(cell.from,cell.to),trimmed=source.trim();
  if(trimmed!==text)return null;
  const start=cell.from+source.length-source.trimStart().length,pos=start+offset;
  for(const side of [-1,1] as const){
   for(let node:SyntaxNode|null=cell.resolveInner(pos,side);node&&node.from>=cell.from&&node.to<=cell.to;node=node.parent){
    if(node.name!=='WikiLink'||pos<node.from||pos>node.to||!wikiNodeAllowed(node))continue;
    const match=wikiAt(state.sliceDoc(node.from,node.to),0);
    if(match)return {from:node.from-start,to:node.to-start,url:wikiURL(match.target)};
   }
  }
  return null;
 }
 return null;
}
export {leaveBlock as leaveTable} from './block-navigation';
import {leaveBlock as leaveTable} from './block-navigation';
// The table whose source contains pos, if any.
export function tableAround(state:EditorState,pos:number):{from:number;to:number}|null{
 for(let node:SyntaxNode|null=syntaxTree(state).resolveInner(pos,-1);node;node=node.parent)if(node.name==='Table')return {from:node.from,to:node.to};
 return null;
}
const tables=new WeakMap<HTMLElement,TableDOM>();
export function focusTableCell(view:EditorView,position=view.state.selection.main.head){
 for(const dom of view.dom.querySelectorAll<HTMLElement>('.rendered-table')){
  const table=tables.get(dom);if(table&&position>=table.from&&position<=table.from+table.raw.length){table.focus(0,0);return true}
 }
 return false;
}
function focusedTable(view:EditorView){
 const cell=document.activeElement as HTMLElement|null,dom=cell?.closest<HTMLElement>('.rendered-table');
 return dom&&view.dom.contains(dom)&&cell?.matches('[role=textbox]')?tables.get(dom):undefined;
}
export function focusedTableRange(view:EditorView){const table=focusedTable(view);return table?{from:table.from,to:table.from+table.raw.length}:null}
export function formatTableCell(view:EditorView,id:string){const table=focusedTable(view);if(!table)return false;table.format(document.activeElement as HTMLElement,id);return true}
// Capture the DOM selection before the insert menu moves focus into its buttons.
export function tableFootnote(view:EditorView):(()=>TransactionSpec)|undefined{
 const table=focusedTable(view);return table?.footnote(document.activeElement as HTMLElement);
}
export class TableWidget extends WidgetType{
 readonly locale=activeLocale;
 constructor(readonly raw:string,readonly from:number,readonly composing:StateField<boolean>,readonly readOnly=false){super()}
 eq(o:TableWidget){return o.locale===this.locale&&o.raw===this.raw&&o.from===this.from&&o.readOnly===this.readOnly}
 toDOM(view:EditorView){const table=new TableDOM(view,this.composing);tables.set(table.dom,table);table.update(this);return table.dom}
 updateDOM(dom:HTMLElement){tables.get(dom)!.update(this);return true}
 destroy(dom:HTMLElement){tables.get(dom)?.destroy();tables.delete(dom)}
 ignoreEvent(){return true}
}
class TableDOM{
 readonly dom=document.createElement('div');
 private table=document.createElement('table');
 private button=document.createElement('button');
 private popup=document.createElement('div');
 private menu:ReturnType<typeof attachMenu>;
 private row=0;
 private column=0;
 private composingCell:HTMLElement|null=null;
 private committing=false;
 private fresh=true;
 private disposed=false;
 private endTimer:ReturnType<typeof setTimeout>|undefined;
 private readOnly=false;
 raw='';
 from=0;
 constructor(private view:EditorView,private composing:StateField<boolean>){
  this.dom.className='rendered-table';this.dom.contentEditable='false';
  this.button.type='button';this.button.className='table-menu-button';this.button.textContent='⋯';this.button.setAttribute('aria-haspopup','menu');this.button.setAttribute('aria-expanded','false');
  this.popup.className='menu table-menu';this.popup.hidden=true;this.popup.setAttribute('role','menu');document.body.append(this.popup);
  this.dom.append(this.button,this.table);
  this.menu=attachMenu(this.button,this.popup,id=>this.change(id as TableAction));
  this.button.addEventListener('click',()=>{if(this.blocked())this.menu.close()});
 }
 private blocked(){return this.readOnly||this.view.state.readOnly||this.view.state.field(this.composing)||!!this.composingCell}
 update(widget:TableWidget){
  this.raw=widget.raw;this.from=widget.from;this.readOnly=widget.readOnly;this.dom.dataset.from=String(this.from);
  this.button.disabled=this.blocked();this.button.setAttribute('aria-label',messages.fTableActions());this.popup.setAttribute('aria-label',messages.fTableActions());
  const actions:[TableAction,string][]=[['rowAbove',messages.fInsertRowAbove()],['rowBelow',messages.fInsertRowBelow()],['columnLeft',messages.fInsertColumnLeft()],['columnRight',messages.fInsertColumnRight()],['deleteRow',messages.fDeleteRow()],['deleteColumn',messages.fDeleteColumn()],['left',messages.fAlignColumnLeft()],['center',messages.fAlignColumnCenter()],['right',messages.fAlignColumnRight()],['deleteTable',messages.fDeleteTable()]];
  actions.forEach(([id,label],i)=>{
   let item=this.popup.children[i] as HTMLButtonElement|undefined;
   if(!item){item=document.createElement('button');item.type='button';item.tabIndex=-1;item.setAttribute('role','menuitem');item.dataset.menuAction=id;this.popup.append(item)}
   item.textContent=label;
  });
  const {rows,aligns}=parseTable(this.raw),count=rows[0].length;
  while(this.table.rows.length>rows.length)this.table.deleteRow(-1);
  rows.forEach((row,i)=>{
   const tr=this.table.rows[i]||this.table.insertRow();
   while(tr.cells.length>count)tr.deleteCell(-1);
   for(let j=0;j<count;j++){
    let cell=tr.cells[j];
    if(!cell){cell=document.createElement(i===0?'th':'td');tr.append(cell);this.bind(cell)}
    cell.dataset.row=String(i);cell.dataset.column=String(j);cell.contentEditable=String(!this.readOnly);cell.tabIndex=this.readOnly?-1:0;
    cell.setAttribute('role','textbox');cell.setAttribute('aria-label',i===0?messages.fTableHeaderCell(j+1):messages.fTableCell(i,j+1));cell.style.textAlign=aligns[j]||'left';
    const value=row[j]||'';
    // Own input already lives in this node. Never reset it or its DOM selection.
    if(cell!==this.composingCell&&!(this.committing&&cell===document.activeElement)&&cell.textContent!==value){
     const selection=window.getSelection(),active=cell===document.activeElement,offset=active&&selection?.anchorNode&&cell.contains(selection.anchorNode)?selection.anchorOffset:0;
     cell.textContent=value;
     if(active){const text=cell.firstChild||cell.appendChild(document.createTextNode(''));selection?.collapse(text,Math.min(offset,value.length))}
    }
   }
  });
  this.row=Math.min(this.row,rows.length-1);this.column=Math.min(this.column,count-1);
 }
 private bind(cell:HTMLTableCellElement){
  cell.addEventListener('click',e=>{
   if(e.button!==0||!(e.metaKey||e.ctrlKey)||e.altKey||e.shiftKey||this.blocked()||this.view.composing||this.disposed)return;
   const handlers=this.view.state.facet(tableLink);if(!handlers.length)return;
   const link=this.wikiLink(cell,e);if(!link)return;
   e.preventDefault();e.stopPropagation();for(const open of handlers)open(link.url);
  });
  cell.addEventListener('mousemove',e=>{
   cell.title=!this.blocked()&&!this.view.composing&&this.view.state.facet(tableLink).length&&this.wikiLink(cell,e)?messages.fCtrlClickToOpenTheLink(keyLabel('Mod')):'';
  });
  cell.addEventListener('focus',()=>{
   this.row=Number(cell.dataset.row);this.column=Number(cell.dataset.column);this.fresh=true;
   if(!this.blocked())this.view.dispatch({selection:{anchor:this.from+2},userEvent:'select.table'});
  });
  cell.addEventListener('input',()=>{if(!this.blocked())this.commit(cell)});
  cell.addEventListener('compositionstart',e=>{
   e.stopPropagation();this.composingCell=cell;this.menu.close();this.button.disabled=true;
   for(const notify of this.view.state.facet(tableComposition))notify(this.view,true);
  });
  cell.addEventListener('compositionend',e=>{
   e.stopPropagation();
   this.endTimer=setTimeout(()=>{
    if(this.disposed)return;
    const commit=()=>{this.composingCell=null;this.button.disabled=this.readOnly;this.commit(cell)};
    const handlers=this.view.state.facet(tableComposition);if(handlers.length)for(const notify of handlers)notify(this.view,false,commit);else commit();
   },0);
  });
  cell.addEventListener('beforeinput',e=>{if(e.inputType==='insertParagraph'||e.inputType==='insertLineBreak')e.preventDefault()});
  cell.addEventListener('paste',e=>{if(this.blocked())return;e.preventDefault();document.execCommand('insertText',false,(e.clipboardData?.getData('text/plain')||'').replace(/\r?\n/g,' '))});
  cell.addEventListener('keydown',e=>this.key(e));
 }
 private wikiLink(cell:HTMLTableCellElement,event:MouseEvent){
  const doc=cell.ownerDocument,caret=doc.caretPositionFromPoint?.(event.clientX,event.clientY),fallback=caret?null:doc.caretRangeFromPoint?.(event.clientX,event.clientY);
  const node=caret?.offsetNode||fallback?.startContainer,offset=caret?.offset??fallback?.startOffset;
  if(!node||offset===undefined||!cell.contains(node))return null;
  const range=doc.createRange();range.selectNodeContents(cell);range.setEnd(node,offset);
  const link=tableWikiLinkAt(this.view.state,this.from,Number(cell.dataset.row),Number(cell.dataset.column),cell.textContent||'',range.toString().length);
  if(!link)return null;
  // Caret APIs return the nearest text position even over padding. Check the actual link boxes.
  const walker=doc.createTreeWalker(cell,NodeFilter.SHOW_TEXT);let total=0,started=false;
  for(let text=walker.nextNode();text;text=walker.nextNode()){
   const end=total+(text.textContent?.length||0);
   if(!started&&link.from<=end){range.setStart(text,link.from-total);started=true}
   if(link.to<=end){
    range.setEnd(text,link.to-total);
    return Array.from(range.getClientRects()).some(r=>event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom)?link:null;
   }
   total=end;
  }
  return null;
 }
 private commit(cell:HTMLElement,annotations?:TransactionSpec['annotations']){
  if(this.blocked()||!cell.isConnected)return;
  const value=cell.textContent||'',row=Number(cell.dataset.row),column=Number(cell.dataset.column);
  if(value===(parseTable(this.raw).rows[row]?.[column]||''))return;
  this.committing=true;
  try{
   const spec=editTable(this.view.state,{from:this.from,to:this.from+this.raw.length},row,column,'cell',value);
   if(annotations)spec.annotations=annotations;else if(this.fresh)spec.annotations=isolateHistory.of('before');
   this.view.dispatch(spec);this.fresh=false;
  }finally{this.committing=false}
 }
 focus(row:number,column:number){
  row=Math.max(0,Math.min(row,this.table.rows.length-1));column=Math.max(0,Math.min(column,this.table.rows[0].cells.length-1));
  const cell=this.table.rows[row]?.cells[column];if(!cell||this.blocked())return;
  cell.focus();const range=document.createRange();range.selectNodeContents(cell);range.collapse(false);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
 }
 private leave(above=false){
  this.view.dispatch(leaveTable(this.view.state,{from:this.from,to:this.from+this.raw.length},above));this.view.focus();
  // Focus can drop the caret at the editor's start before CodeMirror has seen the cell's selection, and it then keeps it there; place it from the state.
  const {node,offset}=this.view.domAtPos(this.view.state.selection.main.head);getSelection()?.collapse(node,offset);
 }
 private change(action:TableAction){
  if(this.blocked())return;
  const row=this.row,column=this.column,from=this.from;
  this.view.dispatch(editTable(this.view.state,{from,to:from+this.raw.length},row,column,action));
  this.fresh=true;
  if(this.disposed){this.view.focus();return}
  this.focus(action==='rowBelow'?row+1:row,action==='columnRight'?column+1:column);
 }
 footnote(cell:HTMLElement){
  if(this.blocked())return;
  const sel=getSelection();if(!sel?.rangeCount||!cell.contains(sel.anchorNode)||!cell.contains(sel.focusNode))return;
  const r=sel.getRangeAt(0),before=document.createRange();before.selectNodeContents(cell);before.setEnd(r.startContainer,r.startOffset);
  const start=before.toString().length,end=start+r.toString().length,text=cell.textContent||'',row=Number(cell.dataset.row),column=Number(cell.dataset.column),from=this.from;
  return ()=>insertFootnote(this.view.state,ref=>editTable(this.view.state,{from,to:from+this.raw.length},row,column,'cell',text.slice(0,start)+ref+text.slice(end)));
 }
 format(cell:HTMLElement,id:string){
  if(this.blocked())return;
  const sel=getSelection();if(!sel?.rangeCount||!cell.contains(sel.anchorNode)||!cell.contains(sel.focusNode))return;
  const r=sel.getRangeAt(0),before=document.createRange();before.selectNodeContents(cell);before.setEnd(r.startContainer,r.startOffset);
  const text=cell.textContent||'',start=before.toString().length,end=start+r.toString().length;
  const state=EditorState.create({doc:text,selection:{anchor:start,head:end},extensions:markdown({base:markdownLanguage,extensions:[GFM,Highlight]})});
  const marks=id==='link'?['[',']()']:inlineMarkers[id];
  const spec=id==='math'?insertMath(state,true):id==='clearFormatting'?clearFormatting(state):marks?wrapSelection(state,marks[0],marks[1]):null;if(!spec)return;
  const next=state.update(spec).state;cell.textContent=next.doc.toString();
  const node=cell.firstChild||cell.appendChild(document.createTextNode('')),range=document.createRange();range.setStart(node,next.selection.main.from);range.setEnd(node,next.selection.main.to);sel.removeAllRanges();sel.addRange(range);
  this.commit(cell,spec.annotations);
 }
 private key(e:KeyboardEvent){
  if(e.isComposing||this.blocked())return;
  if((e.metaKey||e.ctrlKey)&&['z','y'].includes(e.key.toLowerCase())){
   e.preventDefault();e.stopPropagation();(e.key.toLowerCase()==='y'||e.shiftKey?redo:undo)(this.view);this.fresh=true;return;
  }
  if((e.metaKey||e.ctrlKey)&&e.key==='/'){e.preventDefault();e.stopPropagation();this.menu.open();return}
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey){
   const cell=e.currentTarget as HTMLElement,k=e.key.toLowerCase();
   // Browsers select the whole editor for ⌘A inside a nested editable cell; keep it to the cell.
   if(k==='a'){e.preventDefault();e.stopPropagation();getSelection()?.selectAllChildren(cell);return}
   // Format shortcuts apply to the cell's text, never to the document behind the table.
   const action=({b:'bold',i:'italic',u:'underline',l:'link'} as Record<string,string>)[k];
   if(action){e.preventDefault();e.stopPropagation();this.format(cell,action);return}
  }
  if(e.altKey||e.metaKey||e.ctrlKey)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.leave();return}
  const rows=this.table.rows.length,columns=this.table.rows[0].cells.length;
  if(e.key==='Tab'){
   e.preventDefault();e.stopPropagation();const index=this.row*columns+this.column+(e.shiftKey?-1:1);
   if(index<0)this.leave(true);
   else if(index>=rows*columns){this.change('rowBelow');this.focus(rows,0)}
   else this.focus(Math.floor(index/columns),index%columns);
  }else if(e.key==='ArrowUp'||e.key==='ArrowDown'){
   e.preventDefault();e.stopPropagation();const row=this.row+(e.key==='ArrowUp'?-1:1);
   if(row<0||row>=rows)this.leave(row<0);else this.focus(row,this.column);
  }else if(e.key==='Enter'){e.preventDefault();e.stopPropagation()}
 }
 destroy(){this.disposed=true;clearTimeout(this.endTimer);this.menu.destroy();this.popup.remove()}
}
