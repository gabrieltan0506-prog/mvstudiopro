import {it,expect,beforeAll,afterAll} from 'vitest';
import puppeteer,{type Browser,type Page} from 'puppeteer';
import {deflateSync} from 'node:zlib';
import {layoutFromSource} from './editableLayout';
import {knowledgePublicationChapter,knowledgePublicationHead,knowledgePublicationImageModes} from './knowledgePublicationHtml';
import {KNOWLEDGE_BOOKLET_MAX_WHITESPACE} from './knowledgeBooklet';
import {finalizeKnowledgeBookletPagination} from '../pdf-worker/knowledgeBookletPagination';
import {pdfImageCompressionScript} from '../pdf-worker/pdfImageCompression';

// 2026-11-11 用户四条意见的版式验收：跨页大图、每页留白 ≤ 1/3、下篇预告、清晰度标记。
// 按导出真实路径逐章渲染（每章一个片段、先预分页再带全书页码定稿），配图以 https 地址经请求拦截提供（不内嵌）。
const png=(w:number,h:number,shade:number)=>{const crc=(b:Buffer)=>{let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return (~c)>>>0;};
 const chunk=(t:string,d:Buffer)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
 const row=Buffer.concat([Buffer.from([0]),Buffer.alloc(w*3,shade)]);
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ih),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:h},()=>row)))),chunk('IEND',Buffer.alloc(0))]);};
const HOST='https://images.test.invalid/';
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

it('跨页大图与留白补位：逐章渲染后每页留白 ≤ 1/3，正文不截断不越界，页码连续，章序不变，图片数正确',async()=>{
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
     mainImages:folios.flatMap(f=>Array.from(f.querySelectorAll('.main-card img,.spread-card img')).map(img=>({src:(img as HTMLImageElement).dataset.pdfMaxDim,w:img.getBoundingClientRect().width}))),
     sources:Array.from(document.querySelectorAll('#reading-pages .reading-unit')).map(u=>(u as HTMLElement).dataset.sourceId),
     text:document.querySelector('#reading-pages')!.textContent||'',previews:Array.from(document.querySelectorAll('#reading-pages .next-preview h4')).map(e=>e.textContent),
     ending:Array.from(document.querySelectorAll('#reading-pages .filler-label')).map(e=>e.textContent),parkedFolios:document.querySelectorAll('.image-variants .folio').length};
   }));
   offset+=counts[i];
  }
  // 预分页与定稿页数一致（否则导出会报页数变化）。
  expect(chapters.map(c=>c.result.pages)).toEqual(counts);
  for(const [i,c] of chapters.entries()){
   expect(c.result.ready).toBe(true);
   expect(c.overflow).toEqual([]);expect(c.columnsOverflow).toBe(false);expect(c.fillerOverlap).toBe(false);
   // 用户硬上限：任一页留白（补位后）≤ 版心 1/3。
   for(const w of c.result.whitespace)expect(w).toBeLessThanOrEqual(KNOWLEDGE_BOOKLET_MAX_WHITESPACE);
   expect(c.parkedFolios).toBe(0);
   // 章序不变：本片段正文全部来自本章。
   expect(new Set(c.sources)).toEqual(new Set([doc.pages[i].id]));
   // 图片元素：图文同页 1 张、跨页两半各 1 张（同一地址），均带清晰度标记。
   const mode=c.result.imageModes[doc.pages[i].id];
   expect(c.mainImages).toHaveLength(mode==='spread'?2:1);
   expect(c.mainImages.every((m:any)=>m.src==='2048')).toBe(true);
   if(mode==='spread'){expect(c.kinds.slice(0,2)).toEqual(['跨','跨']);expect(c.mainImages[0].w).toBeGreaterThan(2400);}
   else expect(c.kinds[0]).toBe('图');
  }
  // 页码连续：01/NN … NN/NN。
  expect(chapters.flatMap(c=>c.numbers)).toEqual(Array.from({length:total},(_,i)=>`${String(i+1).padStart(2,'0')} / ${String(total).padStart(2,'0')}`));
  // 正文不截断、不重复：每个标记恰好出现一次，且按原顺序。
  const all=chapters.map(c=>c.text).join('');
  const found=all.match(/标记\d{3}/g)||[];
  expect(found).toEqual(marks);
  // 只指向图中位置的读图提示不印出。
  expect(all).not.toContain('读图提示');
  // 至少有短章采用跨页；页数增量受控（每章最多多 1 页）。
  const modes=chapters.map((c,i)=>c.result.imageModes[doc.pages[i].id]);
  expect(modes).toContain('spread');
  expect(total).toBeLessThanOrEqual(doc.pages.length*2+3);
  // 下篇预告只指向真实的下一章；末章不预告。
  for(const [i,c] of chapters.entries())for(const title of c.previews)expect(title).toBe(doc.pages[i+1]?.headline);
  expect(chapters.at(-1)!.previews).toEqual([]);
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

it('全书页数上限：完整版按章分配跨页名额，估算总页数不超过 72',()=>{
 const pages=Array.from({length:48},(_,i)=>({body:'短'.repeat(i%3?200:900),imageUrl:'gs://x/'+i}));
 const modes=knowledgePublicationImageModes(pages,'full');
 const inline=pages.reduce((n,p)=>n+1+Math.ceil(Math.max(0,p.body.length-700)/1300),0);
 expect(inline+modes.filter(m=>m==='auto').length).toBeLessThanOrEqual(72);
 // 名额先给正文最短的章。
 const auto=modes.flatMap((m,i)=>m==='auto'?[pages[i].body.length]:[]),rest=modes.flatMap((m,i)=>m==='inline'?[pages[i].body.length]:[]);
 expect(Math.max(...auto)).toBeLessThanOrEqual(Math.min(...rest));
 expect(knowledgePublicationImageModes(pages.slice(0,34).map(p=>({...p,body:'短'.repeat(300)})),'full').every(m=>m==='auto')).toBe(true);
 // 无图章节不参与跨页。
 expect(knowledgePublicationImageModes([{body:'x',imageUrl:''}],'full')).toEqual(['inline']);
});
