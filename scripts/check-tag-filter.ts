import assert from 'node:assert/strict';
import {createSearchQueue,type SearchState} from '../src/search';
import type {DocumentFilterResponse} from '../src/types';

let nextID=0;
const timers=new Map<number,()=>void>();
const clock={set(fn:()=>void){const id=++nextID;timers.set(id,fn);return id},clear(id:unknown){timers.delete(id as number)}};
const advance=()=>{const jobs=[...timers.values()];timers.clear();for(const fn of jobs)fn()};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const flights:{query:string;tag:string;resolve:(r:DocumentFilterResponse)=>void;reject:(e:Error)=>void}[]=[];
const states:SearchState[]=[];
const queue=createSearchQueue({
 request:(query,tag)=>new Promise((resolve,reject)=>flights.push({query,tag,resolve,reject})),
 show:s=>states.push(s),clock,
});
const result:DocumentFilterResponse={items:[],total:0,truncated:false,tags:[{name:'工作',count:2}],recent:[]};
queue.visible(true);
queue.filter('工作');queue.input('needle');advance();
assert.equal(flights[0].tag,'工作');
queue.filter('生活');advance();
flights[0].resolve(result);await flush();
assert.equal(flights.length,2,'one flight with newest tag queued');
assert.equal(flights[1].tag,'生活');
assert.equal(states.filter(s=>s.kind==='ready').length,0,'old result and catalog discarded');
queue.input('');advance();
flights[1].reject(Error('obsolete'));await flush();
assert.equal(flights[2].query,'');assert.equal(flights[2].tag,'生活','clearing query keeps tag');
queue.filter('');
assert.equal(states.at(-1)?.kind,'recent','empty filters restore recent immediately');
advance();flights[2].resolve(result);await flush();
assert.equal(flights[3].tag,'');
flights[3].resolve(result);await flush();
assert.equal(states.at(-1)?.kind,'recent');
const accepted=states.at(-1);
assert(accepted?.kind==='recent'&&accepted.result===result,'accepted metadata accompanies recent state');
queue.invalidate(false);advance();assert.equal(flights.length,4,'pending content pauses metadata too');
queue.invalidate();advance();
queue.composition(true);flights[4].resolve(result);await flush();
const composing=states.at(-1);
assert(!(composing?.kind==='recent'&&composing.result),'composition invalidates metadata');
advance();assert.equal(flights.length,5);
queue.composition(false);advance();
queue.visible(false);flights[5].reject(Error('closed'));await flush();
assert.notEqual(states.at(-1)?.kind,'error');
queue.visible(true);advance();queue.invalidate();advance();
flights[6].resolve(result);await flush();
assert.equal(flights.length,8,'locale/content invalidation queues fresh metadata');
flights[7].reject(Error('catalog unavailable'));await flush();
assert.equal(states.at(-1)?.kind,'error','empty-filter metadata failure is surfaced for retry');
queue.retry();advance();flights[8].resolve(result);await flush();
assert.equal(states.at(-1)?.kind,'recent');
queue.dispose();
{
 // Typing holds the catalog (app.ts contentPending → hold) and the save acknowledgement reissues it (contentAccepted → invalidate(true)).
 // A catalog request still open from before the edit answers for the old text, whether it lands before or after the acknowledgement.
 const asked:((r:DocumentFilterResponse)=>void)[]=[],shown:SearchState[]=[];
 // The fake clock hands out numbers where SearchClock expects timer handles.
 const saves=createSearchQueue({request:()=>new Promise(resolve=>asked.push(resolve)),show:s=>shown.push(s),clock});
 const catalog=(count:number):DocumentFilterResponse=>({items:[],total:count,truncated:false,tags:[{name:'工作',count}],recent:[]});
 saves.visible(true);saves.filter('工作');
 for(const order of ['catalog before the acknowledgement','catalog after the acknowledgement']){
  saves.invalidate(true);advance();const open=asked.at(-1)!,sent=asked.length,from=shown.length;
  saves.hold();
  if(order.includes('before')){open(catalog(1));await flush()}
  saves.invalidate(true);advance();
  if(order.includes('after')){open(catalog(1));await flush()}
  assert.equal(asked.length,sent+1,order+': the acknowledged save asks again');
  assert(!shown.slice(from).some(s=>s.kind==='ready'),order+': the answer for the old text is dropped');
  asked.at(-1)!(catalog(0));await flush();
  const last=shown.at(-1);
  assert(last?.kind==='ready'&&last.result.tags[0].count===0,order+': the count follows the saved text');
 }
 saves.dispose();
}
console.log('PASS: tag/query intersection scheduling, old catalog/error invalidation, recent metadata, composition/save/close/locale, retry');
