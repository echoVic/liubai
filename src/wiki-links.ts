import {InlineContext,type MarkdownConfig,type MarkdownParser} from '@lezer/markdown';
import {NodeProp,Tree,type SyntaxNode} from '@lezer/common';
import MarkdownIt,{type PluginSimple} from 'markdown-it';
import footnote from 'markdown-it-footnote';

export interface WikiSyntaxMatch {target:string;end:number}
const scheme='liubai-wiki:';
function name(text:string):string|null {
 if(/[\p{Cc}\[\]|]/u.test(text))return null;
 for(const ch of text){const scalar=ch.codePointAt(0)!;if(scalar>=0xd800&&scalar<=0xdfff)return null}
 const target=text.trim();
 return target&&Array.from(target).length<=256?target:null;
}
export function wikiAt(text:string,start:number):WikiSyntaxMatch|null {
 if(text.slice(start,start+2)!=='[['||text[start-1]==='[')return null;
 let slashes=0;for(let i=start-1;i>=0&&text[i]==='\\';i--)slashes++;
 if(slashes%2)return null;
 for(let end=start+2;end<text.length;end++){
  const ch=text[end];
  if(ch==='['||ch==='|'||/[\p{Cc}]/u.test(ch))return null;
  if(ch!==']')continue;
  if(text[end+1]!==']'||text[end+2]===']')return null;
  const target=name(text.slice(start+2,end));
  return target?{target,end:end+2}:null;
 }
 return null;
}
export function wikiURL(target:string):string {return scheme+encodeURIComponent(target)}
export function wikiTarget(url:string):string|null {
 if(!url.startsWith(scheme))return null;
 try{return name(decodeURIComponent(url.slice(scheme.length)))}catch{return null}
}
const excluded=/^(Link|Image|Autolink|URL|InlineCode|FencedCode|CodeBlock|InlineMath|MathBlock|MathFence|MermaidFence|HTMLTag|HTMLBlock|CommentBlock|ProcessingInstructionBlock)$/;
export function wikiNodeAllowed(node:SyntaxNode):boolean {
 for(let parent:SyntaxNode|null=node;parent;parent=parent.parent)if(excluded.test(parent.name))return false;
 return true;
}
// Only examine the current inline region. Invalid nested pairs suppress inner candidates,
// but leave every character to the native parser (including code and math).
function bracketRegionEnd(text:string,start:number):number {
 let depth=1;
 for(let at=start+2;at<text.length;at++){
  if(text[at]==='\n'||text[at]==='\r')return at+1;
  if(text.slice(at,at+2)==='[['){depth++;at++}
  else if(text.slice(at,at+2)===']]'){if(--depth===0)return at+2;at++}
 }
 return text.length;
}
const lezerBlocked=new WeakMap<InlineContext,number>();
const lezerAutolinks=new WeakMap<InlineContext,{index:number;lastIndex:number}[]>();
type NativeContext={references:Record<string,{href:string;title:string}>};
const nativeLinks=new MarkdownIt('commonmark').use(footnote);
// This parser validates Markdown structure only; its tokens are never rendered.
nativeLinks.validateLink=()=>true;
let nativeContext:((parser?:MarkdownParser)=>NativeContext)|undefined;
const referenceDependent=new NodeProp<MarkdownParser>({perNode:true});
function withoutProperties(source:string):string {
 const lines=source.split('\n',200);if(!/^---\r?$/.test(lines[0]))return source;
 let end=lines[0].length+1;
 for(let i=1;i<lines.length;i++){
  end+=lines[i].length;
  if(/^(---|\.\.\.)[ \t\r]*$/.test(lines[i]))return source.slice(end+Number(source[end]==='\n'));
  end++;
 }
 return source;
}
function nativeWikiLabel(raw:string,context?:NativeContext,parser?:MarkdownParser):boolean {
 const env=raw.includes('][')?context||nativeContext?.(parser):undefined;
 return !!nativeLinks.parseInline(raw,env||{}).some(token=>token.children?.[0]?.type==='link_open'||token.children?.[0]?.type==='image');
}
export const WikiSyntax:MarkdownConfig={
 // Only a Wiki-shaped reference suffix needs the document's native reference definitions.
 // Collect them through the block parser lazily, rather than scanning prose for Wiki matches.
 wrap(inner,input,fragments,ranges){
  // A definition edited elsewhere can change a Wiki-shaped native link in a reused paragraph.
  // Reparse only documents that actually asked for the reference catalog on the preceding tree.
  const previousParser=fragments.map(fragment=>fragment.tree.prop(referenceDependent)).find(parser=>parser!==undefined);
  if(previousParser)return previousParser.createParse(input,[],ranges);
  let context:NativeContext|undefined;
  let dependentParser:MarkdownParser|undefined;
  const references=(parser?:MarkdownParser)=>{
   dependentParser=parser;
   if(!context){
    context={references:{}};
    nativeLinks.block.parse(withoutProperties(input.read(0,input.length)),nativeLinks,context,[]);
   }
   return context;
  };
  return {
   advance(){const previous=nativeContext;nativeContext=references;try{const tree=inner.advance();return tree&&dependentParser?new Tree(tree.type,tree.children,tree.positions,tree.length,[...tree.propValues,[referenceDependent,dependentParser]]):tree}finally{nativeContext=previous}},
   get parsedPos(){return inner.parsedPos},get stoppedAt(){return inner.stoppedAt},
   stopAt:pos=>inner.stopAt(pos),
  };
 },
 defineNodes:['WikiLink','WikiMark','WikiText','WikiFootnoteMark',{name:'WikiFootnote',block:true,composite(_cx,line,indent){
  if(line.pos===line.text.length)return true;
  if(line.indent<line.baseIndent+indent)return false;
  line.moveBaseColumn(line.baseIndent+indent);return true;
 }}],
 // A composite keeps blank/indented continuations in native Markdown block contexts,
 // without stripping source text or changing original UTF-16 coordinates.
 parseBlock:[{name:'WikiFootnote',before:'LinkReference',parse(cx,line){
  if(line.indent-line.baseIndent>=4)return false;
  const marker=/^\[\^[^\s\[\]]+\]:[ \t]*/.exec(line.text.slice(line.pos));
  if(!marker)return false;
  const from=cx.lineStart+line.pos,end=line.pos+marker[0].length;
  cx.startComposite('WikiFootnote',line.pos,4);
  cx.addElement(cx.elt('WikiFootnoteMark',from,cx.lineStart+end));
  line.moveBase(end);return null;
 }}],
 parseInline:[{name:'WikiLink',before:'Link',parse(cx,next,pos){
  if(pos<(lezerBlocked.get(cx)||0))return -1;
  if(next===91&&cx.char(pos+1)===91&&!wikiAt(cx.text,pos-cx.offset)){
   lezerBlocked.set(cx,cx.offset+bracketRegionEnd(cx.text,pos-cx.offset));return -1;
  }
  if(next!==93||cx.char(pos+1)!==93)return -1;
  // Keep native opening delimiters until the final closing bracket. A following
  // destination/reference still belongs to Link/Image, not to WikiLink.
  const opening=cx.findOpeningDelimiter(InlineContext.linkStart);
  if(opening===null)return -1;
  const inner=cx.getDelimiterAt(opening)!;
  const outer=cx.getDelimiterAt(opening-1);
  if(!outer||outer.to!==inner.from)return -1;
  const start=outer.to-1,match=wikiAt(cx.text,start-cx.offset);
  if(!match||cx.offset+match.end!==pos+2)return -1;
  // Lezer's GFM autolinker handles HTTP/www but leaves FTP paths as prose.
  let links=lezerAutolinks.get(cx);
  if(!links){links=/ftp:\/\//i.test(cx.text)?nativeLinks.linkify.match(cx.text)||[]:[];lezerAutolinks.set(cx,links)}
  if(links.some(link=>link.index<=start-cx.offset&&start-cx.offset<link.lastIndex))return -1;
  if((cx.char(pos+2)===40||cx.char(pos+2)===91)&&nativeWikiLabel(cx.text.slice(start-cx.offset),undefined,cx.parser))return -1;
  const end=pos+2;cx.takeContent(opening-1);
  return cx.addElement(cx.elt('WikiLink',start,end,[
   cx.elt('WikiMark',start,start+2),cx.elt('WikiText',start+2,end-2),cx.elt('WikiMark',end-2,end),
  ]));
 }}],
};
export const wikiPlugin:PluginSimple=md=>{
 // Markdown-it replaces NUL before parsing. Retain that control for the syntax predicate,
 // rather than accidentally turning an invalid name into a valid title containing U+FFFD.
 md.core.ruler.before('normalize','liubai_wiki_raw_controls',state=>{
  if(state.src.includes('\0'))state.env.liubaiWikiRaw=state.src.replace(/\r\n?/g,'\n');
 });
 md.core.ruler.after('normalize','liubai_wiki_controls',state=>{
  if(typeof state.env.liubaiWikiRaw==='string'){state.src=state.env.liubaiWikiRaw;delete state.env.liubaiWikiRaw}
 });
 md.core.ruler.before('inline','liubai_wiki_native_references',state=>{
  if(!state.src.includes(']]['))return;
  const context:NativeContext={references:{}};
  nativeLinks.block.parse(state.src,nativeLinks,context,[]);
  state.env.liubaiWikiReferences=context;
 });
 const blocked=new WeakMap<object,number>();
 const autolinks=new WeakMap<object,{index:number;lastIndex:number}[]>();
 md.inline.ruler.after('link','liubai_wiki',(state,silent)=>{
  // Validation lookahead must see literal brackets so native labels can balance them.
  if(silent||'linkLevel' in state&&state.linkLevel||state.pos<(blocked.get(state)||0))return false;
  if(state.src.slice(state.pos,state.pos+2)!=='[[')return false;
  if(md.options.linkify){
   let links=autolinks.get(state);
   if(!links){links=md.linkify.match(state.src)||[];autolinks.set(state,links)}
   if(links.some(link=>link.index<=state.pos&&state.pos<link.lastIndex))return false;
   // GFM accepts www paths with brackets and domains outside Linkify's TLD list.
   let from=state.pos;while(from>0&&!/\s/.test(state.src[from-1]))from--;
   const prefix=state.src.slice(from,state.pos).split('[[',1)[0];
   if(/^www\.[a-zA-Z0-9_.-]+\.[a-z]+[/#?]\S*$/.test(prefix))return false;
  }
  const match=wikiAt(state.src,state.pos);
  if(!match||match.end>state.posMax){blocked.set(state,Math.min(state.posMax,bracketRegionEnd(state.src,state.pos)));return false}
  if((state.src[match.end]==='('||state.src[match.end]==='[')&&nativeWikiLabel(state.src.slice(state.pos),state.env.liubaiWikiReferences||{references:{}}))return false;
  const token=state.push('wiki_link','',0);token.content=state.src.slice(state.pos,match.end);token.meta={target:match.target};
  state.pos=match.end;return true;
 });
 // Images recursively parse their labels. Preserve their raw alt text instead of leaving an internal link token there.
 md.core.ruler.after('inline','liubai_wiki_images',state=>{
  const visit=(tokens:typeof state.tokens,inImage=false)=>{
   for(const token of tokens){
    if(inImage&&token.type==='wiki_link'){token.type='text';token.meta=null}
    if(token.children)visit(token.children,inImage||token.type==='image');
   }
  };
  visit(state.tokens);
 });
 md.renderer.rules.wiki_link=(tokens,index,_options,env)=>{
  const token=tokens[index];
  if(env.wikiLinks!=='interactive')return md.utils.escapeHtml(token.content);
  const target:string=token.meta.target;
  return `<a class="md-link md-wiki-link" href="${md.utils.escapeHtml(wikiURL(target))}">${md.utils.escapeHtml(target)}</a>`;
 };
};
