import { defaultCanvasBlock, isCanvasProductVideoModel, makeCanvasBlockId, type CanvasBlock } from "./canvasTypes";
import { buildManhuaAutoSegmentBinding } from "@shared/manhuaAutoSegment";
import type { ManhuaWorkbenchSegment } from "@shared/manhuaScriptWorkbench";
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

/** 当前剧本尚无逐镜静帧时，也能把已有视频登记到准确的集/段修订身份。 */
export function createManhuaRegisteredSegmentClip(input: {
  episodeIndex: number;
  episodeTitle?: string;
  segment: ManhuaWorkbenchSegment;
  videoModel: string;
  parent?: CanvasBlock;
  entry: ManhuaSegmentReferenceEntry;
}): CanvasBlock {
  const { episodeIndex, episodeTitle, segment, videoModel, parent, entry } = input;
  const block = defaultCanvasBlock("video", (parent?.x ?? 0) + 220, parent?.y ?? 0);
  const sourceDurationSec = Number(entry.durationSec);
  if (!Number.isFinite(sourceDurationSec) || sourceDurationSec <= 0) {
    throw new Error("登记成片需要可读取的视频时长");
  }
  if (!isCanvasProductVideoModel(videoModel)) {
    throw new Error("登记成片需要有效的当前成片引擎");
  }
  return registerManhuaExistingClip({
    ...block,
    id: makeCanvasBlockId(`clip-e${String(episodeIndex).padStart(2, "0")}-g${String(segment.index).padStart(2, "0")}-registered`),
    episodeIndex,
    episodeTitle,
    parentId: parent?.id,
    videoModel,
    prompt: `第${episodeIndex}集第${segment.index}段·外部成片登记`,
    manhuaAutoSegment: buildManhuaAutoSegmentBinding(episodeIndex, segment, videoModel),
    manhuaEditTrim: {
      sourceDurationSec,
      inSec: 0,
      outSec: Math.min(sourceDurationSec, segment.durationSec),
    },
  }, entry);
}

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
  // 同步进上传记录（带 gcsUri）：出片前的统一重签只认 uploadedAssets，
  // 否则登记链 60 分钟过期后本段重跑/接力都拿不到新链。
  const registeredAsset = {
    id: `registered-clip-${Date.now()}`,
    url,
    previewUrl: url,
    fileName: entry.fileName || "registered-clip.mp4",
    gcsUri: entry.gcsUri,
    kind: "video" as const,
    mimeType: "video/mp4",
  };
  const uploadedAssets = [
    ...(block.uploadedAssets || []).filter(
      (asset) =>
        !asset.id.startsWith("registered-clip-") &&
        (!entry.gcsUri || asset.gcsUri !== entry.gcsUri) &&
        asset.url !== url,
    ),
    registeredAsset,
  ];
  return {
    ...withRef,
    uploadedAssets,
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

/** 浏览器里探媒体时长（音视频都走 HTMLMediaElement）；探不到返回 undefined，不挡上传。 */
export function probeMediaFileDurationSec(file: File, timeoutMs = 8000): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
      resolve(undefined);
      return;
    }
    const isAudio = String(file.type || "").startsWith("audio/") || /\.(wav|mp3|m4a|aac)$/i.test(file.name);
    const el = document.createElement(isAudio ? "audio" : "video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        // 释放失败不影响结果
      }
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(undefined), timeoutMs);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = Number(el.duration);
      finish(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : undefined);
    };
    el.onerror = () => finish(undefined);
    el.src = objectUrl;
  });
}
