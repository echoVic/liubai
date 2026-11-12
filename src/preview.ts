import {renderMarkdown,type MarkdownRender} from './markdown';
import {anchorPrefix,installAnchors} from './headings';
import {highlightCodeBlocks} from './highlight';
import {messages,pageLocale} from './i18n';
import {icon} from './icons';

export interface PreviewControllerOptions {
 host: HTMLElement;
 scroll: HTMLElement;
 getContent: ()=>string;
 resolveImage: (documentID:string,destination:string)=>Promise<string|undefined>;
 openLink: (url:string)=>void;
}

export interface PreviewController {
 setVisible: (visible:boolean)=>void;
 setDocument: (documentID:string)=>boolean;
 changed: (content:boolean,line:number)=>void;
 jumpToLine: (line:number)=>void;
 composition: (active:boolean)=>void;
 refresh: ()=>void;
 preserveScroll: (update:()=>void)=>void;
 saved: ()=>void;
 dispose: ()=>void;
}

type LineRange={start:number;end:number};
type ViewAnchor={line:number;offset:number;scrollTop:number};
type ReaderBlockState={identity:string;text?:string;scrollLeft?:number;open?:boolean};

const rangeOf=(element:Element):LineRange|null=>{
 const start=Number((element as HTMLElement).dataset.line);
 const end=Number((element as HTMLElement).dataset.lineEnd);
 return Number.isFinite(start)&&Number.isFinite(end)?{start,end}:null;
};
const rangeKey=(range:LineRange|null|undefined)=>range?`${range.start}:${range.end}`:'';
const readerIdentity=(block:HTMLElement)=>{
 if(block.closest('.md-front-matter'))return 'properties';
 if(block instanceof HTMLDetailsElement)return block.querySelector('summary')?.textContent??'';
 if(block instanceof HTMLTableElement)return JSON.stringify([block.caption?.textContent,Array.from(block.rows[0]?.cells??[]).map(cell=>cell.textContent)]);
 return block.querySelector('code')?.className??'';
};
const codeStillMatches=(before:string,after:string)=>{
 if(before===after)return true;
 let start=0,end=0;
 while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
 // Typing within the existing code keeps its position; mostly replaced code
 // is new content and should begin at its left edge.
 return start+end>Math.min(before.length,after.length)/2;
};

