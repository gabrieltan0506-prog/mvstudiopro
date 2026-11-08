import {it,expect,beforeAll,afterAll} from 'vitest';
import puppeteer,{type Browser} from 'puppeteer';
import {deflateSync} from 'node:zlib';
import {buildKnowledgeBookletHtml,isImagePointerNote} from './knowledgeBooklet';

// 1200×840 纯色 PNG，模拟置顶配图（尺寸与正式页一致比例）。
const png=(w:number,h:number)=>{const crc=(b:Buffer)=>{let c=~0;for(let i=0;i<b.length;i++){const x=b[i];c^=x;for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return (~c)>>>0;};
 const chunk=(t:string,d:Buffer)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
 const row=Buffer.concat([Buffer.from([0]),Buffer.alloc(w*3,0xcc)]);const raw=Buffer.concat(Array.from({length:h},()=>row));
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');};
const img=png(1200,840);
const para=(n:number,seed:string)=>(seed+'，').repeat(Math.ceil(n/(seed.length+1))).slice(0,n)+'。';

let browser:Browser;
beforeAll(async()=>{browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});});
afterAll(async()=>{await browser?.close();});
const render=async(html:string)=>{
  const page=await browser.newPage();
  await page.setContent(html);
  await page.waitForFunction(()=>Boolean((window as any).__knowledgeBooklet?.ready||(window as any).__knowledgeBooklet?.error));
  const out=await page.evaluate(()=>{
    const folios=Array.from(document.querySelectorAll('#reading-pages .folio')) as HTMLElement[];
    const overflow=folios.flatMap(f=>{const foot=f.querySelector('footer')!.getBoundingClientRect().top;return Array.from(f.querySelectorAll('.reading-unit')).filter(u=>u.getBoundingClientRect().bottom>foot+1).map(u=>u.textContent!.slice(0,20));});
    const lead=folios.filter(f=>f.classList.contains('lead-folio')).map(f=>({units:f.querySelectorAll('.reading-unit').length,density:f.dataset.density||'',heads:f.querySelectorAll('thead').length}));const continuedHeads=folios.filter(f=>!f.classList.contains('lead-folio')).map(f=>f.querySelectorAll('thead').length);const rows=Array.from(document.querySelectorAll('#reading-pages tbody tr')).map(r=>(r as HTMLElement).dataset.sourceRow);
    const figure=folios.map(f=>(f.querySelector('.main-card img') as HTMLElement|null)?.getBoundingClientRect().height||0);
    return {lead,continuedHeads,rows,result:(window as any).__knowledgeBooklet,text:document.querySelector('#reading-pages')!.textContent||'',overflow,figure,pages:folios.length};
  });
  await page.close();return out;
};
// 第31/32页形态：图下左栏一块短文、右栏一块长文，章末一小块补充放不进右栏，旧排法另开一页只放这一块。
const chapter=(tail:string)=>[`## 为什么它被列为控脂食材\n\n${para(230,'真鳕鱼是低脂高蛋白白肉鱼')}`,`## 选购与食用要点\n\n${para(470,'认准具体鱼种标注并按建议频率轮换')}`,`## 牛奶与浓茶的位置\n\n${tail}`].join('\n\n');

it('章末少量补充不再独占续页：收回本章前页余白，全文保留且不越过页脚、不压缩配图',async()=>{
  const body=chapter(para(40,'牛奶与含铁食物间隔一到两小时'));
  const after=await render(buildKnowledgeBookletHtml({title:'控脂手册',pages:[{id:'fish',headline:'鳕鱼营养成分',body,imageUrl:img}]}));
  expect(after.result.ready).toBe(true);
  expect(after.result.readingPages).toBe(0);
  expect(after.pages).toBe(1);
  expect(after.overflow).toEqual([]);
  expect(after.text).toContain('牛奶与含铁食物间隔一到两小时');
  expect(after.text).toContain('认准具体鱼种标注');
  const alone=await render(buildKnowledgeBookletHtml({title:'控脂手册',pages:[{id:'fish',headline:'鳕鱼营养成分',body:`## 只有一块\n\n${para(40,'短')}`,imageUrl:img}]}));
  expect(after.figure[0]).toBeCloseTo(alone.figure[0],0);
},60000);

it('续页内容多时照常分页，不硬塞、不越界',async()=>{
  const body=chapter(para(1800,'牛奶提供钙与优质蛋白血脂偏高者优先低脂'));
  const out=await render(buildKnowledgeBookletHtml({title:'控脂手册',pages:[{id:'fish',headline:'鳕鱼营养成分',body,imageUrl:img}]}));
  expect(out.result.ready).toBe(true);
  expect(out.result.readingPages).toBeGreaterThan(0);
  expect(out.overflow).toEqual([]);
},60000);

