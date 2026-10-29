import {messages,pageLocale} from './i18n';
import type {SearchItem} from './types';

export function createWikiChooser(dialog:HTMLDialogElement,list:HTMLElement,open:()=>void){
 let candidates:SearchItem[]=[],finish:((item:SearchItem|null)=>void)|undefined;
 const render=()=>{
  const selected=(document.activeElement as HTMLElement|null)?.dataset.wikiCandidate;
  const hadFocus=list.contains(document.activeElement);
  list.replaceChildren();
  for(const item of candidates){
   const button=document.createElement('button');button.type='button';button.className='wiki-candidate';button.dataset.wikiCandidate=item.id;
   const title=document.createElement('b');title.textContent=item.title;
   const path=document.createElement('small');path.textContent=item.path||messages.fSearchDraft();
   const updated=document.createElement('small');updated.textContent=new Date(item.updated).toLocaleString(pageLocale());
   button.append(title,path,updated);button.onclick=()=>{const resolve=finish;finish=undefined;dialog.close();resolve?.(item)};
   list.append(button);
  }
  if(hadFocus)(Array.from(list.querySelectorAll<HTMLElement>('[data-wiki-candidate]')).find(node=>node.dataset.wikiCandidate===selected)||list.querySelector<HTMLElement>('button'))?.focus();
 };
 dialog.addEventListener('close',()=>{const resolve=finish;finish=undefined;resolve?.(null)});
 list.addEventListener('keydown',event=>{
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown'||event.isComposing)return;
  const all=Array.from(list.querySelectorAll<HTMLButtonElement>('button')),index=all.indexOf(document.activeElement as HTMLButtonElement);
  if(index<0)return;event.preventDefault();all[Math.max(0,Math.min(all.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();
 });
 return {
  choose(items:SearchItem[]):Promise<SearchItem|null>{
   finish?.(null);candidates=items;render();
   return new Promise(resolve=>{finish=resolve;open();list.querySelector<HTMLElement>('button')?.focus()});
  },
  localize(){if(dialog.open)render()},
 };
}
