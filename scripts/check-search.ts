import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createSearchQueue,validSearchTarget,type SearchState} from '../src/search';
import type {SearchItem,DocumentFilterResponse} from '../src/types';

let now=0,nextID=0;
const timers=new Map<number,{at:number;fn:()=>void}>();
const clock={
 set(fn:()=>void,ms:number){const id=++nextID;timers.set(id,{at:now+ms,fn});return id},
 clear(id:number){timers.delete(id)},
};
function advance(ms:number){now+=ms;for(const [id,t] of timers)if(t.at<=now){timers.delete(id);t.fn()}}
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve()};
const flights:{query:string;resolve:(v:DocumentFilterResponse)=>void;reject:(e:Error)=>void}[]=[];
const states:SearchState[]=[];
const queue=createSearchQueue({
 request:query=>new Promise((resolve,reject)=>flights.push({query,resolve,reject})),
 show:state=>states.push(state),clock,
});
const empty:DocumentFilterResponse={items:[],total:0,truncated:false,tags:[],recent:[]};
queue.visible(true);
queue.input('旧词');
advance(179);assert.equal(flights.length,0);
advance(1);assert.equal(flights.length,1);
queue.input('中间');advance(180);
queue.input('最新');advance(180);
assert.equal(flights.length,1,'only one request in flight');
flights[0].resolve(empty);await flush();
assert.equal(flights.length,2);assert.equal(flights[1].query,'最新');
assert.equal(states.filter(s=>s.kind==='ready').length,0,'old success discarded');
queue.input('');flights[1].reject(Error('old error'));await flush();
assert.equal(states.at(-1)?.kind,'recent','clearing discards old errors');
queue.composition(true);queue.input('组合');advance(500);
assert.equal(flights.length,2);
queue.composition(false);advance(180);assert.equal(flights.length,3);
queue.visible(false);flights[2].resolve(empty);await flush();
assert.notEqual(states.at(-1)?.kind,'ready','closed search cannot render');
queue.visible(true);advance(180);assert.equal(flights.length,4);
queue.invalidate(false);flights[3].resolve(empty);await flush();
assert.notEqual(states.at(-1)?.kind,'ready','dirty content invalidates immediately');
advance(500);assert.equal(flights.length,4,'pending save does not query');
queue.invalidate(true);advance(180);assert.equal(flights.length,5);
flights[4].resolve(empty);await flush();assert.equal(states.at(-1)?.kind,'ready');
queue.invalidate();advance(180);flights[5].reject(Error('current error'));await flush();
assert.equal(states.at(-1)?.kind,'error');queue.retry();advance(180);
assert.equal(flights.length,7);
queue.dispose();

const content='中😀AKſ尾';
const item:SearchItem={id:'a',title:'Title',path:'',updated:0,revision:4,titleMatch:null,hits:[],moreHits:false};
const hit={from:4,to:5,line:1,text:'K',before:'中😀A',after:'ſ尾'};
const doc={id:'a',revision:4,content};
assert(validSearchTarget(item,hit,doc));
assert(validSearchTarget(item,undefined,doc));
for(const bad of [{id:'b'},{revision:5},{content:'中😀Akſ尾'}])assert(!validSearchTarget(item,hit,{...doc,...bad}));
for(const bad of [{from:-1},{from:4.5},{to:99},{to:4},{text:'k'},{from:2,to:3,text:'\ude00'},{line:0},{line:2}])assert(!validSearchTarget(item,{...hit,...bad},doc));
console.log('PASS: 180ms debounce, one flight/latest pending, stale success/error, clear/close/composition/save, retry, UTF-16 navigation validation');

