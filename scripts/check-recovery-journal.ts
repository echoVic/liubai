import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {recoveryJournal} from '../src/recovery-journal';
import {createRecoveryStream,type RecoveryPacket,type RecoverySnapshot} from '../src/session-recovery';
const values=new Map<string,string>();let written=0,largestDelta=0;
const storage={get length(){return values.size},key:(i:number)=>Array.from(values.keys())[i]||null,getItem:(key:string)=>values.get(key)||null,removeItem:(key:string)=>{values.delete(key)},setItem:(key:string,value:string)=>{written+=value.length;if(key.includes(':delta:'))largestDelta=Math.max(largestDelta,value.length);values.set(key,value)}};
const snapshot:RecoverySnapshot={id:'doc',content:'中😀',position:{anchor:3,head:3,scroll:4},composing:false};
let current=snapshot;
const journal=recoveryJournal(storage,'workspace');
// No Go reply arrives before shutdown: the renderer journal must contain tail.
const stream=createRecoveryStream(()=>new Promise(()=>{}),()=>current,packet=>journal.record(packet));
stream.seed(current);current={...current,content:'中😀尾',composing:true};stream.change(current,[{from:3,to:3,insert:'尾'}]);
const restored:RecoverySnapshot[]=[];
await recoveryJournal(storage,'other-workspace').restore(async snapshot=>{restored.push(snapshot)});
assert.equal(restored.length,0,'isolated --data workspace');
await journal.restore(async snapshot=>{restored.push(snapshot)});
assert.deepEqual(restored,[current]);stream.dispose();
// Exercise the actual app changed callback: the first edit can compact a
// blocked queue of position packets. Its full snapshot must remain pending.
const app=ts.createSourceFile('app.ts',readFileSync(new URL('../src/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const changed=app.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='changed');assert(changed);
const callbackCode=ts.transpileModule(changed.getText(app),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const blockedJournal=recoveryJournal(storage,'blocked');let blockedSnapshot={...snapshot,content:'saved'};
const invoke=new Function('createRecoveryStream','journal','snapshot',`
 let dirty=false,generation=0,loading=false,doc={id:snapshot.id},desktop=true,compositionActive=false,timer;
 const noop=()=>{},position=()=>snapshot.position,sidebarSearch={contentPending:noop},header=noop,scheduleWordCount=noop,updateHeading=noop,
 documentFind={changed:noop},preview={changed:noop},scheduleOutline=noop,scheduleOutlineLayout=noop,clearTimeout=noop,setTimeout=()=>0,save=noop,syncPending=noop;
 const view={composing:false,state:{doc:{toString:()=>snapshot.content,lineAt:()=>({number:1})},selection:{main:{head:0}}}};
 const recovery=createRecoveryStream(()=>new Promise(()=>{}),()=>snapshot,packet=>journal.record(packet,packet.content===undefined||dirty||compositionActive));
 ${callbackCode}
 recovery.seed(snapshot);for(let i=0;i<64;i++)recovery.change({id:snapshot.id,position:snapshot.position,composing:false});
 snapshot.content='saved tail';changed(true,{iterChanges:callback=>callback(5,5,5,10,{toString:()=> ' tail'})});recovery.dispose();
`);
invoke(createRecoveryStream,blockedJournal,blockedSnapshot);
await blockedJournal.restore(async snapshot=>{assert.equal(snapshot.content,'saved tail')});
// Failed restoration retains durable bytes for a future launch.
journal.record({version:1,sequence:1,previous:0,...snapshot});
await assert.rejects(()=>journal.restore(async()=>{throw Error('disk')}));assert(values.size>0);
await journal.restore(async()=>{});assert.equal(values.size,0);
// A failed previous launch is retained while a new renderer journals edits.
journal.record({version:1,sequence:3,previous:0,...snapshot});
const nextJournal=recoveryJournal(storage,'workspace');
await assert.rejects(()=>nextJournal.restore(async()=>{throw Error('disk')}));
nextJournal.record({version:1,sequence:1,previous:0,...snapshot,content:'new launch'});
const both:string[]=[];await nextJournal.restore(async snapshot=>{both.push(snapshot.content)});
assert.deepEqual(both.sort(),['new launch',snapshot.content].sort());
// A missing localStorage write cannot turn later coordinates into fake text.
journal.record({version:1,sequence:4,previous:0,...snapshot});
journal.record({version:1,id:snapshot.id,sequence:6,previous:5,position:snapshot.position,composing:false,changes:[{from:1,to:1,insert:'bad'}]});
await assert.rejects(()=>journal.restore(async()=>{assert.fail('incomplete journal restored')}));
journal.record({version:1,sequence:7,previous:6,...snapshot});await journal.restore(async()=>{});
// Acknowledged normal save must not replay stale body after external changes.
journal.saved(snapshot,2);await journal.restore(async()=>{assert.fail('saved text replayed')});
// Full seeds are amortized; ordinary deltas never rewrite the large body.
const large={...snapshot,content:'a'.repeat(5*1024*1024)};
journal.record({version:1,sequence:1,previous:0,...large});written=0;
const start=performance.now();
for(let i=0;i<20;i++){const packet:RecoveryPacket={version:1,id:'doc',sequence:i+2,previous:i+1,position:snapshot.position,composing:false,changes:[{from:i,to:i,insert:'尾'}]};journal.record(packet)}
const elapsed=performance.now()-start;
assert(written<10_000,'per-key edits rewrote full document');assert(largestDelta<512);
assert(elapsed<50*Number(process.env.PERF_BUDGET_SCALE||1),'journal bookkeeping stalled edits');
let full='';await journal.restore(async snapshot=>{full=snapshot.content});assert.equal(full.length,large.content.length+20);
console.log(`PASS: undelivered IPC tail, IME, namespace, retry, stale-save protection; 20 deltas ${written} chars written, ${elapsed.toFixed(2)}ms (memory Storage)`);
