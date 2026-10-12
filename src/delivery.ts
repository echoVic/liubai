import MarkdownIt from 'markdown-it';
export interface Delivery {title:string;content:string;images:Record<string,string>;missing:string[];external:number}
const parser=new MarkdownIt({html:false,linkify:false,typographer:false});
// Move image destinations out of src before creating DOM, so detached images
// cannot start network requests during the short interval before replacement.
const imageRule=parser.renderer.rules.image!;
parser.renderer.rules.image=(tokens,index,options,env,self)=>{
 const token=tokens[index],src=token.attrGet('src')||'';token.attrSet('data-image-source',src);
 token.attrs=token.attrs?.filter(([name])=>name!=='src')||null;
 return imageRule(tokens,index,options,env,self);
};
export function renderDelivery(data:Delivery){
 const root=document.createElement('article');root.className='delivery-document';root.innerHTML=parser.render(data.content);
 const images=new Map(Object.entries(data.images).map(([src,value])=>[parser.normalizeLink(src),value]));
 for(const img of root.querySelectorAll('img')){
  const src=img.getAttribute('data-image-source')||'';const local=images.get(src);img.removeAttribute('data-image-source');
  if(local){img.src=local;img.style.maxWidth='100%';continue}
  // Keep external/missing resources explicit. Do not silently load URLs while
  // printing or copying a document that has never requested those resources.
  const label=document.createElement('span');label.className='delivery-image-note';
  if(/^(https?:)?\/\//i.test(src)){const a=document.createElement('a');a.href=src;a.textContent=(img.alt||'外链图片')+'（联网查看）';label.append(a)}
  else label.textContent='图片缺失：'+(img.alt||src)+' · '+src;
  img.replaceWith(label);
 }
 for(const a of root.querySelectorAll('a')){a.rel='noopener noreferrer'}
 const styles:Record<string,string>={h1:'font-size:30px;line-height:1.5;margin:24px 0 18px',h2:'font-size:24px;line-height:1.5;margin:24px 0 14px',h3:'font-size:20px;line-height:1.6',p:'line-height:1.9;margin:14px 0',blockquote:'border-left:3px solid #809387;padding-left:16px;color:#45574c',pre:'background:#f1f2ef;padding:16px;white-space:pre-wrap;font-family:monospace;font-size:13px',table:'border-collapse:collapse;width:100%;margin:20px 0',th:'border:1px solid #cdd2cc;padding:9px;text-align:left;background:#edf0e9',td:'border:1px solid #cdd2cc;padding:9px;text-align:left',code:'font-family:monospace',a:'color:#315f82;text-decoration:underline'};
 for(const [tag,style]of Object.entries(styles))root.querySelectorAll(tag).forEach(el=>el.setAttribute('style',style+';'+(el.getAttribute('style')||'')));
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
