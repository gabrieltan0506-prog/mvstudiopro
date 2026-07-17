import { useState } from "react";
import {
  getManhuaCharacterPreviewUrl,
  type ManhuaCharacterTemplate,
} from "@shared/manhuaCharacterAssetLibrary";
import ManhuaTriViewStrip from "@/components/ManhuaTriViewStrip";

export default function ManhuaCharacterLibraryCard({
  character,
  selected,
  favorited,
  accent,
  onSelect,
  onToggleFavorite,
  disabled,
}: {
  character: ManhuaCharacterTemplate;
  selected: boolean;
  favorited: boolean;
  accent: "cyan" | "amber";
  onSelect: () => void;
  onToggleFavorite: () => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const url = getManhuaCharacterPreviewUrl(character.id);
  const showPreview = hover || pinned;
  const border = selected
    ? accent === "cyan"
      ? "border-cyan-400 shadow-[0_0_0_1px_rgba(34,211,238,0.45)]"
      : "border-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.45)]"
    : favorited
      ? "border-rose-300/35 hover:border-rose-300/55"
      : "border-white/10 hover:border-white/25";

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          setPinned((v) => !v);
        }}
        data-character-id={character.id}
        aria-label={`选用 ${character.nameZh}${favorited ? "（已收藏）" : ""}`}
        aria-pressed={selected}
        className={`w-full overflow-hidden rounded-xl border bg-black/35 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/70 disabled:opacity-45 ${border}`}
      >
        <div className="relative h-28 overflow-hidden bg-black/50">
          {url ? (
            <img
              src={url}
              alt=""
              className="absolute inset-0 h-full w-[200%] max-w-none object-cover object-[12%_16%]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-white/35">无图</div>
          )}
          {selected ? (
            <span
              className={`absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                accent === "cyan" ? "bg-cyan-400 text-black" : "bg-amber-400 text-black"
              }`}
            >
              ✓
            </span>
          ) : null}
        </div>
        <div className="px-2 py-1.5">
          <div className="flex items-baseline justify-between gap-1">
            <div className="truncate text-[12px] font-semibold text-white">{character.nameZh}</div>
            {character.age ? <span className="shrink-0 text-[10px] text-white/35">{character.age}</span> : null}
          </div>
          <div className="truncate text-[10px] text-white/45">
            {character.jobZh}
            {character.temperamentTags.length ? ` · ${character.temperamentTags.slice(0, 2).join(" · ")}` : ""}
          </div>
        </div>
      </button>
      <button
        type="button"
        disabled={disabled}
        title={favorited ? "取消收藏" : "收藏"}
        aria-label={favorited ? `取消收藏 ${character.nameZh}` : `收藏 ${character.nameZh}`}
        aria-pressed={favorited}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className={`absolute left-1.5 top-1.5 z-10 rounded-full border px-1.5 py-0.5 text-[11px] leading-none backdrop-blur disabled:opacity-40 ${
          favorited
            ? "border-rose-300/50 bg-rose-500/30 text-rose-100"
            : "border-white/20 bg-black/50 text-white/55 hover:border-white/35 hover:text-white/85"
        }`}
      >
        ★
      </button>

      {showPreview && url ? (
        <div className="pointer-events-none absolute left-1/2 top-0 z-30 w-64 -translate-x-1/2 -translate-y-[92%] rounded-xl border border-white/20 bg-[#0c081c]/95 p-2 shadow-2xl backdrop-blur">
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-white/70">
            <span>预览妆造 · 三视图</span>
            {pinned ? <span className="text-cyan-200/80">已钉住</span> : null}
          </div>
          <ManhuaTriViewStrip url={url} compact />
          <div className="mt-1 truncate text-[10px] text-white/55">
            {character.nameZh} · {character.jobZh}
          </div>
        </div>
      ) : null}
    </div>
  );
}
