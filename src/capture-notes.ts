export function applyCaptureTemplate(text:string,previous:string,next:string):string{
 if(!text.trim()||text===previous)return next;
 if(!next)return text;
 return text+(text.endsWith('\n\n')?'':text.endsWith('\n')?'\n':'\n\n')+next;
}
export function parseCaptureTags(text:string):string[]{
 return [...new Set(text.split(/[,，]/).map(tag=>tag.trim().replace(/^#/,'').trim()).filter(Boolean))];
}
