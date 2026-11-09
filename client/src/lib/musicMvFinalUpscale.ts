/**
 * MV 第 6 步成片旁的 2K / 4K 超分。
 *
 * 不新造计费：报价用 `canvasVideoUpscaleCredits`（与画布、首页、数字人同一函数），提交走
 * `/api/jobs?op=videoUpscale`（服务端实测时长、同源同档幂等扣费、失败退分）。本文件只放纯判据。
 */
import type { CanvasMusicMvFinalUpscale } from "@shared/canvasMusicMv";
import { canvasVideoUpscaleCredits } from "@shared/canvasGenerationPricing";
import { canWavespeedUpscale } from "@shared/wavespeedVideoUpscaleModels";

export type MvUpscaleTarget = "2k" | "4k";
export const MV_FINAL_UPSCALE_TARGETS: readonly MvUpscaleTarget[] = ["2k", "4k"];

const PENDING = new Set<CanvasMusicMvFinalUpscale["status"]>([
  "submitting",
  "queued",
  "running",
  "timed_out_pending_reconcile",
]);

/** 仍需轮询的记录：有任务号且未到终态。 */
export function mvFinalUpscaleNeedsPoll(r: CanvasMusicMvFinalUpscale): boolean {
  return Boolean(r.taskId) && PENDING.has(r.status) && r.status !== "submitting";
}

/** 服务端幂等键作用域：同一 MV 块、同一成片、同一档位只会有一个任务。 */
export function mvFinalUpscaleScopeKey(mvBlockId: string, finalBlockId: string, target: MvUpscaleTarget): string {
  return `music-mv:${mvBlockId}:${finalBlockId}:${target}`;
}

/**
 * 能否为这条成片提交该档位；返回拦截原因（null = 可提交）。
 * 失败（已退分）允许重开；提交结果未确认时允许再点——服务端同源同档幂等，不会二次扣费。
 */
export function mvFinalUpscaleBlocker(
  records: readonly CanvasMusicMvFinalUpscale[] | undefined,
  finalBlockId: string,
  target: MvUpscaleTarget
): string | null {
  const same = (records || []).filter(r => r.finalBlockId === finalBlockId && r.target === target);
  if (same.some(r => r.status === "succeeded")) return `已有 ${target.toUpperCase()} 超分版本`;
  if (same.some(r => PENDING.has(r.status))) return `${target.toUpperCase()} 超分进行中`;
  if (same.some(r => r.status === "reconcile_manual")) return "上次超分正在人工核对，不会白扣积分";
  return null;
}

/** 成片实测规格能否升到该档（480p 最高 2K；已是 2K 及以上不再升）。 */
export function mvFinalUpscaleSupported(sourceResolution: string | null | undefined, target: MvUpscaleTarget): boolean {
  return canWavespeedUpscale(sourceResolution, target);
}

export function mvFinalUpscaleQuote(target: MvUpscaleTarget, durationSec: number): number {
  return canvasVideoUpscaleCredits(target, durationSec);
}

/** 点击前确认文案：实测规格 + 预估积分；不出现任何引擎或供应商名。 */
export function mvFinalUpscaleConfirmText(input: {
  target: MvUpscaleTarget;
  width: number;
  height: number;
  durationSec: number;
  credits: number;
}): string {
  return `成片实测 ${input.width}×${input.height}，${input.durationSec} 秒。\n${input.target.toUpperCase()} 超分预估 ${input.credits} 积分（按服务端实测时长扣费，失败自动退回）。\n结果作为新版本放在成片旁，原成片保留。确认提交？`;
}

export function mvFinalUpscaleStatusText(r: CanvasMusicMvFinalUpscale): string {
  switch (r.status) {
    case "submitting":
      return "提交中";
    case "submission_unknown":
      return "提交结果未确认，可再次点击确认（不会重复扣费）";
    case "queued":
      return "排队中";
    case "running":
      return "处理中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败（积分已退回）";
    case "timed_out_pending_reconcile":
      return "超时对账中（不会白扣，稍后自动恢复）";
    case "reconcile_manual":
      return "对账异常，请联系客服（不会白扣）";
  }
}

export function mvFinalUpscaleVersionBlockId(finalBlockId: string, record: Pick<CanvasMusicMvFinalUpscale, "id" | "target">): string {
  return `${finalBlockId}-up${record.target}-${record.id.slice(0, 8)}`;
}

/** 成功且尚未挂版本块的记录（挂块只做一次）。 */
export function mvFinalUpscaleNeedsVersionBlock(r: CanvasMusicMvFinalUpscale): boolean {
  return r.status === "succeeded" && Boolean(r.videoUrl) && !r.versionBlockId;
}

export function mvFinalUpscaleDownloadName(title: string | undefined, target: MvUpscaleTarget): string {
  const base = String(title || "MV成片").replace(/[\\/:*?"<>|]+/g, "-").replace(/^-+|-+$/g, "").trim().slice(0, 60) || "MV成片";
  return `${base}-${target.toUpperCase()}.mp4`;
}
