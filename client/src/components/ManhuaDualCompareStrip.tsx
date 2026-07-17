import {
  formatManhuaCharacterLookSummary,
  getManhuaArtStylePreset,
  type ManhuaArtStyleId,
  type ManhuaCharacterTemplate,
} from "@shared/manhuaCharacterAssetLibrary";

export default function ManhuaDualCompareStrip({
  female,
  male,
  artStyleId,
}: {
  female: ManhuaCharacterTemplate | null;
  male: ManhuaCharacterTemplate | null;
  artStyleId: ManhuaArtStyleId;
}) {
  if (!female && !male) return null;
  const style = getManhuaArtStylePreset(artStyleId);
  const ageGap = female?.age && male?.age ? Math.abs(female.age - male.age) : null;
  const ageGapWide = ageGap != null && ageGap >= 6;
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-white/75">双人对照</div>
        <div className={`text-[10px] ${ageGapWide ? "text-amber-200/75" : "text-white/40"}`}>
          画风 · {style.labelZh}
          {ageGap != null ? ` · 年龄差 ${ageGap} 岁${ageGapWide ? "（偏大）" : ""}` : ""}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { c: female, label: "女主", tone: "text-cyan-100/85" },
          { c: male, label: "男主", tone: "text-amber-100/85" },
        ].map(({ c, label, tone }) => (
          <div key={label} className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
            <div className={`text-[10px] font-semibold ${tone}`}>{label}</div>
            {c ? (
              <>
                <div className="mt-0.5 truncate text-[12px] font-semibold text-white">{c.nameZh}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-white/50">
                  {formatManhuaCharacterLookSummary(c)}
                </div>
              </>
            ) : (
              <div className="mt-1 text-[10px] text-white/35">未选</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
