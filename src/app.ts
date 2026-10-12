import {call,desktop,type Doc,type WorkspaceState,type Appearance,type ImageResult,type ExportResult} from './types';
import {createEditor,mode,richExtensions,undo,redo,openSearchPanel,EditorState,type EditorView} from './editor';
import {Transaction} from '@codemirror/state';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>Array.from(document.querySelectorAll<HTMLElement>(s));
const node=(tag:string,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n};
let state:WorkspaceState,doc:Doc,view:EditorView,appearance:Appearance,source=false,loading=false,busy=false,dirty=false;
let timer:ReturnType<typeof setTimeout>,toastTimer:ReturnType<typeof setTimeout>,saveFlight:Promise<boolean>|null=null;
let generation=0,drawerMode='recent',savedPosition='',closeRequested=false;
let appearanceQueue:Promise<void>=Promise.resolve();
const sessions=new Map<string,EditorState>();
const imageCache=new Map<string,Promise<string>>();
const mq=matchMedia('(prefers-color-scheme:dark)');
const names:{id:Appearance['theme'];name:string;kind:string}[]=[{id:'paper',name:'纸白',kind:'清晰的中性纸面'},{id:'warm',name:'暖纸',kind:'柔和的米纸暖调'},{id:'mist',name:'雾绿',kind:'沉静的灰绿环境'},{id:'ink',name:'夜墨',kind:'克制的深炭夜色'}];
if(desktop)document.body.classList.add('desktop');else $('#workspace-label').textContent='本地开发版 · 独立草稿存档';
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
function toast(s:string){$('#toast').textContent=s;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200)}
function banner(s='',conflict=false){$('#banner').hidden=!s;$('#banner-text').textContent=s;$('#reload-disk').hidden=!conflict}
function position(){const r=view.state.selection.main;return {anchor:r.anchor,head:r.head,scroll:$('.desk').scrollTop,source}}
function header(){if(!doc)return;$('#doc-title').textContent=doc.title;$('#save-status').textContent=dirty?'正在保存':doc.status;$('#document-kind').textContent=doc.path?'本地文稿 · '+doc.title:'此刻 · 一篇草稿';$('#word-count').textContent=[...view.state.doc.toString().replace(/\s/g,'')].length.toLocaleString()+' 字';$('#mode-button').setAttribute('aria-pressed',String(source));$('#mode-button').title=source?'返回即时排版':'查看 Markdown 源码';$('.paper').classList.toggle('source-mode',source)}
function changed(){if(loading||!doc)return;dirty=true;generation++;header();clearTimeout(timer);timer=setTimeout(()=>void save(),350)}
async function save():Promise<boolean>{
 clearTimeout(timer);if(saveFlight){const pending=await saveFlight;if(!pending&&dirty)return false;if(dirty)return save();return true}if(!doc||!view)return true;
 const content=view.state.doc.toString(),pos=position();if(!dirty&&JSON.stringify(pos)===savedPosition)return true;
 const id=doc.id,stamp=generation;$('#save-status').textContent='正在保存';
 saveFlight=(async()=>{try{const result=await call<Doc>('Update',{id,revision:doc.revision,content,position:pos});
  if(doc.id!==id)return true;doc.revision=result.revision;doc.status=result.status;doc.conflict=result.conflict;doc.title=result.title;doc.content=content;doc.position=pos;doc.updated=result.updated;
  if(stamp===generation)dirty=false;savedPosition=JSON.stringify(pos);header();
  if(result.conflict||result.status.includes('失败'))banner(result.status,result.conflict);else banner();return true;
 }catch(e){banner('保存失败：'+errorText(e));$('#save-status').textContent='保存失败 · 当前输入仍在';dirty=true;return false}finally{saveFlight=null}})();const ok=await saveFlight;if(ok&&dirty)return save();return ok;
}
async function saveForAction(){const ok=await save();if(!ok&&dirty){toast('请先重试保存，当前输入仍保留');return false}return true}
async function resolveImage(dest:string):Promise<string>{
 if(/^https?:\/\//.test(dest))return dest;
 const key=doc.id+':'+dest;if(!imageCache.has(key)){const id=doc.id;imageCache.set(key,call<ImageResult>('ReadImage',id,dest).then(x=>x.url).catch(e=>{imageCache.delete(key);throw e}))}return imageCache.get(key)!;
}
function load(next:WorkspaceState){
 loading=true;if(view){sessions.set(doc.id,view.state);view.destroy()}
 state=next;doc=next.current;source=!!doc.position.source;appearance=next.appearance;dirty=false;generation=0;savedPosition=JSON.stringify(doc.position);
 view=createEditor($('#editor'),doc,resolveImage,changed,insertImages);
 const cached=sessions.get(doc.id);if(cached&&cached.doc.toString()===doc.content)view.setState(cached);
 view.dispatch({effects:mode.reconfigure(source?[]:richExtensions(resolveImage))});
 loading=false;applyTheme();header();if(doc.conflict||doc.status.includes('失败'))banner(doc.status,doc.conflict);else banner();
 requestAnimationFrame(()=>{$('.desk').scrollTop=doc.position.scroll||0;view.focus()});
 if(!$('#drawer').hidden)renderDrawer();
}
async function refreshRecent(){state=await call<WorkspaceState>('State');renderDrawer()}
function themeID(){return appearance.followSystem?(mq.matches?'ink':'paper'):appearance.theme}
function applyTheme(){if(!appearance)return;const id=themeID();document.documentElement.dataset.liubaiTheme=id;document.documentElement.style.colorScheme=id==='ink'?'dark':'light';$('#follow-system').setAttribute('aria-checked',String(appearance.followSystem));$<HTMLInputElement>('#follow-system').checked=appearance.followSystem;renderThemes()}
async function setAppearance(p:Appearance){appearance=p;state.appearance=p;applyTheme();try{const pending=appearanceQueue.catch(()=>{}).then(async()=>{await call('Appearance',p);try{localStorage.setItem('liubai-appearance',JSON.stringify(p))}catch{}});appearanceQueue=pending;await pending}catch(e){toast('本次已应用，偏好未能保存：'+errorText(e))}}
function renderThemes(){const list=$('#themes');list.replaceChildren();names.forEach((t,i)=>{
 const b=node('button','theme-card');b.setAttribute('role','radio');b.setAttribute('aria-label',t.name);b.setAttribute('aria-checked',String(themeID()===t.id));b.tabIndex=themeID()===t.id?0:-1;
 const preview=node('div','theme-swatch preview-'+t.id);preview.setAttribute('aria-hidden','true');preview.append(node('strong','','一页写作桌'),node('span','','让一句话有时间抵达。'),node('a','','继续阅读'),node('code','','const note = true'));
 b.append(preview,node('b','',t.name),node('small','',t.kind));if(themeID()===t.id)b.append(node('span','theme-check','✓'));
 b.onclick=()=>{void setAppearance({theme:t.id,followSystem:false}).then(()=>$$('.theme-card')[i]?.focus())};
 b.onkeydown=(e)=>{let n=i;if(e.key==='ArrowRight')n=(i+1)%4;if(e.key==='ArrowLeft')n=(i+3)%4;if(e.key==='ArrowDown'||e.key==='ArrowUp')n=(i+2)%4;if(n!==i){e.preventDefault();$$('.theme-card')[n].focus()}};list.append(b)
 })}
mq.addEventListener('change',applyTheme);
$('#follow-system').onchange=()=>{void setAppearance({theme:themeID(),followSystem:$<HTMLInputElement>('#follow-system').checked})};
const triggers=new Map<string,HTMLElement>();
function dialog(id:string){triggers.set(id,document.activeElement as HTMLElement);($<HTMLDialogElement>('#'+id)).showModal()}
function closeDialog(id:string){$<HTMLDialogElement>('#'+id).close();triggers.get(id)?.focus()}
$$('[data-close]').forEach(b=>b.onclick=()=>{const id=b.dataset.close!;if(id==='drawer'){$('#drawer').hidden=true;view.focus()}else closeDialog(id)});
$$('dialog').forEach(el=>{const d=el as HTMLDialogElement;d.addEventListener('close',()=>triggers.get(d.id)?.focus());d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))closeDialog(d.id)})});
function renderDrawer(){
 const list=$('#drawer-list');list.replaceChildren();$('#drawer-title').textContent=drawerMode==='recent'?'最近文稿':'文稿大纲';$('#recent-search').hidden=drawerMode!=='recent';
 if(drawerMode==='outline'){
  for(let n=1;n<=view.state.doc.lines;n++){const line=view.state.doc.line(n);const m=/^(#{1,6})\s+(.+)$/.exec(line.text);if(!m)continue;const b=node('button','outline-item',m[2]);b.style.paddingLeft=(10+m[1].length*10)+'px';b.onclick=()=>{view.dispatch({selection:{anchor:line.from},scrollIntoView:true});view.focus()};list.append(b)}
  if(!list.childElementCount)list.append(node('p','dialog-note','输入 # 标题后，大纲会出现在这里。'));return;
 }
 const q=$<HTMLInputElement>('#recent-search').value.trim().toLowerCase();for(const d of state.recent){if(!(d.title+' '+d.excerpt).toLowerCase().includes(q))continue;const b=node('button','recent-item'+(d.id===doc.id?' active':''));b.append(node('b','',d.title),node('p','',d.excerpt||'一篇等待开始的文稿'),node('small','',new Date(d.updated).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})));b.onclick=()=>void run(async()=>{if(await saveForAction()){load(await call<WorkspaceState>('Activate',d.id));$('#drawer').hidden=true}});list.append(b)}
 if(!list.childElementCount)list.append(node('p','dialog-note','没有找到这篇文稿。'))
}
$('#recent-search').oninput=renderDrawer;
function toggleMode(){source=!source;view.dispatch({effects:mode.reconfigure(source?[]:richExtensions(resolveImage)),annotations:Transaction.addToHistory.of(false)});header();changed();view.focus()}
async function insertImages(files:File[],at?:number){
 if(busy||!doc)return;const id=doc.id;let offset=at??view.state.selection.main.from;busy=true;
 try{for(const file of files){if(file.size>20*1024*1024)throw Error('图片超过 20 MB');const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('图片无法读取'));r.readAsDataURL(file)});const image=await call<ImageResult>('ImportImage',id,file.name,data);if(doc.id!==id)throw Error('文稿已切换，请重新插入');imageCache.set(id+':'+image.destination,Promise.resolve(image.url));const alt=file.name.replace(/[\[\]\\\r\n]/g,'').replace(/\.[^.]+$/,'')||'图片';const text=`\n\n![${alt}](${image.destination})\n\n`;view.dispatch({changes:{from:offset,insert:text},selection:{anchor:offset+text.length},userEvent:'input.paste'});offset+=text.length}await save();view.dispatch({effects:mode.reconfigure(source?[]:richExtensions(resolveImage))});view.focus()}catch(e){toast(errorText(e))}finally{busy=false}
}
$('#image-input').onchange=()=>{const input=$<HTMLInputElement>('#image-input');void insertImages(Array.from(input.files||[]));input.value=''};
async function run(fn:()=>Promise<void>){if(busy)return;busy=true;try{await fn()}catch(e){toast(errorText(e))}finally{busy=false}}
async function saveAs(){if(!await saveForAction())return;if(!desktop){download(doc.title+'.md',view.state.doc.toString(),'text/markdown');toast('浏览器已下载 Markdown；含图片请使用“带走文稿”');return}const r=await call<ExportResult>('SaveAs',doc.id);if(r.cancelled)return;const old=view.state.doc.toString();doc=r.document;loading=true;if(old!==doc.content)view.dispatch({changes:r.changes||[],annotations:Transaction.addToHistory.of(false)});loading=false;imageCache.clear();view.dispatch({effects:mode.reconfigure(source?[]:richExtensions(resolveImage))});state=await call<WorkspaceState>('State');dirty=false;header();banner();toast('文稿和图片已保存')}
function download(name:string,data:BlobPart,type:string){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
async function exportDoc(allowMissing=false){if(!await saveForAction())return;if(!desktop){const r=await call<{data:string;external:number}>('ExportBrowser',doc.id);download('留白文稿.zip',Uint8Array.from(atob(r.data),c=>c.charCodeAt(0)),'application/zip');toast('文稿包已下载'+(r.external?' · 外链图片仍需联网':''));return}const r=await call<ExportResult>('Export',doc.id,allowMissing);if(r.cancelled)return;if(r.missing?.length&&!allowMissing){$('#missing-list').textContent=r.missing.join('\n');dialog('missing-dialog');return}toast('文稿与图片已打包'+(r.external?' · 外链图片仍需联网':''))}
$('#export-anyway').onclick=()=>{closeDialog('missing-dialog');void run(()=>exportDoc(true))};
async function closeApp(){if(closeRequested||busy)return;closeRequested=true;try{const ok=await save();if(!ok||dirty){dialog('close-dialog');return}if(desktop)await call('Close');else toast('文稿已保存在本地，可以关闭此页面')}finally{closeRequested=false}}
$('#discard-close').onclick=()=>{if(desktop)void call('Close');else closeDialog('close-dialog')};
const commands=[
 ['new','新建文稿','⌘ N'],['rename','为草稿命名',''],['open','打开本地文稿','⌘ O'],['save','保存','⌘ S'],['saveAs','另存为…','⌘ ⇧ S'],['export','带走文稿与图片','ZIP'],['recent','最近文稿',''],['outline','文稿大纲',''],['find','查找正文','⌘ F'],['source','源码 / 即时排版','⌘ ⇧ M'],['image','插入图片',''],['theme','外观与主题',''],...names.map(t=>['theme:'+t.id,'切换主题 · '+t.name,'']),['bold','加粗选中文字','⌘ B'],['italic','斜体选中文字',''],['heading','插入二级标题',''],['quote','插入引用',''],['task','插入任务列表',''],['code','插入代码块',''],['table','插入表格',''],['undo','撤销','⌘ Z'],['redo','重做','⌘ ⇧ Z']
];
function renderCommands(){const q=$<HTMLInputElement>('#command-search').value.trim();const list=$('#command-list');list.replaceChildren();commands.filter(c=>c[1].includes(q)).forEach(([id,title,key])=>{const b=node('button','command');b.append(node('span','',title),node('kbd','',key));b.onclick=()=>{closeDialog('commands');void action(id)};list.append(b)})}
$('#command-search').oninput=renderCommands;$('#command-search').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();$('#command-list button')?.focus()}if(e.key==='Enter'){e.preventDefault();$('#command-list button')?.click()}};
async function action(id:string){
 if(!view||!doc)return;
 if(busy&&['new','open','source','reload','close'].includes(id))return;
 const markup:Record<string,[string,string]>={bold:['**','**'],italic:['_','_'],heading:['## ',''],quote:['> ',''],task:['- [ ] ',''],code:['```\n','\n```'],table:['| 项目 | 说明 |\n| --- | --- |\n| ',' | 内容 |\n']};
 if(markup[id]){const r=view.state.selection.main;const [a,b]=markup[id];const text=view.state.sliceDoc(r.from,r.to)||'文字';view.dispatch({changes:{from:r.from,to:r.to,insert:a+text+b},selection:{anchor:r.from+a.length,head:r.from+a.length+text.length},userEvent:'input'});view.focus();return}
 if(id.startsWith('theme:')){await setAppearance({theme:id.split(':')[1] as Appearance['theme'],followSystem:false});return}
 if(id==='rename'){if(doc.path){toast('已有文件可通过“另存为”设置新名称');return}$<HTMLInputElement>('#rename-input').value=doc.title==='未命名文稿'?'':doc.title;dialog('rename-dialog');$<HTMLInputElement>('#rename-input').select();return}
 if(id==='source'){toggleMode();return}if(id==='undo'){undo(view);view.focus();return}if(id==='redo'){redo(view);view.focus();return}if(id==='find'){openSearchPanel(view);return}
 if(id==='theme'){dialog('appearance');requestAnimationFrame(()=>$('#themes [aria-checked=true]').focus());return}
 if(id==='commands'){renderCommands();dialog('commands');$<HTMLInputElement>('#command-search').value='';renderCommands();$('#command-search').focus();return}
 if(id==='recent'||id==='outline'){drawerMode=id;$('#drawer').hidden=false;await refreshRecent();return}
 if(id==='image'){$('#image-input').click();return}if(id==='close'){await closeApp();return}
 await run(async()=>{switch(id){case 'new':if(await saveForAction())load(await call<WorkspaceState>('New'));break;case 'open':if(!await saveForAction())break;if(desktop)load(await call<WorkspaceState>('Open'));else $('#open-input').click();break;case 'save':case 'retry':if(id==='retry')savedPosition='';await save();if(!doc.path&&id==='save')await saveAs();break;case 'saveAs':await saveAs();break;case 'export':await exportDoc();break;case 'reload':if(await saveForAction())load(await call<WorkspaceState>('Reload',doc.id));break;}})
}
$$('[data-action]').forEach(b=>b.onclick=()=>void action(b.dataset.action!));
$('#rename-form').onsubmit=e=>{e.preventDefault();const title=$<HTMLInputElement>('#rename-input').value.trim();if(!title)return;void run(async()=>{if(!await saveForAction())return;const result=await call<WorkspaceState>('Rename',doc.id,title);doc.title=result.current.title;state=result;header();closeDialog('rename-dialog')})};
$('#open-input').onchange=async()=>{const f=$<HTMLInputElement>('#open-input').files?.[0];if(!f)return;await run(async()=>{const content=await f.text();load(await call<WorkspaceState>('New'));view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content}});await save()});$<HTMLInputElement>('#open-input').value=''};
document.addEventListener('keydown',e=>{
 if(e.isComposing)return;if(e.key==='Escape'&&!document.querySelector('dialog[open]')){$('#drawer').hidden=true;view?.focus()}
 if(!(e.metaKey||e.ctrlKey))return;const k=e.key.toLowerCase();let id='';if(k==='b')id='bold';if(k==='n')id='new';if(k==='o')id='open';if(k==='s')id=e.shiftKey?'saveAs':'save';if(k==='k')id='commands';if(k==='m'&&e.shiftKey)id='source';if(id){e.preventDefault();void action(id)}
});
$('.desk').addEventListener('scroll',()=>{if(loading||!doc)return;clearTimeout(timer);timer=setTimeout(()=>void save(),500)},{passive:true});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
if(window.mygo){window.mygo.on<string>('liubai:action',id=>void action(id));window.mygo.on<WorkspaceState>('liubai:opened',next=>{void run(async()=>{if(await saveForAction())load(await call<WorkspaceState>('Activate',next.current.id))})})}
try{load(await call<WorkspaceState>('State'))}catch(e){banner('无法打开文稿：'+errorText(e))}
setInterval(()=>{if(doc&&!busy&&!dirty&&!saveFlight)void call<WorkspaceState>('State').then(next=>{if(next.current.id===doc.id&&next.current.conflict){doc.conflict=true;doc.status=next.current.status;header();banner(doc.status,true)}}).catch(()=>{})},2000);
