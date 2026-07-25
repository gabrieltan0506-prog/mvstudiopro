/**
 * 段成片提示词的药丸视图：把 @角色2 这种裸标记渲染成带缩略图的内联药丸。
 *
 * 裸标记是给引擎看的，人读起来对不上是谁绑了哪张脸。药丸把缩略图、名字、
 * 职责一并摊在正文里，一眼能核对这句台词用的是哪张定妆。
 */
import { useMemo } from "react";
import {
  manhuaAssetChipDutyLabelZh,
  parseManhuaPromptAssetMetaByTag,
  stripManhuaPromptBindBlocksForReview,
  tokenizeManhuaPromptAssets,
  type ManhuaPromptAssetKind,
} from "@shared/manhuaPromptAssetChips";

/** 按资产类型分色，扫一眼就知道这句挂的是人、地、还是物 */
const KIND_TONE: Record<ManhuaPromptAssetKind, string> = {
  角色: "border-cyan-400/45 bg-cyan-500/15 text-cyan-50",
  场景: "border-emerald-400/45 bg-emerald-500/15 text-emerald-50",
  道具: "border-amber-400/45 bg-amber-500/15 text-amber-50",
  服装: "border-fuchsia-400/45 bg-fuchsia-500/15 text-fuchsia-50",
};

const UNKNOWN_TONE = "border-white/20 bg-white/10 text-white/70";

export default function ManhuaPromptAssetChips({
  prompt,
  thumbUrlByAssetId,
  className,
}: {
  prompt: string;
  /** 资产 id → 缩略图；缺图只是不显示图，不影响药丸 */
  thumbUrlByAssetId?: Record<string, string>;
  className?: string;
}) {
  const { tokens } = useMemo(() => {
    const metaByTag = parseManhuaPromptAssetMetaByTag(prompt);
    const body = stripManhuaPromptBindBlocksForReview(prompt);
    return { tokens: tokenizeManhuaPromptAssets(body, metaByTag) };
  }, [prompt]);

  if (!tokens.length) {
    return (
      <div className={`text-[10px] text-white/35 ${className || ""}`}>
        尚无段成片提示词。
      </div>
    );
  }

  return (
    <div
      data-manhua-prompt-chips
      className={`whitespace-pre-wrap break-words text-[11px] leading-6 text-white/80 ${
        className || ""
      }`}
    >
      {tokens.map((t, i) => {
        if (t.kind === "text") return <span key={i}>{t.text}</span>;
        const meta = t.meta;
        const tone = meta ? KIND_TONE[meta.kind] || UNKNOWN_TONE : UNKNOWN_TONE;
        const thumb = meta ? thumbUrlByAssetId?.[meta.assetId] : undefined;
        const dutyZh = manhuaAssetChipDutyLabelZh(meta?.duty);
        // 对照表里查不到就退回原标记，别让人以为这句没绑资产
        const label = meta?.labelZh || t.raw.replace(/^@/, "");
        return (
          <span
            key={i}
            data-manhua-asset-chip={t.raw}
            title={meta ? `${t.raw} · ${meta.kind}${dutyZh ? ` · ${dutyZh}` : ""}` : t.raw}
            className={`mx-0.5 inline-flex max-w-[13rem] items-center gap-1 rounded-full border py-0 pl-0.5 pr-1.5 align-middle text-[10px] ${tone}`}
          >
            {thumb ? (
              <img
                src={thumb}
                alt=""
                loading="lazy"
                className="h-4 w-4 shrink-0 rounded-full object-cover object-top"
              />
            ) : (
              <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
            )}
            <span className="truncate font-medium">{label}</span>
            {dutyZh ? <span className="shrink-0 opacity-60">·{dutyZh}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
