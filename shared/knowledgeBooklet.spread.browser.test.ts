import {it,expect,beforeAll,afterAll} from 'vitest';
import puppeteer,{type Browser,type Page} from 'puppeteer';
import {deflateSync} from 'node:zlib';
import {layoutFromSource} from './editableLayout';
import {knowledgePublicationChapter,knowledgePublicationHead} from './knowledgePublicationHtml';
import {KNOWLEDGE_BOOKLET_MAX_WHITESPACE,KNOWLEDGE_BOOKLET_IMAGE_MIN_WIDTH_RATIO} from './knowledgeBooklet';
import {mkdirSync} from 'node:fs';
import {auditKnowledgeBookletLayout} from './knowledgeLayoutAudit';
import {finalizeKnowledgeBookletPagination} from '../pdf-worker/knowledgeBookletPagination';
import {pdfImageCompressionScript} from '../pdf-worker/pdfImageCompression';

// 版式验收：站长 2026-11-12 整图版式（不切图、无跨页半张、预告无裁切条、图等比例不变形、缩小不低于版心 85%），
// 沿用 2026-11-11 每页留白 ≤ 1/3、下篇预告标题、清晰度标记。
// 按导出真实路径逐章渲染（每章一个片段、先预分页再带全书页码定稿），配图以 https 地址经请求拦截提供（不内嵌）。
const png=(w:number,h:number,shade:number)=>{const crc=(b:Buffer)=>{let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return (~c)>>>0;};
 const chunk=(t:string,d:Buffer)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
 const row=Buffer.concat([Buffer.from([0]),Buffer.alloc(w*3,shade)]);
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ih),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:h},()=>row)))),chunk('IEND',Buffer.alloc(0))]);};
const HOST='https://images.test.invalid/';
const LONG_MIN=1500,LONG_SPAN=500;
const files=new Map(Array.from({length:7},(_,i)=>[`${HOST}${i}.png`,png(1600,900,0x90+i*10)]));
// 按句生成正文并嵌入唯一标记，验收「不截断、不重复、不换序」。
let mark=0;const marks:string[]=[];
const sentences=(n:number,seed:string)=>Array.from({length:n},()=>{const m=`标记${String(++mark).padStart(3,'0')}`;marks.push(m);return `${m}${seed}，按原顺序完整保留。`;}).join('');
const bodies=[
 `## 长正文一\n\n${sentences(14,'签约前要看清推荐位与运营资源的前提条件')}\n\n## 长正文二\n\n${sentences(14,'合同里的版权期限与改编分成需要逐条确认')}`,
 `## 短正文\n\n${sentences(2,'稳定日更比题材更重要')}`,
 `## 含表格\n\n|平台|收入来源|门槛|\n|---|---|---|\n${Array.from({length:9},(_,i)=>{const m=`标记${String(++mark).padStart(3,'0')}`;marks.push(m);return `|类型${i+1}|${m}订阅与广告|日更四千字|`;}).join('\n')}\n\n${sentences(3,'表中数字为经验估计')}`,
 `## 长列表\n\n${Array.from({length:16},()=>`- ${sentences(1,'确认赛道、读者画像与存稿数量')}`).join('\n')}`,
 `## 中等正文\n\n${sentences(9,'冷门与热门之间的中间地带适合新人切入')}`,
 `## 只指向图中位置的提示\n\n${sentences(3,'追更动力来自悬念与情绪回报')}\n\n> 读图提示：对应左上角三幕结构卡`,
 `## 结语\n\n${sentences(2,'坚持看产出不看年限')}`,
];
const doc=layoutFromSource({kind:'knowledge-publication',detailLevel:'full',owner:'7',sourceId:'spread-fill',title:'网文副业入门',body:'',pages:bodies.map((body,i)=>({headline:`第${i+1}章`,body,pageIndex:i+1})),images:Object.fromEntries(bodies.map((_,i)=>[i+1,`gs://test/${i}.png`]))});
// 图内文字量（旧版按它分配跨页名额；新版式忽略，一律整图图文同页）。
doc.publication!.source.pages.forEach((p,i)=>{p.body='图内要点'.repeat([1,30,2,3,25,28,26][i]!);});
const review:any={title:doc.title,pages:doc.pages.map(p=>({...p,imageDescription:'测试配图',reading:{templateId:'fusion_snow_monastery'},cautions:[]}))};
const address=(i:number)=>`${HOST}${i}.png`;

