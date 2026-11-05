import { knowledgeCitationSchema } from '../../shared/knowledgeResearch';
import type { KnowledgeReview } from '../../shared/knowledgePublication';
export type KnowledgeWebSource={url:string;title:string;content:string};
/** 只接受供应商真实检索注释，不把模型正文中自报的链接当检索证据。 */
export function knowledgeWebSources(envelope:any):KnowledgeWebSource[]{
 const sources:KnowledgeWebSource[]=[];
 for(const item of envelope.choices?.[0]?.message?.annotations || []){
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
export function validateKnowledgeResearch(review:KnowledgeReview,sources:KnowledgeWebSource[]){
 if(!sources.length)throw new Error('未取得真实联网来源，不能采用联网补充');
 for(const page of review.pages){
  if(!page.sources?.length)throw new Error('本页补充缺少来源');
  for(const citation of page.sources){
   const actual=sources.find(s=>s.url===citation.url);
   if(!actual)throw new Error('补充引用不属于本次检索来源');
   if(!page.body.includes(']('+citation.url+')'))throw new Error('来源未融入本页正文');
   // 名称使用真实检索回执，避免模型擅自把博客包装成权威机构。
   citation.title=actual.title;
  }
 }
}
