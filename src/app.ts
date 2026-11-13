import {createRecoveryStream,type RecoveryChange} from './session-recovery';
import {recoveryJournal} from './recovery-journal';
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
import {focusTableCell,focusedTableRange,formatTableCell,tableFootnote,tableAround} from './table-ui';
import {focusedImageRange} from './image-ui';
import {imageRanges} from './images';
import {leaveBlock} from './block-navigation';
import {filterSlashItems,insertToolbarItem,type SlashItemID,openSlashMenu} from './slash';
import {Transaction,Compartment,StateEffect,type Text,type ChangeSet} from '@codemirror/state';
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
import {renderDelivery,waitImages,prepareRichClipboard,copyRich,type RichClipboard,type Delivery} from './delivery';
import {anchorPrefix,plainAnchors} from './headings';
import {createPreviewController,type PreviewController} from './preview';
import {normalizeImageDestination} from './markdown';
import {countWords} from './stats';
import {escapeHtml as escapeHTML} from 'markdown-it/lib/common/utils.mjs';
import {captureSettingsDialog} from './capture-settings';
import {appearanceSettings,themeText} from './appearance-settings';
import {preserveEditorScroll} from './typography';
import {pasteText,dataUrlBlob,type PasteImage} from './paste';
import {themes,isDark,resolveTheme,paintTheme,watchTheme,type ThemeID} from './theme';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>Array.from(document.querySelectorAll<HTMLElement>(s));
const node=(tag:string,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;if(tag==='button')n.setAttribute('type','button');return n};
let state:WorkspaceState,doc:Doc,view:EditorView,appearance:Appearance,source=false,loading=false,busy=false,dirty=false;
let timer:ReturnType<typeof setTimeout>,toastTimer:ReturnType<typeof setTimeout>,saveFlight:Promise<boolean>|null=null;
let wordCountTimer:ReturnType<typeof setTimeout>;
let generation=0,savedPosition='',closeRequested=false;
let quarantineReveal='',bannerKind:'error'|'conflict'|'changed'|'notice'='error';
let localePending=false;
let retainedNotices:LocaleNotice[]=[];
let failedSaveError:unknown;
let readyData:Delivery|null=null;
let readyClipboard:RichClipboard|null=null;
let removeID='',removeUntil=0,removeTimer:ReturnType<typeof setTimeout>;
let appearanceQueue:Promise<void>=Promise.resolve();
let pendingAppearance:Partial<Appearance>|null=null;
let cancelTypographyScroll=()=>{};
let preview:PreviewController;
let documentFind:ReturnType<typeof createDocumentFind>;
let sidebarSearch:ReturnType<typeof createSidebarSearch>;
let backlinks:ReturnType<typeof createBacklinks>;
let navigationEpoch=0;
let cancelLayoutScroll=()=>{};
let layoutBeforeRead:Appearance['layout'];
const editLock=new Compartment();
const openedQueue:string[]=[];
let compositionActive=false,focusMode=false;let pendingClose=false;let pendingMissing:()=>Promise<void>=async()=>{};let prepared:HTMLElement|null=null,readyAction='';let editRange:{from:number;to:number;raw?:string}|null=null;
const sessions=new Map<string,EditorState>();
const sessionRich=new Map<string,boolean>();
const imageCache=new Map<string,Promise<string>>();
// A document switched away from keeps its editor state (selection, history), but only the most recent few: each holds a full copy.
const sessionLimit=8;
function keepSession(id:string,state:EditorState){sessions.delete(id);sessions.set(id,state);sessionRich.set(id,richMode);for(const old of sessions.keys()){if(sessions.size<=sessionLimit)break;sessions.delete(old);sessionRich.delete(old)}}
const imageKey=(id:string,dest:string)=>id+':'+normalizeImageDestination(dest);
const mq=matchMedia('(prefers-color-scheme:dark)'),reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
const dockQuery=matchMedia('(min-width:1180px)');
let overlayOpen=false;
let outlineHeadings:ReturnType<typeof headings>=[],outlineTimer:ReturnType<typeof setTimeout>,outlineFrame=0;
document.documentElement.classList.toggle('windows',windows);if(windows)$('#reveal-quarantine').dataset.i18n='fShowInFileExplorer';
if(desktop){document.body.classList.add('desktop');$('#command-search').dataset.i18nPlaceholder='fSearchCommands'}else $('#workspace-label').hidden=false;
const errorText=localizedError;
function toast(s:string,label='',activate?:()=>void){$('#toast').textContent=s;if(activate){const b=node('button','',label);b.onclick=activate;$('#toast').append(b)}$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200)}
function saveFailedBanner(){banner(messages.fSaveError(errorText(failedSaveError)),localizedError(failedSaveError)===messages.bDocumentChanged()?'changed':'error')}
// State hands each notice out once, and its check may have reloaded the open file from disk, so every reply goes through here.
function stateArrived(next:WorkspaceState){if(next.notices?.length)showNotices(next);if(doc&&next.current.id===doc.id&&next.current.revision!==doc.revision)void pollStatus()}
function showNotices(next:WorkspaceState){retainedNotices=next.noticeMessages||next.notices?.map(text=>({text}))||[];banner(retainedNotices.map(noticeText).join('; '),'notice',next.quarantineDir)}
// 'changed' is a save refused because the document moved on underneath (bDocumentChanged): retrying cannot succeed, so it offers Reload, in the error colours.
function banner(s='',kind:'error'|'conflict'|'changed'|'notice'='error',reveal=''){bannerKind=kind;const bannerEl=$('#banner');bannerEl.dataset.kind=kind==='changed'?'error':kind;bannerEl.hidden=!s;$('#banner-text').textContent=s;$('#retry-save').hidden=kind!=='error';$('#banner-save-as').hidden=kind==='notice';$('#reload-changed').hidden=kind!=='changed';$('#reload-disk').hidden=kind!=='conflict';$('#overwrite-disk').hidden=kind!=='conflict';quarantineReveal=kind==='notice'?reveal:'';$('#reveal-quarantine').hidden=!desktop||!quarantineReveal}
$('#reveal-quarantine').onclick=()=>{if(quarantineReveal)void call('Reveal',quarantineReveal).catch(e=>toast(errorText(e)))};
const split=()=>appearance?.layout==='split';
const reading=()=>appearance?.layout==='read';
function focusContent(){if(reading())$('.preview-scroll').focus();else view.focus()}
const sourceActive=()=>split()&&source;
function position(){const r=view.state.selection.main;return {anchor:r.anchor,head:r.head,scroll:$('.editor-scroll').scrollTop}}
function header(){if(!doc)return;const isSplit=split(),isSource=sourceActive();$('#doc-title').textContent=doc.title||messages.fUntitledDocument();$('#save-status').textContent=dirty?(compositionActive?messages.fTyping():messages.fUnsaved()):statusText(doc);const current=reading()?'read':isSplit?'split':'single';$$('[data-view]').forEach(b=>{const checked=b.dataset.view===current;b.setAttribute('aria-checked',String(checked));b.tabIndex=checked?0:-1});const sourceItem=$('[data-menu-action=source]');sourceItem.setAttribute('aria-checked',String(isSource));sourceItem.setAttribute('aria-disabled',String(!isSplit));sourceItem.querySelector('small')!.hidden=isSplit;$('[data-menu-action=focus]').setAttribute('aria-disabled',String(reading()));const sourceButton=$('#format-bar [data-action=source]');sourceButton.hidden=!isSplit;$('.format-source-sep').hidden=!isSplit;sourceButton.setAttribute('aria-pressed',String(isSource));updateHeading();$('.paper').classList.toggle('source-mode',isSource)}
function updateHeading(){
 const image=!!focusedImageRange(view),cell=!!focusedTableRange(view);
 $<HTMLButtonElement>('#heading-button').disabled=cell||image;
 for(const id of ['quote','bullet','ordered','task','indent','outdent']){
  const b=$<HTMLButtonElement>('#format-bar [data-action='+id+']');if(b)b.disabled=cell||image||(['indent','outdent'].includes(id)&&!inList(view.state));
 }
 for(const id of [...Object.keys(inlineMarkers),'clearFormatting','link']){const b=$<HTMLButtonElement>('#format-bar [data-action='+id+']');if(b)b.disabled=image}
 const level=headingLevel(view.state),headingValue=level?messages.fHeading(level):messages.fBody();$('#heading-label').textContent=headingValue;
 // The trigger shows the current paragraph style, but its accessible name must also state what it controls.
 $<HTMLButtonElement>('#heading-button').setAttribute('aria-label',messages.fHeadingLevel()+(pageLocale().startsWith('zh')?'：':': ')+headingValue);
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
let journal:ReturnType<typeof recoveryJournal>|undefined;
const recoverySnapshot=()=>({id:doc.id,content:view.state.doc.toString(),position:position(),composing:compositionActive||view.composing});
let journalFailed=false;
let journalReseed=false;
function journalError(error:unknown){console.warn('liubai recovery journal',error);if(!journalFailed){journalFailed=true;toast(messages.fSaveFailedYourTextIsStillHere())}}
function journalSaved(){try{journal?.saved(recoverySnapshot(),recovery.sequence())}catch(error){journalError(error)}}
function seedRecovery(){if(desktop)recovery.seed(recoverySnapshot())}
const recovery=createRecoveryStream(packet=>call('StageRecovery',packet),recoverySnapshot,packet=>{try{
 journal?.record(journalReseed&&packet.content===undefined?{...packet,content:recoverySnapshot().content,changes:undefined}:packet,packet.content===undefined||dirty||compositionActive);
 journalReseed=false;
}catch(error){journalReseed=true;journalError(error)}});
function changed(content=true,changes?:ChangeSet){if(loading||!doc)return;if(content){dirty=true;generation++}if(desktop){const delta:RecoveryChange[]=[];changes?.iterChanges((from,to,_from,_to,insert)=>delta.push({from,to,insert:insert.toString()}));recovery.change({id:doc.id,position:position(),composing:compositionActive||view.composing},delta)}if(content){sidebarSearch?.contentPending();header();scheduleWordCount()}else updateHeading();documentFind?.changed(content);preview.changed(content,view.state.doc.lineAt(view.state.selection.main.head).number-1);if(content)scheduleOutline();else scheduleOutlineLayout();clearTimeout(timer);if(!compositionActive)timer=setTimeout(()=>void save(),content?450:800);syncPending()}
function composition(active:boolean){if(active)navigationEpoch++;compositionActive=active;if(desktop&&doc&&view)recovery.change({id:doc.id,position:position(),composing:active});if(!active&&localePending){localePending=false;refreshLanguage()}preview.composition(active);if(active)clearTimeout(outlineTimer);else scheduleOutline();clearTimeout(timer);if(!active){timer=setTimeout(()=>void save(),800);if(pendingClose){pendingClose=false;void closeApp()}else void processOpened()}syncPending()}
// Reading/single/split without source all share the same rich extension set; rebuilding it on every layout switch remounts every block widget (shaking the height map and dropping inline decorations). Only reconfigure when source mode actually toggles.
let richMode=true;
function reconfigure(){const want=!sourceActive();if(want===richMode)return;richMode=want;view.dispatch({effects:mode.reconfigure(want?richExtensions(resolveImage):[]),annotations:Transaction.addToHistory.of(false)})}
// force: an explicit save or retry resends the content so a failed file write is retried.
async function save(force=false):Promise<boolean>{
 clearTimeout(timer);if(compositionActive)return false;if(saveFlight){const pending=await saveFlight;if(!pending&&dirty)return false;if(dirty||force)return save(force);return true}if(!doc||!view)return true;
 const pos=position();if(!force&&!dirty&&JSON.stringify(pos)===savedPosition)return true;
 const id=doc.id,stamp=generation,positionOnly=!dirty&&!force,content=positionOnly?'':view.state.doc.toString();if(dirty)$('#save-status').textContent=messages.fSaving();
 saveFlight=(async()=>{try{
  if(positionOnly){await call('SavePosition',id,pos);if(doc.id===id){doc.position=pos;savedPosition=JSON.stringify(pos);if(!dirty&&JSON.stringify(position())===JSON.stringify(pos))journalSaved()}return true}
  const result=await call<Doc>('Update',{id,revision:doc.revision,content,position:pos,recoverySequence:desktop?recovery.sequence():0});
  if(doc.id!==id)return true;doc.revision=result.revision;doc.status=result.status;doc.statusCode=result.statusCode;failedSaveError=undefined;doc.conflict=result.conflict;doc.title=result.title;doc.customTitle=result.customTitle;doc.content=content;doc.position=pos;doc.updated=result.updated;
  if(stamp===generation){dirty=false;if(desktop&&!compositionActive&&JSON.stringify(position())===JSON.stringify(pos))journalSaved()}savedPosition=JSON.stringify(pos);header();preview.saved();sidebarSearch?.contentAccepted(dirty);
  if(result.conflict||statusFailed(result))banner(statusText(result),result.conflict?'conflict':'error');else banner();return true;
 }catch(e){if(positionOnly)return true;failedSaveError=e;saveFailedBanner();$('#save-status').textContent=messages.fSaveFailedYourTextIsStillHere();dirty=true;sidebarSearch?.contentFailed();return false}finally{saveFlight=null;syncPending()}})();syncPending();const ok=await saveFlight;if(ok&&dirty)return save();return ok;
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
   doc=target;dirty=false;savedPosition='';seedRecovery();header();documentFind?.changed(true);scheduleWordCount(true);scheduleOutline(true);preview.changed(true,view.state.doc.lineAt(view.state.selection.main.head).number-1);preview.saved();
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
 loading=true;if(view){keepSession(doc.id,view.state);view.destroy()}
 // boot.ts paints the first frame from this copy, so a start after a cleared store shows the saved theme too.
 if(!appearance){appearance={...next.appearance,...pendingAppearance};try{localStorage.setItem('liubai-appearance',JSON.stringify(appearance))}catch{}}pendingAppearance=null;
 state=next;doc=next.current;source=!!appearance.source;dirty=false;failedSaveError=undefined;generation=0;savedPosition=JSON.stringify(doc.position);
 // Pictures stay cached for the open document only, so they are read again (and a replaced file shows) when another opens.
 for(const key of imageCache.keys())if(!key.startsWith(doc.id+':'))imageCache.delete(key);
 view=createEditor($('#editor'),doc,resolveImage,changed,insertImages,composition,openLink,files=>{if(!desktop&&files[0])void importFile(files[0])},importPastedImage,error=>toast(errorText(error)),{action:id=>void action(id==='image'?id:'block:'+id),dispatch:spec=>{if(!compositionActive&&!view.state.readOnly)view.dispatch(spec);view.focus()}});
 // Top margin is the breathing room kept below the format bar when scrolling targets into view. It must stay below the first line's height above the scroller (about 18px at the 15px minimum font size), or hover tooltips anchored on the document's first line are measured as hidden and parked off-screen by CodeMirror.
 view.dispatch({effects:StateEffect.appendConfig.of([editLock.of(EditorState.readOnly.of(false)),EditorView.scrollMargins.of(()=>({top:12}))])});
 const cached=sessions.get(doc.id);if(cached&&cached.doc.toString()===doc.content){view.setState(cached);richMode=sessionRich.get(doc.id)??true}
 else richMode=true;
 // Reading layout keeps the editor editable-state (it is visibility:hidden, pointer-events:none and focus moves to the preview): flipping readOnly swaps widget DOM (e.g. table cell line boxes) and corrupts CodeMirror's cached height map for off-viewport blocks, so the document jumped on return.
 view.dispatch({effects:[editLock.reconfigure(EditorState.readOnly.of(busy)),editorLocale.reconfigure(localizedEditor())]});
 reconfigure();
 loading=false;seedRecovery();view.dispatch({effects:setFocus.of(focusMode)});applyTheme();const changedPreviewDocument=preview.setDocument(doc.id);applyLayout();if(!changedPreviewDocument)preview.refresh();header();scheduleWordCount(true);scheduleOutline(true);if(doc.conflict||statusFailed(doc))banner(statusText(doc),doc.conflict?'conflict':'error');else banner();
 const loadedView=view,loadedID=doc.id,loadedGeneration=generation,scroll=doc.position.scroll||0;
 requestAnimationFrame(()=>{
  if(view!==loadedView||doc.id!==loadedID||epoch!==navigationEpoch||compositionActive||hit&&generation!==loadedGeneration)return;
  $('.editor-scroll').scrollTop=scroll;focusContent();if(hit)locateSearch(hit);
 });
 // This redraws the open sidebar too.
 sidebarSearch?.contentAccepted();
 syncBacklinks();
}
async function refreshRecent(){await appearanceQueue.catch(()=>{});const next=await call<WorkspaceState>('State');state=next;sidebarSearch?.refresh();backlinks?.refresh();stateArrived(next)}
function themeID():ThemeID{return resolveTheme(appearance,new Date(),mq.matches)}
// An automatic switch that stays light or stays dark fades the large surfaces into the new theme (.theme-fade in style.css).
// Across schemes it paints at once: text colours flip instantly, so a fading background would leave text unreadable for a moment. Manual changes paint at once too.
let fadeTimer:ReturnType<typeof setTimeout>;
function themeFade(on:boolean){clearTimeout(fadeTimer);document.documentElement.classList.toggle('theme-fade',on);if(on)fadeTimer=setTimeout(()=>document.documentElement.classList.remove('theme-fade'),1100)}
function applyTheme(){if(!appearance)return;paintTheme(document.documentElement,themeID());document.documentElement.style.setProperty('--editor-size',(appearance.fontSize||18)+'px');document.documentElement.style.setProperty('--paper-width',appearance.lineWidth==='full'?'100%':appearance.lineWidth==='wide'?'920px':'760px');appearanceDialog.render();syncDrawer();scheduleOutlineLayout()}
function applyLayout(){
 cancelLayoutScroll();
 const scrollEl=$('.editor-scroll');
 const currentView=view,selection=view.state.selection;
 const controller=new AbortController();
 cancelLayoutScroll=()=>controller.abort();
 for(const event of ['wheel','pointerdown','keydown'])scrollEl.addEventListener(event,cancelLayoutScroll,{passive:true,capture:true,signal:controller.signal});
 const scroll=scrollEl.scrollTop,beforeHeight=scrollEl.clientHeight,wasRead=$('.desk').classList.contains('read-layout');
 $('.desk').classList.toggle('split-layout',split());
 $('.desk').classList.toggle('read-layout',reading());
 $('#format-bar').hidden=reading();
 preview.setVisible(split()||reading());
 view.dispatch({effects:[editLock.reconfigure(EditorState.readOnly.of(busy))]});
 if(reading()&&!wasRead)$('.preview-scroll').focus();
 reconfigure();
 header();
 documentFind?.refresh();
 requestAnimationFrame(()=>{
  // Hiding the format bar in reading view makes the scroller 1 bar taller; shift scroll by the same delta so the viewed line stays put (clamped at both ends).
  // A later navigation or gesture owns the viewport; the old frame must not
  // restore the previous position over Home, a table click or a manual scroll.
  if(!controller.signal.aborted&&view===currentView&&view.state.selection.eq(selection)){
   const target=scroll-(scrollEl.clientHeight-beforeHeight);
   scrollEl.scrollTop=Math.max(0,Math.min(target,scrollEl.scrollHeight-scrollEl.clientHeight));
  }
  controller.abort();
  scheduleOutlineLayout();
 });
}
function applyAppearance(next:Appearance){
 const typography=next.fontSize!==appearance.fontSize||next.lineWidth!==appearance.lineWidth;
 const apply=()=>{appearance=next;source=!!next.source;themeFade(false);applyTheme()};
 if(!typography){cancelTypographyScroll();apply();return}
 const repaint=()=>preview.preserveScroll(apply);
 // preserveEditorScroll ends an earlier restore itself, keeping its anchor.
 if(reading()){cancelTypographyScroll();repaint()}else cancelTypographyScroll=preserveEditorScroll(view,$('.editor-scroll'),repaint);
}
async function setAppearance(change:Partial<Appearance>){
 applyAppearance({...appearance,...change});
 try{const pending=appearanceQueue.catch(()=>{}).then(async()=>{await call('UpdateAppearance',change);try{localStorage.setItem('liubai-appearance',JSON.stringify(appearance))}catch{}});appearanceQueue=pending;await pending}catch(e){toast(messages.fPreferencesError(errorText(e)))}
}
// The caption under each row names the theme under the pointer or focus, else the one in use.
const appearanceDialog=appearanceSettings(()=>appearance,themeID,setAppearance);
watchTheme(()=>{if(!appearance)return;const from=document.documentElement.dataset.liubaiTheme||'',to=themeID();if(from===to)return;themeFade(!reducedMotion.matches&&isDark(from)===isDark(to));applyTheme()});
const triggers=new Map<string,HTMLElement>();
function dialog(id:string,trigger?:HTMLElement){
 const origin=trigger??document.activeElement;
 if(origin instanceof HTMLElement)triggers.set(id,origin);
 $<HTMLDialogElement>('#'+id).showModal();
}
const wikiChooser=createWikiChooser($<HTMLDialogElement>('#wiki-dialog'),$('#wiki-candidates'),()=>dialog('wiki-dialog'));
const openCaptureSettings=captureSettingsDialog(()=>dialog('capture-settings'));
// Focus goes back to the opener once per close. The close event fires a task later, so a closeDialog() caller that
// moves focus on (the find field, the editor) must not see the event hand it back to the opener.
function restoreFocus(id:string){const trigger=triggers.get(id);triggers.delete(id);trigger?.focus()}
function closeDialog(id:string){$<HTMLDialogElement>('#'+id).close();restoreFocus(id)}
function validateDraftName(){const input=$<HTMLInputElement>('#rename-input');input.setCustomValidity(input.value.trim()?'':messages.bNameRequired())}
$$('[data-close]').forEach(b=>b.onclick=()=>{const id=b.dataset.close!;if(id==='drawer'){closeDrawer();$('#sidebar-button').focus()}else closeDialog(id)});
$$('dialog').forEach(el=>{const d=el as HTMLDialogElement;d.addEventListener('close',()=>restoreFocus(d.id));d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))closeDialog(d.id)})});
function renderDrawer(){if(sidebarSearch)sidebarSearch.renderRecent();else renderRecent()}
// One date format per locale: toLocaleString builds a formatter for every row.
let recentDate:{locale:string;format:Intl.DateTimeFormat}|undefined;
function recentTime(time:number){const locale=pageLocale();if(recentDate?.locale!==locale)recentDate={locale,format:new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};return recentDate.format.format(time)}
function renderRecent(selected=''){
 const active=document.activeElement as HTMLElement|null;
 const focusedRemove=active?.dataset.remove,focusedKey=active?.dataset.searchKey;
 const list=$('#drawer-list');list.replaceChildren();
 for(const d of state.recent){const b=node('button','recent-item'+(d.id===doc.id?' active':''));b.dataset.searchKey=d.id+':recent';b.append(node('b','',d.title||messages.fUntitledDocument()),node('p','',d.excerpt||messages.fADocumentWaitingToBegin()),node('small','',recentTime(d.updated)));b.onclick=()=>void run(async()=>{if(await saveForAction()){load(await call<WorkspaceState>('Activate',d.id));closeOverlayDrawer()}});
  const armed=removeID===d.id&&Date.now()<removeUntil,row=node('div','recent-row'),body=node('div','recent-body'),remove=node('button','recent-remove'+(armed?' armed':''),armed?messages.fConfirmRemoval():'×');remove.dataset.remove=d.id;const removeLabel=armed?messages.fConfirmRemoval():messages.fRemoveFromRecentDocuments();remove.setAttribute('aria-label',removeLabel);remove.dataset.tip=removeLabel;remove.onclick=()=>confirmRemove(d.id);
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
    state=restored;renderDrawer();
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
 const next=await call<WorkspaceState>('Delete',id);
 if(next.current.id!==doc.id)load(next);else state=next;
 sessions.delete(id);sessionRich.delete(id);for(const key of imageCache.keys())if(key.startsWith(id+':'))imageCache.delete(key);
 sidebarSearch?.refresh();backlinks?.refresh();renderDrawer();toast(removed.path?messages.fRemovedFromRecentDocumentsTheFileIsUnchanged():messages.fRemovedTheDraftStaysInTheTrashFolderFor())
}
function syncDrawer(){
 const open=dockQuery.matches?!!appearance?.sidebarDocked:overlayOpen,wasHidden=$('#drawer').hidden;
 $('.workspace').classList.toggle('sidebar-docked',dockQuery.matches&&open);
 $('#drawer').hidden=!open;$('#sidebar-button').setAttribute('aria-expanded',String(open));
 // Showing the search redraws the list.
 sidebarSearch?.visible(open);
 backlinks?.visible(open);
 scheduleOutlineLayout();
}
function closeDrawer(){if(dockQuery.matches)void setAppearance({sidebarDocked:false});else{overlayOpen=false;syncDrawer()}}
function closeOverlayDrawer(){if(!dockQuery.matches)closeDrawer()}
async function openDrawer(){if(dockQuery.matches){if(!appearance.sidebarDocked)void setAppearance({sidebarDocked:true})}else overlayOpen=true;syncDrawer();await refreshRecent()}
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
async function toggleMode(){if(!split()){toast(messages.fMarkdownSourceIsAvailableInSplitView());return}const before=document.activeElement;const pending=setAppearance({source:!source});reconfigure();header();await pending;
 // The appearance save can resolve after the user already moved focus (e.g. they clicked a table cell); only hand focus to the editor when nobody else took it.
 if(document.activeElement===before||document.activeElement===document.body)view.focus();}
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
 try{for(const file of files){const image=await importImage(file,id);const alt=file.name.replace(/[\[\]\\\r\n]/g,'').replace(/\.[^.]+$/,'')||messages.fImage();const text=`\n\n![${alt}](${image.markdown})\n\n`;view.dispatch({changes:{from:offset,insert:text},selection:{anchor:offset+text.length},userEvent:'input.paste'});offset+=text.length}await save();view.focus()}catch(e){toast(errorText(e))}finally{setBusy(false)}
}
$('#image-input').onchange=()=>{const input=$<HTMLInputElement>('#image-input');void insertImages(Array.from(input.files||[]));input.value=''};
// Holds nest (a pasted image imports without checking busy), so busy clears only when the last one is released.
let busyHolds=0;
function setBusy(value:boolean){busyHolds=Math.max(0,busyHolds+(value?1:-1));busy=busyHolds>0;if(view)view.dispatch({effects:editLock.reconfigure(EditorState.readOnly.of(busy))});if(!busy){if(pendingClose){pendingClose=false;void closeApp()}else if(openedQueue.length)setTimeout(()=>void processOpened(),500)}syncPending()}
async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);try{await fn()}catch(e){toast(errorText(e))}finally{setBusy(false)}}
async function processOpened(){if(busy||compositionActive||!openedQueue.length)return;const id=openedQueue.shift()!;await run(async()=>{if(await saveForAction())load(await call<WorkspaceState>('Activate',id));else toast(messages.fSaveTheCurrentDocumentFirstFindTheOpenedFile())})}
async function saveAs(){if(!await saveForAction()){await rescue();return;}if(!desktop){download(doc.title+'.md',view.state.doc.toString(),'text/markdown');toast(messages.fMarkdownDownloadedUseExportToIncludeImages());return}const r=await call<ExportResult>('SaveAs',doc.id);if(r.cancelled)return;const old=view.state.doc.toString();doc=r.document;loading=true;try{if(old!==doc.content)view.dispatch({changes:r.changes||[],annotations:Transaction.addToHistory.of(false)})}finally{loading=false}seedRecovery();imageCache.clear();const next=await call<WorkspaceState>('State');state=next;dirty=false;savedPosition='';if(!preview.setDocument(doc.id))preview.refresh();header();documentFind?.changed(true);scheduleWordCount(true);scheduleOutline(true);sidebarSearch?.contentAccepted();banner();stateArrived(next);toast(messages.fSavedWithImages(r.path,r.missing?.length||0))}
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
 prepared=renderDelivery(data,kind==='pdf'?'htmlAndMathml':'mathml',anchorPrefix);$('#print-document').replaceChildren(prepared);await waitImages(prepared);await document.fonts.ready;
 readyClipboard=kind==='copyRich'?await prepareRichClipboard(prepared):null;readyAction=kind;
 readyData=data;renderReadyInfo();$<HTMLButtonElement>('#ready-go').disabled=false;dialog('ready-dialog');
}
function renderReadyInfo(){if(!readyData)return;
 $('#ready-info').textContent=(readyAction==='pdf'?messages.fExportTheCompleteFormattedDocument():readyAction==='copyRich'?messages.fCopyTheTextAndBasicFormatting():readyAction==='docx'?messages.fWordDescription():messages.fDownloadHTMLWithLocalImagesEmbedded())+(readyData.missing.length?messages.fMissingImagesWillShowANote():'')+(readyData.external?messages.fExternalImagesRemainAsLinks():'');
 $('#ready-go').textContent=readyAction==='copyRich'?messages.fCopyRichText():readyAction==='pdf'?(desktop?messages.fSavePDF():messages.fPrintSaveAsPDF()):readyAction==='docx'?(desktop?messages.fSaveWordDocument():messages.fDownloadWordDocument()):messages.fDownloadHTML();
}
// The prepared copy names the export: the current document can change while the dialog is open.
$('#ready-go').onclick=()=>{if(!prepared)return;const root=prepared,title=readyData?.title||doc.title;
 if(readyAction==='copyRich'){
  if(!readyClipboard)return;
  const promise=desktop?call('CopyRich',readyClipboard.html,readyClipboard.text):copyRich(readyClipboard);void promise.then(()=>{closeDialog('ready-dialog');toast(messages.fRichTextCopiedImageSupportDependsOnTheReceiving())}).catch(e=>toast(errorText(e)));return;
 }
 closeDialog('ready-dialog');
 if(readyAction==='html'){const html='<!doctype html><html lang="'+pageLocale()+'"><meta charset="utf-8"><title>'+escapeHTML(title)+'</title><body>'+plainAnchors(root).outerHTML+'</body></html>';if(desktop)void run(async()=>{const r=await call<ExportResult>('SaveHTML',title,html);if(!r.cancelled)toast(messages.fHTMLSaved(r.path))});else download(title+'.html',html,'text/html');return}
 if(readyAction==='docx'){const locale=pageLocale(),snapshot=root.cloneNode(true) as HTMLElement;void run(async()=>{
  const {exportDOCX}=await import('./docx-export'),bytes=await exportDOCX(snapshot,title,locale==='en'?'en-US':'zh-CN');
  if(desktop){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const r=await call<ExportResult>('SaveDOCX',title,btoa(binary));if(!r.cancelled)toast(messages.fWordSaved(r.path))}
  else download(title+'.docx',bytes as BlobPart,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 });return}
 // run() skips the export while another operation holds the editor, so the class goes on inside it.
 if(desktop)void run(async()=>{document.body.classList.add('printing');try{const r=await call<ExportResult>('PDF',title);if(!r.cancelled)toast(messages.fPDFSaved(r.path))}finally{document.body.classList.remove('printing')}});
 else {document.body.classList.add('printing');window.print();document.body.classList.remove('printing')}
};
async function closeApp(){if(compositionActive){pendingClose=true;toast(messages.fFinishComposingYourTextToSaveAndQuit());return}if(busy){pendingClose=true;return}if(closeRequested)return;closeRequested=true;try{await appearanceQueue.catch(()=>{});const ok=await save();if(!ok||dirty){dialog('close-dialog');return}if(desktop)await call('Close');else toast(messages.fYourDocumentIsSavedLocallyYouCanCloseThis())}finally{closeRequested=false}}
$('#discard-close').onclick=()=>{if(desktop)void call('Close');else closeDialog('close-dialog')};
const kbd=(keys:string)=>keyLabel(keys,{spaced:true});
const commands=()=>[
 ['settings',messages.fSettings(),kbd('Mod+,')],
 ['language:system',messages.fLanguageSystem(),''],['language:zh-Hans',messages.fLanguageChinese(),''],['language:en',messages.fLanguageEnglish(),''],['capture',messages.fQuickNote(),''],['captureSettings',messages.fQuickNoteSettings(),''],['new',messages.fNewDocument(),kbd('Mod+N')],['rename',messages.fRename(),''],['open',messages.fOpenDocument(),kbd('Mod+O')],['save',messages.fSave(),kbd('Mod+S')],['saveAs',messages.fSaveAs(),kbd('Mod+Shift+S')],['deliver',messages.fExport(),''],['export',messages.fDocumentAndImagesZIP(),'ZIP'],['pdf',messages.fExportPDF(),''],['docx',messages.fExportWordDocument(),''],['copyRich',messages.fCopyRichText(),''],['pastePlain',messages.fPasteAsPlainText(),kbd('Mod+Shift+V')],['html',messages.fDownloadHTML(),''],['focus',messages.fFocusMode(),kbd(focusKeys)],['recent',messages.fRecentDocuments(),''],['remove',messages.fRemoveCurrentDocumentFromRecents(),''],['outline',messages.fOutline(),''],['find',messages.fFindInDocument(),kbd('Mod+F')],['layout',messages.fToggleSplitView(),kbd('Mod+\\')],['read',messages.fReadingMode(),kbd('Mod+Shift+R')],['source',messages.fShowMarkdownSource(),kbd('Mod+Shift+M')],['image',messages.fInsertImage(),''],['theme',messages.fAppearanceAndTypography(),''],['commands',messages.fAllCommands(),kbd('Mod+K')],...themes.map(t=>{const[n,,g]=themeText(t.id);return['theme:'+t.id,messages.fSwitchTheme(t.series==='hours'?g+' '+n:n+' '+g),'']}),['bold',messages.fBoldSelection(),kbd(shortcuts.bold)],['italic',messages.fItalicizeSelection(),kbd(shortcuts.italic)],['paragraph',messages.fBody(),kbd(shortcuts.paragraph)],['h1',messages.fHeading1(),kbd(shortcuts.h1)],['h2',messages.fHeading2(),kbd(shortcuts.h2)],['h3',messages.fHeading3(),kbd(shortcuts.h3)],['h4',messages.fHeading4(),kbd(shortcuts.h4)],['h5',messages.fHeading5(),kbd(shortcuts.h5)],['h6',messages.fHeading6(),kbd(shortcuts.h6)],['underline',messages.fUnderline(),kbd(shortcuts.underline)],['highlight',messages.fHighlight(),kbd(shortcuts.highlight)],['superscript',messages.fSuperscript(),''],['subscript',messages.fSubscript(),''],['clearFormatting',messages.fClearFormatting(),''],['indent',messages.fIndent(),''],['outdent',messages.fOutdent(),''],['strike',messages.fStrikethrough(),kbd(shortcuts.strike)],['inlineCode',messages.fInlineCode(),kbd(shortcuts.inlineCode)],['quote',messages.fInsertBlockquote(),''],['task',messages.fInsertTaskList(),kbd(shortcuts.task)],['code',messages.fInsertCodeBlock(),''],['math',messages.fFormula(),''],['mermaid',messages.fDiagram(),''],['footnote',messages.fFootnote(),''],['details',messages.fDetails(),''],['table',messages.fInsertTable(),''],['link',messages.fInsertEditLink(),kbd(shortcuts.link)],['bullet',messages.fBulletedList(),kbd(shortcuts.bullet)],['ordered',messages.fNumberedList(),kbd(shortcuts.ordered)],['undo',messages.fUndo(),kbd('Mod+Z')],['redo',messages.fRedo(),kbd(redoKeys)],...(desktop?[['checkUpdates',messages.bMenuCheckForUpdates(),''],['about',messages.bMenuAbout(),'']]:[])
].filter(([id])=>!desktop||!(['settings','theme','captureSettings'].includes(id)||id.startsWith('theme:')||id.startsWith('language:')));
function renderCommands(){const q=$<HTMLInputElement>('#command-search').value.trim().toLowerCase();const list=$('#command-list');const empty=$<HTMLParagraphElement>('#command-empty');const matches=commands().filter(c=>c[1].toLowerCase().includes(q));list.replaceChildren();matches.forEach(([id,title,key])=>{const b=node('button','command');b.tabIndex=-1;b.append(node('span','',title));if(key)b.append(node('kbd','',key));if(id==='language:zh-Hans')b.dataset.languageAutonym='true';b.onclick=()=>{closeDialog('commands');void action(id)};list.append(b)});empty.textContent=messages.fNoCommandsMatch();list.append(empty);empty.hidden=matches.length>0}
$('#command-search').oninput=renderCommands;$('#command-search').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();$('#command-list button')?.focus()}else if(e.key==='ArrowUp'){e.preventDefault();const all=$$('#command-list .command');all[all.length-1]?.focus()}else if(e.key==='Enter'){e.preventDefault();$('#command-list button')?.click()}else if(e.key==='Escape'){e.preventDefault();closeDialog('commands')}};
$('#command-list').addEventListener('keydown',e=>{const all=$$('#command-list .command'),index=all.indexOf(document.activeElement as HTMLElement);if(index<0)return;let next=-1;if(e.key==='ArrowDown')next=(index+1)%all.length;else if(e.key==='ArrowUp'){next=index-1;if(next<0){e.preventDefault();$('#command-search').focus();return}}else if(e.key==='Home')next=0;else if(e.key==='End')next=all.length-1;if(next>=0){e.preventDefault();all[next]?.focus()}});
async function action(id:string,trigger?:HTMLElement){
 if(id.startsWith('language:')){try{await setPageLocale(id.slice(9)==='system'?'':id.slice(9))}catch(error){toast(errorText(error))}return}
 if(id==='checkUpdates'||id==='about'){void call(id==='about'?'About':'CheckForUpdates').catch(e=>toast(errorText(e)));return}
 if(id==='undo'||id==='redo'){const el=document.activeElement;if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){document.execCommand(id);return}}
 if(!view||!doc)return;
 if(reading()&&(id in inlineMarkers||id==='clearFormatting'||id==='indent'||id==='outdent'||['paragraph','h1','h2','h3','h4','h5','h6','strike','inlineCode','quote','bullet','ordered','task','bold','italic','code','math','mermaid','footnote','details','link','table','image','pastePlain','undo','redo','source','focus'].includes(id))){toast(messages.fEditingIsUnavailableInReadingModePressRTo(keyLabel('Mod+Shift+R')));return}
 if(busy){if(id==='close')pendingClose=true;return;}
 if(compositionActive&&id!=='close'){toast(messages.fFinishComposingYourTextFirst());return}
 const imageRange=focusedImageRange(view),cellRange=imageRange||focusedTableRange(view);
 if(imageRange&&(id in inlineMarkers||['clearFormatting','link'].includes(id)))return;
 if(cellRange){
  if(id==='footnote'&&!imageRange){const spec=tableFootnote(view)?.();if(spec)view.dispatch(spec);view.focus();return}
  if(id==='math'&&!imageRange){formatTableCell(view,id);return}
  if(id in inlineMarkers||id==='clearFormatting'||id==='link'){formatTableCell(view,id);return}
  if(['paragraph','h1','h2','h3','h4','h5','h6','quote','bullet','ordered','task','indent','outdent'].includes(id))return;
  if(['image','table','code','math','mermaid','details','footnote'].includes(id)){
   view.dispatch(insertToolbarItem(view.state,id as SlashItemID,cellRange));
   if(id==='image'){view.focus();$('#image-input').click()}else if(id!=='table'||!focusTableCell(view))view.focus();return;
  }
 }
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
 if(['quote','bullet','ordered','task'].includes(id)){view.dispatch(blockFormat(view.state,id as BlockKind));view.focus();return}
 if(id in inlineMarkers){view.dispatch(wrapSelection(view.state,...inlineMarkers[id]));view.focus();return}
 if(id==='pastePlain'){
  const target=view;
  try{const text=desktop?await call<string>('ClipboardText'):await navigator.clipboard.readText();if(view!==target||view.state.readOnly||reading()||compositionActive)return;view.dispatch(pasteText(view.state,text));view.focus()}catch(error){toast(messages.fClipboardError(errorText(error)))}return;
 }
 if(id==='footnote'){view.dispatch(insertFootnote(view.state));view.focus();return}
 if(id==='details'){view.dispatch(insertToolbarItem(view.state,'details'));view.focus();return}
 if(id==='mermaid'){view.dispatch(insertToolbarItem(view.state,'mermaid'));view.focus();return}
 if(id==='math'){view.dispatch(insertMath(view.state));view.focus();return}
 if(id==='code'){view.dispatch(codeBlock(view.state));view.focus();return}
 if(id==='link'){openLinkEditor(trigger);return}if(id==='table'){view.dispatch(insertTable(view.state));if(!focusTableCell(view))view.focus();return}
 if(id==='focus'){focusMode=!focusMode;document.body.classList.toggle('focus-mode',focusMode);scheduleOutlineLayout();$('#focus-exit').hidden=!focusMode;view.dispatch({effects:setFocus.of(focusMode)});$$('[data-action=focus]').forEach(b=>b.setAttribute('aria-pressed',String(focusMode)));
 // The More-menu entry is a menuitemcheckbox, so screen readers announce whether focus mode is on.
 $$('#more-menu [data-menu-action=focus]').forEach(b=>b.setAttribute('aria-checked',String(focusMode)));view.focus();return}
 if(id==='deliver'){dialog('delivery-dialog',trigger);return}
 if(id==='rescue'){await rescue();return}
 if(id==='retry-close'){closeDialog('close-dialog');savedPosition='';await closeApp();return}
 if(id.startsWith('theme:')){await setAppearance({theme:id.split(':')[1] as ThemeID,auto:'off'});return}
 if(id==='rename'){if(doc.path){toast(messages.fUseSaveAsToGiveAnExistingFileA());return}$<HTMLInputElement>('#rename-input').value=doc.title===messages.fUntitledDocument()?'':doc.title;validateDraftName();dialog('rename-dialog',trigger);$<HTMLInputElement>('#rename-input').select();return}
 if(id==='read'){await toggleRead();return}if(id==='layout'){await toggleLayout();return}if(id==='source'){await toggleMode();return}if(id==='undo'){undo(view);view.focus();return}if(id==='redo'){redo(view);view.focus();return}if(id==='find'){documentFind.open();return}
 if(id==='settings'||id==='theme'){if(desktop)await call('ShowSettings',id==='theme'?'appearance':'').catch(e=>toast(errorText(e)));else{dialog('appearance',trigger);requestAnimationFrame(()=>$('#themes [aria-checked=true]').focus())}return}
 if(id==='captureSettings'){try{if(desktop)await call('ShowSettings','capture');else await openCaptureSettings()}catch(e){toast(errorText(e))}return}
 if(id==='capture'){if(desktop)await call('ShowCapture').catch(e=>toast(errorText(e)));else toast(messages.fQuickNoteIsAvailableInTheDesktopApp());return}
 if(id==='commands'){$<HTMLInputElement>('#command-search').value='';renderCommands();dialog('commands',trigger);$('#command-search').focus();return}
 if(id==='sidebar'||id==='recent'){await openDrawer();return}if(id==='outline'){toggleOutline();return}
 if(id==='remove'){confirmRemove(doc.id,true);return}
 if(id==='image'){$('#image-input').click();return}if(id==='close'){await closeApp();return}
 await run(async()=>{switch(id){case 'new':if(await saveForAction())load(await call<WorkspaceState>('New'));break;case 'open':if(!await saveForAction())break;if(desktop)load(await call<WorkspaceState>('Open'));else $('#open-input').click();break;case 'save':case 'retry':if(id==='retry')savedPosition='';await save(true);if(!doc.path&&id==='save')await saveAs();break;case 'saveAs':await saveAs();break;case 'export':await exportDoc();break;case 'docx':case 'pdf':case 'copyRich':case 'html':await prepareDelivery(id);break;case 'reloadChanged':load(await call<WorkspaceState>('Activate',doc.id));break;case 'reload':if(await saveForAction())load(await call<WorkspaceState>('Reload',doc.id));break;case 'overwrite':if(!await saveForAction())break;const title=doc.title;load(await call<WorkspaceState>('Overwrite',doc.id));toast(messages.fOverwritten(title));break;}})
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
 if(outlinePopover){
  // Below 480px the button is display:none, but the popover can still open from the command palette or stay open across a resize.
  // A zero-size button rect would pin it to the viewport's top-left corner, so anchor it under the top bar's right edge instead.
  const r=button.getBoundingClientRect(),anchored=r.width>0&&r.height>0,bar=$('.topbar').getBoundingClientRect(),
   top=(anchored?r.bottom:bar.bottom)+6,right=anchored?r.right:innerWidth-8,width=Math.min(280,innerWidth-16);
  outline.style.width=width+'px';outline.style.left=Math.max(8,right-width)+'px';outline.style.top=top+'px';outline.style.maxHeight=Math.max(120,innerHeight-top-16)+'px'}
 else{const {column,viewport,box,free}=room!,desk=$('.desk').getBoundingClientRect(),padding=parseFloat(getComputedStyle(column).paddingTop),top=Math.max(viewport.top+padding,box.top+padding);outline.style.left=(box.right-desk.left+24)+'px';outline.style.top=(top-desk.top)+'px';outline.style.width=Math.min(240,free-40)+'px';outline.style.maxHeight=Math.max(0,viewport.bottom-top-24)+'px'}
 let current:string|undefined;
 if(reading()){const scrollEl=$('.preview-scroll'),top=scrollEl.getBoundingClientRect().top,heads=$('#preview-content').querySelectorAll<HTMLElement>('h1,h2,h3');for(const h of heads){if(h.getBoundingClientRect().top<=top+2)current=h.id.slice(anchorPrefix.length);else break}
  // Before the first heading reaches the top edge the reader is still inside the first section.
  if(!current&&heads.length&&heads[0].getBoundingClientRect().top>top+2)current=heads[0].id.slice(anchorPrefix.length);
  // A final section shorter than the viewport can never scroll its heading to the top; pin it once the reader is at the bottom.
  if(scrollEl.scrollHeight>scrollEl.clientHeight+2&&scrollEl.scrollTop+scrollEl.clientHeight>=scrollEl.scrollHeight-2&&heads.length)current=heads[heads.length-1].id.slice(anchorPrefix.length)}
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
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[e.key==='ArrowDown'?(i+1)%items.length:i<0?items.length-1:(i+items.length-1)%items.length]?.focus()}
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
 const h=headings(view.state,fullTree(500)??syntaxTree(view.state)).find(h=>h.slug===slug||h.text===slug);if(h){if(reading()){const target=Array.from($('#preview-content').querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(el=>el.id===anchorPrefix+h.slug);if(target){const scroll=$('.preview-scroll');scroll.scrollTop+=target.getBoundingClientRect().top-scroll.getBoundingClientRect().top}scheduleOutlineLayout();focusContent()}else{view.dispatch({selection:{anchor:h.from},scrollIntoView:true});view.focus()}}else toast(messages.fHeadingNotFound());
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
const canOpenLink=(url:string)=>wikiTarget(url)!==null||!!localDocumentLink(url)||safeLink(url);
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
function openLinkEditor(trigger?:HTMLElement){
 const existing=linkAt(view.state),r=view.state.selection.main;editRange=existing?{from:existing.from,to:existing.to,raw:view.state.sliceDoc(existing.from,existing.to)}:{from:r.from,to:r.to,raw:view.state.sliceDoc(r.from,r.to)};
 $<HTMLInputElement>('#link-text').value=existing?.text||view.state.sliceDoc(r.from,r.to);
 $<HTMLInputElement>('#link-url').value=existing?.url||'';$('#link-remove').hidden=!existing;$('#link-open').hidden=!canOpenLink($<HTMLInputElement>('#link-url').value);$('#link-error').hidden=true;dialog('link-dialog',trigger);$('#link-text').focus();
}
function applyRange(text:string){if(!editRange)return;if(view.state.sliceDoc(editRange.from,editRange.to)!==editRange.raw){throw Error(messages.fTheDocumentChangedReopenTheEditingPanel())}
 view.dispatch({changes:{from:editRange.from,to:editRange.to,insert:text},selection:{anchor:editRange.from+text.length},userEvent:'input.format',annotations:isolateHistory.of('full')});view.focus();
}
$('#link-form').onsubmit=e=>{e.preventDefault();try{applyRange(makeLink($<HTMLInputElement>('#link-text').value,$<HTMLInputElement>('#link-url').value));closeDialog('link-dialog');view.focus()}catch(e){$('#link-error').textContent=errorText(e);$('#link-error').hidden=false}};
$('#link-open').onclick=()=>openLink($<HTMLInputElement>('#link-url').value);
$('#link-url').addEventListener('input',()=>{const url=$<HTMLInputElement>('#link-url').value;$('#link-open').hidden=!canOpenLink(url);if(!$('#link-error').hidden&&safeLink(url))$('#link-error').hidden=true});
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
attachMenu(insertButton,insertPopup,id=>{
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
// Native Tab scrolling can leave the end of an overflowing flex toolbar
// clipped. Correct only that local strip after focus and its labels settle.
$('#format-bar').addEventListener('focusin',event=>{
 const button=event.target;
 if(!(button instanceof HTMLButtonElement))return;
 requestAnimationFrame(()=>{
  const bar=$('#format-bar');
  if(document.activeElement!==button||bar.scrollWidth<=bar.clientWidth)return;
  const bounds=bar.getBoundingClientRect(),target=button.getBoundingClientRect();
  const delta=target.left<bounds.left+12?target.left-bounds.left-12:target.right>bounds.right-12?target.right-bounds.right+12:0;
  if(delta)bar.scrollLeft+=delta;
 });
});
// A separator left at either end of a wrapped row is hidden.
const middle=(el:Element)=>{const r=el.getBoundingClientRect();return r.top+r.height/2};
const separators=new ResizeObserver(()=>{for(const sep of group.querySelectorAll<HTMLElement>(':scope>.format-sep')){const a=sep.previousElementSibling,b=sep.nextElementSibling;sep.style.visibility=a&&b&&Math.max(Math.abs(middle(a)-middle(sep)),Math.abs(middle(b)-middle(sep)))>8?'hidden':''}});
separators.observe(group);separators.observe(sourceButton);
attachMenu(headingButton,$('#heading-menu'),id=>{void action(id)});
// Focus entering or leaving a cell changes the toolbar's block affordances even if its CodeMirror cursor did not move.
document.addEventListener('focusin',()=>{if(view)updateHeading()});document.addEventListener('focusout',()=>setTimeout(()=>{if(view)updateHeading()}));
$$('[data-deliver]').forEach(b=>b.onclick=()=>{closeDialog('delivery-dialog');void action(b.dataset.deliver!)});
localizePage();
// These show live state, so they carry no data-i18n (a language change must not reset them); this is their text until a document loads.
$('#doc-title').textContent=messages.fUntitledDocument();$('#save-status').textContent=messages.fOpening();$('#heading-label').textContent=messages.fBody();$('#word-count').textContent=messages.f0Words();
// Shortcut hints in the menus, written for this platform; focus mode is F8 off macOS.
for(const kbd of $$('kbd[data-keys]'))kbd.textContent=keyLabel(kbd.dataset.keys==='focus'?focusKeys:kbd.dataset.keys!);
applyIcons();
// The drawn tooltip replaces title. Controls whose keys do their own action announce them.
attachTooltips();for(const el of $$('.topbar [data-shortcut],.drawer-head [data-shortcut]'))el.setAttribute('aria-keyshortcuts',ariaKeys(el.dataset.shortcut!));
for(const item of $$('#heading-menu [data-menu-action]'))item.setAttribute('aria-keyshortcuts',ariaKeys(shortcuts[item.dataset.menuAction!]));
// Safari does not focus clicked buttons; the opening control is still the return target.
$$('[data-action]').forEach(b=>b.onclick=()=>void action(b.dataset.action!,b));
$('#rename-input').addEventListener('input',validateDraftName);
$('#rename-form').onsubmit=e=>{e.preventDefault();const title=$<HTMLInputElement>('#rename-input').value.trim();if(!title)return;void run(async()=>{if(!await saveForAction())return;const result=await call<WorkspaceState>('Rename',doc.id,title);doc.title=result.current.title;doc.customTitle=result.current.customTitle;state=result;header();sidebarSearch?.refresh();backlinks?.refresh();closeDialog('rename-dialog')})};
async function importFile(file:File){await run(async()=>{if(!await saveForAction())return;const content=await file.text();load(await call<WorkspaceState>('New'));view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content}});await save()})}
$('#open-input').onchange=async()=>{const f=$<HTMLInputElement>('#open-input').files?.[0];if(!f)return;await importFile(f);$<HTMLInputElement>('#open-input').value=''};
if(!desktop){
 window.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault()});
 window.addEventListener('drop',e=>{if(e.dataTransfer?.files.length)e.preventDefault()});
}
document.addEventListener('keydown',e=>{
 if(!e.isComposing&&!e.defaultPrevented&&!compositionActive&&!e.altKey&&!document.querySelector('dialog[open]')&&view){
  const mod=mac?e.metaKey&&!e.ctrlKey:e.ctrlKey&&!e.metaKey;
  if(!desktop&&mod&&e.key.toLowerCase()==='f'&&!e.shiftKey){e.preventDefault();void action('find');return}
  if(documentFind?.opened&&(mod&&e.key.toLowerCase()==='g'||!e.metaKey&&!e.ctrlKey&&e.key==='F3')){e.preventDefault();documentFind.move(e.shiftKey?-1:1);return}
  if(e.key==='Escape'&&documentFind?.opened){e.preventDefault();documentFind.close();return}
 }
 if(!desktop&&!e.isComposing&&!compositionActive&&!e.defaultPrevented&&(mac?e.metaKey&&!e.ctrlKey:e.ctrlKey&&!e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key===','&&!document.querySelector('dialog[open]')){e.preventDefault();void action('settings');return}
 if(e.isComposing||e.defaultPrevented)return;if(!desktop&&!mac&&e.key==='F8'&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey&&!document.querySelector('dialog[open]')){e.preventDefault();void action('focus');return}if(e.key==='Escape'&&!document.querySelector('dialog[open]')){if(outlinePopover){closeOutlinePopover(true);return}if(focusMode)void action('focus');const drawerOpen=!dockQuery.matches&&!$('#drawer').hidden;closeOverlayDrawer();if(drawerOpen)$('#sidebar-button').focus();else if(view)focusContent()}
 if(!document.querySelector('dialog[open]')&&view&&!compositionActive){if(e.altKey&&e.shiftKey&&['ArrowUp','ArrowDown'].includes(e.key)&&(view.hasFocus||!!blockControls(view)?.range)){e.preventDefault();void action('block:'+(e.key==='ArrowUp'?'up':'down'));return}if((e.metaKey||e.ctrlKey&&(mac||!e.altKey))&&e.key==='/'&&(view.hasFocus||!!blockControls(view)?.range)){e.preventDefault();void action('block:menu');return}}
 // Format keys come from shortcuts.ts. In a text field, a menu or a control inside the editor (a table's ⋯ button) they belong to that control, not to the document.
 // On desktop the native menu (main.go) owns its keys, so the page handles them only in a browser. Ctrl+Shift+Z is not a Windows menu key, and
 // Ctrl+Shift+F stays with the input method there (platform.ts).
 if(!(mac?e.metaKey&&!e.ctrlKey:e.ctrlKey&&!e.metaKey)||e.altKey)return;const k=e.key.toLowerCase();let id='';if(document.querySelector('dialog[open]'))return;const format=shortcutAction(e);if(format){if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement||e.target instanceof Element&&e.target.closest('[role=menu],.cm-editor button'))return;e.preventDefault();void action(format);return}if(!mac&&k==='z'&&e.shiftKey)id='redo';if(!desktop&&!e.shiftKey){if(k==='p')id='pdf';if(k==='n')id='new';if(k==='o')id='open';if(k==='k')id='commands'}if(!desktop&&mac&&k==='f'&&e.shiftKey)id='focus';if(!desktop&&k==='s')id=e.shiftKey?'saveAs':'save';if(!desktop&&k==='\\')id='layout';if(!desktop&&k==='m'&&e.shiftKey)id='source';if(!desktop&&k==='r'&&e.shiftKey)id='read';if(!desktop&&k==='v'&&e.shiftKey)id='pastePlain';if(id){e.preventDefault();void action(id)}
});
$('.editor-pane').addEventListener('mousedown',e=>{
 if(e.button!==0||e.shiftKey||e.metaKey||e.ctrlKey||e.altKey||!view||view.state.readOnly||compositionActive)return;
 if(![$('.editor-pane'),$('.editor-scroll'),$('.editor-status'),$('#word-count'),$('.paper'),$('#editor'),view.dom,view.scrollDOM,view.contentDOM].includes(e.target as HTMLElement))return;
 if(e.clientY<Math.min(view.contentDOM.getBoundingClientRect().bottom,view.documentTop+view.lineBlockAt(view.state.doc.length).bottom))return;
 e.preventDefault();const state=view.state,doc=state.doc;let last=doc.line(doc.lines);while(last.number>1&&!last.text.trim())last=doc.line(last.number-1);
 // Text below a final table or image needs its own paragraph, as leaving the widget does.
 const table=tableAround(state,last.from+last.text.trimEnd().length);
 const image=imageRanges(state).find(i=>i.from>=last.from&&i.to<=last.to);
 view.dispatch(table||image?leaveBlock(state,(table||image)!):{selection:{anchor:doc.length},userEvent:'select.pointer'});view.focus();
});
$('.editor-scroll').addEventListener('scroll',()=>{if(loading||!doc)return;if(desktop)recovery.change({id:doc.id,position:position(),composing:compositionActive||view.composing});clearTimeout(timer);timer=setTimeout(()=>void save(),500)},{passive:true});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
if(window.mygo){window.mygo.on<Partial<Appearance>>('liubai:appearance-changed',change=>{if(!appearance){pendingAppearance={...pendingAppearance,...change};return}applyAppearance({...appearance,...change});try{localStorage.setItem('liubai-appearance',JSON.stringify(appearance))}catch{}});window.mygo.on<Summary>('liubai:captured',summary=>{if(state){state.recent=[summary,...state.recent.filter(d=>d.id!==summary.id)];sidebarSearch?.refresh();backlinks?.refresh();if(!$('#drawer').hidden)renderDrawer()}toast(messages.fCaptured(summary.title),messages.fOpen(),()=>void run(async()=>{if(await saveForAction())load(await call<WorkspaceState>('Activate',summary.id))}))});window.mygo.on<string>('liubai:action',id=>void action(id));window.mygo.on<string>('liubai:disk-changed',id=>{backlinks?.refresh();if(doc?.id===id)void pollStatus()});window.mygo.on<WorkspaceState>('liubai:opened',next=>{openedQueue.push(next.current.id);sidebarSearch?.refresh();backlinks?.refresh();void processOpened()});window.mygo.on<{path:string;error:string}>('liubai:open-failed',f=>toast(messages.fOpenFailed(f.path.split(/[\\/]/).pop()||f.path,f.error)))}
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
try{
 if(desktop){try{
  const namespace=await call<string>('RecoveryNamespace');journal=recoveryJournal(localStorage,namespace);
  await journal.restore(snapshot=>call('RestoreRecovery',{version:1,sequence:1,previous:0,...snapshot}));
 }catch(error){journalError(error)}}
 const next=await call<WorkspaceState>('State');load(next);stateArrived(next)
}catch(e){banner(messages.fDocumentOpenError(errorText(e)),'notice')}
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
 sidebarSearch?.refresh();
 backlinks?.language();wikiChooser.localize();
 if(compositionActive){localePending=true;return}
 if(!desktop)$('#workspace-label').textContent=messages.fLocalDevelopmentSeparateDrafts();
 insertButton.setAttribute('aria-label',messages.fInsert());insertButton.dataset.tip=messages.fInsert();insertButton.querySelector('span')!.textContent=messages.fInsert();insertPopup.setAttribute('aria-label',messages.fInsert());populateInsertMenu();
 for(const group of formatButtons())for(const [id,label] of group){const button=$<HTMLButtonElement>('#format-bar [data-action='+id+']');button.setAttribute('aria-label',label);button.dataset.tip=label}
 if(!view||!doc)return;
 if(!doc.path&&!doc.customTitle&&!doc.content.trim())doc.title=messages.fUntitledDocument();
 loading=true;
 try{
  for(const [id,state] of sessions)sessions.set(id,state.update({effects:editorLocale.reconfigure(localizedEditor()),annotations:Transaction.addToHistory.of(false)}).state);
  view.dispatch({effects:editorLocale.reconfigure(localizedEditor()),annotations:Transaction.addToHistory.of(false)});
 }finally{loading=false}
 documentFind.localize();
 header();scheduleWordCount(true);appearanceDialog.render();preview.refresh();scheduleOutline(true);
 if(!$('#drawer').hidden)renderDrawer();
 if($<HTMLDialogElement>('#commands').open)renderCommands();
 if(doc.conflict||statusFailed(doc))banner(statusText(doc),doc.conflict?'conflict':'error');else if(failedSaveError)saveFailedBanner();
 if($<HTMLDialogElement>('#ready-dialog').open&&readyData){renderReadyInfo();if(prepared)disposeMermaid(prepared);prepared=renderDelivery(readyData,readyAction==='pdf'?'htmlAndMathml':'mathml',anchorPrefix);$('#print-document').replaceChildren(prepared);const button=$<HTMLButtonElement>('#ready-go'),root=prepared;button.disabled=true;
  // Copy Rich Text carries the notes in the new language too; the button waits for that, and comes back even if an image fails.
  void waitImages(root).then(async()=>{if(readyAction==='copyRich'&&prepared===root)readyClipboard=await prepareRichClipboard(root)}).catch(error=>toast(errorText(error))).finally(()=>{if(prepared===root)button.disabled=false})}
 if($<HTMLDialogElement>('#link-dialog').open&&!$('#link-error').hidden){try{makeLink($<HTMLInputElement>('#link-text').value,$<HTMLInputElement>('#link-url').value)}catch(error){$('#link-error').textContent=errorText(error)}}
 if($<HTMLDialogElement>('#rename-dialog').open)validateDraftName();
 if(bannerKind==='notice'&&retainedNotices.length)banner(retainedNotices.map(noticeText).join('; '),'notice',quarantineReveal);
 $('#toast').hidden=true;
 const locale=pageLocale();
 void call<WorkspaceState>('State').then(next=>{
  stateArrived(next);if(locale!==pageLocale()||!doc||next.current.id!==doc.id)return;
  doc.title=next.current.title;doc.customTitle=next.current.customTitle;state.recent=next.recent;header();
  if(!$('#drawer').hidden)renderDrawer();
 }).catch(()=>{});
}
onPageLocaleChange(refreshLanguage);
