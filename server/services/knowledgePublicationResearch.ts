import { knowledgeCitationSchema } from '../../shared/knowledgeResearch';
import type { KnowledgeReview } from '../../shared/knowledgePublication';
export type KnowledgeWebSource={url:string;title:string;content:string};
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
   if(!actual || !page.body.includes(']('+citation.url+')'))return [];
   return [{url:actual.url,title:actual.title}];
  });
 }
}
