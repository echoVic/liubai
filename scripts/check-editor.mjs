import assert from 'node:assert/strict';
import {EditorState, Compartment, Transaction} from '@codemirror/state';
import {history, undo, redo, isolateHistory} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';

// Exercise the actual CodeMirror history used by the editor across mode changes
// and a non-history image destination rewrite (native Save As).
const mode = new Compartment();
const original = '# 🌿 留白\n\n![图](liubai-asset:test.png)\n\n一句话。\n';
let state = EditorState.create({doc:original, extensions:[history(),markdown(),mode.of([])]});
const apply = spec => state = state.update(spec).state;
const command = fn => fn({get state(){return state},dispatch(tr){state=tr.state}});
apply({changes:{from:state.doc.length,insert:'继续写。'},annotations:isolateHistory.of('full')});
apply({effects:mode.reconfigure([EditorState.tabSize.of(4)]),annotations:Transaction.addToHistory.of(false)});
assert.equal(command(undo),true);
assert.equal(state.doc.toString(),original);
assert.equal(command(redo),true);
const oldDest='liubai-asset:test.png',newDest='文稿.assets/test.png';
const at=state.doc.toString().indexOf(oldDest);
apply({changes:{from:at,to:at+oldDest.length,insert:newDest},annotations:Transaction.addToHistory.of(false)});
assert.equal(command(undo),true);
assert.equal(state.doc.toString(),original.replace(oldDest,newDest));
assert.equal(command(redo),true);
assert.equal(state.doc.toString(),original.replace(oldDest,newDest)+'继续写。');
console.log('跨模式撤销、图片路径更新后的撤销重做与全文保持检查通过');
