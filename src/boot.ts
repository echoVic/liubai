// Paints the theme before the page's modules load, so a window never flashes the wrong one.
import {resolveTheme,paintTheme,type ThemeChoice} from './theme';
let saved:ThemeChoice|null=null;try{saved=JSON.parse(localStorage.getItem('liubai-appearance')||'null')}catch{}
paintTheme(document.documentElement,resolveTheme(saved||{auto:'system'},new Date(),matchMedia('(prefers-color-scheme:dark)').matches));
