export interface RecoveryChange {from:number;to:number;insert:string}
export interface RecoverySnapshot {id:string;content:string;position:{anchor:number;head:number;scroll:number};composing:boolean}
export interface RecoveryPacket extends Omit<RecoverySnapshot,'content'> {version:1;sequence:number;previous:number;content?:string;changes?:RecoveryChange[]}

// One IPC flight; normal edits carry small deltas. A transport failure reseeds
// from the latest editor text, never retries an old snapshot over newer edits.
export function createRecoveryStream(send:(packet:RecoveryPacket)=>Promise<unknown>,current:()=>RecoverySnapshot,record:(packet:RecoveryPacket)=>void=()=>{}){
 let sequence=0,previous=0,flight=false,queue:RecoveryPacket[]=[],disposed=false,retry:ReturnType<typeof setTimeout>|undefined;
 const sequences=new Map<string,number>();
 const packet=(snapshot:RecoverySnapshot,full:boolean,changes?:RecoveryChange[]):RecoveryPacket=>{
  const next=++sequence,prev=sequences.get(snapshot.id)||0;sequences.set(snapshot.id,next);previous=next;
  const value:RecoveryPacket={version:1,id:snapshot.id,sequence:next,previous:prev,position:snapshot.position,composing:snapshot.composing,...(full?{content:snapshot.content}:{changes})};
  record(value);return value;
 };
 async function flush(){
  if(flight||disposed)return;flight=true;
  try{
   while(queue.length&&!disposed){
    const next=queue.shift()!;
    try{await send(next)}catch{queue=[];const latest=current();queue.push(packet(latest,true));retry=setTimeout(()=>void flush(),250);break}
   }
  }finally{flight=false}
 }
 return {
  seed(snapshot:RecoverySnapshot){queue.push(packet(snapshot,true));void flush()},
  change(snapshot:Omit<RecoverySnapshot,'content'>,changes:RecoveryChange[]=[]){
   // Changes are sent in call order; the backend applies coordinates against
   // the previous accepted editor state. No full-text copy on each edit.
   queue.push(packet({...snapshot,content:''},false,changes));
   if(queue.length>64){queue=[packet(current(),true)]}
   void flush();
  },
  sequence:()=>previous,
  dispose(){disposed=true;queue=[];clearTimeout(retry)},
 };
}
