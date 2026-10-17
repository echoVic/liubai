import type {MarkdownConfig,DelimiterType} from '@lezer/markdown';
import type {PluginSimple} from 'markdown-it';

const highlightDelimiter:DelimiterType={resolve:'Highlight',mark:'HighlightMark'};
export const Highlight:MarkdownConfig={
 defineNodes:['Highlight','HighlightMark'],
 parseInline:[{name:'Highlight',before:'Emphasis',parse(cx,next,pos){
  if(next!==61||cx.char(pos+1)!==61||cx.char(pos-1)===61||cx.char(pos+2)===61)return -1;
  return cx.addDelimiter(highlightDelimiter,pos,pos+2,!/\s/.test(String.fromCharCode(cx.char(pos+2)||32)),!/\s/.test(String.fromCharCode(cx.char(pos-1)||32)));
 }}],
};
// Use markdown-it's delimiter balancing, so escapes, nesting and code spans retain their native meaning.
export const highlightPlugin:PluginSimple=md=>{
 md.inline.ruler.before('emphasis','liubai_highlight',(state,silent)=>{
  if(silent||state.src.slice(state.pos,state.pos+2)!=='=='||state.src[state.pos-1]==='='||state.src[state.pos+2]==='=')return false;
  const start=state.pos,token=state.push('text','',0);token.content='==';
  state.delimiters.push({marker:61,length:0,token:state.tokens.length-1,end:-1,open:!/\s/.test(state.src[start+2]||' '),close:!/\s/.test(state.src[start-1]||' ')});
  state.pos+=2;return true;
 });
 md.inline.ruler2.after('balance_pairs','liubai_highlight',state=>{
  const process=(delimiters:typeof state.delimiters)=>{
   for(const start of delimiters){
    if(start.marker!==61||start.end<0)continue;
    const end=delimiters[start.end];
    for(const [delimiter,type,nesting] of [[start,'mark_open',1],[end,'mark_close',-1]] as const){
     const token=state.tokens[delimiter.token];token.type=type;token.tag='mark';token.nesting=nesting;token.markup='==';token.content='';
    }
   }
  };
  process(state.delimiters);
  for(const meta of state.tokens_meta)if(meta?.delimiters)process(meta.delimiters);
  return true;
 });
};

export interface InlineTagPair {from:number;to:number;openTo:number;closeFrom:number;tag:string}
// Nodes whose direct children can hold paired <u>/<sup>/<sub> tags.
export const tagHosts=/^(Paragraph|ATXHeading[1-6]|SetextHeading[12]|Emphasis|StrongEmphasis|Strikethrough|Highlight|Link|Task|TableCell|TableHeader)$/;
// Only pair parsed inline HTML tags within their own paragraph/heading. Code and HTML blocks never enter here.
export function inlineTagPairs(parent:{name:string;getChildren(name:string):readonly {from:number;to:number}[]},slice:(from:number,to:number)=>string):InlineTagPair[]{
 if(!tagHosts.test(parent.name))return [];
 const stack:{from:number;to:number;tag:string}[]=[],pairs:InlineTagPair[]=[];
 for(const node of parent.getChildren('HTMLTag')){
  const match=/^<(\/)?(u|sup|sub)>$/i.exec(slice(node.from,node.to));if(!match)continue;
  const tag=match[2].toLowerCase();
  if(!match[1])stack.push({from:node.from,to:node.to,tag});
  else if(stack.at(-1)?.tag===tag){const open=stack.pop()!;pairs.push({from:open.from,to:node.to,openTo:open.to,closeFrom:node.from,tag})}
 }
 return pairs;
}
