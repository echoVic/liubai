import type {RecoveryPacket,RecoverySnapshot} from './session-recovery';

interface Journal {version:1;snapshot:RecoverySnapshot;sequence:number;pending:boolean}
// WebView localStorage is persistent in production. Store small deltas before
// IPC; its persistence still has the WebView's normal-session/power-loss limits.
export function recoveryJournal(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>,namespace:string){
 const prefix=`liubai-recovery-v1:${namespace}:`;
 // A new renderer never overwrites an earlier launch whose restoration failed.
 const runPrefix=prefix+Date.now().toString(36)+Math.random().toString(36).slice(2)+':';
 function keys(){return Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((key):key is string=>!!key&&key.startsWith(prefix))}
 function changes(group:string,sequence:number){return keys().filter(key=>key.startsWith(group+':delta:')).map(key=>({key,packet:JSON.parse(storage.getItem(key)!) as RecoveryPacket})).filter(item=>item.packet.sequence>sequence).sort((a,b)=>a.packet.sequence-b.packet.sequence)}
 function apply(journal:Journal,packets:RecoveryPacket[]):RecoverySnapshot{
  let content=journal.snapshot.content;
  let snapshot=journal.snapshot;
  let sequence=journal.sequence;
  for(const packet of packets){
   if(packet.id!==snapshot.id||packet.previous!==sequence)throw Error('incomplete recovery journal');
   if(packet.content!==undefined)content=packet.content;
   else for(const change of [...packet.changes||[]].reverse()){
    if(!Number.isInteger(change.from)||!Number.isInteger(change.to)||change.from<0||change.to<change.from||change.to>content.length)throw Error('invalid recovery journal');
    content=content.slice(0,change.from)+change.insert+content.slice(change.to);
   }
   snapshot={id:packet.id,content,position:packet.position,composing:packet.composing};
   sequence=packet.sequence;
  }
  return {...snapshot,content};
 }
 function read(key:string):Journal{
  const journal=JSON.parse(storage.getItem(key)||'null') as Journal;
  if(journal?.version!==1||typeof journal.snapshot?.content!=='string'||!Number.isInteger(journal.sequence))throw Error('invalid recovery journal');
  return journal;
 }
 function seed(snapshot:RecoverySnapshot,sequence:number,pending:boolean){
  // Commit the new base first. A failed/quota-limited write leaves the previous
  // journal intact. Old deltas are harmless: restoration ignores <=sequence.
  storage.setItem(runPrefix+snapshot.id+':base',JSON.stringify({version:1,snapshot,sequence,pending} satisfies Journal));
  for(const key of keys())if(key.startsWith(runPrefix+snapshot.id+':delta:'))storage.removeItem(key);
 }
 return {
  record(packet:RecoveryPacket,pending=true){
   if(packet.content!==undefined){seed({id:packet.id,content:packet.content,position:packet.position,composing:packet.composing},packet.sequence,pending);return}
   const group=runPrefix+packet.id;
   storage.setItem(group+':delta:'+packet.sequence,JSON.stringify(packet));
   const count=keys().filter(key=>key.startsWith(group+':delta:')).length;
   if(count>=64){const journal=read(group+':base');seed(apply(journal,changes(group,journal.sequence).map(item=>item.packet)),packet.sequence,true)}
  },
  saved(snapshot:RecoverySnapshot,sequence:number){seed(snapshot,sequence,false)},
  async restore(send:(snapshot:RecoverySnapshot)=>Promise<unknown>){
   const failures:unknown[]=[];
   for(const key of keys().filter(key=>key.endsWith(':base'))){
    try{
     const journal=read(key),group=key.slice(0,-5),deltas=changes(group,journal.sequence);
     if(journal.pending||deltas.length)await send(apply(journal,deltas.map(item=>item.packet)));
     for(const delta of keys().filter(item=>item.startsWith(group+':delta:')))storage.removeItem(delta);storage.removeItem(key);
    }catch(error){failures.push(error)}
   }
   if(failures.length)throw new AggregateError(failures,'recovery journal retained for retry');
  },
 };
}
