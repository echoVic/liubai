import {messages,pageLocale,onPageLocaleChange} from './i18n';
import {call,desktop,type CaptureSettings} from './types';
import {recordCaptureShortcut,displayCaptureShortcut} from './capture-input';
type CaptureStatus={settings:CaptureSettings;error:string};
export function captureSettingsDialog(show:()=>void){
 const enabled=document.querySelector<HTMLInputElement>('#capture-enabled')!;
 const shortcut=document.querySelector<HTMLInputElement>('#capture-shortcut')!;
 const login=document.querySelector<HTMLInputElement>('#capture-login')!;
 const error=document.querySelector<HTMLElement>('#capture-settings-error')!;
 const web=document.querySelector<HTMLElement>('#capture-web-note')!;
 let settings:CaptureSettings,recording=false,queue:Promise<void>=Promise.resolve();
 function render(){enabled.checked=settings.enabled;enabled.setAttribute('aria-checked',String(settings.enabled));login.checked=settings.openAtLogin;login.setAttribute('aria-checked',String(settings.openAtLogin));shortcut.value=displayCaptureShortcut(settings.shortcut);for(const el of [enabled,shortcut,login])el.disabled=!desktop;web.hidden=desktop}
 function update(change:Partial<CaptureSettings>){
  if(!desktop)return;settings={...settings,...change};const next={...settings};render();
  queue=queue.catch(()=>{}).then(async()=>{try{await call('SetCaptureSettings',next);error.textContent=''}catch(e){error.textContent=e instanceof Error?e.message:String(e)}});
 }
 enabled.onchange=()=>update({enabled:enabled.checked});
 login.onchange=()=>update({openAtLogin:login.checked});
 shortcut.onfocus=()=>{recording=true;shortcut.value='';shortcut.placeholder=messages.fPressAShortcut()};
 shortcut.onblur=()=>{recording=false;if(settings)render()};
 shortcut.onkeydown=e=>{
  if(!recording)return;
  if(e.isComposing){e.preventDefault();return}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();shortcut.blur();return}
  if(e.key==='Tab')return;
  e.preventDefault();e.stopPropagation();const key=recordCaptureShortcut(e);
  if(key){update({shortcut:key});shortcut.blur()}
 };
 onPageLocaleChange(()=>{
  shortcut.placeholder=messages.fPressAShortcut();
  if(!document.querySelector<HTMLDialogElement>('#capture-settings')?.open)return;
  const locale=pageLocale();
  void queue.catch(()=>{}).then(()=>call<CaptureStatus>('GetCaptureSettings')).then(status=>{if(pageLocale()===locale)error.textContent=status.error}).catch(()=>{});
 });
 return async()=>{
  await queue;const status=await call<CaptureStatus>('GetCaptureSettings');settings=status.settings;error.textContent=status.error;render();show();
 };
}
