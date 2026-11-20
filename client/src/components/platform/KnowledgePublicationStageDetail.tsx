import { useEffect, useRef, useState } from "react";
import { knowledgeStageProgress, type KnowledgePublicationStage } from "@/lib/knowledgePublicationStage";

/** 排版阶段的小字说明：第几步、本步计数、本步已用时；首批完成前说明已派出在等结果，不让 0 看起来像没在动。 */
export function KnowledgePublicationStageDetail({ stage, error }: { stage: KnowledgePublicationStage | null; error?: string | null }) {
  const progress = knowledgeStageProgress(stage);
  const since = useRef<{ step: number; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const step = progress && !progress.finished ? progress.stepNumber : -1;
  if (step >= 0 && since.current?.step !== step) since.current = { step, at: Date.now() };
  if (step < 0) since.current = null;
  useEffect(() => {
    if (step < 0 || error) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step, error]);
  if (!progress) return null;
  if (progress.finished) return <p className="text-xs text-emerald-300" aria-label="排版阶段说明">排版成册 · 四步全部完成</p>;
  const seconds = Math.max(0, Math.floor((now - (since.current?.at ?? now)) / 1000));
  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  // 第 3 步（整册排版）按组计数：每组最多 4 章，各组并行。
  const layoutStep = progress.stepNumber === 3;
  const count = progress.stepCount ? ` ${progress.stepDone}/${progress.stepCount}${layoutStep ? " 组" : ""}` : "";
  return (
    <p className="text-xs text-white/70" aria-label="排版阶段说明">
      排版成册 · 第 {progress.stepNumber}/{progress.stepTotal} 步 · {progress.stepName}{count} · 排版进度 {progress.percent}%
      {error ? null : <> · 本步已用时 {elapsed}</>}
      {!error && progress.stepCount && !progress.stepDone ? (layoutStep ? " · 各组已同时派出，等待首组完成" : " · 已派出，等待首批完成（大书每页需要几分钟）") : null}
    </p>
  );
}
