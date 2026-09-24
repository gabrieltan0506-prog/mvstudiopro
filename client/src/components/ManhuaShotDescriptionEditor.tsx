import React, { useState } from "react";

export function ManhuaShotDescriptionEditor({ shotIndex, description, disabled, onApply }: {
  shotIndex: number;
  description: string;
  disabled?: boolean;
  onApply: (shotIndex: number, description: string) => void;
}) {
  const [value, setValue] = useState(description);
  const [error, setError] = useState("");
  const trimmed = value.trim();
  return <div data-manhua-shot-description className="mt-3">
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={`manhua-shot-description-${shotIndex}`} className="text-xs text-white/70">画面描述 · 可直接修改</label>
      <span className={`text-xs tabular-nums ${value.length > 200 ? "text-rose-200" : "text-white/45"}`}>{value.length}/200</span>
    </div>
    <textarea
      id={`manhua-shot-description-${shotIndex}`}
      data-manhua-shot-description-input={shotIndex}
      value={value}
      maxLength={200}
      rows={3}
      disabled={disabled}
      onChange={event => { setValue(event.target.value); setError(""); }}
      className="mt-1 block w-full resize-y rounded-lg border border-white/25 bg-black/20 p-3 text-sm leading-6 text-white outline-none focus:border-cyan-300 disabled:opacity-50"
    />
    {error && <p role="alert" className="mt-1 text-xs text-rose-200">{error}</p>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled || !trimmed || value.length > 200 || trimmed === description.trim()}
        className="min-h-10 rounded-lg border border-cyan-300/40 px-3 text-xs text-cyan-50 disabled:opacity-40"
        onClick={() => {
          if (!trimmed) { setError("画面描述不能为空，原稿未修改。"); return; }
          try { onApply(shotIndex, trimmed); setError(""); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，原稿仍保留。"); }
        }}>保存本镜描述</button>
      <span className="text-xs text-white/45">旧图保留；再次出图前请核对当前镜。</span>
    </div>
  </div>;
}
