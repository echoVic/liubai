import {messages,localizePage,onPageLocaleChange} from './i18n';
import {call,type Appearance,type WorkspaceState} from './types';
import {captureKeyAction} from './capture-input';
import {mac,windows,keyLabel} from './platform';
import {resolveTheme,paintTheme,watchTheme} from './theme';
const field=document.querySelector<HTMLTextAreaElement>('#capture-text')!;
const button=document.querySelector<HTMLButtonElement>('#capture-save')!;
const status=document.querySelector<HTMLElement>('#capture-status')!;
const hint=()=>messages.fSaveAsDraftEscClose(keyLabel('Mod+Enter'));
let composing=false,saving=false,hideTimer:ReturnType<typeof setTimeout>|undefined;
let appearance:Appearance|undefined;
function theme(p?:Appearance){if(p)appearance=p;if(appearance)paintTheme(document.documentElement,resolveTheme(appearance,new Date(),matchMedia('(prefers-color-scheme:dark)').matches))}
function message(text:string,error=false){status.textContent=text;status.dataset.error=String(error)}
function focus(){clearTimeout(hideTimer);message(hint());field.focus()}
async function hide(){clearTimeout(hideTimer);try{await call('HideCapture')}catch(e){message(e instanceof Error?e.message:String(e),true)}}
async function save(){
 if(saving||composing||!field.value.trim())return;
 clearTimeout(hideTimer);saving=true;field.readOnly=true;button.disabled=true;
 try{
  await call('Capture',field.value);field.value='';message(messages.fSavedAsDraft());
  hideTimer=setTimeout(()=>{if(!field.value&&!composing)void hide()},600);
 }catch(e){message(e instanceof Error?e.message:String(e),true)}
 finally{saving=false;field.readOnly=false;button.disabled=false;field.focus()}
}
field.addEventListener('compositionstart',()=>{composing=true;clearTimeout(hideTimer)});
field.addEventListener('compositionend',()=>{composing=false});
field.addEventListener('input',()=>{clearTimeout(hideTimer);message(hint())});
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
localizePage();onPageLocaleChange(()=>message(hint()));
try{theme((await call<WorkspaceState>('State')).appearance)}catch(e){message(e instanceof Error?e.message:String(e),true)}
field.focus();
