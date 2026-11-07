import {knowledgeConversationAnswerSchema} from './knowledgeConversation';
import {planKnowledgeCardPages} from './knowledgeCardPagination';

export const KNOWLEDGE_SUPPLEMENT_REFINEMENT_QUESTION='保留原精华版的全部图片和文字，再从次要知识中提炼5–8页补充图解。';
export const KNOWLEDGE_SUPPLEMENT_REFINEMENT_INSTRUCTIONS=`你是知识手册编辑。保留原册全部内容与图片，只规划额外5–8页值得图解的补充，不重做原精华图，不把整册压成5–8页。只用已整理的正文与已有核实资料，不启动联网或增加外部事实。
只输出Markdown：# 补充图解；每个## 小节是一个补充主题，其下一行“来源：章节UUID”，UUID取source.pages已有id，多个用逗号。其余为具体图中文字、条件、对照关系及“图：”说明。每个主题约800–1100字，约6–8个主题，总体约5400–8000字；以有用信息为准，不为凑数灌水。不输出JSON或聊天过程。来源行只供程序绑定，不进入图片。原册已画清的核心内容不重复，新图聚焦次要内容的比较、流程或搭配关系。知识不足以支持5页时明确失败，不编造。`;
export function knowledgeSupplementRefinementFromMarkdown(content:string,requestId:string,pageIds:string[]){
 const allowed=new Set(pageIds);
 const sections=content.trim().split(/(?=^##\s+)/m).filter(s=>/^##\s+/.test(s));
 const supplementalImages=sections.map(section=>{
  const lines=section.split('\n'),title=lines.shift()!.replace(/^##\s+/,'').trim();
  const sourceIndex=lines.findIndex(l=>/^来源[：:]/.test(l.trim()));
  if(sourceIndex<0)throw Error('补充图解缺少原章节来源，未采用');
  const ids=Array.from(new Set(lines[sourceIndex].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)||[]));
  if(!ids.length||ids.some(id=>!allowed.has(id)))throw Error('补充图解引用了未知章节，未采用');
  lines.splice(sourceIndex,1);
  return {title,sourcePageIds:ids,reason:'从原册次要知识中提炼，作为原精华图的补充。',content:lines.join('\n').trim()};
 });
 const answer=knowledgeConversationAnswerSchema.parse({kind:'knowledge_conversation_v1',requestId,answer:'原精华图全部保留，以下仅为新增补充内容，尚未生成图片。',sources:[],supplementalImages});
 const markdown='# 补充图解\n\n'+answer.supplementalImages.map(p=>`## ${p.title}\n\n${p.content}`).join('\n\n');
 const plan=planKnowledgeCardPages(markdown);
 if(plan.pageCount<5||plan.pageCount>8)throw Error(`补充内容实际为${plan.pageCount}页，未达到5–8页范围；回包保留，未截断或自动重试`);
 return answer;
}
