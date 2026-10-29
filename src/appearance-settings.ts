import {messages} from './i18n';
import type {Appearance} from './types';
import {icon} from './icons';
import {themes,type ThemeID,type AutoSwitch} from './theme';

const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>Array.from(document.querySelectorAll<HTMLElement>(s));
const node=(tag:string,text='')=>{const n=document.createElement(tag);n.textContent=text;return n};

export function themeText(id:ThemeID):[string,string,string]{
 const m=messages,text:Record<ThemeID,[string,string,string]>={dawn:[m.fDawn(),m.fDawnCaption(),m.fHourMao()],paper:[m.fPaper(),m.fPaperCaption(),m.fHourWu()],warm:[m.fWarm(),m.fWarmCaption(),m.fHourShen()],lamp:[m.fLamplight(),m.fLamplightCaption(),m.fHourXu()],ink:[m.fInk(),m.fInkCaption(),m.fHourHai()],moon:[m.fMoonlight(),m.fMoonlightCaption(),m.fHourZi()],mist:[m.fMist(),m.fMistCaption(),m.fSpring()],lotus:[m.fLotus(),m.fLotusCaption(),m.fSummer()],autumn:[m.fAutumn(),m.fAutumnCaption(),m.fAutumnSeason()],moonwhite:[m.fMoonWhite(),m.fMoonWhiteCaption(),m.fWinter()],indigo:[m.fIndigo(),m.fIndigoCaption(),m.fNight()]};return text[id];
}

// The browser fallback owns its controls; the editor only applies preferences.
export function appearanceSettings(get:()=>Appearance,currentTheme:()=>ThemeID,save:(change:Partial<Appearance>)=>Promise<void>){
 let hover:ThemeID|undefined;
 function caption(series:'hours'|'seasons'){
  const hovered=themes.find(t=>t.id===hover&&t.series===series),id=hovered?.id||themes.find(t=>t.id===currentTheme()&&t.series===series)?.id;
  $(`[data-caption=${series}]`).textContent=id?themeText(id)[0]+' · '+themeText(id)[1]:'';
 }
 function render(){
  const p=get(),current=currentTheme(),order=themes.map(t=>t.id),hours=themes.filter(t=>t.series==='hours').length,focused=document.activeElement?.closest('#themes')?(document.activeElement as HTMLElement).dataset.theme:'';
  $<HTMLSelectElement>('#font-size').value=String(p.fontSize||18);
  $<HTMLSelectElement>('#line-width').value=p.lineWidth||'normal';
  for(const series of ['hours','seasons'] as const){
   const row=$(`[data-series=${series}]`);row.replaceChildren();
   for(const t of themes.filter(t=>t.series===series)){
    const [name,,tag]=themeText(t.id),b=node('button');b.className='theme-option';b.dataset.theme=t.id;b.dataset.liubaiTheme=t.id;b.setAttribute('role','radio');b.setAttribute('aria-label',name);b.setAttribute('aria-checked',String(t.id===current));b.tabIndex=t.id===current?0:-1;
    b.append(...series==='hours'?[node('b',tag),node('span',name)]:[node('b',name),node('span',tag)]);
    if(t.id===current){const check=icon('check');check.classList.add('theme-check');b.append(check)}
    b.onclick=()=>{void save({theme:t.id,auto:'off'}).then(()=>$(`#themes [data-theme=${t.id}]`).focus())};
    b.onpointerenter=b.onfocus=()=>{hover=t.id;caption(series)};b.onpointerleave=b.onblur=()=>{hover=undefined;caption(series)};
    b.onkeydown=e=>{
     const i=order.indexOf(t.id);let n=-1;
     if(e.key==='ArrowRight')n=(i+1)%order.length;if(e.key==='ArrowLeft')n=(i+order.length-1)%order.length;if(e.key==='Home')n=0;if(e.key==='End')n=order.length-1;
     if(e.key==='ArrowDown'||e.key==='ArrowUp'){const seasons=order.length-hours;n=i<hours?hours+Math.round((i+.5)/hours*seasons-.5):Math.round((i-hours+.5)/seasons*hours-.5)}
     if(n>=0){e.preventDefault();$(`#themes [data-theme=${order[n]}]`).focus()}
    };
    row.append(b);
   }
   caption(series);
  }
  if(focused)$(`#themes [data-theme=${focused}]`).focus();
  $$('[data-auto]').forEach(b=>{const on=b.dataset.auto===p.auto;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1});
  $('#auto-note').textContent={off:messages.fAlwaysUseTheSelectedTheme(),system:messages.fChooseAThemeForLightAndDarkMode(),hours:messages.fHoursSchedule(),seasons:messages.fSeasonsSchedule()}[p.auto];
  $('.system-themes').hidden=p.auto!=='system';
  for(const [select,dark,value] of [[$<HTMLSelectElement>('#light-theme'),false,p.lightTheme],[$<HTMLSelectElement>('#dark-theme'),true,p.darkTheme]] as const){
   select.replaceChildren(...themes.filter(t=>t.dark===dark).map(t=>{const o=document.createElement('option');o.textContent=themeText(t.id)[0];o.value=t.id;return o}));select.value=value;
  }
 }
 $$('[data-auto]').forEach((b,i,all)=>{
  b.onclick=()=>void save({auto:b.dataset.auto as AutoSwitch,theme:currentTheme()});
  b.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=all[(i+(e.key==='ArrowRight'?1:all.length-1))%all.length];next.click();next.focus()}};
 });
 $('#light-theme').onchange=()=>void save({lightTheme:$<HTMLSelectElement>('#light-theme').value as ThemeID});
 $('#dark-theme').onchange=()=>void save({darkTheme:$<HTMLSelectElement>('#dark-theme').value as ThemeID});
 $('#font-size').onchange=()=>void save({fontSize:Number($<HTMLSelectElement>('#font-size').value)});
 $('#line-width').onchange=()=>void save({lineWidth:$<HTMLSelectElement>('#line-width').value as Appearance['lineWidth']});
 return {render};
}
