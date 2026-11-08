import {it,expect} from 'vitest';
import puppeteer from 'puppeteer';
import {knowledgeVisualDesignSchema,validateKnowledgeDesignBatch,KNOWLEDGE_DESIGN_MARKER} from './knowledgeDecorations';
import {knowledgeContentDesignPlan,knowledgeVisualDesignPlanSchema,contentDecoration} from './knowledgeContentDesign';
import {knowledgeDesignedReviewSchema,type KnowledgeReview} from './knowledgePublication';
import {buildKnowledgeBookletHtml} from './knowledgeBooklet';
import {KNOWLEDGE_READING_INSTRUCTIONS} from './knowledgePublicationLayout';
const fixture=():KnowledgeReview=>({kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:'设计验收',pages:['秦汉制度与郡县','楚汉战争与路线','老庄思想','扁鹊医案'].map((headline,i)=>({id:'page-'+i,headline,body:'完整说明',imageDescription:'',imageStatus:'absent',facts:[{term:headline,statement:'完整说明'}],cautions:[],reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:'原文',text:'完整说明',note:''}],decoration:{artworkId:'none',header:'plain',divider:'none',table:'plain',interleave:'none',reason:'顾问设计',design:knowledgeVisualDesignSchema.parse({palette:['bronze-sand','ink-cinnabar','jade-paper','jade-paper'][i],layout:i===0?'catalog':'narrative',table:'rules',frame:'none',motif:['bamboo-seal','route-array','book-scroll','herb-leaf'][i],reason:'此章内容与该设计关系由顾问明确说明。'})}}}))});
it('设计字段仍可渲染，重复风格不再拒收，prompt继续提供内容设计要求',()=>{
 const report=fixture(),plan=knowledgeContentDesignPlan(report);expect(plan).toHaveLength(4);expect(KNOWLEDGE_READING_INSTRUCTIONS).toContain(KNOWLEDGE_DESIGN_MARKER);
 for(const key of ['palette','layout','table','frame','motif','reason']){const copy:any={...plan[0].design};delete copy[key];expect(knowledgeVisualDesignSchema.safeParse(copy).success).toBe(false);}
 expect(knowledgeVisualDesignSchema.safeParse({...plan[0].design,extra:'unknown'}).success).toBe(false);
 const repeated=plan.map((p,i)=>({pageId:p.pageId,design:{...p.design,motif:i<2?'route-array' as const:p.design.motif}}));expect(knowledgeVisualDesignPlanSchema.safeParse(repeated).success).toBe(true);
 const complete=plan.map(p=>({reading:{decoration:{design:p.design}}}));expect(()=>validateKnowledgeDesignBatch(complete)).not.toThrow();
});
it('消费端保留结构校验，重复设计不阻断导出且不改写已保存正文',()=>{
 const report=fixture(),baseline=JSON.stringify(report);const plan=knowledgeContentDesignPlan(report);
 expect(plan.map(p=>p.design)).toEqual(report.pages.map(p=>p.reading!.decoration!.design));expect(JSON.stringify(report)).toBe(baseline);
 report.pages[0].reading!.decoration!.design=undefined;
 expect(()=>knowledgeContentDesignPlan(report)).toThrow('缺少');
 const repeated=fixture();repeated.pages[1].reading!.decoration!.design=repeated.pages[0].reading!.decoration!.design;
 expect(()=>knowledgeContentDesignPlan(repeated)).not.toThrow();
});
it('真实浏览器中章节配色互不覆盖、续页不重复纹样、表格/全字/打印不溢出',async()=>{
 const report=fixture(),plans=knowledgeContentDesignPlan(report);
 const body=Array.from({length:8},(_,i)=>`### 段落${i}\n\n${'完整史料不得删减。'.repeat(42)}\n\n|事项|说明|\n|---|---|\n|甲|真实内容保留|\n|乙|保持原始顺序|`).join('\n\n')+'\n\n末句完整保留。';
 const html='<html><body>'+plans.map((p,i)=>buildKnowledgeBookletHtml({title:report.pages[i].headline,fragment:true,decoration:contentDecoration({artworkId:'none',header:'plain',divider:'none',table:'plain',interleave:'none',reason:'验证设计'},p.design),pages:[{id:p.pageId,headline:report.pages[i].headline,body,imageUrl:''}]})).join('')+'</body></html>';
 const browser=await puppeteer.launch({headless:true});try{const page=await browser.newPage();await page.setViewport({width:1800,height:1000});await page.setContent(html,{waitUntil:'load'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-booklet-root]')).every(e=>e.getAttribute('data-ready')==='true'),{timeout:30000});
 const checked=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-booklet-root]')).map(root=>({palette:getComputedStyle(root).getPropertyValue('--paper'),ink:getComputedStyle(root.querySelector('th')!).backgroundColor,overflow:Array.from(root.querySelectorAll('.folio,.reading-column')).some(e=>e.scrollHeight>e.clientHeight+2),continued:Array.from(root.querySelectorAll('.reading-continuation .content-motif')).every(e=>getComputedStyle(e).display==='none'),count:root.querySelectorAll('.reading-continuation').length,art:getComputedStyle(root.querySelector('.reading-title')!,'::before').backgroundImage,end:root.textContent?.includes('末句完整保留。')})));
 expect(new Set(checked.map(c=>c.palette)).size).toBe(3);expect(checked.every(c=>!c.overflow&&c.continued&&c.count>0&&c.art==='none'&&c.end)).toBe(true);
 await page.emulateMediaType('print');expect(Buffer.from(await page.pdf({preferCSSPageSize:true,printBackground:true})).subarray(0,4).toString()).toBe('%PDF');
 }finally{await browser.close();}
},60000);
