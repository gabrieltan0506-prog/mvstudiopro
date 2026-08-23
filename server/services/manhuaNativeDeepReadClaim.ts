/**
 * 每集精读的原子占位。
 *
 * 为什么 #1295 的 `ifGenerationMatch=0` 不够：**它在模型跑完之后**。
 * 两个进程同时 list 到「未入库」，会各自付费跑完整一集，
 * 第二个直到写卡那一刻才拿到 `created:false` —— 卡没被覆盖，但钱已经花了两份。
 *
 * 占位放在 runner **之前**，用同一把 `ifGenerationMatch=0` 原子锁：
 * 抢不到就停手，不猜「对方是不是已经在跑了」。
 *
 * ⚠️ 失败或中止时**保留占位、不自动清理**。
 * 因为这时说不清模型到底调没调——自动清掉就等于允许下一轮重烧。
 * 残留占位由干跑报告列成「待核对」，交人工决定。
 */
import crypto from "node:crypto";
import {
  deleteGcsObject,
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";
import { nativeDeepReadProposalId } from "./manhuaNativeDeepReadIngest.js";

export const NATIVE_DEEP_READ_CLAIM_PREFIX = "manhua-template-learn/native-claims/";

export function nativeDeepReadClaimObjectName(seriesKey: string, episodeIndex: number): string {
  // 走同一个 id 生成器：占位与卡片必须同源，否则占了 A 写了 B
  return `${NATIVE_DEEP_READ_CLAIM_PREFIX}${nativeDeepReadProposalId(seriesKey, episodeIndex)}.json`;
}

export type NativeDeepReadClaim = {
  claimUri: string;
  objectName: string;
  runId: string;
  /** 仅在卡片成功入库后调用；条件删除，不误删别人后写的占位 */
  releaseAfterSuccess: () => Promise<void>;
};

export async function acquireNativeDeepReadEpisodeClaim(
  seriesKey: string,
  episodeIndex: number,
): Promise<NativeDeepReadClaim> {
  // 先过 id 校验（非法 seriesKey / 集号在这里就抛，不会走到网络）
  const objectName = nativeDeepReadClaimObjectName(seriesKey, episodeIndex);
  const runId = crypto.randomUUID();
  const bucket = getGcsBucketName();
  const claimUri = `gs://${bucket}/${objectName}`;

  const created = await uploadBufferToGcsIfAbsent({
    bucket,
    objectName,
    contentType: "application/json",
    buffer: Buffer.from(
      `${JSON.stringify({ runId, createdAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    ),
  });
  if (!created.created) {
    throw new Error(
      `第${episodeIndex}集已有精读任务占位；请先核对现有任务/卡片，禁止自动重跑`,
    );
  }

  // 读回确认是自己写的：并发下 412 不是唯一失败形态，读回是第二道
  const versioned = await downloadGcsObjectVersioned({ gcsUri: claimUri });
  const saved = JSON.parse(versioned.buffer.toString("utf8")) as { runId?: string };
  if (saved.runId !== runId) {
    throw new Error(`第${episodeIndex}集精读占位内容不一致，已停止`);
  }

  return {
    claimUri,
    objectName,
    runId,
    releaseAfterSuccess: async () => {
      await deleteGcsObject({
        bucket,
        objectName,
        ifGenerationMatch: versioned.generation,
      });
    },
  };
}

/** 干跑时列出仍在占位、必须人工核对后才能重跑的集号。 */
export async function listNativeDeepReadEpisodeClaims(seriesKey: string): Promise<Set<number>> {
  const idPrefix = nativeDeepReadProposalId(seriesKey, 1).replace(/ep001$/, "ep");
  const names = await listGcsObjectNamesByPrefix({
    prefix: `${NATIVE_DEEP_READ_CLAIM_PREFIX}${idPrefix}`,
    literalPrefix: true,
    maxResults: NATIVE_DEEP_READ_BATCH_CLAIM_SCAN_LIMIT,
  });
  const escaped = idPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`/${escaped}(\\d{3})\\.json$`);
  const episodes = new Set<number>();
  for (const name of names) {
    const match = name.match(pattern);
    const episodeIndex = Number(match?.[1]);
    if (Number.isInteger(episodeIndex) && episodeIndex >= 1 && episodeIndex <= 999) {
      episodes.add(episodeIndex);
    }
  }
  return episodes;
}

/** 与批次硬保险一致；这里只防失控列举，不是发车集数限制。 */
const NATIVE_DEEP_READ_BATCH_CLAIM_SCAN_LIMIT = 500;
