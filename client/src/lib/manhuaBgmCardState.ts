/**
 * 配乐卡的状态判据与本地续跑。
 *
 * 配乐是**付费异步任务**：确认一次就建一张上游单。所以三件事必须成立——
 *   ① 确认前先免费起草，用户能改 style / duration / 结构标签
 *   ② 确认时产生 billingRequestId，网络重发复用它，不建第二单
 *   ③ 刷新后能恢复未完成的 jobId，否则用户只会再点一次 = 再付一次
 *
 * 判据抽到这里而不是散在组件里：这类「什么时候能点生成」的条件一旦内联，
 * 加个字段就会漏改一处（本仓已有前科）。
 */

/**
 * 按 userId 分键：不分键的话换账号会读到上一个账号的 jobId，
 * 页面显示别人的任务，用户以为没跑成就再点一次 = 再付一次。
 */
export function manhuaBgmJobStorageKey(userId: string | number): string {
  return `mv-manhua-bgm-job-v1:${String(userId || "anon")}`;
}

export type ManhuaBgmPendingJob = {
  jobId: string;
  billingRequestId: string;
  /** 确认那一刻的 brief 摘要，恢复后卡面还能显示当时发的是什么 */
  titleZh: string;
  durationSec: number;
  createdAtMs: number;
};

/** 未完成的任务留多久还值得恢复；超过就当作过期，让用户重新起草 */
export const MANHUA_BGM_PENDING_TTL_MS = 24 * 3600_000;

export function readPendingManhuaBgmJob(
  storage: Pick<Storage, "getItem">,
  nowMs: number,
  userId: string | number,
): ManhuaBgmPendingJob | null {
  try {
    const raw = storage.getItem(manhuaBgmJobStorageKey(userId));
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<ManhuaBgmPendingJob>;
    const jobId = String(j.jobId || "").trim();
    const billingRequestId = String(j.billingRequestId || "").trim();
    const createdAtMs = Number(j.createdAtMs) || 0;
    if (!jobId || !billingRequestId) return null;
    if (nowMs - createdAtMs > MANHUA_BGM_PENDING_TTL_MS) return null;
    return {
      jobId,
      billingRequestId,
      titleZh: String(j.titleZh || ""),
      durationSec: Number(j.durationSec) || 0,
      createdAtMs,
    };
  } catch {
    return null;
  }
}

export function writePendingManhuaBgmJob(
  storage: Pick<Storage, "setItem">,
  job: ManhuaBgmPendingJob,
  userId: string | number,
): void {
  try {
    storage.setItem(manhuaBgmJobStorageKey(userId), JSON.stringify(job));
  } catch {
    // 存不下不阻断：**服务端 job 才是主来源**，刷新后靠 listManhuaBgmJobs 找回
  }
}

export function clearPendingManhuaBgmJob(
  storage: Pick<Storage, "removeItem">,
  userId: string | number,
): void {
  try {
    storage.removeItem(manhuaBgmJobStorageKey(userId));
  } catch {
    /* 无所谓 */
  }
}

/**
 * 能不能点「生成配乐」。
 *
 * 三个拦：没起草过不许发（用户没看过要发什么）、已有在跑的不许再发
 * （那就是重复付费）、时长越界不许发（上游会判参数错误，白花一次）。
 */
export function canSubmitManhuaBgm(input: {
  hasDraft: boolean;
  pending: ManhuaBgmPendingJob | null;
  durationSec: number;
}): { ok: true } | { ok: false; reasonZh: string } {
  if (!input.hasDraft) return { ok: false, reasonZh: "先生成一版配乐提示词再确认" };
  if (input.pending) return { ok: false, reasonZh: "已有配乐任务在跑，等它完成或先取消" };
  if (!Number.isInteger(input.durationSec) || input.durationSec < 10 || input.durationSec > 360) {
    return { ok: false, reasonZh: "时长需为 10–360 秒的整数" };
  }
  return { ok: true };
}

export type ManhuaBgmVariant = { index: number; gcsUri: string; previewUrl: string; bytes: number };

/** 从 job.output 里取变体；形状不对就当没有，不硬凑 */
export function readManhuaBgmVariants(output: unknown): ManhuaBgmVariant[] {
  if (!output || typeof output !== "object") return [];
  const raw = (output as { variants?: unknown }).variants;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v, i) => {
      const o = (v || {}) as Record<string, unknown>;
      const gcsUri = String(o.gcsUri || "").trim();
      if (!gcsUri.startsWith("gs://")) return null;
      return {
        index: Number.isInteger(o.index) ? (o.index as number) : i,
        gcsUri,
        previewUrl: String(o.previewUrl || ""),
        bytes: Number(o.bytes) || 0,
      };
    })
    .filter((v): v is ManhuaBgmVariant => Boolean(v));
}

export type ManhuaBgmServerJob = {
  jobId: string;
  status: string;
  output: unknown;
  error?: string | null;
};

/**
 * 从服务端任务列表恢复页面状态。
 *
 * 服务端是主来源，localStorage 只是缓存。三种情况都要覆盖：
 *   · 有未完成任务 → 恢复成 pending，继续轮询（不让用户再点一次）
 *   · 最近一条成功且带变体 → 恢复变体，**用户还没选就刷新时不至于全丢**
 *   · 都没有 → 干净状态
 */
export function restoreManhuaBgmFromServer(jobs: readonly ManhuaBgmServerJob[]): {
  pending: ManhuaBgmPendingJob | null;
  variants: ManhuaBgmVariant[];
} {
  const running = jobs.find((j) => j.status === "running" || j.status === "queued");
  if (running) {
    return {
      pending: {
        jobId: running.jobId,
        billingRequestId: running.jobId.replace(/^bgm_/, ""),
        titleZh: "",
        durationSec: 0,
        createdAtMs: Date.now(),
      },
      variants: [],
    };
  }
  const succeeded = jobs.find((j) => j.status === "succeeded");
  return { pending: null, variants: succeeded ? readManhuaBgmVariants(succeeded.output) : [] };
}