// Model two renders with independently delayed layout readiness. Completing the
// disposed first render must not cancel the current render's final jump.
{
 const {mock}=await import('bun:test');
 const jobs:{y:number;complete:()=>void}[]=[];
 class Block {
  dataset={line:'7',lineEnd:'7'};parentElement=null;
  constructor(public job:{y:number}){}
  getBoundingClientRect(){return {top:this.job.y-scroll.scrollTop,bottom:this.job.y-scroll.scrollTop+30}}
 }
 let blocks:Block[]=[];
 const scroll={
  scrollTop:0,clientHeight:600,
  getBoundingClientRect:()=>({top:0,bottom:600}),
  querySelectorAll:(selector:string)=>selector==='[data-line][data-line-end]'?blocks:[],
  scrollTo:(options:{top:number})=>{scroll.scrollTop=options.top},
  addEventListener:()=>{},removeEventListener:()=>{},
 };
 const host={closest:()=>({hidden:true}),replaceChildren:(block:Block)=>{blocks=[block]}};
 mock.module('../src/markdown',()=>({
  headingSlug:()=>'',renderMarkdown:()=>{
   const job={y:100,complete:()=>{}};
   const ready=new Promise<void>(resolve=>{job.complete=resolve});
   jobs.push(job);
   return {root:new Block(job),ready,dispose:()=>{}};
  },
 }));
 mock.module('../src/highlight',()=>({highlightCodeBlocks:async()=>{}}));
 const details=Object.getOwnPropertyDescriptor(globalThis,'HTMLDetailsElement');
 Object.defineProperty(globalThis,'HTMLDetailsElement',{value:class {},configurable:true});
 try{
  const {createPreviewController}=await import('../src/preview');
  const preview=createPreviewController({
   host:host as unknown as HTMLElement,scroll:scroll as unknown as HTMLElement,
   getContent:()=>'',resolveImage:async()=>undefined,openLink:()=>{},
  });
  preview.setDocument('search-preview');preview.setVisible(true);
  preview.jumpToLine(7);assert.equal(scroll.scrollTop,88);
  preview.refresh();assert.equal(jobs.length,2);
  jobs[0].complete();await flush();
  jobs[1].y=1000;jobs[1].complete();await flush();
  assert.equal(scroll.scrollTop,988,'obsolete render completion cancelled the current search jump');
  preview.dispose();
 }finally{
  if(details)Object.defineProperty(globalThis,'HTMLDetailsElement',details);
  else Reflect.deleteProperty(globalThis,'HTMLDetailsElement');
 }
 console.log('PASS: obsolete preview render cannot cancel the current search jump before its layout is ready');
}

