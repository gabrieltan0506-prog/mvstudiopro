import React, { useMemo, useState } from "react";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import { TEMPLATE_CRAFT_DIMENSIONS } from "@shared/manhuaTemplateCraft";

export function templateChoiceLabel(
  card: PublicManhuaViralTemplateCard
): string {
  const code = card.publicId.replace(/^mt_/i, "").toUpperCase();
  const craft = card.craft?.features
    .slice(0, 2)
    .map(f => f.label)
    .join(" / ");
  return `${card.methodBrief?.title || craft || "创作方法待核对"} · ${code}`;
}

/** IDs remain distinct. Old story-type argument is retained for existing callers. */
export function filterTemplateChoices(
  cards: readonly PublicManhuaViralTemplateCard[],
  query: string,
  storyType: string,
  options: { dimension?: string; feature?: string } = {}
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return Array.from(
    new Map(cards.map(card => [card.publicId, card])).values()
  ).filter(card => {
    if (storyType && (card.storyPreview?.storyTypeZh || "待整理") !== storyType)
      return false;
    if (
      options.dimension &&
      !card.craft?.features.some(f => f.dimension === options.dimension)
    )
      return false;
    if (
      options.feature &&
      !card.craft?.features.some(f => f.id === options.feature)
    )
      return false;
    const text = [
      templateChoiceLabel(card),
      card.nameZh,
      card.methodBrief?.title,
      ...(card.methodBrief?.highlights || []),
      card.methodBrief?.useWhen,
      card.featureZh,
      card.introZh,
      ...(card.classificationTagsZh || []),
      card.storyPreview?.premiseZh,
      ...(card.craft?.features.map(f => f.label) || []),
    ]
      .join(" ")
      .toLowerCase();
    return words.every(word => text.includes(word));
  });
}
export function CraftDetails({
  card,
}: {
  card: PublicManhuaViralTemplateCard;
}) {
  return card.methodBrief ? (
    <div className="space-y-2 text-sm leading-6">
      {card.methodBrief.highlights.map(h => (
        <p key={h}>{h}</p>
      ))}
      <p className="text-amber-200">{card.methodBrief.useWhen}</p>
      <p className="text-xs text-slate-400">
        借用方式需结合当前场面；不是指定故事情节，也不要求每场全部使用。
      </p>
    </div>
  ) : (
    <p className="text-sm">
      这份模板的具体呈现方法需要核对，暂不自动建议分工。已有学习资料保留，可与创作顾问讨论。
    </p>
  );
}
export default function ManhuaTemplatePicker(props: {
  layout?: "workbench";
  chosenIds?: string[];
  cards: PublicManhuaViralTemplateCard[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
  onWrite?: () => void;
  onAskAdvisor?: (card: PublicManhuaViralTemplateCard) => void;
}) {
  const [query, setQuery] = useState(""),
    [dimension, setDimension] = useState(""),
    [feature, setFeature] = useState("");
  const [page, setPage] = useState(0),
    [compareIds, setCompareIds] = useState<string[]>([]);
  const selected = props.cards.find(card => card.publicId === props.value);
  const choices = useMemo(
    () =>
      filterTemplateChoices(props.cards, query, "", {
        dimension,
        feature,
      }),
    [props.cards, query, dimension, feature]
  );
  const features = Array.from(
    new Map(
      props.cards
        .flatMap(c => c.craft?.features || [])
        .filter(f => !dimension || f.dimension === dimension)
        .map(f => [f.id, f])
    ).values()
  );
  const compared = props.cards.filter(c => compareIds.includes(c.publicId));
  const pages = Math.max(1, Math.ceil(choices.length / 6)),
    currentPage = Math.min(page, pages - 1);
  const visible = choices.slice(currentPage * 6, (currentPage + 1) * 6);
  const selectClass =
    "min-w-0 rounded-lg border border-violet-200/20 bg-[#211b26] px-2 py-2 text-xs text-[#f4ede5] focus-visible:ring-2 focus-visible:ring-amber-200";
  return (
    <section
      className={
        props.layout === "workbench"
          ? "novel-template-picker"
          : "mt-2 min-w-0 overflow-hidden rounded-xl border border-violet-200/15 bg-[#15111e] p-3"
      }
      data-manhua-template-picker
      aria-label="故事模板目录"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#f4ede5]">
            按创作手法选模板
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[#c4b6cc]">
            先看一场戏怎样成立，再选择要借用的方法。可并排比较三份。
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-violet-200/10 px-2 py-1 text-[10px] text-violet-100">
          {props.cards.length} 个模板
        </span>
      </div>
      <input
        aria-label="搜索故事类型与表现手法"
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setPage(0);
        }}
        disabled={props.disabled}
        placeholder="搜索对白、人物反应、光线、声音或编号…"
        className={`mt-3 w-full ${selectClass}`}
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="min-w-0 text-[11px] text-[#c4b6cc]">
          创作环节
          <select
            aria-label="创作环节"
            className={`mt-1 w-full ${selectClass}`}
            value={dimension}
            disabled={props.disabled}
            onChange={e => {
              setDimension(e.target.value);
              setFeature("");
              setPage(0);
            }}
          >
            <option value="">全部环节</option>
            {TEMPLATE_CRAFT_DIMENSIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-[#c4b6cc]">
          具体手法
          <select
            aria-label="具体手法"
            className={`mt-1 w-full ${selectClass}`}
            value={feature}
            disabled={props.disabled}
            onChange={e => {
              setFeature(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部手法</option>
            {features.map(f => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-[10px] leading-5 text-[#c4b6cc]">
        学习节奏、内容组织和创作方法，配合项目导演包使用。
      </p>
      <div
        className={
          props.layout === "workbench"
            ? "novel-template-rows"
            : "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
        }
        role="group"
        aria-label="选择故事模板"
      >
        {visible.map(card => {
          const chosen = props.chosenIds
              ? props.chosenIds.includes(card.publicId)
              : props.value === card.publicId,
            checked = compareIds.includes(card.publicId);
          const code = card.publicId.replace(/^mt_/i, "").toUpperCase();
          return (
            <div
              key={card.publicId}
              className={`min-w-0 rounded-lg border ${chosen ? "border-[#dfba7c] bg-[#dfba7c]/10" : "border-violet-200/15 bg-white/[0.03]"}`}
            >
              <button
                type="button"
                aria-pressed={chosen}
                disabled={props.disabled}
                onClick={() => props.onChange(card.publicId)}
                className="w-full min-w-0 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70 disabled:opacity-50"
              >
                <span className="flex justify-between gap-2 text-[10px] text-[#c4b6cc]">
                  <span>创作手法</span>
                  <span className="font-mono text-[#dfba7c]">
                    {code}
                    {chosen ? " · 已选" : ""}
                  </span>
                </span>
                <span className="mt-2 block text-[13px] font-semibold leading-5 text-[#f4ede5]">
                  {card.methodBrief?.title || "创作方法待核对"}
                </span>
                <span className="mt-2 block text-[11px] leading-5 text-[#c4b6cc]">
                  {card.methodBrief
                    ? card.methodBrief.highlights.map(h => (
                        <span key={h} className="mb-2 block">
                          {h}
                        </span>
                      ))
                    : "具体方法说明待核对"}
                  {card.methodBrief && (
                    <span className="block text-amber-200/90">
                      {card.methodBrief.useWhen}
                    </span>
                  )}
                </span>
              </button>
              <label className="flex items-center gap-2 border-t border-white/10 px-3 py-2 text-[11px] text-[#c4b6cc]">
                <input
                  type="checkbox"
                  aria-label={`比较模板 ${code}`}
                  checked={checked}
                  disabled={
                    props.disabled || (!checked && compared.length >= 3)
                  }
                  onChange={() =>
                    setCompareIds(
                      checked
                        ? compareIds.filter(id => id !== card.publicId)
                        : [...compareIds, card.publicId]
                    )
                  }
                />
                加入手法对照
              </label>
            </div>
          );
        })}
      </div>
      {!choices.length && (
        <p role="status" className="mt-3 text-xs text-[#e5cb9d]">
          没有匹配项。清空搜索或调整条件，已选模板仍保留。
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[#c4b6cc]">
        <span>
          找到 {choices.length} 个 · {currentPage + 1}/{pages} 页
        </span>
        <div className="flex gap-2">
          {[
            [-1, "上一页"],
            [1, "下一页"],
          ].map(([delta, label]) => (
            <button
              key={label}
              type="button"
              disabled={
                props.disabled ||
                (Number(delta) < 0
                  ? currentPage === 0
                  : currentPage >= pages - 1)
              }
              onClick={() => setPage(currentPage + Number(delta))}
              className="rounded-md border border-violet-200/20 px-2 py-1 disabled:opacity-35"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {compared.length > 0 && (
        <section
          aria-label="模板手法对照"
          className="mt-4 rounded-lg border border-violet-200/20 p-3"
        >
          <div className="flex justify-between gap-2 text-xs text-[#f4ede5]">
            <h3>手法对照 · {compared.length}/3</h3>
            <button type="button" onClick={() => setCompareIds([])}>
              清空对照
            </button>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            {compared.map(c => (
              <div key={c.publicId} className="min-w-0">
                <h4 className="mb-2 text-xs font-semibold text-[#f4ede5]">
                  {c.publicId.replace(/^mt_/, "").toUpperCase()} ·{" "}
                  {c.methodBrief?.title || "创作方法待核对"}
                </h4>
                <CraftDetails card={c} />
              </div>
            ))}
          </div>
        </section>
      )}
      {selected && props.layout !== "workbench" ? (
        <section
          aria-label="所选模板呈现方法"
          className="mt-3 rounded-lg border border-[#dfba7c]/40 bg-[#211b26] p-3 text-xs leading-6 text-[#e8dfe9]"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-[#f4ede5]">
              {templateChoiceLabel(selected)}
            </p>
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => props.onChange("")}
              className="shrink-0 text-[11px] underline"
            >
              取消选择
            </button>
          </div>
          <div className="mt-3">
            <CraftDetails card={selected} />
          </div>
          <p className="mt-2 text-[10px] leading-5 text-[#c4b6cc]">
            人物和事件由你的作品决定，学习手法在试写与正式应用时参与创作，不照搬来源剧情。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {props.onWrite && (
              <button
                type="button"
                disabled={props.disabled}
                onClick={props.onWrite}
                className="rounded-lg bg-[#dfba7c] px-3 py-2 font-semibold text-[#261b12]"
              >
                选好了，我自己写
              </button>
            )}
            {props.onAskAdvisor && (
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => props.onAskAdvisor?.(selected)}
                className="rounded-lg border border-violet-200/30 px-3 py-2"
              >
                把编号交给创作顾问
              </button>
            )}
          </div>
        </section>
      ) : (
        <p className="mt-3 text-[11px] leading-5 text-[#c4b6cc]">
          点选模板查看手法，勾选比较不会自动采用或生成。
        </p>
      )}
    </section>
  );
}
