import {KNOWLEDGE_INTERIOR_PRICE_COPY} from "@shared/knowledgePublicationPricing";
/**
 * 出图前确认（0911 用户令：出图之前先弹窗，显示版式、完整版或精华版、模板类型，确认无误再生成）。
 * 以前这里是一句 window.confirm，只报页数和积分——版式选错、成稿档选错，要等二十多张图出完才发现。
 *
 * 复审 P1 的教训：`aria-modal` 只是告诉读屏器，**不锁焦点也不锁底层控件**。
 * 实测 Shift+Tab 能走出弹窗改正文，点「确认出图」发出去的还是旧闭包里的稿子——
 * 用户看到新稿、付费请求用旧稿。所以这里改用项目自带的 Radix Dialog：
 * 它带焦点约束、Escape 关闭、关闭后焦点归位；底层控件的锁由父级的 pending 状态负责。
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  /** 计划文字页数（1119 C2）；null＝排版时核算 */
  textPageCount?: number | null;
  /** 只出卡片：不成册、不排版 */
  cardsOnly?: boolean;
  /** 配图档名（普通用户可见，不含模型名） */
  imageTierZh?: string;
  /** 精确模型名：只在 debug 模式显示 */
  imageModelDebug?: string;
  pageContents?: string[];
  qualityZh: string;
  credits: number;
  advisorCredits?: number;
};

/** 读档标签去掉模型名：「标准 · DeepSeek V4.1 Flash 1017」→「标准」；历史模型 id 不外露。 */
export function knowledgeCardPublicTierLabel(label: string): string {
  const raw = String(label || "").trim();
  if (!raw || raw.startsWith("未记录")) return "未记录";
  if (raw.startsWith("原读档模型")) return "历史档位（按原价）";
  return raw.split(" · ")[0]!.trim();
}

export function KnowledgeCardPreflight({
  summary,
  onConfirm,
  onCancel,
  debug = false,
}: {
  summary: KnowledgeCardPreflightSummary | null;
  /** 父级 debug 开关（仅监管账号可开）；关闭时绝不显示模型/供应商名 */
  debug?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const rows: Array<{ k: string; v: string; accent?: boolean }> = summary
    ? [
        { k: "成稿档", v: summary.levelZh, accent: true },
        { k: "版式", v: summary.layoutZh, accent: true },
        { k: "模板类型", v: summary.templateZh, accent: true },
        // 普通用户只见档名（「标准 · DeepSeek …」只留「标准」）；debug 才显示完整读档模型
        debug ? { k: "读档模型", v: summary.distillModelZh } : { k: "读档档位", v: knowledgeCardPublicTierLabel(summary.distillModelZh) },
        { k: "图片页数", v: `${summary.pageCount} 张`, accent: true },
        {
          k: "文字页数",
          v: summary.cardsOnly ? "不排版（只出卡片）" : summary.textPageCount == null ? "排版时核算" : summary.textPageCount === 0 ? "0 页（图文同页）" : `约 ${summary.textPageCount} 页`,
          accent: true,
        },
        ...(summary.cardsOnly
          ? [{ k: "交付", v: "只出卡片：逐页出图、按原序汇集，可导出纯图 PDF" }]
          : [{ k: "同步准备", v: "顾问边出图边读图排版；完成后仍需核对确认，再导出 PDF" }]),
        { k: "画质", v: summary.imageTierZh ? `${summary.qualityZh} · ${summary.imageTierZh}` : summary.qualityZh },
        ...(debug && summary.imageModelDebug ? [{ k: "出图模型（Debug）", v: summary.imageModelDebug }] : []),
        ...(summary.cardsOnly ? [] : [{ k: "顾问整理与排版", v: "包含在内文页费中，不另收费" }]),
      ]
    : [];
  return (
    <Dialog
      open={Boolean(summary)}
      onOpenChange={(next) => {
        // Escape / 点遮罩 / 右上角关闭，一律等同「返回修改」——绝不能静默丢掉等待中的 resolver
        if (!next) onCancel();
      }}
    >
      <DialogContent
        aria-label="出图前确认"
        className="max-w-md border-white/12 bg-[#161226]"
      >
        <DialogHeader>
          <DialogTitle className="text-base text-white">确认图文生成</DialogTitle>
          <DialogDescription className="text-xs text-[#c9c0e6]/60">
            选错版式或成稿档，要等整套图出完才看得出来，先核一遍。
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.k}
              className="flex items-baseline justify-between gap-4 border-b border-white/6 pb-2 last:border-0"
            >
              <dt className="shrink-0 text-xs text-[#c9c0e6]/55">{row.k}</dt>
              <dd className={`text-right text-sm ${row.accent ? "font-semibold text-white" : "text-[#c9c0e6]/90"}`}>
                {row.v}
              </dd>
            </div>
          ))}
        </dl>
        {summary?.pageContents&&<details className="text-sm"><summary>查看本次实际图片内容与说明（{summary.pageContents.length} 张）</summary><div className="max-h-64 overflow-auto">{summary.pageContents.map((text,i)=><article key={i} className="my-3"><strong>第 {i+1} 张</strong><pre className="whitespace-pre-wrap text-xs">{text}</pre></article>)}</div></details>}
        {summary ? (
          <p className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-[11px] leading-5 text-amber-100/85">
            配图 <span className="font-semibold tabular-nums">{summary.credits}</span> 积分，逐页扣费。
            {KNOWLEDGE_INTERIOR_PRICE_COPY} 确认生成即同意按上述费率自动结算。
            出图途中可以点「终止」：已出的页保留并计费，未出的页不扣。
          </p>
        ) : null}
        <DialogFooter>
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
            className="rounded-xl bg-[#ff4fb8] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            确认出图
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
