/**
 * 模板免费试写 · 两版并排对比卡。
 *
 * 为什么独立成组件：OmniCanvas 已经超长，对比 UI 只关心「结果怎么摆」，
 * 不该知道 trpc / 限流 / 扩写链路——那些留在 OmniCanvas 里，本组件纯展示。
 * 红线：这里只吃服务端下发的匿名精简稿（logline/节拍点/开场钩子 + 匿名回执），
 * 不 import 任何服务端模块，也不出现模型名/供应商名。
 */

import { compareTemplateText, type TemplateTextPart } from "@/lib/manhuaTemplatePhraseDiff";

export type ManhuaWriterTrialDraft = {
  logline: string;
  beats: string[];
  openingHook: string;
};

export type ManhuaWriterTrialResult = {
  withTemplate: ManhuaWriterTrialDraft;
  control: ManhuaWriterTrialDraft;
  appliedTemplate: { publicId: string; nameZh: string };
  templateFingerprint: string;
  trialsLeftToday: number;
};

function TextParts({ parts, side }: { parts: TemplateTextPart[]; side: "before" | "after" }) {
  return <span className="whitespace-pre-wrap break-words">{parts.map((part, index) => part.changed ? (
    <mark key={index} data-manhua-template-change={side} className={side === "before"
      ? "rounded-sm bg-rose-400/25 px-0.5 text-rose-100"
      : "rounded-sm bg-emerald-400/25 px-0.5 text-emerald-100"}>{part.text}</mark>
  ) : <span key={index}>{part.text}</span>)}</span>;
}

export default function ManhuaTemplateTrialCompare(props: {
  result: ManhuaWriterTrialResult;
  /** 「套用到全集」正在走现有付费扩写链路时置真，防连点 */
  applying: boolean;
  stale?: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const { result } = props;
  const hasChanges = result.control.logline !== result.withTemplate.logline ||
    result.control.openingHook !== result.withTemplate.openingHook ||
    result.control.beats.some((beat, index) => beat !== result.withTemplate.beats[index]) ||
    result.control.beats.length !== result.withTemplate.beats.length;
  return (
    <section
      data-manhua-template-trial-compare
      className="mt-3 min-w-0 rounded-2xl border border-cyan-300/35 bg-[#101418] p-4 text-white shadow-xl"
      role="region"
      aria-label="模板试写左右对比"
      tabIndex={-1}
    >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">
              模板试写左右对比 · {result.appliedTemplate.nameZh}
            </div>
            <div className="mt-0.5 text-[11px] text-white/45">
              左边未套模板，右边套用模板。两版均为第 1 集大纲试写；当前剩余额度见试写按钮旁。
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.applying}
            className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 disabled:opacity-50"
          >
            关闭
          </button>
        </div>
        <p className="mt-3 text-xs text-white/65">以左侧同一底稿做模板改写；只标文字改动，未改内容保持原色。</p>
        <div className="mt-2 max-h-[55vh] overflow-auto rounded-xl border border-white/15" tabIndex={0} aria-label="模板试写两栏全文，可滚动查看">
          <div className="sticky top-0 z-10 grid min-w-[520px] grid-cols-2 bg-slate-900 text-xs font-semibold">
            <div className="border-r border-white/15 p-3">原稿 · 未套模板</div>
            <div className="p-3">模板改写 · {result.appliedTemplate.nameZh}</div>
          </div>
          {([
            ["单集梗概", result.control.logline, result.withTemplate.logline],
            ...Array.from({ length: Math.max(result.control.beats.length, result.withTemplate.beats.length) }, (_, i) => [
              `节拍 ${i + 1}`, result.control.beats[i] || "", result.withTemplate.beats[i] || "",
            ]),
            ["开场钩子", result.control.openingHook, result.withTemplate.openingHook],
          ] as string[][]).map(([label, before, after], index) => {
            const diff = compareTemplateText(before || "", after || "");
            return <div key={index} className="grid min-w-[520px] grid-cols-2 border-t border-white/10 text-sm leading-relaxed">
              <div className="min-w-0 border-r border-white/10 p-3"><div className="mb-1 text-[11px] text-white/45">{label}</div><TextParts parts={diff.before} side="before" /></div>
              <div className="min-w-0 p-3"><div className="mb-1 text-[11px] text-white/45">{label}</div><TextParts parts={diff.after} side="after" /></div>
            </div>;
          })}
        </div>
        {!hasChanges ? <p role="status" className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 p-2 text-xs text-amber-100">这次模板没有带来可见改动，请换模板或调整条件后重试。</p> : null}
        {props.stale ? <p role="status" className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 p-2 text-xs text-amber-100">模板方案已更新，这份对比可继续查看；请重新免费试写后再套用全集。</p> : null}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.applying}
            className="rounded-xl border border-white/15 px-3.5 py-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            不满意
          </button>
          <button
            type="button"
            onClick={props.onApply}
            disabled={props.applying || !hasChanges || props.stale}
            className="rounded-xl border border-emerald-300/35 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {props.applying ? "正在套用…" : "满意，套用到全集 →"}
          </button>
        </div>
        <p className="mt-2 text-right text-[10px] text-white/35">
          套用到全集会按现有扩写档位与集数计费；试写本身免费。
        </p>
    </section>
  );
}
