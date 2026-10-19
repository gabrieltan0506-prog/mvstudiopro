import { useId, useState } from "react";
import { selectMarketingMethods } from "@shared/marketingSkills";
import { appendOfferContext, calculateOfferEconomics, formatOfferEconomics, OFFER_BRIEF_TEMPLATE, PARENT_CHILD_OFFER_EXAMPLE, type OfferEconomicsInput } from "@shared/marketingOffer";

export function MarketingOfferPanel({ context, onChange }: { context: string; onChange: (value: string) => void }) {
  const id = useId();
  const [input, setInput] = useState<OfferEconomicsInput>({ price: "", variableCost: "", acquisitionCost: "", targetMargin: "" });
  const [message, setMessage] = useState("");
  const result = calculateOfferEconomics(input);
  const methods = selectMarketingMethods(context);
  const append = (text: string) => {
    const next = appendOfferContext(context, text);
    if (!next.error) onChange(next.value);
    setMessage(next.error || "已加入上方需求，可编辑后按原流程生成选题与文案。");
  };
  const fields: Array<{ key: keyof OfferEconomicsInput; label: string }> = [
    { key: "price", label: "候选售价" }, { key: "variableCost", label: "每单变动成本" },
    { key: "acquisitionCost", label: "每单获客费用" }, { key: "targetMargin", label: "目标贡献率（%）" },
  ];
  return <details className="rounded-xl border border-white/10 p-4 text-sm text-slate-300">
    <summary className="cursor-pointer font-medium text-white">要销售产品或服务？整理商品与价格依据</summary>
    <p className="mt-3 text-xs text-cyan-200" role="status">{methods.length ? `当前需求将应用：${methods.map(method => method.name).join("、")}` : "当前未启用商业方法：普通内容照常创作。"}</p>
    <p className="mt-3 leading-6">在上方需求里写清卖什么、谁会买、交付内容和已有证据。生成时会结合这些信息设计引流品、利润品与高价产品候选。</p>
    <div className="mt-3 flex flex-wrap gap-3">
      <button type="button" className="creation-text-action" onClick={() => append(OFFER_BRIEF_TEMPLATE)}>加入产品背景提纲</button>
      <button type="button" className="creation-text-action" onClick={() => append(PARENT_CHILD_OFFER_EXAMPLE)}>参考：亲子绘本与动画</button>
      {methods.length > 0 && <button type="button" className="creation-text-action" onClick={() => append("本轮不要营销，仅按原内容要求创作。")}>本轮不用营销方法</button>}
    </div>
    <details className="mt-4 border-t border-white/10 pt-3">
      <summary className="cursor-pointer">可选：算一算单笔价格</summary>
      <p className="mt-2 text-xs leading-5 text-slate-400">金额使用同一币种、同一单笔口径。未知留空，确认没有才填0。变动成本请纳入制作、履约、平台费等；固定开支与税费另核。</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(field => <label key={field.key} htmlFor={`${id}-${field.key}`} className="text-xs">
          {field.label}
          <input id={`${id}-${field.key}`} inputMode="decimal" value={input[field.key]} onChange={event => setInput(previous => ({ ...previous, [field.key]: event.target.value }))}
            placeholder="未知留空" className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2 text-sm text-white" />
        </label>)}
      </div>
      <div className="mt-3 text-sm leading-6" aria-live="polite">
        <p>单笔贡献：{result.contribution === null ? "待补有效售价及两项成本" : result.contribution.toFixed(2)}{result.contributionRate === null ? "" : `（贡献率 ${result.contributionRate.toFixed(2)}%）`}</p>
        <p>目标贡献率对应售价下限：{result.targetPrice === null ? "待补成本及0至小于100的目标百分数" : result.targetPrice.toFixed(2)}</p>
        <p className="text-xs text-slate-400">贡献不是净利润；测算不能证明客户愿意购买。试算值加入需求后才会随原草稿保存，返回后可在需求中继续编辑。</p>
      </div>
      <button type="button" className="creation-text-action mt-3" onClick={() => append(formatOfferEconomics(input))}>把本次测算加入需求</button>
    </details>
    {message && <p role="status" className="mt-3 text-xs text-cyan-200">{message}</p>}
  </details>;
}
