import { planKnowledgeCardPages } from "@shared/knowledgeCardPagination";
import type { KnowledgeCardDetailLevel } from "@shared/knowledgeCardDistillSections";

/** 比较同一底稿的两份实际配图计划，不把配图张数当成最终文字页数。 */
export default function KnowledgeCardEditionChoice({ full, concise, model, selected, disabled, onSelect }: {
  full: string; concise: string | null; model: string; selected: KnowledgeCardDetailLevel;
  disabled: boolean; onSelect: (level: KnowledgeCardDetailLevel) => void;
}) {
  const options = [
    { level: "concise" as const, label: "精华版", text: concise, explanation: "重点配图 · 更多文字说明" },
    { level: "full" as const, label: "完整版", text: full, explanation: "更多配图 · 减少重复文字" },
  ];
  return <fieldset className="w-full rounded-xl border border-white/15 p-3" aria-label="比较两档配图">
    <legend className="px-1 text-sm font-semibold">同一完整底稿，选择图文比例</legend>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map(option => {
        const plan = option.text ? planKnowledgeCardPages(option.text, model) : null;
        return <button key={option.level} type="button" aria-pressed={selected === option.level}
          disabled={disabled || !plan} onClick={() => onSelect(option.level)}
          className={`rounded-lg border px-3 py-3 text-left disabled:opacity-60 ${selected === option.level ? "border-[#ff4fb8] bg-[#ff4fb8]/10" : "border-white/15 bg-black/20"}`}>
          <span className="block font-semibold">{option.label} · {plan ? `${plan.pageCount} 张图片` : "正在选择重点…"}</span>
          <span className="mt-1 block text-xs">{plan ? `配图 ${plan.credits} 积分 · ` : ""}{option.explanation}</span>
        </button>;
      })}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">切档不会改写完整底稿。这里是图片张数，文字页不计入；顾问不另收费，纯内文按最终 PDF 实际页数结算。</p>
  </fieldset>;
}
