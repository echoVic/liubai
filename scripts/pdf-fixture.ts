import {renderDelivery,waitImages,type Delivery} from '../src/delivery';

// Fixed seed and integer arithmetic keep the pagination fixture reproducible.
let seed=20261015;
function random(limit:number){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit}
const prose=[
 '长文写作从一页开始，留白让文字有清楚的层次。我们用这一篇文章检查每一页的标题、正文和图片，让工作中的阅读与导出保持自然。',
 '页面上的每一行都承载着内容，长短不同的段落记录日常工作。排版应当保留合适的留白，让文中的说明、用法和片段在翻页之后仍然容易理解。',
 '这份文稿用于检查中文复制和搜索，也用于观察页面底部的标题。读者可以从长文中选取一行文字，回到工作笔记里继续使用，或按页查找需要的片段。',
];
const parts=['# 长文导出测试','这是一份用于检查长文分页、中文复制与搜索的固定文稿，每一页都记录留白的工作片段。'];
for(let section=1;section<=40;section++){
 parts.push(`## 第 ${section} 节`);
 const paragraphs=random(5);
 if(!paragraphs)parts.push('这一页用于记录工作片段。');
 for(let paragraph=0;paragraph<paragraphs;paragraph++){
  const sentences=2+random(5);
  parts.push(Array.from({length:sentences},()=>prose[random(prose.length)]).join(''));
 }
 if(section===5)parts.push('| 内容 | 页面 | 用途 |\n| :--- | :---: | ---: |\n| 长文 | 一页 | 工作 |\n| 图片 | 留白 | 说明 |');
 if(section===12)parts.push('```ts\nconst page = "一页长文";\nfunction read() {\n  return page;\n}\n```');
 if(section===20)parts.push('- 用一行文字记录工作\n- 为页面保留适当留白\n- 检查长文和图片');
 if(section===28)parts.push('[外部链接](https://example.invalid/guide)');
 if(section===35)parts.push('![示例](a.png)');
}
parts.push('全文结束标记：尾声。');
const data:Delivery={
 title:'长文导出测试',content:parts.join('\n\n'),missing:[],external:0,
 images:{'a.png':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGMwjG/CihiGlgQAsA5EgfIKYF0AAAAASUVORK5CYII='},
};
async function prepare(){
 const root=document.querySelector<HTMLElement>('#print-document')!;
 root.replaceChildren(renderDelivery(data));
 await waitImages(root);
 document.title='ready';
}
void prepare().catch(error=>{document.title=`error: ${String(error)}`});
