import {Document,Paragraph,TextRun,Tab,ExternalHyperlink,InternalHyperlink,Bookmark,ImageRun,Table,TableRow,TableCell,FootnoteReferenceRun,Packer,HeadingLevel,AlignmentType,LevelFormat,BorderStyle,WidthType,Math as WordMath,MathRun,MathFraction,MathSuperScript,MathSubScript,MathSubSuperScript,MathRadical,MathLimitLower,MathLimitUpper,BuilderElement,StringContainer,type MathComponent,type ParagraphChild,type IRunOptions,type IParagraphOptions,type INumberingOptions} from 'docx';

// A4, one-inch (Word Normal) margins. Word uses twips; drawings use pixels at 96 dpi.
const pageWidth=11906,pageHeight=16838,margin=1440,textWidth=pageWidth-margin*2;
const bodyFont={ascii:'Times New Roman',hAnsi:'Times New Roman',eastAsia:'宋体'},codeFont={ascii:'Menlo',hAnsi:'Consolas',eastAsia:'宋体'}; // i18n-ignore: fixed OOXML font names
const codeRun=(text:string,style:IRunOptions={})=>new TextRun({...style,children:text.split('\t').flatMap((part,i)=>i?[new Tab(),part]:[part])});
const line={style:BorderStyle.SINGLE,size:6,color:'CDD2CC'},shade={fill:'F1F2EF'};
type Block=Paragraph|Table;
interface Context {level:number;indent?:number;box?:boolean;fill?:string;width:number;bold?:boolean;inFootnote?:boolean;bookmark?:string;alignment?:'left'|'center'|'right';first?:{options:IParagraphOptions;used:boolean};space?:{start:boolean;pending:boolean}}
// docx's public Math union omits extensible OMML elements (matrix/accent/limits). Its XML builder
// supplies those schema elements inside the same native Math tree; no raw XML or HTML is injected.
const mathElement=(name:string,children:readonly MathComponent[]=[],values:Record<string,string>={}):MathComponent=>new BuilderElement({name,children,attributes:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{key,value}]))}) as MathComponent;
function mathML(node:Element):MathComponent[]{
 const children=[...node.children],parts=(n:Element)=>mathML(n),child=(i:number)=>{if(!children[i])throw Error('math arity');return parts(children[i])};
 switch(node.localName){
  case 'math':case 'mrow':case 'mstyle':case 'mtd':return children.flatMap(parts);
  case 'semantics':return child(0);
  case 'mi':case 'mn':case 'mo':case 'mtext':return [new MathRun({text:node.textContent||'',style:node.localName==='mi'?'italic':'plain'})];
  case 'mspace':return [new MathRun(' ')];
  case 'mfrac':return [new MathFraction({numerator:child(0),denominator:child(1),...(node.getAttribute('linethickness')==='0px'?{type:'noBar' as const}:{})})];
  case 'msup':return [new MathSuperScript({children:child(0),superScript:child(1)})];
  case 'msub':return [new MathSubScript({children:child(0),subScript:child(1)})];
  case 'msubsup':return [new MathSubSuperScript({children:child(0),subScript:child(1),superScript:child(2)})];
  case 'msqrt':return [new MathRadical({children:children.flatMap(parts)})];
  case 'mroot':return [new MathRadical({children:child(0),degree:child(1)})];
  case 'mover':case 'munder':{
   const accent=node.getAttribute(node.localName==='mover'?'accent':'accentunder')==='true',glyph=children[1]?.textContent||'';
   if(accent&&node.localName==='mover')return [mathElement('m:acc',[mathElement('m:accPr',[mathElement('m:chr',[],{'m:val':glyph})]),mathElement('m:e',child(0))])];
   if(accent&&/^[̲_¯‾]$/.test(glyph))return [mathElement('m:bar',[mathElement('m:barPr',[mathElement('m:pos',[],{'m:val':'bot'})]),mathElement('m:e',child(0))])];
   return [node.localName==='mover'?new MathLimitUpper({children:child(0),limit:child(1)}):new MathLimitLower({children:child(0),limit:child(1)})] as MathComponent[];
  }
  case 'munderover':return [new MathLimitUpper({children:[new MathLimitLower({children:child(0),limit:child(1)})] as MathComponent[],limit:child(2)})] as MathComponent[];
  case 'mtable':return [mathElement('m:m',children.map(row=>{
   if(row.localName!=='mtr')throw Error('matrix row');
   return mathElement('m:mr',[...row.children].map(cell=>{if(cell.localName!=='mtd')throw Error('matrix cell');return mathElement('m:e',parts(cell))}));
  }))];
  default:throw Error('unsupported MathML: '+node.localName);
 }
}
function formula(element:Element):ParagraphChild{
 const math=element.querySelector('math'),tex=element.querySelector('annotation[encoding="application/x-tex"]')?.textContent||element.textContent||'';
 try{if(!math)throw Error('missing MathML');return new WordMath({children:mathML(math)})}catch{return new TextRun({text:tex,font:codeFont,size:20})}
}
function bytesFromURL(src:string):Uint8Array{
 const comma=src.indexOf(','),body=src.slice(comma+1),binary=/;base64/i.test(src.slice(0,comma))?atob(body):decodeURIComponent(body);
 return /;base64/i.test(src.slice(0,comma))?Uint8Array.from(binary,c=>c.charCodeAt(0)):new TextEncoder().encode(binary);
}
async function decoded(src:string):Promise<HTMLImageElement>{
 return new Promise((resolve,reject)=>{const image=new Image(),timer=setTimeout(()=>reject(Error('Image decode timeout')),10000);image.onload=()=>{clearTimeout(timer);resolve(image)};image.onerror=()=>{clearTimeout(timer);reject(Error('Image decode failed'))};image.src=src});
}
async function imageRun(element:Element,width:number):Promise<ImageRun>{
 const svg=element.localName==='svg',view=svg?(element.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number):[],source=element.getAttribute('src')||'';
 // Percent encoding avoids both btoa's Latin-1 restriction and argument limits on large diagrams.
 let src=svg?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(element)):source;
 if(!src.startsWith('data:'))throw Error('Unresolved image');
 let naturalWidth=0,naturalHeight=0;
 if(svg){
  naturalWidth=parseFloat(element.getAttribute('width')||'')||view[2]||640;naturalHeight=parseFloat(element.getAttribute('height')||'')||view[3]||320;
  // Mermaid often writes width="100%". Its viewBox defines the actual pixel dimensions.
  if(element.getAttribute('width')?.endsWith('%'))naturalWidth=view[2]||640;
  const copy=element.cloneNode(true) as Element;copy.setAttribute('width',String(naturalWidth));copy.setAttribute('height',String(naturalHeight));copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
  src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(copy));
 }
 const image=await decoded(src);naturalWidth ||= image.naturalWidth;naturalHeight ||= image.naturalHeight;
 const explicit=svg?naturalWidth:Number(element.getAttribute('width'))||naturalWidth,displayWidth=Math.min(explicit,width/15),displayHeight=naturalHeight*displayWidth/naturalWidth;
 const mime=/^data:image\/([^;,]+)/i.exec(src)?.[1]?.toLowerCase(),type=mime==='jpeg'||mime==='jpg'?'jpg':mime==='gif'?'gif':mime==='png'?'png':'png';
 let data:Uint8Array;
 if(!svg&&['png','jpeg','jpg','gif'].includes(mime||''))data=bytesFromURL(src);
 else{
  const canvas=document.createElement('canvas'),scale=svg?2:1;
  canvas.width=Math.max(1,Math.ceil(displayWidth*scale));canvas.height=Math.max(1,Math.ceil(displayHeight*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');ctx.drawImage(image,0,0,canvas.width,canvas.height);data=bytesFromURL(canvas.toDataURL('image/png'));
 }
 return new ImageRun({type,data,transformation:{width:displayWidth,height:displayHeight},altText:{title:element.getAttribute('alt')||'',description:element.getAttribute('alt')||'',name:svg?'Mermaid':'Image'}});
}

/** Convert a resolved renderDelivery DOM. The caller awaits waitImages before handing it over. */
export async function exportDOCX(root:HTMLElement,title:string,language='zh-CN'):Promise<Uint8Array>{
 const lists:NonNullable<INumberingOptions['config']>[number][]=[],footnotes:Record<string,{children:Paragraph[]}>={},definitions=new Map<string,Element>();let listID=0,noteID=0,lastYield=performance.now();
 const bookmarks=new Map<string,string>();for(const heading of root.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'))bookmarks.set(heading.id,'liubai_heading_'+(bookmarks.size+1));
 for(const definition of root.querySelectorAll('.footnotes li[id]'))definitions.set(definition.id,definition);
 const yieldUI=async()=>{if(performance.now()-lastYield>=8){await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now()}};
 const inline=async(nodes:Iterable<Node>,context:Context,style:IRunOptions={}):Promise<ParagraphChild[]>=>{
  const out:ParagraphChild[]=[];
  for(const node of nodes){
   await yieldUI();
   if(node.nodeType===3){
    // HTML collapses white space outside code: line breaks and runs of spaces from the Markdown source are one space, none at a paragraph's ends. Word and Pages would keep them.
    let text=node.textContent||'';const ws=context.space;
    if(ws&&style.font!==codeFont){
     text=text.replace(/[ \t\r\n\f]+/g,' ');
     if(text.startsWith(' ')){if(!ws.start)ws.pending=true;text=text.slice(1)}
     if(text){if(ws.pending)text=' '+text;ws.pending=text.endsWith(' ');if(ws.pending)text=text.slice(0,-1);ws.start=false}
    }else if(ws&&text){if(ws.pending)text=' '+text;ws.pending=false;ws.start=false}
    for(let i=0;i<text.length;i+=4096){out.push(codeRun(text.slice(i,i+4096),style));await yieldUI()}continue;
   }
   if(node.nodeType!==1)continue;const el=node as HTMLElement,tag=el.tagName.toLowerCase();
   const space=context.space,separate=()=>{if(space?.pending){out.push(new TextRun({...style,text:' '}));space.pending=false}if(space)space.start=false};
   if(tag==='br'&&space){space.pending=false;space.start=true}
   else if(tag==='img'||tag==='svg'||tag==='input'||el.classList.contains('math-inline')||el.classList.contains('footnote-ref'))separate();
   if(el.classList.contains('footnote-backref')||tag==='svg'&&el.closest('.markdown-alert-title'))continue;
   if(el.classList.contains('footnote-ref')&&!context.inFootnote){
    const link=el.querySelector('a'),key=link?.getAttribute('href')?.slice(1)||'',definition=definitions.get(key);
    if(definition){const id=++noteID;out.push(new FootnoteReferenceRun(id));const blocks=await blockChildren(definition,{level:0,width:textWidth,inFootnote:true});footnotes[id]={children:blocks.filter((p):p is Paragraph=>p instanceof Paragraph)};continue}
   }
   if(el.classList.contains('math-inline')||el.classList.contains('math-display')){out.push(formula(el));continue}
   if(tag==='br'){out.push(new TextRun({break:1}));continue}
   if(tag==='img'||tag==='svg'){try{out.push(await imageRun(el,context.width))}catch{out.push(new TextRun({...style,text:el.getAttribute('alt')||el.textContent||''}))}continue}
   if(tag==='input'){out.push(new TextRun({...style,text:el.hasAttribute('checked')?'☑':'☐'}));continue}
   const next:{-readonly [K in keyof IRunOptions]:IRunOptions[K]}={...style};
   if(tag==='b'||tag==='strong'||tag==='summary')next.bold=true;
   if(tag==='i'||tag==='em')next.italics=true;
   if(tag==='u'||tag==='ins')next.underline={};
   if(['s','strike','del'].includes(tag))next.strike=true;
   if(tag==='mark')next.highlight='yellow';
   if(tag==='sup')next.superScript=true;if(tag==='sub')next.subScript=true;
   if(['code','kbd','samp'].includes(tag)){next.font=codeFont;next.size=20;next.shading=shade}
   const href=el.getAttribute('href')||'';
   if(tag==='a'&&/^(https?:\/\/|mailto:|tel:)/i.test(href))out.push(new ExternalHyperlink({link:href,children:await inline(el.childNodes,context,{...next,color:'315F82',underline:{}})}));
   else if(tag==='a'&&href.startsWith('#')){let key=href.slice(1);try{key=decodeURIComponent(key)}catch{}const anchor=bookmarks.get(key),children=await inline(el.childNodes,context,next);out.push(...(anchor?[new InternalHyperlink({anchor,children})]:children))}
   else out.push(...await inline(el.childNodes,context,next));
  }
  return out;
 };
 const paragraph=async(nodes:Iterable<Node>,context:Context,options:IParagraphOptions={})=>{
  const first=context.first&&!context.first.used?context.first:undefined;if(first)first.used=true;
  const children=await inline(nodes,{...context,space:{start:true,pending:false}},context.bold?{bold:true}:{});
  return new Paragraph({children:context.bookmark?[new Bookmark({id:context.bookmark,children})]:children,spacing:{after:160,line:360},...(context.alignment?{alignment:context.alignment}:{}),...(context.indent?{indent:{left:context.indent}}:{}),...(context.box?{border:{left:{...line,color:'809387',size:18,space:8}},...(context.fill?{shading:{fill:context.fill}}:{})}:{}),...first?.options,...options});
 };
 const blockChildren=async(parent:Element,context:Context):Promise<Block[]>=>{
  const out:Block[]=[],pending:Node[]=[];
  const flush=async()=>{if(pending.some(n=>n.nodeType===1||n.textContent?.trim()))out.push(await paragraph(pending,context));pending.length=0};
  for(const node of parent.childNodes){
   await yieldUI();if(node.nodeType!==1){pending.push(node);continue}
   const el=node as HTMLElement,tag=el.tagName.toLowerCase();
   if(el.classList.contains('footnotes')||el.classList.contains('footnote-backref'))continue;
   if(!/^(p|h[1-6]|ul|ol|blockquote|pre|hr|details|summary|table|div|section|figure|dl|dt|dd)$/.test(tag)){pending.push(node);continue}
   await flush();
   if(tag==='p'||/^h[1-6]$/.test(tag))out.push(await paragraph(el.childNodes,{...context,bold:context.bold||el.classList.contains('markdown-alert-title'),bookmark:bookmarks.get(el.id)},{...(/^h[1-6]$/.test(tag)?{heading:HeadingLevel[('HEADING_'+tag[1]) as keyof typeof HeadingLevel]}:{}),...(['center','right','left'].includes(el.getAttribute('align')||'')?{alignment:el.getAttribute('align') as 'center'|'right'|'left'}:{})}));
   else if(tag==='ul'||tag==='ol'){
    const level=Math.min(context.level,8),reference='list-'+ ++listID,ordered=tag==='ol',start=Math.max(1,Math.min(2147483647,Number(el.getAttribute('start'))||1));
    lists.push({reference,levels:Array.from({length:9},(_,i)=>({level:i,format:ordered?LevelFormat.DECIMAL:LevelFormat.BULLET,text:ordered?'%'+(i+1)+'.':['•','◦','▪'][i%3],start:i===level?start:1,style:{paragraph:{indent:{left:720*(i+1),hanging:360}}}}))});
    // An item that begins with a nested block still needs its own numbered paragraph.
    if(context.first&&!context.first.used)out.push(await paragraph([],context));
    for(const item of [...el.children].filter(c=>c.tagName==='LI')){
     const task=!!item.querySelector(':scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]');
     const first={used:false,options:task?{}:{numbering:{reference,level}}};
     const itemContext={...context,first,level:context.level+1,indent:(context.indent||0)+720,width:Math.max(720,context.width-720)};
     const blocks=await blockChildren(item,itemContext);if(!first.used)blocks.unshift(await paragraph([],itemContext));out.push(...blocks);
    }
   }else if(tag==='blockquote'){
    const fill=context.fill||'EDF2EE';
    const colour=/^[A-Fa-f\d]{6}$/.test(fill||'')?fill:'EDF2EE';
    out.push(...await blockChildren(el,{...context,indent:(context.indent||0)+360,box:true,fill:el.classList.contains('markdown-alert')?colour:context.fill,width:Math.max(720,context.width-360)}));
   }else if(tag==='pre'){
    const lines=(el.textContent||'').replace(/\n$/,'').split('\n');
    for(const text of lines)out.push(await paragraph([],context,{children:[codeRun(text,{font:codeFont,size:20})],shading:shade,spacing:{line:240,after:0}}));
   }else if(tag==='hr')out.push(new Paragraph({border:{bottom:line},spacing:{after:200}}));
   else if(tag==='summary')out.push(await paragraph(el.childNodes,{...context,bold:true}));
   else if(tag==='details')out.push(...await blockChildren(el,context));
   else if(tag==='table'){
    if(context.inFootnote){for(const cell of el.querySelectorAll('td,th'))out.push(await paragraph(cell.childNodes,context));continue}
    const rows=[...el.querySelectorAll('tr')].filter(row=>row.closest('table')===el),columns=Math.max(1,...rows.map(row=>[...row.children].reduce((n,c)=>n+(Number(c.getAttribute('colspan'))||1),0))),cellWidth=context.width/columns,tableRows:TableRow[]=[];
    for(const row of rows){const cells:TableCell[]=[];for(const cell of row.children){
     const span=Math.max(1,Number(cell.getAttribute('colspan'))||1),children=await blockChildren(cell,{...context,width:cellWidth*span-200,indent:undefined,bold:cell.tagName==='TH',first:undefined,alignment:((cell as HTMLElement).style.textAlign||cell.getAttribute('align')||'left') as 'left'|'center'|'right'});
     cells.push(new TableCell({children:children.length?children:[new Paragraph('')],columnSpan:span,width:{size:cellWidth*span,type:WidthType.DXA},...(cell.tagName==='TH'?{shading:{fill:'EDF0E9'}}:{})}));
    }tableRows.push(new TableRow({children:cells,tableHeader:[...row.children].every(cell=>cell.tagName==='TH')}))}
    if(tableRows.length)out.push(new Table({rows:tableRows,width:{size:context.width,type:WidthType.DXA},columnWidths:Array.from({length:columns},()=>cellWidth),borders:{top:line,bottom:line,left:line,right:line,insideHorizontal:line,insideVertical:line}}));
   }else if(el.classList.contains('math-display'))out.push(await paragraph([el],context,{alignment:AlignmentType.CENTER}));
   else if(el.classList.contains('rendered-mermaid')&&el.querySelector('svg'))out.push(await paragraph([el.querySelector('svg')!],context));
   else out.push(...await blockChildren(el,context));
  }
  await flush();return out;
 };
 await new Promise(resolve=>setTimeout(resolve,0));
 const children=await blockChildren(root,{level:0,width:textWidth});
 const headingStyles=Object.fromEntries(Array.from({length:6},(_,i)=>['heading'+(i+1),{run:{font:{...bodyFont,eastAsia:'黑体'},bold:true,size:[32,28,26,24,22,22][i]},paragraph:{spacing:{before:240,after:120},keepNext:true}}])); // i18n-ignore: fixed OOXML font name

 const doc=new Document({title,creator:'Liubai',styles:{default:{document:{run:{font:bodyFont,size:22,language:{value:language,eastAsia:'zh-CN'}},paragraph:{spacing:{line:360,after:160}}},...headingStyles}},numbering:{config:lists},footnotes,sections:[{properties:{page:{size:{width:pageWidth,height:pageHeight},margin:{top:margin,bottom:margin,left:margin,right:margin}}},children:children.length?children:[new Paragraph('')]}]});
 doc.CoreProperties.addChildElement(new StringContainer('dc:language',language));
 await new Promise(resolve=>setTimeout(resolve,0));
 return new Uint8Array(await Packer.toArrayBuffer(doc));
}
