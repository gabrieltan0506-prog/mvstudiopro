import {memo} from "react";
import {KnowledgeEditionReadingCount} from "./KnowledgeEditionReadingCount";
import { knowledgeEditionChoiceCount, type KnowledgeEditionChoiceCount } from "@/lib/knowledgeCardPreflightCounts";
import type { KnowledgeCardDetailLevel } from "@shared/knowledgeCardDistillSections";

/** 张数文案：没有两档标记的原稿（两档尚未整理好）不给张数，避免把旧分页数当成完整版张数。 */
export function knowledgeEditionChoiceCountLabel(count: KnowledgeEditionChoiceCount): string {
  if (count.pending === "selecting") return "正在选择重点…";
  if (count.pending === "awaiting_edition") return "两档整理完成后给出张数";
  return "pageCount" in count ? `${count.pageCount} 张图片` : "两档整理完成后给出张数";
}

/**
 * 比较同一底稿的两份实际配图计划，不把配图张数当成最终文字页数。
 * 1120 L8：张数按正文缓存（优先服务端已算好的 editionPageCounts），本组件只展示；memo 后出图期间不重算。
 */
function KnowledgeCardEditionChoice({ full, concise, model, selected, disabled, onSelect, onSupplement, supplementReady }: {
  full: string; concise: string | null; model: string; selected: KnowledgeCardDetailLevel;
  onSupplement?:()=>void; supplementReady?:boolean;
  disabled: boolean; onSelect: (level: KnowledgeCardDetailLevel) => void;
}) {
  const options = [
    { level: "concise" as const, label: "精华版", text: concise, explanation: "主要重点成图 · 次要知识用白话说明和表格呈现" },
    { level: "full" as const, label: "完整版", text: full, explanation: "主要与次要重点都浓缩成图 · 文字更精练" },
  ];
  return <fieldset className="w-full rounded-xl border border-white/15 p-3" aria-label="比较两档配图">
    <legend className="px-1 text-sm font-semibold">知识先提炼，再选择图文比例</legend>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map(option => {
        const count = knowledgeEditionChoiceCount(option.text, model);
        const ready = count.pending === null;
        return <div key={option.level}><button type="button" aria-pressed={selected === option.level}
          disabled={disabled || !option.text} onClick={() => onSelect(option.level)}
          className={`w-full rounded-lg border px-3 py-3 text-left disabled:opacity-60 ${selected === option.level ? "border-[#ff4fb8] bg-[#ff4fb8]/10" : "border-white/15 bg-black/20"}`}>
          <span className="block font-semibold">{option.label} · {knowledgeEditionChoiceCountLabel(count)}</span>
          <span className="mt-1 block text-xs">{ready ? `配图 ${count.credits} 积分 · ` : ""}{option.explanation}</span>
        </button><p className="mt-1 text-xs"><KnowledgeEditionReadingCount markdown={option.text}/></p>{option.level==='concise'&&ready&&onSupplement&&<div className="mt-2 space-y-1">
          <button type="button" disabled={disabled||!supplementReady} onClick={onSupplement} className="w-full rounded-lg border border-cyan-300/40 px-3 py-2 text-sm disabled:opacity-50">保留原图，再提炼 5–8 页补充</button>
          <p className="text-xs text-muted-foreground">{supplementReady?'先查看补充内容和实际报价，再确认出图。':'原精华图片与整理完成后可补充，原图不会重做。'}</p>
        </div>}</div>;
      })}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">两版保留同一组有用知识，原始底稿另存。图片与文字说明分别计数；文字为当前稿件的预排版页数，正式 PDF 按最终版式实际页数结算，整理不另收费。</p>
  </fieldset>;
}
export default memo(KnowledgeCardEditionChoice);
