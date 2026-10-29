import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {Highlight} from '../src/marks';
import {MathSyntax} from '../src/math';
import {MermaidSyntax} from '../src/mermaid';
import {WikiSyntax} from '../src/wiki-links';
import {createBlockField,inlineDecorations,composing,richExtensions} from '../src/editor';

const scale=Number(process.env.PERF_BUDGET_SCALE??1);
assert.ok(Number.isFinite(scale)&&scale>0,'PERF_BUDGET_SCALE 必须是正的有限数字');
if(scale!==1)console.log(`性能预算倍率：${scale}`);

const block='这是一段普通的中文正文，用来模拟长篇写作。偶尔会有**加粗**、一个[链接](https://example.com/a)和`代码`。\n\n'
 +'另一段没有任何格式的正文内容，写作者在这里连续地输入文字，句子很长很长。\n\n'.repeat(3)
 +'## 一个小标题\n\n- 列表项一\n- [ ] 待办\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n![图](images/a.png)\n\n';
// Best of several batches: the budget measures intrinsic cost, not other load on the machine.
// At 30 万字 incremental parsing alone is about 4 ms, so that size gets a looser budget.
const best=(batches:number,run:()=>number)=>{let min=Infinity;for(let i=0;i<batches;i++)min=Math.min(min,run());return min};
for(const [size,budget] of [[100_000,5*scale],[300_000,15*scale]] as const){
 const doc=block.repeat(Math.ceil(size/block.length));
 const field=createBlockField(async()=>'data:,');
 let state=EditorState.create({doc,extensions:[markdown({base:markdownLanguage,extensions:[GFM,Highlight,MathSyntax,MermaidSyntax,WikiSyntax]}),composing,field]});
 // Under load an edit can run out of its parse budget and leave a partial tree, which makes later
 // edits look cheaper than they are; such a batch is parsed in full and measured again.
 const complete=()=>{if(syntaxTree(state).length===state.doc.length)return true;ensureSyntaxTree(state,state.doc.length,60_000);state=state.update({}).state;return false};
 complete();
 const middle=()=>Math.floor(state.doc.length/2);
 for(let i=0;i<5;i++)state=state.update({changes:{from:middle(),insert:'字'}}).state;
 complete();
 const N=20;
 const keystroke=best(5,()=>{for(let tries=1;;tries++){const t=performance.now();for(let i=0;i<N;i++){const at=middle();state=state.update({changes:{from:at,insert:'字'},selection:{anchor:at+1}}).state}const ms=(performance.now()-t)/N;if(complete())return ms;assert.ok(tries<10,'parsing keeps running out of budget')}});
 const from=Math.max(0,middle()-3000),to=Math.min(state.doc.length,middle()+3000);
 const inline=best(5,()=>{const t=performance.now();for(let i=0;i<N;i++)inlineDecorations(state,[{from,to}]);return (performance.now()-t)/N});
 console.log(`${size/10000} 万字：每键块级更新 ${keystroke.toFixed(2)} ms，可视区行内装饰 ${inline.toFixed(2)} ms`);
 assert.ok(keystroke+inline<budget,`${size/10000} 万字超过 ${budget} ms 预算`);
}
// Notes that use math, diagrams, callouts, footnotes and details: a caret move in a long one stays cheap,
// since nothing it changes needs the whole document collected again.
{
 const {rich}=await import('./bench/documents.mjs');
 let state=EditorState.create({doc:rich(300_000),extensions:[markdown({base:markdownLanguage,extensions:[GFM,Highlight,MathSyntax,MermaidSyntax,WikiSyntax]}),composing,richExtensions(async()=>'data:,')]});
 ensureSyntaxTree(state,state.doc.length,60_000);state=state.update({}).state;
 const middle=Math.floor(state.doc.length/2),from=middle-3000,to=middle+3000,N=20;
 // As above: a batch whose parse ran out of budget is parsed in full and measured again.
 const measure=(step:(i:number)=>void)=>best(5,()=>{for(let tries=1;;tries++){const t=performance.now();for(let i=0;i<N;i++){step(i);inlineDecorations(state,[{from,to}])}const ms=(performance.now()-t)/N;if(syntaxTree(state).length===state.doc.length)return ms;assert.ok(tries<10,'parsing keeps running out of budget');ensureSyntaxTree(state,state.doc.length,60_000);state=state.update({}).state}});
 const cursor=measure(i=>{state=state.update({selection:{anchor:middle+(i%2?40:-40)}}).state});
 // Typing in its prose only shifts its callouts, details and footnotes, which are mapped rather than collected again.
 let line=state.doc.lineAt(middle);while(!line.text.startsWith('另一段'))line=state.doc.line(line.number+1);let at=line.from+10;
 const keystroke=measure(()=>{state=state.update({changes:{from:at,insert:'字'},selection:{anchor:at+1}}).state;at++});
 // Most writing happens at the end of a paragraph, which takes the same path.
 let end=state.doc.lineAt(at).to;
 const atEnd=measure(()=>{state=state.update({changes:{from:end,insert:'字'},selection:{anchor:end+1}}).state;end++});
 console.log(`30 万字富文稿：移动光标 ${cursor.toFixed(2)} ms，输入一个字 ${keystroke.toFixed(2)} ms，段落末尾输入 ${atEnd.toFixed(2)} ms`);
 assert.ok(cursor<8*scale,`30 万字富文稿移动光标超过 ${8*scale} ms 预算`);
 assert.ok(keystroke<10*scale,`30 万字富文稿输入一个字超过 ${10*scale} ms 预算`);
 assert.ok(atEnd<10*scale,`30 万字富文稿在段落末尾输入超过 ${10*scale} ms 预算`);
}
console.log('即时排版性能预算检查通过');
