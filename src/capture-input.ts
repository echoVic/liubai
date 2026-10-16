type CaptureKey=Pick<KeyboardEvent,'key'|'code'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'|'isComposing'>;
export function captureKeyAction(e:CaptureKey,composing=false):'save'|'hide'|null{
 if(e.isComposing||composing)return null;
 if(e.key==='Escape')return 'hide';
 if(e.key==='Enter'&&e.metaKey)return 'save';
 return null;
}
export function recordCaptureShortcut(e:CaptureKey):string|null{
 if(e.isComposing||e.key==='Escape'||!(e.metaKey||e.ctrlKey||e.altKey))return null;
 let key='';
 if(/^Key[A-Z]$/.test(e.code))key=e.code.slice(3);
 else if(/^Digit[0-9]$/.test(e.code))key=e.code.slice(5);
 else if(e.code==='Space')key='Space';
 else if(/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key))key=e.key;
 else key=({Enter:'Enter',Tab:'Tab',Backspace:'Backspace',Delete:'Delete',Insert:'Insert',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown'} as Record<string,string>)[e.key]||({Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',Backquote:'`'} as Record<string,string>)[e.code]||'';
 if(!key)return null;
 return [...(e.ctrlKey?['Ctrl']:[]),...(e.altKey?['Alt']:[]),...(e.metaKey?['Cmd']:[]),...(e.shiftKey?['Shift']:[]),key].join('+');
}
export function displayCaptureShortcut(shortcut:string){return shortcut.replace(/Ctrl\+/g,'⌃').replace(/Alt\+/g,'⌥').replace(/Cmd\+/g,'⌘').replace(/Shift\+/g,'⇧')}
