import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {htmlToMarkdown,pasteText,replacePasteImage,dataUrlBlob} from '../src/paste';
import {EditorState} from '@codemirror/state';
import {history,undo,redo} from '@codemirror/commands';

let state=EditorState.create({doc:'保留原文',selection:{anchor:2,head:4},extensions:[history()]});
state=state.update(pasteText(state,'# 标题\n\n- 列表')).state;
assert.equal(state.doc.toString(),'保留# 标题\n\n- 列表');
assert.equal(state.selection.main.head,state.doc.length);
const command=(fn:typeof undo)=>fn({state,dispatch:tr=>state=tr.state});
assert.ok(command(undo));assert.equal(state.doc.toString(),'保留原文');
assert.ok(command(redo));assert.equal(state.doc.toString(),'保留# 标题\n\n- 列表');
state=state.update(pasteText(state,'占位符')).state;
state=state.update(replacePasteImage(state,'占位符','![图](image.png)')).state;
assert.ok(command(undo));assert.equal(state.doc.toString(),'保留# 标题\n\n- 列表');
assert.ok(command(undo));assert.equal(state.doc.toString(),'保留原文');

state=state.update({selection:{anchor:2}}).state;
state=state.update(pasteText(state,'前图一中图二后')).state;
state=state.update(replacePasteImage(state,'图一','![一](one.png)')).state;
state=state.update(replacePasteImage(state,'图二','导入失败的说明')).state;
assert.equal(state.doc.toString(),'保留前![一](one.png)中导入失败的说明后原文');
assert.ok(command(undo));assert.equal(state.doc.toString(),'保留原文');
assert.ok(command(redo));assert.equal(state.doc.toString(),'保留前![一](one.png)中导入失败的说明后原文');

// Self-contained versions of the web/Word spike fixtures. Losing any of these
// structures changes the resulting document, rather than just its appearance.
const web=`<head><title>不要保留</title><style>p{color:red}</style><script>bad()</script></head><meta charset="utf-8"><!-- 注释 --><h2>安装与配置</h2><p>留白是一款<strong>安静</strong>的 <em>Markdown</em> 写作工具，详见<a href="https://example.com/docs">官方文档</a>。</p><ul><li>支持 <code>⌘K</code> 打开所有操作</li><li>支持中文输入法<ul><li>微信输入法</li></ul></li></ul><ol><li>下载安装包</li><li>拖到「应用程序」</li></ol><blockquote><p>文字需要留白。</p></blockquote><pre><code class="language-go">fmt.Println("留白")\n</code></pre><p><img src="https://example.com/a.png" alt="示意图"></p><table><thead><tr><th>快捷键</th><th>作用</th></tr></thead><tbody><tr><td>⌘N</td><td>新建</td></tr><tr><td>⌘O</td><td>打开</td></tr></tbody></table><p>最后一段<del>删除线</del>。</p><ul><li><input type="checkbox" checked>完成</li></ul>`;
const converted=htmlToMarkdown(web,'').markdown;
for(const part of ['## 安装与配置','**安静**','*Markdown*','[官方文档](https://example.com/docs)','- 支持 `⌘K` 打开所有操作','    - 微信输入法','1. 下载安装包','2. 拖到「应用程序」','> 文字需要留白。','```go\nfmt.Println("留白")\n```','![示意图](https://example.com/a.png)','| 快捷键 | 作用 |','| --- | --- |','| ⌘O | 打开 |','~~删除线~~','- [x] 完成'])assert.ok(converted.includes(part),part+'\n'+converted);
assert.ok(!/不要保留|bad\(\)|color:red|注释/.test(converted));

const word=`<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0}</style></head><body><h1>季度总结</h1><p class="MsoNormal"><b><span style="font-family:宋体">重点：</span></b><span>完成留白 0.4 的阅读器基础。</span><o:p>不保留</o:p></p><p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span><span>修复 6 个可靠性问题</span></p><p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span><span>性能提升 10 倍</span></p><p><i>注：数据来自性能报告。</i></p></body></html>`;
const w=htmlToMarkdown(word,'').markdown;
assert.ok(w.includes('**重点**：完成留白'));
assert.ok(w.includes('- 修复 6 个可靠性问题\n- 性能提升 10 倍'));
assert.ok(!/不保留|·|MsoNormal/.test(w));
const list=(marker:string,level:number,text:string)=>`<p class="MsoListParagraph" style="mso-list:l0 level${level} lfo1"><span style="mso-list:Ignore">${marker}&nbsp;</span>${text}</p>`;
assert.equal(htmlToMarkdown(list('•',1,'父项')+list('o',2,'子项')+list('§',2,'同级')+list('▪',1,'下一项'),'').markdown,'- 父项\n    - 子项\n    - 同级\n- 下一项');
assert.equal(htmlToMarkdown(list('1.',1,'第一')+list('2)',1,'第二')+list('a.',2,'字母')+list('i.',3,'罗马'),'').markdown,'1. 第一\n2. 第二\n    1. 字母\n        1. 罗马');

