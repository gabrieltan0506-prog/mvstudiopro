import React from "react";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  canSelectProjectVideoReferences,
  matchesProjectVideoReference,
  projectVideoReferenceLimit,
  projectVideoReferenceUrls,
} from "@/lib/canvasProjectVideoReferences";

export function CanvasProjectVideoReferencePicker({
  block,
  refs,
  disabled,
  onToggle,
}: {
  block: CanvasBlock;
  refs: readonly ManhuaCustomAssetRef[];
  disabled: boolean;
  onToggle: (ref: ManhuaCustomAssetRef) => void;
}) {
  if (!refs.length || !canSelectProjectVideoReferences(block)) return null;
  const urls = projectVideoReferenceUrls(block);
  const max = projectVideoReferenceLimit(block);
  return (
    <details className="shrink-0 rounded-lg border border-white/15 bg-black/20 p-1.5">
      <summary className="cursor-pointer text-[10px] text-white/85">
        已有资产 · 已选 {urls.length}/{max}
      </summary>
      <p className="my-1 text-[10px] text-white/50">
        按点击顺序作为参考图；不生成、不改剧本认领。
      </p>
      {urls.length > max ? (
        <p className="text-[10px] text-amber-200">
          超过当前上限，请取消部分参考。
        </p>
      ) : null}
      <div className="max-h-64 space-y-1 overflow-auto">
        {refs.map(ref => {
          const position = urls.findIndex(url =>
            matchesProjectVideoReference(url, ref)
          );
          const selected = position >= 0;
          const unavailable =
            ref.reviewStatus === "needs_review" ||
            ref.role === "unset" ||
            !/^https:\/\//i.test(ref.url);
          const label = ref.labelZh || "未命名资产";
          return (
            <button
              key={ref.id}
              type="button"
              aria-pressed={selected}
              aria-label={`${selected ? "移除" : "引用"}资产 ${label}`}
              disabled={
                disabled || (!selected && (unavailable || urls.length >= max))
              }
              onClick={event => {
                event.stopPropagation();
                onToggle(ref);
              }}
              className={`flex w-full items-center gap-1 rounded border p-1 text-left text-[10px] disabled:opacity-40 ${selected ? "border-cyan-300/60 text-cyan-100" : "border-white/10 text-white/70"}`}
            >
              <img
                src={ref.url}
                alt=""
                className="h-9 w-9 shrink-0 rounded object-contain"
              />
              <span className="min-w-0 break-words">
                {selected ? `参考图 ${position + 1} · ` : ""}
                {label}
                {unavailable ? " · 待确认" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}
