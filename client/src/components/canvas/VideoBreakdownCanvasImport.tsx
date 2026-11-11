/**
 * 画布顶部「来自拉片」采用横幅：与 RemixProductionImport 同一交接方式（/canvas?from=lapian + 按用户分键的交接稿）。
 * 采用 = 在自由画布追加方块（每段一个参考生视频方块，整片送入时另加一个配乐方块），不自动生成、不扣费。
 */
import React, { useEffect, useState } from "react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import { buildVideoBreakdownCanvasBlocks } from "@/lib/videoBreakdownCanvasBlocks";
import {
  VIDEO_BREAKDOWN_CANVAS_FROM,
  clearVideoBreakdownCanvasHandoff,
  readVideoBreakdownCanvasHandoff,
  type VideoBreakdownCanvasHandoff,
} from "@/lib/videoBreakdownCanvasHandoff";

export function videoBreakdownCanvasImportSummary(handoff: VideoBreakdownCanvasHandoff): string {
  const withClip = handoff.items.filter(item => item.clip).length;
  const remake = handoff.mode === "remake";
  const parts = [`${handoff.items.length} 个视频方块（参考生视频，按段序从左到右，提示词为各段${remake ? "换成新主体/新场景后的拍法提示词" : "复刻提示词"}）`];
  if (withClip) parts.push(`${withClip} 段附原片片段作参考视频${remake ? "（只取动作与运镜，请在方块里补上你自己的主体外观参考图）" : ""}`);
  if (withClip < handoff.items.length) parts.push(`${handoff.items.length - withClip} 段片段未裁好，只带提示词，可自行上传参考`);
  if (handoff.bgmPrompt) parts.push("1 个配乐方块（纯器乐）");
  return parts.join("；");
}

/** 采用后的下一步说明：自由画布没有自动串联整片的入口，按段序逐个生成后再拼成一支。 */
export const VIDEO_BREAKDOWN_CANVAS_NEXT_STEP = "方块已按原片段序从左到右排好：逐段核对引擎与参考后生成，全部完成后按同样顺序拼接成一支完整短视频，配乐方块生成的音乐可作整片底乐。";

export default function VideoBreakdownCanvasImport({
  userId,
  disabled,
  onApply,
}: {
  userId?: number;
  disabled: boolean;
  /** 由画布把 make(现有方块) 的结果追加进自由画布并切到自由画布。 */
  onApply: (make: (existing: readonly CanvasBlock[]) => CanvasBlock[]) => void;
}) {
  const [handoff, setHandoff] = useState<VideoBreakdownCanvasHandoff | null>(null);
  const [error, setError] = useState("");
  /** 首挂载时读一次 URL（随后会从地址栏移除，避免刷新重复弹出）。 */
  const [fromLapian] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from") === VIDEO_BREAKDOWN_CANVAS_FROM);
  useEffect(() => {
    if (!fromLapian) return;
    // 与 ?tpl= 预选同一做法：URL 参数只消费一次（交接稿在采用前仍保留在本标签页）。
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") !== VIDEO_BREAKDOWN_CANVAS_FROM) return;
    params.delete("from");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  }, [fromLapian]);
  useEffect(() => {
    setHandoff(null);
    setError("");
    if (!userId || !fromLapian) return;
    try {
      setHandoff(readVideoBreakdownCanvasHandoff(window.sessionStorage, userId));
    } catch {
      setError("拉片交接内容读取失败，请回到拉片页重新送入画布。");
    }
  }, [userId, fromLapian]);
  if (error) return <p role="alert" className="z-20 mx-4 mt-14 rounded-xl bg-amber-950 p-4 text-amber-100">{error}</p>;
  if (!handoff) return null;
  return (
    <section aria-label="采用拉片分段" data-lapian-canvas-import className="z-20 mx-4 mt-14 max-h-[45vh] shrink-0 overflow-auto rounded-2xl border border-violet-300/30 bg-[#161a2d] p-4 text-white">
      <h2 className="font-semibold">{handoff.mode === "remake" ? "用拉片拍法创作新片" : "来自拉片 · 复刻"}：{handoff.items.length === 1 ? handoff.items[0].heading : `共 ${handoff.items.length} 段`}</h2>
      {handoff.remake && <p className="mt-1 text-sm text-white/80">新主体：{handoff.remake.subject}{handoff.remake.scene ? ` · 新场景：${handoff.remake.scene}` : " · 场景沿用原片"}</p>}
      <p className="my-2 text-sm leading-6 text-white/70">采用后在自由画布新增 {videoBreakdownCanvasImportSummary(handoff)}。只放入方块，不自动生成。</p>
      {handoff.items.length > 1 && <p className="mb-2 text-xs text-white/60">{VIDEO_BREAKDOWN_CANVAS_NEXT_STEP}</p>}
      <p className="mb-2 text-xs text-white/50">片段预览链接约 1 小时内可播放；出片时会按素材地址自动续签。不同成片引擎对参考视频的用法不同，生成前请在方块里核对。</p>
      <details className="my-3">
        <summary className="cursor-pointer text-sm">查看待采用内容</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">
          {[...handoff.items.map(item => `${item.heading}（${item.rangeLabel}）\n${item.prompt}`), ...(handoff.bgmPrompt ? [`配乐提示词\n${handoff.bgmPrompt}`] : [])].join("\n\n")}
        </pre>
      </details>
      <button
        type="button"
        disabled={disabled}
        className="rounded-xl bg-violet-200 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
        onClick={() => {
          const current = handoff;
          onApply(existing => buildVideoBreakdownCanvasBlocks(current, existing));
          clearVideoBreakdownCanvasHandoff(window.sessionStorage, userId!);
          setHandoff(null);
        }}
      >
        采用到自由画布，不自动生成
      </button>
      <button type="button" className="ml-3 text-sm text-white/65" onClick={() => setHandoff(null)}>暂不采用</button>
      {disabled && <p className="mt-2 text-xs">当前任务进行中，结束后可采用。</p>}
    </section>
  );
}
