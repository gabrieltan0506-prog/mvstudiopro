/**
 * 剪辑台：成片气口建议切点（客户端）。
 */
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import type { ManhuaFineCutByShot, ManhuaFineCutTrim } from "@shared/manhuaEditFineCut";

export async function suggestManhuaClipCuts(input: {
  videoUrl: string;
  shots?: Array<{ shotIndex: number; durationSec: number }>;
}): Promise<{
  durationSec: number;
  segmentTrim: ManhuaFineCutTrim;
  segmentLabelZh: string;
  fineCutByShot: ManhuaFineCutByShot;
}> {
  const url = withLongJobsFlyDirect("/api/jobs?op=suggestClipCuts");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({
      videoUrl: input.videoUrl,
      shots: input.shots || [],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    durationSec?: number;
    segmentTrim?: ManhuaFineCutTrim;
    segmentLabelZh?: string;
    fineCutByShot?: ManhuaFineCutByShot;
    error?: string;
  };
  if (!res.ok || !json.segmentTrim) {
    throw new Error(json.error || "切点分析失败");
  }
  return {
    durationSec: Number(json.durationSec) || 0,
    segmentTrim: json.segmentTrim,
    segmentLabelZh: String(json.segmentLabelZh || "").trim() || "已生成建议切点",
    fineCutByShot: json.fineCutByShot && typeof json.fineCutByShot === "object"
      ? json.fineCutByShot
      : {},
  };
}
