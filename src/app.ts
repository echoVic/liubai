import {messages,pageLocale,localizePage,onPageLocaleChange,setPageLocale,statusText,statusFailed,noticeText,localizedError} from './i18n';
import {call,desktop,type Summary,type LocaleNotice,type Doc,type DocStatus,type WorkspaceState,type Appearance,type ImageResult,type ExportResult} from './types';
import {createEditor,mode,editorLocale,closeSearchPanel,localizedEditor,richExtensions,setFocus,undo,redo,openSearchPanel,EditorState,EditorView} from './editor';
import {Transaction,Compartment,StateEffect} from '@codemirror/state';
import {blockFormat,setHeading,headingLevel,wrapSelection,codeBlock,linkAt,makeLink,safeLink,localDocumentLink,tableAt,parseTable,serializeTable,headings,type BlockKind} from './editing';
import {isolateHistory} from '@codemirror/commands';
import {applyIcons,icon} from './icons';
import {attachMenu} from './menu';
import {renderDelivery,waitImages,copyRich,type Delivery} from './delivery';
import {createPreviewController,type PreviewController} from './preview';
import {normalizeImageDestination} from './markdown';
import {countWords} from './stats';
import {captureSettingsDialog} from './capture-settings';
import {pasteText,dataUrlBlob,type PasteImage} from './paste';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>Array.from(document.querySelectorAll<HTMLElement>(s));
const node=(tag:string,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n};
let state:WorkspaceState,doc:Doc,view:EditorView,appearance:Appearance,source=false,loading=false,busy=false,dirty=false;
let timer:ReturnType<typeof setTimeout>,toastTimer:ReturnType<typeof setTimeout>,saveFlight:Promise<boolean>|null=null;
let wordCountTimer:ReturnType<typeof setTimeout>;
let generation=0,drawerMode='recent',savedPosition='',closeRequested=false;
let quarantineReveal='',bannerKind:'error'|'conflict'|'notice'='error';
let localePending=false;
let retainedNotices:LocaleNotice[]=[];
let failedSaveError:unknown;
let readyData:Delivery|null=null;
let removeID='',removeUntil=0,removeTimer:ReturnType<typeof setTimeout>;
let appearanceQueue:Promise<void>=Promise.resolve();
let preview:PreviewController;
let layoutBeforeRead:Appearance['layout'];
const editLock=new Compartment();
const openedQueue:string[]=[];
let compositionActive=false,focusMode=false;let pendingClose=false;let pendingMissing:()=>Promise<void>=async()=>{};let prepared:HTMLElement|null=null,readyAction='';let editRange:{from:number;to:number;raw?:string}|null=null;let tableRows:string[][]=[],tableAligns:string[]=[];let editingExistingTable=false;
const sessions=new Map<string,EditorState>();
const imageCache=new Map<string,Promise<string>>();
const imageKey=(id:string,dest:string)=>id+':'+normalizeImageDestination(dest);
const mq=matchMedia('(prefers-color-scheme:dark)');
const dockQuery=matchMedia('(min-width:1180px)');
let overlayOpen=false;
let outlineHeadings:ReturnType<typeof headings>=[],outlineTimer:ReturnType<typeof setTimeout>,outlineFrame=0;
const names=():{id:Appearance['theme'];name:string;kind:string}[]=>[{id:'paper',name:messages.fPaper(),kind:messages.fAClearNeutralPage()},{id:'warm',name:messages.fWarm(),kind:messages.fSoftWarmIvory()},{id:'mist',name:messages.fMist(),kind:messages.fAQuietGrayGreenSetting()},{id:'ink',name:messages.fInk(),kind:messages.fAMutedCharcoalNight()}];
if(desktop)document.body.classList.add('desktop');else $('#workspace-label').hidden=false;
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
 const level=headingLevel(view.state);$('#heading-label').textContent=level?messages.fHeading(level):messages.fBody();
 $$('#heading-menu [data-menu-action]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.menuAction===(level?'h'+level:'paragraph'))));
}
function scheduleWordCount(immediate=false){clearTimeout(wordCountTimer);const update=()=>{$('#word-count').textContent=messages.fWordCount(countWords(view.state.doc.toString()))};if(immediate)update();else wordCountTimer=setTimeout(update,400)}
let pendingSent=false;function syncPending(){const pending=dirty||compositionActive||busy||!!saveFlight;if(pending===pendingSent||!desktop)return;pendingSent=pending;void call('SetPending',pending).catch(()=>{pendingSent=!pending})}
function changed(content=true){if(loading||!doc)return;updateHeading();if(content){dirty=true;generation++;header();scheduleWordCount()}preview.changed(content,view.state.doc.lineAt(view.state.selection.main.head).number-1);if(content)scheduleOutline();else scheduleOutlineLayout();clearTimeout(timer);if(!compositionActive)timer=setTimeout(()=>void save(),content?450:800);syncPending()}
function composition(active:boolean){compositionActive=active;if(!active&&localePending){localePending=false;refreshLanguage()}preview.composition(active);if(active)clearTimeout(outlineTimer);else scheduleOutline();clearTimeout(timer);if(!active){timer=setTimeout(()=>void save(),800);if(pendingClose){pendingClose=false;void closeApp()}else void processOpened()}syncPending()}
function reconfigure(){view.dispatch({effects:mode.reconfigure(sourceActive()?[]:richExtensions(resolveImage,openTable)),annotations:Transaction.addToHistory.of(false)})}
// force: an explicit save or retry resends the content so a failed file write is retried.
async function save(force=false):Promise<boolean>{
 clearTimeout(timer);if(compositionActive)return false;if(saveFlight){const pending=await saveFlight;if(!pending&&dirty)return false;if(dirty||force)return save(force);return true}if(!doc||!view)return true;
 const pos=position();if(!force&&!dirty&&JSON.stringify(pos)===savedPosition)return true;
 const id=doc.id,stamp=generation,positionOnly=!dirty&&!force,content=positionOnly?'':view.state.doc.toString();if(dirty)$('#save-status').textContent=messages.fSaving();
 saveFlight=(async()=>{try{
  if(positionOnly){await call('SavePosition',id,pos);if(doc.id===id){doc.position=pos;savedPosition=JSON.stringify(pos)}return true}
  const result=await call<Doc>('Update',{id,revision:doc.revision,content,position:pos});
  if(doc.id!==id)return true;doc.revision=result.revision;doc.status=result.status;doc.statusCode=result.statusCode;failedSaveError=undefined;doc.conflict=result.conflict;doc.title=result.title;doc.customTitle=result.customTitle;doc.content=content;doc.position=pos;doc.updated=result.updated;
  if(stamp===generation)dirty=false;savedPosition=JSON.stringify(pos);header();preview.saved();
  if(result.conflict||statusFailed(result))banner(statusText(result),result.conflict?'conflict':'error');else banner();return true;
 }catch(e){if(positionOnly)return true;failedSaveError=e;banner(messages.fSaveError(errorText(e)),'error');$('#save-status').textContent=messages.fSaveFailedYourTextIsStillHere();dirty=true;return false}finally{saveFlight=null;syncPending()}})();syncPending();const ok=await saveFlight;if(ok&&dirty)return save();return ok;
}
async function saveForAction(){const ok=await save();if(!ok&&dirty){toast(messages.fTrySavingAgainYourTextIsStillHere());return false}await appearanceQueue.catch(()=>{});return true}
async function resolveImageFor(documentID:string,dest:string):Promise<string>{
 if(/^https?:\/\//.test(dest))return dest;
 const key=imageKey(documentID,dest);if(!imageCache.has(key))imageCache.set(key,call<ImageResult>('ReadImage',documentID,dest).then(x=>x.url).catch(e=>{imageCache.delete(key);throw e}));return imageCache.get(key)!;
}
const resolveImage=(dest:string)=>resolveImageFor(doc.id,dest);
function load(next:WorkspaceState){
 loading=true;if(view){sessions.set(doc.id,view.state);view.destroy()}
 if(appearance)next.appearance=appearance;else appearance=next.appearance;
 state=next;doc=next.current;source=!!appearance.source;dirty=false;generation=0;savedPosition=JSON.stringify(doc.position);
 view=createEditor($('#editor'),doc,resolveImage,changed,insertImages,composition,openLink,openTable,files=>{if(!desktop&&files[0])void importFile(files[0])},importPastedImage,error=>toast(errorText(error)));
 view.dispatch({effects:StateEffect.appendConfig.of([editLock.of(EditorState.readOnly.of(false)),EditorView.scrollMargins.of(()=>({top:parseFloat(getComputedStyle($('#editor')).paddingTop)+24}))])});
 const cached=sessions.get(doc.id);if(cached&&cached.doc.toString()===doc.content)view.setState(cached);
 view.dispatch({effects:[editLock.reconfigure(EditorState.readOnly.of(busy||reading())),editorLocale.reconfigure(localizedEditor())]});
 reconfigure();
 loading=false;view.dispatch({effects:setFocus.of(focusMode)});applyTheme();const changedPreviewDocument=preview.setDocument(doc.id);applyLayout();if(!changedPreviewDocument)preview.refresh();header();scheduleWordCount(true);scheduleOutline(true);if(doc.conflict||statusFailed(doc))banner(statusText(doc),doc.conflict?'conflict':'error');else banner();
 requestAnimationFrame(()=>{$('.editor-scroll').scrollTop=doc.position.scroll||0;focusContent()});
 if(!$('#drawer').hidden)renderDrawer();
}
async function refreshRecent(){await appearanceQueue.catch(()=>{});const next=await call<WorkspaceState>('State');next.appearance=appearance;state=next;renderDrawer();if(next.notices?.length)showNotices(next)}
function themeID(){return appearance.followSystem?(mq.matches?'ink':'paper'):appearance.theme}
function applyTheme(){if(!appearance)return;const id=themeID();document.documentElement.dataset.liubaiTheme=id;document.documentElement.style.colorScheme=id==='ink'?'dark':'light';$('#follow-system').setAttribute('aria-checked',String(appearance.followSystem));$<HTMLInputElement>('#follow-system').checked=appearance.followSystem;document.documentElement.style.setProperty('--editor-size',(appearance.fontSize||18)+'px');document.documentElement.style.setProperty('--paper-width',appearance.lineWidth==='full'?'100%':appearance.lineWidth==='wide'?'920px':'760px');$<HTMLSelectElement>('#font-size').value=String(appearance.fontSize||18);$<HTMLSelectElement>('#line-width').value=appearance.lineWidth||'normal';renderThemes();syncDrawer();scheduleOutlineLayout()}
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
 requestAnimationFrame(()=>{$('.editor-scroll').scrollTop=scroll;scheduleOutlineLayout()});
}
async function setAppearance(change:Partial<Appearance>){const next={...appearance,...change};appearance=next;source=!!next.source;state.appearance=next;applyTheme();try{const pending=appearanceQueue.catch(()=>{}).then(async()=>{await call('Appearance',next);try{localStorage.setItem('liubai-appearance',JSON.stringify(next))}catch{}});appearanceQueue=pending;await pending}catch(e){toast(messages.fPreferencesError(errorText(e)))}}
function renderThemes(){const list=$('#themes');list.replaceChildren();names().forEach((t,i)=>{
 const b=node('button','theme-card');b.setAttribute('role','radio');b.setAttribute('aria-label',t.name);b.setAttribute('aria-checked',String(themeID()===t.id));b.tabIndex=themeID()===t.id?0:-1;
 const preview=node('div','theme-swatch preview-'+t.id);preview.setAttribute('aria-hidden','true');preview.append(node('strong','',messages.fAPageToWriteOn()),node('span','',messages.fGiveEachSentenceTimeToArrive()),node('a','',messages.fContinueReading()),node('code','','const note = true'));
 b.append(preview,node('b','',t.name),node('small','',t.kind));if(themeID()===t.id)b.append(node('span','theme-check','✓'));
 b.onclick=()=>{void setAppearance({theme:t.id,followSystem:false}).then(()=>$$('.theme-card')[i]?.focus())};
 b.onkeydown=(e)=>{let n=i;if(e.key==='ArrowRight')n=(i+1)%4;if(e.key==='ArrowLeft')n=(i+3)%4;if(e.key==='ArrowDown'||e.key==='ArrowUp')n=(i+2)%4;if(n!==i){e.preventDefault();$$('.theme-card')[n].focus()}};list.append(b)
 })}
