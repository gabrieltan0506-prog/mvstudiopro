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

const FIELDS: Array<{
  key: keyof PlatformStructuredPersona;
  label: string;
  placeholder: string;
}> = [
  { key: "identity", label: "身份", placeholder: "如：医学背景创作者 / 品牌主理人" },
  { key: "domain", label: "领域", placeholder: "如：慢病科普、高客单资料包" },
  { key: "audience", label: "受众", placeholder: "如：25–45 岁关注养生的职场人" },
  { key: "businessGoal", label: "商业目标", placeholder: "如：虚拟资料店稳定转化" },
];

export function PlatformStructuredPersonaForm({
  value,
  onChange,
  freeform,
  onFreeformChange,
  voiceSlot,
  onIpGeneFill,
  ipReady,
  errors,
  id = "platform-persona-focus",
}: Props) {
  return (
    <div
      id={id}
      className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] px-4 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-bold text-white md:text-lg">
          <Target className="h-5 w-5 shrink-0 text-[#49e6ff]" aria-hidden />
          人物背景
          <span className="rounded border border-[#ff4fb8]/35 bg-[rgba(255,79,184,0.1)] px-1.5 py-0.5 text-[11px] font-medium text-[#ff9fe0]">
            内容创作
          </span>
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
        结构化填写后自动汇总到下方完整描述；趋势分析与选题初选共用此背景。
      </p>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const err = errors?.[field.key];
          return (
            <label key={field.key} className="block">
              <span className="mb-1 block text-[11px] font-semibold text-[#c9c0e6]/70">{field.label}</span>
              <input
                value={value[field.key]}
                onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                className={`w-full rounded-xl border bg-[#0c061e] px-3 py-2.5 text-[13px] text-white outline-none transition focus:border-[#49e6ff]/45 ${
                  err ? "border-amber-400/50" : "border-white/12"
                }`}
              />
              {err ? <span className="mt-1 block text-[11px] text-amber-200/90">{err}</span> : null}
            </label>
          );
        })}
      </div>

      <div className="relative mt-3">
        <label className="mb-1 block text-[11px] font-semibold text-[#c9c0e6]/70">完整描述（可语音）</label>
        <textarea
          value={freeform}
          onChange={(e) => onFreeformChange(e.target.value)}
          placeholder="也可直接写完整背景；结构化字段会尽量同步。"
          rows={3}
          className={`min-h-[96px] w-full rounded-xl border bg-[#0c061e] px-3.5 py-3 pr-12 text-[14px] leading-relaxed text-white outline-none transition focus:border-[#49e6ff]/45 ${
            errors?.freeform ? "border-amber-400/50" : "border-white/12"
          }`}
        />
        {voiceSlot ? <div className="absolute right-2 top-8">{voiceSlot}</div> : null}
      </div>
      {errors?.freeform ? (
        <p className="mt-1.5 text-[12px] text-amber-200/90">{errors.freeform}</p>
      ) : !freeform.trim() ? (
        <p className="mt-1.5 text-[12px] text-[#c9c0e6]/45">填写身份与目标后即可生成选题；空背景会禁用主按钮。</p>
      ) : null}
    </div>
  );
}
