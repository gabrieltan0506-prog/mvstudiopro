import React from "react";

export function PlatformWorkspaceStepHint(props: {
  step: number;
  title: string;
  lines: [string, string];
  active?: boolean;
  done?: boolean;
}) {
  const { step, title, lines, active, done } = props;
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 transition ${
        active
          ? "border-[#ff4fb8]/40 bg-[rgba(255,79,184,0.08)]"
          : done
            ? "border-[#6ee7b7]/25 bg-[rgba(52,211,153,0.06)]"
            : "border-white/8 bg-black/20"
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold text-white/90">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
            done ? "bg-[#6ee7b7]/20 text-[#6ee7b7]" : active ? "bg-[#ff4fb8]/25 text-[#ff9fe0]" : "bg-white/10 text-white/50"
          }`}
        >
          {step}
        </span>
        {title}
      </div>
      <p className="mt-1.5 text-[11px] leading-5 text-[#c9c0e6]/70">{lines[0]}</p>
      <p className="text-[11px] leading-5 text-[#c9c0e6]/55">{lines[1]}</p>
    </div>
  );
}
