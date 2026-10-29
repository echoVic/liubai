import {messages,localizedError} from './i18n';
import {renderTagOptions,tagButtons} from './tag-filter';
import type {SearchItem,SearchHit,DocumentFilterResponse,TagSummary,Summary} from './types';

export type SearchState={query:string;tag:string}&(
 | {kind:'recent';result?:DocumentFilterResponse}
 | {kind:'loading'}
 | {kind:'paused'}
 | {kind:'ready';result:DocumentFilterResponse}
 | {kind:'error';error:unknown});
type Timer=ReturnType<typeof setTimeout>|number;
interface SearchClock {set:(fn:()=>void,ms:number)=>Timer;clear:(id:Timer)=>void}

export function createSearchQueue(options:{
 request:(query:string,tag:string)=>Promise<DocumentFilterResponse>;
 show:(state:SearchState)=>void;
 clock?:SearchClock;
}){
 const clock:SearchClock=options.clock||{set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)};
 let query='',tag='',epoch=0,visible=false,composing=false,accepted=true,flight=false,disposed=false;
 let timer:Timer|undefined,pending:{query:string;tag:string;epoch:number}|undefined;
 const cancel=()=>{if(timer!==undefined)clock.clear(timer);timer=undefined;pending=undefined;epoch++};
 const start=()=>{
  if(flight||!pending||disposed)return;
  const job=pending;pending=undefined;flight=true;
  void options.request(job.query,job.tag).then(result=>{
   if(job.epoch===epoch&&!disposed)options.show({kind:job.query||job.tag?'ready':'recent',query:job.query,tag:job.tag,result});
  },error=>{
   if(job.epoch===epoch&&!disposed)options.show({kind:'error',query:job.query,tag:job.tag,error});
  }).finally(()=>{flight=false;start()});
 };
 const schedule=()=>{
  cancel();
  if(!visible||disposed)return;
  if(!query&&!tag)options.show({kind:'recent',query,tag});
  if(composing||!accepted){if(query||tag)options.show({kind:'paused',query,tag});return}
  if(query||tag)options.show({kind:'loading',query,tag});
  const stamp=epoch;
  timer=clock.set(()=>{timer=undefined;if(stamp!==epoch)return;pending={query,tag,epoch};start()},180);
 };
 return {
  input(value:string){query=value.trim();schedule()},
  filter(value:string){tag=value;schedule()},
  invalidate(ready=true){accepted=ready;schedule()},
  visible(next:boolean){if(next===visible)return;visible=next;schedule()},
  composition(next:boolean){composing=next;schedule()},
  retry:schedule,
  dispose(){disposed=true;cancel()},
 };
}

export function validSearchTarget(item:SearchItem,hit:SearchHit|undefined,current:{id:string;revision:number;content:string}):boolean {
 if(item.id!==current.id||item.revision!==current.revision)return false;
 if(!hit)return true;
 const {from,to,line,text}=hit,content=current.content;
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<=from||to>content.length)return false;
 const splitsSurrogate=(at:number)=>at>0&&at<content.length&&/[\uD800-\uDBFF]/.test(content[at-1])&&/[\uDC00-\uDFFF]/.test(content[at]);
 if(splitsSurrogate(from)||splitsSurrogate(to)||content.slice(from,to)!==text)return false;
 return Number.isInteger(line)&&line>0&&line===content.slice(0,from).split('\n').length;
}

