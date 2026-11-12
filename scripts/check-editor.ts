import assert from 'node:assert/strict';
import {EditorState,Transaction,type TransactionSpec} from '@codemirror/state';
import {history,undo,redo,isolateHistory} from '@codemirror/commands';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {languages} from '@codemirror/language-data';
import {GFM} from '@lezer/markdown';
import {mode,editorLocale,localizedEditor,richExtensions,composing} from '../src/editor';
import {blockRichMode} from '../src/block-ui';
import {documentSearch} from '../src/document-find';
import {Highlight} from '../src/marks';
import {MathSyntax} from '../src/math';
import {MermaidSyntax} from '../src/mermaid';
import {WikiSyntax} from '../src/wiki-links';

// The app's own state extensions (as createEditor sets them up, minus the view-only parts), switched
// between rich and source mode the way app.ts reconfigure() does, and rewritten the way Save As
// rewrites image destinations: neither may become an undo step or lose text.
const resolve=async()=>'data:,';
const original='# 🌿 留白\n\n![图](liubai-asset:test.png)\n\n一句话。\n';
let state=EditorState.create({doc:original,extensions:[history(),composing,markdown({base:markdownLanguage,codeLanguages:languages,extensions:[GFM,Highlight,MathSyntax,MermaidSyntax,WikiSyntax]}),documentSearch,mode.of(richExtensions(resolve)),editorLocale.of(localizedEditor())]});
const apply=(spec:TransactionSpec)=>state=state.update(spec).state;
const command=(fn:typeof undo)=>fn({state,dispatch:tr=>state=tr.state});
const switchMode=(rich:boolean)=>{apply({effects:mode.reconfigure(rich?richExtensions(resolve):[]),annotations:Transaction.addToHistory.of(false)});assert.equal(state.facet(blockRichMode),rich,'mode switch')};
assert.equal(state.facet(blockRichMode),true,'starts in rich mode');
apply({changes:{from:state.doc.length,insert:'继续写。'},userEvent:'input.type',annotations:isolateHistory.of('full')});
switchMode(false);
assert.equal(command(undo),true);assert.equal(state.doc.toString(),original,'undo after switching to source mode');
assert.equal(command(redo),true);assert.equal(state.doc.toString(),original+'继续写。','redo in source mode');
switchMode(true);
assert.equal(command(undo),true);assert.equal(state.doc.toString(),original,'undo after switching back to rich mode');
assert.equal(command(redo),true);assert.equal(state.doc.toString(),original+'继续写。','redo in rich mode');
const oldDest='liubai-asset:test.png',newDest='文稿.assets/test.png',at=state.doc.toString().indexOf(oldDest);
apply({changes:{from:at,to:at+oldDest.length,insert:newDest},annotations:Transaction.addToHistory.of(false)});
assert.equal(command(undo),true);assert.equal(state.doc.toString(),original.replace(oldDest,newDest),'undo keeps the rewritten image path');
assert.equal(command(redo),true);assert.equal(state.doc.toString(),original.replace(oldDest,newDest)+'继续写。','redo restores the whole text');
console.log('PASS: 跨模式撤销、图片路径更新后的撤销重做与全文保持（应用的编辑器扩展）');
