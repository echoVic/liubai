import assert from 'node:assert/strict';
import {themes,themeIDs,isDark,hoursTheme,termDay,seasonOf,resolveTheme} from '../src/theme';
assert.deepEqual(themes.map(t=>t.id),[...themeIDs],'themes.json 与 themeIDs 一致');
assert.deepEqual(themes.filter(t=>t.dark).map(t=>t.id),['lamp','ink','moon','indigo']);
assert.ok(isDark('indigo')&&!isDark('lotus')&&!isDark('unknown'));
for(const [hour,id] of [[0,'moon'],[4,'moon'],[5,'dawn'],[8,'dawn'],[9,'paper'],[14,'paper'],[15,'warm'],[18,'warm'],[19,'lamp'],[20,'lamp'],[21,'ink'],[22,'ink'],[23,'moon']] as const)assert.equal(hoursTheme(hour),id,'hour '+hour);
// 立春、立夏、立秋、立冬：太阳视黄经到 315°、45°、135°、225° 的北京时间日期，与公式无关地单独算出。
const table='2026:0204 0505 0807 1107 2027:0204 0506 0808 1107 2028:0204 0505 0807 1107 2029:0203 0505 0807 1107 2030:0204 0505 0807 1107 2031:0204 0506 0808 1107 2032:0204 0505 0807 1107 2033:0203 0505 0807 1107 2034:0204 0505 0807 1107 2035:0204 0505 0807 1107 2036:0204 0505 0807 1107 2037:0203 0505 0807 1107 2038:0204 0505 0807 1107 2039:0204 0505 0807 1107 2040:0204 0505 0807 1107 2041:0203 0505 0807 1107 2042:0204 0505 0807 1107 2043:0204 0505 0807 1107 2044:0204 0505 0807 1107 2045:0203 0505 0807 1107 2046:0204 0505 0807 1107 2047:0204 0505 0807 1107 2048:0204 0505 0807 1107 2049:0203 0505 0807 1107 2050:0203 0505 0807 1107';
for(const row of table.split(/ (?=\d{4}:)/)){const [year,dates]=row.split(':');dates.split(' ').forEach((md,term)=>assert.equal(termDay(+year,term as 0|1|2|3),+md.slice(2),year+' '+term))}
const at=(y:number,m:number,d:number,h=12)=>new Date(y,m-1,d,h);
for(const [date,id] of [[at(2026,1,15),'moonwhite'],[at(2026,2,3,23),'moonwhite'],[at(2026,2,4,0),'mist'],[at(2026,5,4,23),'mist'],[at(2026,5,5,0),'lotus'],[at(2026,8,6,23),'lotus'],[at(2026,8,7,0),'autumn'],[at(2026,11,6,23),'autumn'],[at(2026,11,7,0),'moonwhite'],[at(2026,12,31),'moonwhite'],[at(2029,2,3,0),'mist']] as const)assert.equal(seasonOf(date),id,date.toString());
const noon=at(2026,10,22,12),night=at(2026,10,22,22);
assert.equal(resolveTheme({theme:'lotus',auto:'off'},noon,true),'lotus');
assert.equal(resolveTheme({theme:'lotus',auto:'system',lightTheme:'moonwhite',darkTheme:'lamp'},noon,false),'moonwhite');
assert.equal(resolveTheme({theme:'lotus',auto:'system',lightTheme:'moonwhite',darkTheme:'lamp'},noon,true),'lamp');
assert.equal(resolveTheme({auto:'system',lightTheme:'ink',darkTheme:'paper'},noon,false),'paper');
assert.equal(resolveTheme({auto:'system',lightTheme:'ink',darkTheme:'paper'},noon,true),'ink');
assert.equal(resolveTheme({theme:'lotus',auto:'hours'},night,true),'ink');
assert.equal(resolveTheme({auto:'seasons'},noon,false),'autumn');
assert.equal(resolveTheme({auto:'seasons'},noon,true),'indigo');
// 早于 auto 字段的设置（启动脚本可能读到）。
assert.equal(resolveTheme({theme:'ink',followSystem:true},noon,false),'paper');
assert.equal(resolveTheme({theme:'ink',followSystem:false},noon,false),'ink');
assert.equal(resolveTheme({},noon,false),'paper');
assert.equal(resolveTheme({theme:'unknown' as never,auto:'off'},noon,false),'paper');
console.log('主题解析检查通过');
