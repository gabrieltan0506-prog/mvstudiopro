import React, { useEffect, useState } from "react";
import { type RemixDraft } from "@shared/remixDraft";
import { readRemixProductionHandoff } from "@/lib/remixProductionHandoff";

export default function RemixProductionImport({
  userId,
  format,
  disabled,
  onApply,
}: {
  userId?: number;
  format: RemixDraft["format"];
  disabled: boolean;
  onApply: (draft: RemixDraft, unitIndex: number) => boolean;
}) {
  const [draft, setDraft] = useState<RemixDraft | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setDraft(null);
    setIndex(0);
    setError("");
    if (
      !userId ||
      new URLSearchParams(window.location.search).get("from") !== "remix"
    )
      return;
    try {
      const value = readRemixProductionHandoff(userId);
      if (value?.format === format) setDraft(value);
    } catch {
      setError("复刻交接稿读取失败，原记录保留；请返回复刻编辑台重新送入");
    }
  }, [userId, format]);
  if (error)
    return (
      <p role="alert" className="rounded-xl bg-amber-950 p-4 text-amber-100">
        {error}
      </p>
    );
  if (!draft) return null;
  return (
    <section
      aria-label="采用复刻稿"
      className="z-20 mx-4 mt-14 max-h-[45vh] shrink-0 overflow-auto rounded-2xl border border-orange-300/30 bg-[#161e2d] p-4 text-white"
    >
      <h2 className="font-semibold">
        来自爆款复刻：{draft.title || "未命名作品"}
      </h2>
      <p className="my-2 text-sm leading-6 text-white/70">
        {format === "video"
          ? `完整保留${draft.units.length}镜内容，采用后在编剧室选择镜头范围继续改编；本次只载入文本。`
          : `共${draft.units.length}页，请逐页选择并采用。实际出图分页以知识卡预览为准；发布正文留在复刻稿中。`}
      </p>
      {format === "note" && (
        <label className="block text-sm">
          本次制作哪一页？
          <select
            className="ml-3 rounded bg-slate-800 p-2"
            value={index}
            disabled={disabled}
            onChange={e => setIndex(Number(e.target.value))}
          >
            {draft.units.map((r, i) => (
              <option key={r.id} value={i}>
                第{i + 1}页
              </option>
            ))}
          </select>
        </label>
      )}
      <details className="my-3">
        <summary className="cursor-pointer text-sm">查看待采用内容</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">
          {format === "note"
            ? draft.units[index]?.content
            : draft.units
                .map((r, i) => `镜头${i + 1}\n${r.content}`)
                .join("\n\n")}
        </pre>
      </details>
      <button
        disabled={disabled}
        className="rounded-xl bg-orange-200 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
        onClick={() => {
          try {
            if (onApply(draft, index)) setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "采用失败，原稿保留");
          }
        }}
      >
        采用{format === "note" ? "这一页" : "到编剧室"}，不自动生成
      </button>
      <button
        className="ml-3 text-sm text-white/65"
        onClick={() => setDraft(null)}
      >
        暂不采用
      </button>
      {disabled && (
        <p className="mt-2 text-xs">当前任务进行中，结束后可采用。</p>
      )}
    </section>
  );
}
