import type {EditorState} from '@codemirror/state';
import {DocInput,language,syntaxTree} from '@codemirror/language';
import type {Tree} from '@lezer/common';
import {frontMatterRange} from './editing';
import {extraRanges} from './extras';
import {normalizeReference} from 'markdown-it/lib/common/utils.mjs';

const referenceDefinitions=new WeakMap<EditorState['doc'],{tree:Tree;definitions:Map<string,string>}>();
export function tableReferences(state:EditorState,from:number,to:number,includeFootnotes=false){
 let cached=referenceDefinitions.get(state.doc),tree=syntaxTree(state);
 const complete=()=>tree.length===state.doc.length?tree:state.facet(language)?.parser.parse(new DocInput(state.doc))??tree;
 if(tree.length<to)tree=cached?.tree??complete();
 const used=new Set<string>();
 const collect=(from:number,to:number)=>tree.iterate({from,to,enter(node){
  if(node.name!=='Link'&&node.name!=='Image')return;
  const marks=node.node.getChildren('LinkMark');if(marks.some(mark=>state.sliceDoc(mark.from,mark.to)==='('))return;
  const label=node.node.getChild('LinkLabel'),close=marks.find(mark=>state.sliceDoc(mark.from,mark.to)===']');
  const key=label&&label.to-label.from>2?state.sliceDoc(label.from+1,label.to-1):state.sliceDoc(marks[0]?.to??node.from,close?.from??node.to);
  used.add(normalizeReference(key));
 }});
 collect(from,to);
 const notesNeeded=includeFootnotes&&state.sliceDoc(from,to).includes('[^');
 // Plain cells and direct links need no document-wide definition scan.
 if(!used.size&&!notesNeeded)return '';
 if(!cached){
  tree=complete();
  const definitions=new Map<string,string>(),meta=frontMatterRange(state);
  tree.iterate({enter(node){
   if(meta&&node.from<meta.to&&node.name!=='Document')return false;
   if(node.name==='LinkReference'){
    const label=node.node.getChild('LinkLabel');if(label){const key=normalizeReference(state.sliceDoc(label.from+1,label.to-1));if(!definitions.has(key))definitions.set(key,state.sliceDoc(node.from,node.to))}
   }
   return /^(Document|Blockquote|BulletList|OrderedList|ListItem|WikiFootnote)$/.test(node.name);
  }});
  cached={tree,definitions};
  // Only complete trees may populate a cache keyed by the unchanged document text.
  if(tree.length===state.doc.length)referenceDefinitions.set(state.doc,cached);
 }
 tree=cached.tree;
 const notes:string[]=[];
 if(notesNeeded){
  const extras=extraRanges(state,tree),labels=new Set<string>();
  const collectNotes=(from:number,to:number)=>{for(const ref of extras.references)if(!ref.inline&&ref.from>=from&&ref.to<=to)labels.add(ref.label)};
  collectNotes(from,to);
  // A Set's iterator also visits notes discovered inside another definition, once per label.
  for(const label of labels){
   const definition=extras.definitions.get(label);if(!definition||definition.inline)continue;
   notes.push(state.sliceDoc(definition.from,definition.to));
   collect(definition.from,definition.to);collectNotes(definition.from,definition.to);
  }
 }
 return [...used].map(key=>cached!.definitions.get(key)||'').filter(Boolean).concat(notes).join('\n\n');
}
