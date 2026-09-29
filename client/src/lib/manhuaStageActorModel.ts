/**
 * 3D 场景预览里的人物模型：取哪一个模型、为什么没有，以及加载失败是什么原因（0929）。
 *
 * 原因只来自两类可核对的事实，不按报错文字猜：
 *   1. 页面侧数据——人物绑定、定妆图是否可建模、模型任务状态、模型来源版本是否对应当前定妆图；
 *   2. 预览 iframe 回报的加载结果——HTTP 状态码（three 的 HttpError.response.status）、fetch 抛出的网络错误、
 *      模型解析失败或站位缺失，由 iframe 按错误类型打上 code 再回传。
 * 链接「已过期」只按签名链接自带的签发时间与有效期判断（X-Goog-Date＋X-Goog-Expires / Expires）。
 */
import { evaluateManhuaAsset3dEligibility } from "@shared/manhuaAsset3d";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import { resolveManhuaRigSource } from "@shared/manhuaRigSource";

/** 页面侧就能确定的「没有可用模型」原因 */
export type ManhuaStageModelIssueCode =
  | "unbound"
  | "blocked"
  | "not_modeled"
  | "stale_source"
  | "modeling"
  | "reconcile"
  | "model_failed"
  | "link_missing";

export type ManhuaStageModelIssue = { code: ManhuaStageModelIssueCode; detailZh?: string };

/** iframe 回报的加载失败归类 */
export type ManhuaStageLoadFailureCode =
  | "link_expired"
  | "link_denied"
  | "file_missing"
  | "http"
  | "network"
  | "invalid_model"
  | "no_position"
  | "unknown";

export type ManhuaStageReasonZh = { titleZh: string; fixZh: string };

/**
 * 白模/场景预览取模型的同一口径（与绑骨、白模一致）：锁脸图没就绪模型时用同人物候选图的模型。
 * glbUrl 与原先完全一致；多出来的 issue 只说明为什么是空的。
 */
export function resolveManhuaStageActorModel(
  assetRef: string | undefined,
  refs: readonly ManhuaCustomAssetRef[],
): { glbUrl: string; issue?: ManhuaStageModelIssue } {
  const ref = assetRef ? refs.find((r) => r.id === assetRef) : undefined;
  if (!ref) return { glbUrl: "", issue: { code: "unbound" } };
  const eligibility = evaluateManhuaAsset3dEligibility(ref);
  const model = resolveManhuaRigSource(ref, refs).source?.model ?? eligibility.currentModel3d;
  if (model?.status === "succeeded") {
    return model.glbUrl ? { glbUrl: model.glbUrl } : { glbUrl: "", issue: { code: "link_missing" } };
  }
  if (!eligibility.eligible) return { glbUrl: "", issue: { code: "blocked", ...(eligibility.reasonZh ? { detailZh: eligibility.reasonZh } : {}) } };
  // 有旧模型、但它的来源不是当前这张定妆图：换过图
  if (!model) return { glbUrl: "", issue: { code: ref.model3d ? "stale_source" : "not_modeled" } };
  switch (model.status) {
    case "queued":
    case "running":
      return { glbUrl: "", issue: { code: "modeling" } };
    case "reconcile_manual":
      return { glbUrl: "", issue: { code: "reconcile" } };
    default:
      return { glbUrl: "", issue: { code: "model_failed", ...(model.errorZh ? { detailZh: model.errorZh } : {}) } };
  }
}

