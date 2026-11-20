import {memo} from 'react';
import {knowledgeEditionReadingSummary} from '@/lib/knowledgeCardPreflightCounts';
/**
 * 生图前预检：每张图是一个主题的核心图解（图内≤1200字），完整版≤48张、图文同页、页数=图数（内文超图下容量时提示压缩），
 * 精华版≤30张（图≤30张即精华版、>30为完整版）、图:内文1:2–1:3，图外细节进内文续页。这里给出计划页数与提示，不阻断生成。
 * 1120 L8：摘要按正文缓存（同一份稿只算一次），组件 memo，出图过程中父级频繁重渲染时不重算。
 */
export const KnowledgeEditionReadingCount = memo(function KnowledgeEditionReadingCount({markdown}:{markdown:string|null}){
 const plan=knowledgeEditionReadingSummary(markdown);
 if(!plan)return <span aria-live="polite">文字说明 正在核算…</span>;
 const {budget}=plan;
 return <span aria-live="polite">
  图文同页 {budget.imagePages} 页{budget.level==='concise'?<> · 内文约 {plan.plannedTextPages} 页（建议 {budget.textPages.min}–{budget.textPages.max} 页）</>:' · 不排独立内文页'} · 合计约 {plan.plannedTotalPages} 页
  {plan.warnings.map(w=><span key={w} className="block text-amber-700">{w}</span>)}
  {plan.titleWarning&&<span className="block text-amber-700">{plan.titleWarning}</span>}
 </span>;
});
