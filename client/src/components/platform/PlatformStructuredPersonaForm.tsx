import React from "react";
import { Target } from "lucide-react";
import type { PlatformStructuredPersona } from "@/lib/platformWorkbenchMode";

type Props = {
  value: PlatformStructuredPersona;
  onChange: (next: PlatformStructuredPersona) => void;
  freeform: string;
  onFreeformChange: (value: string) => void;
  voiceSlot?: React.ReactNode;
  onIpGeneFill?: () => void;
  ipReady?: boolean;
  errors?: Partial<Record<keyof PlatformStructuredPersona | "freeform", string>>;
  id?: string;
};

/**
 * 一个输入框搞定人物背景。
 *
 * 原先拆成身份/领域/受众/商业目标四个输入框 + 一个完整描述，五个框摆在一起，
 * 用户反而不知道从哪下手（用户 2026-08-06：不要这么多栏位，保留一个即可）。
 * 现在只留一个框，四件要写的事降级成可点的引导标签——点一下就把小标题插进去。
 */
const HINTS: Array<{ key: keyof PlatformStructuredPersona; label: string; example: string }> = [
  { key: "identity", label: "身份", example: "医学背景创作者" },
  { key: "domain", label: "赛道", example: "慢病科普" },
  { key: "audience", label: "受众", example: "25–45 岁关注养生的职场人" },
  { key: "businessGoal", label: "商业目标", example: "虚拟资料店稳定转化" },
];

const EXAMPLE_TEXT = HINTS.map((h) => `${h.label}：${h.example}`).join("；");

export function PlatformStructuredPersonaForm({
  freeform,
  onFreeformChange,
  voiceSlot,
  onIpGeneFill,
  ipReady,
  errors,
  id = "platform-persona-focus",
}: Props) {
  const insertHint = (label: string) => {
    const current = freeform.trimEnd();
    if (current.includes(`${label}：`)) return;
    const next = current ? `${current}${current.endsWith("；") ? "" : "；"}${label}：` : `${label}：`;
    onFreeformChange(next);
    const el = document.getElementById(`${id}-textarea`) as HTMLTextAreaElement | null;
    if (el) {
      el.focus();
      window.requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = el.value.length;
      });
    }
  };

  return (
    <div
      id={id}
      className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] px-4 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-bold text-white md:text-lg">
          <Target className="h-5 w-5 shrink-0 text-[#49e6ff]" aria-hidden />
          人物背景
        </div>
        {onIpGeneFill ? (
          <button
            type="button"
            onClick={onIpGeneFill}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
              ipReady
                ? "border-[#6366F1]/40 bg-[rgba(99,102,241,0.12)] text-[#c4b5fd]"
                : "border-[#FCD34D]/35 bg-[rgba(252,211,77,0.08)] text-[#fde68a]"
            }`}
          >
            {ipReady ? "用企业 IP 基因快填" : "载入企业 IP 基因"}
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-[#c9c0e6]/60">
        一段话写清你是谁、做什么赛道、写给谁看、想赚什么钱。趋势分析与选题共用这段背景。
      </p>

      <div className="relative mt-3">
        <textarea
          id={`${id}-textarea`}
          value={freeform}
          onChange={(e) => onFreeformChange(e.target.value)}
          placeholder={EXAMPLE_TEXT}
          rows={4}
          className={`min-h-[120px] w-full rounded-xl border bg-[#0c061e] px-3.5 py-3 pr-12 text-[14px] leading-relaxed text-white outline-none transition placeholder:text-[#6f6791] focus:border-[#49e6ff]/45 ${
            errors?.freeform ? "border-amber-400/50" : "border-white/12"
          }`}
        />
        {voiceSlot ? <div className="absolute right-2 top-2">{voiceSlot}</div> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-[#c9c0e6]/45">点一下补进去：</span>
        {HINTS.map((h) => {
          const filled = freeform.includes(`${h.label}：`);
          return (
            <button
              key={h.key}
              type="button"
              onClick={() => insertHint(h.label)}
              title={`例：${h.example}`}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                filled
                  ? "border-[#49e6ff]/40 bg-[rgba(73,230,255,0.12)] text-[#8cefff]"
                  : "border-white/12 text-[#c9c0e6]/70 hover:border-[#49e6ff]/35 hover:text-white"
              }`}
            >
              {h.label}
            </button>
          );
        })}
        {!freeform.trim() ? (
          <button
            type="button"
            onClick={() => onFreeformChange(EXAMPLE_TEXT)}
            className="rounded-full border border-[#fbbf24]/35 bg-[rgba(251,191,36,0.08)] px-2.5 py-1 text-[11px] font-medium text-[#fde68a] transition hover:brightness-110"
          >
            填个示例看看
          </button>
        ) : null}
      </div>

      {errors?.freeform ? (
        <p className="mt-1.5 text-[12px] text-amber-200/90">{errors.freeform}</p>
      ) : null}
    </div>
  );
}
