// Bun has no DOM; the parser turndown brings for Node renders the reading view's markup. Author HTML still needs a
// browser, as DOMPurify does not run on it.
import {createRequire} from 'node:module';
export function headlessDOM(){
 const domino=createRequire(import.meta.resolve('turndown'))('@mixmark-io/domino'),page=domino.createDocument('<!doctype html><html><body></body></html>');
 const element=Object.getPrototypeOf(Object.getPrototypeOf(page.createElement('div')));let node=element;while(node&&!Object.hasOwn(node,'appendChild'))node=Object.getPrototypeOf(node);
 const text=(n:any)=>typeof n==='string'?page.createTextNode(n):n;
 for(const proto of [node,Object.getPrototypeOf(page.createDocumentFragment())]){
  proto.append??=function(...nodes:any[]){for(const n of nodes)this.appendChild(text(n))};
  proto.replaceChildren??=function(...nodes:any[]){while(this.firstChild)this.removeChild(this.firstChild);for(const n of nodes)this.appendChild(text(n))};
  proto.replaceWith??=function(...nodes:any[]){for(const n of nodes)this.parentNode.insertBefore(text(n),this);this.parentNode.removeChild(this)};
 }
 Object.assign(globalThis,{document:page,HTMLElement:globalThis.HTMLElement??class{},MutationObserver:undefined});
 return page;
}
