// Key names follow the platform, as CodeMirror decides what Mod- means.
const platform=typeof navigator==='undefined'?'':navigator.platform||'';
export const mac=/Mac|iPhone|iPad|iPod/.test(platform);
export const windows=/^Win/.test(platform);
const macKeys:Record<string,string>={Mod:'⌘',Cmd:'⌘',Ctrl:'⌃',Alt:'⌥',Shift:'⇧',Enter:'↩'};
const otherKeys:Record<string,string>={Mod:'Ctrl',Cmd:'Win'};
// Names a shortcut such as Mod+Shift+R, or a MyGo accelerator such as
// Ctrl+Alt+Cmd+N: ⌘⇧R on macOS (⌘ ⇧ R spaced), Ctrl+Shift+R elsewhere.
export function keyLabel(keys:string,{spaced=false,macOS=mac}:{spaced?:boolean;macOS?:boolean}={}){
 const parts=keys.endsWith('++')?[...keys.slice(0,-2).split('+'),'+']:keys.split('+');
 return macOS?parts.map(p=>macKeys[p]||p).join(spaced?' ':''):parts.map(p=>otherKeys[p]||p).join('+');
}
// Microsoft Pinyin and Sogou switch to Traditional Chinese on Ctrl+Shift+F, so
// focus mode is F8 off macOS, as in Typora; redo is Ctrl+Y there.
export const focusKeys=mac?'Mod+Shift+F':'F8';
export const redoKeys=mac?'Mod+Shift+Z':'Mod+Y';
