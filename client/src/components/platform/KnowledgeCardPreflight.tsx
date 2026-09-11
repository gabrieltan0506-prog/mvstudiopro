/**
 * 出图前确认（0911 用户令：出图之前先弹窗，显示版式、完整版或精华版、模板类型，确认无误再生成）。
 * 以前这里是一句 window.confirm，只报页数和积分——版式选错、成稿档选错，要等 20 多张图出完才发现。
 * 纯展示 + 两个按钮；页数、积分、各项文案都由父级算好传进来，本组件不猜。
 */
export type KnowledgeCardPreflightSummary = {
  /** 完整版 / 精华版 */
  levelZh: string;
  /** 主体版式，如「主体居中」 */
  layoutZh: string;
  /** 图文模板类型；没选时父级传「未选（按正文自动）」 */
  templateZh: string;
  /** 读档档位，如「读档·DeepSeek V4.1 Flash」 */
  distillModelZh: string;
  pageCount: number;
  qualityZh: string;
  credits: number;
};

export function KnowledgeCardPreflight({
  summary,
  onConfirm,
  onCancel,
}: {
  summary: KnowledgeCardPreflightSummary | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!summary) return null;
  const rows: Array<{ k: string; v: string; accent?: boolean }> = [
    { k: "成稿档", v: summary.levelZh, accent: true },
    { k: "版式", v: summary.layoutZh, accent: true },
    { k: "模板类型", v: summary.templateZh, accent: true },
    { k: "读档档位", v: summary.distillModelZh },
    { k: "页数", v: `${summary.pageCount} 页` },
    { k: "画质", v: summary.qualityZh },
  ];
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="出图前确认"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[#161226] p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-white">确认无误再出图</h3>
        <p className="mt-1 text-xs text-[#c9c0e6]/60">选错版式或成稿档，要等整套图出完才看得出来，先核一遍。</p>
        <dl className="mt-4 space-y-2">
          {rows.map((row) => (
            <div key={row.k} className="flex items-baseline justify-between gap-4 border-b border-white/6 pb-2 last:border-0">
              <dt className="shrink-0 text-xs text-[#c9c0e6]/55">{row.k}</dt>
              <dd className={`text-right text-sm ${row.accent ? "font-semibold text-white" : "text-[#c9c0e6]/90"}`}>
                {row.v}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-[11px] leading-5 text-amber-100/85">
          约 <span className="font-semibold tabular-nums">{summary.credits}</span> 积分，逐页扣费。
          出图途中可以点「终止」：已出的页保留并计费，未出的页不扣。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm text-[#c9c0e6]/85 transition hover:border-white/30 hover:text-white"
          >
            返回修改
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="rounded-xl bg-[#ff4fb8] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            确认出图
          </button>
        </div>
      </div>
    </div>
  );
}
