import React from "react";
import { PLATFORM_CREATE_STEPS, type PlatformCreateStepId } from "@/lib/platformWorkbenchMode";

type Props = {
  activeStep: PlatformCreateStepId;
  onStepChange: (step: PlatformCreateStepId) => void;
  doneSteps?: Set<PlatformCreateStepId>;
  className?: string;
  /** 移动端横向 / 桌面纵向 */
  orientation?: "vertical" | "horizontal";
};

export function PlatformCreateStepRail({
  activeStep,
  onStepChange,
  doneSteps,
  className = "",
  orientation = "vertical",
}: Props) {
  const isHorizontal = orientation === "horizontal";
  return (
    <nav
      aria-label="内容创作步骤"
      className={`${
        isHorizontal
          ? "flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex flex-col gap-1.5"
      } ${className}`}
    >
      {PLATFORM_CREATE_STEPS.map((step, index) => {
        const active = activeStep === step.id;
        const done = doneSteps?.has(step.id);
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onStepChange(step.id)}
            className={`shrink-0 rounded-xl border px-3 py-2.5 text-left transition ${
              isHorizontal ? "min-w-[7.5rem]" : "w-full"
            } ${
              active
                ? "border-[#ff4fb8]/45 bg-[rgba(255,79,184,0.12)] text-white"
                : done
                  ? "border-[#34d399]/25 bg-[rgba(52,211,153,0.06)] text-[#c9c0e6]"
                  : "border-white/8 bg-black/25 text-[#c9c0e6]/70 hover:border-white/15 hover:text-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  active
                    ? "bg-[#ff4fb8]/30 text-[#ff9fe0]"
                    : done
                      ? "bg-[#34d399]/20 text-[#6ee7b7]"
                      : "bg-white/8 text-[#c9c0e6]/60"
                }`}
              >
                {index + 1}
              </span>
              <span className="text-[13px] font-semibold">{step.label}</span>
            </div>
            {!isHorizontal ? (
              <p className="mt-1 pl-8 text-[11px] leading-snug text-[#c9c0e6]/45">{step.hint}</p>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
