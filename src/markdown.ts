import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import footnote from 'markdown-it-footnote';
import type {PluginSimple} from 'markdown-it';

export interface MarkdownOptions {
 resolve: (destination:string)=>string|undefined|Promise<string|undefined>;
 external: 'load'|'link';
 frontMatter?: 'show'|'hide';
}

export interface MarkdownRender {
 root: HTMLElement;
 ready: Promise<void>;
 dispose: ()=>void;
}

const parser=new MarkdownIt({html:true,linkify:true,typographer:false});
parser.linkify.set({fuzzyLink:false,fuzzyEmail:false,fuzzyIP:false});
parser.linkify.add('www.',{
 validate(text,pos,self){
  const match=new RegExp('^'+self.re.src_host_port_strict+self.re.src_path,'i').exec(text.slice(pos-4));
  return match?match[0].length-4:0;
 },
 normalize(match){match.url='http://'+match.url},
});

export function splitFrontMatter(content:string):{raw:string|null;body:string;lines:number} {
 if(content.startsWith('---\n')){
  const lines=content.split('\n',200);
  let end=4;
  for(let i=1;i<lines.length;i++){
   end+=lines[i].length;
   if(lines[i]==='---'||lines[i]==='...')return {raw:content.slice(0,end),body:content.slice(end+(content[end]==='\n'?1:0)),lines:i+1};
   end++;
  }
 }
 return {raw:null,body:content,lines:0};
}

export function headingSlug(text:string,used:Map<string,number>):string {
 const base=text.toLowerCase().replace(/[\p{P}\p{S}]/gu,'').trim().replace(/\s+/g,'-');
 const count=used.get(base)||0;
 used.set(base,count+1);
 return base+(count?`-${count}`:'');
}

const allowedTags='a abbr b blockquote br caption center code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q s samp section small span strike strong sub summary sup table tbody td tfoot th thead tr u ul var'.split(' ');
const allowedAttributes='href src alt title width height align valign colspan rowspan open id class start reversed type checked disabled aria-label aria-hidden lang dir datetime cite scope data-line data-line-end data-image-source'.split(' ');
if(DOMPurify.addHook)DOMPurify.addHook('uponSanitizeAttribute',(_node,data)=>{
 if(data.attrName==='class')data.attrValue=data.attrValue.split(/\s+/).filter(value=>/^(md-|language-|task-list|contains-task-list|footnote|markdown-alert)/.test(value)).join(' ');
});

function lineAttributes(map:[number,number]|null):string {
 if(!map)return '';
 return ` data-line="${map[0]}" data-line-end="${Math.max(map[0],map[1]-1)}"`;
}

