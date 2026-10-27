import assert from 'node:assert/strict';
import {shortcuts,shortcutAction,ariaKeys} from '../src/shortcuts';
import {keyLabel,redoKeys} from '../src/platform';
type Mods={metaKey?:boolean;ctrlKey?:boolean;altKey?:boolean;shiftKey?:boolean};
const press=(key:string,code:string,mods:Mods={})=>({key,code,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,...mods});
for(const macOS of [true,false]){
 const mod:Mods=macOS?{metaKey:true}:{ctrlKey:true},name=macOS?'macOS':'Windows',on=(e:ReturnType<typeof press>)=>shortcutAction(e,{macOS});
 for(const [id,key,code,shiftKey] of [['paragraph','0','Digit0',false],['h1','1','Digit1',false],['h2','2','Digit2',false],['h3','3','Digit3',false],['h4','4','Digit4',false],['h5','5','Digit5',false],['h6','6','Digit6',false],['bold','b','KeyB',false],['italic','i','KeyI',false],['underline','u','KeyU',false],['inlineCode','e','KeyE',false],['link','l','KeyL',false],['strike','X','KeyX',true],['highlight','H','KeyH',true],['ordered','&','Digit7',true],['bullet','*','Digit8',true],['task','(','Digit9',true]] as const)
  assert.equal(on(press(key,code,{...mod,shiftKey})),id,`${name} ${id}`);
 // Caps Lock, Playwright's lowercase Shift+x, and a French keyboard's unshifted & on the 1 key.
 assert.equal(on(press('I','KeyI',mod)),'italic',name);
 assert.equal(on(press('x','KeyX',{...mod,shiftKey:true})),'strike',name);
 assert.equal(on(press('&','Digit1',mod)),'h1',name);
 for(const [label,e] of [
  ['cut',press('x','KeyX',mod)],['Shift+E',press('E','KeyE',{...mod,shiftKey:true})],['Shift+I',press('I','KeyI',{...mod,shiftKey:true})],['Shift+1',press('!','Digit1',{...mod,shiftKey:true})],
  ['Alt+1',press('1','Digit1',{...mod,altKey:true})],['keypad 1',press('1','Numpad1',mod)],['no modifier',press('1','Digit1')],['Shift only',press('X','KeyX',{shiftKey:true})],
  ['both modifiers',press('1','Digit1',{metaKey:true,ctrlKey:true})],['the other platform\'s modifier',press('1','Digit1',macOS?{ctrlKey:true}:{metaKey:true})],
  ['undo',press('z','KeyZ',mod)],['find',press('f','KeyF',mod)],['source',press('M','KeyM',{...mod,shiftKey:true})],['save',press('s','KeyS',mod)],
 ] as const)assert.equal(on(e),undefined,`${name} ${label}`);
}
assert.equal(shortcutAction(press('1','Digit1',{ctrlKey:true,altKey:true}),{macOS:false}),undefined,'AltGr');
for(const [keys,macOS,other] of [['Mod+Shift+X','Meta+Shift+X','Control+Shift+X'],['Mod+0','Meta+0','Control+0'],['Mod+\\','Meta+\\','Control+\\'],['Shift+Tab','Shift+Tab','Shift+Tab']] as const){
 assert.equal(ariaKeys(keys,{macOS:true}),macOS,keys);assert.equal(ariaKeys(keys,{macOS:false}),other,keys);
}
for(const [id,macOS,other] of [['paragraph','⌘0','Ctrl+0'],['h6','⌘6','Ctrl+6'],['italic','⌘I','Ctrl+I'],['strike','⌘⇧X','Ctrl+Shift+X'],['highlight','⌘⇧H','Ctrl+Shift+H'],['inlineCode','⌘E','Ctrl+E'],['ordered','⌘⇧7','Ctrl+Shift+7'],['bullet','⌘⇧8','Ctrl+Shift+8'],['task','⌘⇧9','Ctrl+Shift+9'],['outdent','⇧Tab','Shift+Tab'],['indent','Tab','Tab'],['source','⌘⇧M','Ctrl+Shift+M']] as const){
 assert.equal(keyLabel(shortcuts[id],{macOS:true}),macOS,id);assert.equal(keyLabel(shortcuts[id],{macOS:false}),other,id);
}
assert.equal(shortcuts.redo,redoKeys);
assert.equal(keyLabel('Mod+1–6',{macOS:true}),'⌘1–6');assert.equal(keyLabel('Mod+1–6',{macOS:false}),'Ctrl+1–6');
console.log('格式快捷键检查通过');
