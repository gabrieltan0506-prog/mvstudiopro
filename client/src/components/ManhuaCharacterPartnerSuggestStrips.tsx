import type { ManhuaCharacterGender, ManhuaCharacterTemplate } from "@shared/manhuaCharacterAssetLibrary";

type Props = {
  disabled?: boolean;
  libraryTab: ManhuaCharacterGender;
  similarInTab: ManhuaCharacterTemplate[];
  contrastPartners: ManhuaCharacterTemplate[];
  sameFieldPartners: ManhuaCharacterTemplate[];
  onSelect: (id: string, gender: ManhuaCharacterGender) => void;
};

export default function ManhuaCharacterPartnerSuggestStrips({
  disabled,
  libraryTab,
  similarInTab,
  contrastPartners,
  sameFieldPartners,
  onSelect,
}: Props) {
  if (!similarInTab.length && !contrastPartners.length && !sameFieldPartners.length) return null;
  const otherLabel = libraryTab === "female" ? "男主" : "女主";

  return (
    <>
      {similarInTab.length ? (
        <div className="mb-2">
          <div className="mb-1 text-[10px] text-white/40">同类气质（相对当前人选）</div>
          <div className="flex flex-wrap gap-1.5">
            {similarInTab.map((c) => (
              <button
                key={`sim-${c.id}`}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(c.id, c.gender)}
                className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/55 hover:border-white/25 disabled:opacity-40"
              >
                {c.nameZh}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {contrastPartners.length ? (
        <div className="mb-2">
          <div className="mb-1 text-[10px] text-white/40">
            反差配对（异性 · 气质少重叠）→ 点选即换{otherLabel}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {contrastPartners.map((c) => (
              <button
                key={`contrast-${c.id}`}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(c.id, c.gender)}
                className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] text-fuchsia-100/85 hover:border-fuchsia-300/50 disabled:opacity-40"
              >
                {c.nameZh}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {sameFieldPartners.length ? (
        <div className="mb-2">
          <div className="mb-1 text-[10px] text-white/40">
            同行异性（职业关键词相近）→ 点选即换{otherLabel}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sameFieldPartners.map((c) => (
              <button
                key={`field-${c.id}`}
                type="button"
                disabled={disabled}
                title={c.jobZh}
                onClick={() => onSelect(c.id, c.gender)}
                className="rounded-full border border-teal-400/30 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-100/85 hover:border-teal-300/50 disabled:opacity-40"
              >
                {c.nameZh}
                <span className="ml-1 text-teal-100/45">{c.jobZh}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