const lineMapPlugin:PluginSimple=md=>{
 md.core.ruler.after('block','liubai_line_maps',state=>{
  const offset=state.env.lineOffset||0;
  for(const token of state.tokens){
   if(token.map)token.map=[token.map[0]+offset,token.map[1]+offset];
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
  return `<pre class="md-pre"${lineAttributes(token.map)}><code${className}>${md.utils.escapeHtml(token.content)}</code></pre>\n`;
 };
 md.renderer.rules.code_block=(tokens,index)=>
  `<pre class="md-pre"${lineAttributes(tokens[index].map)}><code>${md.utils.escapeHtml(tokens[index].content)}</code></pre>\n`;
};

const taskPlugin:PluginSimple=md=>{
 md.core.ruler.after('inline','liubai_task_items',state=>{
  const items:{index:number;level:number;seenParagraph:boolean;inFirstParagraph:boolean}[]=[];
  const lists:number[]=[];
  for(let index=0;index<state.tokens.length;index++){
   const token=state.tokens[index];
   if(token.type==='bullet_list_open'||token.type==='ordered_list_open')lists.push(index);
   else if(token.type==='bullet_list_close'||token.type==='ordered_list_close')lists.pop();
   else if(token.type==='list_item_open')items.push({index,level:token.level,seenParagraph:false,inFirstParagraph:false});
   else if(token.type==='list_item_close')items.pop();
   else if(items.length&&token.type==='paragraph_open'){
    const item=items[items.length-1];
    if(token.level===item.level+1&&!item.seenParagraph){
     item.seenParagraph=true;
     item.inFirstParagraph=true;
    }
   }else if(items.length&&token.type==='paragraph_close'){
    const item=items[items.length-1];
    if(token.level===item.level+1)item.inFirstParagraph=false;
   }else if(token.type==='inline'&&items.length&&items[items.length-1].inFirstParagraph){
    const match=/^\[([ xX])\]\s+/.exec(token.content);
    const first=token.children?.[0];
    if(!match||first?.type!=='text'||!first.content.startsWith(match[0]))continue;
    first.content=first.content.slice(match[0].length);
    token.content=token.content.slice(match[0].length);
    const checked=match[1].toLowerCase()==='x';
    const checkbox=new state.Token('html_inline','',0);
    checkbox.content=`<input type="checkbox" disabled${checked?' checked':''} aria-label="${checked?'已完成':'未完成'}"> `;
    token.children?.unshift(checkbox);
    const item=state.tokens[items[items.length-1].index];
    item.attrJoin('class','md-task');
    item.meta={...item.meta,liubaiTask:match[1].toLowerCase()==='x'};
    item.attrJoin('class','task-list-item');
    if(lists.length)state.tokens[lists[lists.length-1]].attrJoin('class','task-list');
   }
  }
 });
};

const semanticClassPlugin:PluginSimple=md=>{
 md.core.ruler.after('liubai_task_items','liubai_semantic_classes',state=>{
  for(const token of state.tokens){
   if(token.type==='heading_open')token.attrJoin('class',`md-${token.tag}`);
   else if(token.type==='paragraph_open')token.attrJoin('class','md-p');
   else if(token.type==='blockquote_open')token.attrJoin('class','md-quote');
   else if(token.type==='table_open')token.attrJoin('class','md-table');
   else if(token.type==='bullet_list_open')token.attrJoin('class','md-ul');
   else if(token.type==='ordered_list_open')token.attrJoin('class','md-ol');
   for(const child of token.children||[]){
    if(child.type==='code_inline')child.attrJoin('class','md-inline-code');
    else if(child.type==='link_open')child.attrJoin('class','md-link');
    else if(child.type==='image')child.attrJoin('class','md-image');
   }
  }
 });
};

const githubAlerts:PluginSimple=md=>{
 md.core.ruler.after('inline','liubai_github_alerts',state=>{
  const titles:Record<string,string>={note:'说明',tip:'提示',important:'重要',warning:'警告',caution:'注意'};
  for(let i=state.tokens.length-1;i>=0;i--){
   const open=state.tokens[i],paragraph=state.tokens[i+1],inline=state.tokens[i+2];
   if(open.type!=='blockquote_open'||paragraph?.type!=='paragraph_open'||inline?.type!=='inline')continue;
   const first=inline.children?.[0];
   const match=first?.type==='text'&&/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+|$)/i.exec(first.content);
   if(!match||!first)continue;
   const kind=match[1].toLowerCase();
   open.attrJoin('class',`markdown-alert markdown-alert-${kind}`);
   first.content=first.content.slice(match[0].length);
   if(!first.content){
    inline.children!.shift();
    if(inline.children?.[0]?.type==='softbreak')inline.children.shift();
   }
   inline.content=inline.content.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i,'');
   const title=new state.Token('html_block','',0);
   title.content=`<p class="markdown-alert-title">${titles[kind]}</p>\n`;
   state.tokens.splice(i+1,0,title);
  }
 });
};

parser.use(footnote).use(lineMapPlugin).use(taskPlugin).use(semanticClassPlugin).use(githubAlerts);
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
 const meta=splitFrontMatter(content);
 const rendered=parser.render(meta.body,{lineOffset:meta.lines});
 const properties=meta.raw!==null&&options.frontMatter!=='hide'?`<details class="md-front-matter" data-line="0" data-line-end="${meta.lines-1}"><summary>文稿属性</summary><pre>${parser.utils.escapeHtml(meta.raw)}</pre></details>`:'';
 const template=document.createElement('template');
 template.innerHTML=DOMPurify.sanitize(properties+rendered,{ALLOWED_TAGS:allowedTags,ALLOWED_ATTR:allowedAttributes,ADD_URI_SAFE_ATTR:['data-image-source','data-line','data-line-end'],ALLOW_DATA_ATTR:false,FORBID_ATTR:['style']});
 for(const input of template.content.querySelectorAll('input')){
  if(input.type!=='checkbox')input.remove();
  else input.disabled=true;
 }
 for(const image of template.content.querySelectorAll<HTMLImageElement>('img[src]')){
  if(!image.hasAttribute('data-image-source'))image.dataset.imageSource=parser.normalizeLink(image.getAttribute('src')||'');
  image.removeAttribute('src');
 }
 root.append(template.content);
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
