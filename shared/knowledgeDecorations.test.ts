import {it,expect} from 'vitest';
import puppeteer from 'puppeteer';
import {knowledgeDecorationSchema,resolveKnowledgeDecoration,knowledgeDecorationCatalog,KNOWLEDGE_DECORATION_MARKER} from './knowledgeDecorations';
import {knowledgeReadingSchema,KNOWLEDGE_READING_INSTRUCTIONS} from './knowledgePublicationLayout';
import {knowledgePublicationSchema} from './knowledgePublication';
import {buildKnowledgeBookletHtml} from './knowledgeBooklet';
import {knowledgePublicationHead} from './knowledgePublicationHtml';
import {KNOWLEDGE_DECORATION_ART} from './knowledgeDecorationAssets';
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2s8AAAAASUVORK5CYII=';
it('组件配置严格、素材非空、完整云稿序列化后不被剥离',()=>{
 for(const a of knowledgeDecorationCatalog.artwork)if(a.id!=='none')expect(KNOWLEDGE_DECORATION_ART[a.id]?.length).toBeGreaterThan(50000);
 const decoration=resolveKnowledgeDecoration(undefined,'史记');expect(knowledgeDecorationSchema.safeParse({...decoration,artworkId:'unknown'}).success).toBe(false);
 expect(knowledgeDecorationSchema.safeParse({...decoration,artworkId:'none'}).success).toBe(false);
 const reading={version:1,subtitle:'正文',accent:'jade',decoration,blocks:[{type:'prose',title:'主题',text:'完整说明',note:''}]};
 expect(knowledgeReadingSchema.parse(JSON.parse(JSON.stringify(reading))).decoration).toEqual(decoration);
 const id='11111111-1111-4111-8111-111111111111';const source={title:'史记',pages:[{id,headline:'主题',body:'正文',imageUrl:''}]};
 const doc={version:1,requestId:id,source,manuscript:'正文',review:{kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:'史记',pages:[{id,headline:'主题',body:'正文',reading,imageDescription:'',imageStatus:'absent',facts:[{term:'主题',statement:'正文'}],cautions:[]}]}};
 expect(knowledgePublicationSchema.parse(JSON.parse(JSON.stringify(doc))).review!.pages[0].reading!.decoration).toEqual(decoration);
 expect(KNOWLEDGE_READING_INSTRUCTIONS).toContain(KNOWLEDGE_DECORATION_MARKER);
});
it('真实浏览器显示不同组件且章节互不串图，原图穿插完整，打印重排不溢出',async()=>{
 const ancient=resolveKnowledgeDecoration(undefined,'史记');const cinema={...ancient,artworkId:'cinema-blue' as const,divider:'geometric' as const,interleave:'artwork-strip' as const};
 const html=knowledgePublicationHead('组件验收')+[ancient,cinema].map((decoration,i)=>buildKnowledgeBookletHtml({title:'组件验收',fragment:true,decoration,pages:[{id:'page-'+i,headline:i?'电影影像':'史记',imageUrl:pixel,body:'### 完整正文\n\n保留全部原始说明。\n\n'+Array.from({length:6},(_,k)=>`### 延伸${k}\n\n${'续页正文完整保留。'.repeat(40)}`).join('\n\n')+'\n\n### 对比表\n\n|项目|解释|\n|---|---|\n|真实项目|完整解释|\n\n尾句不得丢失。'}]})).join('')+'</body></html>';
 const browser=await puppeteer.launch({headless:true});try{const page=await browser.newPage();await page.setContent(html,{waitUntil:'load'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-booklet-root]')).every(e=>e.getAttribute('data-ready')==='true'));await page.emulateMediaType('print');
 const results=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-booklet-root]')).map(root=>({background:getComputedStyle(root.querySelector('.reading-title')!,'::before').backgroundImage,ink:getComputedStyle(root.querySelector('.prose-unit')!).color,overflow:Array.from(root.querySelectorAll('.folio,.reading-column')).some(e=>e.scrollHeight>e.clientHeight+2),visual:root.querySelector('.interleaved-visual img')?.getAttribute('src'),objectFit:getComputedStyle(root.querySelector('.main-card img')!).objectFit,svg:root.querySelectorAll('.decoration-divider').length,text:root.textContent})));
 expect(results[0].background).not.toBe(results[1].background);expect(results[0].ink).not.toBe(results[1].ink);expect(results.every(r=>!r.overflow&&r.objectFit==='contain'&&r.svg>0&&r.text?.includes('尾句不得丢失'))).toBe(true);// 2026-11-08：原图与要点同页置顶，正文不再重复穿插原图。
 expect(results[0].visual).toBeUndefined();expect(results[1].visual).toBe(KNOWLEDGE_DECORATION_ART['cinema-blue']);
 const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(Buffer.from(pdf).subarray(0,4).toString()).toBe('%PDF');
 }finally{await browser.close()}
},60000);
