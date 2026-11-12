// The few Bun APIs the checks use, so the scripts type-check without Bun's own type package.
declare const Bun:{write(path:string,data:string|Blob|ArrayBuffer|ArrayBufferView):Promise<number>};
declare module 'bun:test'{export const mock:{module(specifier:string,factory:()=>unknown):void|Promise<void>}}
