import {mac,redoKeys} from './platform';
// The toolbar's keys, in platform.ts notation. The tooltips, the heading menu, All Commands and the key handler read them here.
export const shortcuts:Record<string,string>={undo:'Mod+Z',redo:redoKeys,paragraph:'Mod+0',h1:'Mod+1',h2:'Mod+2',h3:'Mod+3',h4:'Mod+4',h5:'Mod+5',h6:'Mod+6',bold:'Mod+B',italic:'Mod+I',underline:'Mod+U',strike:'Mod+Shift+X',highlight:'Mod+Shift+H',inlineCode:'Mod+E',ordered:'Mod+Shift+7',bullet:'Mod+Shift+8',task:'Mod+Shift+9',outdent:'Shift+Tab',indent:'Tab',link:'Mod+L',find:'Mod+F',source:'Mod+Shift+M'};
// CodeMirror and the native menu handle undo, redo, find, the source view and list indents; the key handler matches the rest.
const matched=['paragraph','h1','h2','h3','h4','h5','h6','bold','italic','underline','strike','highlight','inlineCode','ordered','bullet','task','link'];
type Keys=Pick<KeyboardEvent,'key'|'code'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'>;
// Mod is ⌘ on macOS and Ctrl elsewhere. Shift must agree and Alt stays up, as Ctrl+Alt is AltGr on Windows.
// Letters go by the character typed, digits by the key, because Shift+7 types &; keypad digits do not count.
export function shortcutAction(e:Keys,{macOS=mac}:{macOS?:boolean}={}):string|undefined{
 if(e.altKey||(macOS?!e.metaKey||e.ctrlKey:!e.ctrlKey||e.metaKey))return;
 const key=/^Digit(\d)$/.exec(e.code)?.[1]||(/^[a-z]$/i.test(e.key)?e.key.toUpperCase():'');
 const keys=(e.shiftKey?'Mod+Shift+':'Mod+')+key;
 return key?matched.find(id=>shortcuts[id]===keys):undefined;
}
// The same keys as aria-keyshortcuts names them: Meta+Shift+X on macOS, Control+Shift+X elsewhere.
export function ariaKeys(keys:string,{macOS=mac}:{macOS?:boolean}={}){return keys.split('+').map(part=>part==='Mod'?(macOS?'Meta':'Control'):part).join('+')}
