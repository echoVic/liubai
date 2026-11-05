import {EditorView} from '@codemirror/view';

// The page scrolls outside CodeMirror. Its height map may settle over several
// frames after rewrapping, so keep the same document position until it settles.
export function preserveEditorScroll(view:EditorView,scroll:HTMLElement,update:()=>void):()=>void{
 const top=scroll.getBoundingClientRect().top;
 const hit=scroll.scrollTop>0?view.posAtCoords({x:view.contentDOM.getBoundingClientRect().left+1,y:top+1}):null;
 // A point in the leading space between paragraphs can map to the previous
 // paragraph. Anchor the first block whose actual text remains visible.
 const visible=hit!==null?Array.from(view.contentDOM.children).find(element=>{
  const range=document.createRange();range.selectNodeContents(element);
  return [...range.getClientRects()].some(rect=>rect.bottom>top+2);
 }):undefined;
 const line=visible?view.state.doc.lineAt(view.posAtDOM(visible)):undefined;
 const pos=hit!==null&&line&&(hit<line.from||hit>line.to)?line.from:hit;
 const point=pos!==null?view.coordsAtPos(pos):null,doc=view.state.doc;
 update();
 if(pos===null||!point)return ()=>{};
 const controller=new AbortController();
 let frame=0,attempts=0,stable=0,height=-1;
 const cancel=()=>{controller.abort();cancelAnimationFrame(frame)};
 for(const event of ['wheel','pointerdown','keydown'])scroll.addEventListener(event,cancel,{passive:true,signal:controller.signal});
 const measure={
  key:scroll,
  read:():ReturnType<EditorView['coordsAtPos']>=>{
   if(controller.signal.aborted||view.state.doc!==doc||!view.dom.isConnected||!scroll.isConnected)return null;
   return view.coordsAtPos(pos);
  },
  write:(rect:ReturnType<EditorView['coordsAtPos']>):void=>{
   if(controller.signal.aborted)return;
   if(view.state.doc!==doc||!view.dom.isConnected||!scroll.isConnected||getComputedStyle(scroll).visibility==='hidden'){cancel();return}
   const delta=rect?rect.top-scroll.getBoundingClientRect().top-(point.top-top):0;
   if(rect)scroll.scrollTop+=delta;
   stable=rect&&Math.abs(delta)<.5&&height===view.contentHeight?stable+1:0;
   height=view.contentHeight;
   if(stable>=3||++attempts>=12){cancel();return}
   frame=requestAnimationFrame(()=>view.requestMeasure(measure));
  },
 };
 view.dispatch({effects:EditorView.scrollIntoView(pos,{y:'start',yMargin:point.top-top,xMargin:0})});
 // Let CodeMirror consume the scroll effect before correcting its outer parent;
 // otherwise its scroll and this correction would both use the same old rect.
 frame=requestAnimationFrame(()=>view.requestMeasure(measure));
 return cancel;
}
