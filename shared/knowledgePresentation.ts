import {z} from 'zod';
const short=(max:number)=>z.string().trim().min(1).max(max);
export const knowledgePresentationRangeSchema=z.object({minSlides:z.number().int().min(1).max(200),maxSlides:z.number().int().min(1).max(200)}).strict().refine(v=>v.minSlides<=v.maxSlides,'最少页数不能大于最多页数');
export const knowledgePresentationRequestSchema=z.object({id:z.string().uuid(),minSlides:z.number().int().min(1).max(200),maxSlides:z.number().int().min(1).max(200),manuscript:short(1000000)}).strict().refine(v=>v.minSlides<=v.maxSlides,'页数范围无效');
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
