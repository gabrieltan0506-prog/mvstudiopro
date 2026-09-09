import type { CanvasBlock } from "./canvasTypes";
import { mergeManhuaMediaVersions } from "./manhuaMediaVersions";
import { emptyManhuaClipQualityChecks } from "@shared/manhuaClipQuality";
import {
  MANHUA_SEGMENT_REFERENCE_KIND,
  MANHUA_SEGMENT_REFERENCE_LABEL_ZH,
  setManhuaSegmentReference,
  type ManhuaSegmentReferenceEntry,
  type ManhuaSegmentReferenceSlot,
} from "@shared/manhuaSegmentReference";
import type { CanvasAssetKind } from "./canvasTypes";

export const MANHUA_REGISTERED_CLIP_SUMMARY_ZH =
  "外部成片登记：未经智能质检；确认画面无误后在成片坞「未质检放行」即可合成";

/** 槽位与文件种类对不上时给出中文原因；对上返回 null。 */
export function manhuaSegmentReferenceKindError(
  slot: ManhuaSegmentReferenceSlot,
  kind: CanvasAssetKind | null,
): string | null {
  const need = MANHUA_SEGMENT_REFERENCE_KIND[slot];
  if (kind === need) return null;
  return `${MANHUA_SEGMENT_REFERENCE_LABEL_ZH[slot]}只收${need === "video" ? "视频（mp4/mov/webm）" : "音频（wav/mp3/m4a）"}`;
}

/**
 * 把外部已出好的成片登记为本段当前版本：
 * - 旧成片进版本历史（可切回，不丢付费产物）；
 * - 质检置 unverified：默认不进成片坞，用户看过后「未质检放行」；
 * - 清掉上一轮的在途任务、尾帧与重拍计数，避免把别的片子的状态套在这份上。
 */
export function registerManhuaExistingClip(
  block: CanvasBlock,
  entry: ManhuaSegmentReferenceEntry,
): CanvasBlock {
  const url = String(entry.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("登记成片需要可播放的 https 地址");
  }
  const withRef = setManhuaSegmentReference(block, "registered", entry);
  return {
    ...withRef,
    status: "done",
    error: undefined,
    outputUrl: url,
    outputUrls: mergeManhuaMediaVersions([url], [block.outputUrl, ...(block.outputUrls || [])]),
    lastFrameUrl: undefined,
    videoTaskId: undefined,
    videoTaskEngine: undefined,
    videoTaskStatus: undefined,
    manhuaRetake: undefined,
    manhuaClipQuality: {
      status: "unverified",
      checks: emptyManhuaClipQualityChecks(),
      failedKeys: [],
      summary: MANHUA_REGISTERED_CLIP_SUMMARY_ZH,
      raw: "",
      attempts: 0,
      reviewedAt: entry.updatedAt,
      userAcceptedDespiteQc: false,
    },
  };
}

export function manhuaSegmentReferenceSummary(block: Pick<CanvasBlock, "manhuaSegmentRefs">): {
  previs?: ManhuaSegmentReferenceEntry;
  master?: ManhuaSegmentReferenceEntry;
  registered?: ManhuaSegmentReferenceEntry;
} {
  return {
    previs: block.manhuaSegmentRefs?.previs,
    master: block.manhuaSegmentRefs?.master,
    registered: block.manhuaSegmentRefs?.registered,
  };
}
