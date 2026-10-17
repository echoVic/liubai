import {WidgetType,EditorView} from '@codemirror/view';
import type {StateField} from '@codemirror/state';
import {MermaidMount} from './mermaid';

const mounts=new WeakMap<HTMLElement,{mount:MermaidMount;widget:MermaidWidget}>();
export class MermaidWidget extends WidgetType{
 constructor(readonly source:string,readonly from:number,readonly composing:StateField<boolean>){super()}
 eq(other:MermaidWidget){return other.source===this.source&&other.from===this.from}
 toDOM(view:EditorView){
  const dom=document.createElement('div');dom.className='rendered-mermaid';dom.contentEditable='false';
  const mount=new MermaidMount(dom,()=>view.requestMeasure(),()=>view.composing||view.state.field(this.composing));
  mounts.set(dom,{mount,widget:this});mount.update(this.source);
  dom.addEventListener('mousedown',event=>{
   if(view.composing||view.state.field(this.composing)||view.state.readOnly)return;
   event.preventDefault();view.dispatch({selection:{anchor:mounts.get(dom)!.widget.from},scrollIntoView:true});view.focus();
  });return dom;
 }
 updateDOM(dom:HTMLElement){
  const entry=mounts.get(dom)!;if(entry.widget.source!==this.source)entry.mount.update(this.source);entry.widget=this;return true;
 }
 destroy(dom:HTMLElement){mounts.get(dom)?.mount.dispose();mounts.delete(dom)}
 ignoreEvent(){return true}
}
