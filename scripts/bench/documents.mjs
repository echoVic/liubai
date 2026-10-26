// Test documents shared by the editor, preview and WebKit benchmarks. Plain functions, so the preview
// benchmark can bundle them for the browser.

// Long-form writing: prose with occasional bold, links, code, lists, tasks, tables and images (the 2026-10-15 report's document).
const block='这是一段普通的中文正文，用来模拟长篇写作。偶尔会有**加粗**、一个[链接](https://example.com/a)和`代码`。\n\n'
 +'另一段没有任何格式的正文内容，写作者在这里连续地输入文字，句子很长很长。\n\n'.repeat(3)
 +'## 一个小标题\n\n- 列表项一\n- [ ] 待办\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n![图](images/a.png)\n\n';
export function writing(size){return block.repeat(Math.ceil(size/block.length)).slice(0,size)}

// Notes that use what 0.2–0.4 added: inline and display math, ==highlight==, callouts, footnotes,
// foldable details and, in every fourth section, a Mermaid diagram. The preview benchmark leaves out
// details (raw HTML, which sends the whole document through the sanitizer) and Mermaid (rendered asynchronously).
export function rich(size,{details=true,mermaid=true}={}){
 let doc='';
 for(let i=1;doc.length<size;i++){
  doc+=`## 第 ${i} 节\n\n这是一段带脚注的正文[^${i}]，写到质能关系 $E=mc^2$ 时用了行内公式，也有==高亮的句子==和**加粗**。另一句话里有一个[链接](https://example.com/${i})和\`代码\`。\n\n`
   +'> [!NOTE]\n> 提示块里的说明文字，提醒读者注意这一节的前提条件。\n\n'
   +`$$\n\\int_0^{${i}} x^{2}\\,dx = \\frac{${i}^{3}}{3}\n$$\n\n`
   +'另一段没有任何格式的正文内容，写作者在这里连续地输入文字，句子很长很长。\n\n'.repeat(3)
   +`- 列表项一\n- [ ] 待办事项\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n![图 ${i}](images/${i}.png)\n\n`
   +(details?`<details>\n<summary>第 ${i} 节的补充材料</summary>\n\n折叠起来的补充内容。\n\n</details>\n\n`:'')
   +(mermaid&&i%4===1?`\`\`\`mermaid\ngraph TD\n  A${i}[开始] --> B${i}[结束]\n\`\`\`\n\n`:'')
   +`[^${i}]: 第 ${i} 个脚注的内容。\n\n`;
 }
 return doc.slice(0,size);
}

// The WebKit suite opens each of these in the app.
export const webkitDocuments=[['writing',20_000],['writing',100_000],['writing',300_000],['rich',100_000]];