let browser:Browser;
beforeAll(async()=>{browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-web-security']});});
afterAll(async()=>{await browser?.close();});
const open=async()=>{
 const page=await browser.newPage();await page.setViewport({width:1920,height:1600});
 await page.setRequestInterception(true);
 page.on('request',r=>{const body=files.get(r.url());if(body)r.respond({status:200,contentType:'image/png',body});else if(r.url().startsWith(HOST))r.respond({status:404,body:''});else r.continue();});
 return page;
};
// 与排版服务同序：载入 → 字体 → 图片 → 压缩脚本 → 打印媒体 → 定稿分页。
const prepare=async(page:Page,html:string)=>{
 await page.setContent(html,{waitUntil:'load'});await page.evaluate('document.fonts.ready');
 await page.evaluate(pdfImageCompressionScript(2048));await page.emulateMediaType('print');
 return finalizeKnowledgeBookletPagination(page);
};
const section=(i:number)=>knowledgePublicationChapter(doc,review,i,address(i),false,doc.pages[i+1]?address(i+1):'');

it('整图版式与留白补位：逐章渲染后每章一张完整整图在上、无裁切，每页留白 ≤ 1/3，正文不截断不越界，页码连续，章序不变',async()=>{
 const page=await open();
 try{
  const counts:number[]=[];
  for(let i=0;i<doc.pages.length;i++)counts.push(await prepare(page,knowledgePublicationHead(doc.title)+section(i)+'</body></html>'));
  const total=counts.reduce((a,b)=>a+b,0);let offset=0;
  const chapters:any[]=[];
  for(let i=0;i<doc.pages.length;i++){
   await prepare(page,knowledgePublicationHead(doc.title,{offset,total,count:counts[i]})+section(i)+'</body></html>');
   chapters.push(await page.evaluate(()=>{
    const root=document.querySelector('[data-booklet-root]') as any,folios=Array.from(document.querySelectorAll('#reading-pages .folio')) as HTMLElement[];
    const overflow=folios.flatMap(f=>{const foot=f.querySelector('footer')!.getBoundingClientRect().top;return Array.from(f.querySelectorAll('.reading-unit,.page-filler')).filter(u=>u.getBoundingClientRect().bottom>foot+1).map(u=>(u.textContent||'').slice(0,12));});
    const fillerOverlap=folios.some(f=>{const units=Array.from(f.querySelectorAll('.reading-unit')).map(u=>u.getBoundingClientRect());return Array.from(f.querySelectorAll('.page-filler')).some(x=>{const b=x.getBoundingClientRect();return units.some(u=>u.left<b.right-1&&b.left<u.right-1&&u.top<b.bottom-1&&b.top<u.bottom-1);});});
    return {result:root.__knowledgeBooklet,overflow,fillerOverlap,columnsOverflow:Array.from(document.querySelectorAll('#reading-pages .reading-column')).some(c=>c.scrollHeight>c.clientHeight+2),
     numbers:folios.map(f=>f.querySelector('.page-number')!.textContent),kinds:folios.map(f=>f.classList.contains('spread-folio')?'跨':f.classList.contains('lead-folio')?'图':'文'),
     mainImages:folios.flatMap(f=>Array.from(f.querySelectorAll('.main-card img')).map(img=>{const r=img.getBoundingClientRect(),cs=getComputedStyle(f);const i=img as HTMLImageElement;return {src:i.dataset.pdfMaxDim,quality:i.dataset.pdfQuality,w:r.width,h:r.height,nw:i.naturalWidth,nh:i.naturalHeight,inner:f.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)};})),
     cropped:document.querySelectorAll('.spread-folio,.spread-card,.preview-strip,.next-preview img,.next-source img').length,
     allImages:Array.from(document.querySelectorAll('img')).filter(i=>!i.classList.contains('decoration-resource')&&!i.closest('.reading-unit')).length,
     sources:Array.from(document.querySelectorAll('#reading-pages .reading-unit')).map(u=>(u as HTMLElement).dataset.sourceId),
     text:document.querySelector('#reading-pages')!.textContent||'',previews:Array.from(document.querySelectorAll('#reading-pages .next-preview h4')).map(e=>e.textContent),previewClipped:Array.from(document.querySelectorAll('#reading-pages .next-preview')).filter(el=>{const h=el.querySelector('h4') as HTMLElement,s=el.querySelector('.preview-strip') as HTMLElement|null;const hr=h.getBoundingClientRect(),er=el.getBoundingClientRect();return h.scrollHeight-h.clientHeight>2||hr.bottom>er.bottom||(!!s&&s.getBoundingClientRect().top<hr.bottom-0.5);}).length,
     ending:Array.from(document.querySelectorAll('#reading-pages .filler-label')).map(e=>e.textContent),parkedFolios:document.querySelectorAll('.image-variants .folio').length};
   }));
   offset+=counts[i];
  }
  // 预分页与定稿页数一致（否则导出会报页数变化）。
  expect(chapters.map(c=>c.result.pages)).toEqual(counts);
  for(const [i,c] of Array.from(chapters.entries())){
   expect(c.result.ready).toBe(true);
   expect(c.overflow).toEqual([]);expect(c.columnsOverflow).toBe(false);expect(c.fillerOverlap).toBe(false);
   // 用户硬上限：任一页留白（补位后）≤ 版心 1/3。
   for(const w of c.result.whitespace)expect(w).toBeLessThanOrEqual(KNOWLEDGE_BOOKLET_MAX_WHITESPACE);
   expect(c.parkedFolios).toBe(0);
   // 章序不变：本片段正文全部来自本章。
   expect(new Set(c.sources)).toEqual(new Set([doc.pages[i].id]));
   // 整图：每章恰好 1 张、在首页（图文同页），带清晰度标记 2048/0.85；无跨页半张、无预告图片条，片段里不再出现下一章图片。
   expect(c.result.imageModes[doc.pages[i].id]).toBe('inline');
   expect(c.kinds[0]).toBe('图');expect(c.kinds.slice(1).every((k:string)=>k==='文')).toBe(true);
   expect(c.mainImages).toHaveLength(1);expect(c.allImages).toBe(1);expect(c.cropped).toBe(0);
   const m=c.mainImages[0];
   expect([m.src,m.quality]).toEqual(['2048','0.85']);
   // 等比例、完整：显示宽高比 = 原图宽高比（±1px）；宽度 ≥ 版心 × 下限。
   expect(Math.abs(m.h-m.w*m.nh/m.nw)).toBeLessThanOrEqual(1);
   expect(m.w).toBeGreaterThanOrEqual(m.inner*KNOWLEDGE_BOOKLET_IMAGE_MIN_WIDTH_RATIO-1);
   expect(m.w).toBeLessThanOrEqual(m.inner+1);
  }
  // 页码连续：01/NN … NN/NN。
  expect(chapters.flatMap(c=>c.numbers)).toEqual(Array.from({length:total},(_,i)=>`${String(i+1).padStart(2,'0')} / ${String(total).padStart(2,'0')}`));
  // 正文不截断、不重复：每个标记恰好出现一次，且按原顺序。
  const all=chapters.map(c=>c.text).join('');
  const found=all.match(/标记\d{3}/g)||[];
  expect(found).toEqual(marks);
  // 只指向图中位置的读图提示不印出。
  expect(all).not.toContain('读图提示');
  // 一律整图图文同页（不再分配跨页名额）。
  expect(chapters.every(c=>c.result.spreadChapters===0)).toBe(true);
  expect(total).toBeLessThanOrEqual(11+2);
  // 下篇预告只指向真实的下一章；末章不预告。
  for(const [i,c] of Array.from(chapters.entries()))for(const title of c.previews)expect(title).toBe(doc.pages[i+1]?.headline);
  expect(chapters.at(-1)!.previews).toEqual([]);
  // 下篇预告的标题行必须完整露出（已无裁切条）。
  expect(chapters.reduce((n,c)=>n+c.previewClipped,0)).toBe(0);
 }finally{await page.close();}
},180000);

it('排版服务图片压缩：带标记且未超上限的图原样透传，超上限按标记缩到 2048；无标记的图仍按 1200 / 0.75',async()=>{
 const page=await browser.newPage();
 try{
  const big=png(3000,1688,0x80).toString('base64'),small=png(1600,900,0x70).toString('base64');
  await page.setContent(`<img id="tagged-big" data-pdf-max-dim="2048" data-pdf-quality="0.85" src="data:image/png;base64,${big}"><img id="plain" src="data:image/png;base64,${big}"><img id="tagged-small" data-pdf-max-dim="2048" src="data:image/png;base64,${small}">`);
  await page.evaluate(()=>Promise.all(Array.from(document.images).map(i=>i.decode())));
  await page.evaluate(pdfImageCompressionScript(2048));
  const sizes=await page.evaluate(()=>Object.fromEntries(Array.from(document.images).map(i=>[i.id,[i.naturalWidth,i.naturalHeight,i.src.slice(0,15)]])));
  expect(sizes['tagged-big'].slice(0,2)).toEqual([2048,1152]);
  expect(sizes['plain'].slice(0,2)).toEqual([1200,675]);
  // 数据地址的小图仍可能被重编码为更小的 JPEG，但尺寸不变。
  expect(sizes['tagged-small'].slice(0,2)).toEqual([1600,900]);
  // 环境上限低于标记时以环境为准。
  await page.setContent(`<img id="capped" data-pdf-max-dim="4096" src="data:image/png;base64,${big}">`);
  await page.evaluate(()=>Promise.all(Array.from(document.images).map(i=>i.decode())));
  await page.evaluate(pdfImageCompressionScript(1600));
  expect(await page.$eval('#capped',i=>(i as HTMLImageElement).naturalWidth)).toBe(1600);
 }finally{await page.close();}
},60000);

it('34 章完整版（整图版式，长短混合）：逐章排版后总页数落在 48–54，任一页留白 ≤ 1/3，整图完整不裁切',async()=>{
 const n=34;
 // 参考成品（站长上传，34 图 51 页）的分布：约一半章节图下放不完、接一页纯文字续页，其余章图文同页即可放下。
 const density=(i:number)=>(i*37)%n;            // 打散长章位置
 const long=(i:number)=>density(i)>=n-17;
 const sizes=Array.from({length:n},(_,i)=>long(i)?LONG_MIN+(i*53)%LONG_SPAN:200+(i*71)%450);
 const book=layoutFromSource({kind:'knowledge-publication',detailLevel:'full',owner:'7',sourceId:'thirty-four',title:'网文副业入门',body:'',
  pages:sizes.map((size,i)=>({headline:`第${i+1}章 标题`,body:`## 小节甲\n\n${sentences(Math.max(1,Math.round(size/2/24)),'作者经验与平台规则的背景说明')}\n\n## 小节乙\n\n${sentences(Math.max(1,Math.round(size/2/24)),'例子与注意事项')}`,pageIndex:i+1})),
  images:Object.fromEntries(Array.from({length:n},(_,i)=>[i+1,`gs://test/${i%7}.png`]))});
 book.publication!.source.pages.forEach((p,i)=>{p.body='图内要点'.repeat(10+density(i)*5);});
 const bookReview:any={title:book.title,pages:book.pages.map(p=>({...p,imageDescription:'测试配图',reading:{templateId:'fusion_snow_monastery'},cautions:[]}))};
 const at=(i:number)=>`${HOST}${i%7}.png`;
 const html=(i:number,pagination?:{offset:number;total:number;count:number})=>knowledgePublicationHead(book.title,pagination)+knowledgePublicationChapter(book,bookReview,i,at(i),false,book.pages[i+1]?at(i+1):'')+'</body></html>';
 const page=await open();
 try{
  const counts:number[]=[];
  for(let i=0;i<n;i++)counts.push(await prepare(page,html(i)));
  const total=counts.reduce((a,b)=>a+b,0);
  expect(total).toBeGreaterThanOrEqual(48);expect(total).toBeLessThanOrEqual(54);
  let offset=0;const whitespace:number[]=[];let spreads=0;const layout:any[]=[];
  const snapshots=process.env.KNOWLEDGE_LAYOUT_SNAPSHOT_DIR;if(snapshots)mkdirSync(snapshots,{recursive:true});
  for(let i=0;i<n;i++){
   await prepare(page,html(i,{offset,total,count:counts[i]!}));
   const r=await page.evaluate(()=>(document.querySelector('[data-booklet-root]') as any).__knowledgeBooklet);
   expect(r.ready).toBe(true);whitespace.push(...r.whitespace);layout.push(...r.layout);spreads+=r.spreadChapters;
   // 样张（可选）：设 KNOWLEDGE_LAYOUT_SNAPSHOT_DIR 时把前几章逐页截图。
   if(snapshots&&i<8){const els=await page.$$('#reading-pages .folio');for(let k=0;k<els.length;k++){const el=els[k]!;await el.screenshot({path:`${snapshots}/page-${String(offset+k+1).padStart(2,'0')}.png`});}}
   offset+=counts[i]!;
  }
  expect(whitespace).toHaveLength(total);
  expect(Math.max(...whitespace)).toBeLessThanOrEqual(KNOWLEDGE_BOOKLET_MAX_WHITESPACE);
  expect(spreads).toBe(0);
  // 每页整图实测：等比例（±1px）、完整在框内、宽度不低于版心 × 下限；全册无裁切图。
  const images=layout.flatMap((p:any)=>p.images||[]);
  expect(images).toHaveLength(n);
  for(const img of images){
   expect(Math.abs(img.height-img.width*img.naturalHeight/img.naturalWidth)).toBeLessThanOrEqual(1);
   expect(img.inside).toBe(true);
   expect(img.width).toBeGreaterThanOrEqual(img.contentWidth*KNOWLEDGE_BOOKLET_IMAGE_MIN_WIDTH_RATIO-1);
  }
  expect(layout.every((p:any)=>p.croppedImages===0)).toBe(true);
  // 排版后快速版面审查（确定性、不调模型）：真实渲染的整册无溢出/遮挡/裁切/变形/过小/超限留白/页码断档/坏图。
  expect(layout).toHaveLength(total);
  expect(auditKnowledgeBookletLayout(layout).issues).toEqual([]);
 }finally{await page.close();}
},300000);
