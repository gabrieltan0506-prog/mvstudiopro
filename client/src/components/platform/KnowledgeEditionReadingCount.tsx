import {useMemo} from 'react';
import {knowledgeEditionParts} from '@shared/knowledgeCardEdition';
import {knowledgeEditionImageChars,knowledgeEditionImagePlan} from '@shared/knowledgeCardPagination';
import {knowledgeEditionBudgetCheck} from '@shared/knowledgeEditionBudget';
/**
 * 生图前预检：每张图是一个主题的核心图解（图内≤1200字），完整版≤16张、图文同页、页数=图数（内文超图下容量时提示压缩），
 * 精华版≤8张、图:内文1:2–1:3，图外细节进内文续页。这里给出计划页数与提示，不阻断生成。
 */
export function KnowledgeEditionReadingCount({markdown}:{markdown:string|null}){
 const plan=useMemo(()=>{
  const parts=markdown?knowledgeEditionParts(markdown):null;
  if(!parts||!markdown)return null;
  let topics;
  try{topics=knowledgeEditionImagePlan(markdown);}catch{return null;}
  if(!topics)return null;
  // 图数按主题定（每图≤1200字的核心图解）；图外细节与独立文字一起计入内文。
  return knowledgeEditionBudgetCheck(parts.level,topics.images.length,topics.readingChars,knowledgeEditionImageChars(topics));
 },[markdown]);
 if(!plan)return <span aria-live="polite">文字说明 正在核算…</span>;
 const {budget}=plan;
 return <span aria-live="polite">
  图文同页 {budget.imagePages} 页{budget.level==='concise'?<> · 内文约 {plan.plannedTextPages} 页（建议 {budget.textPages.min}–{budget.textPages.max} 页）</>:' · 不排独立内文页'} · 合计约 {plan.plannedTotalPages} 页
  {plan.warnings.map(w=><span key={w} className="block text-amber-700">{w}</span>)}
 </span>;
}