export function createSidebarSearch(options:{
 input:HTMLInputElement;select:HTMLSelectElement;label:HTMLElement;list:HTMLElement;status:HTMLElement;consistency:HTMLElement;
 request:(query:string,tag:string)=>Promise<DocumentFilterResponse>;
 activate:(item:SearchItem,hit:SearchHit|undefined,source:boolean)=>void;
 recent:(recent:Summary[]|undefined,selected:string)=>void;escape:()=>void;
}){
 let current:SearchState={kind:'recent',query:'',tag:''},saveState:'saved'|'pending'|'failed'='saved',composing=false;
 let tags:TagSummary[]=[];
 let pendingFocus:{key:string;element:HTMLElement}|undefined;
 const element=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{
  const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;
 };
 const marked=(host:HTMLElement,text:string,range:{from:number;to:number}|null)=>{
  if(!range){host.textContent=text;return}
  host.append(document.createTextNode(text.slice(0,range.from)),element('mark','',text.slice(range.from,range.to)),document.createTextNode(text.slice(range.to)));
 };
 const buttons=()=>Array.from(options.list.querySelectorAll<HTMLButtonElement>('button[data-search-key]:not(:disabled)'));
 const chooseTag=(tag:string)=>queue.filter(tag===current.tag?'':tag);
 const appendRetry=()=>{
  const retry=element('button','search-retry',messages.fSearchRetry());retry.type='button';retry.dataset.searchKey='retry';retry.onclick=()=>queue.retry();options.list.append(retry);
 };
 const consistency=()=>{
  options.consistency.textContent=current.query||current.tag?(saveState==='pending'?messages.fSearchPending():saveState==='failed'?messages.fSearchSaveFailed():''):'';
  options.consistency.hidden=!options.consistency.textContent;
 };
 const show=(state:SearchState)=>{
  const previous=current.kind;
  current=state;consistency();
  options.list.dataset.searchState=state.kind;
  options.list.dataset.searchQuery=state.query;
  options.list.dataset.searchTag=state.tag;
  options.list.setAttribute('aria-busy',String(state.kind==='loading'));
  options.label.textContent=state.query||state.tag?messages.fDocuments():messages.fRecentDocuments();
  if((state.kind==='ready'||state.kind==='recent')&&state.result)tags=state.result.tags;
  renderTagOptions(options.select,tags,state.tag);
  options.status.hidden=!(state.query||state.tag||state.kind==='error');
  if(state.kind==='recent'){pendingFocus=undefined;options.status.textContent='';options.recent(state.result?.recent,state.tag);return}
  if(state.kind==='loading'||state.kind==='paused'){
   const active=document.activeElement as HTMLElement|null;
   if(active&&options.list.contains(active)&&active.dataset.searchKey)pendingFocus={key:active.dataset.searchKey,element:active};
   if(previous==='recent')options.list.replaceChildren();
   options.status.textContent=messages.fSearching();
   for(const b of options.list.querySelectorAll<HTMLButtonElement>('button:not(.document-tag)'))b.disabled=true;
   for(const b of options.list.querySelectorAll<HTMLButtonElement>('button[data-filter-tag]')){
    const tag=b.dataset.filterTag!;
    b.setAttribute('aria-pressed',String(tag===state.tag));
    b.title=b.ariaLabel=tag===state.tag?messages.fClearTag(tag):messages.fFilterTag(tag);
   }
   return;
  }
  const active=document.activeElement as HTMLElement|null;
  const hadFocus=!!active&&options.list.contains(active)||!!pendingFocus&&(active===document.body||active===pendingFocus.element);
  const key=active?.dataset.searchKey||pendingFocus?.key;
  pendingFocus=undefined;
  if(state.kind==='error'&&!state.query&&!state.tag)options.recent(undefined,state.tag);
  else options.list.replaceChildren();
  if(state.kind==='error'){
   options.status.textContent=localizedError(state.error);
   appendRetry();
  }else{
   options.status.textContent=state.result.total?messages.fSearchCount(state.result.total):state.query?messages.fSearchEmpty(state.query):messages.fTagEmpty(state.tag);
   const fragment=document.createDocumentFragment();
   for(const filtered of state.result.items){
    const item=filtered.document;
    const group=element('section','search-item');group.dataset.documentId=item.id;
    const button=(cls:string,key:string,hit:SearchHit|undefined,source=false)=>{
     const b=element('button',cls);b.type='button';b.dataset.searchKey=item.id+':'+key;
     b.onclick=()=>{if(!composing)options.activate(item,hit,source)};
     return b;
    };
    const title=button('search-title','title',item.hits[0]);marked(title,item.title,item.titleMatch);group.append(title);
    const path=element('small','search-path',item.path||messages.fSearchDraft());if(item.path)path.title=item.path;group.append(path);
    for(const hit of item.hits){
     const row=element('div','search-hit-row'),b=button('search-hit',String(hit.from),hit);
     b.append(element('small','search-line',messages.fSearchLine(hit.line)));
     const snippet=element('span','search-snippet');
     snippet.append(document.createTextNode(hit.before),element('mark','',hit.text),document.createTextNode(hit.after));b.append(snippet);
     const source=button('search-source','source:'+hit.from,hit,true);source.textContent=messages.fSearchSource();
     row.append(b,source);group.append(row);
    }
    if(item.moreHits)group.append(element('p','search-more',messages.fSearchMoreHits()));
    if(filtered.excerpt)group.append(element('p','search-excerpt',filtered.excerpt));
    if(filtered.tags.length){const row=element('div','document-tags');row.append(tagButtons(filtered.tags,state.tag,chooseTag,item.id));group.append(row)}
    fragment.append(group);
   }
   if(state.result.truncated)fragment.append(element('p','search-more',messages.fSearchTruncated()));
   options.list.append(fragment);
  }
  if(hadFocus)(buttons().find(b=>b.dataset.searchKey===key)||options.input).focus();
 };
 const queue=createSearchQueue({request:options.request,show});
 renderTagOptions(options.select,tags,'');
 options.select.addEventListener('change',()=>queue.filter(options.select.value));
 document.addEventListener('focusin',event=>{
  if(pendingFocus&&event.target!==pendingFocus.element&&event.target!==document.body)pendingFocus=undefined;
 });
 document.addEventListener('pointerdown',event=>{
  if(pendingFocus&&!options.list.contains(event.target as Node))pendingFocus=undefined;
 });
 options.input.addEventListener('input',()=>queue.input(options.input.value));
 options.input.addEventListener('compositionstart',()=>{composing=true;queue.composition(true)});
 options.input.addEventListener('compositionend',()=>{composing=false;queue.composition(false)});
 options.input.addEventListener('keydown',event=>{
  if(composing||event.isComposing)return;
  if(event.key==='Escape'){
   event.preventDefault();event.stopPropagation();
   if(options.input.value){options.input.value='';queue.input('')}else if(current.tag)queue.filter('');else options.escape();
  }else if(event.key==='ArrowDown'||event.key==='Enter'){
   if(!current.query&&!current.tag)return;
   event.preventDefault();event.stopPropagation();
   const first=buttons()[0];if(event.key==='Enter')first?.click();else first?.focus();
  }
 });
 options.list.addEventListener('keydown',event=>{
  if((!current.query&&!current.tag)||composing||event.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();options.input.focus();return}
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
  const all=buttons(),index=all.indexOf(document.activeElement as HTMLButtonElement);
  if(index<0)return;
  event.preventDefault();const next=index+(event.key==='ArrowDown'?1:-1);
  if(next<0)options.input.focus();else all[Math.min(next,all.length-1)]?.focus();
 });
 return {
  get active(){return !!(options.input.value.trim()||current.tag)},
  filter:queue.filter,
  chooseTag,
  visible:queue.visible,
  refresh(){queue.invalidate(saveState!=='pending')},
  contentPending(){saveState='pending';queue.invalidate(false)},
  contentAccepted(pending=false){saveState=pending?'pending':'saved';queue.invalidate(!pending)},
  contentFailed(){saveState='failed';queue.invalidate()},
  localize(){queue.invalidate(saveState!=='pending')},
  renderRecent(){if(!options.input.value.trim()&&!current.tag){options.recent(undefined,current.tag);if(current.kind==='error')appendRetry()}},
 };
}
