const paths:Record<string,string>={
 new:'M12 5v14M5 12h14',outline:'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
 source:'m8 5-6 7 6 7m8-14 6 7-6 7m-3-17-2 20',theme:'M12 3a9 9 0 1 0 9 9c0-5-4-9-9-9Zm0 0v18',
 commands:'M5 12h.01M12 12h.01M19 12h.01',image:'M4 3h16v18H4zM4 16l5-5 4 4 3-3 4 4M9 7h.01',
 close:'m6 6 12 12M18 6 6 18',focus:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8',
 bold:'M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z',italic:'M10 4h9M5 20h9M14 4 10 20',
 heading:'M5 4v16M19 4v16M5 12h14',quote:'M4 7h6v6H4l-1 5m12-11h6v6h-6l-1 5',
 bullet:'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',ordered:'M10 6h11M10 12h11M10 18h11M3 4h2v5M3 13h3l-3 5h3',
 task:'M9 12h12M3 10l2 2 3-4M9 19h12M3 17l2 2 3-4',code:'m8 7-5 5 5 5m8-10 5 5-5 5',
 table:'M3 4h18v16H3zM3 10h18M10 4v16',link:'m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m6 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
 export:'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',undo:'M3 10h11a6 6 0 0 1 0 12M3 10l5-5m-5 5 5 5'
};
export function icon(name:string){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.commands);svg.append(p);return svg}
export function applyIcons(){document.querySelectorAll<HTMLElement>('[data-icon]').forEach(el=>el.replaceChildren(icon(el.dataset.icon!)))}
