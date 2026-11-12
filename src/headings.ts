// Heading anchors, shared by the editor's outline, the reading view and the exports.
// Inside the app a document's ids carry this prefix, as on GitHub, so that a heading such as "Toast" cannot take the place
// of the app's own #toast in lookups and style rules. A link to #toast still finds the heading.
export const anchorPrefix='user-content-';
export function headingSlug(text:string,used:Map<string,number>):string {
 const base=text.toLowerCase().replace(/[\p{P}\p{S}]/gu,'').trim().replace(/\s+/g,'-');
 const count=used.get(base)||0;
 used.set(base,count+1);
 return base+(count?`-${count}`:'');
}
// The text a reader sees, as the editor's outline reads it from the source: a formula counts once, by its TeX source,
// and footnote markers and missing-image notes do not count.
export function headingText(heading:Element):string{
 let text='';
 const walk=(node:Node)=>{for(const child of node.childNodes){
  if(child.nodeType===3)text+=child.nodeValue;
  else if(child.nodeType!==1)continue;
  else if((child as Element).matches('.math-inline,.math-display'))text+=(child as Element).querySelector('annotation[encoding="application/x-tex"]')?.textContent??child.textContent;
  else if(!(child as Element).matches('sup.footnote-ref,.markdown-image-note'))walk(child);
 }};
 walk(heading);return text.replace(/\s+/g,' ').trim();
}
// Gives each heading its slug. With a prefix, every other id of the document (footnotes, author HTML) moves out of the
// app's way too.
export function installAnchors(root:Element,prefix=''){
 if(prefix)for(const el of root.querySelectorAll('[id]'))if(el.id)el.id=prefix+el.id;
 const used=new Map<string,number>();
 for(const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6'))heading.id=prefix+headingSlug(headingText(heading),used);
}
// A standalone file has no app to make room for, so its anchors work from other pages too.
export function plainAnchors(root:HTMLElement):HTMLElement{
 const copy=root.cloneNode(true) as HTMLElement;
 for(const el of copy.querySelectorAll('[id]'))if(el.id.startsWith(anchorPrefix))el.id=el.id.slice(anchorPrefix.length);
 for(const link of copy.querySelectorAll('a[href^="#"]'))if(link.getAttribute('href')!.startsWith('#'+anchorPrefix))link.setAttribute('href','#'+link.getAttribute('href')!.slice(anchorPrefix.length+1));
 return copy;
}
