import assert from 'node:assert/strict';
import {keyLabel,isReloadKey} from '../src/platform';
for(const [keys,macCompact,macSpaced,other] of [
 ['Mod+Shift+R','⌘⇧R','⌘ ⇧ R','Ctrl+Shift+R'],['Mod+\\','⌘\\','⌘ \\','Ctrl+\\'],['Mod+Enter','⌘↩','⌘ ↩','Ctrl+Enter'],
 ['Ctrl+Alt+Cmd+N','⌃⌥⌘N','⌃ ⌥ ⌘ N','Ctrl+Alt+Win+N'],['Ctrl++','⌃+','⌃ +','Ctrl++'],['Mod+Y','⌘Y','⌘ Y','Ctrl+Y'],['F8','F8','F8','F8'],
]){
 assert.equal(keyLabel(keys,{macOS:true}),macCompact,keys);
 assert.equal(keyLabel(keys,{macOS:true,spaced:true}),macSpaced,keys);
 assert.equal(keyLabel(keys,{macOS:false}),other,keys);
 assert.equal(keyLabel(keys,{macOS:false,spaced:true}),other,keys);
}
const key=(key:string,extra:object={})=>({key,ctrlKey:false,altKey:false,shiftKey:false,metaKey:false,...extra});
// Ctrl+Shift+R hard-reloads the quick note panel, which has no menu to take it; e.code finds R on a Russian layout.
for(const e of [key('F5'),key('F5',{ctrlKey:true}),key('F5',{shiftKey:true}),key('r',{ctrlKey:true}),key('R',{ctrlKey:true}),key('R',{ctrlKey:true,shiftKey:true}),key('к',{ctrlKey:true,code:'KeyR'})])assert.ok(isReloadKey(e),JSON.stringify(e));
// Ctrl+Alt is AltGr on many keyboards.
for(const e of [key('r'),key('r',{ctrlKey:true,altKey:true}),key('r',{metaKey:true}),key('F4',{altKey:true}),key('к',{code:'KeyR'})])assert.ok(!isReloadKey(e),JSON.stringify(e));
console.log('平台快捷键写法与刷新键检查通过');
