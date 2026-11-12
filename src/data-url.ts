// The page's CSP (connect-src 'self') blocks fetch() of data: URLs, so pasted images and the Word export decode them here.
// The Word export is bundled on its own, so this module imports nothing.
export function dataURLBytes(url:string):{type:string;bytes:Uint8Array<ArrayBuffer>}|null{
 const match=/^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(url);if(!match)return null;
 return {type:match[1],bytes:/;base64/i.test(match[2])?Uint8Array.from(atob(match[3].replace(/\s/g,'')),char=>char.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(match[3]))};
}