it('只指向图中位置的编辑提示不印出；读者正文引用照常保留；全页只剩提示时不清空章节',async()=>{
  expect(isImagePointerNote('图中右下栏已给出杯量与间隔，此处说明道理。')).toBe(true);
  expect(isImagePointerNote('图中已列营养表、真假鳕鱼对比与“低脂、高蛋白、汞低”图标。')).toBe(true);
  expect(isImagePointerNote('图中对比表已列脂肪、EPA/DHA、汞值、儿童食用和价格定位；此处补判断条件。')).toBe(true);
  expect(isImagePointerNote('每周吃鱼两次，每次约150克。')).toBe(false);
  expect(isImagePointerNote('图中待验证框与原表缺行信息如下')).toBe(false);
  expect(isImagePointerNote('图中未列的服用条件：')).toBe(false);
  expect(isImagePointerNote('鱼类'+'很好'.repeat(80))).toBe(false);
  const body=`## 鳕鱼\n\n真鳕鱼是低脂高蛋白白肉鱼。\n\n> 图中右下栏已给出杯量与间隔，此处说明道理。\n\n> 每周吃鱼两次，每次约150克。`;
  const out=await render(buildKnowledgeBookletHtml({title:'控脂手册',pages:[{id:'fish',headline:'鳕鱼',body,imageUrl:img}]}));
  expect(out.text).not.toContain('此处说明道理');
  expect(out.text).toContain('每周吃鱼两次');
  expect(out.text).toContain('真鳕鱼是低脂高蛋白白肉鱼');
  const only=await render(buildKnowledgeBookletHtml({title:'控脂手册',pages:[{id:'fish',headline:'鳕鱼',body:'> 图中已列营养表。',imageUrl:img}]}));
  expect(only.text).toContain('图中已列营养表');
},60000);

// 用户硬规则：不让单图独占一页。首块高于图下栏时旧排法整块让到续页，图页两栏全空。
it('图页首块过高：段落按句切开，前段留在图下，全文按序保留且不越界',async()=>{
  const first=para(590,'血脂偏高者先看低密度脂蛋白胆固醇再看甘油三酯');
  const out=await render(buildKnowledgeBookletHtml({title:'控脂手册',pages:[{id:'lipid',headline:'血脂四项',body:`## 先看哪一项\n\n${first}\n\n## 复查\n\n${para(120,'三个月复查一次')}`,imageUrl:img}]}));
  expect(out.result.ready).toBe(true);
  expect(out.lead[0].units).toBeGreaterThan(0);
  expect(out.overflow).toEqual([]);
  expect(out.text.replace(/\s/g,'')).toContain(first);
  expect(out.text).toContain('三个月复查一次');
},60000);

it('图页首块是长表：按行切开，续块重复表头，行序完整',async()=>{
  const cell=(r:number,c:number)=>`第${r}行第${c}列`+'食材含量与建议'.repeat(8);
  const table=['| 食材 | 含量 | 建议 |','| --- | --- | --- |',...Array.from({length:6},(_,r)=>`| ${cell(r,1)} | ${cell(r,2)} | ${cell(r,3)} |`)].join('\n');
  const out=await render(buildKnowledgeBookletHtml({title:'控脂手册',pages:[{id:'table',headline:'胆固醇含量',body:`## 每百克含量\n\n${table}`,imageUrl:img}]}));
  expect(out.result.ready).toBe(true);
  expect(out.lead[0].units).toBeGreaterThan(0);
  expect(out.overflow).toEqual([]);
  expect(out.rows).toEqual(['0','1','2','3','4','5']);
  expect(out.lead[0].heads+out.continuedHeads.reduce((a,b)=>a+b,0)).toBeGreaterThan(1);
},60000);

it('图页首块是无句读的单句：切不开时收紧图页一档，仍在图下',async()=>{
  const first='血脂偏高者先看低密度脂蛋白胆固醇再看甘油三酯'.repeat(26).slice(0,590);
  const out=await render(buildKnowledgeBookletHtml({title:'控脂手册',pages:[{id:'one',headline:'单句',body:`## 单句\n\n${first}`,imageUrl:img}]}));
  expect(out.result.ready).toBe(true);
  expect(out.lead[0].units).toBe(1);
  expect(out.lead[0].density).toBe('snug');
  expect(out.overflow).toEqual([]);
  expect(out.text.replace(/\s/g,'')).toContain(first);
},60000);
