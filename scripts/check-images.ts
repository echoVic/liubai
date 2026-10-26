import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import * as images from '../src/images';
import {normalizeImageDestination} from '../src/markdown';
import {createBlockField,inlineDecorations,composing} from '../src/editor';
import {leaveBlock} from '../src/block-navigation';
assert.equal(typeof images.parseImage,'function','standalone image parser exists');
const create=(doc:string)=>EditorState.create({doc,extensions:[history(),markdown({base:markdownLanguage,extensions:GFM}),composing]});
const forms=['![说明](<图 片/a(1)%20.png> "标题")','<img src="图 片/a(1)%20.png" alt="说明" title="标题" width="300" height="200">','<p align="center"><img src="图 片/a(1)%20.png" alt="说明" title="标题"></p>','<p align="right"><img src="图 片/a(1)%20.png" alt="说明" title="标题" width="240"></p>'];
for(const raw of forms){
 const model=images.parseImage(raw)!;assert.ok(model);assert.equal(model.src,'图 片/a(1)%20.png');assert.equal(model.alt,'说明');assert.equal(model.title,'标题');
 assert.deepEqual(images.parseImage(images.serializeImage(model)),model,'semantic round trip');
 for(const [action,value] of [['resize',323.4],['left',undefined],['center',undefined],['right',undefined],['original',undefined],['alt','新 " & < [] \\'],['delete',undefined]] as const){
  for(const container of ['', '> ', '- ', '> - ']){
   const prefix='前文  \n\n'+container,suffix='\n\n尾文\t ',doc=prefix+raw+suffix,from=prefix.length,to=from+raw.length;let state=create(doc);
   const spec=images.editImage(state,{from,to},action,value);state=state.update(spec).state;
   if(action==='delete')assert.equal(state.doc.toString(),'前文  \n\n尾文\t ');
   else{
    assert.ok(state.doc.toString().startsWith(prefix));assert.ok(state.doc.toString().endsWith(suffix));
    const next=images.parseImage(state.sliceDoc(from,state.doc.length-suffix.length))!;assert.ok(next);assert.equal(next.src,model.src);assert.equal(next.title,model.title);
    if(action==='resize'){assert.equal(next.width,323);assert.equal(next.height,undefined)}
    if(['left','center','right'].includes(action))assert.equal(next.align,action);
    if(action==='original'){assert.equal(next.width,undefined);assert.equal(next.height,undefined);if(model.align==='left')assert.ok(state.sliceDoc(from).startsWith('!['))}
    if(action==='alt')assert.equal(next.alt,value);
   }
   assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),doc,'one undo: '+action+' '+container+raw);
  }
 }
}
for(const path of ['relative/a.png','图 片/图(一).png','a%20b.png','a&b<".png','../中文 (一)/a.png']){
 const model={src:path,alt:'" & < [字] \\',title:'" & <',align:'left' as const};
 const md=images.serializeImage(model),html=images.serializeImage({...model,width:300});
 assert.equal(images.parseImage(md)!.src,path);assert.equal(images.parseImage(html)!.src,path);
 assert.equal(normalizeImageDestination(images.parseImage(md)!.src),normalizeImageDestination(images.parseImage(html)!.src),'editor and reader normalize to same destination');
 assert.equal(images.parseImage(md)!.alt,model.alt);assert.equal(images.parseImage(html)!.title,model.title);
}
for(const raw of ['text ![a](x)','<img src="x"> tail','<p align="center">![a](x)</p>','![a](x) ![b](y)'])assert.equal(images.parseImage(raw),null);
for(const raw of forms)for(const container of ['', '> ', '- ', '> - ']){
 const doc='前\n\n'+container+raw+'\n\n后',field=createBlockField(async()=>''),state=EditorState.create({doc,extensions:[markdown({base:markdownLanguage,extensions:GFM}),composing,field]});
 const widgets:any[]=[];state.field(field).between(0,doc.length,(from,to,value)=>{if(value.spec.widget?.constructor.name==='ImageWidget')widgets.push({from,to})});
 assert.deepEqual(widgets,[{from:doc.indexOf(raw),to:doc.indexOf(raw)+raw.length}],'widget: '+container+raw);
 const inline=inlineDecorations(state,[{from:0,to:doc.length}]);inline.between(0,doc.length,(from,to)=>assert.ok(!widgets.some(w=>from>=w.from&&from<w.to),'widget owns inline source'));
 const leave=state.update(leaveBlock(state,widgets[0])).state;assert.equal(leave.selection.main.head,doc.length-1);
 const bare=create(container+raw),opened=bare.update(leaveBlock(bare,{from:container.length,to:bare.doc.length})).state;
 assert.equal(opened.doc.toString(),container+raw+'\n\n');assert.equal(opened.selection.main.head,opened.doc.length);
}
const adjacent=create(forms[0]+'\n\n'+forms[1]);const left=adjacent.update(leaveBlock(adjacent,{from:0,to:forms[0].length})).state;assert.equal(left.doc.toString(),forms[0]+'\n\n\n\n'+forms[1]);
console.log('image parsing, conversion matrix, scoped edits/undo, paths, containers, widgets and safe navigation passed');
// Exact wire forms, including title escaping and removal of dimensions.
const precise={src:'图 片/(一)%20&.png',alt:'" & <',title:'" & <',align:'left' as const};
assert.equal(images.serializeImage(precise),'![" &amp; &lt;](<图 片/(一)%20&amp;.png> "&quot; &amp; &lt;")');
assert.equal(images.serializeImage({...precise,width:300}),'<img src="图 片/(一)%20&amp;.png" alt="&quot; &amp; &lt;" title="&quot; &amp; &lt;" width="300">');
for(const alt of ['', '**literal** _text_ `code` ![x] ~hi~', '&copy; &#34; <b>'])assert.equal(images.parseImage(images.serializeImage({...precise,alt}))!.alt,alt);
// Selecting a widget keeps its source hidden; moving the document caret onto it still reveals source.
const {imageSelection,selectImage}=await import('../src/image-ui');
const raw=forms[0],field=createBlockField(async()=>''),doc='前\n\n'+raw+'\n\n后';
let selected=EditorState.create({doc,extensions:[history(),markdown({base:markdownLanguage,extensions:GFM}),composing,imageSelection,field]});
const count=()=>{let n=0;selected.field(field).between(0,selected.doc.length,(_a,_b,d)=>{if(d.spec.widget?.constructor.name==='ImageWidget')n++});return n};
selected=selected.update({selection:{anchor:3},effects:selectImage.of({from:3,to:3+raw.length})}).state;assert.equal(count(),1);
selected=selected.update(images.editImage(selected,{from:3,to:3+raw.length},'center')).state;assert.equal(count(),1);
assert.ok(undo({state:selected,dispatch:tr=>selected=tr.state}));assert.equal(selected.doc.toString(),doc);assert.equal(count(),1);
selected=selected.update({selection:{anchor:4}}).state;assert.equal(count(),0);
selected=selected.update({selection:{anchor:0},effects:selectImage.of({from:3,to:3+raw.length})}).state;
selected=selected.update({effects:selectImage.of(null)}).state;assert.equal(selected.field(imageSelection),null);
for(const text of ['```html\n'+forms[1]+'\n```','    '+forms[0]])assert.deepEqual(images.imageRanges(create(text)),[],'code stays code');
assert.equal(images.clampImageWidth(500,300.7),300,'integer width never exceeds a fractional text column');
assert.equal(images.clampImageWidth(2,600),48);assert.equal(images.clampImageWidth(100,32.4),32);assert.equal(images.clampImageWidth(300.6,600),301);
// Deleting an image paragraph must not expand to the enclosing quote or list item.
for(const [doc,expected] of [
 ['前\n\n> 之前\n>\n> ![a](x)\n>\n> 之后\n\n后','前\n\n> 之前\n>\n> 之后\n\n后'],
 ['前\n\n- 之前\n\n  ![a](x)\n\n  之后\n\n后','前\n\n- 之前\n\n  之后\n\n后'],
 ['前\n\n- ![a](x)\n\n  之后\n\n后','前\n\n- 之后\n\n后'],
 ['前\n\n> - 之前\n>\n>   ![a](x)\n>\n>   之后\n\n后','前\n\n> - 之前\n>\n>   之后\n\n后'],
] as const){
 let state=create(doc);const from=doc.indexOf('![a]'),to=from+'![a](x)'.length;state=state.update(images.editImage(state,{from,to},'delete')).state;
 assert.equal(state.doc.toString(),expected,'only the image paragraph is deleted');assert.ok(undo({state,dispatch:tr=>state=tr.state}));assert.equal(state.doc.toString(),doc);
}
for(const [container,quotes,listEms] of [['> ',1,0],['- ',0,1.7],['> - ',1,1.7],['- [ ] ',0,.2]] as const){
 const ranges=images.imageRanges(create('前\n\n'+container+forms[0]+'\n\n后'));assert.equal(ranges.length,1);assert.equal(ranges[0].quotes,quotes);assert.equal(ranges[0].listEms,listEms);
}
// Prose edits map cached widgets, including their action ranges; structural edits must rebuild the index.
for(const change of [
 {from:1,insert:'续'},
 // At a paragraph's end, where most typing happens: the first and the last paragraph, and a deletion.
 {from:2,insert:'续'},{from:35,insert:'续'},{from:1,to:2,insert:''},
 {from:0,to:2,insert:'![新](new.png)'},
 {from:0,to:2,insert:'<img src="new.png" alt="新">'},
 {from:0,to:2,insert:'```'},
] as const){
 const field=createBlockField(async()=>''),doc='前文\n\n![a](x)\n\n| h |\n| --- |\n| v |\n\n尾';
 let state=EditorState.create({doc,extensions:[markdown({base:markdownLanguage,extensions:GFM}),composing,field]});
 state=state.update({changes:change,selection:{anchor:change.from+change.insert.length}}).state;
 const actual:{from:number;to:number;raw:string;widgetFrom:number}[]=[];
 state.field(field).between(0,state.doc.length,(from,to,value)=>{const widget=value.spec.widget;if(widget?.constructor.name==='ImageWidget')actual.push({from,to,raw:widget.raw,widgetFrom:widget.from});if(widget?.constructor.name==='TableWidget')assert.equal(widget.from,from,'table action range moves with its decoration')});
 const fresh=createBlockField(async()=>''),reference=EditorState.create({doc:state.doc,selection:state.selection,extensions:[markdown({base:markdownLanguage,extensions:GFM}),composing,fresh]});
 const expected:{from:number;to:number;raw:string;widgetFrom:number}[]=[];reference.field(fresh).between(0,reference.doc.length,(from,to,value)=>{const widget=value.spec.widget;if(widget?.constructor.name==='ImageWidget')expected.push({from,to,raw:widget.raw,widgetFrom:widget.from})});
 assert.deepEqual(actual,expected,'cached and fresh widgets agree after prose/structural edits');
}
// Moving the caret keeps the text and the tree: the collected widget ranges are reused, not recollected by walking the whole document.
{
 const state=create('前文\n\n'+forms[0]+'\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n后文'),found=images.imageRanges(state),tables=images.tableRanges(state);
 const moved=state.update({selection:{anchor:1}}).state;
 assert.equal(images.imageRanges(moved),found,'a caret move reuses the image ranges');assert.equal(images.tableRanges(moved),tables,'a caret move reuses the table ranges');
 const edited=moved.update({changes:{from:0,insert:'新'}}).state;
 assert.notEqual(images.imageRanges(edited),found,'an edit collects again');assert.equal(images.imageRanges(edited)[0].from,found[0].from+1);
}
console.log('image selection/history, dimensions, container-scoped deletion/insets, incremental widget ranges and caret-move reuse passed');
