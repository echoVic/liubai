import type {EditorState} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';
import {frontMatterRange} from './editing';
import {unescapeAll} from 'markdown-it/lib/common/utils.mjs';

const referenceDefinitions=new WeakMap<EditorState['doc'],Map<string,string>>();
const referenceLabel=(label:string)=>unescapeAll(label).trim().replace(/\s+/g,' ').toUpperCase();
export function tableReferences(state:EditorState,from:number,to:number){
 let definitions=referenceDefinitions.get(state.doc);
 if(!definitions){
  definitions=new Map();const meta=frontMatterRange(state);
  syntaxTree(state).iterate({enter(node){
   if(meta&&node.from<meta.to&&node.name!=='Document')return false;
   if(node.name==='LinkReference'){
    const label=node.node.getChild('LinkLabel');if(label){const key=referenceLabel(state.sliceDoc(label.from+1,label.to-1));if(!definitions!.has(key))definitions!.set(key,state.sliceDoc(node.from,node.to))}
   }
   return /^(Document|Blockquote|BulletList|OrderedList|ListItem)$/.test(node.name);
  }});
  referenceDefinitions.set(state.doc,definitions);
 }
 const used=new Set<string>();
 syntaxTree(state).iterate({from,to,enter(node){
  if(node.name!=='Link'&&node.name!=='Image')return;
  const marks=node.node.getChildren('LinkMark');if(marks.some(mark=>state.sliceDoc(mark.from,mark.to)==='('))return false;
  const label=node.node.getChild('LinkLabel'),close=marks.find(mark=>state.sliceDoc(mark.from,mark.to)===']');
  const key=label&&label.to-label.from>2?state.sliceDoc(label.from+1,label.to-1):state.sliceDoc(marks[0]?.to??node.from,close?.from??node.to);
  used.add(referenceLabel(key));return false;
 }});
 return [...used].map(key=>definitions!.get(key)||'').filter(Boolean).join('\n\n');
}
