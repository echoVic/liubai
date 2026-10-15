import {call,desktop,type Doc,type DocStatus,type WorkspaceState,type Appearance,type ImageResult,type ExportResult} from './types';
import {createEditor,mode,richExtensions,setFocus,undo,redo,openSearchPanel,EditorState,type EditorView} from './editor';
import {Transaction,Compartment,StateEffect} from '@codemirror/state';
import {blockFormat,wrapSelection,codeBlock,linkAt,makeLink,safeLink,localDocumentLink,tableAt,parseTable,serializeTable,headings,type BlockKind} from './editing';
import {isolateHistory} from '@codemirror/commands';
import {applyIcons,icon} from './icons';
import {renderDelivery,waitImages,copyRich,type Delivery} from './delivery';
import {createPreviewController,type PreviewController} from './preview';
import {normalizeImageDestination} from './markdown';
import {countWords} from './stats';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>Array.from(document.querySelectorAll<HTMLElement>(s));
const node=(tag:string,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n};
let state:WorkspaceState,doc:Doc,view:EditorView,appearance:Appearance,source=false,loading=false,busy=false,dirty=false;
let timer:ReturnType<typeof setTimeout>,toastTimer:ReturnType<typeof setTimeout>,saveFlight:Promise<boolean>|null=null;
let wordCountTimer:ReturnType<typeof setTimeout>;
let generation=0,drawerMode='recent',savedPosition='',closeRequested=false;
let quarantineReveal='';
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
const names:{id:Appearance['theme'];name:string;kind:string}[]=[{id:'paper',name:'纸白',kind:'清晰的中性纸面'},{id:'warm',name:'暖纸',kind:'柔和的米纸暖调'},{id:'mist',name:'雾绿',kind:'沉静的灰绿环境'},{id:'ink',name:'夜墨',kind:'克制的深炭夜色'}];
if(desktop)document.body.classList.add('desktop');else $('#workspace-label').textContent='本地开发版 · 独立草稿存档';
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
function toast(s:string){$('#toast').textContent=s;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200)}
function banner(s='',kind:'error'|'conflict'|'notice'='error',reveal=''){$('#banner').hidden=!s;$('#banner-text').textContent=s;$('#retry-save').hidden=kind!=='error';$('#banner-save-as').hidden=kind==='notice';$('#reload-disk').hidden=kind!=='conflict';$('#overwrite-disk').hidden=kind!=='conflict';quarantineReveal=kind==='notice'?reveal:'';$('#reveal-quarantine').hidden=!desktop||!quarantineReveal}
$('#reveal-quarantine').onclick=()=>{if(quarantineReveal)void call('Reveal',quarantineReveal).catch(e=>toast(errorText(e)))};
const split=()=>appearance?.layout==='split';
const reading=()=>appearance?.layout==='read';
function focusContent(){if(reading())$('.preview-scroll').focus();else view.focus()}
const sourceActive=()=>split()&&source;
function position(){const r=view.state.selection.main;return {anchor:r.anchor,head:r.head,scroll:$('.editor-pane').scrollTop,source:false}}
function header(){if(!doc)return;const isSplit=split(),isSource=sourceActive();$('#doc-title').textContent=doc.title;$('#save-status').textContent=dirty?(compositionActive?'正在输入':'待保存'):doc.status;$('#document-kind').textContent=doc.path?'本地文稿 · '+doc.title:'此刻 · 一篇草稿';$('#mode-button').setAttribute('aria-pressed',String(isSplit));$('#mode-button').setAttribute('aria-label',reading()?'当前为阅读模式，切换到分栏预览':isSplit?'当前为分栏预览，切换到即时排版':'当前为即时排版，切换到分栏预览');$('#mode-label').textContent=reading()?'阅读':isSplit?'分栏预览':'即时排版';$$('[data-action=read]').forEach(b=>b.setAttribute('aria-pressed',String(reading())));$('#source-button').setAttribute('aria-pressed',String(isSource));$('#source-label').textContent=isSource?'源码':'即时';$('.paper').classList.toggle('source-mode',isSource)}
function scheduleWordCount(immediate=false){clearTimeout(wordCountTimer);const update=()=>{$('#word-count').textContent=countWords(view.state.doc.toString()).toLocaleString()+' 字'};if(immediate)update();else wordCountTimer=setTimeout(update,400)}
let pendingSent=false;function syncPending(){const pending=dirty||compositionActive||busy||!!saveFlight;if(pending===pendingSent||!desktop)return;pendingSent=pending;void call('SetPending',pending).catch(()=>{pendingSent=!pending})}
function changed(content=true){if(loading||!doc)return;if(content){dirty=true;generation++;header();scheduleWordCount()}preview.changed(content,view.state.doc.lineAt(view.state.selection.main.head).number-1);clearTimeout(timer);if(!compositionActive)timer=setTimeout(()=>void save(),content?450:800);syncPending()}
function composition(active:boolean){compositionActive=active;preview.composition(active);clearTimeout(timer);if(!active){timer=setTimeout(()=>void save(),800);if(pendingClose){pendingClose=false;void closeApp()}else void processOpened()}syncPending()}
function reconfigure(){view.dispatch({effects:mode.reconfigure(sourceActive()?[]:richExtensions(resolveImage,openTable)),annotations:Transaction.addToHistory.of(false)})}
// force: an explicit save or retry resends the content so a failed file write is retried.
async function save(force=false):Promise<boolean>{
 clearTimeout(timer);if(compositionActive)return false;if(saveFlight){const pending=await saveFlight;if(!pending&&dirty)return false;if(dirty||force)return save(force);return true}if(!doc||!view)return true;
 const pos=position();if(!force&&!dirty&&JSON.stringify(pos)===savedPosition)return true;
 const id=doc.id,stamp=generation,positionOnly=!dirty&&!force,content=positionOnly?'':view.state.doc.toString();if(dirty)$('#save-status').textContent='正在保存';
 saveFlight=(async()=>{try{
  if(positionOnly){await call('SavePosition',id,pos);if(doc.id===id){doc.position=pos;savedPosition=JSON.stringify(pos)}return true}
  const result=await call<Doc>('Update',{id,revision:doc.revision,content,position:pos});
  if(doc.id!==id)return true;doc.revision=result.revision;doc.status=result.status;doc.conflict=result.conflict;doc.title=result.title;doc.content=content;doc.position=pos;doc.updated=result.updated;
  if(stamp===generation)dirty=false;savedPosition=JSON.stringify(pos);header();preview.saved();
  if(result.conflict||result.status.includes('失败'))banner(result.status,result.conflict?'conflict':'error');else banner();return true;
 }catch(e){if(positionOnly)return true;banner('保存失败：'+errorText(e),'error');$('#save-status').textContent='保存失败 · 当前输入仍在';dirty=true;return false}finally{saveFlight=null;syncPending()}})();syncPending();const ok=await saveFlight;if(ok&&dirty)return save();return ok;
}
async function saveForAction(){const ok=await save();if(!ok&&dirty){toast('请先重试保存，当前输入仍保留');return false}await appearanceQueue.catch(()=>{});return true}
async function resolveImageFor(documentID:string,dest:string):Promise<string>{
 if(/^https?:\/\//.test(dest))return dest;
 const key=imageKey(documentID,dest);if(!imageCache.has(key))imageCache.set(key,call<ImageResult>('ReadImage',documentID,dest).then(x=>x.url).catch(e=>{imageCache.delete(key);throw e}));return imageCache.get(key)!;
}
const resolveImage=(dest:string)=>resolveImageFor(doc.id,dest);
function load(next:WorkspaceState){
 loading=true;if(view){sessions.set(doc.id,view.state);view.destroy()}
 if(appearance)next.appearance=appearance;else appearance=next.appearance;
 state=next;doc=next.current;source=!!appearance.source;dirty=false;generation=0;savedPosition=JSON.stringify(doc.position);
 view=createEditor($('#editor'),doc,resolveImage,changed,insertImages,composition,openLink,openTable,files=>{if(!desktop&&files[0])void importFile(files[0])});
 view.dispatch({effects:StateEffect.appendConfig.of(editLock.of(EditorState.readOnly.of(false)))});
 const cached=sessions.get(doc.id);if(cached&&cached.doc.toString()===doc.content)view.setState(cached);
 view.dispatch({effects:editLock.reconfigure(EditorState.readOnly.of(busy||reading()))});
 reconfigure();
 loading=false;view.dispatch({effects:setFocus.of(focusMode)});applyTheme();const changedPreviewDocument=preview.setDocument(doc.id);applyLayout();if(!changedPreviewDocument)preview.refresh();header();scheduleWordCount(true);if(doc.conflict||doc.status.includes('失败'))banner(doc.status,doc.conflict?'conflict':'error');else banner();
 requestAnimationFrame(()=>{$('.editor-pane').scrollTop=doc.position.scroll||0;focusContent()});
 if(!$('#drawer').hidden)renderDrawer();
}
async function refreshRecent(){await appearanceQueue.catch(()=>{});const next=await call<WorkspaceState>('State');next.appearance=appearance;state=next;renderDrawer();if(next.notices?.length)banner(next.notices.join('；'),'notice',next.quarantineDir)}
function themeID(){return appearance.followSystem?(mq.matches?'ink':'paper'):appearance.theme}
function applyTheme(){if(!appearance)return;const id=themeID();document.documentElement.dataset.liubaiTheme=id;document.documentElement.style.colorScheme=id==='ink'?'dark':'light';$('#follow-system').setAttribute('aria-checked',String(appearance.followSystem));$<HTMLInputElement>('#follow-system').checked=appearance.followSystem;document.documentElement.style.setProperty('--editor-size',(appearance.fontSize||18)+'px');document.documentElement.style.setProperty('--paper-width',appearance.lineWidth==='wide'?'920px':'760px');$<HTMLSelectElement>('#font-size').value=String(appearance.fontSize||18);$<HTMLSelectElement>('#line-width').value=appearance.lineWidth||'normal';renderThemes()}
function applyLayout(){
 const scroll=$('.editor-pane').scrollTop;
 $('.desk').classList.toggle('split-layout',split());
 $('.desk').classList.toggle('read-layout',reading());
 preview.setVisible(split()||reading());
 view.dispatch({effects:editLock.reconfigure(EditorState.readOnly.of(busy||reading()))});
 if(reading())$('.preview-scroll').focus();
 reconfigure();
 header();
 requestAnimationFrame(()=>{$('.editor-pane').scrollTop=scroll});
}
async function setAppearance(change:Partial<Appearance>){const next={...appearance,...change};appearance=next;source=!!next.source;state.appearance=next;applyTheme();try{const pending=appearanceQueue.catch(()=>{}).then(async()=>{await call('Appearance',next);try{localStorage.setItem('liubai-appearance',JSON.stringify(next))}catch{}});appearanceQueue=pending;await pending}catch(e){toast('本次已应用，偏好未能保存：'+errorText(e))}}
function renderThemes(){const list=$('#themes');list.replaceChildren();names.forEach((t,i)=>{
 const b=node('button','theme-card');b.setAttribute('role','radio');b.setAttribute('aria-label',t.name);b.setAttribute('aria-checked',String(themeID()===t.id));b.tabIndex=themeID()===t.id?0:-1;
 const preview=node('div','theme-swatch preview-'+t.id);preview.setAttribute('aria-hidden','true');preview.append(node('strong','','一页写作桌'),node('span','','让一句话有时间抵达。'),node('a','','继续阅读'),node('code','','const note = true'));
 b.append(preview,node('b','',t.name),node('small','',t.kind));if(themeID()===t.id)b.append(node('span','theme-check','✓'));
 b.onclick=()=>{void setAppearance({theme:t.id,followSystem:false}).then(()=>$$('.theme-card')[i]?.focus())};
 b.onkeydown=(e)=>{let n=i;if(e.key==='ArrowRight')n=(i+1)%4;if(e.key==='ArrowLeft')n=(i+3)%4;if(e.key==='ArrowDown'||e.key==='ArrowUp')n=(i+2)%4;if(n!==i){e.preventDefault();$$('.theme-card')[n].focus()}};list.append(b)
 })}
mq.addEventListener('change',applyTheme);
$('#font-size').onchange=()=>void setAppearance({...appearance,fontSize:Number($<HTMLSelectElement>('#font-size').value)});
$('#line-width').onchange=()=>void setAppearance({...appearance,lineWidth:$<HTMLSelectElement>('#line-width').value as 'normal'|'wide'});
$('#follow-system').onchange=()=>{void setAppearance({theme:themeID(),followSystem:$<HTMLInputElement>('#follow-system').checked})};
const triggers=new Map<string,HTMLElement>();
function dialog(id:string){triggers.set(id,document.activeElement as HTMLElement);($<HTMLDialogElement>('#'+id)).showModal()}
function closeDialog(id:string){$<HTMLDialogElement>('#'+id).close();triggers.get(id)?.focus()}
$$('[data-close]').forEach(b=>b.onclick=()=>{const id=b.dataset.close!;if(id==='drawer'){$('#drawer').hidden=true;focusContent()}else closeDialog(id)});
$$('dialog').forEach(el=>{const d=el as HTMLDialogElement;d.addEventListener('close',()=>triggers.get(d.id)?.focus());d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))closeDialog(d.id)})});
function renderDrawer(){
 const focusedRemove=(document.activeElement as HTMLElement)?.dataset.remove;
 const list=$('#drawer-list');list.replaceChildren();$('#drawer-title').textContent=drawerMode==='recent'?'最近文稿':'文稿大纲';$('#recent-search').hidden=drawerMode!=='recent';
 if(drawerMode==='outline'){
  for(const h of headings(view.state)){const b=node('button','outline-item',h.text);b.style.paddingLeft=(10+h.level*10)+'px';b.onclick=()=>jumpToHeading(h.slug);list.append(b)}
  if(!list.childElementCount)list.append(node('p','dialog-note','输入 # 标题后，大纲会出现在这里。'));return;
 }
 const q=$<HTMLInputElement>('#recent-search').value.trim().toLowerCase();for(const d of state.recent){if(!(d.title+' '+d.excerpt).toLowerCase().includes(q))continue;const b=node('button','recent-item'+(d.id===doc.id?' active':''));b.append(node('b','',d.title),node('p','',d.excerpt||'一篇等待开始的文稿'),node('small','',new Date(d.updated).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})));b.onclick=()=>void run(async()=>{if(await saveForAction()){load(await call<WorkspaceState>('Activate',d.id));$('#drawer').hidden=true}});
  const armed=removeID===d.id&&Date.now()<removeUntil,row=node('div','recent-row'),remove=node('button','recent-remove'+(armed?' armed':''),armed?'确认移除':'×');remove.dataset.remove=d.id;remove.setAttribute('aria-label','从最近文稿移除');remove.title='从最近文稿移除';remove.onclick=()=>confirmRemove(d.id);row.append(b,remove);list.append(row);if(focusedRemove===d.id)remove.focus()
 }
 if(!list.childElementCount)list.append(node('p','dialog-note','没有找到这篇文稿。'))
}
function confirmRemove(id:string,command=false){
 if(busy)return;if(compositionActive){toast('请先确认输入法候选');return}
 if(removeID===id&&Date.now()<removeUntil){clearTimeout(removeTimer);removeID='';void run(async()=>{try{await removeDocument(id)}finally{if(!$('#drawer').hidden)renderDrawer()}});return}
 clearTimeout(removeTimer);removeID=id;removeUntil=Date.now()+3000;if(!$('#drawer').hidden)renderDrawer();
 removeTimer=setTimeout(()=>{removeID='';if(!$('#drawer').hidden)renderDrawer()},3000);
 if(command)toast('3 秒内再选一次以确认移除')
}
async function removeDocument(id:string){
 const removed=state.recent.find(d=>d.id===id);if(!removed)return;
 if(id===doc.id&&!await saveForAction())return;
 const next=await call<WorkspaceState>('Delete',id);next.appearance=appearance;
 if(next.current.id!==doc.id)load(next);else state=next;
 sessions.delete(id);for(const key of imageCache.keys())if(key.startsWith(id+':'))imageCache.delete(key);
 renderDrawer();toast(removed.path?'已从最近文稿移除，磁盘文件未改动':'已移除，草稿在废纸篓目录保留 30 天')
}
$('#recent-search').oninput=renderDrawer;
async function toggleLayout(){const pending=setAppearance({layout:split()?'single':'split'});applyLayout();await pending;view.focus()}
async function toggleRead(){const layout=reading()?layoutBeforeRead||'single':'read';if(!reading())layoutBeforeRead=appearance.layout;const pending=setAppearance({layout});applyLayout();await pending;focusContent()}
async function toggleMode(){if(!split()){toast('源码编辑仅在分栏预览中可用');return}const pending=setAppearance({source:!source});reconfigure();header();await pending;view.focus()}
async function insertImages(files:File[],at?:number){
 if(reading()){toast('阅读模式下不能编辑，⌘⇧R 返回编辑');return}if(busy||!doc||compositionActive)return;const id=doc.id;let offset=at??view.state.selection.main.from;setBusy(true);
 try{for(const file of files){if(file.size>20*1024*1024)throw Error('图片超过 20 MB');const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('图片无法读取'));r.readAsDataURL(file)});const image=await call<ImageResult>('ImportImage',id,file.name,data);if(doc.id!==id)throw Error('文稿已切换，请重新插入');imageCache.set(imageKey(id,image.destination),Promise.resolve(image.url));const alt=file.name.replace(/[\[\]\\\r\n]/g,'').replace(/\.[^.]+$/,'')||'图片';const text=`\n\n![${alt}](${image.markdown})\n\n`;view.dispatch({changes:{from:offset,insert:text},selection:{anchor:offset+text.length},userEvent:'input.paste'});offset+=text.length}await save();reconfigure();view.focus()}catch(e){toast(errorText(e))}finally{setBusy(false)}
}
$('#image-input').onchange=()=>{const input=$<HTMLInputElement>('#image-input');void insertImages(Array.from(input.files||[]));input.value=''};
function setBusy(value:boolean){busy=value;if(view)view.dispatch({effects:editLock.reconfigure(EditorState.readOnly.of(value||reading()))});if(!value){if(pendingClose){pendingClose=false;void closeApp()}else if(openedQueue.length)setTimeout(()=>void processOpened(),500)}syncPending()}
async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);try{await fn()}catch(e){toast(errorText(e))}finally{setBusy(false)}}
async function processOpened(){if(busy||compositionActive||!openedQueue.length)return;const id=openedQueue.shift()!;await run(async()=>{if(await saveForAction())load(await call<WorkspaceState>('Activate',id));else toast('当前文稿尚未保存，请先处理；打开的文件可从最近文稿进入')})}
async function saveAs(){if(!await saveForAction()){await rescue();return;}if(!desktop){download(doc.title+'.md',view.state.doc.toString(),'text/markdown');toast('浏览器已下载 Markdown；含图片请使用“带走文稿”');return}const r=await call<ExportResult>('SaveAs',doc.id);if(r.cancelled)return;const old=view.state.doc.toString();doc=r.document;loading=true;if(old!==doc.content)view.dispatch({changes:r.changes||[],annotations:Transaction.addToHistory.of(false)});loading=false;imageCache.clear();reconfigure();const next=await call<WorkspaceState>('State');next.appearance=appearance;state=next;dirty=false;savedPosition='';if(!preview.setDocument(doc.id))preview.refresh();header();banner();toast('文稿和图片已保存：'+r.path+(r.missing?.length?' · '+r.missing.length+' 张图片未找到，引用保持原样':''))}
async function rescue(){
 if(desktop){try{const r=await call<ExportResult>('Rescue',doc.id,view.state.doc.toString());if(!r.cancelled)toast('当前内容与图片已另存：'+r.path)}catch(e){toast(errorText(e))}}
 else {download(doc.title+'-恢复副本.md',view.state.doc.toString(),'text/markdown');toast('当前正文已下载；图片仍保留在本机')}
}
function download(name:string,data:BlobPart,type:string){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function exportDoc(allowMissing=false){
 if(!await saveForAction())return;
 if(!desktop){const r=await call<{url?:string;missing:string[];external:number}>('ExportBrowser',doc.id,allowMissing);
  if(r.missing?.length&&!allowMissing){pendingMissing=()=>exportDoc(true);$('#missing-list').textContent=r.missing.join('\n');dialog('missing-dialog');return}
  if(!r.url)throw Error('文稿包尚未准备好');const a=document.createElement('a');a.href=r.url;a.download=doc.title+'.zip';document.body.append(a);a.click();a.remove();toast('文稿包已下载'+(r.missing?.length?' · 保留了缺失图片引用':'')+(r.external?' · 外链图片仍需联网':''));return;
 }
 const r=await call<ExportResult>('Export',doc.id,allowMissing);if(r.cancelled)return;
 if(r.missing?.length&&!allowMissing){pendingMissing=()=>exportDoc(true);$('#missing-list').textContent=r.missing.join('\n');dialog('missing-dialog');return}
 toast('文稿已打包：'+r.path+(r.missing?.length?' · 保留了缺失图片引用':'')+(r.external?' · 外链图片仍需联网':''));
}
$('#export-anyway').onclick=()=>{closeDialog('missing-dialog');void run(pendingMissing)};
async function prepareDelivery(kind:string,allowMissing=false){
 if(!await saveForAction())return;const data=await call<Delivery>('Delivery',doc.id);
 if(data.missing.length&&!allowMissing){pendingMissing=()=>prepareDelivery(kind,true);$('#missing-list').textContent=data.missing.join('\n');dialog('missing-dialog');return}
 prepared=renderDelivery(data);$('#print-document').replaceChildren(prepared);await waitImages(prepared);readyAction=kind;
 $('#ready-info').textContent=(kind==='pdf'?'将导出整篇排版。':kind==='copyRich'?'复制正文和基本格式。':'下载包含本地图片的 HTML。')+(data.missing.length?' 缺失图片将显示提示。':'')+(data.external?' 外链图片保留为链接。':'');
 $('#ready-go').textContent=kind==='copyRich'?'复制富文本':kind==='pdf'?(desktop?'保存 PDF':'打印 / 另存为 PDF'):'下载 HTML';dialog('ready-dialog');
}
$('#ready-go').onclick=()=>{if(!prepared)return;const root=prepared;
 if(readyAction==='copyRich'){
  const promise=desktop?call('CopyRich',root.outerHTML,root.innerText):copyRich(root);void promise.then(()=>{closeDialog('ready-dialog');toast('已复制富文本；图片显示取决于接收应用')}).catch(e=>toast(errorText(e)));return;
 }
 closeDialog('ready-dialog');
 if(readyAction==='html'){const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+doc.title.replace(/[<>&]/g,'')+'</title><body>'+root.outerHTML+'</body></html>';if(desktop)void run(async()=>{const r=await call<ExportResult>('SaveHTML',doc.title,html);if(!r.cancelled)toast('HTML 已保存：'+r.path)});else download(doc.title+'.html',html,'text/html');return}
 document.body.classList.add('printing');
 if(desktop)void run(async()=>{try{const r=await call<ExportResult>('PDF',doc.title);if(!r.cancelled)toast('PDF 已保存：'+r.path)}finally{document.body.classList.remove('printing')}});
 else {window.print();document.body.classList.remove('printing')}
};
async function closeApp(){if(compositionActive){pendingClose=true;toast('请先确认输入法候选，完成后会保存并退出');return}if(busy){pendingClose=true;return}if(closeRequested)return;closeRequested=true;try{await appearanceQueue.catch(()=>{});const ok=await save();if(!ok||dirty){dialog('close-dialog');return}if(desktop)await call('Close');else toast('文稿已保存在本地，可以关闭此页面')}finally{closeRequested=false}}
$('#discard-close').onclick=()=>{if(desktop)void call('Close');else closeDialog('close-dialog')};
const commands=[
 ['new','新建文稿','⌘ N'],['rename','为草稿命名',''],['open','打开本地文稿','⌘ O'],['save','保存','⌘ S'],['saveAs','另存为…','⌘ ⇧ S'],['deliver','带走文稿',''],['export','文稿与图片 ZIP','ZIP'],['pdf','导出 PDF',''],['copyRich','复制富文本',''],['html','下载 HTML',''],['focus','段落专注','⌘ ⇧ F'],['recent','最近文稿',''],['remove','从最近文稿移除当前文稿',''],['outline','文稿大纲',''],['find','查找正文','⌘ F'],['layout','即时排版 / 分栏预览','⌘ \\'],['read','阅读模式','⌘ ⇧ R'],['source','左侧源码 / 即时排版','⌘ ⇧ M'],['image','插入图片',''],['theme','外观与主题',''],...names.map(t=>['theme:'+t.id,'切换主题 · '+t.name,'']),['bold','加粗选中文字','⌘ B'],['italic','斜体选中文字',''],['heading','插入二级标题',''],['quote','插入引用',''],['task','插入任务列表',''],['code','插入代码块',''],['table','插入 / 编辑表格',''],['link','插入 / 编辑链接','⌘ L'],['bullet','无序列表',''],['ordered','有序列表',''],['undo','撤销','⌘ Z'],['redo','重做','⌘ ⇧ Z']
];
function renderCommands(){const q=$<HTMLInputElement>('#command-search').value.trim();const list=$('#command-list');list.replaceChildren();commands.filter(c=>c[1].includes(q)).forEach(([id,title,key])=>{const b=node('button','command');b.append(node('span','',title),node('kbd','',key));b.onclick=()=>{closeDialog('commands');void action(id)};list.append(b)})}
$('#command-search').oninput=renderCommands;$('#command-search').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();$('#command-list button')?.focus()}if(e.key==='Enter'){e.preventDefault();$('#command-list button')?.click()}};
async function action(id:string){
 if(id==='undo'||id==='redo'){const el=document.activeElement;if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){document.execCommand(id);return}}
 if(!view||!doc)return;
 if(reading()&&['heading','quote','bullet','ordered','task','bold','italic','code','link','table','image','undo','redo','find','source','focus'].includes(id)){toast('阅读模式下不能编辑，⌘⇧R 返回编辑');return}
 if(busy){if(id==='close')pendingClose=true;return;}
 if(compositionActive&&id!=='close'){toast('请先确认输入法候选');return}
 if(['heading','quote','bullet','ordered','task'].includes(id)){view.dispatch(blockFormat(view.state,id as BlockKind));view.focus();return}
 if(id==='bold'||id==='italic'){view.dispatch(wrapSelection(view.state,id==='bold'?'**':'_'));view.focus();return}
 if(id==='code'){view.dispatch(codeBlock(view.state));view.focus();return}
 if(id==='link'){openLinkEditor();return}if(id==='table'){openTable();return}
 if(id==='focus'){focusMode=!focusMode;document.body.classList.toggle('focus-mode',focusMode);$('#focus-exit').hidden=!focusMode;view.dispatch({effects:setFocus.of(focusMode)});$$('[data-action=focus]').forEach(b=>b.setAttribute('aria-pressed',String(focusMode)));view.focus();return}
 if(id==='deliver'){dialog('delivery-dialog');return}
 if(id==='rescue'){await rescue();return}
 if(id==='retry-close'){closeDialog('close-dialog');savedPosition='';await closeApp();return}
 if(id.startsWith('theme:')){await setAppearance({theme:id.split(':')[1] as Appearance['theme'],followSystem:false});return}
 if(id==='rename'){if(doc.path){toast('已有文件可通过“另存为”设置新名称');return}$<HTMLInputElement>('#rename-input').value=doc.title==='未命名文稿'?'':doc.title;dialog('rename-dialog');$<HTMLInputElement>('#rename-input').select();return}
 if(id==='read'){await toggleRead();return}if(id==='layout'){await toggleLayout();return}if(id==='source'){await toggleMode();return}if(id==='undo'){undo(view);view.focus();return}if(id==='redo'){redo(view);view.focus();return}if(id==='find'){openSearchPanel(view);return}
 if(id==='theme'){dialog('appearance');requestAnimationFrame(()=>$('#themes [aria-checked=true]').focus());return}
 if(id==='commands'){renderCommands();dialog('commands');$<HTMLInputElement>('#command-search').value='';renderCommands();$('#command-search').focus();return}
 if(id==='recent'||id==='outline'){drawerMode=id;$('#drawer').hidden=false;await refreshRecent();return}
 if(id==='remove'){confirmRemove(doc.id,true);return}
 if(id==='image'){$('#image-input').click();return}if(id==='close'){await closeApp();return}
 await run(async()=>{switch(id){case 'new':if(await saveForAction())load(await call<WorkspaceState>('New'));break;case 'open':if(!await saveForAction())break;if(desktop)load(await call<WorkspaceState>('Open'));else $('#open-input').click();break;case 'save':case 'retry':if(id==='retry')savedPosition='';await save(true);if(!doc.path&&id==='save')await saveAs();break;case 'saveAs':await saveAs();break;case 'export':await exportDoc();break;case 'pdf':case 'copyRich':case 'html':await prepareDelivery(id);break;case 'reload':if(await saveForAction())load(await call<WorkspaceState>('Reload',doc.id));break;case 'overwrite':if(!await saveForAction())break;const title=doc.title;load(await call<WorkspaceState>('Overwrite',doc.id));toast('已用当前版本覆盖磁盘文件；原磁盘内容另存为「'+title+' · 磁盘版本」');break;}})
}
function jumpToHeading(slug:string){
 const h=headings(view.state).find(h=>h.slug===slug||h.text===slug);if(h){if(reading()){const target=Array.from($('#preview-content').querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(el=>el.id===h.slug);target?.scrollIntoView({block:'start'});focusContent()}else{view.dispatch({selection:{anchor:h.from},scrollIntoView:true});view.focus()}}else toast('没有找到这个标题');
}
function openLink(url:string){
 const local=localDocumentLink(url);
 if(local){void run(async()=>{if(!await saveForAction())return;load(await call<WorkspaceState>('OpenLinked',doc.id,url));if(local.fragment)jumpToHeading(local.fragment)});return}
 if(!safeLink(url)){toast('不支持打开此类链接');return}
 if(url.startsWith('#')){let slug=url.slice(1);try{slug=decodeURIComponent(slug)}catch{}jumpToHeading(slug);return}
 if(desktop)void call('OpenLink',url).catch(e=>toast(errorText(e)));else window.open(url,'_blank','noopener,noreferrer');
}
function openLinkEditor(){
 const existing=linkAt(view.state),r=view.state.selection.main;editRange=existing?{from:existing.from,to:existing.to,raw:view.state.sliceDoc(existing.from,existing.to)}:{from:r.from,to:r.to,raw:view.state.sliceDoc(r.from,r.to)};
 $<HTMLInputElement>('#link-text').value=existing?.text||view.state.sliceDoc(r.from,r.to);
 $<HTMLInputElement>('#link-url').value=existing?.url||'';$('#link-remove').hidden=!existing;$('#link-error').hidden=true;dialog('link-dialog');$('#link-text').focus();
}
function applyRange(text:string){if(!editRange)return;if(view.state.sliceDoc(editRange.from,editRange.to)!==editRange.raw){throw Error('文稿已变化，请重新打开编辑面板')}
 view.dispatch({changes:{from:editRange.from,to:editRange.to,insert:text},selection:{anchor:editRange.from+text.length},userEvent:'input.format',annotations:isolateHistory.of('full')});view.focus();
}
$('#link-form').onsubmit=e=>{e.preventDefault();try{applyRange(makeLink($<HTMLInputElement>('#link-text').value,$<HTMLInputElement>('#link-url').value));closeDialog('link-dialog');view.focus()}catch(e){$('#link-error').textContent=errorText(e);$('#link-error').hidden=false}};
$('#link-open').onclick=()=>openLink($<HTMLInputElement>('#link-url').value);
$('#link-remove').onclick=()=>{try{applyRange($<HTMLInputElement>('#link-text').value.replace(/[\\`*_{}[\]()#+.!|>~-]/g,'\\$&'));closeDialog('link-dialog');view.focus()}catch(e){toast(errorText(e))}};
function openTable(){
 const existing=tableAt(view.state),r=view.state.selection.main;editRange=existing||{from:r.from,to:r.to,raw:view.state.sliceDoc(r.from,r.to)};
 editingExistingTable=!!existing;if(existing){const t=parseTable(existing.raw);tableRows=t.rows;tableAligns=t.aligns}else{tableRows=[['项目','说明'],['','']];tableAligns=[]}
 if(tableRows.length>101||(tableRows[0]?.length||0)>12){toast('大表格请在源码中编辑');return}
 renderTable();dialog('table-dialog');$('#table-grid input')?.focus();
}
function renderTable(){
 const host=$('#table-grid');host.replaceChildren();tableRows.forEach((row,i)=>{const line=node('div','table-input-row');line.style.gridTemplateColumns=`repeat(${tableRows[0].length}, minmax(100px,1fr))`;for(let j=0;j<tableRows[0].length;j++){const input=document.createElement('input');input.value=row[j]||'';input.setAttribute('aria-label',`${i===0?'表头':`第${i}行`} 第${j+1}列`);input.oninput=()=>{tableRows[i][j]=input.value};line.append(input)}host.append(line)});
 $<HTMLButtonElement>('#table-row').disabled=tableRows.length>=101;$<HTMLButtonElement>('#table-column').disabled=tableRows[0].length>=12;
}
$('#table-row').onclick=()=>{tableRows.push(tableRows[0].map(()=>''));renderTable();$('#table-grid .table-input-row:last-child input')?.focus()};
$('#table-column').onclick=()=>{tableRows.forEach(r=>r.push(''));tableAligns.push('');renderTable()};
$('#table-form').onsubmit=e=>{e.preventDefault();try{if(!editRange)return;const before=!editingExistingTable&&editRange.from>0&&view.state.sliceDoc(editRange.from-1,editRange.from)!=='\n'?'\n\n':'';const after=editingExistingTable?'':editRange.to<view.state.doc.length&&view.state.sliceDoc(editRange.to,editRange.to+1)!=='\n'?'\n\n':'\n';applyRange(before+serializeTable(tableRows,tableAligns)+after);closeDialog('table-dialog');view.focus()}catch(e){toast(errorText(e))}};
const formatButtons=[['bold','加粗'],['italic','斜体'],['heading','标题'],['quote','引用'],['bullet','无序列表'],['ordered','有序列表'],['task','任务列表'],['link','链接'],['code','代码块'],['table','表格']];
for(const [id,label] of formatButtons){const b=node('button','tool');b.dataset.action=id;b.setAttribute('aria-label',label);b.title=label;b.append(icon(id));b.onmousedown=e=>e.preventDefault();$('#format-bar').append(b)}
$$('[data-deliver]').forEach(b=>b.onclick=()=>{closeDialog('delivery-dialog');void action(b.dataset.deliver!)});
applyIcons();
$$('[data-action]').forEach(b=>b.onclick=()=>void action(b.dataset.action!));
$('#rename-form').onsubmit=e=>{e.preventDefault();const title=$<HTMLInputElement>('#rename-input').value.trim();if(!title)return;void run(async()=>{if(!await saveForAction())return;const result=await call<WorkspaceState>('Rename',doc.id,title);result.appearance=appearance;doc.title=result.current.title;state=result;header();closeDialog('rename-dialog')})};
async function importFile(file:File){await run(async()=>{if(!await saveForAction())return;const content=await file.text();load(await call<WorkspaceState>('New'));view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content}});await save()})}
$('#open-input').onchange=async()=>{const f=$<HTMLInputElement>('#open-input').files?.[0];if(!f)return;await importFile(f);$<HTMLInputElement>('#open-input').value=''};
if(!desktop){
 window.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault()});
 window.addEventListener('drop',e=>{if(e.dataTransfer?.files.length)e.preventDefault()});
}
document.addEventListener('keydown',e=>{
 if(e.isComposing)return;if(e.key==='Escape'&&!document.querySelector('dialog[open]')){if(focusMode)void action('focus');$('#drawer').hidden=true;if(view)focusContent()}
 if(!(e.metaKey||e.ctrlKey))return;const k=e.key.toLowerCase();let id='';if(document.querySelector('dialog[open]'))return;if(k==='p')id='pdf';if(k==='l')id='link';if(k==='f'&&e.shiftKey)id='focus';if(k==='b')id='bold';if(k==='n')id='new';if(k==='o')id='open';if(k==='s')id=e.shiftKey?'saveAs':'save';if(k==='k')id='commands';if(!desktop&&k==='\\')id='layout';if(!desktop&&k==='m'&&e.shiftKey)id='source';if(!desktop&&k==='r'&&e.shiftKey)id='read';if(id){e.preventDefault();void action(id)}
});
$('.editor-pane').addEventListener('scroll',()=>{if(loading||!doc)return;clearTimeout(timer);timer=setTimeout(()=>void save(),500)},{passive:true});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
if(window.mygo){window.mygo.on<string>('liubai:action',id=>void action(id));window.mygo.on<WorkspaceState>('liubai:opened',next=>{openedQueue.push(next.current.id);void processOpened()});window.mygo.on<{path:string;error:string}>('liubai:open-failed',f=>toast('无法打开「'+(f.path.split('/').pop()||f.path)+'」：'+f.error))}
preview=createPreviewController({
 host:$('#preview-content'),
 scroll:$('.preview-scroll'),
 getContent:()=>view?.state.doc.toString()||'',
 resolveImage:resolveImageFor,
 openLink,
});
try{const next=await call<WorkspaceState>('State');load(next);if(next.notices?.length)banner(next.notices.join('；'),'notice',next.quarantineDir)}catch(e){banner('无法打开文稿：'+errorText(e),'notice')}
async function pollStatus(){
 if(!doc||busy||dirty||saveFlight||compositionActive||document.visibilityState!=='visible')return;
 const id=doc.id;let s:DocStatus;try{s=await call<DocStatus>('Status',id)}catch{return}
 if(!doc||doc.id!==id||dirty||busy||saveFlight)return;
 if(s.revision!==doc.revision){await run(async()=>{load(await call<WorkspaceState>('Activate',id));toast('已载入磁盘上的新版本')});return}
 if(s.conflict!==doc.conflict||s.status!==doc.status){doc.conflict=s.conflict;doc.status=s.status;header();if(s.conflict||s.status.includes('失败'))banner(s.status,s.conflict?'conflict':'error');else banner()}
}
setInterval(()=>void pollStatus(),2000);
document.addEventListener('visibilitychange',()=>void pollStatus());
window.addEventListener('focus',()=>void pollStatus());
