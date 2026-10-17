import {Facet,type StateField,type TransactionSpec} from '@codemirror/state';
import {EditorView,ViewPlugin,Decoration,type DecorationSet,type ViewUpdate} from '@codemirror/view';
import {visibleBlocks,blockAt,sameBlockLevel,moveBlocksTo,dropTargets,type Block} from './blocks';
import {messages,localizePage} from './i18n';
import {icon} from './icons';
import {attachMenu} from './menu';

type Range={from:number;to:number};
export interface BlockUIOptions {action:(id:string)=>void;dispatch:(spec:TransactionSpec)=>void}
export const blockRichMode=Facet.define<boolean,boolean>({combine:values=>values.some(Boolean)});
const controls=new WeakMap<EditorView,BlockControls>();
export const blockControls=(view:EditorView)=>controls.get(view);
export function createBlockUI(composing:StateField<boolean>,focus:StateField<boolean>,options:BlockUIOptions){
 return ViewPlugin.define(view=>new BlockControls(view,()=>view.state.facet(blockRichMode)&&!view.state.field(composing)&&!view.composing&&!view.state.field(focus)&&!view.state.readOnly&&!view.dom.closest('.source-mode')&&!view.dom.closest('.read-layout'),options),{decorations:p=>p.decorations});
}
class BlockControls {
 decorations:DecorationSet=Decoration.none;
 range:Range|null=null;
 private anchor:Block|null=null;
 private hovered:Block|null=null;
 private overlay=document.createElement('div');
 private line=document.createElement('div');
 private grip=document.createElement('button');
 private plus=document.createElement('button');
 private pane:HTMLElement;
 private scroll:HTMLElement;
 private abort=new AbortController();
 private menu:ReturnType<typeof attachMenu>;
 private convertMenu:ReturnType<typeof attachMenu>;
 private pointer:{id:number;x:number;y:number;block:Block;range:Range;shift:boolean;dragging:boolean;selected:Range|null}|null=null;
 private landing:{block:Block;place:'before'|'after'}|null=null;
 private frame=0;
 private paint=0;
 private mouse={x:0,y:0};
 private suppressClick=false;
 constructor(readonly view:EditorView,private enabled:()=>boolean,private options:BlockUIOptions){
  controls.set(view,this);this.pane=view.dom.closest<HTMLElement>('.editor-pane')!;this.scroll=this.pane.querySelector<HTMLElement>('.editor-scroll')!;
  const signal=this.abort.signal;this.overlay.className='block-handles';this.overlay.hidden=true;this.line.className='block-insertion';this.line.hidden=true;
  this.grip.id='block-grip';this.grip.className='block-grip';this.grip.type='button';this.grip.append(icon('grip-vertical'));this.grip.setAttribute('aria-haspopup','menu');this.grip.setAttribute('aria-controls','block-menu');this.grip.setAttribute('aria-expanded','false');
  this.plus.id='block-plus';this.plus.type='button';this.plus.append(icon('plus'));
  this.overlay.append(this.plus,this.grip);this.pane.append(this.overlay,this.line);this.labels();
  this.grip.addEventListener('click',e=>{if(this.suppressClick||!this.enabled()){e.preventDefault();e.stopImmediatePropagation();return}if(this.hovered&&!this.range)this.select(this.hovered,false)},{signal});
  const menu=document.querySelector<HTMLElement>('#block-menu')!,convert=document.querySelector<HTMLElement>('#block-convert')!,sub=document.querySelector<HTMLElement>('#block-convert-menu')!;
  this.menu=attachMenu(this.grip,menu,id=>{if(id!=='convert')options.action(id)});
  menu.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.overlay.hidden)view.focus()},{signal});
  this.convertMenu=attachMenu(convert,sub,id=>{this.menu.close();options.action(id)});
  convert.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();this.convertMenu.open()}},{signal});
  sub.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();this.convertMenu.close(true)}},{signal});
  this.plus.addEventListener('pointerdown',e=>e.preventDefault(),{signal});
  this.plus.addEventListener('click',()=>{if(this.enabled()&&this.hovered){this.range={from:this.hovered.from,to:this.hovered.to};options.action('insert')}},{signal});
  this.grip.addEventListener('pointerdown',e=>this.down(e),{signal});
  this.pane.addEventListener('pointermove',e=>{if(!this.pointer)this.hover(e)},{signal});
  this.pane.addEventListener('pointerleave',()=>{if(!this.pointer)this.hide()},{signal});
  window.addEventListener('pointermove',e=>this.move(e),{signal});
  window.addEventListener('pointerup',e=>this.up(e),{signal});
  window.addEventListener('pointercancel',()=>{this.cancel();this.redraw()},{signal});
  window.addEventListener('blur',()=>{this.cancel();this.hide();this.menu.close()},{signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.pointer){e.preventDefault();e.stopImmediatePropagation();this.cancel();this.redraw()}},{capture:true,signal});
  this.scroll.addEventListener('scroll',()=>{if(this.pointer?.dragging)this.queuePaint();else{this.hide();this.menu.close()}},{passive:true,signal});
 }
 private labels(){this.grip.setAttribute('aria-label',messages.fBlockGrip());this.grip.title=messages.fBlockGrip();this.plus.setAttribute('aria-label',messages.fInsertParagraphBelow());this.plus.title=messages.fInsertParagraphBelow()}
 update(u:ViewUpdate){
  if(!this.enabled()){this.cancel();this.hide();this.menu.close();this.range=null;this.anchor=null;this.decorations=Decoration.none;return}
  if(u.docChanged){
   this.cancel();this.hide();this.menu.close();this.anchor=null;
   this.range=this.range&&u.transactions.some(t=>['move.block','input.format','input.block'].some(event=>t.isUserEvent(event)))?{from:u.state.selection.main.from,to:u.state.selection.main.to}:null;
  }else if(u.selectionSet&&this.range&&(u.state.selection.main.from!==this.range.from||u.state.selection.main.to!==this.range.to)){this.range=null;this.anchor=null}
  if(u.docChanged||u.selectionSet||u.viewportChanged)this.decorate();
  if(u.geometryChanged){this.hide();this.menu.close()}
  if(u.transactions.some(t=>t.reconfigured))this.labels();
 }
 private decorate(){
  if(!this.enabled()||!this.range){this.decorations=Decoration.none;return}
  const from=this.range.from,to=this.range.to,dec=Decoration.line({class:this.pointer?.dragging?'cm-block-dragging':'cm-block-selected'}),lines=[];
  for(const visible of this.view.visibleRanges){
   const start=Math.max(visible.from,from),end=Math.min(visible.to,to);if(start>end)continue;
   const first=this.view.state.doc.lineAt(start).number,last=this.view.state.doc.lineAt(end).number;
   for(let i=first;i<=last;i++)lines.push(dec.range(this.view.state.doc.line(i).from));
  }
  this.decorations=Decoration.set(lines,true);
 }
 private redraw(){this.view.dispatch({})}
 private hide(){this.overlay.hidden=true;this.hovered=null}
 private candidates(){const {from,to}=this.view.viewport;return visibleBlocks(this.view.state,from,to)}
 private hover(e:PointerEvent){
  if(!this.enabled()){this.hide();return}
  if(this.overlay.contains(e.target as Node)||!document.querySelector<HTMLElement>('#block-menu')!.hidden)return;
  const bounds=this.scroll.getBoundingClientRect(),text=this.view.contentDOM.getBoundingClientRect();
  if(e.clientY<bounds.top||e.clientY>bounds.bottom){this.hide();return}
  const pos=this.view.posAtCoords({x:Math.max(text.left+1,Math.min(text.right-1,e.clientX)),y:e.clientY});
  const b=pos===null?null:this.candidates().filter(b=>b.from<=pos&&b.to>=pos).at(-1);
  if(!b){this.hide();return}
  const top=this.view.lineBlockAt(b.from).top+this.view.documentTop,bottom=this.view.lineBlockAt(b.to).bottom+this.view.documentTop;
  if(e.clientY<top||e.clientY>bottom){this.hide();return}this.show(b);
 }
 private show(b:Block){
  const v=this.view,box=v.coordsAtPos(b.from,1),pane=this.pane.getBoundingClientRect(),scroll=this.scroll.getBoundingClientRect(),text=v.contentDOM.getBoundingClientRect();
  if(!box||box.top<scroll.top||box.top>=scroll.bottom){this.hide();return false}
  const margin=text.left-pane.left,narrow=margin<48;this.overlay.classList.toggle('block-handles-narrow',narrow);this.overlay.style.setProperty('--block-handle-size',Math.min(24,margin)+'px');
  this.labels();this.hovered=b;this.overlay.hidden=false;this.overlay.style.left=Math.max(0,margin-(narrow?24:48)-4)+'px';this.overlay.style.top=(box.top-pane.top+Math.max(0,(box.bottom-box.top-24)/2))+'px';return true;
 }
 private select(b:Block,shift:boolean){
  if(shift&&this.anchor&&sameBlockLevel(this.anchor,b))this.range={from:Math.min(this.anchor.from,b.from),to:Math.max(this.anchor.to,b.to)};
  else{this.anchor=b;this.range={from:b.from,to:b.to}}
  this.view.dispatch({selection:{anchor:this.range.from,head:this.range.to},userEvent:'select.block'});this.decorate();this.redraw();
 }
 open(){
  if(!this.enabled())return;
  const b=blockAt(this.view.state,this.range?.from??this.view.state.selection.main.head);if(!b)return;
  if(!this.range)this.select(b,false);
  if(this.show(b)){localizePage(document.querySelector('#block-menu')!);this.menu.open()}
  else{this.view.dispatch({effects:EditorView.scrollIntoView(b.from,{y:'center'})});requestAnimationFrame(()=>{if(this.view.dom.isConnected&&this.enabled()&&this.show(b))this.menu.open()})}
 }
 private down(e:PointerEvent){
  if(e.button!==0||!this.enabled()||!this.hovered)return;
  e.preventDefault();this.menu.close();this.convertMenu.close();const b=this.hovered;
  const range=this.range&&b.from>=this.range.from&&b.to<=this.range.to?this.range:{from:b.from,to:b.to};
  this.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,block:b,range,shift:e.shiftKey,dragging:false,selected:this.range};this.grip.setPointerCapture(e.pointerId);
 }
 private move(e:PointerEvent){
  const p=this.pointer;if(!p||p.id!==e.pointerId)return;
  if(!this.enabled()){this.cancel();return}this.mouse={x:e.clientX,y:e.clientY};
  if(!p.dragging&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>4){p.dragging=true;this.range=p.range;this.decorate();this.redraw();this.frame=requestAnimationFrame(()=>this.autoScroll())}
  if(p.dragging){e.preventDefault();this.queuePaint()}
 }
 private queuePaint(){if(!this.paint)this.paint=requestAnimationFrame(()=>{this.paint=0;if(this.pointer?.dragging)this.target()})}
 private target(){
  const p=this.pointer;if(!p)return;this.landing=null;this.line.hidden=true;
  const scroll=this.scroll.getBoundingClientRect(),pane=this.pane.getBoundingClientRect(),text=this.view.contentDOM.getBoundingClientRect();
  if(this.mouse.y<scroll.top||this.mouse.y>scroll.bottom||this.mouse.x<scroll.left||this.mouse.x>scroll.right)return;
  const {from,to}=this.view.viewport,peers=dropTargets(this.view.state,p.block,from,to).filter(b=>!(b.from>=p.range.from&&b.to<=p.range.to));let best=Infinity;
  for(const b of peers){
   const top=this.view.lineBlockAt(b.from).top+this.view.documentTop,bottom=this.view.lineBlockAt(b.to).bottom+this.view.documentTop;
   for(const [place,y] of [['before',top],['after',bottom]] as const){const distance=Math.abs(this.mouse.y-y);if(distance<best){best=distance;this.landing={block:b,place};this.line.style.top=(y-pane.top)+'px'}}
  }
  if(this.landing){this.line.style.left=(text.left-pane.left)+'px';this.line.style.width=text.width+'px';this.line.hidden=false}
 }
 private autoScroll(){
  if(!this.pointer?.dragging)return;
  const r=this.scroll.getBoundingClientRect(),y=this.mouse.y,edge=44,speed=y<r.top+edge?-Math.min(18,(r.top+edge-y)/3):y>r.bottom-edge?Math.min(18,(y-r.bottom+edge)/3):0;
  if(speed){this.scroll.scrollTop+=speed;this.queuePaint()}this.frame=requestAnimationFrame(()=>this.autoScroll());
 }
 private up(e:PointerEvent){
  const p=this.pointer;if(!p||p.id!==e.pointerId)return;
  const landing=this.landing,dragging=p.dragging;this.cancel();
  if(dragging){this.redraw();if(landing&&this.enabled()){const spec=moveBlocksTo(this.view.state,p.range,landing.block,landing.place);if(spec){this.range=p.range;this.options.dispatch(spec)}}}
  else{this.select(p.block,p.shift);this.show(p.block)}
 }
 private cancel(){
  if(this.pointer?.dragging){this.range=this.pointer.selected;this.suppressClick=true;setTimeout(()=>this.suppressClick=false,0)}
  if(this.pointer&&this.grip.hasPointerCapture(this.pointer.id))this.grip.releasePointerCapture(this.pointer.id);
  this.pointer=null;this.landing=null;cancelAnimationFrame(this.frame);cancelAnimationFrame(this.paint);this.paint=0;this.line.hidden=true;this.decorate();
 }
 destroy(){this.abort.abort();this.cancel();this.menu.destroy();this.convertMenu.destroy();this.overlay.remove();this.line.remove();controls.delete(this.view)}
}
