import { knowledgeImageMayRetry } from "@shared/knowledgeImageRetry";

/**
 * 出图失败分类（D3 2026-11-19）。原「首错停领新页」是为了通道/凭证/模型授权/额度/配置错时不再成批烧钱；
 * 现只对能证明整批都会失败、或结果未知（可能已照扣）的错误停领新页，单页失败继续派发其余页。
 * - batch_fatal：鉴权/密钥/权限（401/403）、模型或档位未授权/不存在、额度与积分不足、通道未配置、页面已离开/已取消。
 * - unknown：请求已发出但无确定结果（对账/待核实）。上游可能已照扣：同样停领新页（存储写失败、上游 5xx/超时等系统性故障会让后续每页都成为
 *   「已付费、结果丢失」），本页本批只派发一次、不重买；恢复时仍由 inspectKnowledgeIllustrationRetry 拒绝重买。
 * - page：其余单页失败（审核拒绝、上游 4xx 已回落仍失败等）。
 * 先判 batch_fatal（错误正文可能同时带「已转对账」说明）；只看最终错误：剥掉服务端追加的「── log ──」尾巴与整链错误内嵌的「执行日志:」
 * （日志含已回落成功的另一通道错误与书名等页面文字，不能据此停批）。服务端追加在日志之后的「已转人工对账」说明是结果未知的权威标记，按全文判。
 */
