import {EditorState,StateEffect,StateField,Prec,type TransactionSpec} from '@codemirror/state';
import {EditorView,ViewPlugin,keymap,type ViewUpdate} from '@codemirror/view';
import {isolateHistory} from '@codemirror/commands';
import {blockRichMode} from './block-ui';
import {blockFormat,setHeading,insertTable} from './editing';
import {blockAt,insertParagraphBelow} from './blocks';
import {focusTableCell} from './table-ui';
import {messages} from './i18n';
import {messagesIn,type Messages} from '../locales';

export type SlashItemID='paragraph'|'h1'|'h2'|'h3'|'bullet'|'ordered'|'task'|'quote'|'code'|'math'|'table'|'image'|'rule'|'note';
interface SlashItem {id:SlashItemID;label:keyof Messages;keywords:string}
const items:SlashItem[]=[
 {id:'paragraph',label:'fBody',keywords:'zhengwen zw body paragraph text'},
 {id:'h1',label:'fHeading1',keywords:'biaoti1 bt1 heading h1'},
 {id:'h2',label:'fHeading2',keywords:'biaoti2 bt2 heading h2'},
 {id:'h3',label:'fHeading3',keywords:'biaoti3 bt3 heading h3'},
 {id:'bullet',label:'fBulletedList',keywords:'wuxuliebiao wxlb wx bullet bulleted unordered list'},
 {id:'ordered',label:'fNumberedList',keywords:'youxuliebiao yxlb yx ordered numbered list'},
 {id:'task',label:'fTaskList',keywords:'renwuliebiao rwlb rw task todo checklist'},
 {id:'quote',label:'fBlockquote',keywords:'yinyong yy quote blockquote'},
 {id:'code',label:'fCodeBlock',keywords:'daimakuai dmk dm code fenced codeblock'},
 {id:'math',label:'fFormula',keywords:'gongshi gs math formula latex katex tex'},
 {id:'table',label:'fTable',keywords:'biaoge bg table'},
 {id:'image',label:'fImage',keywords:'tupian tp image picture photo'},
 {id:'rule',label:'fHorizontalRule',keywords:'fengexian fgx horizontal rule divider separator'},
 {id:'note',label:'fCallout',keywords:'tishikuai tsk callout note alert'},
];
const zh=messagesIn('zh-Hans'),en=messagesIn('en');
const label=(catalog:Messages,item:SlashItem)=>(catalog[item.label] as ()=>string)();
export function filterSlashItems(query:string):SlashItem[]{
 const q=query.trim().toLowerCase();if(!q)return items.slice();
 const score=(item:SlashItem)=>{
  const words=[label(zh,item),label(en,item),...item.keywords.split(' ')].map(word=>word.toLowerCase());
  return words.some(word=>word===q)?0:words.some(word=>word.startsWith(q))?1:words.some(word=>word.includes(q))?2:3;
 };
 return items.map(item=>({item,score:score(item)})).filter(match=>match.score<3).sort((a,b)=>a.score-b.score).map(match=>match.item);
}
export const slashOpen=StateEffect.define<null>(),slashClose=StateEffect.define<null>(),slashSelect=StateEffect.define<number>();
interface SlashState {from:number;start:number;query:string;items:SlashItem[];index:number}
export function createSlashState(composing:StateField<boolean>,focus:StateField<boolean>){
 const enabled=(state:EditorState)=>state.facet(blockRichMode)&&!state.readOnly&&!state.field(composing)&&!state.field(focus);
 function read(state:EditorState,from:number,start:number,index=0):SlashState|null{
  const sel=state.selection.main;if(!sel.empty||sel.head<start||start<from)return null;
  const line=state.doc.lineAt(sel.head);if(line.from!==from||state.sliceDoc(sel.head,line.to).trim())return null;
  const query=state.sliceDoc(start,sel.head),matches=filterSlashItems(query);
  return matches.length?{from,start,query,items:matches,index:Math.min(index,matches.length-1)}:null;
 }
 return StateField.define<SlashState|null>({
  create:()=>null,
  update(value,tr){
   if(!enabled(tr.state))return null;
   for(const effect of tr.effects){
    if(effect.is(slashClose))return null;
    if(effect.is(slashOpen)){
     const sel=tr.state.selection.main,line=tr.state.doc.lineAt(sel.head);
     return sel.empty&&!line.text.trim()?read(tr.state,line.from,sel.head):null;
    }
    if(effect.is(slashSelect)&&value)return {...value,index:(effect.value+value.items.length)%value.items.length};
   }
   if(value){
    if(!tr.docChanged)return tr.selection?null:value;
    if(!tr.isUserEvent('input.type')&&!tr.isUserEvent('delete'))return null;
    let valid=true;const oldLine=tr.startState.doc.lineAt(value.from);
    tr.changes.iterChanges((from,to,_a,_b,text)=>{if(from<value.start||to>oldLine.to||text.lines>1)valid=false});
    if(!valid)return null;
    return read(tr.state,value.from,value.start,0);
   }
   if(!enabled(tr.startState)||!tr.isUserEvent('input.type'))return null;
   const sel=tr.startState.selection.main;if(!sel.empty)return null;
   const line=tr.startState.doc.lineAt(sel.head);if(line.text.trim())return null;
   let start=-1,count=0;
   tr.changes.iterChanges((from,to,_a,toB,text)=>{count++;if(from===sel.head&&to===from&&/^[\/\u3001]$/.test(text.toString()))start=toB});
   return count===1&&start>=0?read(tr.state,line.from,start):null;
  }
 });
}
export function applySlashItem(state:EditorState,id:SlashItemID):TransactionSpec{
 const line=state.doc.lineAt(state.selection.main.head),empty=EditorState.create();let insert='',cursor=0;
 if(id==='paragraph'||/^h[123]$/.test(id))insert=empty.update(setHeading(empty,id==='paragraph'?0:Number(id[1]))).state.doc.toString();
 else if(['bullet','ordered','task','quote'].includes(id))insert=empty.update(blockFormat(empty,id as 'bullet'|'ordered'|'task'|'quote',true)).state.doc.toString();
 else if(id==='code')insert='```\n\n```';
 else if(id==='math')insert='$$\n\n$$';
 else if(id==='table')return {...insertTable(state,{from:line.from,to:line.to},false),userEvent:'input.slash'};
 else if(id==='rule')insert='---\n\n';
 else if(id==='note')insert='> [!NOTE]\n> ';
 cursor=id==='code'?4:id==='math'?3:insert.length;
 return {changes:{from:line.from,to:line.to,insert},selection:{anchor:line.from+cursor},userEvent:'input.slash',annotations:isolateHistory.of('full'),scrollIntoView:true};
}

