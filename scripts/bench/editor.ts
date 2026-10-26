// Editor benchmark for one source tree (JavaScriptCore via Bun, the engine behind WKWebView).
// Usage: bun scripts/bench/editor.ts <repo-root>   — prints one JSON object per line.
// Works on the 0.3.0 tree (single whole-document decoration field) and on later trees
// (block field + viewport-only inline decorations), so both can be compared on one machine.
// Each tree runs with the Markdown syntax and the editor state fields it ships. View plugins
// (block handles, slash menu, the inline set the view keeps) need a DOM; scripts/bench/webkit.py measures those.
const root=process.argv[2]||process.cwd();
const {EditorState}=await import(root+'/node_modules/@codemirror/state/dist/index.js');
const {markdown,markdownLanguage}=await import(root+'/node_modules/@codemirror/lang-markdown/dist/index.js');
const {ensureSyntaxTree,syntaxTree}=await import(root+'/node_modules/@codemirror/language/dist/index.js');
const {GFM}=await import(root+'/node_modules/@lezer/markdown/dist/index.js');
const {writing,rich}=await import('./documents.mjs');
const editor:any=await import(root+'/src/editor.ts');
let stats:any=null;try{stats=await import(root+'/src/stats.ts')}catch{}
const modern=typeof editor.createBlockField==='function';
// Syntax added after 0.1.0: ==highlight== (0.3.0), math and Mermaid (0.4.0).
const optional=async(file:string,name:string)=>{try{return (await import(root+'/src/'+file))[name]}catch{return undefined}};
const syntax=[GFM,await optional('marks.ts','Highlight'),await optional('math.ts','MathSyntax'),await optional('mermaid.ts','MermaidSyntax')].filter(Boolean);
const resolve=async()=>'data:,';
const best=(batches:number,run:()=>number)=>{let min=Infinity;for(let i=0;i<batches;i++)min=Math.min(min,run());return min};
// Under load an edit can run out of its 20 ms parse budget and leave a partial tree; later edits then
// decorate and parse only part of the document and look cheaper. Such a batch is parsed in full and run again.
const complete=(run:()=>number,get:()=>any,set:(s:any)=>void)=>()=>{for(let tries=1;;tries++){const ms=run(),s=get();if(syntaxTree(s).length===s.doc.length)return ms;if(tries>=10)throw new Error('parsing keeps running out of budget');ensureSyntaxTree(s,s.doc.length,60_000);set(s.update({}).state)}};
const emit=(o:object)=>console.log(JSON.stringify({suite:'editor',tree:modern?'modern':'legacy',...o}));
// The writing document is the 2026-10-15 report's; the rich one uses math, diagrams, callouts, footnotes and details.
for(const [kind,make] of [['writing',writing],['rich',rich]] as const)for(const size of [20_000,100_000,300_000]){
 const doc=make(size),suffix=kind==='rich'?'-rich':'';
 let state=EditorState.create({doc,extensions:[markdown({base:markdownLanguage,extensions:syntax}),editor.composing,editor.richExtensions(resolve)]});
 ensureSyntaxTree(state,state.doc.length,60_000);state=state.update({}).state;
 const middle=()=>Math.floor(state.doc.length/2);
 const viewport=()=>[{from:Math.max(0,middle()-3000),to:Math.min(state.doc.length,middle()+3000)}];
 // What the view does after the state update: legacy has no extra work; modern rebuilds the visible inline set.
 const afterUpdate=()=>{if(modern)editor.inlineDecorations(state,viewport())};
 for(let i=0;i<5;i++){state=state.update({changes:{from:middle(),insert:'字'}}).state;afterUpdate()}
 const N=20;
 const current=()=>state,replace=(s:any)=>{state=s};
 const keystroke=best(5,complete(()=>{const t=performance.now();for(let i=0;i<N;i++){const at=middle();state=state.update({changes:{from:at,insert:'字'},selection:{anchor:at+1}}).state;afterUpdate()}return (performance.now()-t)/N},current,replace));
 const cursor=best(5,complete(()=>{const t=performance.now();for(let i=0;i<N;i++){state=state.update({selection:{anchor:middle()+(i%2?40:-40)}}).state;afterUpdate()}return (performance.now()-t)/N},current,replace));
 // Parsing alone, for context: the same keystrokes without any decoration work.
 let bare=EditorState.create({doc:state.doc.toString(),extensions:[markdown({base:markdownLanguage,extensions:syntax})]});
 ensureSyntaxTree(bare,bare.doc.length,60_000);bare=bare.update({}).state;
 const parse=best(5,complete(()=>{const t=performance.now();for(let i=0;i<N;i++){const at=Math.floor(bare.doc.length/2);bare=bare.update({changes:{from:at,insert:'字'},selection:{anchor:at+1}}).state}return (performance.now()-t)/N},()=>bare,s=>{bare=s}));
 emit({scenario:'keystroke'+suffix,chars:size,ms:+keystroke.toFixed(3)});
 emit({scenario:'cursor-move'+suffix,chars:size,ms:+cursor.toFixed(3)});
 emit({scenario:'parse-only-keystroke'+suffix,chars:size,ms:+parse.toFixed(3)});
}
// Word count: 0.3.0 recounted the whole document on every keystroke; later trees count once after a 400 ms pause.
const legacyCount=(s:string)=>[...s.replace(/\s/g,'')].length;
for(const size of [100_000,1_000_000]){
 const text=writing(size);
 const count=stats?.countWords??legacyCount;
 const ms=best(5,()=>{const t=performance.now();for(let i=0;i<5;i++)count(text);return (performance.now()-t)/5});
 emit({scenario:stats?'word-count-per-pause':'word-count-per-keystroke',chars:size,ms:+ms.toFixed(3)});
}