export function createPreviewController(options:PreviewControllerOptions):PreviewController {
 let documentID='',visible=false,composing=false,dirty=false,missingImages=false;
 let renderGeneration=0,saveEpoch=0,retriedSaveEpoch=-1;
 let renderTimer:ReturnType<typeof setTimeout>|undefined;
 let followTimer:ReturnType<typeof setTimeout>|undefined;
 let pendingLine:number|undefined;
 let pendingJump:{id:string;line:number}|undefined;
 let current:MarkdownRender|undefined;
 let renderedDocumentID='';
 let renderedContent='';
 let followedRange='';
 const regionResize=new ResizeObserver(entries=>{
  for(const entry of entries){
   const region=entry.target.closest<HTMLElement>('.md-table-scroll');
   if(region)updateTableRegion(region);
   else if(entry.target instanceof HTMLPreElement)updateCodeRegion(entry.target);
  }
 });
 function updateCodeRegion(region:HTMLPreElement){
  const overflow=region.scrollWidth>region.clientWidth+1;
  region.tabIndex=overflow?0:-1;
  if(overflow){
   region.setAttribute('role','region');
   region.setAttribute('aria-label',messages.fScrollableContent(region.closest('.md-front-matter')?messages.fDocumentProperties():messages.fCodeBlock()));
  }else{
   region.removeAttribute('role');
   region.removeAttribute('aria-label');
  }
 }
 function updateTableRegion(region:HTMLElement){
  const overflow=region.scrollWidth>region.clientWidth+1;
  if(overflow){
   region.tabIndex=0;
   region.setAttribute('role','region');
   region.setAttribute('aria-label',messages.fScrollableTable(region.querySelector('caption')?.textContent?.trim()||messages.fTable()));
  }else{
   region.tabIndex=-1;
   region.removeAttribute('role');
   region.removeAttribute('aria-label');
  }
 }
 const readerKeys=(content:string,edit?:{from:number;end:number;delta:number})=>{
  const offsets=[0];
  for(let index=0;index<content.length;index++)if(content[index]==='\n')offsets.push(index+1);
  const keys=new Map<HTMLElement,string>(),counts=new Map<string,number>();
  for(const block of options.host.querySelectorAll<HTMLElement>('pre,table,details')){
   if(block.closest('.md-front-matter')){
    keys.set(block,`${block.tagName}:properties`);
    continue;
   }
   const mapped=block.closest<HTMLElement>('[data-line][data-line-end]');
   const range=mapped&&rangeOf(mapped);
   if(!range)continue;
   let start=offsets[range.start],end=offsets[range.end+1]??content.length;
   if(start===undefined)continue;
   while(end>start&&/\s/.test(content[end-1]))end--;
   if(edit){
    if(start>=edit.end){start+=edit.delta;end+=edit.delta}
    else if(end>edit.from){
     if(start>=edit.from||end<=edit.end)continue;
     end+=edit.delta;
    }
   }
   const key=`${block.tagName}:${start}:${end}`;
   const index=counts.get(key)??0;
   counts.set(key,index+1);
   keys.set(block,`${key}:${index}`);
  }
  return keys;
 };
 const keepReaderState=(content:string)=>{
  let from=0,oldEnd=renderedContent.length,newEnd=content.length;
  while(from<oldEnd&&from<newEnd&&renderedContent[from]===content[from])from++;
  while(oldEnd>from&&newEnd>from&&renderedContent[oldEnd-1]===content[newEnd-1]){oldEnd--;newEnd--}
  const states=new Map<string,ReaderBlockState>();
  if(renderedDocumentID===documentID)for(const [block,key] of readerKeys(renderedContent,{from,end:oldEnd,delta:newEnd-oldEnd})){
   const identity=readerIdentity(block);
   if(block instanceof HTMLDetailsElement)states.set(key,{identity,open:block.open});
   else states.set(key,{identity,text:block instanceof HTMLPreElement?block.textContent??'':undefined,scrollLeft:block instanceof HTMLTableElement?block.parentElement!.scrollLeft:block.scrollLeft});
  }
  const restored=new WeakSet<HTMLElement>();
  return ()=>{
   for(const [block,key] of readerKeys(content)){
    if(restored.has(block))continue;
    restored.add(block);
    const state=states.get(key);
    if(!state||state.identity!==readerIdentity(block))continue;
    if(state.text!==undefined&&!block.closest('.md-front-matter')&&!codeStillMatches(state.text,block.textContent??''))continue;
    if(block instanceof HTMLDetailsElement&&state.open!==undefined)block.open=state.open;
    else if(state.scrollLeft!==undefined)(block instanceof HTMLTableElement?block.parentElement!:block).scrollLeft=state.scrollLeft;
   }
  };
 };
 const decorateTables=()=>{
  for(const table of options.host.querySelectorAll<HTMLTableElement>('table')){
   const columns=Array.from(table.rows).reduce((max,row)=>Math.max(max,Array.from(row.cells).reduce((sum,cell)=>sum+cell.colSpan,0)),1);
   table.style.setProperty('--md-table-columns',String(columns));
   const region=document.createElement('div');
   region.className='md-table-scroll';
   table.replaceWith(region);
   region.append(table);
   updateTableRegion(region);
   regionResize.observe(region);
   regionResize.observe(table);
  }
 };
 const decorateCode=()=>{
  for(const block of options.host.querySelectorAll<HTMLPreElement>('pre')){
   updateCodeRegion(block);
   regionResize.observe(block);
  }
 };

 const mappedElements=()=>Array.from(options.scroll.querySelectorAll<HTMLElement>('[data-line][data-line-end]'));
 const elementForLine=(line:number)=>{
  let containing:HTMLElement|undefined;
  let preceding:HTMLElement|undefined;
  let following:HTMLElement|undefined;
  for(const element of mappedElements()){
   const range=rangeOf(element);
   if(!range)continue;
   if(line>=range.start&&line<=range.end){
    const current=containing&&rangeOf(containing);
    if(!current||range.end-range.start<=current.end-current.start)containing=element;
    continue;
   }
   if(range.start>line){
    if(!following||range.start<(rangeOf(following)?.start??Infinity))following=element;
   }
   if(range.end>line)continue;
   const current=preceding&&rangeOf(preceding);
   if(!current||range.end>current.end||(range.end===current.end&&range.start>=current.start))preceding=element;
  }
  return containing||preceding||following;
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
 const retryAfterSave=(epoch:number)=>{
  if(epoch<=retriedSaveEpoch)return;
  retriedSaveEpoch=epoch;
  if(visible&&!composing)render();
  else dirty=true;
 };
 const applyJump=()=>{
  if(!pendingJump||pendingJump.id!==documentID||!visible||composing||dirty)return;
  const target=elementForLine(pendingJump.line);if(!target)return;
  for(let parent:HTMLElement|null=target;parent&&parent!==options.scroll;parent=parent.parentElement){
   if(parent instanceof HTMLDetailsElement)parent.open=true;
  }
  followedRange=rangeKey(rangeOf(target));
  const viewport=options.scroll.getBoundingClientRect();
  options.scroll.scrollTo({top:Math.max(0,options.scroll.scrollTop+target.getBoundingClientRect().top-viewport.top-12),behavior:'auto'});
 };
 const render=()=>{
  clearTimeout(renderTimer);
  renderTimer=undefined;
  if(!visible||composing){dirty=true;return}
  const saved=anchor();
  const id=documentID;
  const content=options.getContent();
  const restoreReaderState=keepReaderState(content);
  const generation=++renderGeneration;
  const startedAtSaveEpoch=saveEpoch;
  let renderMissingImages=false;
  missingImages=false;
  const next=renderMarkdown(content,{
   external:'load',
   wikiLinks:'interactive',
   resolve:destination=>options.resolveImage(id,destination).catch(error=>{
    if(id===documentID&&generation===renderGeneration)renderMissingImages=true;
    throw error;
   }),
  });
  current?.dispose();
  regionResize.disconnect();
  current=next;
  renderedDocumentID=id;
  renderedContent=content;
  options.host.replaceChildren(next.root);
  installAnchors(options.host,anchorPrefix);
  void highlightCodeBlocks(next.root,()=>id===documentID&&generation===renderGeneration);
  decorateImages();
  decorateTables();
  restoreReaderState();
  decorateCode();
  restore(saved);
  dirty=false;
  applyJump();
  if(!pendingJump&&pendingLine!==undefined){
   const line=pendingLine;
   pendingLine=undefined;
   scheduleFollow(line);
  }
  void next.ready.then(()=>{
   if(id!==documentID||generation!==renderGeneration)return;
   // An invalid asynchronous diagram can introduce a fallback code block.
   restoreReaderState();
   decorateCode();
   missingImages=renderMissingImages;
   if(renderMissingImages&&saveEpoch>startedAtSaveEpoch){retryAfterSave(saveEpoch);return}
   applyJump();
   pendingJump=undefined;
  });
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
  pendingJump=undefined;
 };
 const click=(event:MouseEvent)=>{
  const link=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if(link){
   const href=link.getAttribute('href')||'';
   event.preventDefault();
   if(href.startsWith('#')){
    let id=href.slice(1);
    try{id=decodeURIComponent(id)}catch{}
    const target=Array.from(options.host.querySelectorAll<HTMLElement>('[id]')).find(h=>h.id===anchorPrefix+id||(/^H[1-6]$/.test(h.tagName)&&h.textContent===id));
    if(target){
     for(let parent:HTMLElement|null=target;parent&&parent!==options.host;parent=parent.parentElement){
      if(parent instanceof HTMLDetailsElement)parent.open=true;
     }
     if(target.tabIndex<0&&!target.hasAttribute('tabindex'))target.tabIndex=-1;
     target.focus({preventScroll:true});
     const viewport=options.scroll.getBoundingClientRect();
     options.scroll.scrollTo({top:Math.max(0,options.scroll.scrollTop+target.getBoundingClientRect().top-viewport.top-12),behavior:'auto'});
    }
    return;
   }
   options.openLink(href);
   return;
  }
  const image=(event.target as HTMLElement).closest<HTMLImageElement>('img.md-image[data-zoomable]');
  if(image&&!image.closest('a')){event.preventDefault();openViewer(image);}
 };
 // Standalone reader images are keyboard-operable: Enter/Space is the click equivalent.
 const imageKey=(event:KeyboardEvent)=>{
  const target=event.target;
  if(target instanceof HTMLImageElement&&target.matches('img.md-image[data-zoomable]')
     &&(event.key==='Enter'||event.key===' ')){
   event.preventDefault();
   openViewer(target);
  }
 };
 const scrollRegionKey=(event:KeyboardEvent)=>{
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!(event.target instanceof HTMLElement))return;
  const target=event.target;
  if(!(target instanceof HTMLPreElement)&&!target.classList.contains('md-table-scroll'))return;
  const delta=event.key==='ArrowRight'?40:event.key==='ArrowLeft'?-40:0;
  if(!delta||target.scrollWidth<=target.clientWidth+1)return;
  // WebKit can focus a <pre> without giving it native arrow-key scrolling.
  event.preventDefault();
  target.scrollLeft+=delta;
 };
 // Full-size image viewer. Downscaled column-width images (and 360px screens)
 // otherwise leave detail unreadable, with no pointer or keyboard recourse.
 let viewer:HTMLDialogElement|undefined,viewerImg:HTMLImageElement|undefined,viewerCaption:HTMLParagraphElement|undefined;
 const imageLabel=(label:string,alt:string)=>label+(alt?(pageLocale().startsWith('zh')?'：':': ')+alt:'');
 const localizeViewer=()=>{
  if(!viewer||!viewerImg)return;
  viewer.setAttribute('aria-label',messages.fViewImage());
  viewer.querySelector<HTMLButtonElement>('.reader-image-close')!.setAttribute('aria-label',messages.fClose());
  viewerImg.setAttribute('aria-label',imageLabel(messages.fImageOriginalSize(),viewerImg.alt));
 };
 const decorateImages=()=>{
  for(const img of options.host.querySelectorAll<HTMLImageElement>('img.md-image')){
   if(img.closest('a')||img.dataset.zoomable!==undefined)continue;
   img.dataset.zoomable='1';
   img.tabIndex=0;
   img.setAttribute('role','button');
   img.setAttribute('aria-label',imageLabel(messages.fViewImage(),img.alt));
  }
 };
 const ensureViewer=()=>{
  if(viewer)return viewer;
  const d=document.createElement('dialog');
  d.className='reader-image-viewer';
  d.setAttribute('aria-label',messages.fViewImage());
  const close=document.createElement('button');
  close.type='button';close.className='reader-image-close';close.setAttribute('aria-label',messages.fClose());
  close.append(icon('close'));
  const stage=document.createElement('div');stage.className='reader-image-stage';
  const full=document.createElement('img');full.className='reader-image-full';full.alt='';
  full.tabIndex=0;full.setAttribute('role','button');full.setAttribute('aria-pressed','false');
  stage.append(full);
  const caption=document.createElement('p');caption.className='reader-image-caption';caption.hidden=true;
  d.append(close,stage,caption);
  document.body.append(d);
  close.addEventListener('click',()=>d.close());
  d.addEventListener('click',event=>{if(event.target===d)d.close();});
  const toggleSize=()=>{
   full.setAttribute('aria-pressed',String(full.classList.toggle('is-actual')));
   stage.scrollLeft=stage.scrollTop=0;
  };
  full.addEventListener('click',event=>{event.stopPropagation();toggleSize()});
  full.addEventListener('keydown',event=>{
   if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();toggleSize()}
  });
  d.addEventListener('close',()=>{full.classList.remove('is-actual');full.setAttribute('aria-pressed','false');stage.scrollLeft=stage.scrollTop=0});
  viewer=d;viewerImg=full;viewerCaption=caption;
  return d;
 };
 const openViewer=(thumb:HTMLImageElement)=>{
  const d=ensureViewer();
  const source=thumb.currentSrc||thumb.src;
  if(viewerImg!.getAttribute('src')!==source)viewerImg!.setAttribute('src',source);
  viewerImg!.alt=thumb.alt||'';
  if(thumb.alt){viewerCaption!.textContent=thumb.alt;viewerCaption!.hidden=false;}
  else viewerCaption!.hidden=true;
  localizeViewer();
  d.showModal();
  d.querySelector<HTMLButtonElement>('.reader-image-close')!.focus();
 };
 options.scroll.addEventListener('wheel',cancelFollow,{passive:true});
 options.scroll.addEventListener('pointerdown',cancelFollow,{passive:true});
 options.scroll.addEventListener('keydown',cancelFollow);
 options.scroll.addEventListener('keydown',scrollRegionKey);
 options.scroll.addEventListener('keydown',imageKey);
 options.scroll.addEventListener('click',click);

 return {
  setVisible(next){
   visible=next;
   options.host.closest<HTMLElement>('#preview')!.hidden=!next;
   if(next&&(dirty||!current))render();
   else if(!next)cancelFollow();
  },
  setDocument(next){
   if(next===documentID)return false;
   documentID=next;
   renderGeneration++;
   saveEpoch=0;
   retriedSaveEpoch=-1;
   missingImages=false;
   followedRange='';
   pendingJump=undefined;
   pendingLine=undefined;
   options.scroll.scrollTop=0;
   dirty=true;
   if(visible)render();
   return true;
  },
  changed(content,line){
   if(content){pendingJump=undefined;scheduleRender()}
   else scheduleFollow(line);
  },
  jumpToLine(line){
   if(!Number.isInteger(line)||line<0)return;
   cancelFollow();
   pendingJump={id:documentID,line};
   if(visible&&!composing){
    if(dirty||!current)render();
    else{applyJump();const target=pendingJump,generation=renderGeneration;void current.ready.then(()=>{if(pendingJump!==target||generation!==renderGeneration)return;applyJump();pendingJump=undefined})}
   }
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
   localizeViewer();
   dirty=true;
   if(visible&&!composing)render();
  },
  preserveScroll(update){
   const saved=visible?anchor():undefined;
   cancelFollow();
   update();
   if(saved)restore(saved);
  },
  saved(){
   saveEpoch++;
   if(missingImages)retryAfterSave(saveEpoch);
  },
  dispose(){
   renderGeneration++;
   clearTimeout(renderTimer);
   clearTimeout(followTimer);
   current?.dispose();
   regionResize.disconnect();
   options.scroll.removeEventListener('wheel',cancelFollow);
   options.scroll.removeEventListener('pointerdown',cancelFollow);
   options.scroll.removeEventListener('keydown',cancelFollow);
   options.scroll.removeEventListener('keydown',scrollRegionKey);
   options.scroll.removeEventListener('keydown',imageKey);
   options.scroll.removeEventListener('click',click);
   if(viewer){viewer.close();viewer.remove();viewer=undefined;}
  },
 };
}
