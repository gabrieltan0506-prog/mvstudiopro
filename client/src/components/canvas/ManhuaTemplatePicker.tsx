import React, { useMemo, useState } from "react";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";

export function templateChoiceLabel(card: PublicManhuaViralTemplateCard): string {
  if (!card.storyPreview) return card.nameZh;
  const code = card.publicId.replace(/^mt_/i, "").toUpperCase();
  return `${card.storyPreview.teaserTitleZh || card.storyPreview.storyTypeZh} · ${card.storyPreview.presentationTagsZh.join(" / ") || "开篇故事"} · ${code}`;
}

/** 按公开ID保留不同卡；情绪标签相同不等于表现手法相同。 */
export function filterTemplateChoices(cards: readonly PublicManhuaViralTemplateCard[], query: string, storyType: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const unique = new Map(cards.map(card => [card.publicId, card]));
  return Array.from(unique.values()).filter(card => {
    if (storyType && (card.storyPreview?.storyTypeZh || "待整理") !== storyType) return false;
    const text = [templateChoiceLabel(card), card.nameZh, card.featureZh, card.introZh, ...(card.classificationTagsZh || []), card.storyPreview?.premiseZh].join(" ").toLowerCase();
    return words.every(word => text.includes(word));
  });
}

export default function ManhuaTemplatePicker(props: {
  cards: PublicManhuaViralTemplateCard[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
  onWrite?: () => void;
  onAskAdvisor?: (card: PublicManhuaViralTemplateCard) => void;
}) {
  const [query, setQuery] = useState("");
  const [storyType, setStoryType] = useState("");
  const [page, setPage] = useState(0);
  const selected = props.cards.find(card => card.publicId === props.value);
  const choices = useMemo(() => filterTemplateChoices(props.cards, query, storyType), [props.cards, query, storyType]);
  const groups = useMemo(() => Array.from(new Set(props.cards.map(card => card.storyPreview?.storyTypeZh || "待整理"))).sort(), [props.cards]);
  const pages = Math.max(1, Math.ceil(choices.length / 6));
  const currentPage = Math.min(page, pages - 1);
  const visible = choices.slice(currentPage * 6, (currentPage + 1) * 6);
  return <section className="mt-2 overflow-hidden rounded-xl border border-violet-200/15 bg-[#15111e] p-3" data-manhua-template-picker aria-label="故事模板目录">
    <div className="flex items-start justify-between gap-2">
      <div><p className="text-sm font-semibold text-[#f4ede5]">找到你想写的故事</p><p className="mt-1 text-[11px] leading-5 text-[#c4b6cc]">先看开篇，再决定如何创作。每个编号保留不同的表现侧重。</p></div>
      <span className="shrink-0 rounded-full bg-violet-200/10 px-2 py-1 text-[10px] text-violet-100">{props.cards.length} 个模板</span>
    </div>
    <input aria-label="搜索故事类型与表现手法" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} disabled={props.disabled}
      placeholder="搜索故事、对白、声音或编号…" className="mt-3 w-full min-w-0 rounded-lg border border-violet-200/20 bg-black/30 px-3 py-2 text-xs text-[#f4ede5] placeholder:text-[#a293ad] outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70 disabled:opacity-50" />
    <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="按故事方向筛选模板">
      {["", ...groups].map(group => <button key={group} type="button" aria-pressed={storyType === group} disabled={props.disabled} onClick={() => { setStoryType(group); setPage(0); }}
        className={`rounded-full border px-2.5 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70 disabled:opacity-50 ${storyType === group ? "border-[#dfba7c] bg-[#dfba7c] text-[#261b12]" : "border-violet-200/15 text-[#c4b6cc] hover:bg-violet-200/10"}`}>
        {group || "全部故事"}
      </button>)}
    </div>
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="选择故事模板">
      {visible.map(card => {
        const chosen = props.value === card.publicId;
        const code = card.publicId.replace(/^mt_/i, "").toUpperCase();
        return <button key={card.publicId} type="button" aria-pressed={chosen} disabled={props.disabled} onClick={() => props.onChange(card.publicId)}
          className={`min-w-0 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70 disabled:opacity-50 ${chosen ? "border-[#dfba7c] bg-[#dfba7c]/10" : "border-violet-200/15 bg-white/[0.03] hover:border-violet-200/40 hover:bg-violet-200/10"}`}>
          <span className="flex items-center justify-between gap-2 text-[10px] text-[#c4b6cc]"><span>{card.storyPreview?.storyTypeZh || "待整理"}</span><span className="font-mono text-[#dfba7c]">{code}{chosen ? " · 已选" : ""}</span></span>
          <span className="mt-2 block text-[13px] font-semibold leading-5 text-[#f4ede5]">{card.storyPreview?.teaserTitleZh || card.nameZh}</span>
          <span className="mt-2 block text-[11px] leading-5 text-[#c4b6cc]">{card.storyPreview?.presentationTagsZh.join(" · ") || card.classificationTagsZh.slice(0, 2).join(" · ")}</span>
        </button>;
      })}
    </div>
    {!choices.length ? <p role="status" className="mt-3 text-xs text-[#e5cb9d]">没有匹配项。清空搜索或换个故事方向，已选模板仍保留。</p> : null}
    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[#c4b6cc]">
      <span>找到 {choices.length} 个 · {currentPage + 1}/{pages} 页</span>
      <div className="flex gap-2">{[[-1, "上一页"], [1, "下一页"]].map(([delta, label]) => <button key={label} type="button" disabled={props.disabled || (Number(delta) < 0 ? currentPage === 0 : currentPage >= pages - 1)} onClick={() => setPage(currentPage + Number(delta))} className="rounded-md border border-violet-200/20 px-2 py-1 text-[#f4ede5] outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70 disabled:opacity-35">{label}</button>)}</div>
    </div>
    {selected ? <section aria-label="所选模板开篇预览" className="mt-3 rounded-lg border border-[#dfba7c]/40 bg-[#211b26] p-3 text-xs leading-6 text-[#e8dfe9]">
      <div className="flex items-start justify-between gap-2"><p className="font-semibold text-[#f4ede5]">{templateChoiceLabel(selected)}</p><button type="button" disabled={props.disabled} onClick={() => props.onChange("")} className="shrink-0 text-[11px] text-[#c4b6cc] underline underline-offset-4 focus-visible:outline focus-visible:outline-amber-200">取消选择</button></div>
      {selected.storyPreview ? <>
        <p className="mt-2">{selected.storyPreview.premiseZh}</p>
        <dl className="mt-2 space-y-2">
          <div><dt className="text-[11px] text-[#dfba7c]">故事开篇</dt><dd>{selected.storyPreview.openingZh}</dd></div>
          <div><dt className="text-[11px] text-[#dfba7c]">接下来，你想看吗？</dt><dd>{selected.storyPreview.earlyProgressionZh}</dd></div>
        </dl>
        <p className="mt-2 text-[10px] leading-5 text-[#c4b6cc]">这是匿名开篇参考，人物和情节由你的题材决定。完整推进、反转和制作手法在试写与正式应用时参与创作。</p>
      </> : <p className="mt-2 text-[#c4b6cc]">这份模板的开篇大纲尚待整理，可先试写查看实际故事。</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {props.onWrite ? <button type="button" disabled={props.disabled} onClick={props.onWrite} className="rounded-lg bg-[#dfba7c] px-3 py-2 font-semibold text-[#261b12] outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40">选好了，我自己写</button> : null}
        {props.onAskAdvisor ? <button type="button" disabled={props.disabled} onClick={() => props.onAskAdvisor?.(selected)} className="rounded-lg border border-violet-200/30 px-3 py-2 text-[#f4ede5] outline-none hover:bg-violet-200/10 focus-visible:ring-2 focus-visible:ring-amber-200 disabled:opacity-40">把编号交给创作顾问</button> : null}
      </div>
    </section> : <p className="mt-3 text-[11px] leading-5 text-[#c4b6cc]">点选卡片，只展开这一份开篇大纲。也可不选模板，继续写自己的故事。</p>}
  </section>;
}
