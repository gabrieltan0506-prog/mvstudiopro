import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import { TEMPLATE_CRAFT_DIMENSIONS } from "@shared/manhuaTemplateCraft";
import {
  templateGuidance,
  suggestedTemplateRole,
} from "@shared/manhuaTemplateGuidance";
export function TemplateRoleGuide({
  card,
  disabled,
  onApply,
}: {
  card?: PublicManhuaViralTemplateCard;
  disabled: boolean;
  onApply: (role: string) => void;
}) {
  const methods = templateGuidance(card?.craft);
  if (!card)
    return (
      <p className="mt-3 text-sm">
        模板资料尚未读取，可刷新模板库；已有分工保留。
      </p>
    );
  return (
    <section
      aria-label={`模板方法与分工 ${card.publicId}`}
      className="mt-3 space-y-3 text-sm"
    >
      <p>
        <strong>特色：</strong>
        {card.featureZh}
      </p>
      <p className="text-slate-300">{card.introZh}</p>
      {methods.length ? (
        <>
          <p className="text-xs text-slate-400">
            下面列出已归纳的手法与借用建议。按本场需要选择分工，不必每场全部使用。
          </p>
          {TEMPLATE_CRAFT_DIMENSIONS.map(([dimension, label]) => {
            const items = methods.filter(m => m.dimension === dimension);
            return items.length ? (
              <div key={dimension}>
                <h4 className="font-medium text-amber-200">{label}</h4>
                {items.map(m => (
                  <div key={m.id} className="mt-2 rounded-lg bg-white/5 p-2">
                    <p className="font-medium">{m.label}</p>
                    <p className="mt-1 text-slate-300">{m.usage}</p>
                    <button
                      type="button"
                      disabled={disabled}
                      className="mt-1 underline disabled:opacity-40"
                      onClick={() => onApply(`负责${m.label}：${m.usage}`)}
                    >
                      用「{m.label}」作分工
                    </button>
                  </div>
                ))}
              </div>
            ) : null;
          })}
          <button
            type="button"
            disabled={disabled}
            className="rounded-lg border border-amber-200/40 px-3 py-2 disabled:opacity-40"
            onClick={() => onApply(suggestedTemplateRole(card.craft))}
          >
            带入前三项建议分工
          </button>
        </>
      ) : (
        <p>
          这份模板还没有可用的手法说明，暂不自动填写分工。可先与创作顾问讨论适用方式。
        </p>
      )}
      <p className="text-xs text-slate-400">
        带入后可自行修改；不会自动生成或改变正在处理的请求。
      </p>
    </section>
  );
}
