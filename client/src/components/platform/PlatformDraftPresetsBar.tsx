import React from "react";
import { BookmarkPlus, History, RotateCcw } from "lucide-react";
import type { PlatformConfigPreset, PlatformRecentTask } from "@/lib/platformWorkbenchMode";

type Props = {
  presets: PlatformConfigPreset[];
  recent: PlatformRecentTask[];
  onSavePreset: () => void;
  onApplyPreset: (preset: PlatformConfigPreset) => void;
  onRestoreDraft?: () => void;
  hasDraft?: boolean;
  draftSavedAt?: string | null;
  className?: string;
};

export function PlatformDraftPresetsBar({
  presets,
  recent,
  onSavePreset,
  onApplyPreset,
  onRestoreDraft,
  hasDraft,
  draftSavedAt,
  className = "",
}: Props) {
  return (
    <div
      className={`rounded-xl border border-white/8 bg-black/25 px-3 py-2.5 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSavePreset}
          className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-[#c9c0e6] hover:bg-white/10"
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
          存为预设
        </button>
        {hasDraft && onRestoreDraft ? (
          <button
            type="button"
            onClick={onRestoreDraft}
            className="inline-flex items-center gap-1 rounded-lg border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.08)] px-2.5 py-1.5 text-[11px] font-semibold text-[#8cefff] hover:bg-[rgba(73,230,255,0.14)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复草稿
            {draftSavedAt ? (
              <span className="text-[#c9c0e6]/45">
                {new Date(draftSavedAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {presets.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="self-center text-[10px] uppercase tracking-[0.12em] text-[#c9c0e6]/40">预设</span>
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onApplyPreset(p)}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-[#e8e2f8] hover:border-[#7d73ff]/40"
            >
              {p.name}
            </button>
          ))}
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <History className="h-3 w-3 text-[#c9c0e6]/40" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#c9c0e6]/40">最近</span>
          {recent.slice(0, 5).map((t) => (
            <span
              key={t.id}
              className="rounded-full border border-white/8 bg-black/30 px-2 py-0.5 text-[10px] text-[#c9c0e6]/65"
              title={t.at}
            >
              {t.label}
              {t.credits != null ? ` · ${t.credits}点` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
