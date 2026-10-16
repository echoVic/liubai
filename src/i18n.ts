import {messagesIn,type Messages} from '../locales';
import type {DocStatus,LocaleNotice} from './types';

const localeKey='mygo:locale';
const listeners=new Set<()=>void>();
function browserChoice(){try{return localStorage.getItem(localeKey)||''}catch{return ''}}
function supported(tags:readonly string[]){for(const tag of tags){try{const language=new Intl.Locale(tag).language;if(language==='en')return 'en';if(language==='zh')return 'zh-Hans'}catch{}}return 'zh-Hans'}
export function pageLocale(){
 const native=typeof window!=='undefined'?window.mygo?.locale:undefined;
 if(native)return native;
 const choice=browserChoice();if(choice)return supported([choice]);
 return supported(typeof navigator==='undefined'?[]:navigator.languages||[navigator.language]);
}
export let messages:Messages=messagesIn(pageLocale());
function refresh(){messages=messagesIn(pageLocale());localizePage();for(const listener of listeners)listener()}
export function onPageLocaleChange(listener:()=>void){listeners.add(listener);return ()=>listeners.delete(listener)}
export async function setPageLocale(locale:string){
 if(window.mygo){await window.mygo.call('Desktop.SetLocale',locale);return}
 try{if(locale)localStorage.setItem(localeKey,locale);else localStorage.removeItem(localeKey)}catch{}
 refresh();
}
export function localizePage(root:ParentNode=document){
 document.documentElement.lang=pageLocale();document.documentElement.dir='ltr';
 const lookup=messages as unknown as Record<string,()=>string>;
 for(const el of root.querySelectorAll<HTMLElement>('[data-i18n]')){const say=lookup[el.dataset.i18n!];if(say)el.textContent=say()}
 for(const attr of ['title','aria-label','placeholder'])for(const el of root.querySelectorAll<HTMLElement>('[data-i18n-'+attr+']')){const say=lookup[el.getAttribute('data-i18n-'+attr)!];if(say)el.setAttribute(attr,say())}
}
const statusMessages={
 draftSaved:'bStatusDraftSaved',fileSaved:'bStatusFileSaved',fileUnavailable:'bStatusFileUnavailable',diskUnreadable:'bStatusDiskUnreadable',diskReloaded:'bStatusDiskReloaded',reloadRecoveryFailed:'bStatusReloadRecoveryFailed',diskConflict:'bStatusDiskConflict',imageSaveFailed:'bStatusImageSaveFailed',fileSaveFailed:'bStatusFileSaveFailed',saveFailed:'bStatusSaveFailed',recoveryUpdateFailed:'bStatusRecoveryUpdateFailed',
} as const;
type Status=Pick<DocStatus,'status'|'statusCode'|'conflict'>;
function statusCode(doc:Status){
 if(doc.statusCode&&doc.statusCode in statusMessages)return doc.statusCode as keyof typeof statusMessages;
 // Old web fixtures and drafts can carry only the original status text.
 const source=messagesIn('zh-Hans');
 for(const code of Object.keys(statusMessages) as (keyof typeof statusMessages)[])if(source[statusMessages[code]]()===doc.status)return code;
 return doc.conflict?'diskConflict':'draftSaved';
}
export function catalogText(key:string,args:Record<string,unknown>={},fallback=''){
 switch(key){
  case 'bCorruptDrafts':return messages.bCorruptDrafts(Number(args.count||0));
  case 'bShortcutUnavailable':return messages.bShortcutUnavailable(String(args.shortcut||''));
  case 'bImageUnreadable':return messages.bImageUnreadable(String(args.path||''));
  case 'bOpenFailed':return messages.bOpenFailed(String(args.name||''),String(args.error||''));
  default:{const say=(messages as unknown as Record<string,()=>string>)[key];return say?say():fallback}
 }
}
export class CatalogError extends Error {
 constructor(readonly key:string,readonly args:Record<string,unknown>,fallback:string){super(fallback)}
 translated(){return catalogText(this.key,this.args,this.message)}
}
export function localizedError(error:unknown){
 if(error instanceof CatalogError)return error.translated();
 const text=error instanceof Error?error.message:String(error);
 // Native bridge errors contain prose; no-argument catalog errors can still be identified.
 for(const tag of ['zh-Hans','en']){
  const source=messagesIn(tag) as unknown as Record<string,()=>string>;
  for(const key of Object.keys(source))if(key.startsWith('b')&&!['bCorruptDrafts','bShortcutUnavailable','bImageUnreadable','bOpenFailed'].includes(key)&&source[key]()===text)return catalogText(key);
 }
 return text;
}
export function noticeText(notice:LocaleNotice){return catalogText(notice.key||'',notice.args,notice.text||'')}
export function statusText(doc:Status){return messages[statusMessages[statusCode(doc)]]()}
export function statusFailed(doc:Status){return ['reloadRecoveryFailed','imageSaveFailed','fileSaveFailed','saveFailed','recoveryUpdateFailed'].includes(statusCode(doc))}
if(typeof window!=='undefined'){
 window.mygo?.on('mygo:locale',refresh);
 window.addEventListener('mygo:locale',refresh);
 window.addEventListener('languagechange',()=>{if(!browserChoice())refresh()});
 window.addEventListener('storage',event=>{if(event.key===localeKey)refresh()});
}
