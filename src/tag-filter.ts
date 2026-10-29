import {messages} from './i18n';
import type {TagSummary} from './types';

export function renderTagOptions(select:HTMLSelectElement,tags:TagSummary[],selected:string):void {
 const entries=tags.some(t=>t.name===selected)||!selected?tags:[...tags,{name:selected,count:0}];
 const values=[{name:'',text:messages.fAllTags()},...entries.map(t=>({name:t.name,text:messages.fTagCount(t.name,t.count)}))];
 const same=select.options.length===values.length&&values.every((v,i)=>select.options[i].value===v.name&&select.options[i].textContent===v.text);
 if(!same){
  const fragment=document.createDocumentFragment();
  for(const value of values){const option=document.createElement('option');option.value=value.name;option.textContent=value.text;fragment.append(option)}
  select.replaceChildren(fragment);
 }
 select.value=selected;
}

export function tagButtons(tags:string[],selected:string,choose:(tag:string)=>void,keyPrefix:string):DocumentFragment {
 const fragment=document.createDocumentFragment();
 const visible=tags.slice(0,3);
 if(tags.includes(selected)&&!visible.includes(selected))visible[2]=selected;
 for(const tag of visible){
  const button=document.createElement('button');button.type='button';button.className='document-tag';
  button.textContent='#'+tag;button.dataset.searchKey=keyPrefix+':tag:'+tag;
  button.dataset.filterTag=tag;
  button.setAttribute('aria-pressed',String(tag===selected));
  button.title=button.ariaLabel=tag===selected?messages.fClearTag(tag):messages.fFilterTag(tag);
  button.onclick=()=>choose(tag);
  fragment.append(button);
 }
 if(tags.length>visible.length){
  const more=document.createElement('small');more.className='document-tag-more';
  more.textContent=messages.fMoreTags(tags.length-visible.length);fragment.append(more);
 }
 return fragment;
}
