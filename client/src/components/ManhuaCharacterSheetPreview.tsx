import { useState } from "react";
import {
  formatManhuaCharacterLookSummary,
  getManhuaArtStylePreset,
  getManhuaCharacterPreviewUrl,
  type ManhuaArtStyleId,
  type ManhuaCharacterTemplate,
} from "@shared/manhuaCharacterAssetLibrary";
import { copyText } from "@/lib/manhuaCharacterGalleryStorage";
import ManhuaTriViewStrip from "@/components/ManhuaTriViewStrip";

export default function ManhuaCharacterSheetPreview({
  character,
  accent,
  autoApplied,
  compact,
  artStyleId,
}: {
  character: ManhuaCharacterTemplate;
  accent: "cyan" | "amber";
  autoApplied?: boolean;
  compact?: boolean;
  artStyleId?: ManhuaArtStyleId;
}) {
  const [idFlash, setIdFlash] = useState(false);
  const url = getManhuaCharacterPreviewUrl(character.id);
  const style = getManhuaArtStylePreset(artStyleId);

  const copyId = async () => {
    const ok = await copyText(character.id);
    if (!ok) return;
    setIdFlash(true);
    window.setTimeout(() => setIdFlash(false), 1200);
  };
  const ring =
    accent === "cyan"
      ? "border-cyan-400/55 shadow-[0_0_24px_rgba(34,211,238,0.12)]"
      : "border-amber-400/55 shadow-[0_0_24px_rgba(251,191,36,0.12)]";
  const tag =
    accent === "cyan"
      ? "bg-cyan-500/15 text-cyan-100 border-cyan-400/35"
      : "bg-amber-500/15 text-amber-100 border-amber-400/35";
  const look = formatManhuaCharacterLookSummary(character);

  return (
    <div className={`overflow-hidden rounded-xl border ${ring} bg-black/40`}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-white">{character.nameZh}</h4>
            {autoApplied ? (
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${tag}`}>已自动套用</span>
            ) : (
              <span className="rounded-md border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] text-emerald-100">
                已选中
              </span>
            )}
            <span className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/55">
              {style.labelZh}
            </span>
            <button
              type="button"
              title="点击复制角色 id"
              onClick={() => void copyId()}
              className="rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-white/35 hover:border-white/25 hover:text-white/70"
            >
              {idFlash ? "已复制" : character.id}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-white/55">
            {character.jobZh}
            {character.age ? ` · ${character.age}岁` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {character.temperamentTags.map((t) => (
              <span key={t} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/75">
                {t}
              </span>
            ))}
          </div>
          {look ? <p className="mt-2 text-[10px] leading-snug text-white/50">{look}</p> : null}
        </div>
      </div>

      {url ? (
        <>
          <div
            className={`relative mx-3 mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/50 ${compact ? "h-28" : "h-40"}`}
          >
            <img
              src={url}
              alt={`${character.nameZh} 人像`}
              className="absolute inset-0 h-full w-[210%] max-w-none object-cover object-[12%_18%]"
              loading="lazy"
            />
          </div>
          <div className="mx-3 mt-2 mb-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-white/45">
              <span>三视图 · 正 / 侧 / 背</span>
              <span className="inline-flex items-center gap-1 text-emerald-200/70">
                <span className="text-emerald-300">✓</span>
                已锁定妆造
              </span>
            </div>
            <ManhuaTriViewStrip url={url} compact={compact} />
          </div>
        </>
      ) : (
        <div className="m-3 rounded-lg border border-dashed border-white/15 px-3 py-8 text-center text-[11px] text-white/40">
          暂无预览图
        </div>
      )}
    </div>
  );
}
