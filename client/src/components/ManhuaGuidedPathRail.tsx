/**
 * 示意 A · 引导式实测路径轨（整页地基）
 */
import { useMemo } from "react";
import {
  MANHUA_GUIDED_STEPS,
  resolveManhuaGuidedActiveStep,
  type ManhuaGuidedProgress,
  type ManhuaGuidedStepId,
} from "@shared/manhuaGuidedPath";

export type { ManhuaGuidedProgress, ManhuaGuidedStepId };

type Props = {
  progress: ManhuaGuidedProgress;
  activeStepId?: ManhuaGuidedStepId;
  onStepClick?: (stepId: ManhuaGuidedStepId, href: string) => void;
};

export default function ManhuaGuidedPathRail({ progress, activeStepId, onStepClick }: Props) {
  const activeId = activeStepId || resolveManhuaGuidedActiveStep(progress);
  const activeIndex = MANHUA_GUIDED_STEPS.findIndex((s) => s.id === activeId);

  const doneFlags = useMemo(() => {
    return {
      topic: progress.hasTopic,
      writer: progress.hasWriterPack,
      cast: progress.writerConfirmed,
      card: progress.hasCast,
      wb: progress.writerConfirmed && progress.hasCast,
      keyart: progress.hasKeyart,
      clip: progress.hasClip,
      preview: progress.hasFinalVideo,
    } satisfies Record<ManhuaGuidedStepId, boolean>;
  }, [progress]);

  return (
    <div className="sticky top-[4.25rem] z-30 -mx-1 mb-4 rounded-2xl border border-cyan-400/20 bg-[#0a121c]/92 px-3 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md md:px-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold tracking-wide text-white/90">引导路径</span>
          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
            今天可测
          </span>
        </div>
        <span className="text-[10px] text-white/40">
          当前：{MANHUA_GUIDED_STEPS[Math.max(0, activeIndex)]?.label || "题材"}
          {" · "}点步骤可跳转
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {MANHUA_GUIDED_STEPS.map((step, i) => {
          const done = doneFlags[step.id] || i < activeIndex;
          const on = step.id === activeId;
          return (
            <div key={step.id} className="flex shrink-0 items-center gap-1">
              {i > 0 ? (
                <span className={`px-0.5 text-[11px] ${done || on ? "text-cyan-400/50" : "text-white/15"}`}>
                  →
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  onStepClick?.(step.id, step.href);
                  const el = document.querySelector(step.href);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  on
                    ? "border-cyan-400/55 bg-cyan-500/25 text-cyan-50 shadow-[0_0_16px_rgba(34,211,238,0.15)]"
                    : done
                      ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100/85 hover:bg-emerald-500/18"
                      : "border-white/10 bg-white/[0.03] text-white/40 hover:border-white/20 hover:text-white/60"
                }`}
              >
                <span
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold ${
                    on
                      ? "bg-cyan-400 text-black"
                      : done
                        ? "bg-emerald-500/80 text-white"
                        : "bg-white/10 text-white/50"
                  }`}
                >
                  {i + 1}
                </span>
                {step.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
