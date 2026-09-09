/**
 * 漫剧工厂 · 段级参考（0908 墨菁传 30 秒试片验证过的工艺搬进正式链路）。
 *
 * 每个成片段（clip-eXX-gYY）可以挂两份用户自备的参考：
 * - previs：Blender/白模站位视频。只锁人物走位、景别切换与机位运动的秒位；
 *   灰色人偶与空白场景不进画面，外观全部由 @图片N 与正文决定。
 * - master：对白 + BGM 已预混的单条母轨（≤30 s）。它就是本片最终音轨，
 *   画面与它严格同步，不再另配对白/配乐（避免多轨相加超过供应商 30 s 上限）。
 *
 * 为什么不直接写进 seedance25RefVideoUrls / seedance25RefAudioUrls：
 * 局部视频编辑（video_edit）会把原片写进 seedance25RefVideoUrls 并在结束后清空，
 * 段级白模若放在同一数组里，做过一次编辑就会被清掉。这里单独一个字段，
 * 出片时由 canvasRunBlock 按模式决定是否注入。
 *
 * 另外登记一份 registered：用户在外部（自由画布/其他工具）已经出好的本段成片，
 * 登记进本段后与工厂生成的成片同等对待（可质检放行、可局部编辑、可进成片坞）。
 */

export type ManhuaSegmentReferenceSlot = "previs" | "master" | "registered";

export type ManhuaSegmentReferenceEntry = {
  /** 可直接播放/提交的 HTTPS 地址（上传件为 60 分钟签名链，出片前按 gcsUri 重签） */
  url: string;
  /** 系统桶对象地址（gs://…/uploads/u<id>/…），有它才能过期后重签 */
  gcsUri?: string;
  fileName?: string;
  /** 上传时探到的媒体时长；各引擎按它做上限判断（2.5 ≤30 s，Wan 3.0 ≤15 s） */
  durationSec?: number;
  updatedAt: string;
};

export type ManhuaSegmentReferences = Partial<
  Record<ManhuaSegmentReferenceSlot, ManhuaSegmentReferenceEntry>
>;

export const MANHUA_SEGMENT_REFERENCE_LABEL_ZH: Record<ManhuaSegmentReferenceSlot, string> = {
  previs: "白模站位",
  master: "预混母轨",
  registered: "已有成片",
};

export const MANHUA_SEGMENT_REFERENCE_ACCEPT: Record<ManhuaSegmentReferenceSlot, string> = {
  previs: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm",
  master: "audio/wav,audio/mpeg,audio/mp4,audio/aac,.wav,.mp3,.m4a,.aac",
  registered: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm",
};

/** 槽位要求的素材种类；与 canvasUpload.inferCanvasAssetKind 的口径一致 */
export const MANHUA_SEGMENT_REFERENCE_KIND: Record<ManhuaSegmentReferenceSlot, "video" | "audio"> = {
  previs: "video",
  master: "audio",
  registered: "video",
};

const SLOTS: ManhuaSegmentReferenceSlot[] = ["previs", "master", "registered"];

function isHttpsUrl(value: unknown): value is string {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isGcsUri(value: unknown): value is string {
  return /^gs:\/\/[^/]+\/.+/i.test(String(value || "").trim());
}

export function normalizeManhuaSegmentReferenceEntry(
  raw: unknown,
): ManhuaSegmentReferenceEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const url = String(r.url || "").trim();
  const gcsUri = isGcsUri(r.gcsUri) ? String(r.gcsUri).trim() : undefined;
  // 没有可重签的 gcsUri 时，url 必须是 https；有 gcsUri 时允许 url 过期后再签。
  if (!isHttpsUrl(url) && !gcsUri) return undefined;
  const updatedAt = String(r.updatedAt || "").trim();
  return {
    url: isHttpsUrl(url) ? url : "",
    gcsUri,
    fileName: r.fileName != null ? String(r.fileName).slice(0, 200) : undefined,
    durationSec:
      typeof r.durationSec === "number" && Number.isFinite(r.durationSec) && r.durationSec > 0
        ? Math.round(r.durationSec * 1000) / 1000
        : undefined,
    updatedAt: updatedAt || new Date(0).toISOString(),
  };
}

/** 云端草稿 / 本地落盘的白名单入口：非法项丢弃，全空返回 undefined。 */
export function normalizeManhuaSegmentReferences(
  raw: unknown,
): ManhuaSegmentReferences | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: ManhuaSegmentReferences = {};
  for (const slot of SLOTS) {
    const entry = normalizeManhuaSegmentReferenceEntry(r[slot]);
    if (entry) out[slot] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

export function setManhuaSegmentReference<
  T extends { manhuaSegmentRefs?: ManhuaSegmentReferences },
>(block: T, slot: ManhuaSegmentReferenceSlot, entry: ManhuaSegmentReferenceEntry | null): T {
  const next: ManhuaSegmentReferences = { ...(block.manhuaSegmentRefs || {}) };
  if (entry) next[slot] = entry;
  else delete next[slot];
  return {
    ...block,
    manhuaSegmentRefs: Object.keys(next).length ? next : undefined,
  };
}

/**
 * 出片提示词里的段参考引导句。@视频N / @音频N 的序号由调用方按实际提交数组位置算，
 * 不能写死 1：clip 段还会有上段末尾接力视频排在后面。
 */
export function formatManhuaSegmentReferenceGuideZh(input: {
  previsVideoIndex?: number;
  masterAudioIndex?: number;
}): string {
  const lines: string[] = [];
  if (input.previsVideoIndex && input.previsVideoIndex > 0) {
    lines.push(
      `【段参考·白模】@视频${input.previsVideoIndex}是本段站位白模：严格按它的秒位复刻人物走位、全景近景特写的景别切换与推拉摇移环绕切镜的机位运动；灰色人偶、空白场景与网格一律不进画面，人物外观、服装、场景只按@图片N与正文。`,
    );
  }
  if (input.masterAudioIndex && input.masterAudioIndex > 0) {
    lines.push(
      `【段参考·母轨】@音频${input.masterAudioIndex}就是本片最终音轨，对白与配乐已预混：口型、动作与它逐秒严格同步，不再另配对白、配乐或旁白，成片时长以它为准。`,
    );
  }
  return lines.join("\n");
}

/**
 * 引擎参考时长上限（知识库《引擎调用参数对照》《WaveSpeed》）：
 * Seedance 2.5 单条/总长 ≤30 s；Wan 3.0 参考视频、参考音频各总长 ≤15 s；
 * Seedance 2.0 系走 OpenRouter，视频/音频各 ≤3 条，按 30 s 计。
 */
export const MANHUA_SEGMENT_REFERENCE_CAP_SEC = { seedance: 30, wan30: 15 } as const;

/**
 * 时长未知时只在上限 ≥30 s 的引擎放行（2.5 实测能吃 30 s 白模）；
 * Wan 3.0 这类 15 s 上限的，未探到时长一律不送，避免整单被拒。
 */
export function manhuaSegmentReferenceFitsCap(
  entry: ManhuaSegmentReferenceEntry | undefined,
  capSec: number,
): entry is ManhuaSegmentReferenceEntry {
  if (!entry) return false;
  if (entry.durationSec == null) return capSec >= MANHUA_SEGMENT_REFERENCE_CAP_SEC.seedance;
  return entry.durationSec <= capSec + 0.05;
}
