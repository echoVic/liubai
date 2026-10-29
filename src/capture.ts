import {messages,localizePage,onPageLocaleChange} from './i18n';
import {call,type Appearance,type Summary} from './types';
import {captureKeyAction} from './capture-input';
import {applyCaptureTemplate,parseCaptureTags} from './capture-notes';
import {mac,windows,keyLabel} from './platform';
import {resolveTheme,paintTheme,watchTheme} from './theme';
const field=document.querySelector<HTMLTextAreaElement>('#capture-text')!;
const button=document.querySelector<HTMLButtonElement>('#capture-save')!;
const status=document.querySelector<HTMLElement>('#capture-status')!;
const target=document.querySelector<HTMLSelectElement>('#capture-target')!;
const template=document.querySelector<HTMLSelectElement>('#capture-template')!;
const tags=document.querySelector<HTMLInputElement>('#capture-tags')!;
const hint=()=>messages.fCaptureSaveHint(keyLabel('Mod+Enter'));
let composing=false,saving=false,hideTimer:ReturnType<typeof setTimeout>|undefined;
let templateText='',refresh=0;
let appearance:Appearance|undefined;
function theme(p?:Appearance){if(p)appearance=p;if(appearance)paintTheme(document.documentElement,resolveTheme(appearance,new Date(),matchMedia('(prefers-color-scheme:dark)').matches))}
function message(text:string,error=false){status.textContent=text;status.dataset.error=String(error)}
async function refreshTargets(){
 const turn=++refresh;
 try{
  const state=await call<{recent:Summary[];appearance:Appearance}>('GetCaptureContext');if(turn!==refresh)return;theme(state.appearance);
  const selected=target.value,old=target.selectedOptions[0]?.textContent||'';
  target.replaceChildren(new Option(messages.fCaptureNewDraft(),''));
  for(const doc of state.recent)target.append(new Option(doc.title,doc.id));
  if(selected&&!state.recent.some(doc=>doc.id===selected))target.append(new Option(old,selected));
  target.value=selected;
 }catch(e){message(e instanceof Error?e.message:String(e),true)}
}
function focus(){clearTimeout(hideTimer);message(hint());field.focus();void refreshTargets()}
async function hide(){clearTimeout(hideTimer);try{await call('HideCapture')}catch(e){message(e instanceof Error?e.message:String(e),true)}}
async function save(){
 if(saving||composing||!field.value.trim())return;
 clearTimeout(hideTimer);saving=true;field.readOnly=true;button.disabled=true;target.disabled=true;template.disabled=true;tags.readOnly=true;
 try{
  const labels=parseCaptureTags(tags.value);
  let result:Summary;
  if(!target.value&&!labels.length)result=await call<Summary>('Capture',field.value);
  else result=await call<Summary>('SaveCapture',{text:field.value,tags:labels,targetID:target.value,revision:-1});
  field.value='';tags.value='';template.value='';templateText='';message(result.warning||(target.value?messages.fCaptureAppended():messages.fSavedAsDraft()),!!result.warning);
  if(!result.warning)hideTimer=setTimeout(()=>{if(!field.value&&!tags.value&&!composing)void hide()},600);
 }catch(e){message(e instanceof Error?e.message:String(e),true)}
 finally{saving=false;field.readOnly=false;button.disabled=false;target.disabled=false;template.disabled=false;tags.readOnly=false;field.focus()}
}
document.addEventListener('compositionstart',()=>{composing=true;clearTimeout(hideTimer)});
document.addEventListener('compositionend',()=>{composing=false});
document.addEventListener('input',()=>{clearTimeout(hideTimer);message(hint())});
target.onchange=()=>{clearTimeout(hideTimer);button.textContent=target.value?messages.fCaptureAppend():messages.fSaveAsDraft();message(hint())};
template.onchange=()=>{
 clearTimeout(hideTimer);
 const next=template.value==='task'?'- [ ] ':template.value==='meeting'?messages.fCaptureMeetingBody():template.value==='idea'?messages.fCaptureIdeaBody():'';
 field.value=applyCaptureTemplate(field.value,templateText,next);templateText=next;message(hint());field.focus();field.setSelectionRange(field.value.length,field.value.length);
};
document.addEventListener('keydown',e=>{
 // An uncancelled Escape also closes an NSPanel; consume it while the IME owns it.
 if(composing||e.isComposing){if(e.key==='Escape'||e.key==='Enter'&&(mac?e.metaKey:e.ctrlKey))e.preventDefault();return}
 const action=captureKeyAction(e);if(!action)return;e.preventDefault();
 if(action==='save')void save();else void hide();
});
button.onclick=()=>void save();
window.addEventListener('liubai:capture-show',focus);
window.addEventListener('focus',()=>field.focus());
watchTheme(()=>theme());
window.addEventListener('storage',e=>{if(e.key==='liubai-appearance'&&e.newValue){try{theme(JSON.parse(e.newValue))}catch{}}});
window.mygo?.on<Appearance>('liubai:capture-appearance',theme);
document.documentElement.classList.toggle('windows',windows);
localizePage();onPageLocaleChange(()=>{button.textContent=target.value?messages.fCaptureAppend():messages.fSaveAsDraft();message(hint());void refreshTargets()});
await refreshTargets();
field.focus();
