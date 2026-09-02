import {
  emptyManhuaClipQualityChecks,
  type ManhuaClipQualityReport,
} from "@shared/manhuaClipQuality";

export async function reviewManhuaClipQuality(input: {
  videoUrl: string;
  referenceImageUrl: string;
  expectedContext: string;
  attempts: number;
  sourceKeyartId?: string;
  expectedDurationSec?: number;
  shotIndex?: number;
}): Promise<ManhuaClipQualityReport> {
  const reviewedAt = new Date().toISOString();
  try {
    const response = await fetch("/api/google?op=manhuaClipQualityReview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoUrl: input.videoUrl,
        referenceImageUrl: input.referenceImageUrl,
        expectedContext: input.expectedContext,
        expectedDurationSec: input.expectedDurationSec,
        shotIndex: input.shotIndex,
      }),
    });
    const json = (await response.json()) as {
      ok?: boolean;
      report?: Pick<ManhuaClipQualityReport, "status" | "checks" | "failedKeys" | "summary" | "raw">;
      error?: string;
      message?: string;
    };
    if (!response.ok || !json.ok || !json.report) {
      throw new Error(String(json.message || json.error || `HTTP ${response.status}`));
    }
    return {
      ...json.report,
      attempts: input.attempts,
      sourceKeyartId: input.sourceKeyartId,
      sourceKeyartUrl: input.referenceImageUrl,
      reviewedAt,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return {
      // 为什么是 unverified 而不是 failed：这里是「检不了」（接口异常/超时），
      // 不是「检了没过」。以前伪装 failed + 全量 failedKeys，第三方质检一抖
      // 整条链就被 fail-closed 误杀锁死。unverified 默认仍不进成片坞，
      // 但 failedKeys 留空（没有任何维度真的被判 NO），并保留重试与手动放行出口。
      status: "unverified",
      checks: emptyManhuaClipQualityChecks(),
      failedKeys: [],
      // summary 保留「暂不可用」字样：isManhuaClipQualityInfraFailure 靠它识别链路故障
      summary: "智能质检暂不可用（未质检，非成片内容判定）：可稍后重试，或在工作台「未质检放行」进成片坞",
      raw,
      attempts: input.attempts,
      sourceKeyartId: input.sourceKeyartId,
      sourceKeyartUrl: input.referenceImageUrl,
      reviewedAt,
    };
  }
}
