import {WidgetType,EditorView} from '@codemirror/view';
import type {StateField} from '@codemirror/state';
import {fillMath} from './math';

const pending=new WeakMap<HTMLElement,ReturnType<typeof setTimeout>>();

export class MathWidget extends WidgetType{
 constructor(readonly source:string,readonly display:boolean,readonly from:number,readonly composing:StateField<boolean>){super()}
 eq(other:MathWidget){return other.source===this.source&&other.display===this.display&&other.from===this.from}
 toDOM(view:EditorView){
  const dom=document.createElement(this.display?'div':'span');dom.className='rendered-math';dom.contentEditable='false';
  // CodeMirror only mounts visible widgets. Building or mapping offscreen decorations never invokes KaTeX.
  const blocked=()=>view.composing||view.state.field(this.composing);
  if(!blocked())fillMath(dom,this.source,this.display);
  else{
   dom.textContent=this.source;
   const resume=()=>{pending.delete(dom);if(!dom.isConnected)return;if(blocked()){pending.set(dom,setTimeout(resume,50));return}fillMath(dom,this.source,this.display);view.requestMeasure()};
   pending.set(dom,setTimeout(resume,50));
  }
  dom.addEventListener('mousedown',event=>{
   if(view.composing||view.state.field(this.composing)||view.state.readOnly)return;
   event.preventDefault();view.dispatch({selection:{anchor:this.from+(this.display?0:1)},scrollIntoView:true});view.focus();
  });return dom;
 }
 destroy(dom:HTMLElement){clearTimeout(pending.get(dom));pending.delete(dom)}
 ignoreEvent(){return true}
}