const google=htmlToMarkdown('<b id="docs-internal-guid-test" style="font-weight:normal"><p>普通<span style="font-weight:700">粗体</span><span style="font-weight:600">半粗</span><span style="font-style:italic">斜体</span><span style="text-decoration: line-through">删除</span></p></b>','').markdown;
assert.equal(new MarkdownIt().render(google),'<p>普通<strong>粗体半粗</strong><em>斜体</em><s>删除</s></p>\n');
assert.equal(htmlToMarkdown('<table><tr><td>名称</td><td>值</td></tr><tr><td>甲</td><td>乙</td></tr></table>','').markdown,'| 名称 | 值 |\n| --- | --- |\n| 甲 | 乙 |');
const md=new MarkdownIt();
for(const text of ['-重点-','[重点]','_重点_']){
 const rendered=md.render(htmlToMarkdown(`<p>前<strong>${text}</strong>后</p>`,'').markdown);
 assert.ok(rendered.includes('<strong>重点</strong>'),rendered);
}
for(const [tag,delimiter] of [['strong','**'],['em','*'],['del','~~']]){
 const result=htmlToMarkdown(`<p>前<span><${tag}>：重点：</${tag}></span>完成</p>`,'').markdown;
 assert.equal(result,`前：${delimiter}重点${delimiter}：完成`);
 if(tag!=='del')assert.ok(md.render(result).includes(`<${tag}>重点</${tag}>`));
 assert.equal(htmlToMarkdown(`<p><${tag}>重点：</${tag}> 完成</p>`,'').markdown,`${delimiter}重点：${delimiter} 完成`);
}
assert.equal(htmlToMarkdown('<pre><code class="lang-ts">let x = 1\n</code></pre>','').markdown,'```ts\nlet x = 1\n```');
const code='const x = "a*b";\n  console.log(x);\n';
assert.equal(htmlToMarkdown('<div style="font-family: Menlo, monospace; white-space: pre"><span style="color:red">const x</span> = "a*b";<br>  console.log(x);</div>',code).markdown,code);
const plain='*literal* [text] # heading\n1. ordinary\n_a_ ~b~ \\path';
assert.equal(htmlToMarkdown('<div>*literal* [text] # heading</div><div>1. ordinary</div><div>_a_ ~b~ \\path</div>',plain).markdown,plain);
assert.equal(htmlToMarkdown('<div class="cm-line"># 原文</div><div class="cm-line">**重点**</div>','# 原文\n**重点**').markdown,'# 原文\n**重点**');
const image=htmlToMarkdown('<p>前<img src="data:image/png;base64,aGVsbG8=" alt="示意图">后</p>','前示意图后');
assert.equal(image.images.length,1);
assert.deepEqual(image.images[0],{placeholder:image.images[0].placeholder,dataUrl:'data:image/png;base64,aGVsbG8=',alt:'示意图'});
assert.ok(image.markdown.includes(image.images[0].placeholder));
assert.equal(htmlToMarkdown('<p><img src="file:///a.png" alt="本地"><img src="blob:test" alt="临时"><img src="other:test" alt="其他"></p>','').markdown,'本地临时其他');
assert.equal(htmlToMarkdown('<p><img data-image-source="liubai-asset:test.png" src="blob:preview" alt="原图"></p>','').markdown,'![原图](liubai-asset:test.png)');
const base64=dataUrlBlob('data:image/png;base64,aGVs bG8=');
assert.equal(base64.type,'image/png');
assert.equal(new TextDecoder().decode(new Uint8Array(await base64.arrayBuffer())),'hello');
const percent=dataUrlBlob('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%2F%3E');
assert.equal(percent.type,'image/svg+xml');
assert.equal(await percent.text(),'<svg xmlns="http://www.w3.org/2000/svg"/>');
assert.throws(()=>dataUrlBlob('javascript:alert(1)'));
console.log('网页、Word、Google Docs、CJK 强调、代码与纯文本、图片转换检查通过');
