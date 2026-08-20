/**
 * 所有权登记簿存量引导 v3(五审 P0-4):证据源=服务端 jobs 表的成功任务记录。
 *
 * 旧版以用户云草稿的资产字段为据——草稿客户端可写,历史草稿里塞别人的路径即可抢注,
 * "先到先得"只会让处理顺序决定归属。v3 只认服务端持久化的
 * { numeric userId + action=canvas_gpt_image2 + status=succeeded + output.imageUrl(s) },
 * 没有服务端来源证据的旧对象保持拒绝(用户重新生成/重新上传即可自动登记)。
 *
 * 特性:dry-run / (createdAt,id) 游标断点续跑 / 幂等(createIfAbsent) /
 * created·alreadyOwned·conflict·invalid·error 分项统计 / 冲突对象带 jobId 审计。
 * 执行入口:scripts/backfill-canvas-media-owners.mts(手动/部署时跑,不在请求路径)。
 */
import {
  extractCanvasMediaObjectPath,
  registerCanvasMediaOwner,
  type OwnerStore,
} from "./canvasMediaOwnership.js";

export type BackfillEvidenceJob = {
  id: string;
  userId: string;
  createdAt: Date | string;
  input: unknown;
  output: unknown;
};

export type BackfillCheckpoint = { afterCreatedAtMs: number; afterId: string };

export type BackfillConflict = {
  objectPath: string;
  jobId: string;
  jobUserId: number;
};

export type BackfillPageResult = {
  scannedJobs: number;
  created: number;
  alreadyOwned: number;
  conflict: number;
  invalid: number;
  errors: number;
  conflicts: BackfillConflict[];
  errorSamples: string[];
  nextCheckpoint: BackfillCheckpoint | null;
  done: boolean;
};

function jobAction(input: unknown): string {
  const v =
    typeof input === "string"
      ? (() => {
          try {
            return JSON.parse(input);
          } catch {
            return null;
          }
        })()
      : input;
  if (!v || typeof v !== "object" || Array.isArray(v)) return "";
  return String((v as { action?: unknown }).action || "");
}

function jobImageUrls(output: unknown): string[] {
  const v =
    typeof output === "string"
      ? (() => {
          try {
            return JSON.parse(output);
          } catch {
            return null;
          }
        })()
      : output;
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  const o = v as { imageUrl?: unknown; imageUrls?: unknown };
  const urls = [
    ...(typeof o.imageUrl === "string" ? [o.imageUrl] : []),
    ...(Array.isArray(o.imageUrls) ? o.imageUrls.filter((u) => typeof u === "string") : []),
  ] as string[];
  return Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
}

/** 处理一页任务;由 CLI 循环调用直至 done。store 可注入供测试。 */
export async function backfillCanvasMediaOwnersPage(opts: {
  checkpoint?: BackfillCheckpoint | null;
  pageSize?: number;
  dryRun?: boolean;
  store?: OwnerStore;
  /** 测试注入:换掉 DB 分页读取 */
  listPage?: (opts: {
    afterCreatedAtMs?: number;
    afterId?: string;
    limit?: number;
  }) => Promise<BackfillEvidenceJob[]>;
}): Promise<BackfillPageResult> {
  const pageSize = Math.max(1, Math.min(500, Math.floor(Number(opts.pageSize) || 200)));
  const listPage =
    opts.listPage ||
    (async (o: { afterCreatedAtMs?: number; afterId?: string; limit?: number }) => {
      const { listSucceededImageJobsPage } = await import("../jobs/repository.js");
      return listSucceededImageJobsPage(o) as unknown as Promise<BackfillEvidenceJob[]>;
    });
  const page = await listPage({
    afterCreatedAtMs: opts.checkpoint?.afterCreatedAtMs,
    afterId: opts.checkpoint?.afterId,
    limit: pageSize,
  });
  const result: BackfillPageResult = {
    scannedJobs: page.length,
    created: 0,
    alreadyOwned: 0,
    conflict: 0,
    invalid: 0,
    errors: 0,
    conflicts: [],
    errorSamples: [],
    nextCheckpoint: null,
    done: page.length < pageSize,
  };
  for (const job of page) {
    const uid = Number(job.userId);
    if (jobAction(job.input) !== "canvas_gpt_image2" || !Number.isFinite(uid) || uid <= 0) {
      continue; // 非目标任务/无有效登录用户:不构成归属证据,静默跳过不计入 invalid
    }
    for (const url of jobImageUrls(job.output)) {
      const objectPath = extractCanvasMediaObjectPath(url);
      if (!objectPath) {
        result.invalid += 1;
        continue;
      }
      if (opts.dryRun) {
        result.created += 1; // dry-run 口径:按"将尝试登记"计数,不落任何写
        continue;
      }
      try {
        const outcome = await registerCanvasMediaOwner({
          objectPath,
          ownerUserId: uid,
          source: `backfill-job:${job.id}`.slice(0, 60),
          store: opts.store,
        });
        if (outcome === "created") result.created += 1;
        else if (outcome === "alreadyOwned") result.alreadyOwned += 1;
        else if (outcome === "invalid") result.invalid += 1;
        else {
          result.conflict += 1;
          if (result.conflicts.length < 200) {
            result.conflicts.push({ objectPath, jobId: job.id, jobUserId: uid });
          }
        }
      } catch (error) {
        result.errors += 1;
        if (result.errorSamples.length < 20) {
          result.errorSamples.push(
            `${job.id} ${objectPath}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200),
          );
        }
      }
    }
  }
  const last = page[page.length - 1];
  if (last) {
    result.nextCheckpoint = {
      afterCreatedAtMs: new Date(last.createdAt).getTime(),
      afterId: String(last.id),
    };
  }
  return result;
}
