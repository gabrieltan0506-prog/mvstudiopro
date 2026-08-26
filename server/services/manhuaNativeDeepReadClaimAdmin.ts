/**
 * 占位（native-claims）管理：面板列出历史占位并支持人工弃置。
 *
 * 为什么单独成文件：claim 的「抢占」语义（manhuaNativeDeepReadClaim.ts）服务于
 * 执行期防双跑，绝不自动清理；这里是**人工裁决**通道——用户在界面上看清
 * 「哪一集、占了多久、花没花钱、卡在哪」之后亲手点弃置。两边共用同一套
 * 对象命名与条件删除，但职责分开，防止执行链误引用人工清理入口。
 */
import {
  deleteGcsObject,
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
} from "./gcs.js";
import {
  NATIVE_DEEP_READ_CLAIM_PREFIX,
  nativeDeepReadClaimObjectName,
} from "./manhuaNativeDeepReadClaim.js";
import { nativeDeepReadProposalId } from "./manhuaNativeDeepReadIngest.js";

export type NativeDeepReadClaimAdminRow = {
  episodeIndex: number;
  /** 列表读取时的对象版本；弃置必须原样回传，防止误删列表之后新建的任务。 */
  claimGeneration: string | null;
  /** 占位文件里的 createdAt；旧格式读不出时为 null，不编造时间 */
  createdAtIso: string | null;
  /** 集失败时补写的最终拒因（0826 起有）；旧占位没有则为 null */
  lastErrorZh: string | null;
  lastFailedAtIso: string | null;
  /** true 表示它不会再挤掉集号；下一轮会按失败占位安全接管。 */
  reclaimable: boolean;
};

const CLAIM_ADMIN_SCAN_LIMIT = 999;

/** 列出一部剧当前仍存在的全部精读占位（按集号升序）。 */
export async function listNativeDeepReadClaimAdminRows(
  seriesKey: string,
): Promise<NativeDeepReadClaimAdminRow[]> {
  // 与执行链同一个 id 生成器：非法 seriesKey 在这里就抛，不会走到网络
  const idPrefix = nativeDeepReadProposalId(seriesKey, 1).replace(/ep001$/, "ep");
  const names = await listGcsObjectNamesByPrefix({
    prefix: `${NATIVE_DEEP_READ_CLAIM_PREFIX}${idPrefix}`,
    literalPrefix: true,
    maxResults: CLAIM_ADMIN_SCAN_LIMIT,
  });
  const escaped = idPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`/${escaped}(\\d{3})\\.json$`);
  const bucket = getGcsBucketName();
  const rows: NativeDeepReadClaimAdminRow[] = [];
  for (const name of names) {
    const match = name.match(pattern);
    const episodeIndex = Number(match?.[1]);
    if (!Number.isInteger(episodeIndex) || episodeIndex < 1 || episodeIndex > 999) continue;
    let createdAtIso: string | null = null;
    let lastErrorZh: string | null = null;
    let lastFailedAtIso: string | null = null;
    let claimGeneration: string | null = null;
    try {
      const versioned = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${name}` });
      claimGeneration = versioned.generation;
      const parsed = JSON.parse(versioned.buffer.toString("utf8")) as {
        createdAt?: unknown;
        lastErrorZh?: unknown;
        lastFailedAtIso?: unknown;
      };
      const createdAt = String(parsed.createdAt || "").trim();
      createdAtIso = createdAt && !Number.isNaN(Date.parse(createdAt)) ? createdAt : null;
      lastErrorZh = String(parsed.lastErrorZh || "").trim().slice(0, 500) || null;
      const failedAt = String(parsed.lastFailedAtIso || "").trim();
      lastFailedAtIso = failedAt && !Number.isNaN(Date.parse(failedAt)) ? failedAt : null;
    } catch {
      // 读不动只影响展示信息，不影响「这一集确实有占位」这个事实
    }
    rows.push({
      episodeIndex,
      claimGeneration,
      createdAtIso,
      lastErrorZh,
      lastFailedAtIso,
      reclaimable: Boolean(lastErrorZh || lastFailedAtIso),
    });
  }
  return rows.sort((a, b) => a.episodeIndex - b.episodeIndex);
}

/**
 * 人工弃置一条占位：条件删除（按读到的 generation），
 * 期间若执行链重建了同名占位（说明该集正在真跑），删除会 412 失败——宁停勿删。
 */
export async function discardNativeDeepReadClaimForEpisode(
  seriesKey: string,
  episodeIndex: number,
  expectedGeneration: string,
): Promise<void> {
  const objectName = nativeDeepReadClaimObjectName(seriesKey, episodeIndex);
  const bucket = getGcsBucketName();
  const generation = String(expectedGeneration || "").trim();
  if (!/^\d+$/.test(generation)) {
    throw new Error(`第${episodeIndex}集占位版本未知，请刷新后重试`);
  }
  try {
    await deleteGcsObject({ bucket, objectName, ifGenerationMatch: generation });
  } catch (error) {
    if (error instanceof Error && error.message.includes("gcs_delete_generation_conflict")) {
      throw new Error(`第${episodeIndex}集占位已变化，请刷新后重试`);
    }
    throw error;
  }
}
