import {copyRich,prepareRichClipboard,renderDelivery} from '../src/delivery';
import {htmlToMarkdown} from '../src/paste';

function assert(value:unknown,message:string):asserts value{
 if(!value)throw Error(message);
}

export function runNativePasteChecks(html:string,plain:string){
 const {markdown}=htmlToMarkdown(html,plain);
 const root=renderDelivery({title:'反向粘贴',content:markdown,images:{},missing:[],external:0});
 assert(root.querySelector('strong')?.textContent==='中文标题','Cocoa reverse paste has an unclosed bold marker');
 assert(root.querySelector('table td')?.textContent==='中文内容','Cocoa reverse paste has broken table rows');
 assert(!markdown.includes('.node{')&&markdown.includes('E=mc^2'),'Cocoa reverse paste text changed');
 return 'PASS: AppKit HTML reverse paste retains closed emphasis and valid Markdown table rows';
}

export async function runRichClipboardChecks(){
 const root=renderDelivery({title:'中文交付',content:'# 中文标题\n\n**粗体**和*斜体* [链接](https://example.com)\n\n- 项目甲\n- 项目乙\n\n| 表头 |\n| --- |\n| 中文内容 |\n\n公式 $E=mc^2$。\n',images:{},missing:[],external:0});
 const diagram=document.createElement('div');diagram.className='rendered-mermaid';
 diagram.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 160 80"><style>.node{fill:#edf2ee;stroke:#315f82}</style><rect class="node" x="1" y="1" width="158" height="78"/><text x="10" y="45">中文流程图</text></svg>';
 root.append(diagram);document.body.append(root);
 const original=root.outerHTML;
 let copied:Record<string,Blob>={};
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
 const originalItem=globalThis.ClipboardItem;
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async(items:ClipboardItem[])=>{
  for(const type of items[0].types)copied[type]=await items[0].getType(type);
 }}});
 // WKWebView file pages do not expose ClipboardItem; emulate only this platform boundary.
 if(!originalItem)globalThis.ClipboardItem=class{
  readonly types:string[];
  constructor(private data:Record<string,Blob>){this.types=Object.keys(data)}
  async getType(type:string){return this.data[type]}
 } as typeof ClipboardItem;
 try{await copyRich(await prepareRichClipboard(root))}finally{
  if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete (navigator as Partial<Navigator>).clipboard;
  globalThis.ClipboardItem=originalItem;
 }
 const html=await copied['text/html'].text(),text=await copied['text/plain'].text();
 assert(/<meta\s+charset=["']?utf-8/i.test(html),'rich clipboard has no UTF-8 declaration: AppKit imports Chinese as Latin-1');
 const body=new DOMParser().parseFromString(html,'text/html').body;
 assert(body.querySelector('h1')?.textContent==='中文标题','Chinese heading changed');
 assert(body.querySelector('strong')&&body.querySelector('em')&&body.querySelector('a')&&body.querySelector('ul li')&&body.querySelector('table td'),'basic rich formatting lost');
 assert(!body.querySelector('svg,style,math,annotation'),'unsupported SVG/MathML leaks style or duplicate formula into native text');
 const img=body.querySelector('img')!;
 assert(img?.src.startsWith('data:image/png;base64,'),'diagram is not a portable PNG');
 const decoded=new Image();decoded.src=img.src;await decoded.decode();
 assert(decoded.naturalWidth===320&&decoded.naturalHeight===160,'percentage SVG width was not rasterized at its viewBox aspect ratio');
 assert(body.textContent?.includes('E=mc^2')&&(body.textContent.match(/E=mc\^2/g)||[]).length===1,'formula source lost or duplicated');
 assert(text.includes('中文标题')&&text.includes('中文流程图')&&!text.includes('.node{')&&(text.match(/E=mc\^2/g)||[]).length===1,'plain clipboard text includes styles or duplicate math: '+text);
 assert(root.outerHTML===original,'clipboard conversion mutated the PDF/HTML delivery document');
 root.remove();
 return {html,text,result:'PASS: UTF-8 rich clipboard, basic formatting, PNG diagram, single formula and unmodified export DOM'};
}
