import {useMemo} from 'react';
import {knowledgeEditionParts} from '@shared/knowledgeCardEdition';
import {planKnowledgeCardPages} from '@shared/knowledgeCardPagination';
import {knowledgeEditionBudgetCheck} from '@shared/knowledgeEditionBudget';
/**
 * 生图前按图文比例预检：完整版图:内文≈3:1–2:1，精华版1:2–1:3。
 * 每张图与要点同页，内文页只放图外补充；这里给出计划页数与提示，不阻断生成（略超无妨）。
 */
export function KnowledgeEditionReadingCount({markdown}:{markdown:string|null}){
 const plan=useMemo(()=>{
  const parts=markdown?knowledgeEditionParts(markdown):null;
  if(!parts||!markdown)return null;
  let imagePages=0;
  try{imagePages=planKnowledgeCardPages(markdown).pageCount;}catch{return null;}
  const textChars=parts.modules.filter(m=>m.medium==='text').reduce((sum,m)=>sum+m.body.replace(/\s+/g,'').length,0);
  return knowledgeEditionBudgetCheck(parts.level,imagePages,textChars);
 },[markdown]);
 if(!plan)return <span aria-live="polite">文字说明 正在核算…</span>;
 const {budget}=plan;
 return <span aria-live="polite">
  图文同页 {budget.imagePages} 页 · 内文约 {plan.plannedTextPages} 页（建议 {budget.textPages.min}–{budget.textPages.max} 页）· 合计约 {plan.plannedTotalPages} 页
  {plan.warnings.map(w=><span key={w} className="block text-amber-700">{w}</span>)}
 </span>;
}
