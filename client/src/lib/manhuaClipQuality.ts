import {
  emptyManhuaClipQualityChecks,
  MANHUA_CLIP_QUALITY_KEYS,
  type ManhuaClipQualityReport,
} from "@shared/manhuaClipQuality";

export async function reviewManhuaClipQuality(input: {
  videoUrl: string;
  referenceImageUrl: string;
  expectedContext: string;
  attempts: number;
  sourceKeyartId?: string;
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
      status: "failed",
      checks: emptyManhuaClipQualityChecks(),
      failedKeys: [...MANHUA_CLIP_QUALITY_KEYS],
      // 与内容不合格区分：右栏可据此仍播成片，但不进成片坞
      summary: "智能质检暂不可用（非成片内容判定），成片已保留但暂不进成片坞",
      raw,
      attempts: input.attempts,
      sourceKeyartId: input.sourceKeyartId,
      sourceKeyartUrl: input.referenceImageUrl,
      reviewedAt,
    };
  }
}
