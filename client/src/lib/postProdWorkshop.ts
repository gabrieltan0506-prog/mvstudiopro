/**
 * 后期工坊卡的纯逻辑层(可单测,不碰 React/DOM):
 * - 任务记录以服务端 jobs 为主来源,localStorage 仅作用户级显示缓存(按 uid 分 key);
 * - 服务端列表与本地缓存合并(label 等展示字段本地优先,状态/产物以服务端为准);
 * - 后期产物(拼接/BGM)可直接进入下一道工序(gcsUri 优先,不依赖旧读取地址);
 * - 异常缓存结构清理、终态只提示一次的判定。
 */

export type PostProdAction = "concat" | "bgm_mount" | "loudness_check";
export type PostProdJobStatus = "queued" | "running" | "succeeded" | "failed";

export type TrackedJob = {
  jobId: string;
  action: PostProdAction;
  label: string;
  status: PostProdJobStatus;
  createdAt: number;
  output?: Record<string, unknown> | null;
  error?: string | null;
};

export const ACTION_LABEL: Record<PostProdAction, string> = {
  concat: "拼接成片",
  bgm_mount: "BGM 贴装",
  loudness_check: "响度验收",
};

const ACTIONS: readonly string[] = ["concat", "bgm_mount", "loudness_check"];
const STATUSES: readonly string[] = ["queued", "running", "succeeded", "failed"];

/** localStorage 键按用户分隔:换账号不串单 */
export function jobsStorageKey(userId: string): string {
  return `postProd.jobs.v2.u${userId}`;
}

/** 异常结构清理:非数组/坏条目一律丢弃,上限 30 条 */
export function normalizeStoredJobs(value: unknown): TrackedJob[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is TrackedJob => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<TrackedJob>;
      return (
        typeof record.jobId === "string" &&
        ACTIONS.includes(String(record.action)) &&
        STATUSES.includes(String(record.status))
      );
    })
    .slice(0, 30);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadStoredJobs(storageKey: string, storage: StorageLike): TrackedJob[] {
  try {
    const raw = storage.getItem(storageKey);
    return normalizeStoredJobs(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function persistJobs(storageKey: string, jobs: TrackedJob[], storage: StorageLike): void {
  try {
    storage.setItem(storageKey, JSON.stringify(jobs.slice(0, 30)));
  } catch {
    /* 存不进就算了,列表仍在内存 */
  }
}

export type RemotePostProdJob = {
  jobId: string;
  action?: unknown;
  status: string;
  output?: unknown;
  error?: string | null;
  createdAt?: unknown;
};

/**
 * 服务端列表为主、本地缓存补展示字段:
 * 状态/产物/错误以服务端为准;label 本地优先(用户提交时的语义标签)。
 * 本地有但服务端没有的任务(如已被清理)不保留——服务端是主来源。
 */
export function mergeRemoteJobs(local: TrackedJob[], remote: RemotePostProdJob[]): TrackedJob[] {
  const localById = new Map(local.map((item) => [item.jobId, item]));
  const merged: TrackedJob[] = [];
  for (const r of remote) {
    const cached = localById.get(r.jobId);
    const action = ACTIONS.includes(String(r.action))
      ? (r.action as PostProdAction)
      : cached?.action;
    if (!action) continue;
    const createdAt = r.createdAt ? new Date(r.createdAt as string | number | Date).getTime() : 0;
    merged.push({
      jobId: r.jobId,
      action,
      label: cached?.label ?? ACTION_LABEL[action],
      status: (STATUSES.includes(r.status) ? r.status : "failed") as PostProdJobStatus,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : cached?.createdAt ?? 0,
      output: (r.output as Record<string, unknown> | null) ?? cached?.output ?? null,
      error: r.error ?? null,
    });
  }
  return merged;
}

export type ClipOption = { id: string; url: string; label: string };

/**
 * 已完成的拼接/BGM 产物 → 下一道工序的可选素材。
 * gcsUri 优先于 url(读链会过期,gs:// 由服务端现签)。
 */
export function buildPostProdClipOptions(jobs: TrackedJob[]): ClipOption[] {
  return jobs
    .filter(
      (job) =>
        job.status === "succeeded" &&
        (job.action === "concat" || job.action === "bgm_mount") &&
        job.output,
    )
    .map((job) => {
      const output = job.output as { gcsUri?: unknown; url?: unknown };
      const url = String(output.gcsUri || output.url || "").trim();
      if (!url) return null;
      return {
        id: `post-prod:${job.jobId}`,
        url,
        label: `${ACTION_LABEL[job.action]} · ${new Date(job.createdAt).toLocaleString()}`,
      };
    })
    .filter((item): item is ClipOption => item !== null);
}

/** 后期产物在前、画布成片在后;同 url 去重 */
export function mergeClipOptions(postProd: ClipOption[], fromBlocks: ClipOption[]): ClipOption[] {
  const seen = new Set<string>();
  return [...postProd, ...fromBlocks].filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

/** 终态只提示一次:该弹则记账并返回 true,已弹过返回 false */
export function shouldNotifyTerminal(
  notified: Set<string>,
  jobId: string,
  status: string,
): boolean {
  const terminal = status === "succeeded" || status === "failed";
  if (!terminal || notified.has(jobId)) return false;
  notified.add(jobId);
  return true;
}
