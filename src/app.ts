import {messages,pageLocale,localizePage,onPageLocaleChange,setPageLocale,statusText,statusFailed,noticeText,localizedError} from './i18n';
import {call,desktop,type Summary,type LocaleNotice,type Doc,type DocStatus,type WorkspaceState,type Appearance,type ImageResult,type ExportResult,type CaptureAppendResult} from './types';
import {createEditor,mode,editorLocale,localizedEditor,richExtensions,setFocus,undo,redo,EditorState,EditorView} from './editor';
import {createDocumentFind} from './document-find';
import {createSidebarSearch,validSearchTarget} from './search';
import {createBacklinks} from './backlinks';
import {wikiTarget} from './wiki-links';
import {createWikiChooser} from './wiki-chooser';
import type {SearchItem,SearchHit,SearchResponse,BacklinkResponse,DocumentFilterResponse,DocumentFilterRequest,WikiResolveRequest} from './types';
import {tagButtons} from './tag-filter';
import {blockAt,convertBlocks,duplicateBlocks,deleteBlocks,moveBlocks,insertParagraphBelow,type BlockConversion} from './blocks';
import {blockControls} from './block-ui';
import {focusTableCell,focusedTableRange,formatTableCell,tableFootnote,leaveTable,tableAround} from './table-ui';
import {focusedImageRange} from './image-ui';
import {imageRanges} from './images';
import {leaveBlock} from './block-navigation';
import {filterSlashItems,insertToolbarItem,type SlashItemID,openSlashMenu} from './slash';
import {Transaction,Compartment,StateEffect,type Text} from '@codemirror/state';
import {blockFormat,setHeading,headingLevel,inlineMarkers,clearFormatting,inList,indentList,wrapSelection,insertMath,codeBlock,linkAt,makeLink,safeLink,localDocumentLink,insertTable,headings,type BlockKind} from './editing';
import {isolateHistory} from '@codemirror/commands';
import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import {applyIcons,icon} from './icons';
import {mac,windows,keyLabel,focusKeys,redoKeys} from './platform';
import {shortcuts,shortcutAction,ariaKeys} from './shortcuts';
import {attachTooltips} from './tooltip';
import {attachMenu} from './menu';
import {insertFootnote} from './extras';
import {disposeMermaid} from './mermaid';
import {renderDelivery,waitImages,copyRich,type Delivery} from './delivery';
import {createPreviewController,type PreviewController} from './preview';
import {normalizeImageDestination} from './markdown';
import {countWords} from './stats';
import {captureSettingsDialog} from './capture-settings';
import {appearanceSettings,themeText} from './appearance-settings';
import {pasteText,dataUrlBlob,type PasteImage} from './paste';
import {themes,isDark,resolveTheme,paintTheme,watchTheme,type ThemeID} from './theme';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>Array.from(document.querySelectorAll<HTMLElement>(s));
const node=(tag:string,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n};
let state:WorkspaceState,doc:Doc,view:EditorView,appearance:Appearance,source=false,loading=false,busy=false,dirty=false;
let timer:ReturnType<typeof setTimeout>,toastTimer:ReturnType<typeof setTimeout>,saveFlight:Promise<boolean>|null=null;
let wordCountTimer:ReturnType<typeof setTimeout>;
let generation=0,savedPosition='',closeRequested=false;
let quarantineReveal='',bannerKind:'error'|'conflict'|'notice'='error';
let localePending=false;
let retainedNotices:LocaleNotice[]=[];
let failedSaveError:unknown;
let readyData:Delivery|null=null;
let removeID='',removeUntil=0,removeTimer:ReturnType<typeof setTimeout>;
let appearanceQueue:Promise<void>=Promise.resolve();
let pendingAppearance:Partial<Appearance>|null=null;
let preview:PreviewController;
let documentFind:ReturnType<typeof createDocumentFind>;
let sidebarSearch:ReturnType<typeof createSidebarSearch>;
let backlinks:ReturnType<typeof createBacklinks>;
let navigationEpoch=0;
let layoutBeforeRead:Appearance['layout'];
const editLock=new Compartment();
const openedQueue:string[]=[];
let compositionActive=false,focusMode=false;let pendingClose=false;let pendingMissing:()=>Promise<void>=async()=>{};let prepared:HTMLElement|null=null,readyAction='';let editRange:{from:number;to:number;raw?:string}|null=null;
const sessions=new Map<string,EditorState>();
const imageCache=new Map<string,Promise<string>>();
const imageKey=(id:string,dest:string)=>id+':'+normalizeImageDestination(dest);
const mq=matchMedia('(prefers-color-scheme:dark)'),reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
const dockQuery=matchMedia('(min-width:1180px)');
let overlayOpen=false;
let outlineHeadings:ReturnType<typeof headings>=[],outlineTimer:ReturnType<typeof setTimeout>,outlineFrame=0;
document.documentElement.classList.toggle('windows',windows);if(windows)$('#reveal-quarantine').dataset.i18n='fShowInFileExplorer';
if(desktop){document.body.classList.add('desktop');$('#command-search').dataset.i18nPlaceholder='fSearchCommands'}else $('#workspace-label').hidden=false;
const errorText=localizedError;
function toast(s:string,label='',activate?:()=>void){$('#toast').textContent=s;if(activate){const b=node('button','',label);b.onclick=activate;$('#toast').append(b)}$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200)}
function showNotices(next:WorkspaceState){retainedNotices=next.noticeMessages||next.notices?.map(text=>({text}))||[];banner(retainedNotices.map(noticeText).join('; '),'notice',next.quarantineDir)}
function banner(s='',kind:'error'|'conflict'|'notice'='error',reveal=''){bannerKind=kind;$('#banner').hidden=!s;$('#banner-text').textContent=s;$('#retry-save').hidden=kind!=='error';$('#banner-save-as').hidden=kind==='notice';$('#reload-disk').hidden=kind!=='conflict';$('#overwrite-disk').hidden=kind!=='conflict';quarantineReveal=kind==='notice'?reveal:'';$('#reveal-quarantine').hidden=!desktop||!quarantineReveal}
$('#reveal-quarantine').onclick=()=>{if(quarantineReveal)void call('Reveal',quarantineReveal).catch(e=>toast(errorText(e)))};
const split=()=>appearance?.layout==='split';
const reading=()=>appearance?.layout==='read';
function focusContent(){if(reading())$('.preview-scroll').focus();else view.focus()}
const sourceActive=()=>split()&&source;
function position(){const r=view.state.selection.main;return {anchor:r.anchor,head:r.head,scroll:$('.editor-scroll').scrollTop,source:false}}
function header(){if(!doc)return;const isSplit=split(),isSource=sourceActive();$('#doc-title').textContent=doc.title;$('#save-status').textContent=dirty?(compositionActive?messages.fTyping():messages.fUnsaved()):statusText(doc);const current=reading()?'read':isSplit?'split':'single';$$('[data-view]').forEach(b=>{const checked=b.dataset.view===current;b.setAttribute('aria-checked',String(checked));b.tabIndex=checked?0:-1});const sourceItem=$('[data-menu-action=source]');sourceItem.setAttribute('aria-checked',String(isSource));sourceItem.setAttribute('aria-disabled',String(!isSplit));sourceItem.querySelector('small')!.hidden=isSplit;$('[data-menu-action=focus]').setAttribute('aria-disabled',String(reading()));const sourceButton=$('#format-bar [data-action=source]');sourceButton.hidden=!isSplit;$('.format-source-sep').hidden=!isSplit;sourceButton.setAttribute('aria-pressed',String(isSource));updateHeading();$('.paper').classList.toggle('source-mode',isSource)}
function updateHeading(){
 const image=!!focusedImageRange(view),cell=!!focusedTableRange(view);
 $<HTMLButtonElement>('#heading-button').disabled=cell||image;
 for(const id of ['quote','bullet','ordered','task','indent','outdent']){
  const b=$<HTMLButtonElement>('#format-bar [data-action='+id+']');if(b)b.disabled=cell||image||(['indent','outdent'].includes(id)&&!inList(view.state));
 }
 for(const id of [...Object.keys(inlineMarkers),'clearFormatting','link']){const b=$<HTMLButtonElement>('#format-bar [data-action='+id+']');if(b)b.disabled=image}
 const level=headingLevel(view.state);$('#heading-label').textContent=level?messages.fHeading(level):messages.fBody();
 $$('#heading-menu [data-menu-action]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.menuAction===(level?'h'+level:'paragraph'))));
}
// A worker counts; the page counts itself only where no worker runs. The last count is kept with its text, so a language change relabels it at once.
let wordJob=0,wordWorker:Worker|null|undefined,counted:{doc:Text;count:number}|null=null;const wordAsked=new Map<number,Text>();
function showWords(count:number){$('#word-count').textContent=messages.fWordCount(count)}
function wordCounter(){
 if(wordWorker===undefined)try{
  wordWorker=new Worker('stats-worker.js');
  wordWorker.onmessage=(event:MessageEvent<{job:number;count:number}>)=>{const doc=wordAsked.get(event.data.job);wordAsked.delete(event.data.job);if(doc&&event.data.job===wordJob){counted={doc,count:event.data.count};showWords(event.data.count)}};
  wordWorker.onerror=()=>{wordWorker?.terminate();wordWorker=null;wordAsked.clear();scheduleWordCount(true)};
 }catch{wordWorker=null}
 return wordWorker;
}
function scheduleWordCount(immediate=false){
 clearTimeout(wordCountTimer);
 const update=()=>{
  const doc=view.state.doc,job=++wordJob,worker=wordCounter();
  if(counted?.doc===doc)showWords(counted.count);
  else if(worker){wordAsked.set(job,doc);worker.postMessage({job,text:doc.toString()})}
  else{counted={doc,count:countWords(doc.toString())};showWords(counted.count)}
 };
 if(immediate)update();else wordCountTimer=setTimeout(update,400);
}
function syncBacklinks(){if(doc)backlinks?.context(doc.id,doc.revision,dirty||compositionActive||!!view?.composing)}
let pendingSent=false;function syncPending(){syncBacklinks();const pending=dirty||compositionActive||busy||!!saveFlight;if(pending===pendingSent||!desktop)return;pendingSent=pending;void call('SetPending',pending).catch(()=>{pendingSent=!pending})}
function changed(content=true){if(loading||!doc)return;updateHeading();if(content){dirty=true;generation++;sidebarSearch?.contentPending();header();scheduleWordCount()}documentFind?.changed(content);preview.changed(content,view.state.doc.lineAt(view.state.selection.main.head).number-1);if(content)scheduleOutline();else scheduleOutlineLayout();clearTimeout(timer);if(!compositionActive)timer=setTimeout(()=>void save(),content?450:800);syncPending()}
function composition(active:boolean){if(active)navigationEpoch++;compositionActive=active;if(!active&&localePending){localePending=false;refreshLanguage()}preview.composition(active);if(active)clearTimeout(outlineTimer);else scheduleOutline();clearTimeout(timer);if(!active){timer=setTimeout(()=>void save(),800);if(pendingClose){pendingClose=false;void closeApp()}else void processOpened()}syncPending()}
function reconfigure(){view.dispatch({effects:mode.reconfigure(sourceActive()?[]:richExtensions(resolveImage)),annotations:Transaction.addToHistory.of(false)})}
// force: an explicit save or retry resends the content so a failed file write is retried.
async function save(force=false):Promise<boolean>{
 clearTimeout(timer);if(compositionActive)return false;if(saveFlight){const pending=await saveFlight;if(!pending&&dirty)return false;if(dirty||force)return save(force);return true}if(!doc||!view)return true;
 const pos=position();if(!force&&!dirty&&JSON.stringify(pos)===savedPosition)return true;
 const id=doc.id,stamp=generation,positionOnly=!dirty&&!force,content=positionOnly?'':view.state.doc.toString();if(dirty)$('#save-status').textContent=messages.fSaving();
 saveFlight=(async()=>{try{
  if(positionOnly){await call('SavePosition',id,pos);if(doc.id===id){doc.position=pos;savedPosition=JSON.stringify(pos)}return true}
  const result=await call<Doc>('Update',{id,revision:doc.revision,content,position:pos});
  if(doc.id!==id)return true;doc.revision=result.revision;doc.status=result.status;doc.statusCode=result.statusCode;failedSaveError=undefined;doc.conflict=result.conflict;doc.title=result.title;doc.customTitle=result.customTitle;doc.content=content;doc.position=pos;doc.updated=result.updated;
  if(stamp===generation)dirty=false;savedPosition=JSON.stringify(pos);header();preview.saved();sidebarSearch?.contentAccepted(dirty);
  if(result.conflict||statusFailed(result))banner(statusText(result),result.conflict?'conflict':'error');else banner();return true;
 }catch(e){if(positionOnly)return true;failedSaveError=e;banner(messages.fSaveError(errorText(e)),'error');$('#save-status').textContent=messages.fSaveFailedYourTextIsStillHere();dirty=true;sidebarSearch?.contentFailed();return false}finally{saveFlight=null;syncPending()}})();syncPending();const ok=await saveFlight;if(ok&&dirty)return save();return ok;
}
async function saveForAction(){const ok=await save();if(!ok&&dirty){toast(messages.fTrySavingAgainYourTextIsStillHere());return false}await appearanceQueue.catch(()=>{});return true}
window.liubaiAppendCapture=async request=>{
 if(busy||compositionActive||!view)throw Error(messages.fCaptureBusy());
 setBusy(true);
 try{
  if(!await saveForAction())throw Error(messages.fTrySavingAgainYourTextIsStillHere());
  const result=await call<CaptureAppendResult>('AppendCapture',{...request,revision:request.targetID===doc.id?doc.revision:-1});
  const target=result.document;
  if(target.id===doc.id){
   loading=true;
   try{view.dispatch({changes:result.changes,annotations:isolateHistory.of('full')})}finally{loading=false}
   doc=target;state.current=doc;dirty=false;savedPosition='';header();documentFind?.changed(true);scheduleWordCount(true);scheduleOutline(true);preview.changed(true,view.state.doc.lineAt(view.state.selection.main.head).number-1);preview.saved();
   if(doc.conflict||statusFailed(doc))banner(statusText(doc),doc.conflict?'conflict':'error');else banner();
   await save();
  }else sessions.delete(target.id);
  const summary=result.summary;
  state.recent=[summary,...state.recent.filter(d=>d.id!==target.id)];sidebarSearch?.contentAccepted();syncBacklinks();backlinks?.refresh();if(!$('#drawer').hidden)renderDrawer();
  return summary;
 }finally{setBusy(false)}
};
async function resolveImageFor(documentID:string,dest:string):Promise<string>{
 if(/^https?:\/\//.test(dest))return dest;
 const key=imageKey(documentID,dest);if(!imageCache.has(key))imageCache.set(key,call<ImageResult>('ReadImage',documentID,dest).then(x=>x.url).catch(e=>{imageCache.delete(key);throw e}));return imageCache.get(key)!;
}
const resolveImage=(dest:string)=>resolveImageFor(doc.id,dest);
function locateSearch(hit:SearchHit){
 view.dispatch({selection:{anchor:hit.from,head:hit.to},effects:EditorView.scrollIntoView(hit.from,{y:'center'}),annotations:Transaction.addToHistory.of(false)});
 if(split()||reading())preview.jumpToLine(hit.line-1);
}
function validCurrentSearchTarget(item:SearchItem,hit:SearchHit|undefined){
 return !dirty&&!compositionActive&&!view.composing&&validSearchTarget(item,hit,{id:doc.id,revision:doc.revision,content:view.state.doc.toString()});
}
function load(next:WorkspaceState,hit?:SearchHit){
 const epoch=++navigationEpoch;
 loading=true;if(view){sessions.set(doc.id,view.state);view.destroy()}
 if(!appearance)appearance={...next.appearance,...pendingAppearance};next.appearance=appearance;pendingAppearance=null;
 state=next;doc=next.current;source=!!appearance.source;dirty=false;generation=0;savedPosition=JSON.stringify(doc.position);
 view=createEditor($('#editor'),doc,resolveImage,changed,insertImages,composition,openLink,files=>{if(!desktop&&files[0])void importFile(files[0])},importPastedImage,error=>toast(errorText(error)),{action:id=>void action(id==='image'?id:'block:'+id),dispatch:spec=>{if(!compositionActive&&!view.state.readOnly)view.dispatch(spec);view.focus()}});
 view.dispatch({effects:StateEffect.appendConfig.of([editLock.of(EditorState.readOnly.of(false)),EditorView.scrollMargins.of(()=>({top:parseFloat(getComputedStyle($('#editor')).paddingTop)+24}))])});
 const cached=sessions.get(doc.id);if(cached&&cached.doc.toString()===doc.content)view.setState(cached);
 view.dispatch({effects:[editLock.reconfigure(EditorState.readOnly.of(busy||reading())),editorLocale.reconfigure(localizedEditor())]});
 reconfigure();
 loading=false;view.dispatch({effects:setFocus.of(focusMode)});applyTheme();const changedPreviewDocument=preview.setDocument(doc.id);applyLayout();if(!changedPreviewDocument)preview.refresh();header();scheduleWordCount(true);scheduleOutline(true);if(doc.conflict||statusFailed(doc))banner(statusText(doc),doc.conflict?'conflict':'error');else banner();
 const loadedView=view,loadedID=doc.id,loadedGeneration=generation,scroll=doc.position.scroll||0;
 requestAnimationFrame(()=>{
  if(view!==loadedView||doc.id!==loadedID||epoch!==navigationEpoch||compositionActive||hit&&generation!==loadedGeneration)return;
  $('.editor-scroll').scrollTop=scroll;focusContent();if(hit)locateSearch(hit);
 });
 sidebarSearch?.contentAccepted();
 syncBacklinks();
 if(!$('#drawer').hidden)renderDrawer();
}
async function refreshRecent(){await appearanceQueue.catch(()=>{});const next=await call<WorkspaceState>('State');next.appearance=appearance;state=next;renderDrawer();sidebarSearch?.refresh();backlinks?.refresh();if(next.notices?.length)showNotices(next)}
function themeID():ThemeID{return resolveTheme(appearance,new Date(),mq.matches)}
// An automatic switch that stays light or stays dark fades the large surfaces into the new theme (.theme-fade in style.css).
// Across schemes it paints at once: text colours flip instantly, so a fading background would leave text unreadable for a moment. Manual changes paint at once too.
let fadeTimer:ReturnType<typeof setTimeout>;
function themeFade(on:boolean){clearTimeout(fadeTimer);document.documentElement.classList.toggle('theme-fade',on);if(on)fadeTimer=setTimeout(()=>document.documentElement.classList.remove('theme-fade'),1100)}
function applyTheme(){if(!appearance)return;paintTheme(document.documentElement,themeID());document.documentElement.style.setProperty('--editor-size',(appearance.fontSize||18)+'px');document.documentElement.style.setProperty('--paper-width',appearance.lineWidth==='full'?'100%':appearance.lineWidth==='wide'?'920px':'760px');appearanceDialog.render();syncDrawer();scheduleOutlineLayout()}
function applyLayout(){
 const scroll=$('.editor-scroll').scrollTop;
 $('.desk').classList.toggle('split-layout',split());
 $('.desk').classList.toggle('read-layout',reading());
 $('#format-bar').hidden=reading();
 preview.setVisible(split()||reading());
 view.dispatch({effects:[editLock.reconfigure(EditorState.readOnly.of(busy||reading())),editorLocale.reconfigure(localizedEditor())]});
 if(reading())$('.preview-scroll').focus();
 reconfigure();
 header();
 documentFind?.refresh();
 requestAnimationFrame(()=>{$('.editor-scroll').scrollTop=scroll;scheduleOutlineLayout()});
}
async function setAppearance(change:Partial<Appearance>){const next={...appearance,...change};appearance=next;source=!!next.source;state.appearance=next;themeFade(false);applyTheme();try{const pending=appearanceQueue.catch(()=>{}).then(async()=>{await call('UpdateAppearance',change);try{localStorage.setItem('liubai-appearance',JSON.stringify(appearance))}catch{}});appearanceQueue=pending;await pending}catch(e){toast(messages.fPreferencesError(errorText(e)))}}
// The caption under each row names the theme under the pointer or focus, else the one in use.
const appearanceDialog=appearanceSettings(()=>appearance,themeID,setAppearance);
watchTheme(()=>{if(!appearance)return;const from=document.documentElement.dataset.liubaiTheme||'',to=themeID();if(from===to)return;themeFade(!reducedMotion.matches&&isDark(from)===isDark(to));applyTheme()});
const triggers=new Map<string,HTMLElement>();
function dialog(id:string){triggers.set(id,document.activeElement as HTMLElement);($<HTMLDialogElement>('#'+id)).showModal()}
const wikiChooser=createWikiChooser($<HTMLDialogElement>('#wiki-dialog'),$('#wiki-candidates'),()=>dialog('wiki-dialog'));
const openCaptureSettings=captureSettingsDialog(()=>dialog('capture-settings'));
function closeDialog(id:string){$<HTMLDialogElement>('#'+id).close();triggers.get(id)?.focus()}
$$('[data-close]').forEach(b=>b.onclick=()=>{const id=b.dataset.close!;if(id==='drawer'){closeDrawer();$('#sidebar-button').focus()}else closeDialog(id)});
$$('dialog').forEach(el=>{const d=el as HTMLDialogElement;d.addEventListener('close',()=>triggers.get(d.id)?.focus());d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))closeDialog(d.id)})});
function renderDrawer(){if(sidebarSearch)sidebarSearch.renderRecent();else renderRecent()}
function renderRecent(selected=''){
 const active=document.activeElement as HTMLElement|null;
 const focusedRemove=active?.dataset.remove,focusedKey=active?.dataset.searchKey;
 const list=$('#drawer-list');list.replaceChildren();
 for(const d of state.recent){const b=node('button','recent-item'+(d.id===doc.id?' active':''));b.dataset.searchKey=d.id+':recent';b.append(node('b','',d.title),node('p','',d.excerpt||messages.fADocumentWaitingToBegin()),node('small','',new Date(d.updated).toLocaleString(pageLocale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})));b.onclick=()=>void run(async()=>{if(await saveForAction()){load(await call<WorkspaceState>('Activate',d.id));closeOverlayDrawer()}});
  const armed=removeID===d.id&&Date.now()<removeUntil,row=node('div','recent-row'),body=node('div','recent-body'),remove=node('button','recent-remove'+(armed?' armed':''),armed?messages.fConfirmRemoval():'×');remove.dataset.remove=d.id;remove.setAttribute('aria-label',messages.fRemoveFromRecentDocuments());remove.dataset.tip=messages.fRemoveFromRecentDocuments();remove.onclick=()=>confirmRemove(d.id);
  body.append(b);if(d.tags?.length){const tags=node('div','document-tags');tags.append(tagButtons(d.tags,selected,tag=>sidebarSearch.chooseTag(tag),d.id));body.append(tags)}row.append(body,remove);list.append(row);if(focusedRemove===d.id)remove.focus()
 }
 if(!list.childElementCount)list.append(node('p','dialog-note',messages.fNoDocumentsFound()))
 if(focusedKey){const target=Array.from(list.querySelectorAll<HTMLElement>('[data-search-key]')).find(b=>b.dataset.searchKey===focusedKey);(target||$('#recent-search')).focus()}
}
async function navigateSearch(item:SearchItem,hit:SearchHit|undefined,inSource:boolean){
 if(compositionActive||view?.composing){toast(messages.fFinishComposingYourTextFirst());return}
 if(busy)return;
 const originView=view,originID=doc.id,epoch=++navigationEpoch;
 const canContinue=()=>{
  if(view!==originView||doc.id!==originID)return false;
  if(compositionActive||view.composing){toast(messages.fFinishComposingYourTextFirst());return false}
  if(epoch!==navigationEpoch)return false;
  if(dirty){toast(messages.fTrySavingAgainYourTextIsStillHere());return false}
  return true;
 };
 let sourceTarget:SearchHit|undefined,sourceEpoch=0;
 await run(async()=>{
  if(!await saveForAction()||!canContinue())return;
  let next:WorkspaceState;
  try{next=await call<WorkspaceState>('ActivateSearch',item.id)}catch(error){
   sidebarSearch.refresh();
   if(localizedError(error)===messages.bDocumentMissing()){state.recent=state.recent.filter(d=>d.id!==item.id);toast(messages.fSearchRemoved())}
   else toast(errorText(error));
   return;
  }
  if(!canContinue()){
   if(view===originView&&doc.id===originID){
    const restored=await call<WorkspaceState>('ActivateSearch',originID);
    state=restored;state.current=doc;state.appearance=appearance;renderDrawer();
   }
   return;
  }
  const valid=validSearchTarget(item,hit,next.current),same=doc.id===next.current.id&&view.state.doc.toString()===next.current.content;
  if(!same)load(next,valid&&!inSource?hit:undefined);
  else{
   state=next;doc=next.current;header();
   if(valid&&!inSource){const selectedView=view,stamp=navigationEpoch;requestAnimationFrame(()=>{if(view===selectedView&&navigationEpoch===stamp&&validCurrentSearchTarget(item,hit)){focusContent();if(hit)locateSearch(hit)}})}
  }
  if(!valid){toast(messages.fSearchStale());sidebarSearch.refresh()}
  else if(inSource&&hit){sourceTarget=hit;sourceEpoch=navigationEpoch}
  closeOverlayDrawer();
 });
 if(!sourceTarget||sourceEpoch!==navigationEpoch)return;
 await setView('split');
 if(sourceEpoch!==navigationEpoch||!validCurrentSearchTarget(item,sourceTarget)){if(compositionActive||view.composing)toast(messages.fFinishComposingYourTextFirst());return}
 const pending=setAppearance({source:true});reconfigure();header();await pending;
 if(sourceEpoch!==navigationEpoch||!validCurrentSearchTarget(item,sourceTarget)){if(compositionActive||view.composing)toast(messages.fFinishComposingYourTextFirst());return}
 const target=sourceTarget,stamp=navigationEpoch;
 requestAnimationFrame(()=>{if(stamp===navigationEpoch&&validCurrentSearchTarget(item,target)){locateSearch(target);view.focus()}});
}
function confirmRemove(id:string,command=false){
 if(busy)return;if(compositionActive){toast(messages.fFinishComposingYourTextFirst());return}
 if(removeID===id&&Date.now()<removeUntil){clearTimeout(removeTimer);removeID='';void run(async()=>{try{await removeDocument(id)}finally{if(!$('#drawer').hidden)renderDrawer()}});return}
 clearTimeout(removeTimer);removeID=id;removeUntil=Date.now()+3000;if(!$('#drawer').hidden)renderDrawer();
 removeTimer=setTimeout(()=>{removeID='';if(!$('#drawer').hidden)renderDrawer()},3000);
 if(command)toast(messages.fChooseAgainWithin3SecondsToRemove())
}
async function removeDocument(id:string){
 const removed=state.recent.find(d=>d.id===id);if(!removed)return;
 if(id===doc.id&&!await saveForAction())return;
 const next=await call<WorkspaceState>('Delete',id);next.appearance=appearance;
 if(next.current.id!==doc.id)load(next);else state=next;
 sessions.delete(id);for(const key of imageCache.keys())if(key.startsWith(id+':'))imageCache.delete(key);
 sidebarSearch?.refresh();backlinks?.refresh();renderDrawer();toast(removed.path?messages.fRemovedFromRecentDocumentsTheFileIsUnchanged():messages.fRemovedTheDraftStaysInTheTrashFolderFor())
}
function syncDrawer(){
 const open=dockQuery.matches?!!appearance?.sidebarDocked:overlayOpen,wasHidden=$('#drawer').hidden;
 $('.workspace').classList.toggle('sidebar-docked',dockQuery.matches&&open);
 $('#drawer').hidden=!open;$('#sidebar-button').setAttribute('aria-expanded',String(open));
 sidebarSearch?.visible(open);
 backlinks?.visible(open);
 if(open&&wasHidden&&view)renderDrawer();
 scheduleOutlineLayout();
}
function closeDrawer(){if(dockQuery.matches)void setAppearance({sidebarDocked:false});else{overlayOpen=false;syncDrawer()}}
function closeOverlayDrawer(){if(!dockQuery.matches)closeDrawer()}
async function openDrawer(){if(dockQuery.matches){if(!appearance.sidebarDocked)void setAppearance({sidebarDocked:true})}else overlayOpen=true;syncDrawer();renderDrawer();await refreshRecent()}
dockQuery.addEventListener('change',()=>{overlayOpen=false;syncDrawer();if($('#drawer').hidden&&$('#drawer').contains(document.activeElement)&&view)focusContent()});
document.addEventListener('pointerdown',e=>{if(!$('#drawer').hidden&&!$('#drawer').contains(e.target as Node)&&!$('#sidebar-button').contains(e.target as Node))closeOverlayDrawer()});
$('#sidebar-button').onclick=()=>{if($('#drawer').hidden)void action('sidebar');else closeDrawer()};
async function setView(layout:Appearance['layout']){
 if(!view||busy)return;if(compositionActive){toast(messages.fFinishComposingYourTextFirst());return}
 if(layout==='read'&&!reading()){layoutBeforeRead=appearance.layout;if(focusMode)await action('focus')}
 const before=document.activeElement;const pending=setAppearance({layout});applyLayout();await pending;
 // Move focus to the content only if nothing else took it while the layout was saved (e.g. a menu the user opened).
 if(document.activeElement===before||document.activeElement===document.body)focusContent();
}
async function toggleLayout(){await setView(split()?'single':'split')}
async function toggleRead(){await setView(reading()?layoutBeforeRead||'single':'read')}
async function toggleMode(){if(!split()){toast(messages.fMarkdownSourceIsAvailableInSplitView());return}const pending=setAppearance({source:!source});reconfigure();header();await pending;view.focus()}
$$('[data-view]').forEach((b,i)=>{
 b.onclick=e=>{const keyboard=e.detail===0;void setView(b.dataset.view as Appearance['layout']).then(()=>{if(keyboard&&b.getAttribute('aria-checked')==='true')b.focus()})};
 b.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=$$('[data-view]')[(i+(e.key==='ArrowRight'?1:2))%3];next.click()}};
});
attachMenu($('#more-button'),$('#more-menu'),id=>void action(id));
async function importImage(file:File,id:string):Promise<ImageResult>{
 if(file.size>20*1024*1024)throw Error(messages.fTheImageExceeds20MB());
 const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error(messages.fTheImageCouldNotBeRead()));r.readAsDataURL(file)});
 const image=await call<ImageResult>('ImportImage',id,file.name,data);
 if(doc.id!==id)throw Error(messages.fTheDocumentChangedInsertTheImageAgain());
 imageCache.set(imageKey(id,image.destination),Promise.resolve(image.url));return image;
}
async function importPastedImage(image:PasteImage):Promise<string>{
 const id=doc.id;setBusy(true);
 try{
  if(image.dataUrl.length>28*1024*1024)throw Error(messages.fTheImageExceeds20MB());
  const blob=dataUrlBlob(image.dataUrl);
  const imported=await importImage(new File([blob],messages.fPastedImage(),{type:blob.type}),id);
  const alt=image.alt.replace(/[\[\]\\]/g,'\\$&').replace(/[\r\n]/g,' ');
  return `![${alt}](${imported.markdown})`;
 }finally{setBusy(false)}
}
async function insertImages(files:File[],at?:number){
 if(reading()){toast(messages.fEditingIsUnavailableInReadingModePressRTo(keyLabel('Mod+Shift+R')));return}if(busy||!doc||compositionActive)return;const id=doc.id;let offset=at??focusedImageRange(view)?.to??view.state.selection.main.from;setBusy(true);
 try{for(const file of files){const image=await importImage(file,id);const alt=file.name.replace(/[\[\]\\\r\n]/g,'').replace(/\.[^.]+$/,'')||messages.fImage();const text=`\n\n![${alt}](${image.markdown})\n\n`;view.dispatch({changes:{from:offset,insert:text},selection:{anchor:offset+text.length},userEvent:'input.paste'});offset+=text.length}await save();reconfigure();view.focus()}catch(e){toast(errorText(e))}finally{setBusy(false)}
}
$('#image-input').onchange=()=>{const input=$<HTMLInputElement>('#image-input');void insertImages(Array.from(input.files||[]));input.value=''};
function setBusy(value:boolean){busy=value;if(view)view.dispatch({effects:editLock.reconfigure(EditorState.readOnly.of(value||reading()))});if(!value){if(pendingClose){pendingClose=false;void closeApp()}else if(openedQueue.length)setTimeout(()=>void processOpened(),500)}syncPending()}
async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);try{await fn()}catch(e){toast(errorText(e))}finally{setBusy(false)}}
async function processOpened(){if(busy||compositionActive||!openedQueue.length)return;const id=openedQueue.shift()!;await run(async()=>{if(await saveForAction())load(await call<WorkspaceState>('Activate',id));else toast(messages.fSaveTheCurrentDocumentFirstFindTheOpenedFile())})}
async function saveAs(){if(!await saveForAction()){await rescue();return;}if(!desktop){download(doc.title+'.md',view.state.doc.toString(),'text/markdown');toast(messages.fMarkdownDownloadedUseExportToIncludeImages());return}const r=await call<ExportResult>('SaveAs',doc.id);if(r.cancelled)return;const old=view.state.doc.toString();doc=r.document;loading=true;if(old!==doc.content)view.dispatch({changes:r.changes||[],annotations:Transaction.addToHistory.of(false)});loading=false;imageCache.clear();reconfigure();const next=await call<WorkspaceState>('State');next.appearance=appearance;state=next;dirty=false;savedPosition='';if(!preview.setDocument(doc.id))preview.refresh();header();scheduleOutline(true);sidebarSearch?.contentAccepted();banner();toast(messages.fSavedWithImages(r.path,r.missing?.length||0))}
async function rescue(){
 if(desktop){try{const r=await call<ExportResult>('Rescue',doc.id,view.state.doc.toString());if(!r.cancelled)toast(messages.fRecoverySaved(r.path))}catch(e){toast(errorText(e))}}
 else {download(messages.fRecoveryFilename(doc.title),view.state.doc.toString(),'text/markdown');toast(messages.fTextDownloadedImagesRemainOnThisMac())}
}
function download(name:string,data:BlobPart,type:string){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function exportDoc(allowMissing=false){
 if(!await saveForAction())return;
 if(!desktop){const r=await call<{url?:string;missing:string[];external:number}>('ExportBrowser',doc.id,allowMissing);
  if(r.missing?.length&&!allowMissing){pendingMissing=()=>exportDoc(true);$('#missing-list').textContent=r.missing.join('\n');dialog('missing-dialog');return}
  if(!r.url)throw Error(messages.fTheDocumentArchiveIsNotReady());const a=document.createElement('a');a.href=r.url;a.download=doc.title+'.zip';document.body.append(a);a.click();a.remove();toast(messages.fDocumentArchiveDownloaded()+(r.missing?.length?messages.fMissingImageReferencesPreserved():'')+(r.external?messages.fExternalImagesNeedAnInternetConnection():''));return;
 }
 const r=await call<ExportResult>('Export',doc.id,allowMissing);if(r.cancelled)return;
 if(r.missing?.length&&!allowMissing){pendingMissing=()=>exportDoc(true);$('#missing-list').textContent=r.missing.join('\n');dialog('missing-dialog');return}
 toast(messages.fArchiveSaved(r.path)+(r.missing?.length?messages.fMissingImageReferencesPreserved():'')+(r.external?messages.fExternalImagesNeedAnInternetConnection():''));
}
$('#export-anyway').onclick=()=>{closeDialog('missing-dialog');void run(pendingMissing)};
async function prepareDelivery(kind:string,allowMissing=false){
 if(!await saveForAction())return;const data=await call<Delivery>('Delivery',doc.id);
 if(data.missing.length&&!allowMissing){pendingMissing=()=>prepareDelivery(kind,true);$('#missing-list').textContent=data.missing.join('\n');dialog('missing-dialog');return}
 if(prepared)disposeMermaid(prepared);
 prepared=renderDelivery(data,kind==='pdf'?'htmlAndMathml':'mathml');$('#print-document').replaceChildren(prepared);await waitImages(prepared);await document.fonts.ready;readyAction=kind;
 readyData=data;renderReadyInfo();dialog('ready-dialog');
}
function renderReadyInfo(){if(!readyData)return;
 $('#ready-info').textContent=(readyAction==='pdf'?messages.fExportTheCompleteFormattedDocument():readyAction==='copyRich'?messages.fCopyTheTextAndBasicFormatting():readyAction==='docx'?messages.fWordDescription():messages.fDownloadHTMLWithLocalImagesEmbedded())+(readyData.missing.length?messages.fMissingImagesWillShowANote():'')+(readyData.external?messages.fExternalImagesRemainAsLinks():'');
 $('#ready-go').textContent=readyAction==='copyRich'?messages.fCopyRichText():readyAction==='pdf'?(desktop?messages.fSavePDF():messages.fPrintSaveAsPDF()):readyAction==='docx'?(desktop?messages.fSaveWordDocument():messages.fDownloadWordDocument()):messages.fDownloadHTML();
}
$('#ready-go').onclick=()=>{if(!prepared)return;const root=prepared;
 if(readyAction==='copyRich'){
  const promise=desktop?call('CopyRich',root.outerHTML,root.innerText):copyRich(root);void promise.then(()=>{closeDialog('ready-dialog');toast(messages.fRichTextCopiedImageSupportDependsOnTheReceiving())}).catch(e=>toast(errorText(e)));return;
 }
 closeDialog('ready-dialog');
 if(readyAction==='html'){const html='<!doctype html><html lang="'+pageLocale()+'"><meta charset="utf-8"><title>'+doc.title.replace(/[<>&]/g,'')+'</title><body>'+root.outerHTML+'</body></html>';if(desktop)void run(async()=>{const r=await call<ExportResult>('SaveHTML',doc.title,html);if(!r.cancelled)toast(messages.fHTMLSaved(r.path))});else download(doc.title+'.html',html,'text/html');return}
 if(readyAction==='docx'){const title=readyData?.title||doc.title,locale=pageLocale(),snapshot=root.cloneNode(true) as HTMLElement;void run(async()=>{
  const {exportDOCX}=await import('./docx-export'),bytes=await exportDOCX(snapshot,title,locale==='en'?'en-US':'zh-CN');
  if(desktop){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const r=await call<ExportResult>('SaveDOCX',title,btoa(binary));if(!r.cancelled)toast(messages.fWordSaved(r.path))}
  else download(title+'.docx',bytes as BlobPart,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 });return}
 document.body.classList.add('printing');
 if(desktop)void run(async()=>{try{const r=await call<ExportResult>('PDF',doc.title);if(!r.cancelled)toast(messages.fPDFSaved(r.path))}finally{document.body.classList.remove('printing')}});
 else {window.print();document.body.classList.remove('printing')}
};
async function closeApp(){if(compositionActive){pendingClose=true;toast(messages.fFinishComposingYourTextToSaveAndQuit());return}if(busy){pendingClose=true;return}if(closeRequested)return;closeRequested=true;try{await appearanceQueue.catch(()=>{});const ok=await save();if(!ok||dirty){dialog('close-dialog');return}if(desktop)await call('Close');else toast(messages.fYourDocumentIsSavedLocallyYouCanCloseThis())}finally{closeRequested=false}}
$('#discard-close').onclick=()=>{if(desktop)void call('Close');else closeDialog('close-dialog')};
const kbd=(keys:string)=>keyLabel(keys,{spaced:true});
const commands=()=>[
 ['settings',messages.fSettings(),kbd('Mod+,')],
 ['language:system',messages.fLanguageSystem(),''],['language:zh-Hans',messages.fLanguageChinese(),''],['language:en',messages.fLanguageEnglish(),''],['capture',messages.fQuickNote(),''],['captureSettings',messages.fQuickNoteSettings(),''],['new',messages.fNewDocument(),kbd('Mod+N')],['rename',messages.fRename(),''],['open',messages.fOpenDocument(),kbd('Mod+O')],['save',messages.fSave(),kbd('Mod+S')],['saveAs',messages.fSaveAs(),kbd('Mod+Shift+S')],['deliver',messages.fExport(),''],['export',messages.fDocumentAndImagesZIP(),'ZIP'],['pdf',messages.fExportPDF(),''],['docx',messages.fExportWordDocument(),''],['copyRich',messages.fCopyRichText(),''],['pastePlain',messages.fPasteAsPlainText(),kbd('Mod+Shift+V')],['html',messages.fDownloadHTML(),''],['focus',messages.fFocusMode(),kbd(focusKeys)],['recent',messages.fRecentDocuments(),''],['remove',messages.fRemoveCurrentDocumentFromRecents(),''],['outline',messages.fOutline(),''],['find',messages.fFindInDocument(),kbd('Mod+F')],['layout',messages.fToggleSplitView(),kbd('Mod+\\')],['read',messages.fReadingMode(),kbd('Mod+Shift+R')],['source',messages.fShowMarkdownSource(),kbd('Mod+Shift+M')],['image',messages.fInsertImage(),''],['theme',messages.fAppearanceAndTypography(),''],['commands',messages.fAllCommands(),kbd('Mod+K')],...themes.map(t=>['theme:'+t.id,messages.fSwitchTheme(themeText(t.id)[0]),'']),['bold',messages.fBoldSelection(),kbd(shortcuts.bold)],['italic',messages.fItalicizeSelection(),kbd(shortcuts.italic)],['paragraph',messages.fBody(),kbd(shortcuts.paragraph)],['h1',messages.fHeading1(),kbd(shortcuts.h1)],['h2',messages.fHeading2(),kbd(shortcuts.h2)],['h3',messages.fHeading3(),kbd(shortcuts.h3)],['h4',messages.fHeading4(),kbd(shortcuts.h4)],['h5',messages.fHeading5(),kbd(shortcuts.h5)],['h6',messages.fHeading6(),kbd(shortcuts.h6)],['underline',messages.fUnderline(),kbd(shortcuts.underline)],['highlight',messages.fHighlight(),kbd(shortcuts.highlight)],['superscript',messages.fSuperscript(),''],['subscript',messages.fSubscript(),''],['clearFormatting',messages.fClearFormatting(),''],['indent',messages.fIndent(),''],['outdent',messages.fOutdent(),''],['strike',messages.fStrikethrough(),kbd(shortcuts.strike)],['inlineCode',messages.fInlineCode(),kbd(shortcuts.inlineCode)],['quote',messages.fInsertBlockquote(),''],['task',messages.fInsertTaskList(),kbd(shortcuts.task)],['code',messages.fInsertCodeBlock(),''],['math',messages.fFormula(),''],['mermaid',messages.fDiagram(),''],['footnote',messages.fFootnote(),''],['details',messages.fDetails(),''],['table',messages.fInsertTable(),''],['link',messages.fInsertEditLink(),kbd(shortcuts.link)],['bullet',messages.fBulletedList(),kbd(shortcuts.bullet)],['ordered',messages.fNumberedList(),kbd(shortcuts.ordered)],['undo',messages.fUndo(),kbd('Mod+Z')],['redo',messages.fRedo(),kbd(redoKeys)],...(desktop?[['checkUpdates',messages.bMenuCheckForUpdates(),''],['about',messages.bMenuAbout(),'']]:[])
].filter(([id])=>!desktop||!(['settings','theme','captureSettings'].includes(id)||id.startsWith('theme:')||id.startsWith('language:')));
function renderCommands(){const q=$<HTMLInputElement>('#command-search').value.trim().toLowerCase();const list=$('#command-list');list.replaceChildren();commands().filter(c=>c[1].toLowerCase().includes(q)).forEach(([id,title,key])=>{const b=node('button','command');b.append(node('span','',title),node('kbd','',key));if(id==='language:zh-Hans')b.dataset.languageAutonym='true';b.onclick=()=>{closeDialog('commands');void action(id)};list.append(b)})}
$('#command-search').oninput=renderCommands;$('#command-search').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();$('#command-list button')?.focus()}if(e.key==='Enter'){e.preventDefault();$('#command-list button')?.click()}};
async function action(id:string){
 if(id.startsWith('language:')){try{await setPageLocale(id.slice(9)==='system'?'':id.slice(9))}catch(error){toast(errorText(error))}return}
 if(id==='checkUpdates'||id==='about'){void call(id==='about'?'About':'CheckForUpdates').catch(e=>toast(errorText(e)));return}
 if(id==='undo'||id==='redo'){const el=document.activeElement;if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){document.execCommand(id);return}}
 if(!view||!doc)return;
 if(reading()&&(id in inlineMarkers||id==='clearFormatting'||id==='indent'||id==='outdent'||id==='insert'||['paragraph','h1','h2','h3','h4','h5','h6','strike','inlineCode','heading','quote','bullet','ordered','task','bold','italic','code','math','mermaid','footnote','details','link','table','image','pastePlain','undo','redo','source','focus'].includes(id))){toast(messages.fEditingIsUnavailableInReadingModePressRTo(keyLabel('Mod+Shift+R')));return}
 if(busy){if(id==='close')pendingClose=true;return;}
 if(compositionActive&&id!=='close'){toast(messages.fFinishComposingYourTextFirst());return}
 const imageRange=focusedImageRange(view),cellRange=imageRange||focusedTableRange(view);
 if(imageRange&&(id in inlineMarkers||['clearFormatting','link'].includes(id)))return;
 if(cellRange){
  if(id==='footnote'&&!imageRange){const spec=tableFootnote(view)?.();if(spec)view.dispatch(spec);view.focus();return}
  if(id==='math'&&!imageRange){formatTableCell(view,id);return}
  if(id in inlineMarkers||id==='clearFormatting'||id==='link'){formatTableCell(view,id);return}
  if(['paragraph','h1','h2','h3','h4','h5','h6','heading','quote','bullet','ordered','task','indent','outdent'].includes(id))return;
  if(['image','table','code','math','mermaid','details','footnote'].includes(id)){
   view.dispatch(insertToolbarItem(view.state,id as SlashItemID,cellRange));
   if(id==='image'){view.focus();$('#image-input').click()}else if(id!=='table'||!focusTableCell(view))view.focus();return;
  }
 }
 if(id==='insert'){insertMenu.open();return}
 if(id==='clearFormatting'){view.dispatch(clearFormatting(view.state));view.focus();return}
 if(id==='indent'||id==='outdent'){const spec=indentList(view.state,id==='indent'?1:-1);if(spec)view.dispatch(spec);view.focus();return}
 if(id.startsWith('block:')){
  if(view.state.readOnly||compositionActive||sourceActive()||focusMode)return;
  const control=blockControls(view),name=id.slice(6);if(name==='menu'){control?.open();return}
  const range=control?.range||blockAt(view.state,view.state.selection.main.head);if(!range)return;
  if(name==='insert'){view.dispatch(insertParagraphBelow(view.state,range));openSlashMenu(view);return}
  const spec=name==='up'||name==='down'?moveBlocks(view.state,range,name==='up'?-1:1):name==='duplicate'?duplicateBlocks(view.state,range):name==='delete'?deleteBlocks(view.state,range):convertBlocks(view.state,range,name as BlockConversion);
  if(spec)view.dispatch(spec);view.focus();return;
 }
 if(['paragraph','h1','h2','h3','h4','h5','h6'].includes(id)){view.dispatch(setHeading(view.state,id==='paragraph'?0:Number(id.slice(1))));view.focus();return}
 if(['heading','quote','bullet','ordered','task'].includes(id)){view.dispatch(blockFormat(view.state,id as BlockKind));view.focus();return}
 if(id in inlineMarkers){view.dispatch(wrapSelection(view.state,...inlineMarkers[id]));view.focus();return}
 if(id==='pastePlain'){
  const target=view;
  try{const text=desktop?await call<string>('ClipboardText'):await navigator.clipboard.readText();if(view!==target||view.state.readOnly||compositionActive)return;view.dispatch(pasteText(view.state,text));view.focus()}catch(error){toast(messages.fClipboardError(errorText(error)))}return;
 }
 if(id==='footnote'){view.dispatch(insertFootnote(view.state));view.focus();return}
 if(id==='details'){view.dispatch(insertToolbarItem(view.state,'details'));view.focus();return}
 if(id==='mermaid'){view.dispatch(insertToolbarItem(view.state,'mermaid'));view.focus();return}
 if(id==='math'){view.dispatch(insertMath(view.state));view.focus();return}
 if(id==='code'){view.dispatch(codeBlock(view.state));view.focus();return}
 if(id==='link'){openLinkEditor();return}if(id==='table'){view.dispatch(insertTable(view.state));if(!focusTableCell(view))view.focus();return}
 if(id==='focus'){focusMode=!focusMode;document.body.classList.toggle('focus-mode',focusMode);scheduleOutlineLayout();$('#focus-exit').hidden=!focusMode;view.dispatch({effects:setFocus.of(focusMode)});$$('[data-action=focus]').forEach(b=>b.setAttribute('aria-pressed',String(focusMode)));view.focus();return}
 if(id==='deliver'){dialog('delivery-dialog');return}
 if(id==='rescue'){await rescue();return}
 if(id==='retry-close'){closeDialog('close-dialog');savedPosition='';await closeApp();return}
 if(id.startsWith('theme:')){await setAppearance({theme:id.split(':')[1] as ThemeID,auto:'off'});return}
 if(id==='rename'){if(doc.path){toast(messages.fUseSaveAsToGiveAnExistingFileA());return}$<HTMLInputElement>('#rename-input').value=doc.title===messages.fUntitledDocument()?'':doc.title;dialog('rename-dialog');$<HTMLInputElement>('#rename-input').select();return}
 if(id==='read'){await toggleRead();return}if(id==='layout'){await toggleLayout();return}if(id==='source'){await toggleMode();return}if(id==='undo'){undo(view);view.focus();return}if(id==='redo'){redo(view);view.focus();return}if(id==='find'){documentFind.open();return}
 if(id==='settings'||id==='theme'){if(desktop)await call('ShowSettings',id==='theme'?'appearance':'');else{dialog('appearance');requestAnimationFrame(()=>$('#themes [aria-checked=true]').focus())}return}
 if(id==='captureSettings'){try{if(desktop)await call('ShowSettings','capture');else await openCaptureSettings()}catch(e){toast(errorText(e))}return}
 if(id==='capture'){if(desktop)await call('ShowCapture');else toast(messages.fQuickNoteIsAvailableInTheDesktopApp());return}
 if(id==='commands'){renderCommands();dialog('commands');$<HTMLInputElement>('#command-search').value='';renderCommands();$('#command-search').focus();return}
 if(id==='sidebar'||id==='recent'){await openDrawer();return}if(id==='outline'){toggleOutline();const item=outlinePopover?outlineItem():null;if(item)triggers.set('commands',item);return}
 if(id==='remove'){confirmRemove(doc.id,true);return}
 if(id==='image'){$('#image-input').click();return}if(id==='close'){await closeApp();return}
 await run(async()=>{switch(id){case 'new':if(await saveForAction())load(await call<WorkspaceState>('New'));break;case 'open':if(!await saveForAction())break;if(desktop)load(await call<WorkspaceState>('Open'));else $('#open-input').click();break;case 'save':case 'retry':if(id==='retry')savedPosition='';await save(true);if(!doc.path&&id==='save')await saveAs();break;case 'saveAs':await saveAs();break;case 'export':await exportDoc();break;case 'docx':case 'pdf':case 'copyRich':case 'html':await prepareDelivery(id);break;case 'reload':if(await saveForAction())load(await call<WorkspaceState>('Reload',doc.id));break;case 'overwrite':if(!await saveForAction())break;const title=doc.title;load(await call<WorkspaceState>('Overwrite',doc.id));toast(messages.fOverwritten(title));break;}})
}
function scheduleOutline(immediate=false){
 clearTimeout(outlineTimer);if(compositionActive||!view)return;
 const update=(budget:number)=>{
  // The editor parses little beyond the screen; finish the tree in slices short enough not to hold up a frame,
  // listing what is parsed meanwhile. While a document opens, the rest waits until it shows.
  const tree=fullTree(budget);if(!tree)outlineTimer=setTimeout(update,budget?30:200,5);
  const next=headings(view.state,tree??syntaxTree(view.state)).filter(h=>h.level<=3),list=$('#right-outline .outline-list');
  // Typing that leaves the headings alone keeps the buttons.
  if(next.length&&list.childElementCount&&next.length===outlineHeadings.length&&next.every((h,i)=>h.slug===outlineHeadings[i].slug&&h.text===outlineHeadings[i].text&&h.level===outlineHeadings[i].level)){outlineHeadings=next;scheduleOutlineLayout();return}
  outlineHeadings=next;list.replaceChildren();
  for(const h of outlineHeadings){const b=node('button','outline-item',h.text);b.dataset.slug=h.slug;b.style.paddingLeft=(10+(h.level-1)*12)+'px';b.onclick=()=>{closeOutlinePopover();jumpToHeading(h.slug)};list.append(b)}
  if(!outlineHeadings.length)list.append(node('p','dialog-note',messages.fAddAHeadingToSeeTheOutlineHere()));
  scheduleOutlineLayout();
 };
 if(immediate)update(0);else outlineTimer=setTimeout(update,200,5);
}
// The whole document's tree, parsing for at most `budget` ms; null while unfinished. Progress carries over to the next call.
function fullTree(budget:number){return ensureSyntaxTree(view.state,view.state.doc.length,budget)}
function scheduleOutlineLayout(){if(!outlineFrame)outlineFrame=requestAnimationFrame(()=>{outlineFrame=0;layoutOutline()})}
let outlinePopover=false;
// Beside the text when there is room; otherwise the outline only shows as a popover under its button.
function outlineRoom(){
 if(!view||!appearance||split()||focusMode||appearance.lineWidth==='full')return null;
 const scroll=$(reading()?'.preview-scroll':'.editor-scroll'),column=document.querySelector<HTMLElement>(reading()?'.markdown-document':'#editor');if(!column)return null;
 const viewport=scroll.getBoundingClientRect(),box=column.getBoundingClientRect(),free=viewport.left+scroll.clientWidth-box.right;
 return free<200?null:{column,viewport,box,free};
}
function layoutOutline(){
 const outline=$('#right-outline'),button=$('#outline-button'),room=outlineRoom(),inline=!!room&&outlineHeadings.length>=2;
 if(inline||focusMode)outlinePopover=false;
 button.hidden=focusMode;outline.classList.toggle('popover',outlinePopover);outline.hidden=!outlinePopover&&!(inline&&!appearance?.outlineHidden);button.setAttribute('aria-expanded',String(!outline.hidden));
 if(outline.hidden)return;
 if(outlinePopover){const r=button.getBoundingClientRect(),width=Math.min(280,innerWidth-16);outline.style.width=width+'px';outline.style.left=Math.max(8,r.right-width)+'px';outline.style.top=(r.bottom+6)+'px';outline.style.maxHeight=Math.max(120,innerHeight-r.bottom-22)+'px'}
 else{const {column,viewport,box,free}=room!,desk=$('.desk').getBoundingClientRect(),padding=parseFloat(getComputedStyle(column).paddingTop),top=Math.max(viewport.top+padding,box.top+padding);outline.style.left=(box.right-desk.left+24)+'px';outline.style.top=(top-desk.top)+'px';outline.style.width=Math.min(240,free-40)+'px';outline.style.maxHeight=Math.max(0,viewport.bottom-top-24)+'px'}
 let current:string|undefined;
 if(reading()){const top=$('.preview-scroll').getBoundingClientRect().top;for(const h of $('#preview-content').querySelectorAll<HTMLElement>('h1,h2,h3'))if(h.getBoundingClientRect().top<=top+2)current=h.id}
 else for(const h of outlineHeadings){if(h.from>view.state.selection.main.head)break;current=h.slug}
 for(const b of $$('#right-outline button')){if(b.dataset.slug===current)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current')}
}
function outlineItem(){const outline=$('#right-outline');return outline.querySelector<HTMLElement>('[aria-current]')||outline.querySelector<HTMLElement>('button')}
function toggleOutline(){
 if(outlineRoom()&&outlineHeadings.length>=2){void setAppearance({outlineHidden:!appearance.outlineHidden});return}
 outlinePopover=!outlinePopover;layoutOutline();
 if(outlinePopover)outlineItem()?.focus();
}
function closeOutlinePopover(restore=false){if(!outlinePopover)return;outlinePopover=false;layoutOutline();if(restore)$('#outline-button').focus()}
$('#outline-button').onclick=toggleOutline;
$('#right-outline').addEventListener('keydown',e=>{
 if(!outlinePopover)return;const items=$$('#right-outline button'),i=items.indexOf(document.activeElement as HTMLElement);
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeOutlinePopover(true)}
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus()}
});
document.addEventListener('pointerdown',e=>{if(outlinePopover&&!$('#right-outline').contains(e.target as Node)&&!$('#outline-button').contains(e.target as Node))closeOutlinePopover()});
const outlineResize=new ResizeObserver(scheduleOutlineLayout);
for(const selector of ['.workarea','.editor-scroll','.paper','.preview-scroll','#preview-content'])outlineResize.observe($(selector));
new MutationObserver(scheduleOutlineLayout).observe($('#preview-content'),{childList:true,subtree:true});
$('.preview-scroll').addEventListener('scroll',scheduleOutlineLayout,{passive:true});
$('.editor-scroll').addEventListener('scroll',scheduleOutlineLayout,{passive:true});
window.addEventListener('resize',scheduleOutlineLayout);
function jumpToHeading(slug:string){
 // The outline may list headings from a tree the editor has not caught up with yet.
 const h=headings(view.state,fullTree(500)??syntaxTree(view.state)).find(h=>h.slug===slug||h.text===slug);if(h){if(reading()){const target=Array.from($('#preview-content').querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(el=>el.id===h.slug);if(target){const scroll=$('.preview-scroll');scroll.scrollTop+=target.getBoundingClientRect().top-scroll.getBoundingClientRect().top}scheduleOutlineLayout();focusContent()}else{view.dispatch({selection:{anchor:h.from},scrollIntoView:true});view.focus()}}else toast(messages.fHeadingNotFound());
}
function openLink(url:string){
 const target=wikiTarget(url);
 if(target!==null){void openWikiLink(target);return}
 const local=localDocumentLink(url);
 if(local){void run(async()=>{if(!await saveForAction())return;load(await call<WorkspaceState>('OpenLinked',doc.id,url));if(local.fragment)jumpToHeading(local.fragment)});return}
 if(!safeLink(url)){toast(messages.fThisTypeOfLinkIsNotSupported());return}
 if(url.startsWith('#')){let slug=url.slice(1);try{slug=decodeURIComponent(slug)}catch{}jumpToHeading(slug);return}
 if(desktop)void call('OpenLink',url).catch(e=>toast(errorText(e)));else window.open(url,'_blank','noopener,noreferrer');
}
async function openWikiLink(target:string){
 if(busy||!doc||!view)return;
 if(compositionActive||view.composing){toast(messages.fFinishComposingYourTextFirst());return}
 const origin=view,sourceID=doc.id,stamp=generation,layout=appearance.layout,locale=pageLocale(),epoch=++navigationEpoch;
 let revision=-1,candidates:SearchResponse|undefined;
 const valid=()=>view===origin&&doc.id===sourceID&&generation===stamp&&!dirty&&!compositionActive&&!view.composing&&appearance.layout===layout&&pageLocale()===locale&&navigationEpoch===epoch&&(revision<0||doc.revision===revision);
 await run(async()=>{
  if(!await saveForAction()||!valid())return;
  revision=doc.revision;
  try{
   const result=await call<SearchResponse>('ResolveWikiLink',{sourceID,revision,target} satisfies WikiResolveRequest);
   if(valid())candidates=result;
  }catch(error){if(valid())toast(errorText(error))}
 });
 if(!candidates||!valid())return;
 if(!candidates.total){toast(messages.fWikiMissing(target));return}
 const item=candidates.total===1?candidates.items[0]:await wikiChooser.choose(candidates.items);
 if(item&&valid())await navigateSearch(item,undefined,false);
}
function openLinkEditor(){
 const existing=linkAt(view.state),r=view.state.selection.main;editRange=existing?{from:existing.from,to:existing.to,raw:view.state.sliceDoc(existing.from,existing.to)}:{from:r.from,to:r.to,raw:view.state.sliceDoc(r.from,r.to)};
 $<HTMLInputElement>('#link-text').value=existing?.text||view.state.sliceDoc(r.from,r.to);
 $<HTMLInputElement>('#link-url').value=existing?.url||'';$('#link-remove').hidden=!existing;$('#link-error').hidden=true;dialog('link-dialog');$('#link-text').focus();
}
function applyRange(text:string){if(!editRange)return;if(view.state.sliceDoc(editRange.from,editRange.to)!==editRange.raw){throw Error(messages.fTheDocumentChangedReopenTheEditingPanel())}
 view.dispatch({changes:{from:editRange.from,to:editRange.to,insert:text},selection:{anchor:editRange.from+text.length},userEvent:'input.format',annotations:isolateHistory.of('full')});view.focus();
}
$('#link-form').onsubmit=e=>{e.preventDefault();try{applyRange(makeLink($<HTMLInputElement>('#link-text').value,$<HTMLInputElement>('#link-url').value));closeDialog('link-dialog');view.focus()}catch(e){$('#link-error').textContent=errorText(e);$('#link-error').hidden=false}};
$('#link-open').onclick=()=>openLink($<HTMLInputElement>('#link-url').value);
$('#link-remove').onclick=()=>{try{applyRange($<HTMLInputElement>('#link-text').value.replace(/[\\`*_{}[\]()#+.!|>~-]/g,'\\$&'));closeDialog('link-dialog');view.focus()}catch(e){toast(errorText(e))}};
// Each button's keys come from shortcuts.ts, so its tooltip, All Commands and the key handler agree.
const formatButtons=()=>[
 [['undo',messages.fUndo()],['redo',messages.fRedo()]],
 [['bold',messages.fBold()],['italic',messages.fItalic()],['underline',messages.fUnderline()],['strike',messages.fStrikethrough()],['highlight',messages.fHighlight()],['inlineCode',messages.fInlineCode()],['superscript',messages.fSuperscript()],['subscript',messages.fSubscript()],['clearFormatting',messages.fClearFormatting()]],
 [['quote',messages.fBlockquote()],['bullet',messages.fBulletedList()],['ordered',messages.fNumberedList()],['task',messages.fTaskList()],['outdent',messages.fOutdent()],['indent',messages.fIndent()]],
 [['link',messages.fLink()],['image',messages.fImage()],['table',messages.fTable()],['code',messages.fCodeBlock()],['math',messages.fFormula()],['mermaid',messages.fDiagram()],['footnote',messages.fFootnote()]],
];
const group=$('.format-group'),headingButton=$('#heading-button');headingButton.remove();
const insertButton=node('button','format-text');insertButton.id='insert-button';insertButton.setAttribute('aria-haspopup','menu');insertButton.setAttribute('aria-controls','insert-menu');insertButton.setAttribute('aria-expanded','false');insertButton.setAttribute('aria-label',messages.fInsert());insertButton.dataset.tip=messages.fInsert();insertButton.append(icon('plus'),node('span','',messages.fInsert()),icon('chevron-down'));
const insertPopup=node('div','menu');insertPopup.id='insert-menu';insertPopup.setAttribute('role','menu');insertPopup.setAttribute('aria-label',messages.fInsert());insertPopup.hidden=true;document.body.append(insertPopup);
function populateInsertMenu(){insertPopup.replaceChildren(...filterSlashItems('').map(item=>{const b=node('button','',(messages[item.label] as ()=>string)());b.setAttribute('type','button');b.tabIndex=-1;b.setAttribute('role','menuitem');b.dataset.menuAction=item.id;return b}))}
populateInsertMenu();
let insertBelow:{from:number;to:number}|undefined;
let insertCellFootnote:(()=>import('@codemirror/state').TransactionSpec)|undefined;
const captureInsert=()=>{insertBelow=focusedImageRange(view)||focusedTableRange(view)||undefined;insertCellFootnote=tableFootnote(view)};
insertButton.addEventListener('pointerdown',captureInsert);insertButton.addEventListener('keydown',captureInsert);
insertButton.addEventListener('click',()=>{if(focusedImageRange(view)||focusedTableRange(view))captureInsert()});
const insertMenu=attachMenu(insertButton,insertPopup,id=>{
 if(compositionActive||view.composing||view.state.readOnly)return;
 view.dispatch(id==='footnote'&&insertCellFootnote?insertCellFootnote():insertToolbarItem(view.state,id as SlashItemID,insertBelow));insertBelow=undefined;insertCellFootnote=undefined;
 if(id!=='table'||!focusTableCell(view))view.focus();if(id==='image')void action('image');
});
function separator(){const sep=node('span','format-sep');sep.setAttribute('aria-hidden','true');group.append(sep)}
// Each group wraps as a whole, so a narrow toolbar never splits one across rows.
let cluster=node('span','format-cluster');cluster.append(insertButton);group.prepend(cluster);
for(const [index,buttons] of formatButtons().entries()){
 if(index===1){separator();group.append(headingButton)}
 if(index){separator();cluster=node('span','format-cluster');group.append(cluster)}
 for(const [id,label] of buttons){const b=node('button','tool'),keys=shortcuts[id];b.dataset.action=id;b.dataset.tip=label;b.setAttribute('aria-label',label);if(keys){b.dataset.shortcut=keys;b.setAttribute('aria-keyshortcuts',ariaKeys(keys))}b.append(icon(id));cluster.append(b)}
}
const sourceSeparator=node('span','format-sep format-source-sep');sourceSeparator.setAttribute('aria-hidden','true');sourceSeparator.hidden=true;group.append(sourceSeparator);
const sourceButton=node('button','format-text format-source',messages.fSource());sourceButton.dataset.action='source';sourceButton.dataset.tip=messages.fShowMarkdownSource();sourceButton.dataset.shortcut=shortcuts.source;sourceButton.setAttribute('aria-keyshortcuts',ariaKeys(shortcuts.source));sourceButton.setAttribute('aria-pressed','false');sourceButton.hidden=true;sourceButton.dataset.i18n='fSource';sourceButton.dataset.i18nTip='fShowMarkdownSource';group.append(sourceButton);
$$('#format-bar button').forEach(b=>b.onmousedown=e=>e.preventDefault());
// A separator left at either end of a wrapped row is hidden.
const middle=(el:Element)=>{const r=el.getBoundingClientRect();return r.top+r.height/2};
const separators=new ResizeObserver(()=>{for(const sep of group.querySelectorAll<HTMLElement>(':scope>.format-sep')){const a=sep.previousElementSibling,b=sep.nextElementSibling;sep.style.visibility=a&&b&&Math.max(Math.abs(middle(a)-middle(sep)),Math.abs(middle(b)-middle(sep)))>8?'hidden':''}});
separators.observe(group);separators.observe(sourceButton);
attachMenu(headingButton,$('#heading-menu'),id=>{void action(id)});
// Focus entering or leaving a cell changes the toolbar's block affordances even if its CodeMirror cursor did not move.
document.addEventListener('focusin',()=>{if(view)updateHeading()});document.addEventListener('focusout',()=>setTimeout(()=>{if(view)updateHeading()}));
$$('[data-deliver]').forEach(b=>b.onclick=()=>{closeDialog('delivery-dialog');void action(b.dataset.deliver!)});
localizePage();
// Shortcut hints in the menus, written for this platform; focus mode is F8 off macOS.
for(const kbd of $$('kbd[data-keys]'))kbd.textContent=keyLabel(kbd.dataset.keys==='focus'?focusKeys:kbd.dataset.keys!);
applyIcons();
// The drawn tooltip replaces title. Controls whose keys do their own action announce them.
attachTooltips();for(const el of $$('.topbar [data-shortcut],.drawer-head [data-shortcut]'))el.setAttribute('aria-keyshortcuts',ariaKeys(el.dataset.shortcut!));
for(const item of $$('#heading-menu [data-menu-action]'))item.setAttribute('aria-keyshortcuts',ariaKeys(shortcuts[item.dataset.menuAction!]));
$$('[data-action]').forEach(b=>b.onclick=()=>void action(b.dataset.action!));
$('#rename-form').onsubmit=e=>{e.preventDefault();const title=$<HTMLInputElement>('#rename-input').value.trim();if(!title)return;void run(async()=>{if(!await saveForAction())return;const result=await call<WorkspaceState>('Rename',doc.id,title);result.appearance=appearance;doc.title=result.current.title;doc.customTitle=result.current.customTitle;state=result;header();sidebarSearch?.refresh();backlinks?.refresh();closeDialog('rename-dialog')})};
async function importFile(file:File){await run(async()=>{if(!await saveForAction())return;const content=await file.text();load(await call<WorkspaceState>('New'));view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content}});await save()})}
$('#open-input').onchange=async()=>{const f=$<HTMLInputElement>('#open-input').files?.[0];if(!f)return;await importFile(f);$<HTMLInputElement>('#open-input').value=''};
if(!desktop){
 window.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault()});
 window.addEventListener('drop',e=>{if(e.dataTransfer?.files.length)e.preventDefault()});
}
document.addEventListener('keydown',e=>{
 if(!e.isComposing&&!e.defaultPrevented&&!compositionActive&&!e.altKey&&!document.querySelector('dialog[open]')&&view){
  const mod=mac?e.metaKey&&!e.ctrlKey:e.ctrlKey&&!e.metaKey;
  if(mod&&e.key.toLowerCase()==='f'&&!e.shiftKey){e.preventDefault();void action('find');return}
  if(documentFind?.opened&&(mod&&e.key.toLowerCase()==='g'||!e.metaKey&&!e.ctrlKey&&e.key==='F3')){e.preventDefault();documentFind.move(e.shiftKey?-1:1);return}
  if(e.key==='Escape'&&documentFind?.opened){e.preventDefault();documentFind.close();return}
 }
 if(!desktop&&!e.isComposing&&!compositionActive&&!e.defaultPrevented&&(mac?e.metaKey&&!e.ctrlKey:e.ctrlKey&&!e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key===','&&!document.querySelector('dialog[open]')){e.preventDefault();void action('settings');return}
 if(e.isComposing||e.defaultPrevented)return;if(!mac&&e.key==='F8'&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey&&!document.querySelector('dialog[open]')){e.preventDefault();void action('focus');return}if(e.key==='Escape'&&!document.querySelector('dialog[open]')){if(outlinePopover){closeOutlinePopover(true);return}if(focusMode)void action('focus');const drawerOpen=!dockQuery.matches&&!$('#drawer').hidden;closeOverlayDrawer();if(drawerOpen)$('#sidebar-button').focus();else if(view)focusContent()}
 if(!document.querySelector('dialog[open]')&&view&&!compositionActive){if(e.altKey&&e.shiftKey&&['ArrowUp','ArrowDown'].includes(e.key)&&(view.hasFocus||!!blockControls(view)?.range)){e.preventDefault();void action('block:'+(e.key==='ArrowUp'?'up':'down'));return}if((e.metaKey||e.ctrlKey&&(mac||!e.altKey))&&e.key==='/'&&(view.hasFocus||!!blockControls(view)?.range)){e.preventDefault();void action('block:menu');return}}
 // Format keys come from shortcuts.ts. In a text field, a menu or a control inside the editor (a table's ⋯ button) they belong to that control, not to the document.
 if(!(e.metaKey||e.ctrlKey)||!mac&&e.ctrlKey&&e.altKey)return;const k=e.key.toLowerCase();let id='';if(document.querySelector('dialog[open]'))return;const format=shortcutAction(e);if(format){if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement||e.target instanceof Element&&e.target.closest('[role=menu],.cm-editor button'))return;e.preventDefault();void action(format);return}if(!mac&&k==='z'&&e.shiftKey)id='redo';if(k==='p')id='pdf';if(k==='f'&&e.shiftKey)id='focus';if(k==='n')id='new';if(k==='o')id='open';if(k==='s')id=e.shiftKey?'saveAs':'save';if(k==='k')id='commands';if(!desktop&&k==='\\')id='layout';if(!desktop&&k==='m'&&e.shiftKey)id='source';if(!desktop&&k==='r'&&e.shiftKey)id='read';if(!desktop&&k==='v'&&e.shiftKey)id='pastePlain';if(id){e.preventDefault();void action(id)}
});
$('.editor-pane').addEventListener('mousedown',e=>{
 if(e.button!==0||e.shiftKey||e.metaKey||e.ctrlKey||e.altKey||!view||view.state.readOnly||compositionActive)return;
 if(![$('.editor-pane'),$('.editor-scroll'),$('.editor-status'),$('#word-count'),$('.paper'),$('#editor'),view.dom,view.scrollDOM,view.contentDOM].includes(e.target as HTMLElement))return;
 if(e.clientY<Math.min(view.contentDOM.getBoundingClientRect().bottom,view.documentTop+view.lineBlockAt(view.state.doc.length).bottom))return;
 e.preventDefault();const state=view.state,doc=state.doc;let last=doc.line(doc.lines);while(last.number>1&&!last.text.trim())last=doc.line(last.number-1);
 // Text below a final table or image needs its own paragraph, as leaving the widget does.
 const table=tableAround(state,last.from+last.text.trimEnd().length);
 const image=imageRanges(state).find(i=>i.from>=last.from&&i.to<=last.to);
 view.dispatch(table?leaveTable(state,table):image?leaveBlock(state,image):{selection:{anchor:doc.length},userEvent:'select.pointer'});view.focus();
});
$('.editor-scroll').addEventListener('scroll',()=>{if(loading||!doc)return;clearTimeout(timer);timer=setTimeout(()=>void save(),500)},{passive:true});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
if(window.mygo){window.mygo.on<Partial<Appearance>>('liubai:appearance-changed',change=>{if(!appearance){pendingAppearance={...pendingAppearance,...change};return}appearance={...appearance,...change};state.appearance=appearance;try{localStorage.setItem('liubai-appearance',JSON.stringify(appearance))}catch{}themeFade(false);applyTheme()});window.mygo.on<Summary>('liubai:captured',summary=>{if(state){state.recent=[summary,...state.recent.filter(d=>d.id!==summary.id)];sidebarSearch?.refresh();backlinks?.refresh();if(!$('#drawer').hidden)renderDrawer()}toast(messages.fCaptured(summary.title),messages.fOpen(),()=>void run(async()=>{if(await saveForAction())load(await call<WorkspaceState>('Activate',summary.id))}))});window.mygo.on<string>('liubai:action',id=>void action(id));window.mygo.on<string>('liubai:disk-changed',id=>{backlinks?.refresh();if(doc?.id===id)void pollStatus()});window.mygo.on<WorkspaceState>('liubai:opened',next=>{openedQueue.push(next.current.id);sidebarSearch?.refresh();backlinks?.refresh();void processOpened()});window.mygo.on<{path:string;error:string}>('liubai:open-failed',f=>toast(messages.fOpenFailed(f.path.split('/').pop()||f.path,f.error)))}
preview=createPreviewController({
 host:$('#preview-content'),
 scroll:$('.preview-scroll'),
 getContent:()=>view?.state.doc.toString()||'',
 resolveImage:resolveImageFor,
 openLink,
});
documentFind=createDocumentFind({getView:()=>view,reading,blocked:()=>busy||compositionActive||!!view?.composing,focusContent,host:$('#preview-content'),scroll:$('.preview-scroll')});
sidebarSearch=createSidebarSearch({
 input:$<HTMLInputElement>('#recent-search'),select:$<HTMLSelectElement>('#tag-filter'),label:$('#recent-label'),list:$('#drawer-list'),status:$('#search-status'),consistency:$('#search-consistency'),
 request:(query,tag)=>call<DocumentFilterResponse>('FilterDocuments',{query,tag} satisfies DocumentFilterRequest),
 activate:(item,hit,inSource)=>void navigateSearch(item,hit,inSource),
 recent:(recent,selected)=>{if(recent)state.recent=recent;renderRecent(selected)},escape:()=>{closeDrawer();focusContent()},
});
backlinks=createBacklinks({
 details:$<HTMLDetailsElement>('#backlinks'),list:$('#backlink-list'),status:$('#backlink-status'),
 request:id=>call<BacklinkResponse>('Backlinks',id),
 activate:(item,hit)=>void navigateSearch(item,hit,false),
});
try{const next=await call<WorkspaceState>('State');load(next);if(next.notices?.length)showNotices(next)}catch(e){banner(messages.fDocumentOpenError(errorText(e)),'notice')}
async function pollStatus(){
 if(!doc||busy||dirty||saveFlight||compositionActive||document.visibilityState!=='visible')return;
 const id=doc.id;let s:DocStatus;try{s=await call<DocStatus>('Status',id)}catch{return}
 if(!doc||doc.id!==id||dirty||busy||saveFlight)return;
 if(s.revision!==doc.revision){await run(async()=>{load(await call<WorkspaceState>('Activate',id));toast(messages.fLoadedTheLatestVersionFromDisk())});return}
 if(s.conflict!==doc.conflict||s.statusCode!==doc.statusCode||s.status!==doc.status){doc.conflict=s.conflict;doc.status=s.status;doc.statusCode=s.statusCode;header();if(s.conflict||statusFailed(s))banner(statusText(s),s.conflict?'conflict':'error');else banner()}
}
setInterval(()=>void pollStatus(),desktop?10000:2000);
document.addEventListener('visibilitychange',()=>void pollStatus());
window.addEventListener('focus',()=>void pollStatus());

function refreshLanguage(){
 sidebarSearch?.localize();
 backlinks?.language();wikiChooser.localize();
 if(compositionActive){localePending=true;return}
 if(!desktop)$('#workspace-label').textContent=messages.fLocalDevelopmentSeparateDrafts();
 insertButton.setAttribute('aria-label',messages.fInsert());insertButton.dataset.tip=messages.fInsert();insertButton.querySelector('span')!.textContent=messages.fInsert();insertPopup.setAttribute('aria-label',messages.fInsert());populateInsertMenu();
 for(const group of formatButtons())for(const [id,label] of group){const button=$<HTMLButtonElement>('#format-bar [data-action='+id+']');button.setAttribute('aria-label',label);button.dataset.tip=label}
 if(!view||!doc)return;
 if(!doc.path&&!doc.customTitle&&!doc.content.trim())doc.title=messages.fUntitledDocument();
 loading=true;
 for(const [id,state] of sessions)sessions.set(id,state.update({effects:editorLocale.reconfigure(localizedEditor()),annotations:Transaction.addToHistory.of(false)}).state);
 view.dispatch({effects:editorLocale.reconfigure(localizedEditor()),annotations:Transaction.addToHistory.of(false)});
 reconfigure();loading=false;documentFind.localize();
 header();scheduleWordCount(true);appearanceDialog.render();preview.refresh();scheduleOutline(true);
 if(!$('#drawer').hidden)renderDrawer();
 if($<HTMLDialogElement>('#commands').open)renderCommands();
 if(doc.conflict||statusFailed(doc))banner(statusText(doc),doc.conflict?'conflict':'error');else if(failedSaveError)banner(messages.fSaveError(errorText(failedSaveError)),'error');
 if($<HTMLDialogElement>('#ready-dialog').open&&readyData){renderReadyInfo();if(prepared)disposeMermaid(prepared);prepared=renderDelivery(readyData,readyAction==='pdf'?'htmlAndMathml':'mathml');$('#print-document').replaceChildren(prepared);const button=$<HTMLButtonElement>('#ready-go');button.disabled=true;void waitImages(prepared).then(()=>{button.disabled=false}).catch(error=>toast(errorText(error)))}
 if($<HTMLDialogElement>('#link-dialog').open&&!$('#link-error').hidden){try{makeLink($<HTMLInputElement>('#link-text').value,$<HTMLInputElement>('#link-url').value)}catch(error){$('#link-error').textContent=errorText(error)}}
 if(bannerKind==='notice'&&retainedNotices.length)banner(retainedNotices.map(noticeText).join('; '),'notice',quarantineReveal);
 $('#toast').hidden=true;
 const locale=pageLocale();
 void call<WorkspaceState>('State').then(next=>{
  if(locale!==pageLocale()||!doc||next.current.id!==doc.id)return;
  doc.title=next.current.title;doc.customTitle=next.current.customTitle;state.recent=next.recent;header();
  if(!$('#drawer').hidden)renderDrawer();
  if(bannerKind==='notice'&&next.notices?.length)showNotices(next);
 }).catch(()=>{});
}
onPageLocaleChange(refreshLanguage);