// Toolbar insertion shares slash templates, but can start below an existing block or focused table.
export function insertToolbarItem(state:EditorState,id:SlashItemID,below?:{from:number;to:number}):TransactionSpec{
 const line=state.doc.lineAt(state.selection.main.head);
 if(!below&&!line.text.trim())return applySlashItem(state,id);
 const range=below||blockAt(state,state.selection.main.head)||{from:line.from,to:line.to};
 let opening=insertParagraphBelow(state,range);
 if(!opening.changes)opening={changes:{from:range.to,insert:'\n\n'+(range.to<state.doc.length?'\n':'')},selection:{anchor:range.to+2}};
 const first=state.update(opening),next=first.state.update(applySlashItem(first.state,id));
 return {changes:first.changes.compose(next.changes),selection:next.state.selection,userEvent:'input.slash',annotations:isolateHistory.of('full'),scrollIntoView:true};
}

const controls=new WeakMap<EditorView,SlashMenu>();
export function openSlashMenu(view:EditorView){view.dispatch({effects:slashOpen.of(null)});view.focus()}
export function createSlashMenu(composing:StateField<boolean>,focus:StateField<boolean>,image:()=>void){
 const field=createSlashState(composing,focus);
 const plugin=ViewPlugin.define(view=>new SlashMenu(view,field,composing,image));
 const command=(key:string)=>(view:EditorView)=>controls.get(view)?.key(key)||false;
 return [field,plugin,Prec.highest(keymap.of(['ArrowUp','ArrowDown','Enter','Tab','Escape'].map(key=>({key,run:command(key)}))))];
}
class SlashMenu {
 private menu=document.createElement('div');
 private abort=new AbortController();
 constructor(private view:EditorView,private field:StateField<SlashState|null>,private composing:StateField<boolean>,private image:()=>void){
  controls.set(view,this);this.menu.id='slash-menu';this.menu.className='menu slash-menu';this.menu.hidden=true;this.menu.setAttribute('role','listbox');document.body.append(this.menu);
  const signal=this.abort.signal;
  this.menu.addEventListener('pointerdown',e=>e.preventDefault(),{signal});
  this.menu.addEventListener('click',e=>{const option=(e.target as HTMLElement).closest<HTMLElement>('[role=option]');if(option)this.apply(option.dataset.slashItem as SlashItemID)},{signal});
  document.addEventListener('pointerdown',e=>{if(!this.menu.hidden&&!this.menu.contains(e.target as Node))this.close()},{signal});
  document.addEventListener('focusin',e=>{if(!this.menu.hidden&&!view.dom.contains(e.target as Node))this.close()},{signal});
  window.addEventListener('blur',()=>this.close(),{signal});
  window.addEventListener('resize',()=>this.position(),{signal});
  view.scrollDOM.closest('.editor-scroll')?.addEventListener('scroll',()=>this.position(),{passive:true,signal});
  this.render();
 }
 private close(){if(this.view.state.field(this.field))this.view.dispatch({effects:slashClose.of(null)})}
 private active(){return !this.view.composing&&!this.view.state.field(this.composing)&&!this.view.state.readOnly?this.view.state.field(this.field):null}
 private apply(id:SlashItemID){
  if(!this.active())return;
  this.view.dispatch(applySlashItem(this.view.state,id));if(id!=='table'||!focusTableCell(this.view))this.view.focus();if(id==='image')this.image();
 }
 key(key:string){
  const value=this.active();if(!value)return false;
  if(key==='Escape')this.close();
  else if(key==='ArrowDown'||key==='ArrowUp')this.view.dispatch({effects:slashSelect.of(value.index+(key==='ArrowDown'?1:-1))});
  else this.apply(value.items[value.index].id);
  return true;
 }
 update(u:ViewUpdate){if(u.startState.field(this.field)!==u.state.field(this.field)||u.transactions.some(tr=>tr.reconfigured))this.render();else if(u.geometryChanged)this.position()}
 private render(){
  const value=this.active(),content=this.view.contentDOM;this.menu.hidden=!value;
  if(!value){for(const attr of ['aria-activedescendant','aria-controls','aria-autocomplete'])content.removeAttribute(attr);content.setAttribute('aria-expanded','false');return}
  this.menu.setAttribute('aria-label',messages.fInsertBlock());
  this.menu.replaceChildren(...value.items.map((item,i)=>{
   const button=document.createElement('button');button.type='button';button.tabIndex=-1;button.id='slash-option-'+item.id;button.dataset.slashItem=item.id;button.setAttribute('role','option');button.setAttribute('aria-selected',String(i===value.index));button.textContent=label(messages,item);return button;
  }));
  content.setAttribute('aria-controls',this.menu.id);content.setAttribute('aria-autocomplete','list');content.setAttribute('aria-expanded','true');content.setAttribute('aria-activedescendant','slash-option-'+value.items[value.index].id);
  this.menu.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({block:'nearest'});this.position();
 }
 private position(){
  if(this.menu.hidden)return;
  this.view.requestMeasure({key:this,read:()=>({coords:this.view.coordsAtPos(this.view.state.selection.main.head),width:this.menu.offsetWidth,height:this.menu.offsetHeight}),write:({coords,width,height})=>{
   if(!coords||this.menu.hidden)return;
   this.menu.style.left=Math.max(8,Math.min(coords.left,innerWidth-width-8))+'px';
   this.menu.style.top=Math.max(8,Math.min(coords.bottom+6,innerHeight-height-8))+'px';
  }});
 }
 destroy(){controls.delete(this.view);this.abort.abort();this.menu.remove();for(const attr of ['aria-activedescendant','aria-controls','aria-autocomplete','aria-expanded'])this.view.contentDOM.removeAttribute(attr)}
}