mq.addEventListener('change',applyTheme);
$('#font-size').onchange=()=>void setAppearance({...appearance,fontSize:Number($<HTMLSelectElement>('#font-size').value)});
$('#line-width').onchange=()=>void setAppearance({...appearance,lineWidth:$<HTMLSelectElement>('#line-width').value as Appearance['lineWidth']});
$('#follow-system').onchange=()=>{void setAppearance({theme:themeID(),followSystem:$<HTMLInputElement>('#follow-system').checked})};
const triggers=new Map<string,HTMLElement>();
function dialog(id:string){triggers.set(id,document.activeElement as HTMLElement);($<HTMLDialogElement>('#'+id)).showModal()}
const openCaptureSettings=captureSettingsDialog(()=>dialog('capture-settings'));
function closeDialog(id:string){$<HTMLDialogElement>('#'+id).close();triggers.get(id)?.focus()}
$$('[data-close]').forEach(b=>b.onclick=()=>{const id=b.dataset.close!;if(id==='drawer'){closeDrawer();$('#sidebar-button').focus()}else closeDialog(id)});
$$('dialog').forEach(el=>{const d=el as HTMLDialogElement;d.addEventListener('close',()=>triggers.get(d.id)?.focus());d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))closeDialog(d.id)})});
function renderDrawer(){
 const focusedRemove=(document.activeElement as HTMLElement)?.dataset.remove;
 const list=$('#drawer-list');list.replaceChildren();list.setAttribute('aria-labelledby',drawerMode+'-tab');$$('[data-tab]').forEach(b=>{const selected=b.dataset.tab===drawerMode;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1});$('#recent-search').hidden=drawerMode!=='recent';$('.drawer-open').hidden=drawerMode!=='recent';
 if(drawerMode==='outline'){
  for(const h of headings(view.state)){const b=node('button','outline-item',h.text);b.style.paddingLeft=(10+h.level*10)+'px';b.onclick=()=>{jumpToHeading(h.slug);closeOverlayDrawer()};list.append(b)}
  if(!list.childElementCount)list.append(node('p','dialog-note',messages.fAddAHeadingToSeeTheOutlineHere()));return;
 }
 const q=$<HTMLInputElement>('#recent-search').value.trim().toLowerCase();for(const d of state.recent){if(!(d.title+' '+d.excerpt).toLowerCase().includes(q))continue;const b=node('button','recent-item'+(d.id===doc.id?' active':''));b.append(node('b','',d.title),node('p','',d.excerpt||messages.fADocumentWaitingToBegin()),node('small','',new Date(d.updated).toLocaleString(pageLocale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})));b.onclick=()=>void run(async()=>{if(await saveForAction()){load(await call<WorkspaceState>('Activate',d.id));closeOverlayDrawer()}});
  const armed=removeID===d.id&&Date.now()<removeUntil,row=node('div','recent-row'),remove=node('button','recent-remove'+(armed?' armed':''),armed?messages.fConfirmRemoval():'×');remove.dataset.remove=d.id;remove.setAttribute('aria-label',messages.fRemoveFromRecentDocuments());remove.title=messages.fRemoveFromRecentDocuments();remove.onclick=()=>confirmRemove(d.id);row.append(b,remove);list.append(row);if(focusedRemove===d.id)remove.focus()
 }
 if(!list.childElementCount)list.append(node('p','dialog-note',messages.fNoDocumentsFound()))
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
 renderDrawer();toast(removed.path?messages.fRemovedFromRecentDocumentsTheFileIsUnchanged():messages.fRemovedTheDraftStaysInTheTrashFolderFor())
}
$('#recent-search').oninput=renderDrawer;
function syncDrawer(){
 const open=dockQuery.matches?!!appearance?.sidebarDocked:overlayOpen,wasHidden=$('#drawer').hidden;
 $('.workspace').classList.toggle('sidebar-docked',dockQuery.matches&&open);
 $('#drawer').hidden=!open;$('#sidebar-button').setAttribute('aria-expanded',String(open));
 if(open&&wasHidden&&view)renderDrawer();
 scheduleOutlineLayout();
}
function closeDrawer(){if(dockQuery.matches)void setAppearance({sidebarDocked:false});else{overlayOpen=false;syncDrawer()}}
function closeOverlayDrawer(){if(!dockQuery.matches)closeDrawer()}
async function openDrawer(tab=drawerMode){drawerMode=tab;if(dockQuery.matches){if(!appearance.sidebarDocked)void setAppearance({sidebarDocked:true})}else overlayOpen=true;syncDrawer();renderDrawer();await refreshRecent()}
dockQuery.addEventListener('change',()=>{overlayOpen=false;syncDrawer();if($('#drawer').hidden&&$('#drawer').contains(document.activeElement)&&view)focusContent()});
document.addEventListener('pointerdown',e=>{if(!$('#drawer').hidden&&!$('#drawer').contains(e.target as Node)&&!$('#sidebar-button').contains(e.target as Node))closeOverlayDrawer()});
$('#sidebar-button').onclick=()=>{if($('#drawer').hidden)void action('sidebar');else closeDrawer()};
$$('[data-tab]').forEach((b,i)=>{b.onclick=()=>void openDrawer(b.dataset.tab);b.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=$$('[data-tab]')[1-i];next.click();next.focus()}}});
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
 if(reading()){toast(messages.fEditingIsUnavailableInReadingModePressRTo());return}if(busy||!doc||compositionActive)return;const id=doc.id;let offset=at??view.state.selection.main.from;setBusy(true);
 try{for(const file of files){const image=await importImage(file,id);const alt=file.name.replace(/[\[\]\\\r\n]/g,'').replace(/\.[^.]+$/,'')||messages.fImage();const text=`\n\n![${alt}](${image.markdown})\n\n`;view.dispatch({changes:{from:offset,insert:text},selection:{anchor:offset+text.length},userEvent:'input.paste'});offset+=text.length}await save();reconfigure();view.focus()}catch(e){toast(errorText(e))}finally{setBusy(false)}
}
$('#image-input').onchange=()=>{const input=$<HTMLInputElement>('#image-input');void insertImages(Array.from(input.files||[]));input.value=''};
function setBusy(value:boolean){busy=value;if(view)view.dispatch({effects:editLock.reconfigure(EditorState.readOnly.of(value||reading()))});if(!value){if(pendingClose){pendingClose=false;void closeApp()}else if(openedQueue.length)setTimeout(()=>void processOpened(),500)}syncPending()}
async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);try{await fn()}catch(e){toast(errorText(e))}finally{setBusy(false)}}
async function processOpened(){if(busy||compositionActive||!openedQueue.length)return;const id=openedQueue.shift()!;await run(async()=>{if(await saveForAction())load(await call<WorkspaceState>('Activate',id));else toast(messages.fSaveTheCurrentDocumentFirstFindTheOpenedFile())})}
async function saveAs(){if(!await saveForAction()){await rescue();return;}if(!desktop){download(doc.title+'.md',view.state.doc.toString(),'text/markdown');toast(messages.fMarkdownDownloadedUseExportToIncludeImages());return}const r=await call<ExportResult>('SaveAs',doc.id);if(r.cancelled)return;const old=view.state.doc.toString();doc=r.document;loading=true;if(old!==doc.content)view.dispatch({changes:r.changes||[],annotations:Transaction.addToHistory.of(false)});loading=false;imageCache.clear();reconfigure();const next=await call<WorkspaceState>('State');next.appearance=appearance;state=next;dirty=false;savedPosition='';if(!preview.setDocument(doc.id))preview.refresh();header();scheduleOutline(true);banner();toast(messages.fSavedWithImages(r.path,r.missing?.length||0))}
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
 prepared=renderDelivery(data);$('#print-document').replaceChildren(prepared);await waitImages(prepared);readyAction=kind;
 readyData=data;renderReadyInfo();dialog('ready-dialog');
}
function renderReadyInfo(){if(!readyData)return;
 $('#ready-info').textContent=(readyAction==='pdf'?messages.fExportTheCompleteFormattedDocument():readyAction==='copyRich'?messages.fCopyTheTextAndBasicFormatting():messages.fDownloadHTMLWithLocalImagesEmbedded())+(readyData.missing.length?messages.fMissingImagesWillShowANote():'')+(readyData.external?messages.fExternalImagesRemainAsLinks():'');
 $('#ready-go').textContent=readyAction==='copyRich'?messages.fCopyRichText():readyAction==='pdf'?(desktop?messages.fSavePDF():messages.fPrintSaveAsPDF()):messages.fDownloadHTML();
}
$('#ready-go').onclick=()=>{if(!prepared)return;const root=prepared;
 if(readyAction==='copyRich'){
  const promise=desktop?call('CopyRich',root.outerHTML,root.innerText):copyRich(root);void promise.then(()=>{closeDialog('ready-dialog');toast(messages.fRichTextCopiedImageSupportDependsOnTheReceiving())}).catch(e=>toast(errorText(e)));return;
 }
 closeDialog('ready-dialog');
 if(readyAction==='html'){const html='<!doctype html><html lang="'+pageLocale()+'"><meta charset="utf-8"><title>'+doc.title.replace(/[<>&]/g,'')+'</title><body>'+root.outerHTML+'</body></html>';if(desktop)void run(async()=>{const r=await call<ExportResult>('SaveHTML',doc.title,html);if(!r.cancelled)toast(messages.fHTMLSaved(r.path))});else download(doc.title+'.html',html,'text/html');return}
 document.body.classList.add('printing');
 if(desktop)void run(async()=>{try{const r=await call<ExportResult>('PDF',doc.title);if(!r.cancelled)toast(messages.fPDFSaved(r.path))}finally{document.body.classList.remove('printing')}});
 else {window.print();document.body.classList.remove('printing')}
};
async function closeApp(){if(compositionActive){pendingClose=true;toast(messages.fFinishComposingYourTextToSaveAndQuit());return}if(busy){pendingClose=true;return}if(closeRequested)return;closeRequested=true;try{await appearanceQueue.catch(()=>{});const ok=await save();if(!ok||dirty){dialog('close-dialog');return}if(desktop)await call('Close');else toast(messages.fYourDocumentIsSavedLocallyYouCanCloseThis())}finally{closeRequested=false}}
$('#discard-close').onclick=()=>{if(desktop)void call('Close');else closeDialog('close-dialog')};
const commands=()=>[
 ['language:system',messages.fLanguageSystem(),''],['language:zh-Hans',messages.fLanguageChinese(),''],['language:en',messages.fLanguageEnglish(),''],['capture',messages.fQuickNote(),''],['captureSettings',messages.fQuickNoteSettings(),''],['new',messages.fNewDocument(),'⌘ N'],['rename',messages.fRename(),''],['open',messages.fOpenDocument(),'⌘ O'],['save',messages.fSave(),'⌘ S'],['saveAs',messages.fSaveAs(),'⌘ ⇧ S'],['deliver',messages.fExport(),''],['export',messages.fDocumentAndImagesZIP(),'ZIP'],['pdf',messages.fExportPDF(),''],['copyRich',messages.fCopyRichText(),''],['pastePlain',messages.fPasteAsPlainText(),'⌘ ⇧ V'],['html',messages.fDownloadHTML(),''],['focus',messages.fFocusMode(),'⌘ ⇧ F'],['recent',messages.fRecentDocuments(),''],['remove',messages.fRemoveCurrentDocumentFromRecents(),''],['outline',messages.fOutline(),''],['find',messages.fFindInDocument(),'⌘ F'],['layout',messages.fToggleSplitView(),'⌘ \\'],['read',messages.fReadingMode(),'⌘ ⇧ R'],['source',messages.fShowMarkdownSource(),'⌘ ⇧ M'],['image',messages.fInsertImage(),''],['theme',messages.fAppearanceAndTypography(),''],['commands',messages.fAllCommands(),'⌘ K'],...names().map(t=>['theme:'+t.id,messages.fSwitchTheme(t.name),'']),['bold',messages.fBoldSelection(),'⌘ B'],['italic',messages.fItalicizeSelection(),''],['paragraph',messages.fBody(),''],['h1',messages.fHeading1(),''],['h2',messages.fHeading2(),''],['h3',messages.fHeading3(),''],['strike',messages.fStrikethrough(),''],['inlineCode',messages.fInlineCode(),''],['quote',messages.fInsertBlockquote(),''],['task',messages.fInsertTaskList(),''],['code',messages.fInsertCodeBlock(),''],['table',messages.fInsertEditTable(),''],['link',messages.fInsertEditLink(),'⌘ L'],['bullet',messages.fBulletedList(),''],['ordered',messages.fNumberedList(),''],['undo',messages.fUndo(),'⌘ Z'],['redo',messages.fRedo(),'⌘ ⇧ Z']
];
function renderCommands(){const q=$<HTMLInputElement>('#command-search').value.trim();const list=$('#command-list');list.replaceChildren();commands().filter(c=>c[1].includes(q)).forEach(([id,title,key])=>{const b=node('button','command');b.append(node('span','',title),node('kbd','',key));if(id==='language:zh-Hans')b.dataset.languageAutonym='true';b.onclick=()=>{closeDialog('commands');void action(id)};list.append(b)})}
$('#command-search').oninput=renderCommands;$('#command-search').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();$('#command-list button')?.focus()}if(e.key==='Enter'){e.preventDefault();$('#command-list button')?.click()}};
async function action(id:string){
 if(id.startsWith('language:')){try{await setPageLocale(id.slice(9)==='system'?'':id.slice(9))}catch(error){toast(errorText(error))}return}
 if(id==='undo'||id==='redo'){const el=document.activeElement;if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){document.execCommand(id);return}}
 if(!view||!doc)return;
 if(reading()&&['paragraph','h1','h2','h3','strike','inlineCode','heading','quote','bullet','ordered','task','bold','italic','code','link','table','image','pastePlain','undo','redo','find','source','focus'].includes(id)){toast(messages.fEditingIsUnavailableInReadingModePressRTo());return}
 if(busy){if(id==='close')pendingClose=true;return;}
 if(compositionActive&&id!=='close'){toast(messages.fFinishComposingYourTextFirst());return}
 if(['paragraph','h1','h2','h3'].includes(id)){view.dispatch(setHeading(view.state,id==='paragraph'?0:Number(id.slice(1))));view.focus();return}
 if(['heading','quote','bullet','ordered','task'].includes(id)){view.dispatch(blockFormat(view.state,id as BlockKind));view.focus();return}
 if(id==='bold'||id==='italic'||id==='strike'||id==='inlineCode'){view.dispatch(wrapSelection(view.state,{bold:'**',italic:'_',strike:'~~',inlineCode:'`'}[id]));view.focus();return}
 if(id==='pastePlain'){
  const target=view;
  try{const text=desktop?await call<string>('ClipboardText'):await navigator.clipboard.readText();if(view!==target||view.state.readOnly||compositionActive)return;view.dispatch(pasteText(view.state,text));view.focus()}catch(error){toast(messages.fClipboardError(errorText(error)))}return;
 }
 if(id==='code'){view.dispatch(codeBlock(view.state));view.focus();return}
 if(id==='link'){openLinkEditor();return}if(id==='table'){openTable();return}
 if(id==='focus'){focusMode=!focusMode;document.body.classList.toggle('focus-mode',focusMode);scheduleOutlineLayout();$('#focus-exit').hidden=!focusMode;view.dispatch({effects:setFocus.of(focusMode)});$$('[data-action=focus]').forEach(b=>b.setAttribute('aria-pressed',String(focusMode)));view.focus();return}
 if(id==='deliver'){dialog('delivery-dialog');return}
 if(id==='rescue'){await rescue();return}
 if(id==='retry-close'){closeDialog('close-dialog');savedPosition='';await closeApp();return}
 if(id.startsWith('theme:')){await setAppearance({theme:id.split(':')[1] as Appearance['theme'],followSystem:false});return}
 if(id==='rename'){if(doc.path){toast(messages.fUseSaveAsToGiveAnExistingFileA());return}$<HTMLInputElement>('#rename-input').value=doc.title===messages.fUntitledDocument()?'':doc.title;dialog('rename-dialog');$<HTMLInputElement>('#rename-input').select();return}
 if(id==='read'){await toggleRead();return}if(id==='layout'){await toggleLayout();return}if(id==='source'){await toggleMode();return}if(id==='undo'){undo(view);view.focus();return}if(id==='redo'){redo(view);view.focus();return}if(id==='find'){openSearchPanel(view);return}
 if(id==='theme'){dialog('appearance');requestAnimationFrame(()=>$('#themes [aria-checked=true]').focus());return}
 if(id==='captureSettings'){try{await openCaptureSettings()}catch(e){toast(errorText(e))}return}
 if(id==='capture'){if(desktop)await call('ShowCapture');else toast(messages.fQuickNoteIsAvailableInTheDesktopApp());return}
 if(id==='commands'){renderCommands();dialog('commands');$<HTMLInputElement>('#command-search').value='';renderCommands();$('#command-search').focus();return}
 if(id==='sidebar'||id==='recent'||id==='outline'){await openDrawer(id==='sidebar'?drawerMode:id);return}
 if(id==='remove'){confirmRemove(doc.id,true);return}
 if(id==='image'){$('#image-input').click();return}if(id==='close'){await closeApp();return}
 await run(async()=>{switch(id){case 'new':if(await saveForAction())load(await call<WorkspaceState>('New'));break;case 'open':if(!await saveForAction())break;if(desktop)load(await call<WorkspaceState>('Open'));else $('#open-input').click();break;case 'save':case 'retry':if(id==='retry')savedPosition='';await save(true);if(!doc.path&&id==='save')await saveAs();break;case 'saveAs':await saveAs();break;case 'export':await exportDoc();break;case 'pdf':case 'copyRich':case 'html':await prepareDelivery(id);break;case 'reload':if(await saveForAction())load(await call<WorkspaceState>('Reload',doc.id));break;case 'overwrite':if(!await saveForAction())break;const title=doc.title;load(await call<WorkspaceState>('Overwrite',doc.id));toast(messages.fOverwritten(title));break;}})
}
function scheduleOutline(immediate=false){
 clearTimeout(outlineTimer);if(compositionActive||!view)return;
 const update=()=>{
  outlineHeadings=headings(view.state).filter(h=>h.level<=3);
  const list=$('#right-outline .outline-list');list.replaceChildren();
  for(const h of outlineHeadings){const b=node('button','outline-item',h.text);b.dataset.slug=h.slug;b.style.paddingLeft=(10+(h.level-1)*12)+'px';b.onclick=()=>jumpToHeading(h.slug);list.append(b)}
  if(!$('#drawer').hidden&&drawerMode==='outline')renderDrawer();
  scheduleOutlineLayout();
 };
 if(immediate)update();else outlineTimer=setTimeout(update,200);
}
function scheduleOutlineLayout(){if(!outlineFrame)outlineFrame=requestAnimationFrame(()=>{outlineFrame=0;layoutOutline()})}
function layoutOutline(){
 const outline=$('#right-outline');
 if(!view||!appearance||split()||focusMode||appearance.lineWidth==='full'||outlineHeadings.length<2){outline.hidden=true;return}
 const scroll=$(reading()?'.preview-scroll':'.editor-scroll'),column=$(reading()?'.markdown-document':'#editor');
 if(!column){outline.hidden=true;return}
 const viewport=scroll.getBoundingClientRect(),box=column.getBoundingClientRect(),desk=$('.desk').getBoundingClientRect();
 const free=viewport.left+scroll.clientWidth-box.right;
 if(free<200){outline.hidden=true;return}
 const padding=parseFloat(getComputedStyle(column).paddingTop),top=Math.max(viewport.top+padding,box.top+padding);
 outline.style.left=(box.right-desk.left+24)+'px';outline.style.top=(top-desk.top)+'px';outline.style.width=Math.min(240,free-40)+'px';outline.style.maxHeight=Math.max(0,viewport.bottom-top-24)+'px';outline.hidden=false;
 let current:string|undefined;
 if(reading()){
  for(const h of $('#preview-content').querySelectorAll<HTMLElement>('h1,h2,h3'))if(h.getBoundingClientRect().top<=viewport.top+2)current=h.id;
 }else for(const h of outlineHeadings){if(h.from>view.state.selection.main.head)break;current=h.slug}
 for(const b of $$('#right-outline button')){if(b.dataset.slug===current)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current')}
}
const outlineResize=new ResizeObserver(scheduleOutlineLayout);
for(const selector of ['.workarea','.editor-scroll','.paper','.preview-scroll','#preview-content'])outlineResize.observe($(selector));
new MutationObserver(scheduleOutlineLayout).observe($('#preview-content'),{childList:true,subtree:true});
$('.preview-scroll').addEventListener('scroll',scheduleOutlineLayout,{passive:true});
$('.editor-scroll').addEventListener('scroll',scheduleOutlineLayout,{passive:true});
window.addEventListener('resize',scheduleOutlineLayout);
function jumpToHeading(slug:string){
 const h=headings(view.state).find(h=>h.slug===slug||h.text===slug);if(h){if(reading()){const target=Array.from($('#preview-content').querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(el=>el.id===h.slug);if(target){const scroll=$('.preview-scroll');scroll.scrollTop+=target.getBoundingClientRect().top-scroll.getBoundingClientRect().top}scheduleOutlineLayout();focusContent()}else{view.dispatch({selection:{anchor:h.from},scrollIntoView:true});view.focus()}}else toast(messages.fHeadingNotFound());
}
function openLink(url:string){
 const local=localDocumentLink(url);
 if(local){void run(async()=>{if(!await saveForAction())return;load(await call<WorkspaceState>('OpenLinked',doc.id,url));if(local.fragment)jumpToHeading(local.fragment)});return}
 if(!safeLink(url)){toast(messages.fThisTypeOfLinkIsNotSupported());return}
 if(url.startsWith('#')){let slug=url.slice(1);try{slug=decodeURIComponent(slug)}catch{}jumpToHeading(slug);return}
 if(desktop)void call('OpenLink',url).catch(e=>toast(errorText(e)));else window.open(url,'_blank','noopener,noreferrer');
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
function openTable(){
 const existing=tableAt(view.state),r=view.state.selection.main;editRange=existing||{from:r.from,to:r.to,raw:view.state.sliceDoc(r.from,r.to)};
 editingExistingTable=!!existing;if(existing){const t=parseTable(existing.raw);tableRows=t.rows;tableAligns=t.aligns}else{tableRows=[[messages.fItem(),messages.fNote()],['','']];tableAligns=[]}
 if(tableRows.length>101||(tableRows[0]?.length||0)>12){toast(messages.fEditLargeTablesInMarkdownSource());return}
 renderTable();dialog('table-dialog');$('#table-grid input')?.focus();
}
function renderTable(){
 const host=$('#table-grid');host.replaceChildren();tableRows.forEach((row,i)=>{const line=node('div','table-input-row');line.style.gridTemplateColumns=`repeat(${tableRows[0].length}, minmax(100px,1fr))`;for(let j=0;j<tableRows[0].length;j++){const input=document.createElement('input');input.value=row[j]||'';input.setAttribute('aria-label',i===0?messages.fTableHeaderCell(j+1):messages.fTableCell(i,j+1));input.oninput=()=>{tableRows[i][j]=input.value};line.append(input)}host.append(line)});
 $<HTMLButtonElement>('#table-row').disabled=tableRows.length>=101;$<HTMLButtonElement>('#table-column').disabled=tableRows[0].length>=12;
}
$('#table-row').onclick=()=>{tableRows.push(tableRows[0].map(()=>''));renderTable();$('#table-grid .table-input-row:last-child input')?.focus()};
$('#table-column').onclick=()=>{tableRows.forEach(r=>r.push(''));tableAligns.push('');renderTable()};
$('#table-form').onsubmit=e=>{e.preventDefault();try{if(!editRange)return;const before=!editingExistingTable&&editRange.from>0&&view.state.sliceDoc(editRange.from-1,editRange.from)!=='\n'?'\n\n':'';const after=editingExistingTable?'':editRange.to<view.state.doc.length&&view.state.sliceDoc(editRange.to,editRange.to+1)!=='\n'?'\n\n':'\n';applyRange(before+serializeTable(tableRows,tableAligns)+after);closeDialog('table-dialog');view.focus()}catch(e){toast(errorText(e))}};
const formatButtons=()=>[
 [['bold',messages.fBold(),'⌘B'],['italic',messages.fItalic()],['strike',messages.fStrikethrough()],['inlineCode',messages.fInlineCode()]],
 [['quote',messages.fBlockquote()],['bullet',messages.fBulletedList()],['ordered',messages.fNumberedList()],['task',messages.fTaskList()]],
 [['link',messages.fLink(),'⌘L'],['image',messages.fImage()],['table',messages.fTable()],['code',messages.fCodeBlock()]],
];
for(const group of formatButtons()){
 const sep=node('span','format-sep');sep.setAttribute('aria-hidden','true');$('.format-group').append(sep);
 for(const [id,label,shortcut] of group){const b=node('button','tool');b.dataset.action=id;b.setAttribute('aria-label',label);b.title=label+(shortcut?' '+shortcut:'');b.append(icon(id));$('.format-group').append(b)}
}
const sourceSeparator=node('span','format-sep format-source-sep');sourceSeparator.setAttribute('aria-hidden','true');sourceSeparator.hidden=true;$('.format-group').append(sourceSeparator);
const sourceButton=node('button','format-text format-source',messages.fSource());sourceButton.dataset.action='source';sourceButton.title=messages.fShowMarkdownSourceM();sourceButton.setAttribute('aria-pressed','false');sourceButton.hidden=true;sourceButton.dataset.i18n='fSource';sourceButton.dataset.i18nTitle='fShowMarkdownSourceM';$('.format-group').append(sourceButton);
$$('#format-bar button').forEach(b=>b.onmousedown=e=>e.preventDefault());
attachMenu($('#heading-button'),$('#heading-menu'),id=>{void action(id);view.focus()});
$$('[data-deliver]').forEach(b=>b.onclick=()=>{closeDialog('delivery-dialog');void action(b.dataset.deliver!)});
localizePage();
applyIcons();
$$('[data-action]').forEach(b=>b.onclick=()=>void action(b.dataset.action!));
$('#rename-form').onsubmit=e=>{e.preventDefault();const title=$<HTMLInputElement>('#rename-input').value.trim();if(!title)return;void run(async()=>{if(!await saveForAction())return;const result=await call<WorkspaceState>('Rename',doc.id,title);result.appearance=appearance;doc.title=result.current.title;doc.customTitle=result.current.customTitle;state=result;header();closeDialog('rename-dialog')})};
async function importFile(file:File){await run(async()=>{if(!await saveForAction())return;const content=await file.text();load(await call<WorkspaceState>('New'));view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content}});await save()})}
$('#open-input').onchange=async()=>{const f=$<HTMLInputElement>('#open-input').files?.[0];if(!f)return;await importFile(f);$<HTMLInputElement>('#open-input').value=''};
if(!desktop){
 window.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault()});
 window.addEventListener('drop',e=>{if(e.dataTransfer?.files.length)e.preventDefault()});
}
document.addEventListener('keydown',e=>{
 if(e.isComposing||e.defaultPrevented)return;if(e.key==='Escape'&&!document.querySelector('dialog[open]')){if(focusMode)void action('focus');const drawerOpen=!dockQuery.matches&&!$('#drawer').hidden;closeOverlayDrawer();if(drawerOpen)$('#sidebar-button').focus();else if(view)focusContent()}
 if(!(e.metaKey||e.ctrlKey))return;const k=e.key.toLowerCase();let id='';if(document.querySelector('dialog[open]'))return;if(k==='p')id='pdf';if(k==='l')id='link';if(k==='f'&&e.shiftKey)id='focus';if(k==='b')id='bold';if(k==='n')id='new';if(k==='o')id='open';if(k==='s')id=e.shiftKey?'saveAs':'save';if(k==='k')id='commands';if(!desktop&&k==='\\')id='layout';if(!desktop&&k==='m'&&e.shiftKey)id='source';if(!desktop&&k==='r'&&e.shiftKey)id='read';if(!desktop&&k==='v'&&e.shiftKey)id='pastePlain';if(id){e.preventDefault();void action(id)}
});
$('.editor-pane').addEventListener('mousedown',e=>{
 if(e.button!==0||e.shiftKey||e.metaKey||e.ctrlKey||e.altKey||!view||view.state.readOnly||compositionActive)return;
 if(![$('.editor-pane'),$('.editor-scroll'),$('.editor-status'),$('#word-count'),$('.paper'),$('#editor'),view.dom,view.scrollDOM,view.contentDOM].includes(e.target as HTMLElement))return;
 if(e.clientY<view.documentTop+view.lineBlockAt(view.state.doc.length).bottom)return;
 e.preventDefault();view.dispatch({selection:{anchor:view.state.doc.length},userEvent:'select.pointer'});view.focus();
});
$('.editor-scroll').addEventListener('scroll',()=>{if(loading||!doc)return;clearTimeout(timer);timer=setTimeout(()=>void save(),500)},{passive:true});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
if(window.mygo){window.mygo.on<Summary>('liubai:captured',summary=>{if(state){state.recent=[summary,...state.recent.filter(d=>d.id!==summary.id)];if(!$('#drawer').hidden)renderDrawer()}toast(messages.fCaptured(summary.title),messages.fOpen(),()=>void run(async()=>{if(await saveForAction())load(await call<WorkspaceState>('Activate',summary.id))}))});window.mygo.on<string>('liubai:action',id=>void action(id));window.mygo.on<string>('liubai:disk-changed',id=>{if(doc?.id===id)void pollStatus()});window.mygo.on<WorkspaceState>('liubai:opened',next=>{openedQueue.push(next.current.id);void processOpened()});window.mygo.on<{path:string;error:string}>('liubai:open-failed',f=>toast(messages.fOpenFailed(f.path.split('/').pop()||f.path,f.error)))}
preview=createPreviewController({
 host:$('#preview-content'),
 scroll:$('.preview-scroll'),
 getContent:()=>view?.state.doc.toString()||'',
 resolveImage:resolveImageFor,
 openLink,
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
 if(compositionActive){localePending=true;return}
 if(!desktop)$('#workspace-label').textContent=messages.fLocalDevelopmentSeparateDrafts();
 for(const group of formatButtons())for(const [id,label,shortcut] of group){const button=$<HTMLButtonElement>('#format-bar [data-action='+id+']');button.setAttribute('aria-label',label);button.title=label+(shortcut?' '+shortcut:'')}
 if(!view||!doc)return;
 if(!doc.path&&!doc.customTitle&&!doc.content.trim())doc.title=messages.fUntitledDocument();
 const searchOpen=!!view.dom.querySelector('.cm-search');if(searchOpen)closeSearchPanel(view);
 loading=true;
 for(const [id,state] of sessions)sessions.set(id,state.update({effects:editorLocale.reconfigure(localizedEditor()),annotations:Transaction.addToHistory.of(false)}).state);
 view.dispatch({effects:editorLocale.reconfigure(localizedEditor()),annotations:Transaction.addToHistory.of(false)});
 reconfigure();loading=false;if(searchOpen)openSearchPanel(view);
 header();scheduleWordCount(true);renderThemes();preview.refresh();scheduleOutline(true);
 if(!$('#drawer').hidden)renderDrawer();
 if($<HTMLDialogElement>('#commands').open)renderCommands();
 if($<HTMLDialogElement>('#table-dialog').open)renderTable();
 if(doc.conflict||statusFailed(doc))banner(statusText(doc),doc.conflict?'conflict':'error');else if(failedSaveError)banner(messages.fSaveError(errorText(failedSaveError)),'error');
 if($<HTMLDialogElement>('#ready-dialog').open&&readyData){renderReadyInfo();prepared=renderDelivery(readyData);$('#print-document').replaceChildren(prepared)}
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
