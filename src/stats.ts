export function countWords(markdown:string):number {
 let text=markdown;
 const front=/^---\r?\n/.exec(text);
 if(front){let offset=front[0].length;for(let n=1;n<200;n++){const end=text.indexOf('\n',offset),line=text.slice(offset,end<0?undefined:end).trim();if(line==='---'||line==='...'){text=text.slice(end<0?text.length:end+1);break}if(end<0)break;offset=end+1}}
 text=text.replace(/<!--[^]*?-->/g,' ')
  .replace(/^ {0,3}(?:`{3,}|~{3,}).*$/gm,' ')
  .replace(/!\[[^\]]*\](?:\((?:[^()\n]|\([^()\n]*\))*\)|\[[^\]]*\])/g,' ')
  .replace(/^ {0,3}\[[^\]]+\]:.*$/gm,' ')
  .replace(/\[([^\]]+)\](?:\((?:[^()\n]|\([^()\n]*\))*\)|\[[^\]]*\])/g,'$1')
  .replace(/<[^>]*>/g,' ')
  .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi,' ')
  .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/gm,' ')
  .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm,' ')
  .replace(/\[[ xX]\](?=\s|$)/g,' ')
  .replace(/[#>*_~`|]/g,'');
 let count=0;
 text=text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,()=>{count++;return ' '});
 return count+(text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length||0);
}