export type KnowledgeIllustrationFailureClass = "batch_fatal" | "unknown" | "page";
const BATCH_FATAL_RE = new RegExp([
  String.raw`HTTP 40[13]\b`, String.raw`\b40[13]\b.*(?:unauthori[sz]ed|forbidden)`, String.raw`\bunauthori[sz]ed\b`, String.raw`\bforbidden\b`,
  String.raw`invalid[_ -]?api[_ -]?key`, String.raw`incorrect api key`, "api key", String.raw`\bauthentication\b`, String.raw`permission[_ -]?denied`,
  String.raw`model[_ -]?not[_ -]?found`, String.raw`does not exist`, String.raw`do(?:es)? not have access`, String.raw`not allowed`, String.raw`not[_ -]?authori[sz]ed`,
  String.raw`insufficient[_ -]?quota`, String.raw`exceeded your current quota`, String.raw`no credits remaining`, String.raw`billing`, String.raw`\bquota\b`, "PAYMENT_REQUIRED", "UNAUTHORIZED", "FORBIDDEN",
  "积分不足", "余额不足", "Credits 不足", "额度", "未授权", "无权", "未登录", "登录已失效", "密钥", "未配置", "缺失.*(?:KEY|密钥)",
  "页面已离开", "已停止本次任务", "页面已刷新或关闭", "已停止知识卡后续出图",
  String.raw`HTTP 402\b`, String.raw`insufficient[_ -]?(?:account[_ -]?)?(?:balance|credits?|funds)`,
].join("|"), "i");
const UNKNOWN_RE = /尚未确认|无法确认|待核实|结果待核|转人工对账|转对账|仍在执行|kind["']?\s*[:=]\s*["']?unknown/i;
/** routers.ts holdCompositeForReconcile 之后写在日志尾巴之后的说明（只在结果未知、未退款时出现）。 */
const RECONCILE_NOTE_RE = /出图结果无法确认，供应商可能已建单/;
export function classifyKnowledgeIllustrationFailure(error: unknown): KnowledgeIllustrationFailureClass {
  const e = error as { name?: string; kind?: string; message?: string; code?: string; shape?: unknown; data?: { code?: string } } | null;
  if (e?.name === "AbortError" || e?.kind === "cancelled") return "batch_fatal";
  // 浏览器断线、代理返回非 JSON 等情况下 tRPC 没有服务端错误 shape。
  // 请求可能已经抵达，保留已登记的任务 ID，令批次停领并在恢复时对账。
  if (e?.name === "TRPCClientError" && !e.shape && !e.data?.code) return "unknown";
  if (e?.kind === "unknown") return "unknown";
  const code = String(e?.data?.code || e?.code || "");
  if (/^(?:UNAUTHORIZED|FORBIDDEN|PAYMENT_REQUIRED|PRECONDITION_FAILED)$/.test(code)) return "batch_fatal";
  // 服务端失败文案 =「最终错误」+「── log ──」+ 过程日志尾巴；日志里会有已回落成功的另一通道的错误，只按最终错误判。
  const full = String(e?.message ?? error ?? "");
  const message = full.split("── log ──")[0]!.split(/\n执行日志[:：]/)[0]!;
  if (BATCH_FATAL_RE.test(message)) return "batch_fatal";
  if (UNKNOWN_RE.test(message) || RECONCILE_NOTE_RE.test(full)) return "unknown";
  return "page";
}

/** 入队后查询失败只代表回执缺失；保留原任务身份给恢复入口对账。 */
export function knowledgeIllustrationReceiptUnknown(jobId: string): Error {
  return Object.assign(new Error("配图结果待核实，请在原任务中查看"), { kind: "unknown", jobId });
}

export async function readKnowledgeIllustrationTerminal<T>(jobId: string, poll: () => Promise<T>): Promise<T> {
  try {
    return await poll();
  } catch {
    throw knowledgeIllustrationReceiptUnknown(jobId);
  }
}

export type KnowledgeIllustrationBatchSummary = {
  total: number; dispatched: number; succeeded: number; failed: number; unknown: number; notDispatched: number;
  stoppedBy: "batch_fatal" | "unknown" | "inactive" | null;
  failures: { index: number; kind: KnowledgeIllustrationFailureClass; error: unknown }[];
};
/** 有页失败或未派发时抛出；带逐页计数，调用方不能把部分成功报成全部成功。 */
export class KnowledgeIllustrationBatchError extends Error {
  constructor(readonly summary: KnowledgeIllustrationBatchSummary, readonly cause: unknown) {
    const first = cause instanceof Error ? cause.message : String(cause);
    const head = summary.stoppedBy === "batch_fatal" || summary.stoppedBy === "unknown"
      ? `配图已停止派发新页：完成 ${summary.succeeded}/${summary.total} 页，${summary.notDispatched} 页未提交`
      : `配图完成 ${summary.succeeded}/${summary.total} 页，${summary.failed + summary.unknown} 页未成功`;
    super(`${head}${summary.unknown ? `（其中 ${summary.unknown} 页结果待核实，不会自动重新购买）` : ""}：${first}`);
    this.name = "KnowledgeIllustrationBatchError";
  }
}

/**
 * 单页失败不停批：其余页照常派发，每页只派发一次（失败/未知页本批不重买）。
 * batch_fatal 或结果未知（可能已照扣）才停领新页；用户停止（active=false）同样只停新领取。已领取任务必须收妥，调用方才能停止缺图等待并解锁。
 * 全部成功返回汇总；有页失败或因整批错误未派发时抛 KnowledgeIllustrationBatchError（cause = 首个整批错误，否则首个失败）。
 * 用户停止而无失败时照旧正常返回（由调用方按已出页数报「已停止」）。
 */
export async function runKnowledgeIllustrationBatch(options: {
  count: number;
  concurrency: number;
  active: () => boolean;
  execute: (index: number, lane: number) => Promise<void>;
}): Promise<KnowledgeIllustrationBatchSummary> {
  let next = 0, succeeded = 0;
  let fatal: { index: number; error: unknown } | undefined;
  let unknownHalt: { index: number; error: unknown } | undefined;
  let inactive = false;
  const failures: KnowledgeIllustrationBatchSummary["failures"] = [];
  const workers = Array.from({ length: Math.min(options.concurrency, options.count) }, async (_, lane) => {
    while (next < options.count && !fatal && !unknownHalt) {
      if (!options.active()) { inactive = true; break; }
      const index = next++;
      try {
        await options.execute(index, lane);
        succeeded += 1;
      } catch (error) {
        const kind = classifyKnowledgeIllustrationFailure(error);
        failures.push({ index, kind, error });
        if (kind === "batch_fatal" && !fatal) fatal = { index, error };
        if (kind === "unknown" && !unknownHalt) unknownHalt = { index, error };
      }
    }
  });
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find(result => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  failures.sort((a, b) => a.index - b.index);
  const summary: KnowledgeIllustrationBatchSummary = {
    total: options.count, dispatched: next, succeeded,
    failed: failures.filter(f => f.kind !== "unknown").length, unknown: failures.filter(f => f.kind === "unknown").length,
    notDispatched: options.count - next, stoppedBy: fatal ? "batch_fatal" : unknownHalt ? "unknown" : inactive && next < options.count ? "inactive" : null, failures,
  };
  if (fatal) throw new KnowledgeIllustrationBatchError(summary, fatal.error);
  if (unknownHalt) throw new KnowledgeIllustrationBatchError(summary, unknownHalt.error);
  if (failures.length) throw new KnowledgeIllustrationBatchError(summary, failures[0]!.error);
  return summary;
}

/** 本次页面内只等待已经分配的图片任务；刷新后由保存的 jobId 继续查询。 */
export function knowledgeIllustrationRun(ids: readonly string[]) {
  const slots = new Map(ids.map(id => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    // 文字可能先失败，仍要吸收未被等待的图片错误，避免悬空 rejection。
    void promise.catch(() => undefined);
    return [id, { promise, resolve, reject }] as const;
  }));
  return {
    wait: async (selected: string[]) => { await Promise.all(selected.map(id => {
      const slot = slots.get(id);
      if (!slot) throw new Error("同步配图身份不匹配");
      return slot.promise;
    })); },
    done: (id: string) => slots.get(id)?.resolve(),
    stop: () => { for (const slot of Array.from(slots.values())) slot.reject(new Error("配图未全部完成，文字和已完成图片均已保留；请恢复原任务后继续整理")); },
  };
}

/** 与服务端knowledgeCardPageJobId同一编码；请求号仍由页面取消账本登记。 */
export async function knowledgeIllustrationJobId(owner: string, requestId: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([owner, "platform_composite_sheet_progress", requestId.toLowerCase()]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "kc_" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 56);
}

/** 补图前对账：成功恢复、在途等待；仅明确失败或本页证实从未提交才可购买。 */
export async function inspectKnowledgeIllustrationRetry(
  jobId: string,
  knownUnsubmitted: boolean,
  read: (id: string) => Promise<{ status: string; input?: unknown; output?: unknown }>,
): Promise<string | null> {
  try {
    const job = await read(jobId);
    if (job.status === "succeeded") {
      const output = job.output as { compositeImageUrl?: string; imageUrl?: string } | null;
      const url = output?.compositeImageUrl || output?.imageUrl;
      if (!url) throw new Error("原配图已成功但缺少图片回执，请先核对原任务；没有重新扣费");
      return url;
    }
    if (job.status === "failed") {
      if (knowledgeImageMayRetry(job)) return null;
      throw new Error("原配图失败，但上游结果或退款尚未确认；请保留原任务等待核对，不能重新购买");
    }
    throw new Error("原配图仍在执行或结果待核实，请等待原任务；没有重新购买图片");
  } catch (error) {
    if (knownUnsubmitted && /\(404\)|Job not found/i.test(String((error as Error).message))) return null;
    throw error;
  }
}
