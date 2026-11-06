import {z} from 'zod';
import type {KnowledgeSource} from './knowledgePublication';
const short=(max:number)=>z.string().trim().min(1).max(max);
export const knowledgePresentationRangeSchema=z.object({minSlides:z.number().int().min(1).max(200),maxSlides:z.number().int().min(1).max(200)}).strict().refine(v=>v.minSlides<=v.maxSlides,'最少页数不能大于最多页数');
export const knowledgePresentationRequestSchema=z.object({id:z.string().uuid(),basis:z.literal('source').optional(),minSlides:z.number().int().min(1).max(200),maxSlides:z.number().int().min(1).max(200),manuscript:short(1000000)}).strict().refine(v=>v.minSlides<=v.maxSlides,'页数范围无效');
/** 完整原稿和稳定配图任务构成早期规划身份，图片就绪不改变身份。 */
export function knowledgePresentationSourceManuscript(source:KnowledgeSource){
 return JSON.stringify({title:source.title,detailLevel:source.detailLevel,pages:source.pages.map(p=>({id:p.id,headline:p.headline,body:p.body,role:p.role,image:p.imageJobId?{jobId:p.imageJobId}:{url:p.imageUrl}}))});
}
export function knowledgePresentationRequestMatches(request:KnowledgePresentationRequest|undefined,pub:{source:KnowledgeSource;manuscript:string}){
 return !!request&&request.manuscript===(request.basis==='source'?knowledgePresentationSourceManuscript(pub.source):pub.manuscript);
}
const common={title:short(40),sourcePageIds:z.array(z.string().uuid()).min(1),notes:z.string().max(2000).default('')};
export const knowledgePresentationSlideSchema=z.discriminatedUnion('type',[
 z.object({...common,type:z.literal('points'),points:z.array(short(60)).min(1).max(5)}).strict(),
 z.object({...common,type:z.literal('table'),columns:z.array(short(12)).min(2).max(4),rows:z.array(z.array(short(20)).min(2).max(4)).min(1).max(5)}).strict(),
 z.object({...common,type:z.literal('image'),imagePageId:z.string().uuid(),points:z.array(short(50)).min(1).max(3)}).strict(),
]);
export const knowledgePresentationPlanSchema=z.object({kind:z.literal('knowledge_presentation_v1'),requestId:z.string().uuid(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),minSlides:z.number().int().min(1).max(200),maxSlides:z.number().int().min(1).max(200),title:short(100),fontStyle:z.enum(['editorial','modern']),slides:z.array(knowledgePresentationSlideSchema).min(1).max(200)}).strict().superRefine((v,ctx)=>{
 if(v.minSlides>v.maxSlides||v.slides.length<v.minSlides||v.slides.length>v.maxSlides)ctx.addIssue({code:'custom',message:'顾问提纲超出用户指定页数范围，未渲染'});
 v.slides.forEach(s=>{if(s.type==='table'&&s.rows.some(r=>r.length!==s.columns.length))ctx.addIssue({code:'custom',message:'课件表格列数不一致'});});
});
export type KnowledgePresentationPlan=z.infer<typeof knowledgePresentationPlanSchema>;
export type KnowledgePresentationRequest=z.infer<typeof knowledgePresentationRequestSchema>;
export function validateKnowledgePresentationPlan(value:unknown,expected:{requestId:string;sourceDigest:string;minSlides:number;maxSlides:number;pages:{id:string;imageUrl:string}[]}){
 const p=knowledgePresentationPlanSchema.parse(value);
 if(p.requestId!==expected.requestId||p.sourceDigest!==expected.sourceDigest||p.minSlides!==expected.minSlides||p.maxSlides!==expected.maxSlides)throw Error('课件提纲与当前稿件或页数范围不一致');
 const ids=new Set(expected.pages.map(p=>p.id));
 if(p.slides.some(s=>s.sourcePageIds.some(id=>!ids.has(id))||(s.type==='image'&&(!s.sourcePageIds.includes(s.imagePageId)||!expected.pages.find(p=>p.id===s.imagePageId)?.imageUrl))))throw Error('课件提纲引用未知章节或缺失原图');
 return p;
}

/** 与PPTX排版共用断行算法，预检不能使用另一套字符估算。 */
export function knowledgePresentationLines(value:string,width:number):string[]{
 const result:string[]=[];
 for(const paragraph of value.split('\n')){
  let line='',units=0;
  for(const char of paragraph){const n=/[\u0020-\u007e]/.test(char)?0.55:1;if(units+n>width&&line){result.push(line);line='';units=0;}line+=char;units+=n;}
  result.push(line);
 }
 return result;
}
export function knowledgePresentationCapacityIssues(plan:KnowledgePresentationPlan):string[]{
 const issues:string[]=[];
 plan.slides.forEach((item,index)=>{
  const fits=(value:string,width:number,size:number,spacing:number,height:number)=>knowledgePresentationLines(value,width).length*size/72*spacing+0.04<=height;
  const opening=index===0&&item.type==='points'&&item.points.length<=3;
  let ok=fits(item.title,opening?22:27,opening?40:31,1.03,opening?1.5:1.04);
  const listFits=(points:string[],capacity:number,size:number,start:number)=>start+points.reduce((sum,text)=>sum+knowledgePresentationLines(text,capacity).length*size/72*1.1+0.04+0.12,0)-0.12<=6.82;
  if(item.type==='table'){
   const width=11.4/item.columns.length,capacity=Math.max(7,Math.floor(width*72/17.5)-1);
   const height=[item.columns,...item.rows].reduce((sum,row)=>sum+Math.max(...row.map(c=>knowledgePresentationLines(c,capacity).length))*0.27+0.18,0);
   ok=ok&&height<=4.35;
  }else if(item.type==='image')ok=ok&&listFits(item.points,16,20,2.4);
  else if(opening)ok=ok&&listFits(item.points,33,22,3.25);
  else if(item.points.length===1)ok=ok&&fits(item.points[0],27,30,1.2,2.7);
  else if(item.points.length<=3){
   const count=item.points.length,w=(11.4-0.55*(count-1))/count,capacity=Math.floor((w-0.16)*72/22)-1;
   ok=ok&&item.points.every(t=>fits(t,capacity,22,1.18,3.1));
  }else if(item.points.length===4)ok=ok&&item.points.every(t=>fits(t,17,20,1.14,1.64));
  else ok=ok&&listFits(item.points,35,22,2.4);
  if(!ok)issues.push(`第 ${index+1} 页「${item.title}」单页内容超出可读版面，请修订标题、要点或表格文字后再确认。`);
 });
 return issues;
}
export function assertKnowledgePresentationCapacity(plan:KnowledgePresentationPlan){
 const issues=knowledgePresentationCapacityIssues(plan);
 if(issues.length)throw Error(issues.join('\n'));
}
/** 修订只允许改变页面文字，原请求、来源、页数及素材关系必须保持。 */
export function validateKnowledgePresentationRevision(value:unknown,original:KnowledgePresentationPlan){
 const revision=knowledgePresentationPlanSchema.parse(value);
 const structure=(plan:KnowledgePresentationPlan)=>({...plan,slides:plan.slides.map(s=>s.type==='table'?{...s,title:'',columns:s.columns.map(()=>''),rows:s.rows.map(r=>r.map(()=>''))}:{...s,title:'',points:s.points.map(()=>'')})});
 if(JSON.stringify(structure(revision))!==JSON.stringify(structure(original)))throw Error('提纲修订只能修改页面文字，不能改变请求、页数、章节或配图');
 assertKnowledgePresentationCapacity(revision);
 return revision;
}
