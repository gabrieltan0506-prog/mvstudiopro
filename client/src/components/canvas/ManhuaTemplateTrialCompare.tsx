/**
 * 模板免费试写 · 两版并排对比卡。
 *
 * 为什么独立成组件：OmniCanvas 已经超长，对比 UI 只关心「结果怎么摆」，
 * 不该知道 trpc / 限流 / 扩写链路——那些留在 OmniCanvas 里，本组件纯展示。
 * 红线：这里只吃服务端下发的匿名精简稿（logline/节拍点/开场钩子 + 匿名回执），
 * 不 import 任何服务端模块，也不出现模型名/供应商名。
 */

export type ManhuaWriterTrialDraft = {
  logline: string;
  beats: string[];
  openingHook: string;
};

export type ManhuaWriterTrialResult = {
  withTemplate: ManhuaWriterTrialDraft;
  control: ManhuaWriterTrialDraft;
  appliedTemplate: { publicId: string; nameZh: string };
  trialsLeftToday: number;
};

function TrialDraftCard(props: {
  titleZh: string;
  accent: "template" | "control";
  draft: ManhuaWriterTrialDraft;
}) {
  const isTemplate = props.accent === "template";
  return (
    <div
      className={`flex-1 min-w-[240px] rounded-xl border p-3 ${
        isTemplate
          ? "border-amber-300/30 bg-amber-400/[0.06]"
          : "border-white/12 bg-black/30"
      }`}
    >
      <div
        className={`text-[11px] font-semibold ${
          isTemplate ? "text-amber-100" : "text-white/60"
        }`}
      >
        {props.titleZh}
      </div>
      <div className="mt-2 text-[11px] text-white/45">单集梗概</div>
      <p className="mt-0.5 text-xs leading-5 text-white/90">{props.draft.logline}</p>
      <div className="mt-2 text-[11px] text-white/45">节拍点</div>
      {/* 节拍点逐条列：两版差异要一眼可辨，禁止揉成一段 */}
      <ol className="mt-0.5 space-y-1">
        {props.draft.beats.map((beat, i) => (
          <li key={`${i}-${beat.slice(0, 8)}`} className="flex gap-1.5 text-xs leading-5 text-white/85">
            <span className={isTemplate ? "text-amber-200/80" : "text-white/40"}>{i + 1}.</span>
            <span>{beat}</span>
          </li>
        ))}
      </ol>
      <div className="mt-2 text-[11px] text-white/45">开场钩子</div>
      <p className="mt-0.5 text-xs leading-5 text-white/90">{props.draft.openingHook}</p>
    </div>
  );
}

export default function ManhuaTemplateTrialCompare(props: {
  result: ManhuaWriterTrialResult;
  /** 「套用到全集」正在走现有付费扩写链路时置真，防连点 */
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const { result } = props;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="模板试写对比"
    >
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-[#101418] p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">
              免费试写对比 · {result.appliedTemplate.nameZh}
            </div>
            <div className="mt-0.5 text-[11px] text-white/45">
              同一题材各写一版第 1 集大纲；左边套了剧情增强方案，右边没套。今日还可试写{" "}
              {Math.max(0, result.trialsLeftToday)} 次。
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
        <div className="mt-3 flex flex-wrap gap-3">
          <TrialDraftCard titleZh="套用模板" accent="template" draft={result.withTemplate} />
          <TrialDraftCard titleZh="常规对照" accent="control" draft={result.control} />
        </div>
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
            disabled={props.applying}
            className="rounded-xl border border-emerald-300/35 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {props.applying ? "正在套用…" : "满意，套用到全集 →"}
          </button>
        </div>
        <p className="mt-2 text-right text-[10px] text-white/35">
          套用到全集会按现有扩写档位与集数计费；试写本身免费。
        </p>
      </div>
    </div>
  );
}
