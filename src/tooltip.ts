import {keyLabel} from './platform';
import {onPageLocaleChange} from './i18n';
// One tooltip for the chrome: data-tip names a control and data-shortcut holds its keys, written for this platform as it shows.
// The pointer waits 500ms; within 800ms of the last tooltip the next control shows at once. Moving focus with Tab or the arrow keys shows it at once; any other key hides it, so Escape or Enter never brings it back on the focus they hand back.
const delay=500,warm=800,navigation=['Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'],modifiers=['Shift','Control','Alt','Meta','CapsLock'];
export function attachTooltips(){
 const tip=document.createElement('div'),label=document.createElement('span'),keys=document.createElement('kbd');
 tip.id='tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;tip.append(label,keys);document.body.append(tip);
 let shown:HTMLElement|null=null,pending:HTMLElement|null=null,pressed:HTMLElement|null=null,timer=0,closed=-Infinity,navigating=false;
 const control=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('[data-tip]'):null;
 function open(el:HTMLElement){
  clearTimeout(timer);pending=null;
  if(!el.isConnected||el.closest('[hidden]')||el.getAttribute('aria-expanded')==='true'||document.body.classList.contains('printing'))return;
  shown?.removeAttribute('aria-describedby');shown=el;el.setAttribute('aria-describedby',tip.id);
  label.textContent=el.dataset.tip||'';keys.textContent=el.dataset.shortcut?keyLabel(el.dataset.shortcut):'';tip.hidden=false;
  // Under the control, or above it where the window ends first; never closer than 8px to an edge.
  const r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight,below=r.bottom+6;
  tip.style.left=Math.max(8,Math.min(r.left+r.width/2-w/2,innerWidth-w-8))+'px';tip.style.top=Math.max(8,below+h>innerHeight-8?r.top-6-h:below)+'px';
 }
 function close(){clearTimeout(timer);pending=null;if(!shown)return;shown.removeAttribute('aria-describedby');shown=null;tip.hidden=true;closed=Date.now()}
 // A control re-rendered under the tooltip leaves no event behind, so the tooltip goes with it.
 const stale=()=>{if(shown&&!shown.isConnected)close()};
 document.addEventListener('pointerover',e=>{
  stale();
  const el=control(e.target);if(!el||el===shown||el===pending||el===pressed||e.pointerType!=='mouse'&&e.pointerType!=='pen')return;
  if(shown||Date.now()-closed<warm){open(el);return}
  clearTimeout(timer);pending=el;timer=window.setTimeout(()=>open(el),delay);
 });
 document.addEventListener('pointerout',e=>{
  stale();
  const el=control(e.target);if(!el||el.contains(e.relatedTarget as Node|null))return;
  if(el===pressed)pressed=null;if(el===pending){clearTimeout(timer);pending=null}if(el===shown)close();
 });
 // A press hides the tooltip until the pointer leaves that control.
 document.addEventListener('pointerdown',e=>{pressed=control(e.target);close()},true);
 document.addEventListener('focusin',e=>{const el=control(e.target);if(navigating&&el?.matches(':focus-visible'))open(el)});
 document.addEventListener('focusout',e=>{if(control(e.target)===shown)close()});
 // Any key but a modifier hides it; only focus moved by Tab, the arrows, Home or End shows it again.
 document.addEventListener('keydown',e=>{if(modifiers.includes(e.key))return;close();navigating=navigation.includes(e.key);setTimeout(()=>{navigating=false})},true);
 document.addEventListener('scroll',close,{capture:true,passive:true});
 addEventListener('resize',close);addEventListener('blur',close);onPageLocaleChange(close);
}