export function describeManhuaStageModelIssue(issue: ManhuaStageModelIssue | undefined): ManhuaStageReasonZh {
  switch (issue?.code) {
    case "unbound":
      return { titleZh: "没有绑定人物资产", fixZh: "在「本段动作白模」的出场人物里选好这个人物。" };
    case "blocked":
      return { titleZh: issue.detailZh || "人物图还不能建模", fixZh: "先在资产区确认这张人物图，再到「3D 模型」面板建模。" };
    case "not_modeled":
      return { titleZh: "还没有 3D 模型", fixZh: "到「3D 模型」面板点「建模」，或在「更多」里上传 GLB。" };
    case "stale_source":
      return { titleZh: "定妆图换过，旧模型已不对应", fixZh: "到「3D 模型」面板为这个人物重新建模，或在「更多」里上传 GLB。" };
    case "modeling":
      return { titleZh: "模型还在生成", fixZh: "生成完成后点「重新载入」。" };
    case "reconcile":
      return { titleZh: "建模结果待核对", fixZh: "为避免重复扣费请勿重复建模，稍后回到「3D 模型」面板查看。" };
    case "model_failed":
      return { titleZh: "建模失败", fixZh: "到「3D 模型」面板点「重试建模」。" };
    case "link_missing":
      return { titleZh: "模型已建好，但还没拿到预览链接", fixZh: "刷新页面换新链接后，点「重新载入」。" };
    default:
      return { titleZh: "缺少人物模型", fixZh: "到「3D 模型」面板查看这个人物的建模状态。" };
  }
}

/** 签名链接自带的到期时刻（毫秒）；不是签名链接或参数不全返回 undefined */
export function manhuaSignedUrlExpiresAt(url: string): number | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const date = parsed.searchParams.get("X-Goog-Date");
  const expires = parsed.searchParams.get("X-Goog-Expires");
  const m = date ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date) : null;
  if (m && expires && /^\d+$/.test(expires)) {
    const issued = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    return issued + Number(expires) * 1000;
  }
  // V2 签名：Expires 为到期的 Unix 秒
  const v2 = parsed.searchParams.get("Expires");
  if (v2 && /^\d{9,11}$/.test(v2) && parsed.searchParams.has("GoogleAccessId") && parsed.searchParams.has("Signature")) return Number(v2) * 1000;
  return undefined;
}

/**
 * iframe 回报 → 归类；code 由 iframe 按错误类型打（http / network / parse / no_position / missing_url）。
 * 读取失败（HTTP 或网络）时，链接按自带有效期已经过期就判「已过期」：跨域拦截会把过期的 4xx 变成网络错误，
 * 但过期是链接参数本身决定的，不是猜。
 */
export function classifyManhuaStageLoadFailure(input: { code?: string; status?: number; glbUrl?: string; now?: number }): ManhuaStageLoadFailureCode {
  const now = input.now ?? Date.now();
  if (input.code === "no_position") return "no_position";
  if (input.code === "parse") return "invalid_model";
  const readFailed = input.code === "network" || (input.code === "http" && typeof input.status === "number");
  if (!readFailed) return "unknown";
  const expiresAt = input.glbUrl ? manhuaSignedUrlExpiresAt(input.glbUrl) : undefined;
  if (expiresAt !== undefined && now > expiresAt) return "link_expired";
  if (input.code === "network") return "network";
  if (input.status === 401 || input.status === 403) return "link_denied";
  if (input.status === 404) return "file_missing";
  return "http";
}

export function describeManhuaStageLoadFailure(code: ManhuaStageLoadFailureCode, status?: number): ManhuaStageReasonZh {
  const http = typeof status === "number" ? `（HTTP ${status}）` : "";
  const refresh = "刷新页面换新链接后，点「重新载入」。";
  switch (code) {
    case "link_expired":
      return { titleZh: `模型链接已过期${http}`, fixZh: refresh };
    case "link_denied":
      return { titleZh: `模型链接已失效${http}`, fixZh: refresh };
    case "file_missing":
      return { titleZh: `模型文件找不到${http}`, fixZh: "到「3D 模型」面板重新建模，或在「更多」里上传 GLB。" };
    case "http":
      return { titleZh: `模型文件读取失败${http}`, fixZh: "稍后点「重新载入」重试。" };
    case "network":
      return { titleZh: "网络读取失败", fixZh: "检查网络后点「重新载入」。" };
    case "invalid_model":
      return { titleZh: "模型文件无法解析", fixZh: "到「3D 模型」面板重新建模，或在「更多」里上传 GLB。" };
    case "no_position":
      return { titleZh: "站位没确认", fixZh: "在「本段动作白模」里给这个人物设好起点。" };
    default:
      return { titleZh: "模型加载失败", fixZh: "点「重新载入」重试；仍失败请到「3D 模型」面板预览这个人物。" };
  }
}
