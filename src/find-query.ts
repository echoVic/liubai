import {SearchQuery} from '@codemirror/search';
import {type EditorState,type Text} from '@codemirror/state';

export type FindMatch={from:number;to:number};
// Keep the find UI responsive for documents containing thousands of repetitions.
export function findMatches(query:SearchQuery,document:EditorState|Text):{matches:FindMatch[];limited:boolean}{
 const matches:FindMatch[]=[];
 if(!query.valid)return {matches,limited:false};
 const cursor=query.getCursor(document);
 for(let item=cursor.next();!item.done;item=cursor.next()){
  if(matches.length===10000)return {matches,limited:true};
  matches.push(item.value);
 }
 return {matches,limited:false};
}
