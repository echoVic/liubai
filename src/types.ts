import {pageLocale,messages,CatalogError} from './i18n';
import type {ThemeID,AutoSwitch} from './theme';
export interface Appearance {theme:ThemeID;auto:AutoSwitch;lightTheme:ThemeID;darkTheme:ThemeID;followSystem?:boolean;fontSize?:number;lineWidth?:'normal'|'wide'|'full';layout?:'single'|'split'|'read';source?:boolean;sidebarDocked?:boolean;outlineHidden?:boolean}
export interface CaptureSettings {enabled:boolean;shortcut:string;openAtLogin:boolean}
export interface Position {anchor:number;head:number;scroll:number;source:boolean}
export type StatusCode='draftSaved'|'fileSaved'|'fileUnavailable'|'diskUnreadable'|'diskReloaded'|'reloadRecoveryFailed'|'diskConflict'|'imageSaveFailed'|'fileSaveFailed'|'fileReadOnly'|'saveFailed'|'recoveryUpdateFailed';
export interface Doc {id:string;title:string;customTitle?:boolean;content:string;path:string;updated:number;revision:number;position:Position;conflict:boolean;status:string;statusCode?:StatusCode}
export interface DocStatus {id:string;revision:number;conflict:boolean;status:string;statusCode?:StatusCode}
export interface Summary {id:string;title:string;path:string;updated:number;excerpt:string;tags?:string[];warning?:string}
export interface SearchRange {from:number;to:number}
export interface SearchHit extends SearchRange {line:number;text:string;before:string;after:string}
export interface SearchItem {id:string;title:string;path:string;updated:number;revision:number;titleMatch:SearchRange|null;hits:SearchHit[];moreHits:boolean}
export interface SearchResponse {items:SearchItem[];total:number;truncated:boolean}
export interface WikiResolveRequest {sourceID:string;revision:number;target:string}
export interface BacklinkResponse {documentID:string;revision:number;status:'ready'|'unnamed'|'ambiguous';items:SearchItem[];total:number;truncated:boolean}
export interface DocumentFilterRequest {query:string;tag:string}
export interface TagSummary {name:string;count:number}
export interface DocumentFilterItem {document:SearchItem;tags:string[];excerpt:string}
export interface DocumentFilterResponse {items:DocumentFilterItem[];total:number;truncated:boolean;tags:TagSummary[];recent:Summary[]}
export interface CaptureRequest {text:string;tags:string[];targetID:string;revision:number}
export interface CaptureAppendResult {document:Doc;changes:{from:number;to:number;insert:string}[];summary:Summary}
export interface LocaleNotice {key?:string;args?:Record<string,unknown>;text?:string}
export interface WorkspaceState {capture:CaptureSettings;current:Doc;recent:Summary[];appearance:Appearance;notices?:string[];noticeMessages?:LocaleNotice[];quarantineDir?:string}
export interface ImageResult {destination:string;url:string;name:string;markdown:string}
export interface ExportResult {path:string;missing:string[];external:number;document:Doc;cancelled:boolean;changes?:{from:number;to:number;insert:string}[]}
declare global {interface Window {liubaiAppendCapture(request:CaptureRequest):Promise<Summary>;mygo?:{locale?:string;call<T>(method:string,...args:unknown[]):Promise<T>;on<T>(name:string,fn:(data:T)=>void):void}}}
export const desktop=!!window.mygo;
export async function call<T>(method:string,...args:unknown[]):Promise<T>{
 if(window.mygo)return window.mygo.call<T>('Desktop.'+method,...args);
 const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args,locale:pageLocale()})});
 if(!response.ok)throw Error(messages.fTheLocalServiceIsUnavailableKeepThisWindowOpen());
 const result=await response.json();if(result.error)throw new CatalogError(result.errorCode||'',result.errorArgs||{},result.error);return result.value as T;
}
