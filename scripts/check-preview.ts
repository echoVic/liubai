import {renderDelivery} from '../src/delivery';
import {renderMarkdown} from '../src/markdown';

function assert(condition: unknown, message: string): asserts condition {
 if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
 if (actual!==expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function deferred<T>(){
 let resolve!: (value:T)=>void;
 const promise=new Promise<T>(done=>{resolve=done});
 return {promise,resolve};
}

export async function runPreviewChecks(): Promise<string> {
 const markdown=[
  '# 中文标题',
  '',
  '> 引用',
  '>',
  '> - 外层',
  '>   - 内层',
  '',
  '```ts',
  'const value = "<特殊字符>";',
  '```',
  '',
  '| 项目 | 说明 |',
  '| --- | --- |',
  '| 甲 | 乙 |',
  '',
  '- [ ] 待办',
  '- [x] 完成',
  '',
  '![本地图](<图片 目录/示例(一).png>)',
  '',
  '    indented code',
 ].join('\n');
 const original=markdown;
 const localURL='data:image/png;base64,iVBORw0KGgo=';
 const rendered=renderMarkdown(markdown,{
  resolve:destination=>destination.includes('%E5%9B%BE%E7%89%87')?localURL:undefined,
  external:'load',
 });
 equal(markdown,original,'rendering changed the source Markdown');
 equal(rendered.root.tagName,'ARTICLE','renderer root is not semantic');
 equal(rendered.root.querySelector('h1')?.textContent,'中文标题','heading did not render');
 assert(rendered.root.querySelector('blockquote ul ul'),'nested list in quote did not render');
 equal(rendered.root.querySelector('pre')?.textContent,'const value = "<特殊字符>";\n','fenced code changed');
 assert(rendered.root.querySelector('table tbody td'),'table did not render');
 const heading=rendered.root.querySelector('h1')!;
 equal(heading.dataset.line,'0','heading start line');
 equal(heading.dataset.lineEnd,'0','heading end line');
 const quote=rendered.root.querySelector('blockquote')!;
 equal(quote.dataset.line,'2','quote start line');
 equal(quote.dataset.lineEnd,'5','quote end line');
 const fence=rendered.root.querySelector('pre')!;
 equal(fence.dataset.line,'7','fence start line');
 equal(fence.dataset.lineEnd,'9','fence end line');
 const codeBlocks=rendered.root.querySelectorAll('pre');
 equal(codeBlocks[1]?.dataset.line,'20','indented code start line');
 equal(codeBlocks[1]?.dataset.lineEnd,'20','indented code end line');
 const table=rendered.root.querySelector('table')!;
 equal(table.dataset.line,'11','table start line');
 equal(table.dataset.lineEnd,'13','table end line');
 for(const block of rendered.root.querySelectorAll<HTMLElement>('[data-line]')){
  assert(block.hasAttribute('data-line-end'),'mapped visible block lacks an end line');
 }
 assert(!rendered.root.querySelector('li > p[data-line]'),'hidden tight-list paragraph became an anchor');
 const tasks=[...rendered.root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
 equal(tasks.length,2,'task markers were not rendered as checkboxes');
 assert(tasks.every(task=>task.disabled),'task checkbox is editable');
 assert(!tasks[0].checked&&tasks[1].checked,'task checkbox state is wrong');
 equal(rendered.root.querySelector('img')?.getAttribute('src'),localURL,'synchronous image was not installed before return');
 await rendered.ready;

 const pending=deferred<string|undefined>();
 const stale=renderMarkdown('![旧图](旧图.png)',{resolve:()=>pending.promise,external:'load'});
 const staleImage=stale.root.querySelector('img')!;
 assert(!staleImage.hasAttribute('src'),'unreviewed async image received src');
 stale.dispose();
 pending.resolve('data:image/png;base64,stale');
 await stale.ready;
 assert(!staleImage.hasAttribute('src'),'disposed image callback mutated stale DOM');

 const missing=renderMarkdown('![缺图](缺图.png)',{resolve:async()=>undefined,external:'load'});
 assert(!missing.root.querySelector('img')?.hasAttribute('src'),'missing image started a request');
 await missing.ready;
 assert(missing.root.textContent?.includes('图片缺失：缺图'),'missing image has no explicit notice');

 const failed=renderMarkdown('![坏图](坏图.png)',{resolve:async()=>{throw Error('read failed')},external:'load'});
 await failed.ready;
 assert(failed.root.textContent?.includes('图片无法读取：坏图'),'failed image has no explicit notice');

 const external=renderMarkdown('![外链图](https://example.invalid/image.png)',{resolve:()=>{throw Error('external resolver called')},external:'load'});
 equal(external.root.querySelector('img')?.getAttribute('src'),'https://example.invalid/image.png','preview external image was not allowed');
 await external.ready;

 const delivery=renderDelivery({
  title:'Renderer check',
  content:'# 交付标题\n\n- [x] 已完成\n\n![本地图](<图片 目录/示例(一).png>)\n\n![外链图](https://example.invalid/image.png)\n',
  images:{'图片 目录/示例(一).png':localURL},
  missing:[],
  external:1,
 });
 const task=delivery.querySelector<HTMLInputElement>('input[type=checkbox]');
 assert(task, 'task marker was not rendered as a checkbox');
 assert(task.disabled&&task.checked, 'completed task checkbox must be checked and readonly');
 equal(delivery.querySelector('img')?.getAttribute('src'),localURL,'delivery local image was not installed synchronously');
 assert(!delivery.querySelector('img[src^="http"]'),'delivery started an external image request');
 equal(delivery.querySelector<HTMLAnchorElement>('a[href^="https://example.invalid"]')?.textContent,'外链图（联网查看）','delivery external image was not converted to a link');
 assert(delivery.querySelector('a[href^="https://example.invalid"]')?.parentElement?.classList.contains('delivery-image-note'),'delivery image notice styling changed');
 assert(!delivery.querySelector('.markdown-document, .markdown-image-note, .task-list, .task-list-item'),'preview classes leaked into delivery');
 equal(delivery.querySelector('h1')?.getAttribute('style'),'font-size:30px;line-height:1.5;margin:24px 0 18px;','delivery heading print styles changed');
 assert(delivery.style.fontFamily.includes('PingFang SC'),'delivery root print styles changed');
 return 'shared renderer and delivery DOM checks passed';
}
