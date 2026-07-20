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

const selectClass =
  "w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-cyan-400/35 disabled:opacity-50";

/** 角色库筛选：统一下拉，避免 chip 墙打乱一集主路径 */
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
    <div className="mb-2 grid gap-2 sm:grid-cols-2">
      <label className="block text-[10px] text-white/45">
        气质组合
        <select
          disabled={disabled}
          value={packFilterId}
          onChange={(e) => {
            onPackFilterId(e.target.value);
            if (e.target.value) onTagFilter("");
          }}
          className={`mt-0.5 ${selectClass}`}
        >
          <option value="">全部组合</option>
          {MANHUA_TEMPERAMENT_PACKS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.labelZh}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[10px] text-white/45">
        气质标签
        <select
          disabled={disabled || !tagOptions.length}
          value={tagFilter}
          onChange={(e) => onTagFilter(e.target.value)}
          className={`mt-0.5 ${selectClass}`}
        >
          <option value="">全部气质</option>
          {tagOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[10px] text-white/45">
        年龄段
        <select
          disabled={disabled}
          value={ageBand}
          onChange={(e) => onAgeBand(e.target.value as ManhuaAgeBand)}
          className={`mt-0.5 ${selectClass}`}
        >
          <option value="">全部年龄</option>
          <option value="le25">≤25</option>
          <option value="26_28">26–28</option>
          <option value="ge29">≥29</option>
        </select>
      </label>
      <label className="block text-[10px] text-white/45">
        年龄差
        <select
          disabled={disabled}
          value={String(ageGapMax)}
          onChange={(e) => onAgeGapMax(Number(e.target.value) as ManhuaAgeGapMax)}
          className={`mt-0.5 ${selectClass}`}
          title="相对另一侧已选角色的年龄差"
        >
          <option value="0">不限年龄差</option>
          <option value="3">年龄差≤3</option>
          <option value="5">年龄差≤5</option>
        </select>
      </label>
      {jobOptions.length ? (
        <label className="block text-[10px] text-white/45 sm:col-span-2">
          职业
          <select
            disabled={disabled}
            value={jobFilter}
            onChange={(e) => onJobFilter(e.target.value)}
            className={`mt-0.5 ${selectClass}`}
          >
            <option value="">全部职业</option>
            {jobOptions.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
