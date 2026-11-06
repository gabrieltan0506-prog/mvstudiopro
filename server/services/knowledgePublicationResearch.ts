import { knowledgeCitationSchema, knowledgeResearchResultSchema, knowledgeResearchFindingSchema } from '../../shared/knowledgeResearch';
import type { KnowledgeReview } from '../../shared/knowledgePublication';
export type KnowledgeWebSource={url:string;title:string;content:string;pageIds?:string[]};
/** 只接受供应商真实检索注释，不把模型正文中自报的链接当检索证据。 */
export function knowledgeWebSources(envelope:any,warnings:string[]=[]):KnowledgeWebSource[]{
 const sources:KnowledgeWebSource[]=[];
 const annotations = [...(Array.isArray(envelope.choices?.[0]?.message?.annotations) ? envelope.choices[0].message.annotations : []),
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
  if(content.length>30000){warnings.push('已跳过一条超长来源，其他有效资料保留');continue;}
  if(!sources.some(s=>s.url===result.data.url)){if(sources.length<12)sources.push({...result.data,content});else warnings.push('已跳过超出本批12条容量的来源，已核对资料保留');}
 }
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

/** 只去掉明确促销句，保留同段其他知识句；原始供应商回执不改写。 */
export function cleanKnowledgeResearchSummary(text: string) {
 const pieces=text.match(/[^。！？!?，,；;\n]+[。！？!?，,；;\n]?/g)||[];
 return pieces.filter(piece=>!/(?:点击购买|立即购买|扫码(?:购买|下单|咨询)|优惠券|限时(?:优惠|促销|折扣)|下单立减|加入购物车|购买链接|包邮|进店(?:选购|购买)|联系客服|售价[：:]?\s*[¥￥$]?\d|定价[：:]?\s*[¥￥$]?\d)/.test(piece)).join('').trim().replace(/[，,；;]+$/,'。');
}
/** 逐条校验并保留可用资料，个别异常不导致整批重购或全部拒收。 */
export function validateKnowledgeResearchResult(value: unknown, expected: {id:string;headline:string;body?:string}[], sources: KnowledgeWebSource[]) {
 const warnings:string[]=[];
 const raw=value as {kind?:unknown;pages?:unknown};
 const pages=expected.map(p=>({pageId:p.id,topic:p.headline,queries:[] as string[],findings:[] as {url:string;summary:string;relevance:string;purpose?:'verify_fact'|'resolve_conflict'|'fill_explanation';sourceQuote?:string;question?:string}[]}));
 const selected=new Map<string,KnowledgeWebSource>();
 if(!raw || !Array.isArray(raw.pages))return {sources:[],pages,validation:{status:'excluded' as const,warnings:['无法识别逐页搜索数据，保留原文整理']}};
 if(raw.kind!=='knowledge_research_v1')warnings.push('搜索版本字段异常，按原页逐条核对可用内容');
 const seen=new Set<string>();
 for(const item of raw.pages){
  if(!item || typeof item!=='object'){warnings.push('已跳过无法识别的搜索页');continue;}
  const page=pages.find(p=>p.pageId===item.pageId);
  if(!page){warnings.push('已跳过未知页号，其他页继续采用');continue;}
  if(item.topic!==page.topic){warnings.push('已跳过主题与原页不符的资料，其他页继续采用');continue;}
  if(seen.has(page.pageId))warnings.push('重复页资料按来源合并，不丢弃其他页');
  seen.add(page.pageId);
  if(Array.isArray(item.queries))for(const query of item.queries){
   if(typeof query==='string'&&query.trim()&&query.length<=500&&!page.queries.includes(query)&&page.queries.length<6)page.queries.push(query);
  }
  if(!Array.isArray(item.findings)){warnings.push('该页资料列表格式异常，其他页继续采用');continue;}
  for(const rawFinding of item.findings){
   const finding=knowledgeResearchFindingSchema.safeParse(rawFinding&&typeof rawFinding==='object'?{url:rawFinding.url,summary:rawFinding.summary,relevance:rawFinding.relevance,purpose:rawFinding.purpose,sourceQuote:rawFinding.sourceQuote,question:rawFinding.question}:null);
   if(!finding.success){warnings.push('已跳过字段不完整的一条资料');continue;}
   const original=expected.find(p=>p.id===page.pageId);
   if(original?.body!==undefined && (!finding.data.purpose || !finding.data.question || !finding.data.sourceQuote || !original.body.includes(finding.data.sourceQuote))){warnings.push('已跳过没有有效触发理由或原文锚点的一条补充');continue;}
   const source=sources.find(s=>s.url===finding.data.url&&s.content.trim());
   if(!source){warnings.push('已跳过工具回执中不存在的来源：'+finding.data.url);continue;}
   const summary=cleanKnowledgeResearchSummary(finding.data.summary);
   if(!summary){warnings.push('已去除只含营销内容的一条资料');continue;}
   if(summary!==finding.data.summary)warnings.push('已移除资料中的营销语句，保留知识内容');
   if(page.findings.some(f=>f.url===source.url&&f.summary===summary))continue;
   if(page.findings.length>=12){warnings.push('该页超过12条资料，仅保留已核对条目');continue;}
   page.findings.push({...finding.data,summary});
   const prior=selected.get(source.url);
   // 正文只消费去营销后的知识摘要；完整原始片段仍在供应商永久回执中。
   selected.set(source.url,{...source,content:prior?[prior.content,summary].filter((v,i,a)=>a.indexOf(v)===i).join('\n'):summary,pageIds:Array.from(new Set([...(prior?.pageIds||[]),page.pageId]))});
  }
 }
 for(const page of pages)if(!seen.has(page.pageId))warnings.push('该页没有可对应的检索资料，保留原文：'+page.pageId);
 // 下游只接收合法结构；局部过滤后再次校验，不把原始混杂数据直接传给正文。
 knowledgeResearchResultSchema.parse({kind:'knowledge_research_v1',pages});
 return {sources:Array.from(selected.values()),pages,validation:{status:warnings.length?'partial' as const:'validated' as const,warnings}};
}
