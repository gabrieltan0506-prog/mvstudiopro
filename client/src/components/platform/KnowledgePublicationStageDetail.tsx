import { useEffect, useRef, useState } from "react";
import { knowledgeStageProgress, type KnowledgePublicationStage } from "@/lib/knowledgePublicationStage";

/** 当前排版步已用时：换步时重新计时；出错或没有进行中的步时停表。供阶段说明与总体进度条共用，保证两处数字一致。 */
export function useKnowledgeStageElapsed(stage: KnowledgePublicationStage | null, error?: string | null) {
  const base = knowledgeStageProgress(stage);
  const step = base && !base.finished ? base.stepNumber : -1;
  const since = useRef<{ step: number; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  if (step >= 0 && since.current?.step !== step) since.current = { step, at: Date.now() };
  if (step < 0) since.current = null;
  useEffect(() => {
    if (step < 0 || error) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step, error]);
  return step < 0 ? undefined : Math.max(0, now - (since.current?.at ?? now));
}

/**
 * 排版阶段说明：第几步、本步计数、本步已用时；bar=true 时在上方画出进度条（站长 2026-11-21：要进度条，不要一个不动的百分比）。
 * 有计数的步按实际完成数走；没有计数的步按已用时估算前进并标「约」，条上有流动光带表示仍在处理。
 */
export function KnowledgePublicationStageDetail({ stage, error, bar }: { stage: KnowledgePublicationStage | null; error?: string | null; bar?: boolean }) {
  const elapsedMs = useKnowledgeStageElapsed(stage, error);
  const progress = knowledgeStageProgress(stage, error ? undefined : elapsedMs);
  if (!progress) return null;
  if (progress.finished) return (
    <div className="space-y-1" aria-label="排版阶段说明">
      {bar ? <div role="progressbar" aria-label="排版成册进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={100} className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-full rounded-full bg-emerald-400" /></div> : null}
      <p className="text-xs text-emerald-300">排版成册 · 四步全部完成</p>
    </div>
  );
  const seconds = Math.floor((elapsedMs ?? 0) / 1000);
  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  // 第 3 步（整册排版）按组计数：每组最多 4 章，各组并行。
  const layoutStep = progress.stepNumber === 3;
  const exportStep = progress.stepNumber === 4; // 第 4 步（版面审查与 PDF）按段计数：每章一段。
  const count = progress.stepCount ? ` ${progress.stepDone}/${progress.stepCount}${layoutStep ? " 组" : exportStep ? " 段" : ""}` : "";
  const percentText = `${progress.estimated ? "约 " : ""}${progress.percent}%`;
  return (
    <div className="space-y-1" aria-label="排版阶段说明">
      {bar ? (
        <div role="progressbar" aria-label="排版成册进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={`${progress.stepName}${count} · ${percentText}`}
          className="relative h-2 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full transition-[width] duration-700 ease-linear ${error ? "bg-amber-400" : "bg-violet-400"}`} style={{ width: `${Math.max(2, progress.percent)}%` }} />
          {!error ? <div className="pointer-events-none absolute inset-0 animate-pulse rounded-full bg-white/10 motion-reduce:animate-none" /> : null}
        </div>
      ) : null}
      <p className="text-xs text-white/70">
        排版成册 · 第 {progress.stepNumber}/{progress.stepTotal} 步 · {progress.stepName}{count} · 排版进度 {percentText}
        {error ? null : <> · 本步已用时 {elapsed}</>}
        {!error && progress.stepCount && !progress.stepDone ? (layoutStep ? " · 各组已同时派出，等待首组完成" : " · 已派出，等待首批完成（大书每页需要几分钟）") : null}
        {!error && progress.estimated ? " · 本步没有分项计数，进度按已用时估算" : null}
      </p>
    </div>
  );
}
