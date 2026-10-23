import list from './themes.json';
import type {Appearance} from './types';
export const themeIDs=['dawn','paper','warm','lamp','ink','moon','mist','lotus','autumn','moonwhite','indigo'] as const;
export type ThemeID=typeof themeIDs[number];
export type AutoSwitch='off'|'system'|'hours'|'seasons';
export interface ThemeSpec {id:ThemeID;series:'hours'|'seasons';dark:boolean;hours?:[number,number];season?:'spring'|'summer'|'autumn'|'winter'|'night'}
export const themes=list as ThemeSpec[];
const known=(id:unknown):id is ThemeID=>themes.some(t=>t.id===id);
export const isDark=(id:string)=>themes.some(t=>t.id===id&&t.dark);
export function hoursTheme(hour:number):ThemeID{for(const t of themes)if(t.hours){const [from,to]=t.hours;if(from<to?hour>=from&&hour<to:hour>=from||hour<to)return t.id}return 'paper'}
// 立春, 立夏, 立秋 and 立冬: the month and the 21st-century C of ⌊Y×0.2422+C⌋−L, checked against the Sun's longitude for 2026–2050.
const terms:[number,number][]=[[1,3.87],[4,5.52],[7,7.5],[10,7.438]];
export function termDay(year:number,term:0|1|2|3){const y=year%100;return Math.floor(y*0.2422+terms[term][1])-Math.floor((term?y:y-1)/4)}
const seasonTheme=(season:ThemeSpec['season'])=>themes.find(t=>t.season===season)!.id;
export function seasonOf(now:Date):ThemeID{
 const y=now.getFullYear(),passed=(term:0|1|2|3)=>now>=new Date(y,terms[term][0],termDay(y,term));
 return seasonTheme(passed(3)||!passed(0)?'winter':passed(2)?'autumn':passed(1)?'summer':'spring');
}
export type ThemeChoice=Partial<Pick<Appearance,'theme'|'auto'|'lightTheme'|'darkTheme'|'followSystem'>>;
export function resolveTheme(p:ThemeChoice,now:Date,systemDark:boolean):ThemeID{
 const auto=p.auto||(p.followSystem?'system':'off');
 if(auto==='system')return systemDark?(known(p.darkTheme)&&isDark(p.darkTheme)?p.darkTheme:'ink'):(known(p.lightTheme)&&!isDark(p.lightTheme)?p.lightTheme:'paper');
 if(auto==='hours')return hoursTheme(now.getHours());
 if(auto==='seasons')return systemDark?seasonTheme('night'):seasonOf(now);
 return known(p.theme)?p.theme:'paper';
}
export function paintTheme(root:HTMLElement,id:ThemeID){const scheme=isDark(id)?'dark':'light';root.dataset.liubaiTheme=id;root.dataset.liubaiScheme=scheme;root.style.colorScheme=scheme}
// Calls update on the minute, when the window comes back and when the system appearance changes.
export function watchTheme(update:()=>void){const mq=matchMedia('(prefers-color-scheme:dark)');mq.addEventListener('change',update);addEventListener('focus',update);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update()});setInterval(update,60000);return mq}
