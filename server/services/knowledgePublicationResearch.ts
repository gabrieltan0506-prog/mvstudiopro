import { knowledgeCitationSchema, knowledgeResearchResultSchema } from '../../shared/knowledgeResearch';
import type { KnowledgeReview } from '../../shared/knowledgePublication';
export type KnowledgeWebSource={url:string;title:string;content:string;pageIds?:string[]};
/** 只接受供应商真实检索注释，不把模型正文中自报的链接当检索证据。 */
export function knowledgeWebSources(envelope:any):KnowledgeWebSource[]{
 const sources:KnowledgeWebSource[]=[];
 const annotations = [...(envelope.choices?.[0]?.message?.annotations || []),
  ...(Array.isArray(envelope.web_search) ? envelope.web_search.map((source:any)=>({
   type:'url_citation',url_citation:{url:source.link,title:source.title,content:source.content},
  })) : []),
 ];
 for(const item of annotations){
  if(item?.type!=='url_citation')continue;
  const citation=item.url_citation;
  const result=knowledgeCitationSchema.safeParse({url:citation?.url,title:citation?.title});
  if(!result.success)continue;
  const content=typeof citation.content==='string'?citation.content:'';
  if(content.length>30000)throw new Error('检索来源超过单条容量，未截断采用');
  if(!sources.some(s=>s.url===result.data.url))sources.push({...result.data,content});
 }
 if(sources.length>12)throw new Error('检索来源超过本批容量');
 return sources;
}
/** 来源只用于保留可核对引用；缺少或不匹配不再拒收已有正文。 */
export function validateKnowledgeResearch(review:KnowledgeReview,sources:KnowledgeWebSource[]){
 for(const page of review.pages){
  page.sources=(page.sources||[]).flatMap(citation=>{
   const actual=sources.find(s=>s.url===citation.url);
   if(!actual || (actual.pageIds && !actual.pageIds.includes(page.id)) || !page.body.includes(']('+citation.url+')'))return [];
   return [{url:actual.url,title:actual.title}];
  });
 }
}

/** 校验失败只排除联网补充，不拒收原稿、不触发额外搜索购买。 */
export function validateKnowledgeResearchResult(value: unknown, expected: {id:string;headline:string}[], sources: KnowledgeWebSource[]) {
 const parsed=knowledgeResearchResultSchema.safeParse(value);
 const invalid=(warning:string)=>({sources:[] as KnowledgeWebSource[],pages:[],validation:{status:'excluded' as const,warnings:[warning]}});
 if(!parsed.success)return invalid('搜索输出不符合逐页schema，已排除联网补充');
 const pages=parsed.data.pages;
 if(pages.length!==expected.length || new Set(pages.map(p=>p.pageId)).size!==expected.length ||
   pages.some(p=>!expected.some(e=>e.id===p.pageId&&e.headline===p.topic)))
   return invalid('搜索页号、主题或页数与本批原稿不符，已排除联网补充');
 const selected=new Map<string,KnowledgeWebSource>(),warnings:string[]=[];
 const acceptedPages=pages.map(page=>({...page,findings:page.findings.filter(finding=>{
   const source=sources.find(s=>s.url===finding.url&&s.content.trim());
   if(!source){warnings.push('已排除不在真实工具回执中的来源：'+finding.url);return false;}
   const prior=selected.get(source.url);selected.set(source.url,{...source,pageIds:Array.from(new Set([...(prior?.pageIds||[]),page.pageId]))});return true;
 })}));
 return {sources:Array.from(selected.values()),pages:acceptedPages,validation:{status:'validated' as const,warnings}};
}
