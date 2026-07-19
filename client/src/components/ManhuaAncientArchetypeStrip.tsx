/**
 * 漫剧工厂 · 古风原型条（与都市 char_* 槽分层）
 */
import { useMemo, useState } from "react";
import {
  getAncientArchetypePreviewUrl,
  listAncientArchetypes,
  type ManhuaAncientDesignBoard,
} from "@shared/manhuaAncientArchetypeLibrary";

type Props = {
  selectedIds: string[];
  disabled?: boolean;
  onToggle: (id: string) => void;
  maxSelect?: number;
};

const LANE_LABEL: Record<ManhuaAncientDesignBoard["lane"], string> = {
  ancient: "古风",
  xianxia: "仙侠",
  jianghu: "江湖",
  gongting: "宫廷",
};

export default function ManhuaAncientArchetypeStrip({
  selectedIds,
  disabled,
  onToggle,
  maxSelect = 2,
}: Props) {
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<ManhuaAncientDesignBoard["lane"] | "">("");
  const list = useMemo(
    () => listAncientArchetypes({ lane: lane || null, query }),
    [lane, query],
  );

  return (
    <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-amber-100/90">古风原型</div>
          <p className="text-[10px] leading-snug text-white/45">
            设计板锚点（三视图公式字段）；最多选 {maxSelect} 个，与都市角色库并行注入。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={lane}
            disabled={disabled}
            onChange={(e) => setLane(e.target.value as ManhuaAncientDesignBoard["lane"] | "")}
            className="rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-white/80"
          >
            <option value="">全部 lane</option>
            {(Object.keys(LANE_LABEL) as Array<keyof typeof LANE_LABEL>).map((k) => (
              <option key={k} value={k}>
                {LANE_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜原型…"
            className="w-28 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-white placeholder:text-white/30"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
        {list.map((b) => {
          const selected = selectedIds.includes(b.id);
          const preview = getAncientArchetypePreviewUrl(b.id);
          const atCap = !selected && selectedIds.length >= maxSelect;
          return (
            <button
              key={b.id}
              type="button"
              disabled={disabled || atCap}
              onClick={() => onToggle(b.id)}
              className={`overflow-hidden rounded-lg border text-left transition ${
                selected
                  ? "border-amber-300/60 bg-amber-400/15 ring-1 ring-amber-300/40"
                  : "border-white/10 bg-black/25 hover:border-white/25"
              } disabled:opacity-40`}
            >
              <div className="relative aspect-[3/4] bg-gradient-to-b from-amber-900/40 to-black/60">
                {preview ? (
                  <img
                    src={preview}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : null}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 py-1.5">
                  <div className="truncate text-[10px] font-semibold text-white">{b.nameZh}</div>
                  <div className="truncate text-[9px] text-amber-100/70">{LANE_LABEL[b.lane]}</div>
                </div>
              </div>
              <div className="px-1.5 py-1 text-[9px] leading-tight text-white/50 line-clamp-2">
                {b.coreTags.slice(0, 3).join("·")}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
