import {LanguageDescription} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {classHighlighter,highlightCode} from '@lezer/highlight';

// Least recently used, by language and text: split preview renders every block again after each pause. Bounded in
// entries and in characters, as one block may hold 100,000 of them.
const cache=new Map<string,string>();let cachedSize=0;
function remember(key:string,html:string){
 cache.set(key,html);cachedSize+=html.length;
 for(const [old,value] of cache){if(cache.size<=512&&cachedSize<=8_000_000)break;cache.delete(old);cachedSize-=value.length}
}
export async function highlightCodeBlocks(root:HTMLElement,isCurrent:()=>boolean):Promise<void> {
 for(const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')){
  if(!isCurrent())return;
  const text=code.textContent||'';
  const name=code.className.match(/(?:^|\s)language-(\S+)/)?.[1];
  if(!name||text.length>100000)continue;
  const description=LanguageDescription.matchLanguageName(languages,name,true);
  if(!description)continue;
  const key=description.name+'\n'+text,hit=cache.get(key);
  if(hit!==undefined){cache.delete(key);cache.set(key,hit);code.innerHTML=hit;continue}
  try{
   const support=await description.load();
   if(!isCurrent())return;
   const doc=code.ownerDocument;
   // A template serialises its fragment, which then moves into the block in one call however many tokens it holds.
   const holder=doc.createElement('template'),content=holder.content;
   highlightCode(text,support.language.parser.parse(text),classHighlighter,(value,classes)=>{
    if(classes){
     const span=doc.createElement('span');
     span.className=classes;
     span.textContent=value;
     content.append(span);
    }else content.append(doc.createTextNode(value));
   },()=>content.append(doc.createTextNode('\n')));
   remember(key,holder.innerHTML);code.replaceChildren(content);
  }catch{}
 }
}
