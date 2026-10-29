import {EditorView} from '@codemirror/view';
import {SearchQuery,search,openSearchPanel,closeSearchPanel,setSearchQuery,replaceNext,replaceAll} from '@codemirror/search';
import {isolateHistory} from '@codemirror/commands';
import {messages} from './i18n';
import {icon} from './icons';
import {findMatches} from './find-query';
import {createReaderFind} from './reader-find';

// CodeMirror owns matching decorations and undoable replacements; the shared
// floating panel owns the UI in both editing and reading layouts.
export const documentSearch=search({createPanel:()=>{const dom=document.createElement('div');dom.className='document-find-engine';dom.hidden=true;return {dom,top:true}}});
export function createDocumentFind(options:{getView:()=>EditorView;reading:()=>boolean;blocked:()=>boolean;focusContent:()=>void;host:HTMLElement;scroll:HTMLElement}){
 const bar=document.createElement('section');bar.id='document-find';bar.hidden=true;bar.setAttribute('role','search');
 const row=document.createElement('div');row.className='find-row';
 const input=document.createElement('input');input.id='find-query';input.type='text';input.autocomplete='off';input.spellcheck=false;
 const field=document.createElement('div');field.className='find-field';field.append(icon('find'),input);
 const count=document.createElement('span');count.id='find-count';count.setAttribute('role','status');count.setAttribute('aria-live','polite');
 const button=(id:string,text:string,run:()=>void,iconName='')=>{
  const b=document.createElement('button');b.type='button';b.id=id;b.className='find-control';if(iconName)b.append(icon(iconName));else b.textContent=text;b.onclick=run;return b;
 };
 const previous=button('find-previous','',()=>move(-1),'chevron-up'),next=button('find-next','',()=>move(1),'chevron-down');
 const caseButton=button('find-case','Aa',()=>toggle('caseSensitive')),wordButton=button('find-word','ab',()=>toggle('wholeWord')),regexpButton=button('find-regexp','.*',()=>toggle('regexp'));
 const toggles=document.createElement('div');toggles.className='find-options';toggles.append(caseButton,wordButton,regexpButton);
 const replaceToggle=button('find-replace-toggle','',()=>{expanded=!expanded;render();if(expanded)replacement.focus()});
 const replaceLabel=document.createElement('span');replaceToggle.append(replaceLabel,icon('chevron-down'));
 const close=button('find-close','',()=>hide(),'close');
 row.append(field,close);
 const footer=document.createElement('div');footer.className='find-footer';
 const navigation=document.createElement('div');navigation.className='find-navigation';navigation.append(previous,next);
 footer.append(toggles,replaceToggle,count,navigation);
 const replaceRow=document.createElement('div');replaceRow.id='find-replace-row';replaceRow.className='find-row';
 const replacement=document.createElement('input');replacement.id='find-replacement';replacement.type='text';replacement.spellcheck=false;replacement.autocomplete='off';
 const replacementField=document.createElement('div');replacementField.className='find-field';replacementField.append(replacement);
 const replace=button('find-replace-next','',()=>replaceMatch(false)),all=button('find-replace-all','',()=>replaceMatch(true));
 replaceRow.append(replacementField,replace,all);bar.append(row,replaceRow,footer);
 document.body.append(bar);
 const entry=document.querySelector<HTMLElement>('#document-find-button')!;
 const desk=document.querySelector<HTMLElement>('.desk')!;
 const position=()=>{if(!bar.hidden)bar.style.top=`${desk.getBoundingClientRect().top+8}px`};
 new ResizeObserver(position).observe(desk);
 let expanded=false,caseSensitive=false,wholeWord=false,regexp=false,frame=0,composing=false;
 let editorDocument:EditorView['state']['doc']|undefined,editorQuery:SearchQuery|undefined,result:ReturnType<typeof findMatches>={matches:[],limited:false};
 const query=()=>new SearchQuery({search:input.value,replace:replacement.value,caseSensitive,wholeWord,regexp,literal:true});
 const reader=createReaderFind(options.host,options.scroll,()=>render());
 const editorResult=()=>{
  const view=options.getView(),q=query();
  if(editorDocument!==view.state.doc||!editorQuery?.eq(q)){result=findMatches(q,view.state);editorDocument=view.state.doc;editorQuery=q}
  const selection=view.state.selection.main;
  return {...result,index:result.matches.findIndex(m=>m.from===selection.from&&m.to===selection.to)};
 };
 function render(){
  const q=query(),read=options.reading(),r=read?reader.result:editorResult(),valid=q.valid;
  const invalid=!!q.search&&!valid;
  bar.setAttribute('aria-label',messages.fFindInDocument());input.placeholder=messages.fFindInDocument();input.setAttribute('aria-label',messages.fFindInDocument());input.setAttribute('aria-invalid',String(invalid));
  count.textContent=invalid?messages.fFindInvalidRegexp():!q.search?'':!r.matches.length?messages.fFindNoMatches():`${Math.max(0,r.index+1)} / ${r.matches.length}${r.limited?'+':''}`;
  count.classList.toggle('find-error',invalid||!!q.search&&!r.matches.length);
  count.classList.toggle('find-invalid',invalid);
  previous.disabled=next.disabled=!valid||!r.matches.length;
  for(const [b,label,on] of [[caseButton,messages.fMatchCase(),caseSensitive],[wordButton,messages.fWholeWord(),wholeWord],[regexpButton,messages.fRegexp(),regexp]] as const){b.setAttribute('aria-label',label);b.dataset.tip=label;b.setAttribute('aria-pressed',String(on))}
  previous.setAttribute('aria-label',messages.fPrevious());previous.dataset.tip=messages.fPrevious();next.setAttribute('aria-label',messages.fNext());next.dataset.tip=messages.fNext();
  close.setAttribute('aria-label',messages.fClose());close.dataset.tip=messages.fClose();close.dataset.shortcut='Esc';
  previous.dataset.shortcut='Shift+Enter';next.dataset.shortcut='Enter';
  replaceLabel.textContent=messages.fReplace();replaceToggle.hidden=read;replaceToggle.setAttribute('aria-expanded',String(expanded&&!read));replaceToggle.setAttribute('aria-controls','find-replace-row');
  replaceRow.hidden=read||!expanded;replacement.placeholder=messages.fReplace();replacement.setAttribute('aria-label',messages.fReplace());
  replace.textContent=messages.fReplace();all.textContent=messages.fReplaceAll();replace.disabled=all.disabled=read||options.blocked()||!valid||!r.matches.length;
  entry.setAttribute('aria-expanded',String(!bar.hidden));
  position();
 }
 function sync(select=false){
  if(bar.hidden)return;
  const q=query(),view=options.getView(),read=options.reading();
  if(read)closeSearchPanel(view);else {openSearchPanel(view);view.dispatch({effects:setSearchQuery.of(q)})}
  reader.set(q,read,select);render();
  if(select&&!read){const first=editorResult().matches[0];if(first)view.dispatch({selection:{anchor:first.from,head:first.to},scrollIntoView:true});render()}
 }
 function toggle(option:'caseSensitive'|'wholeWord'|'regexp'){
  if(option==='caseSensitive')caseSensitive=!caseSensitive;else if(option==='wholeWord')wholeWord=!wholeWord;else regexp=!regexp;
  sync(true);input.focus();
 }
 function move(direction:1|-1){
  if(bar.hidden||composing||options.blocked())return;
  if(options.reading()){reader.move(direction);return}
  const view=options.getView(),r=editorResult();
  if(!r.matches.length)return;
  const index=r.index<0?(direction===1?0:r.matches.length-1):(r.index+direction+r.matches.length)%r.matches.length,match=r.matches[index];
  view.dispatch({selection:{anchor:match.from,head:match.to},scrollIntoView:true});render();
 }
 function replaceMatch(every:boolean){
  const view=options.getView();
  if(bar.hidden||composing||options.reading()||options.blocked()||view.composing||view.state.readOnly||!query().valid)return;
  view.dispatch({effects:setSearchQuery.of(query()),annotations:isolateHistory.of('before')});
  (every?replaceAll:replaceNext)(view);
  view.dispatch({annotations:isolateHistory.of('after')});render();
 }
 function hide(){
  bar.hidden=true;reader.set(query(),false);closeSearchPanel(options.getView());render();options.focusContent();
 }
 input.oninput=()=>{if(!composing&&!options.blocked())sync(true)};
 bar.addEventListener('compositionstart',()=>{composing=true});
 bar.addEventListener('compositionend',()=>{composing=false;sync(true)});
 replacement.oninput=()=>sync();
 bar.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide()}
  else if(event.key==='Enter'&&(event.target===input||event.target===replacement)){event.preventDefault();if(event.target===replacement)replaceMatch(false);else move(event.shiftKey?-1:1)}
 });
 return {
  open(){
   if(options.blocked())return;
   const wasHidden=bar.hidden;bar.hidden=false;sync(wasHidden);input.focus();input.select();
  },
  close:hide,
  get opened(){return !bar.hidden},
  move,
  refresh(){if(bar.hidden){closeSearchPanel(options.getView());return}sync(true)},
  changed(content:boolean){
   if(bar.hidden||options.reading()||frame)return;
   frame=requestAnimationFrame(()=>{frame=0;if(!bar.hidden&&!options.reading()){if(content)editorDocument=undefined;render()}});
  },
  localize:render,
 };
}
