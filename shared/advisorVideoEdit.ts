import { z } from "zod";

/** 视频局部修改单次区间（与服务端报价 minSec/maxSec 一致；报价返回值优先）。 */
export const ADVISOR_VIDEO_EDIT_RANGE = { minSec: 4, maxSec: 30 } as const;

/**
 * 顾问 videoEdit：只预填「视频局部修改」面板，不提交、不扣费。
 * inspect 读取当前可编辑视频（真实 targetId 与时长）；prefill 按用户原话给区间与描述，可多轮覆盖。
 */
export const advisorVideoEditActionSchema = z
  .object({
    action: z.literal("videoEdit"),
    operation: z.enum(["inspect", "prefill"]),
    targetId: z.string().min(1).max(200).optional(),
    startSec: z.number().finite().min(0).optional(),
    endSec: z.number().finite().positive().optional(),
    /** 按用户原话整理：要改什么、哪些保持不变。 */
    promptZh: z.string().trim().min(2).max(800).optional(),
    refAssetId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type AdvisorVideoEditAction = z.infer<typeof advisorVideoEditActionSchema>;

export const ADVISOR_VIDEO_EDIT_HELP =
  "videoEdit(inspect/prefill，targetId/startSec/endSec/promptZh/refAssetId)：用户用自然语言要求改视频某一段（如「把26秒那段背景换成商店门口，人别动」）时，先inspect取得当前可编辑视频的真实targetId与时长，再prefill给区间（成片秒，一位小数，单次4–30秒，须在视频时长内）与promptZh（按用户原话整理要改什么、保持什么不变），可选refAssetId取inspect列出的参考图。prefill只打开视频局部修改面板并预填，可多轮改写；报价、确认与提交只能由用户在面板点确认，顾问不得声称已提交或已扣费。";

export type AdvisorVideoEditTarget = { id: string; label: string; url: string; durationSec: number };
export type AdvisorVideoEditRef = { id: string; label: string; url: string };
export type AdvisorVideoEditPrefill = {
  targetId: string;
  label: string;
  sourceUrl: string;
  startSec: number;
  endSec: number;
  promptZh: string;
  referenceImageUrl?: string;
  /** 给顾问与用户的中文处理说明（如已按最短秒数扩展）。 */
  noticeZh?: string;
};

const tenth = (v: number) => Math.round(v * 10) / 10;
const isTenth = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;

/** 校验顾问预填：目标须为当前可编辑视频；越界、超长拒绝并给原因；不足最短秒数按中心扩展并说明。 */
export function prepareAdvisorVideoEditPrefill(
  action: AdvisorVideoEditAction,
  targets: AdvisorVideoEditTarget[],
  refs: AdvisorVideoEditRef[] = [],
  range: { minSec: number; maxSec: number } = ADVISOR_VIDEO_EDIT_RANGE
): AdvisorVideoEditPrefill {
  if (action.operation !== "prefill") throw new Error("该操作不是视频局部修改预填");
  const { targetId, startSec, endSec, promptZh, refAssetId } = action;
  if (!targetId || startSec === undefined || endSec === undefined || !promptZh?.trim())
    throw new Error("视频局部修改缺少视频、起止秒或修改描述，请先读取可编辑视频后补全，未打开");
  const target = targets.find(t => t.id === targetId);
  if (!target) throw new Error("视频不在当前可编辑清单，请先读取可编辑视频，未打开");
  if (!isTenth(startSec) || !isTenth(endSec)) throw new Error("起止秒须为一位小数，未打开");
  const duration = tenth(target.durationSec);
  if (!(endSec > startSec)) throw new Error("结束秒须大于开始秒，未打开");
  if (startSec < 0 || endSec > duration + 1e-9)
    throw new Error(`区间 ${startSec}–${endSec} 秒超出视频时长 ${duration} 秒，请在 0–${duration} 秒内重选，未打开`);
  const len = tenth(endSec - startSec);
  if (len > range.maxSec) throw new Error(`单次局部修改最多 ${range.maxSec} 秒（本次 ${len} 秒），请拆成几段分别修改，未打开`);
  let s = startSec,
    e = endSec,
    noticeZh: string | undefined;
  if (len < range.minSec) {
    if (duration < range.minSec) throw new Error(`视频只有 ${duration} 秒，不足局部修改最短 ${range.minSec} 秒，未打开`);
    const mid = (startSec + endSec) / 2;
    s = tenth(Math.min(Math.max(0, mid - range.minSec / 2), duration - range.minSec));
    e = tenth(s + range.minSec);
    noticeZh = `所选 ${len} 秒短于最短 ${range.minSec} 秒，已扩展为 ${s}–${e} 秒，修改只落在原区间，其余画面保持不变`;
  }
  let referenceImageUrl: string | undefined;
  if (refAssetId) {
    const ref = refs.find(r => r.id === refAssetId);
    if (!ref) throw new Error("参考图不在当前素材清单，请先读取后再选，未打开");
    referenceImageUrl = ref.url;
  }
  return {
    targetId,
    label: target.label,
    sourceUrl: target.url,
    startSec: s,
    endSec: e,
    promptZh: promptZh.trim(),
    ...(referenceImageUrl ? { referenceImageUrl } : {}),
    ...(noticeZh ? { noticeZh } : {}),
  };
}

/** 报价（只读 query 出参的子集）。 */
export type VideoPartialEditQuote = { credits: number; expanded?: boolean; notice?: string; minSec?: number; maxSec?: number; confirmNotice?: string };
export type VideoPartialEditQueueInput = {
  sourceUrl: string;
  startSec: number;
  endSec: number;
  promptZh: string;
  referenceImageUrls?: string[];
  requestId: string;
  expectedCredits: number;
};

/** 确认框文案：报价积分 + 服务端确认说明 + 提交后不可取消。不含任何引擎/通道名。 */
export function videoPartialEditConfirmText(p: AdvisorVideoEditPrefill, quote: VideoPartialEditQuote): string {
  return [
    `修改「${p.label}」${p.startSec}–${p.endSec} 秒：${p.promptZh}`,
    `本次 ${quote.credits} 积分${quote.notice ? `（${quote.notice}）` : ""}。`,
    quote.confirmNotice ?? "",
    "提交后无法取消；生成失败会退回积分。确认提交？",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 只有用户在面板点确认才调用：无报价不提交；确认框取消即不提交；按报价积分提交（服务端核对 expectedCredits）。 */
export async function confirmAndQueueVideoPartialEdit(
  p: AdvisorVideoEditPrefill,
  quote: VideoPartialEditQuote | undefined,
  deps: { confirm: (text: string) => boolean; queue: (input: VideoPartialEditQueueInput) => Promise<unknown>; requestId: () => string }
): Promise<{ submitted: boolean; result?: unknown }> {
  if (!quote || !Number.isFinite(quote.credits) || quote.credits < 0) throw new Error("报价未就绪，请稍后再确认");
  if (!deps.confirm(videoPartialEditConfirmText(p, quote))) return { submitted: false };
  const result = await deps.queue({
    sourceUrl: p.sourceUrl,
    startSec: p.startSec,
    endSec: p.endSec,
    promptZh: p.promptZh,
    ...(p.referenceImageUrl ? { referenceImageUrls: [p.referenceImageUrl] } : {}),
    requestId: deps.requestId(),
    expectedCredits: quote.credits,
  });
  return { submitted: true, result };
}
