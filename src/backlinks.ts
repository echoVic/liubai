import {messages,localizedError} from './i18n';
import type {BacklinkResponse,SearchItem,SearchHit} from './types';

export type BacklinkState={id:string;revision:number}&(
 | {kind:'idle'|'loading'|'paused'}
 | {kind:'ready';result:BacklinkResponse}
 | {kind:'error';error:unknown});
type Timer=ReturnType<typeof setTimeout>|number;
interface Clock {set:(fn:()=>void,ms:number)=>Timer;clear:(id:Timer)=>void}
export function createBacklinkQueue(options:{
 request:(id:string)=>Promise<BacklinkResponse>;show:(state:BacklinkState)=>void;clock?:Clock;
}){
 const clock:Clock=options.clock||{set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)};
 let id='',revision=0,paused=false,visible=false,flight=false,disposed=false,epoch=0;
 let timer:Timer|undefined,pending:{id:string;revision:number;epoch:number}|undefined;
 const cancel=()=>{epoch++;if(timer!==undefined)clock.clear(timer);timer=undefined;pending=undefined};
 const start=()=>{
  if(flight||!pending||disposed)return;
  const job=pending;pending=undefined;flight=true;
  void options.request(job.id).then(result=>{
   if(job.epoch!==epoch||disposed)return;
   if(result.documentID!==job.id||result.revision!==job.revision){
    options.show({kind:'error',id,revision,error:Error(messages.bWikiSourceChanged())});return;
   }
   options.show({kind:'ready',id,revision,result});
  },error=>{if(job.epoch===epoch&&!disposed)options.show({kind:'error',id,revision,error})})
   .finally(()=>{flight=false;start()});
 };
 const schedule=()=>{
  cancel();if(disposed)return;
  if(!visible||!id){options.show({kind:'idle',id,revision});return}
  options.show({kind:paused?'paused':'loading',id,revision});
  if(paused)return;
  const stamp=epoch;
  timer=clock.set(()=>{timer=undefined;if(stamp!==epoch)return;pending={id,revision,epoch};start()},180);
 };
 return {
  context(nextID:string,nextRevision:number,nextPaused:boolean){
   if(id===nextID&&revision===nextRevision&&paused===nextPaused)return;
   id=nextID;revision=nextRevision;paused=nextPaused;schedule();
  },
  visible(next:boolean){if(next===visible)return;visible=next;schedule()},
  refresh:schedule,language:schedule,retry:schedule,
  dispose(){disposed=true;cancel()},
 };
}

export function createBacklinks(options:{
 details:HTMLDetailsElement;list:HTMLElement;status:HTMLElement;
 request:(id:string)=>Promise<BacklinkResponse>;
 activate:(item:SearchItem,hit:SearchHit|undefined)=>void;
}){
 const element=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{
  const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;
 };
 const summary=options.details.querySelector('summary')!;
 let sidebarVisible=false,current:BacklinkState={kind:'idle',id:'',revision:0},displayedID='';
 let pendingFocus:{key:string;element:HTMLElement}|undefined;
 const buttons=()=>Array.from(options.list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
 const show=(state:BacklinkState)=>{
  current=state;
  options.list.dataset.backlinkState=state.kind;
  options.list.dataset.documentId=state.id;
  options.list.dataset.revision=String(state.revision);
  options.list.setAttribute('aria-busy',String(state.kind==='loading'));
  if(state.kind==='idle')return;
  if(displayedID!==state.id){options.list.replaceChildren();displayedID=state.id;pendingFocus=undefined}
  if(state.kind==='paused'||state.kind==='loading'){
   const active=document.activeElement as HTMLElement|null;
   if(active&&options.list.contains(active)&&active.dataset.backlinkKey)pendingFocus={key:active.dataset.backlinkKey,element:active};
   for(const button of options.list.querySelectorAll<HTMLButtonElement>('button'))button.disabled=true;
   options.status.textContent=state.kind==='paused'?messages.fBacklinkPending():messages.fBacklinkLoading();
   return;
  }
  const active=document.activeElement as HTMLElement|null;
  const hadFocus=!!active&&options.list.contains(active)||!!pendingFocus&&(active===document.body||active===pendingFocus.element);
  const key=active?.dataset.backlinkKey||pendingFocus?.key;pendingFocus=undefined;
  options.list.replaceChildren();
  if(state.kind==='error'){
   options.status.textContent=localizedError(state.error);
   const retry=element('button','search-retry',messages.fBacklinkRetry());retry.type='button';retry.dataset.backlinkKey='retry';retry.onclick=()=>queue.retry();options.list.append(retry);
  }else if(state.kind==='ready'){
   const response=state.result;
   options.status.textContent=response.status==='unnamed'?messages.fBacklinkUnnamed():response.status==='ambiguous'?messages.fBacklinkAmbiguous():response.total?messages.fBacklinkCount(response.total):messages.fBacklinkEmpty();
   for(const item of response.items){
    const group=element('section','backlink-item');group.dataset.documentId=item.id;
    const button=(cls:string,key:string,hit?:SearchHit)=>{
     const node=element('button',cls);node.type='button';node.dataset.backlinkKey=item.id+':'+key;
     node.onclick=()=>{if(current.kind==='ready')options.activate(item,hit)};return node;
    };
    const title=button('search-title','title');title.textContent=item.title;
    const path=element('small','search-path',item.path||messages.fSearchDraft());path.title=item.path;
    group.append(title,path);
    for(const hit of item.hits){
     const node=button('search-hit',String(hit.from),hit),snippet=element('span','search-snippet');
     snippet.append(document.createTextNode(hit.before),element('mark','',hit.text),document.createTextNode(hit.after));
     node.append(element('small','search-line',messages.fSearchLine(hit.line)),snippet);group.append(node);
    }
    if(item.moreHits)group.append(element('p','search-more',messages.fBacklinkMoreHits()));
    options.list.append(group);
   }
   if(response.truncated)options.list.append(element('p','search-more',messages.fBacklinkTruncated()));
  }
  if(hadFocus)(buttons().find(button=>button.dataset.backlinkKey===key)||summary).focus();
 };
 const queue=createBacklinkQueue({request:options.request,show});
 const toggle=()=>queue.visible(sidebarVisible&&options.details.open);
 options.details.addEventListener('toggle',toggle);
 const focusChanged=(event:FocusEvent)=>{if(pendingFocus&&event.target!==document.body&&event.target!==pendingFocus.element)pendingFocus=undefined};
 const pointerChanged=(event:PointerEvent)=>{if(pendingFocus&&!options.list.contains(event.target as Node))pendingFocus=undefined};
 document.addEventListener('focusin',focusChanged);document.addEventListener('pointerdown',pointerChanged);
 options.list.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();summary.focus();return}
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
  const all=buttons(),index=all.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;
  event.preventDefault();const next=index+(event.key==='ArrowDown'?1:-1);
  if(next<0)summary.focus();else all[Math.min(next,all.length-1)]?.focus();
 });
 return {
  context:queue.context,refresh:queue.refresh,
  visible(next:boolean){sidebarVisible=next;toggle()},
  language(){summary.textContent=messages.fBacklinks();queue.language()},
  dispose(){queue.dispose();options.details.removeEventListener('toggle',toggle);document.removeEventListener('focusin',focusChanged);document.removeEventListener('pointerdown',pointerChanged)},
 };
}
