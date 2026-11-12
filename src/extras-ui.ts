import type {StateField} from '@codemirror/state';
import {EditorView,WidgetType,hoverTooltip} from '@codemirror/view';
import {foldEffect,unfoldEffect,foldedRanges} from '@codemirror/language';
import {extraRanges,type CalloutKind,type DetailsRange} from './extras';
import {messages,activeLocale} from './i18n';
import {icon} from './icons';

export function calloutTitle(kind:CalloutKind){return {note:messages.fNote,tip:messages.fTip,important:messages.fImportant,warning:messages.fWarning,caution:messages.fCaution}[kind]()}
export class CalloutWidget extends WidgetType{
 readonly locale=activeLocale;
 constructor(readonly kind:CalloutKind){super()}
 eq(other:CalloutWidget){return this.locale===other.locale&&this.kind===other.kind}
 toDOM(){const label=document.createElement('span');label.className='md-callout-title';label.append(icon(this.kind),document.createTextNode(calloutTitle(this.kind)));return label}
}
export class DetailsWidget extends WidgetType{
 readonly locale=activeLocale;
 // No position: a toggle that only moved keeps its DOM, and a click reads where it is from the DOM.
 constructor(readonly expanded:boolean,readonly composing:StateField<boolean>){super()}
 eq(other:DetailsWidget){return this.locale===other.locale&&this.expanded===other.expanded}
 toDOM(view:EditorView){
  const button=document.createElement('button');button.type='button';button.className='md-details-toggle';button.contentEditable='false';
  button.title=this.expanded?messages.fCollapseDetails():messages.fExpandDetails();button.setAttribute('aria-label',button.title);button.setAttribute('aria-expanded',String(this.expanded));button.append(icon('chevron-down'));
  button.onmousedown=e=>e.preventDefault();button.onclick=()=>{
   if(view.composing||view.state.field(this.composing))return;
   const summary=view.posAtDOM(button),range=extraRanges(view.state).details.find(r=>r.summary===summary);if(!range)return;
   const focused=document.activeElement===button;
   view.dispatch({effects:(this.expanded?foldEffect:unfoldEffect).of(range),...this.expanded?{selection:{anchor:range.from}}:{}});
   if(focused)Array.from(view.dom.querySelectorAll<HTMLButtonElement>('.md-details-toggle')).find(toggle=>view.posAtDOM(toggle)===range.summary)?.focus();
   view.requestMeasure();
  };return button;
 }
 ignoreEvent(){return true}
}
export class FootnoteWidget extends WidgetType{
 constructor(readonly label:string,readonly number:number){super()}
 eq(other:FootnoteWidget){return this.label===other.label&&this.number===other.number}
 toDOM(){const marker=document.createElement('sup');marker.className='md-footnote-ref';marker.dataset.footnote=this.label;marker.textContent='['+this.number+']';return marker}
 ignoreEvent(){return false}
}
export function footnoteInteractions(composing:StateField<boolean>){
 return [hoverTooltip((view,pos)=>{
  if(view.composing||view.state.field(composing))return null;
  const {references,definitions}=extraRanges(view.state),reference=references.find(r=>r.from<=pos&&pos<=r.to),definition=reference&&definitions.get(reference.label);if(!reference||!definition)return null;
  const text=definition.text.length>500?definition.text.slice(0,499)+'…':definition.text;
  return {pos:reference.from,end:reference.to,above:true,create(){const dom=document.createElement('div');dom.className='md-footnote-tooltip';dom.textContent=text;return {dom}}};
 }),EditorView.domEventHandlers({mousedown:(event,view)=>{
  if(!(event.metaKey||event.ctrlKey)||view.composing||view.state.field(composing)||!(event.target as HTMLElement).closest('[data-footnote]'))return false;
  // Preserve the replacement until click, so moving the caret cannot remove its target first.
  event.preventDefault();return true;
 },click:(event,view)=>{
  if(!(event.metaKey||event.ctrlKey)||view.composing||view.state.field(composing))return false;
  const target=(event.target as HTMLElement).closest<HTMLElement>('[data-footnote]');if(!target)return false;
  const definition=extraRanges(view.state).definitions.get(target.dataset.footnote!);if(!definition)return false;
  event.preventDefault();view.dispatch({selection:{anchor:definition.inline?definition.from:definition.textFrom},scrollIntoView:true});view.focus();return true;
 }})];
}
export function detailsExpanded(state:EditorView['state'],range:DetailsRange){let expanded=true;foldedRanges(state).between(range.from,range.to,(from,to)=>{if(from===range.from&&to===range.to)expanded=false});return expanded}
