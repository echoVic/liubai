import {pageLocale,messages,CatalogError} from './i18n';
export interface Appearance {theme:'paper'|'warm'|'mist'|'ink';followSystem:boolean;fontSize?:number;lineWidth?:'normal'|'wide'|'full';layout?:'single'|'split'|'read';source?:boolean}
export interface CaptureSettings {enabled:boolean;shortcut:string;openAtLogin:boolean}
export interface Position {anchor:number;head:number;scroll:number;source:boolean}
export type StatusCode='draftSaved'|'fileSaved'|'fileUnavailable'|'diskUnreadable'|'diskReloaded'|'reloadRecoveryFailed'|'diskConflict'|'imageSaveFailed'|'fileSaveFailed'|'fileReadOnly'|'saveFailed'|'recoveryUpdateFailed';
export interface Doc {id:string;title:string;customTitle?:boolean;content:string;path:string;updated:number;revision:number;position:Position;conflict:boolean;status:string;statusCode?:StatusCode}
export interface DocStatus {id:string;revision:number;conflict:boolean;status:string;statusCode?:StatusCode}
export interface Summary {id:string;title:string;path:string;updated:number;excerpt:string}
export interface LocaleNotice {key?:string;args?:Record<string,unknown>;text?:string}
export interface WorkspaceState {capture:CaptureSettings;current:Doc;recent:Summary[];appearance:Appearance;notices?:string[];noticeMessages?:LocaleNotice[];quarantineDir?:string}
export interface ImageResult {destination:string;url:string;name:string;markdown:string}
export interface ExportResult {path:string;missing:string[];external:number;document:Doc;cancelled:boolean;changes?:{from:number;to:number;insert:string}[]}
declare global {interface Window {mygo?:{locale?:string;call<T>(method:string,...args:unknown[]):Promise<T>;on<T>(name:string,fn:(data:T)=>void):void}}}
export const desktop=!!window.mygo;
export async function call<T>(method:string,...args:unknown[]):Promise<T>{
 if(window.mygo)return window.mygo.call<T>('Desktop.'+method,...args);
 const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args,locale:pageLocale()})});
 if(!response.ok)throw Error(messages.fTheLocalServiceIsUnavailableKeepThisWindowOpen());
 const result=await response.json();if(result.error)throw new CatalogError(result.errorCode||'',result.errorArgs||{},result.error);return result.value as T;
}
