// Counts words off the page: a long document would otherwise hold it up for tens of milliseconds after every pause.
import {countWords} from './stats';
const scope=self as unknown as {onmessage:(event:MessageEvent<{job:number;text:string}>)=>void;postMessage:(message:{job:number;count:number})=>void};
scope.onmessage=event=>scope.postMessage({job:event.data.job,count:countWords(event.data.text)});
