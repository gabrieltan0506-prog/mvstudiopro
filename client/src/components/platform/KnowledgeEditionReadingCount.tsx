import {useMemo} from 'react';
import {knowledgeEditionParts} from '@shared/knowledgeCardEdition';
import {knowledgeEditionImageChars,knowledgeEditionImagePlan} from '@shared/knowledgeCardPagination';
import {knowledgeEditionBudgetCheck} from '@shared/knowledgeEditionBudget';
import {auditKnowledgeTopicTitles,knowledgeTopicTitleWarning,readKnowledgeTopicTitles} from '@shared/knowledgeTopicImagePlan';
/**
 * 生图前预检：每张图是一个主题的核心图解（图内≤1200字），完整版≤48张、图文同页、页数=图数（内文超图下容量时提示压缩），
 * 精华版≤30张（图≤30张即精华版、>30为完整版）、图:内文1:2–1:3，图外细节进内文续页。这里给出计划页数与提示，不阻断生成。
 */
export function KnowledgeEditionReadingCount({markdown}:{markdown:string|null}){
 const plan=useMemo(()=>{
  const parts=markdown?knowledgeEditionParts(markdown):null;
  if(!parts||!markdown)return null;
  let topics;
  try{topics=knowledgeEditionImagePlan(markdown);}catch{return null;}
  if(!topics)return null;
  // 图数按主题定（每图≤1200字的核心图解）；图外细节与独立文字一起计入内文。
  const check=knowledgeEditionBudgetCheck(parts.level,topics.images.length,topics.readingChars,knowledgeEditionImageChars(topics));
  // 命题核查：图片标题/内文标题/小节小标题须为模型命题；缺项会以机械标题（“等N节”）或原小节标题出图，确认前提示。
  const titleWarning=knowledgeTopicTitleWarning(auditKnowledgeTopicTitles(topics.images,readKnowledgeTopicTitles(markdown)));
  return {...check,titleWarning};
 },[markdown]);
 if(!plan)return <span aria-live="polite">文字说明 正在核算…</span>;
 const {budget}=plan;
 return <span aria-live="polite">
  图文同页 {budget.imagePages} 页{budget.level==='concise'?<> · 内文约 {plan.plannedTextPages} 页（建议 {budget.textPages.min}–{budget.textPages.max} 页）</>:' · 不排独立内文页'} · 合计约 {plan.plannedTotalPages} 页
  {plan.warnings.map(w=><span key={w} className="block text-amber-700">{w}</span>)}
  {plan.titleWarning&&<span className="block text-amber-700">{plan.titleWarning}</span>}
 </span>;
}
