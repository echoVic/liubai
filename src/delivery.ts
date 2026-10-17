import {messages} from './i18n';
import type {MathOutput} from './math';
import {normalizeImageDestination,renderMarkdown,headingSlug} from './markdown';
export interface Delivery {title:string;content:string;images:Record<string,string>;missing:string[];external:number}
export function renderDelivery(data:Delivery,mathOutput:MathOutput='mathml'){
 const images=new Map(Object.entries(data.images).map(([src,value])=>[normalizeImageDestination(src),value]));
 const {root}=renderMarkdown(data.content,{resolve:destination=>images.get(destination),external:'link',frontMatter:'hide',mathOutput});
 root.className='delivery-document';
 const used=new Map<string,number>();
 for(const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6'))heading.id=headingSlug(heading.textContent||'',used);
 for(const img of root.querySelectorAll('img')){img.removeAttribute('data-image-source');img.style.maxWidth='100%';img.style.height='auto'}
 for(const note of root.querySelectorAll('.markdown-image-note'))note.className='delivery-image-note';
 for(const el of root.querySelectorAll('.task-list, .task-list-item')){
  el.classList.remove('task-list','task-list-item');if(!el.className)el.removeAttribute('class');
 }
 for(const el of root.querySelectorAll('[class]')){
  for(const className of [...el.classList])if(className.startsWith('md-'))el.classList.remove(className);
  if(!el.className)el.removeAttribute('class');
 }
 for(const el of root.querySelectorAll('[data-line], [data-line-end]')){el.removeAttribute('data-line');el.removeAttribute('data-line-end')}
 for(const a of root.querySelectorAll('a')){a.rel='noopener noreferrer'}
 const styles:Record<string,string>={mark:'background:#eee2a5;color:inherit;-webkit-print-color-adjust:exact;print-color-adjust:exact',u:'text-decoration:underline',sup:'vertical-align:super;font-size:.75em;line-height:0',sub:'vertical-align:sub;font-size:.75em;line-height:0',h1:'font-size:30px;line-height:1.5;margin:24px 0 18px',h2:'font-size:24px;line-height:1.5;margin:24px 0 14px',h3:'font-size:20px;line-height:1.6',p:'line-height:1.9;margin:14px 0',blockquote:'border-left:3px solid #809387;padding-left:16px;color:#45574c',pre:'background:#f1f2ef;padding:16px;white-space:pre-wrap;font-family:monospace;font-size:13px',table:'border-collapse:collapse;width:100%;margin:20px 0',hr:'height:0;border:0;border-top:1px solid #cdd2cc;margin:24px 0',th:'border:1px solid #cdd2cc;padding:9px;text-align:left;background:#edf0e9',td:'border:1px solid #cdd2cc;padding:9px;text-align:left',code:'font-family:monospace',a:'color:#315f82;text-decoration:underline'};
 for(const [tag,style]of Object.entries(styles))root.querySelectorAll(tag).forEach(el=>el.setAttribute('style',style+';'+(el.getAttribute('style')||'')));
 const readerStyles:Record<string,string>={'.markdown-alert':'border-left:3px solid #809387;background:#edf2ee;padding:12px 16px;margin:18px 0','.markdown-alert-title':'font-weight:700;margin:0 0 8px',kbd:'border:1px solid #cdd2cc;border-radius:4px;padding:2px 5px;font-family:monospace;background:#f1f2ef','section.footnotes':'font-size:13px'};
 for(const [selector,style] of Object.entries(readerStyles))root.querySelectorAll(selector).forEach(el=>el.setAttribute('style',style));
 root.querySelectorAll('input[type=checkbox]').forEach(el=>el.setAttribute('style','margin:0 8px 0 0;vertical-align:middle'));
 root.style.cssText='font-family:PingFang SC,Noto Sans CJK SC,sans-serif;font-size:16px;line-height:1.9;color:#242523;background:#fff;overflow-wrap:anywhere';
 return root;
}
export async function waitImages(root:HTMLElement){await Promise.all([...root.querySelectorAll('img')].map(img=>new Promise<void>((resolve,reject)=>{if(img.complete){img.naturalWidth?resolve():reject(Error(messages.fTheImageCouldNotBeDecoded()));return}const timeout=setTimeout(()=>reject(Error(messages.fTheImageTookTooLongToLoad())),10000);img.onload=()=>{clearTimeout(timeout);resolve()};img.onerror=()=>{clearTimeout(timeout);reject(Error(messages.fTheImageCouldNotBeDecoded()))}})))}
export async function copyRich(root:HTMLElement){
 const html=root.outerHTML,text=root.innerText;
 if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
  await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]);return;
 }
 const listener=(e:ClipboardEvent)=>{e.preventDefault();e.clipboardData?.setData('text/html',html);e.clipboardData?.setData('text/plain',text)};
 document.addEventListener('copy',listener);try{if(!document.execCommand('copy'))throw Error(messages.fClipboardUnavailableDownloadHTMLInstead())}finally{document.removeEventListener('copy',listener)}
}
