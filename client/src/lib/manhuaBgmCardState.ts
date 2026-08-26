import type { BgmStructure } from "@shared/manhuaBeatTable";

export type ManhuaBgmPendingJob = {
  jobId: string;
  billingRequestId: string;
  titleZh: string;
  durationSec: number;
  createdAtMs: number;
};

export const MANHUA_BGM_PENDING_TTL_MS = 24 * 3600_000;

export function manhuaBgmJobStorageKey(userId: string | number): string {
  return `mv-manhua-bgm-job-v2:${String(userId || "anon")}`;
}

export function readPendingManhuaBgmJob(
  storage: Pick<Storage, "getItem">,
  nowMs: number,
  userId: string | number,
): ManhuaBgmPendingJob | null {
  try {
    const raw = storage.getItem(manhuaBgmJobStorageKey(userId));
    if (!raw) return null;
    const row = JSON.parse(raw) as Partial<ManhuaBgmPendingJob>;
    const jobId = String(row.jobId || "").trim();
    const billingRequestId = String(row.billingRequestId || "").trim();
    const createdAtMs = Number(row.createdAtMs) || 0;
    if (!jobId || !billingRequestId || nowMs - createdAtMs > MANHUA_BGM_PENDING_TTL_MS) {
      return null;
    }
    return {
      jobId,
      billingRequestId,
      titleZh: String(row.titleZh || ""),
      durationSec: Number(row.durationSec) || 0,
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
    /* 服务端 jobs 才是恢复主来源。 */
  }
}

export function clearPendingManhuaBgmJob(
  storage: Pick<Storage, "removeItem">,
  userId: string | number,
): void {
  try {
    storage.removeItem(manhuaBgmJobStorageKey(userId));
  } catch {
    /* 无需阻断页面。 */
  }
}

export type ManhuaBgmVariant = {
  index: number;
  gcsUri: string;
  previewUrl: string;
  bytes: number;
  structure: BgmStructure | null;
};

function readBgmStructure(value: unknown): BgmStructure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const result: BgmStructure = {
    strongestAtSec: Number(row.strongestAtSec),
    strongestPeakDb: Number(row.strongestPeakDb),
    valleyAtSec: Number(row.valleyAtSec),
    valleyMeanDb: Number(row.valleyMeanDb),
    decayStartSec: Number(row.decayStartSec),
    totalSec: Number(row.totalSec),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

export function readManhuaBgmVariants(output: unknown): ManhuaBgmVariant[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const variants = (output as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return [];
  return variants
    .map((value, fallbackIndex) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const row = value as Record<string, unknown>;
      const gcsUri = String(row.gcsUri || "").trim();
      if (!gcsUri.startsWith("gs://")) return null;
      return {
        index: Number.isInteger(row.index) ? Number(row.index) : fallbackIndex,
        gcsUri,
        previewUrl: String(row.previewUrl || "").trim(),
        bytes: Math.max(0, Number(row.bytes) || 0),
        structure: readBgmStructure(row.structure),
      };
    })
    .filter((value): value is ManhuaBgmVariant => Boolean(value));
}

export function canSubmitManhuaBgm(input: {
  hasDraft: boolean;
  pending: ManhuaBgmPendingJob | null;
  durationSec: number;
}): { ok: true } | { ok: false; reasonZh: string } {
  if (!input.hasDraft) return { ok: false, reasonZh: "先生成并检查配乐 brief" };
  if (input.pending) return { ok: false, reasonZh: "已有配乐任务在处理，请勿重复提交" };
  if (!Number.isInteger(input.durationSec) || input.durationSec < 10 || input.durationSec > 360) {
    return { ok: false, reasonZh: "时长需为 10–360 秒整数" };
  }
  return { ok: true };
}
