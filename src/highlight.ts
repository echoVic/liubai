import {LanguageDescription} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {classHighlighter,highlightCode} from '@lezer/highlight';

export async function highlightCodeBlocks(root:HTMLElement,isCurrent:()=>boolean):Promise<void> {
 for(const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')){
  if(!isCurrent())return;
  const text=code.textContent||'';
  const name=code.className.match(/(?:^|\s)language-(\S+)/)?.[1];
  if(!name||text.length>100000)continue;
  const description=LanguageDescription.matchLanguageName(languages,name,true);
  if(!description)continue;
  try{
   const support=await description.load();
   if(!isCurrent())return;
   const doc=code.ownerDocument;
   const content=doc.createDocumentFragment();
   highlightCode(text,support.language.parser.parse(text),classHighlighter,(value,classes)=>{
    if(classes){
     const span=doc.createElement('span');
     span.className=classes;
     span.textContent=value;
     content.append(span);
    }else content.append(doc.createTextNode(value));
   },()=>content.append(doc.createTextNode('\n')));
   code.replaceChildren(content);
  }catch{}
 }
}
