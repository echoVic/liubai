import MarkdownIt from 'markdown-it';
import type {PluginSimple} from 'markdown-it';

export interface MarkdownOptions {
 resolve: (destination:string)=>string|undefined|Promise<string|undefined>;
 external: 'load'|'link';
}

export interface MarkdownRender {
 root: HTMLElement;
 ready: Promise<void>;
 dispose: ()=>void;
}

const parser=new MarkdownIt({html:false,linkify:false,typographer:false});

function lineAttributes(map:[number,number]|null):string {
 if(!map)return '';
 return ` data-line="${map[0]}" data-line-end="${Math.max(map[0],map[1]-1)}"`;
}

const lineMapPlugin:PluginSimple=md=>{
 md.core.ruler.after('block','liubai_line_maps',state=>{
  for(const token of state.tokens){
   if(!token.block||!token.map||token.hidden||token.type==='fence'||token.type==='code_block')continue;
   if(token.nesting===1||token.nesting===0){
    token.attrSet('data-line',String(token.map[0]));
    token.attrSet('data-line-end',String(Math.max(token.map[0],token.map[1]-1)));
   }
  }
 });
 md.renderer.rules.fence=(tokens,index,options)=>{
  const token=tokens[index];
  const info=token.info?md.utils.unescapeAll(token.info).trim():'';
  const language=info.split(/\s+/g)[0];
  const className=language?` class="${options.langPrefix}${md.utils.escapeHtml(language)}"`:'';
  return `<pre${lineAttributes(token.map)}><code${className}>${md.utils.escapeHtml(token.content)}</code></pre>\n`;
 };
 md.renderer.rules.code_block=(tokens,index)=>
  `<pre${lineAttributes(tokens[index].map)}><code>${md.utils.escapeHtml(tokens[index].content)}</code></pre>\n`;
};

const taskPlugin:PluginSimple=md=>{
 md.core.ruler.after('inline','liubai_task_items',state=>{
  const items:number[]=[];
  const lists:number[]=[];
  for(let index=0;index<state.tokens.length;index++){
   const token=state.tokens[index];
   if(token.type==='bullet_list_open'||token.type==='ordered_list_open')lists.push(index);
   else if(token.type==='bullet_list_close'||token.type==='ordered_list_close')lists.pop();
   else if(token.type==='list_item_open')items.push(index);
   else if(token.type==='list_item_close')items.pop();
   else if(token.type==='inline'&&items.length){
    const match=/^\[([ xX])\]\s+/.exec(token.content);
    const first=token.children?.[0];
    if(!match||first?.type!=='text'||!first.content.startsWith(match[0]))continue;
    first.content=first.content.slice(match[0].length);
    token.content=token.content.slice(match[0].length);
    const item=state.tokens[items[items.length-1]];
    item.meta={...item.meta,liubaiTask:match[1].toLowerCase()==='x'};
    item.attrJoin('class','task-list-item');
    if(lists.length)state.tokens[lists[lists.length-1]].attrJoin('class','task-list');
   }
  }
 });
 md.renderer.rules.list_item_open=(tokens,index,options,env,self)=>{
  const checked=tokens[index].meta?.liubaiTask===true;
  const task=tokens[index].meta?.liubaiTask===false||checked;
  const checkbox=task?`<input type="checkbox" disabled${checked?' checked':''} aria-label="${checked?'已完成':'未完成'}"> `:'';
  return self.renderToken(tokens,index,options)+checkbox;
 };
};

parser.use(lineMapPlugin).use(taskPlugin);
const imageRule:NonNullable<(typeof parser.renderer.rules)['image']>=(tokens,index,options,env,self)=>{
 const token=tokens[index];
 const source=token.attrGet('src')||'';
 token.attrSet('alt',self.renderInlineAsText(token.children||[],options,env));
 token.attrSet('data-image-source',source);
 token.attrs=token.attrs?.filter(([name])=>name!=='src')||null;
 return `<img${self.renderAttrs(token)}>`;
};
parser.renderer.rules.image=imageRule;

function imageNotice(image:HTMLImageElement,source:string,kind:'missing'|'error'|'external'):HTMLElement {
 const label=document.createElement('span');
 label.className='markdown-image-note';
 if(kind==='external'){
  const link=document.createElement('a');
  link.href=source;
  link.textContent=(image.alt||'外链图片')+'（联网查看）';
  label.append(link);
 }else{
  label.textContent=(kind==='missing'?'图片缺失：':'图片无法读取：')+(image.alt||source)+' · '+source;
 }
 return label;
}

function isExternal(source:string):boolean {
 return /^(https?:)?\/\//i.test(source);
}

function isPromise<T>(value:T|Promise<T>):value is Promise<T> {
 return typeof value==='object'&&value!==null&&'then' in value;
}

export function renderMarkdown(content:string,options:MarkdownOptions):MarkdownRender {
 const root=document.createElement('article');
 root.className='markdown-document';
 root.innerHTML=parser.render(content);
 let active=true;
 const pending:Promise<void>[]=[];

 const install=(image:HTMLImageElement,source:string,url:string|undefined)=>{
  if(!active)return;
  if(url)image.src=url;
  else image.replaceWith(imageNotice(image,source,'missing'));
 };
 const fail=(image:HTMLImageElement,source:string)=>{
  if(active)image.replaceWith(imageNotice(image,source,'error'));
 };

 for(const image of root.querySelectorAll<HTMLImageElement>('img[data-image-source]')){
  const source=image.dataset.imageSource||'';
  if(isExternal(source)){
   if(options.external==='load')image.src=source;
   else image.replaceWith(imageNotice(image,source,'external'));
   continue;
  }
  try{
   const resolved=options.resolve(source);
   if(isPromise(resolved)){
    pending.push(Promise.resolve(resolved).then(
     url=>install(image,source,url),
     ()=>fail(image,source),
    ));
   }else install(image,source,resolved);
  }catch{
   fail(image,source);
  }
 }

 return {
  root,
  ready:Promise.all(pending).then(()=>{}),
  dispose:()=>{active=false},
 };
}

export function normalizeImageDestination(destination:string):string {
 return parser.normalizeLink(destination);
}
