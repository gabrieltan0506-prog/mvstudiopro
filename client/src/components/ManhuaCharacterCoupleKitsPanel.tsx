import {
  MANHUA_COUPLE_PACKS,
  type ManhuaArtStyleId,
  type ManhuaCouplePack,
} from "@shared/manhuaCharacterAssetLibrary";
import type { CustomCouple } from "@/lib/manhuaCharacterGalleryStorage";

type Props = {
  disabled?: boolean;
  femaleId: string;
  maleId: string;
  canRandomBoth: boolean;
  topicReasonZh?: string;
  topicFirstPackId?: string;
  topicCoupleIds: Set<string>;
  recentCouplePacks: ManhuaCouplePack[];
  customCouples: CustomCouple[];
  onApplyPack: (packId: string) => void;
  onApplyPair: (
    femaleId: string,
    maleId: string,
    opts?: { artStyleId?: ManhuaArtStyleId; labelZh?: string },
  ) => void;
  onPickRandomPack: () => void;
  onPickRandomBoth: () => void;
  onFavoriteBoth: () => void;
  onSaveCurrentCustom: () => void;
  onClearRecentPacks: () => void;
  onExportCustom: () => void;
  onImportCustom: () => void;
  onRemoveCustom: (id: string) => void;
};

export default function ManhuaCharacterCoupleKitsPanel({
  disabled,
  femaleId,
  maleId,
  canRandomBoth,
  topicReasonZh,
  topicFirstPackId,
  topicCoupleIds,
  recentCouplePacks,
  customCouples,
  onApplyPack,
  onApplyPair,
  onPickRandomPack,
  onPickRandomBoth,
  onFavoriteBoth,
  onSaveCurrentCustom,
  onClearRecentPacks,
  onExportCustom,
  onImportCustom,
  onRemoveCustom,
}: Props) {
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-white/75">男女套组（一键选用）</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled || !MANHUA_COUPLE_PACKS.length}
            onClick={onPickRandomPack}
            className="text-[10px] text-white/70 underline-offset-2 hover:underline disabled:opacity-40"
          >
            随机套组
          </button>
          <button
            type="button"
            disabled={disabled || !canRandomBoth}
            onClick={onPickRandomBoth}
            className="text-[10px] text-white/70 underline-offset-2 hover:underline disabled:opacity-40"
          >
            随机双人
          </button>
          <button
            type="button"
            disabled={disabled || !femaleId || !maleId}
            onClick={onFavoriteBoth}
            className="text-[10px] text-rose-200/80 underline-offset-2 hover:underline disabled:opacity-40"
          >
            收藏当前双人
          </button>
          <button
            type="button"
            disabled={disabled || !femaleId || !maleId}
            onClick={onSaveCurrentCustom}
            className="text-[10px] text-emerald-200/80 underline-offset-2 hover:underline disabled:opacity-40"
          >
            保存当前双人为套组
          </button>
          <span className="text-[10px] text-white/35">会同步画风 · 不烧 token</span>
        </div>
      </div>
      {topicReasonZh ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-[10px] text-violet-100/70">{topicReasonZh}（仅高亮，不自动套用）</p>
          {topicFirstPackId ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApplyPack(topicFirstPackId)}
              className="rounded-md border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-50 disabled:opacity-40"
            >
              一键套用首推
            </button>
          ) : null}
        </div>
      ) : null}
      {recentCouplePacks.length ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-white/40">最近套组</span>
          {recentCouplePacks.map((p) => (
            <button
              key={`recent-pack-${p.id}`}
              type="button"
              disabled={disabled}
              onClick={() => onApplyPack(p.id)}
              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/60 hover:border-white/25 disabled:opacity-40"
            >
              {p.labelZh}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={onClearRecentPacks}
            className="text-[10px] text-white/35 underline-offset-2 hover:underline disabled:opacity-40"
          >
            清空
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {[...MANHUA_COUPLE_PACKS]
          .map((p, idx) => ({ p, idx }))
          .sort((a, b) => {
            const as = topicCoupleIds.has(a.p.id) ? 0 : 1;
            const bs = topicCoupleIds.has(b.p.id) ? 0 : 1;
            return as - bs || a.idx - b.idx;
          })
          .map(({ p, idx }) => {
            const active = femaleId === p.femaleId && maleId === p.maleId;
            const soft = topicCoupleIds.has(p.id);
            const hotkey = idx < 9 ? String(idx + 1) : idx === 9 ? "0" : "";
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                title={hotkey ? `${p.blurbZh}（快捷键 ${hotkey}）` : p.blurbZh}
                onClick={() => onApplyPack(p.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-[10px] disabled:opacity-40 ${
                  active
                    ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-100"
                    : soft
                      ? "border-violet-400/40 bg-violet-500/10 text-violet-50 hover:border-violet-300/55"
                      : "border-white/10 bg-black/30 text-white/70 hover:border-white/25"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  {hotkey ? <span className="text-white/35">{hotkey}.</span> : null}
                  {p.labelZh}
                  {soft && !active ? (
                    <span className="rounded px-1 text-[9px] font-normal text-violet-200/80">题材</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-white/40">{p.blurbZh}</div>
              </button>
            );
          })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || !customCouples.length}
          onClick={onExportCustom}
          className="text-[10px] text-white/55 underline-offset-2 hover:underline disabled:opacity-40"
        >
          导出我的套组
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onImportCustom}
          className="text-[10px] text-white/55 underline-offset-2 hover:underline disabled:opacity-40"
        >
          导入我的套组
        </button>
      </div>
      {customCouples.length ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] text-white/40">我的套组</div>
          <div className="flex flex-wrap gap-1.5">
            {customCouples.map((p) => {
              const active = femaleId === p.femaleId && maleId === p.maleId;
              return (
                <div key={p.id} className="inline-flex items-stretch gap-0.5">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onApplyPair(p.femaleId, p.maleId, {
                        artStyleId: p.artStyleId,
                        labelZh: p.labelZh,
                      })
                    }
                    className={`rounded-l-lg border px-2.5 py-1.5 text-[10px] disabled:opacity-40 ${
                      active
                        ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-100"
                        : "border-white/10 bg-black/30 text-white/70 hover:border-white/25"
                    }`}
                  >
                    {p.labelZh}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    title="删除此套组"
                    onClick={() => onRemoveCustom(p.id)}
                    className="rounded-r-lg border border-l-0 border-white/10 bg-black/40 px-1.5 text-[10px] text-white/40 hover:text-white/70 disabled:opacity-40"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
