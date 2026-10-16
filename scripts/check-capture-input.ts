import assert from 'node:assert/strict';
import {captureKeyAction,recordCaptureShortcut,displayCaptureShortcut} from '../src/capture-input';
const key=(key:string,extra:object={})=>({key,code:key.length===1?'Key'+key.toUpperCase():key,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,isComposing:false,...extra});
assert.equal(captureKeyAction(key('Enter')),null);
assert.equal(captureKeyAction(key('Enter',{metaKey:true})),'save');
assert.equal(captureKeyAction(key('Escape')),'hide');
for(const composing of [false,true]){
 for(const name of ['Enter','Escape'])assert.equal(captureKeyAction(key(name,{metaKey:true,isComposing:!composing}),composing),null);
}
assert.equal(recordCaptureShortcut(key('n',{ctrlKey:true,altKey:true,metaKey:true})),'Ctrl+Alt+Cmd+N');
// Option changes event.key on macOS; use the physical key for letters.
assert.equal(recordCaptureShortcut(key('˜',{code:'KeyN',altKey:true})),'Alt+N');
assert.equal(recordCaptureShortcut(key('N',{shiftKey:true})),null);
assert.equal(recordCaptureShortcut(key('Meta',{metaKey:true})),null);
assert.equal(recordCaptureShortcut(key('Escape',{metaKey:true})),null);
assert.equal(recordCaptureShortcut(key('Enter',{metaKey:true,isComposing:true})),null);
assert.equal(recordCaptureShortcut(key(' ',{code:'Space',ctrlKey:true})),'Ctrl+Space');
assert.equal(displayCaptureShortcut('Ctrl+Alt+Cmd+N'),'⌃⌥⌘N');
assert.equal(displayCaptureShortcut('Alt+Shift+Space'),'⌥⇧Space');
console.log('随手记按键、IME 防护与快捷键录制检查通过');