// Execute the app's real navigation/save/composition functions without mounting
// its UI. Deferred API callbacks expose each wait; no wall-clock sleeps are used.
{
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const names=['save','saveForAction','composition','run','navigateSearch','openWikiLink'];
 const functions=names.map(name=>{
  const declaration=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name);
  assert(declaration,`missing app function ${name}`);
  return declaration.getText(source);
 }).join('\n');
 const code=ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const makeNavigation=new Function('env',`
  const {call,toast,messages,sidebarSearch,preview,wikiChooser,validSearchTarget}=env;
  const noop=()=>{},setTimeout=()=>0,clearTimeout=noop;
  let view=env.view,doc=env.doc,state={current:doc},appearance={layout:'single'},
      generation=0,navigationEpoch=0,dirty=true,busy=false,compositionActive=false,
      timer,outlineTimer,saveFlight=null,savedPosition='',failedSaveError,
      localePending=false,pendingClose=false,appearanceQueue=Promise.resolve();
  const position=()=>doc.position,$=()=>({textContent:''}),header=noop,banner=noop,
        syncPending=noop,scheduleOutline=noop,refreshLanguage=noop,closeApp=noop,
        processOpened=noop,closeOverlayDrawer=noop,renderDrawer=noop,pageLocale=()=>'en',
        errorText=String,localizedError=String,statusFailed=()=>false,statusText=()=>'',
        setBusy=value=>{busy=value};
  function load(next){
   state=next;doc=next.current;dirty=false;navigationEpoch++;
   view={...view,state:{doc:{toString:()=>doc.content}}};env.loads.push(doc.id);
  }
  ${code}
  return {navigateSearch,openWikiLink,composition,current:()=>doc.id,text:()=>view.state.doc.toString()};
 `);
 function harness(hold:string,total=1){
  const origin={id:'origin',revision:1,content:'[[Title]]',position:{anchor:0,head:0,scroll:0,source:false}};
  const target={...origin,id:item.id,revision:item.revision,content:doc.content};
  const calls:string[]=[],toasts:string[]=[],loads:string[]=[];
  let held=false,holding=true,release:()=>void=()=>assert.fail('no held callback');
  const request=(method:string,result:unknown)=>{
   calls.push(method);
   if(holding&&method===hold){holding=false;held=true;return new Promise(resolve=>{release=()=>resolve(result)})}
   return Promise.resolve(result);
  };
  const candidates={items:[item,{...item,id:'b'}].slice(0,total),total,truncated:false};
  const nav=makeNavigation({
   doc:origin,view:{composing:false,state:{doc:{toString:()=>origin.content}}},
   calls,toasts,loads,validSearchTarget,
   toast:(text:string)=>toasts.push(text),messages:new Proxy({},{get:(_target,key)=>()=>String(key)}),
   sidebarSearch:{refresh:()=>{},contentAccepted:()=>{}},preview:{saved:()=>{},composition:()=>{}},
   wikiChooser:{choose:()=>request('choose',item)},
   call:(method:string,...args:unknown[])=>{
    if(method==='Update')return request(method,{...origin,revision:2});
    if(method==='ResolveWikiLink')return request(method,candidates);
    assert.equal(method,'ActivateSearch');return request(method,{current:args[0]===origin.id?{...origin,revision:2}:target});
   },
  }) as {
   navigateSearch:(item:SearchItem,hit:undefined,inSource:boolean)=>Promise<void>;
   openWikiLink:(target:string)=>Promise<void>;composition:(active:boolean)=>void;
   current:()=>string;text:()=>string;
  };
  return {...nav,calls,toasts,loads,held:()=>held,release:()=>release()};
 }
 async function callback(predicate:()=>boolean,label:string){
  for(let i=0;i<100&&!predicate();i++)await Promise.resolve();
  assert(predicate(),`callback did not arrive: ${label}`);
 }
 async function settle(pending:Promise<void>){
  let finished=false;
  const result=pending.finally(()=>{finished=true});
  await callback(()=>finished,'navigation completion');await result;
 }
 const failures:string[]=[];
 async function regression(name:string,check:()=>Promise<void>){
  try{await check();console.log(`PASS: ${name}`)}
  catch(error){failures.push(name);console.error(`FAIL: ${name}\n${error}`)}
 }
 for(const path of ['wiki','backlink'] as const){
  const begin=(nav:ReturnType<typeof harness>)=>path==='wiki'?nav.openWikiLink('Title'):nav.navigateSearch(item,undefined,false);
  await regression(`${path}: completed no-edit composition cancels held Update and a fresh intent survives`,async()=>{
   const nav=harness('Update'),pending=begin(nav);
   await callback(nav.held,'Update');
   nav.composition(true);nav.composition(false);nav.release();await settle(pending);
   assert.equal(nav.current(),'origin','old save-wait intent navigated after composition ended');
   assert.deepEqual(nav.loads,[]);
   assert(!nav.calls.includes(path==='wiki'?'ResolveWikiLink':'ActivateSearch'),'cancelled intent issued navigation request');
   assert.deepEqual(nav.toasts,[],'completed composition should cancel silently');
   assert.equal(nav.text(),'[[Title]]','composition changed the editor text');
   await settle(begin(nav));assert.equal(nav.current(),item.id,'fresh intent was cancelled');
  });
  await regression(`${path}: uninterrupted held Update still navigates`,async()=>{
   const nav=harness('Update'),pending=begin(nav);
   await callback(nav.held,'Update');nav.release();await settle(pending);
   assert.equal(nav.current(),item.id);assert.deepEqual(nav.toasts,[]);
  });
 }
 for(const phase of ['Update','ActivateSearch']){
  await regression(`backlink: active composition during held ${phase} retains finish-composing feedback`,async()=>{
   const nav=harness(phase),pending=nav.navigateSearch(item,undefined,false);
   await callback(nav.held,phase);nav.composition(true);nav.release();await settle(pending);
   assert.equal(nav.current(),'origin');
   assert.deepEqual(nav.toasts,['fFinishComposingYourTextFirst']);
  });
 }
 for(const phase of ['ActivateSearch','ResolveWikiLink','choose']){
  await regression(`completed no-edit composition cancels held ${phase}`,async()=>{
   const nav=harness(phase,phase==='choose'?2:1);
   const pending=phase==='ActivateSearch'?nav.navigateSearch(item,undefined,false):nav.openWikiLink('Title');
   await callback(nav.held,phase);nav.composition(true);nav.composition(false);nav.release();await settle(pending);
   assert.equal(nav.current(),'origin');assert.deepEqual(nav.loads,[]);assert.deepEqual(nav.toasts,[]);
  });
 }
 assert.equal(failures.length,0,`navigation regressions failed: ${failures.join('; ')}`);
}
