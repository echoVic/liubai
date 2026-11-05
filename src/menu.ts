// Reusable menu-button keyboard and dismissal behaviour; actions belong to the caller.
// Physical input modality: a prevented pointerdown (format bar, block grip) keeps the
// keyboard modality alive, so programmatic item focus would paint a bogus focus ring.
// Pointer opens focus the menu container (it has no ring style); keys focus the first item.
let pointerUse=false,modalityTracked=false;
function trackModality(){if(modalityTracked)return;modalityTracked=true;document.addEventListener('pointerdown',()=>{pointerUse=true},{capture:true,passive:true});document.addEventListener('keydown',()=>{pointerUse=false},{capture:true,passive:true})}
export function attachMenu(button:HTMLElement,menu:HTMLElement,onSelect:(id:string)=>void){
 const controller=new AbortController(),signal=controller.signal;
 trackModality();if(!menu.hasAttribute('tabindex'))menu.setAttribute('tabindex','-1');
 const items=()=>Array.from(menu.querySelectorAll<HTMLElement>('[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]')).filter(el=>el.closest('[role=menu]')===menu&&!el.hidden&&el.getAttribute('aria-disabled')!=='true'&&!(el instanceof HTMLButtonElement&&el.disabled));
 function position(){const r=button.getBoundingClientRect(),room=innerWidth-menu.offsetWidth-8;if(menu.parentElement?.closest('[role=menu]')){menu.style.top=Math.max(8,Math.min(r.top,innerHeight-menu.offsetHeight-8))+'px';menu.style.right='auto';menu.style.left=Math.max(8,Math.min(r.right+6<=room?r.right+6:r.left-menu.offsetWidth-6,room))+'px';return}menu.style.top=Math.max(8,Math.min(r.bottom+6,innerHeight-menu.offsetHeight-8))+'px';if(r.left+r.width/2<innerWidth/2){menu.style.right='auto';menu.style.left=Math.max(8,Math.min(r.left,room))+'px'}else{menu.style.left='auto';menu.style.right=Math.max(8,Math.min(innerWidth-r.right,room))+'px'}}
 function close(restore=false){menu.hidden=true;button.setAttribute('aria-expanded','false');for(const sub of menu.querySelectorAll<HTMLElement>('[role=menu]'))sub.hidden=true;for(const trigger of menu.querySelectorAll<HTMLElement>('[aria-haspopup=menu]'))trigger.setAttribute('aria-expanded','false');if(restore)button.focus()}
 function open(){menu.hidden=false;button.setAttribute('aria-expanded','true');position();if(pointerUse)menu.focus({preventScroll:true});else items()[0]?.focus()}
 button.addEventListener('click',()=>{if(menu.hidden)open();else close(true)},{signal});
 button.addEventListener('keydown',e=>{if(['Enter',' ','ArrowDown'].includes(e.key)&&!(e.key==='ArrowDown'&&button.closest('[role=menu]'))){e.preventDefault();e.stopPropagation();open()}},{signal});
 menu.addEventListener('keydown',e=>{
  const all=items(),index=all.indexOf(document.activeElement as HTMLElement);let next=-1;
  if(e.key==='ArrowDown')next=(index+1)%all.length;if(e.key==='ArrowUp')next=(index+all.length-1)%all.length;if(e.key==='Home')next=0;if(e.key==='End')next=all.length-1;
  if(next>=0){e.preventDefault();e.stopPropagation();all[next]?.focus()}
  if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();all[index]?.click()}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true)}
  if(e.key==='Tab')close(true);
 },{signal});
 menu.addEventListener('click',e=>{const item=(e.target as HTMLElement).closest<HTMLElement>('[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]');if(!item||!items().includes(item))return;const id=item.dataset.menuAction;if(id){if(item.getAttribute('aria-haspopup')!=='menu')close(true);onSelect(id)}},{signal});
 document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target as Node)&&!button.contains(e.target as Node))close()},{signal});
 document.addEventListener('focusin',e=>{if(!menu.hidden&&!menu.contains(e.target as Node)&&!button.contains(e.target as Node))close()},{signal});
 window.addEventListener('resize',()=>{if(!menu.hidden)position()},{signal});
 return {open,close,destroy(){close();controller.abort()}};
}
