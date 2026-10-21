import assert from 'node:assert/strict';
import {keyLabel} from '../src/platform';
for(const [keys,macCompact,macSpaced,other] of [
 ['Mod+Shift+R','⌘⇧R','⌘ ⇧ R','Ctrl+Shift+R'],['Mod+\\','⌘\\','⌘ \\','Ctrl+\\'],['Mod+Enter','⌘↩','⌘ ↩','Ctrl+Enter'],
 ['Ctrl+Alt+Cmd+N','⌃⌥⌘N','⌃ ⌥ ⌘ N','Ctrl+Alt+Win+N'],['Ctrl++','⌃+','⌃ +','Ctrl++'],['Mod+Y','⌘Y','⌘ Y','Ctrl+Y'],['F8','F8','F8','F8'],
]){
 assert.equal(keyLabel(keys,{macOS:true}),macCompact,keys);
 assert.equal(keyLabel(keys,{macOS:true,spaced:true}),macSpaced,keys);
 assert.equal(keyLabel(keys,{macOS:false}),other,keys);
 assert.equal(keyLabel(keys,{macOS:false,spaced:true}),other,keys);
}
console.log('平台快捷键写法检查通过');
