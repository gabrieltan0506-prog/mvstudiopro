import React, { useMemo } from "react";
import { partitionTopicCoverPipelineFlowLog } from "@/lib/topicCoverPipelineDebugPartitions";

export type PlatformTopicCoverDrProGpt54DebugPanelProps = {
  lines: string[];
  pollLabel?: string;
  jobRunning?: boolean;
};

/**
 * Platform 选题封面 / 2×4：**DR-Pro（0.5）→ 英文化 → 生图** 全链路除错。
 * 依赖 `imageGenFlowLog` 与服务端 `[管线·阶段顺序]` 分界行。
 */
export default function PlatformTopicCoverDrProGpt54DebugPanel({
  lines,
  pollLabel,
  jobRunning,
}: PlatformTopicCoverDrProGpt54DebugPanelProps) {
  const { drProLines, gpt54AndTranslationLines, imageGenLines, otherLines, hints } = useMemo(
    () => partitionTopicCoverPipelineFlowLog(lines),
    [lines],
  );

  const drBadge = useMemo(() => {
    const joinedDr = drProLines.join("\n");
    if (!hints.phaseOrderLine && drProLines.length === 0 && !jobRunning) {
      return { text: "无 0.5 日志", tone: "text-gray-500" as const };
    }
    if (hints.drProBriefMerged) return { text: "DR-Pro：简报已合并", tone: "text-emerald-300" as const };
    if (hints.drProApiActivity && jobRunning) return { text: "DR-Pro：进行中", tone: "text-amber-200" as const };
    if (hints.drProApiActivity && hints.drProSkippedOrEmpty)
      return { text: "DR-Pro：已请求但未采用简报", tone: "text-amber-200" as const };
    if (hints.drProApiActivity) return { text: "DR-Pro：已触发 API", tone: "text-sky-300" as const };
    if (
      (/管理员入参=开启/.test(joinedDr) ||
        /\[步骤0\.5·DR-Pro\][^\n]*开启/.test(joinedDr) ||
        /\[步骤0\.5·DR-Pro·2×4\][^\n]*开启/.test(joinedDr)) &&
      /DR-Pro/.test(joinedDr)
    )
      return { text: "DR-Pro：已开关（待触发）", tone: "text-sky-300/90" as const };
    if (hints.phaseOrderLine?.includes("未启用 A/Deep Research Pro"))
      return { text: "DR-Pro：未启用", tone: "text-gray-500" as const };
    return { text: "DR-Pro：状态不明", tone: "text-gray-400" as const };
  }, [drProLines, hints, jobRunning]);

  const gptBadge = useMemo(() => {
    if (hints.step1TranslationDone)
      return { text: "B 英文化：步骤1 已完成", tone: "text-emerald-300" as const };
    if (hints.gpt54LayerActivity && jobRunning)
      return { text: "B 英文化：进行中（Vertex / GPT 等）", tone: "text-amber-200" as const };
    if (hints.gpt54LayerActivity) return { text: "B 英文化：已有日志", tone: "text-sky-300" as const };
    return { text: "B 英文化：尚无日志", tone: "text-gray-500" as const };
  }, [hints, jobRunning]);

  const imgBadge = useMemo(() => {
    if (hints.imageGenSuccess) return { text: "生图：已取得 URL", tone: "text-emerald-300" as const };
    if (hints.imageGenLayerActivity && jobRunning) return { text: "生图：进行中（GPT-IMAGE-2 / NB2 / fal）", tone: "text-amber-200" as const };
    if (hints.imageGenLayerActivity) return { text: "生图：已有子日志", tone: "text-sky-300" as const };
    if (hints.step1TranslationDone && jobRunning) return { text: "生图：等待步骤2 写入…", tone: "text-gray-400" as const };
    return { text: "生图：尚无日志", tone: "text-gray-500" as const };
  }, [hints, jobRunning]);

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-[rgba(103,32,183,0.08)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">
          选题封面 / 2×4 合成 · 全链路除错
        </div>
        {pollLabel ? (
          <div className="max-w-[60%] truncate text-[10px] text-violet-200/70" title={pollLabel}>
            {pollLabel}
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#d7d0ef]">
        共用 <code className="text-[#cda0ff]">imageGenFlowLog</code>
        ：<strong className="text-violet-200/90">A</strong> 步骤 0.5（DR-Pro）· <strong className="text-cyan-200/90">B</strong>{" "}
        英文化（GPT 5.4、Gemini、Vertex Flash 等任一）· <strong className="text-amber-200/90">C</strong>{" "}
        生图（GPT-IMAGE-2、NB2、fal、兜底）。C
        栏位可避免「翻译完以为卡住」——实际仍在绘图。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-lg border border-white/10 px-2 py-1 text-[11px] font-bold ${drBadge.tone}`}>
          {drBadge.text}
        </span>
        <span className={`rounded-lg border border-white/10 px-2 py-1 text-[11px] font-bold ${gptBadge.tone}`}>
          {gptBadge.text}
        </span>
        <span className={`rounded-lg border border-white/10 px-2 py-1 text-[11px] font-bold ${imgBadge.tone}`}>
          {imgBadge.text}
        </span>
        {jobRunning ? (
          <span className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-100">
            任务进行中…
          </span>
        ) : null}
      </div>

      {hints.phaseOrderLine ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[10px] leading-snug text-amber-100/90">
          {hints.phaseOrderLine}
        </div>
      ) : (
        <div className="mt-3 text-[10px] text-gray-500">
          （尚未收到 <code className="text-gray-400">[管线·阶段顺序]</code> /{" "}
          <code className="text-gray-400">[管线·阶段顺序·2×4]</code> 行——若后端未部署最新 worker，请以 A/B/C 区块对照）
        </div>
      )}

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <div className="min-h-[120px] rounded-xl border border-violet-400/20 bg-black/25 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-violet-300/90">
            A — Deep Research Pro（0.5）
          </div>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[#e8e0ff]">
            {drProLines.length ? drProLines.join("\n") : "（本段无行——可能未开 DR-Pro，或尚未写入日志）"}
          </pre>
        </div>
        <div className="min-h-[120px] rounded-xl border border-cyan-500/20 bg-black/25 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-200/90">
            B — 英文化（B 栏：凡翻译 / 步骤1·1b，含 Vertex·Flash、GPT54·英文化）
          </div>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[#d7f5ff]">
            {gpt54AndTranslationLines.length
              ? gpt54AndTranslationLines.join("\n")
              : "（尚无翻译层——通常 A 结束后才进入；或任务仍在 DR-Pro 轮询）"}
          </pre>
        </div>
        <div className="min-h-[120px] rounded-xl border border-amber-500/25 bg-black/25 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-200/90">
            C — 生图（GPT-IMAGE-2 / NB2 / fal / 兜底）
          </div>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[#fff3dc]">
            {imageGenLines.length
              ? imageGenLines.join("\n")
              : "（尚无生图子日志——若 B 已完成仍空，多为进度尚未 flush；稍待或展开「其余」）"}
          </pre>
        </div>
      </div>

      {otherLines.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[10px] text-gray-500 hover:text-gray-400">
            其余（企划大脑、说明行、staging 等）· {otherLines.length} 行
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 pt-2 font-mono text-[10px] leading-5 text-gray-400">
            {otherLines.join("\n")}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
