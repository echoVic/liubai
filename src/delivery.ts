import {normalizeImageDestination,renderMarkdown} from './markdown';
export interface Delivery {title:string;content:string;images:Record<string,string>;missing:string[];external:number}
export function renderDelivery(data:Delivery){
 const images=new Map(Object.entries(data.images).map(([src,value])=>[normalizeImageDestination(src),value]));
 const {root}=renderMarkdown(data.content,{resolve:destination=>images.get(destination),external:'link'});
 root.className='delivery-document';
 for(const img of root.querySelectorAll('img')){img.removeAttribute('data-image-source');img.style.maxWidth='100%'}
 for(const note of root.querySelectorAll('.markdown-image-note'))note.className='delivery-image-note';
 for(const el of root.querySelectorAll('.task-list, .task-list-item')){
  el.classList.remove('task-list','task-list-item');if(!el.className)el.removeAttribute('class');
 }
 for(const el of root.querySelectorAll('[data-line], [data-line-end]')){el.removeAttribute('data-line');el.removeAttribute('data-line-end')}
 for(const a of root.querySelectorAll('a')){a.rel='noopener noreferrer'}
 const styles:Record<string,string>={h1:'font-size:30px;line-height:1.5;margin:24px 0 18px',h2:'font-size:24px;line-height:1.5;margin:24px 0 14px',h3:'font-size:20px;line-height:1.6',p:'line-height:1.9;margin:14px 0',blockquote:'border-left:3px solid #809387;padding-left:16px;color:#45574c',pre:'background:#f1f2ef;padding:16px;white-space:pre-wrap;font-family:monospace;font-size:13px',table:'border-collapse:collapse;width:100%;margin:20px 0',th:'border:1px solid #cdd2cc;padding:9px;text-align:left;background:#edf0e9',td:'border:1px solid #cdd2cc;padding:9px;text-align:left',code:'font-family:monospace',a:'color:#315f82;text-decoration:underline'};
 for(const [tag,style]of Object.entries(styles))root.querySelectorAll(tag).forEach(el=>el.setAttribute('style',style+';'+(el.getAttribute('style')||'')));
 root.querySelectorAll('input[type=checkbox]').forEach(el=>el.setAttribute('style','margin:0 8px 0 0;vertical-align:middle'));
 root.style.cssText='font-family:PingFang SC,Noto Sans CJK SC,sans-serif;font-size:16px;line-height:1.9;color:#242523;background:#fff;overflow-wrap:anywhere';
 return root;
}
export async function waitImages(root:HTMLElement){await Promise.all([...root.querySelectorAll('img')].map(img=>new Promise<void>((resolve,reject)=>{if(img.complete){img.naturalWidth?resolve():reject(Error('图片无法解码'));return}const timeout=setTimeout(()=>reject(Error('图片加载超时')),10000);img.onload=()=>{clearTimeout(timeout);resolve()};img.onerror=()=>{clearTimeout(timeout);reject(Error('图片无法解码'))}})))}
export async function copyRich(root:HTMLElement){
 const html=root.outerHTML,text=root.innerText;
 if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
  await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]);return;
 }
 const listener=(e:ClipboardEvent)=>{e.preventDefault();e.clipboardData?.setData('text/html',html);e.clipboardData?.setData('text/plain',text)};
 document.addEventListener('copy',listener);try{if(!document.execCommand('copy'))throw Error('剪贴板不可用，请下载 HTML')}finally{document.removeEventListener('copy',listener)}
}
