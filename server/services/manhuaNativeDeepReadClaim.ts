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
