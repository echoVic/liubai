declare module 'markdown-it-footnote';
declare module 'turndown-plugin-gfm' {
 import type TurndownService from 'turndown';
 export const gfm:TurndownService.Plugin;
}
