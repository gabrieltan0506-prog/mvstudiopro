import { useId } from "react";
import type { filterManhuaShots } from "@/lib/manhuaShotSearch";

export function ManhuaShotSearch({ query, onQueryChange, results, total, selectedIndex, onSelect }: {
  query: string;
  onQueryChange: (query: string) => void;
  results: ReturnType<typeof filterManhuaShots>;
  total: number;
  selectedIndex: number;
  onSelect: (originalIndex: number) => void;
}) {
  const hintId = useId();
  return <div className="my-2 shrink-0 space-y-1" data-manhua-shot-search>
    <div className="flex items-center gap-1">
      <input type="search" aria-label="搜索本集分镜" aria-describedby={hintId}
        placeholder="搜镜号、人物、动作或对白" value={query}
        onChange={event => onQueryChange(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); onQueryChange(""); return; }
          if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || !results.length) return;
          event.preventDefault(); event.stopPropagation();
          const current = results.findIndex(item => item.originalIndex === selectedIndex);
          const next = event.key === "ArrowDown" ? Math.min(current + 1, results.length - 1)
            : event.key === "ArrowUp" ? (current < 0 ? results.length - 1 : Math.max(0, current - 1))
            : Math.max(0, current);
          onSelect(results[next].originalIndex);
        }}
        className="min-h-9 w-full min-w-0 rounded-lg border border-white/15 bg-black/20 px-2 text-xs text-white placeholder:text-white/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400" />
      {query ? <button type="button" aria-label="清空分镜搜索" onClick={() => onQueryChange("")}
        className="min-h-9 shrink-0 rounded-lg border border-white/15 px-2 text-xs text-white/70">清空</button> : null}
    </div>
    <p id={hintId} className="text-[10px] text-white/50" aria-live="polite">
      {query ? `${results.length} / ${total} 镜匹配 · ` : ""}↑ ↓ 选镜，Enter 定位
    </p>
    {query && !results.length ? <p role="status" className="py-3 text-xs text-white/65">没有匹配分镜，试试镜号或对白关键词。</p> : null}
  </div>;
}
