import {renderMarkdown,type MarkdownRender} from './markdown';

export interface PreviewControllerOptions {
 host: HTMLElement;
 scroll: HTMLElement;
 getContent: ()=>string;
 resolveImage: (documentID:string,destination:string)=>Promise<string|undefined>;
 openLink: (url:string)=>void;
}

export interface PreviewController {
 setVisible: (visible:boolean)=>void;
 setDocument: (documentID:string)=>void;
 changed: (content:boolean,line:number)=>void;
 composition: (active:boolean)=>void;
 refresh: ()=>void;
 saved: ()=>void;
 dispose: ()=>void;
}

type LineRange={start:number;end:number};
type ViewAnchor={line:number;offset:number;scrollTop:number};

const rangeOf=(element:Element):LineRange|null=>{
 const start=Number((element as HTMLElement).dataset.line);
 const end=Number((element as HTMLElement).dataset.lineEnd);
 return Number.isFinite(start)&&Number.isFinite(end)?{start,end}:null;
};
const rangeKey=(range:LineRange|null|undefined)=>range?`${range.start}:${range.end}`:'';

export function createPreviewController(options:PreviewControllerOptions):PreviewController {
 let documentID='',visible=false,composing=false,dirty=false,missingImages=false;
 let renderTimer:ReturnType<typeof setTimeout>|undefined;
 let followTimer:ReturnType<typeof setTimeout>|undefined;
 let pendingLine:number|undefined;
 let current:MarkdownRender|undefined;
 let followedRange='';

 const mappedElements=()=>Array.from(options.scroll.querySelectorAll<HTMLElement>('[data-line][data-line-end]'));
 const elementForLine=(line:number)=>{
  let best:HTMLElement|undefined;
  for(const element of mappedElements()){
   const range=rangeOf(element);
   if(!range||line<range.start||line>range.end)continue;
   const bestRange=best&&rangeOf(best);
   if(!bestRange||range.end-range.start<=bestRange.end-bestRange.start)best=element;
  }
  return best;
 };
 const anchor=():ViewAnchor=>{
  const top=options.scroll.getBoundingClientRect().top;
  const element=mappedElements().find(candidate=>candidate.getBoundingClientRect().bottom>=top);
  const range=element&&rangeOf(element);
  return {
   line:range?.start??-1,
   offset:element?element.getBoundingClientRect().top-top:0,
   scrollTop:options.scroll.scrollTop,
  };
 };
 const restore=(saved:ViewAnchor)=>{
  options.scroll.scrollTop=saved.scrollTop;
  if(saved.line<0)return;
  const element=elementForLine(saved.line);
  if(!element)return;
  const top=options.scroll.getBoundingClientRect().top;
  options.scroll.scrollTop+=element.getBoundingClientRect().top-top-saved.offset;
 };
 const installHeadingAnchors=()=>{
  const used=new Map<string,number>();
  for(const heading of options.scroll.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')){
   const base=(heading.textContent||'').toLowerCase().replace(/[\p{P}\p{S}]/gu,'').trim().replace(/\s+/g,'-');
   const count=used.get(base)||0;
   used.set(base,count+1);
   heading.id=base+(count?`-${count}`:'');
  }
 };
 const render=()=>{
  clearTimeout(renderTimer);
  renderTimer=undefined;
  if(!visible||composing){dirty=true;return}
  const saved=anchor();
  const id=documentID;
  missingImages=false;
  const next=renderMarkdown(options.getContent(),{
   external:'load',
   resolve:destination=>options.resolveImage(id,destination).catch(error=>{
    if(id===documentID)missingImages=true;
    throw error;
   }),
  });
  current?.dispose();
  current=next;
  options.host.replaceChildren(next.root);
  installHeadingAnchors();
  restore(saved);
  dirty=false;
  if(pendingLine!==undefined){
   const line=pendingLine;
   pendingLine=undefined;
   scheduleFollow(line);
  }
 };
 const scheduleRender=()=>{
  dirty=true;
  clearTimeout(renderTimer);
  if(visible&&!composing)renderTimer=setTimeout(render,250);
 };
 const follow=(line:number)=>{
  if(!visible||composing)return;
  if(dirty||renderTimer!==undefined){pendingLine=line;return}
  const target=elementForLine(line);
  const range=target&&rangeOf(target);
  const key=rangeKey(range);
  if(!target||!key||key===followedRange)return;
  followedRange=key;
  const viewport=options.scroll.getBoundingClientRect();
  const box=target.getBoundingClientRect();
  if(box.top>=viewport.top+12&&box.bottom<=viewport.bottom-12)return;
  const top=options.scroll.scrollTop+box.top-viewport.top;
  const nearest=box.top<viewport.top?top-12:top-options.scroll.clientHeight+Math.min(box.height,options.scroll.clientHeight)+12;
  options.scroll.scrollTo({top:Math.max(0,nearest),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 };
 function scheduleFollow(line:number){
  clearTimeout(followTimer);
  followTimer=setTimeout(()=>follow(line),120);
 }
 const cancelFollow=()=>{
  clearTimeout(followTimer);
  followTimer=undefined;
  pendingLine=undefined;
 };
 const click=(event:MouseEvent)=>{
  const link=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if(!link)return;
  const href=link.getAttribute('href')||'';
  event.preventDefault();
  if(href.startsWith('#')){
   let id=href.slice(1);
   try{id=decodeURIComponent(id)}catch{}
   const target=Array.from(options.host.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(h=>h.id===id||h.textContent===id);
   if(target){
    const viewport=options.scroll.getBoundingClientRect();
    options.scroll.scrollTo({top:Math.max(0,options.scroll.scrollTop+target.getBoundingClientRect().top-viewport.top-12),behavior:'auto'});
   }
   return;
  }
  options.openLink(href);
 };
 options.scroll.addEventListener('wheel',cancelFollow,{passive:true});
 options.scroll.addEventListener('pointerdown',cancelFollow,{passive:true});
 options.scroll.addEventListener('keydown',cancelFollow);
 options.scroll.addEventListener('click',click);

 return {
  setVisible(next){
   visible=next;
   options.host.closest<HTMLElement>('#preview')!.hidden=!next;
   if(next&&(dirty||!current))render();
   else if(!next)cancelFollow();
  },
  setDocument(next){
   if(next===documentID)return;
   documentID=next;
   followedRange='';
   pendingLine=undefined;
   options.scroll.scrollTop=0;
   dirty=true;
   if(visible)render();
  },
  changed(content,line){
   if(content)scheduleRender();
   else scheduleFollow(line);
  },
  composition(active){
   composing=active;
   if(active){
    clearTimeout(renderTimer);
    renderTimer=undefined;
    cancelFollow();
   }else if(dirty)render();
  },
  refresh(){
   dirty=true;
   if(visible&&!composing)render();
  },
  saved(){
   if(missingImages)render();
  },
  dispose(){
   clearTimeout(renderTimer);
   clearTimeout(followTimer);
   current?.dispose();
   options.scroll.removeEventListener('wheel',cancelFollow);
   options.scroll.removeEventListener('pointerdown',cancelFollow);
   options.scroll.removeEventListener('keydown',cancelFollow);
   options.scroll.removeEventListener('click',click);
  },
 };
}
