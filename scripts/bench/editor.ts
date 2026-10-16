// Editor benchmark for one source tree (JavaScriptCore via Bun, the engine behind WKWebView).
// Usage: bun scripts/bench/editor.ts <repo-root>   — prints one JSON object per line.
// Works on the 0.3.0 tree (single whole-document decoration field) and on later trees
// (block field + viewport-only inline decorations), so both can be compared on one machine.
const root=process.argv[2]||process.cwd();
const {EditorState}=await import(root+'/node_modules/@codemirror/state/dist/index.js');
const {markdown,markdownLanguage}=await import(root+'/node_modules/@codemirror/lang-markdown/dist/index.js');
const {ensureSyntaxTree,syntaxTree}=await import(root+'/node_modules/@codemirror/language/dist/index.js');
const {GFM}=await import(root+'/node_modules/@lezer/markdown/dist/index.js');
const editor:any=await import(root+'/src/editor.ts');
let stats:any=null;try{stats=await import(root+'/src/stats.ts')}catch{}
const modern=typeof editor.createBlockField==='function';
const resolve=async()=>'data:,';
const block='这是一段普通的中文正文，用来模拟长篇写作。偶尔会有**加粗**、一个[链接](https://example.com/a)和`代码`。\n\n'
 +'另一段没有任何格式的正文内容，写作者在这里连续地输入文字，句子很长很长。\n\n'.repeat(3)
 +'## 一个小标题\n\n- 列表项一\n- [ ] 待办\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n![图](images/a.png)\n\n';
const best=(batches:number,run:()=>number)=>{let min=Infinity;for(let i=0;i<batches;i++)min=Math.min(min,run());return min};
// Under load an edit can run out of its 20 ms parse budget and leave a partial tree; later edits then
// decorate and parse only part of the document and look cheaper. Such a batch is parsed in full and run again.
const complete=(run:()=>number,get:()=>any,set:(s:any)=>void)=>()=>{for(let tries=1;;tries++){const ms=run(),s=get();if(syntaxTree(s).length===s.doc.length)return ms;if(tries>=10)throw new Error('parsing keeps running out of budget');ensureSyntaxTree(s,s.doc.length,60_000);set(s.update({}).state)}};
const emit=(o:object)=>console.log(JSON.stringify({suite:'editor',tree:modern?'modern':'legacy',...o}));
for(const size of [20_000,100_000,300_000]){
 const doc=block.repeat(Math.ceil(size/block.length)).slice(0,size);
 const field=modern?editor.createBlockField(resolve):editor.richExtensions(resolve);
 let state=EditorState.create({doc,extensions:[markdown({base:markdownLanguage,extensions:GFM}),editor.composing,field]});
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
 let bare=EditorState.create({doc:state.doc.toString(),extensions:[markdown({base:markdownLanguage,extensions:GFM})]});
 ensureSyntaxTree(bare,bare.doc.length,60_000);bare=bare.update({}).state;
 const parse=best(5,complete(()=>{const t=performance.now();for(let i=0;i<N;i++){const at=Math.floor(bare.doc.length/2);bare=bare.update({changes:{from:at,insert:'字'},selection:{anchor:at+1}}).state}return (performance.now()-t)/N},()=>bare,s=>{bare=s}));
 emit({scenario:'keystroke',chars:size,ms:+keystroke.toFixed(3)});
 emit({scenario:'cursor-move',chars:size,ms:+cursor.toFixed(3)});
 emit({scenario:'parse-only-keystroke',chars:size,ms:+parse.toFixed(3)});
}
// Word count: 0.3.0 recounted the whole document on every keystroke; later trees count once after a 400 ms pause.
const legacyCount=(s:string)=>[...s.replace(/\s/g,'')].length;
for(const size of [100_000,1_000_000]){
 const text=block.repeat(Math.ceil(size/block.length)).slice(0,size);
 const count=stats?.countWords??legacyCount;
 const ms=best(5,()=>{const t=performance.now();for(let i=0;i<5;i++)count(text);return (performance.now()-t)/5});
 emit({scenario:stats?'word-count-per-pause':'word-count-per-keystroke',chars:size,ms:+ms.toFixed(3)});
}
