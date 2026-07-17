import { MANHUA_TEMPERAMENT_PACKS } from "@shared/manhuaCharacterAssetLibrary";

export type ManhuaAgeBand = "" | "le25" | "26_28" | "ge29";
export type ManhuaAgeGapMax = 0 | 3 | 5;

type Props = {
  disabled?: boolean;
  packFilterId: string;
  tagFilter: string;
  jobFilter: string;
  ageBand: ManhuaAgeBand;
  ageGapMax: ManhuaAgeGapMax;
  tagOptions: string[];
  jobOptions: string[];
  onPackFilterId: (id: string) => void;
  onTagFilter: (tag: string) => void;
  onJobFilter: (job: string) => void;
  onAgeBand: (band: ManhuaAgeBand) => void;
  onAgeGapMax: (n: ManhuaAgeGapMax) => void;
};

export default function ManhuaCharacterLibraryFilterChips({
  disabled,
  packFilterId,
  tagFilter,
  jobFilter,
  ageBand,
  ageGapMax,
  tagOptions,
  jobOptions,
  onPackFilterId,
  onTagFilter,
  onJobFilter,
  onAgeBand,
  onAgeGapMax,
}: Props) {
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPackFilterId("")}
          className={`rounded-full border px-2 py-0.5 text-[10px] ${
            !packFilterId ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50"
          }`}
        >
          全部组合
        </button>
        {MANHUA_TEMPERAMENT_PACKS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            title={p.tags.join(" · ")}
            onClick={() => {
              onPackFilterId(packFilterId === p.id ? "" : p.id);
              onTagFilter("");
            }}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              packFilterId === p.id
                ? "border-violet-400/45 bg-violet-500/15 text-violet-100"
                : "border-white/10 text-white/50 hover:border-white/25"
            }`}
          >
            {p.labelZh}
          </button>
        ))}
      </div>
      {tagOptions.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onTagFilter("")}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              !tagFilter ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50"
            }`}
          >
            全部气质
          </button>
          {tagOptions.map((t) => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              onClick={() => onTagFilter(tagFilter === t ? "" : t)}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                tagFilter === t
                  ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                  : "border-white/10 text-white/50 hover:border-white/25"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {(
          [
            ["", "全部年龄"],
            ["le25", "≤25"],
            ["26_28", "26–28"],
            ["ge29", "≥29"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id || "all-age"}
            type="button"
            disabled={disabled}
            onClick={() => onAgeBand(id)}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              ageBand === id
                ? "border-sky-400/45 bg-sky-500/15 text-sky-100"
                : "border-white/10 text-white/50 hover:border-white/25"
            }`}
          >
            {label}
          </button>
        ))}
        {(
          [
            [0, "不限年龄差"],
            [3, "年龄差≤3"],
            [5, "年龄差≤5"],
          ] as const
        ).map(([n, label]) => (
          <button
            key={`gap-${n}`}
            type="button"
            disabled={disabled}
            title="相对另一侧已选角色的年龄差"
            onClick={() => onAgeGapMax(n)}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              ageGapMax === n
                ? "border-sky-400/45 bg-sky-500/15 text-sky-100"
                : "border-white/10 text-white/50 hover:border-white/25"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {jobOptions.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onJobFilter("")}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              !jobFilter ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50"
            }`}
          >
            全部职业
          </button>
          {jobOptions.map((j) => (
            <button
              key={j}
              type="button"
              disabled={disabled}
              onClick={() => onJobFilter(jobFilter === j ? "" : j)}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                jobFilter === j
                  ? "border-amber-400/45 bg-amber-500/15 text-amber-100"
                  : "border-white/10 text-white/50 hover:border-white/25"
              }`}
            >
              {j}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
