// Reusable menu-button keyboard and dismissal behaviour; actions belong to the caller.
export function attachMenu(button:HTMLElement,menu:HTMLElement,onSelect:(id:string)=>void){
 const items=()=>Array.from(menu.querySelectorAll<HTMLElement>('[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]')).filter(el=>!el.hidden&&el.getAttribute('aria-disabled')!=='true'&&!(el instanceof HTMLButtonElement&&el.disabled));
 function position(){const r=button.getBoundingClientRect();menu.style.top=(r.bottom+6)+'px';menu.style.right=Math.max(8,Math.min(innerWidth-r.right,innerWidth-menu.offsetWidth-8))+'px'}
 function close(restore=false){menu.hidden=true;button.setAttribute('aria-expanded','false');if(restore)button.focus()}
 function open(){menu.hidden=false;button.setAttribute('aria-expanded','true');position();items()[0]?.focus()}
 button.addEventListener('click',()=>{if(menu.hidden)open();else close(true)});
 button.addEventListener('keydown',e=>{if(['Enter',' ','ArrowDown'].includes(e.key)){e.preventDefault();open()}});
 menu.addEventListener('keydown',e=>{
  const all=items(),index=all.indexOf(document.activeElement as HTMLElement);let next=-1;
  if(e.key==='ArrowDown')next=(index+1)%all.length;if(e.key==='ArrowUp')next=(index+all.length-1)%all.length;if(e.key==='Home')next=0;if(e.key==='End')next=all.length-1;
  if(next>=0){e.preventDefault();all[next]?.focus()}
  if(e.key==='Enter'||e.key===' '){e.preventDefault();all[index]?.click()}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true)}
  if(e.key==='Tab')close(true);
 });
 menu.addEventListener('click',e=>{const item=(e.target as HTMLElement).closest<HTMLElement>('[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]');if(!item||!items().includes(item))return;const id=item.dataset.menuAction;if(id){close(true);onSelect(id)}});
 document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target as Node)&&!button.contains(e.target as Node))close()});
 document.addEventListener('focusin',e=>{if(!menu.hidden&&!menu.contains(e.target as Node)&&!button.contains(e.target as Node))close()});
 window.addEventListener('resize',()=>{if(!menu.hidden)position()});
 return {open,close};
}
