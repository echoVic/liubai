export interface Appearance {theme:'paper'|'warm'|'mist'|'ink';followSystem:boolean;fontSize?:number;lineWidth?:'normal'|'wide';layout?:'single'|'split';source?:boolean}
export interface Position {anchor:number;head:number;scroll:number;source:boolean}
export interface Doc {id:string;title:string;content:string;path:string;updated:number;revision:number;position:Position;conflict:boolean;status:string}
export interface Summary {id:string;title:string;path:string;updated:number;excerpt:string}
export interface WorkspaceState {current:Doc;recent:Summary[];appearance:Appearance}
export interface ImageResult {destination:string;url:string;name:string;markdown:string}
export interface ExportResult {path:string;missing:string[];external:number;document:Doc;cancelled:boolean;changes?:{from:number;to:number;insert:string}[]}
declare global {interface Window {mygo?:{call<T>(method:string,...args:unknown[]):Promise<T>;on<T>(name:string,fn:(data:T)=>void):void}}}
export const desktop=!!window.mygo;
export async function call<T>(method:string,...args:unknown[]):Promise<T>{
 if(window.mygo)return window.mygo.call<T>('Desktop.'+method,...args);
 const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
 if(!response.ok)throw Error('本地服务暂时不可用，请保留当前窗口');
 const result=await response.json();if(result.error)throw Error(result.error);return result.value as T;
}
