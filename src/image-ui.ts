import {StateEffect,StateField,type EditorState} from '@codemirror/state';
import {EditorView,WidgetType} from '@codemirror/view';
import {undo,redo} from '@codemirror/commands';
import {messages,activeLocale} from './i18n';
import {icon} from './icons';
import {tableComposition} from './table-ui';
import {leaveBlock,textBeside} from './block-navigation';
import {editImage,parseImage,clampImageWidth,type ImageAction} from './images';

type Range={from:number;to:number};
export const selectImage=StateEffect.define<Range|null>();
export const imageSelection=StateField.define<Range|null>({create:()=>null,update(value,tr){
 if(tr.state.readOnly)return null;
 if(value&&tr.docChanged)value={from:tr.changes.mapPos(value.from,-1),to:tr.changes.mapPos(value.to,1)};
 if(tr.selection&&!tr.isUserEvent('undo')&&!tr.isUserEvent('redo')&&!tr.isUserEvent('input.image')&&!tr.effects.some(e=>e.is(selectImage)))value=null;
 for(const effect of tr.effects)if(effect.is(selectImage))value=effect.value;
 return value;
}});
export function focusedImageRange(view:EditorView){return view.state.field(imageSelection,false)||null}
export function imageSelected(state:EditorState,from:number){return state.field(imageSelection,false)?.from===from}
const images=new WeakMap<HTMLElement,ImageDOM>();
export class ImageWidget extends WidgetType{
 readonly locale=activeLocale;
 readonly dest:string;
 constructor(readonly raw:string,readonly from:number,readonly resolve:(dest:string)=>Promise<string>,readonly composing:StateField<boolean>,readonly selected=false,readonly readOnly=false,readonly quotes=0,readonly listEms=0){super();this.dest=parseImage(raw)!.src}
 eq(o:ImageWidget){return this.locale===o.locale&&this.raw===o.raw&&this.from===o.from&&this.selected===o.selected&&this.readOnly===o.readOnly&&this.quotes===o.quotes&&this.listEms===o.listEms}
 toDOM(view:EditorView){const image=new ImageDOM(view,this.composing);images.set(image.dom,image);image.update(this);return image.dom}
 updateDOM(dom:HTMLElement){images.get(dom)!.update(this);return true}
 destroy(dom:HTMLElement){images.get(dom)?.destroy();images.delete(dom)}
 ignoreEvent(){return true}
}
class ImageDOM{
 readonly dom=document.createElement('figure');
 private frame=document.createElement('span');
 private img=new Image();
 private toolbar=document.createElement('div');
 private handle=document.createElement('button');
 private badge=document.createElement('span');
 private popover=document.createElement('div');
 private input=document.createElement('input');
 private abort=new AbortController();
 private widget!:ImageWidget;
 private source='';
 private selected=false;
 private composingAlt=false;
 private disposed=false;
 private endTimer:ReturnType<typeof setTimeout>|undefined;
 private drag:{id:number;x:number;width:number;value:number;max:number}|null=null;
 constructor(private view:EditorView,private composing:StateField<boolean>){
  const signal=this.abort.signal;
  this.dom.className='inline-image';this.dom.contentEditable='false';this.dom.tabIndex=-1;
  this.frame.className='image-frame';this.img.loading='lazy';this.img.draggable=false;this.img.onerror=()=>{if(!this.disposed){this.img.hidden=true;this.dom.dataset.error=messages.fImageResourceMissing(this.img.alt)}};this.frame.append(this.img);
  this.toolbar.className='image-toolbar';this.toolbar.setAttribute('role','toolbar');this.toolbar.hidden=true;
  this.handle.type='button';this.handle.className='image-resize-handle';this.handle.hidden=true;
  this.badge.className='image-width-badge';this.badge.hidden=true;this.badge.setAttribute('role','status');
  this.popover.className='image-alt-popover';this.popover.hidden=true;this.input.type='text';this.popover.append(this.input);
  this.frame.append(this.handle,this.badge);this.dom.append(this.frame,this.toolbar,this.popover);
  this.dom.addEventListener('pointerdown',e=>{if(this.blocked()||this.input===e.target)return;e.preventDefault();if(!this.selected)this.select();else if(!(e.target as HTMLElement).closest('button'))this.dom.focus()},{signal});
  this.dom.addEventListener('click',e=>{if(this.blocked())return;e.stopPropagation();if(!this.selected)this.select()},{signal});
  this.dom.addEventListener('keydown',e=>this.key(e),{signal});
  this.dom.addEventListener('beforeinput',e=>{if(this.selected&&e.target!==this.input){e.preventDefault();e.stopPropagation()}},{signal});
  for(const type of ['copy','cut'] as const)document.addEventListener(type,e=>{if(!this.selected||this.input===document.activeElement||this.blocked())return;e.preventDefault();e.stopPropagation();e.clipboardData?.setData('text/plain',this.widget.raw);if(type==='cut')this.change('delete')},{capture:true,signal});
  this.input.addEventListener('compositionstart',e=>{e.stopPropagation();this.composingAlt=true;for(const button of this.toolbar.querySelectorAll('button'))button.disabled=true;for(const notify of this.view.state.facet(tableComposition))notify(this.view,true)},{signal});
  this.input.addEventListener('compositionend',e=>{e.stopPropagation();this.endTimer=setTimeout(()=>{if(this.disposed)return;const finish=()=>{this.composingAlt=false;for(const button of this.toolbar.querySelectorAll('button'))button.disabled=this.blocked()};const handlers=this.view.state.facet(tableComposition);if(handlers.length)for(const notify of handlers)notify(this.view,false,finish);else finish()},0)},{signal});
  this.handle.addEventListener('pointerdown',e=>this.down(e),{signal});
  window.addEventListener('pointermove',e=>this.move(e),{signal});window.addEventListener('pointerup',e=>this.up(e),{signal});
  window.addEventListener('pointercancel',()=>this.cancel(),{signal});window.addEventListener('blur',()=>this.cancel(),{signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.drag){e.preventDefault();e.stopImmediatePropagation();this.cancel();this.dom.focus()}},{capture:true,signal});
  // Clicking or focusing elsewhere only deselects: it must not open a paragraph the way Escape may.
  document.addEventListener('pointerdown',e=>{
   if(!this.selected||this.blocked()||this.dom.contains(e.target as Node))return;
   const target=e.target as HTMLElement;if(target.closest('#format-bar,.block-handles,[role=menu]'))return;
   this.deselect();
  },{capture:true,signal});
  document.addEventListener('focusin',e=>{
   if(this.selected&&!this.blocked()&&!this.dom.contains(e.target as Node)&&!(e.target as HTMLElement).closest('#format-bar,.block-handles,[role=menu]'))this.deselect();
  },{signal});
 }
 private blocked(){return this.widget?.readOnly||this.view.state.readOnly||this.view.composing||this.view.state.field(this.composing)||this.composingAlt}
 update(widget:ImageWidget){
  const previous=this.widget;this.widget=widget;this.selected=widget.selected&&!widget.readOnly;const model=parseImage(widget.raw)!;
  if(previous&&previous.raw!==widget.raw)this.cancel();
  this.dom.dataset.from=String(widget.from);this.dom.classList.toggle('image-selected',this.selected);this.dom.tabIndex=widget.readOnly?-1:0;
  this.dom.setAttribute('aria-label',model.alt||messages.fImage());this.dom.setAttribute('aria-selected',String(this.selected));this.dom.setAttribute('role','group');
  this.img.alt=model.alt;this.img.title=model.title||'';this.img.style.width=model.width!==undefined?model.width+'px':'';this.dom.style.textAlign=model.align;this.dom.style.paddingLeft='calc('+widget.quotes*16+'px + var(--editor-size) * '+widget.listEms+')'; // A quote's 2px rule and 14px padding, a list's 1.7em, as in the reader.
  this.toolbar.hidden=!this.selected;this.handle.hidden=!this.selected;
  this.toolbar.setAttribute('aria-label',messages.fImageActions());this.handle.setAttribute('aria-label',messages.fResizeImage());this.handle.title=messages.fResizeImage();this.input.setAttribute('aria-label',messages.fImageAlt());
  const actions:[ImageAction,string,string][]=[['left',messages.fImageAlignLeft(),'align-left'],['center',messages.fImageAlignCenter(),'align-center'],['right',messages.fImageAlignRight(),'align-right'],['original',messages.fImageOriginalSize(),'maximize'],['alt',messages.fImageAlt(),'image-alt'],['delete',messages.fDeleteImage(),'trash']];
  actions.forEach(([action,label,name],i)=>{
   let button=this.toolbar.children[i] as HTMLButtonElement|undefined;
   if(!button){button=document.createElement('button');button.type='button';button.dataset.imageAction=action;button.append(icon(name));button.addEventListener('click',()=>{if(action==='alt')this.editAlt();else this.change(action)});this.toolbar.append(button)}
   button.title=label;button.setAttribute('aria-label',label);button.disabled=this.blocked();if(['left','center','right'].includes(action))button.setAttribute('aria-pressed',String(model.align===action));
  });
  if(!this.selected){this.popover.hidden=true;this.cancel()}
  if(model.src!==this.source){
   this.source=model.src;const source=this.source;this.img.hidden=false;delete this.dom.dataset.error;
   widget.resolve(source).then(url=>{if(!this.disposed&&this.source===source)this.img.src=url}).catch(()=>{if(!this.disposed&&this.source===source){this.img.hidden=true;this.dom.dataset.error=messages.fImageTemporarilyUnreadable(model.alt)}});
  }
 }
 // The text caret waits beside the image, so a saved or restored position never lands on the image line and reveals its source.
 private select(){if(this.blocked())return;this.selected=true;this.dom.focus();const range={from:this.widget.from,to:this.widget.from+this.widget.raw.length},at=textBeside(this.view.state,range);this.view.dispatch({...(at===null?{}:{selection:{anchor:at}}),effects:selectImage.of(range),userEvent:'select.image'})}
 private leave(){
  if(this.blocked())return;this.selected=false;this.cancel();
  this.view.dispatch({...leaveBlock(this.view.state,{from:this.widget.from,to:this.widget.from+this.widget.raw.length}),effects:selectImage.of(null)});
  // Focus can drop the caret at the editor's start before CodeMirror sees it; place it from the state.
  this.view.focus();const {node,offset}=this.view.domAtPos(this.view.state.selection.main.head);getSelection()?.collapse(node,offset);
 }
 private deselect(){
  this.selected=false;this.cancel();
  const at=textBeside(this.view.state,{from:this.widget.from,to:this.widget.from+this.widget.raw.length});
  this.view.dispatch({...(at===null?{}:{selection:{anchor:at}}),effects:selectImage.of(null),userEvent:'select.image'});
 }
 private change(action:ImageAction,value?:string|number){
  if(this.blocked())return;
  this.popover.hidden=true;const spec=editImage(this.view.state,{from:this.widget.from,to:this.widget.from+this.widget.raw.length},action,value);
  if(action==='delete'){spec.effects=selectImage.of(null);this.selected=false}
  this.view.dispatch(spec);if(action==='delete')this.view.focus();else this.dom.focus();
 }
 private editAlt(){if(this.blocked())return;this.input.value=parseImage(this.widget.raw)!.alt;this.popover.hidden=false;this.input.focus();this.input.select()}
 private key(e:KeyboardEvent){
  if(e.isComposing||this.blocked())return;
  if(e.target===this.input){
   if(e.key==='Enter'){e.preventDefault();e.stopPropagation();this.change('alt',this.input.value)}
   else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.popover.hidden=true;this.dom.focus()}
   return;
  }
  if(!this.selected)return;
  const mod=e.metaKey||e.ctrlKey,k=e.key.toLowerCase();
  if(mod&&['c','x'].includes(k))return;
  e.stopPropagation();
  if(mod&&['z','y'].includes(k)){e.preventDefault();(k==='y'||e.shiftKey?redo:undo)(this.view);return}
  if(e.key==='Tab'||e.target instanceof HTMLButtonElement&&['Enter',' '].includes(e.key))return;
  e.preventDefault();
  if(e.key==='Escape')this.leave();else if(e.key==='Enter')this.editAlt();else if(e.key==='Delete'||e.key==='Backspace')this.change('delete');
 }
 private down(e:PointerEvent){
  if(e.button!==0||this.blocked())return;e.preventDefault();e.stopPropagation();this.dom.focus();
  const style=getComputedStyle(this.dom),width=this.img.getBoundingClientRect().width,max=this.dom.getBoundingClientRect().width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  this.drag={id:e.pointerId,x:e.clientX,width,value:Math.round(width),max};
  try{this.handle.setPointerCapture(e.pointerId)}catch{} // Synthetic PointerEvents in the off-screen WebKit check have no native capture.
  this.badge.hidden=false;this.badge.textContent=Math.round(width)+' px';
 }
 private move(e:PointerEvent){
  const drag=this.drag;if(!drag||drag.id!==e.pointerId)return;if(this.blocked()){this.cancel();return}
  e.preventDefault();drag.value=clampImageWidth(drag.width+e.clientX-drag.x,drag.max);
  this.img.style.width=drag.value+'px';this.badge.textContent=drag.value+' px';this.view.requestMeasure();
 }
 private up(e:PointerEvent){const drag=this.drag;if(!drag||drag.id!==e.pointerId)return;this.move(e);const value=drag.value;this.cancel();this.change('resize',value)}
 private cancel(){
  if(!this.drag)return;if(this.handle.hasPointerCapture(this.drag.id))this.handle.releasePointerCapture(this.drag.id);this.drag=null;this.badge.hidden=true;
  const width=parseImage(this.widget.raw)?.width;this.img.style.width=width!==undefined?width+'px':'';this.view.requestMeasure();
 }
 destroy(){this.disposed=true;clearTimeout(this.endTimer);this.abort.abort();this.cancel()}
}
