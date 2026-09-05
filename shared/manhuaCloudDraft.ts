/**
 * 漫剧云端草稿：剧本、静帧与已有视频的恢复元数据；不存视频字节。
 */

import { normalizeManhuaTimelineOrder } from "./manhuaEditOrder.js";
import {
  buildManhuaWriterSession,
  migrateManhuaWriterTemplateId,
  type ManhuaWriterSession,
  type ManhuaWriterSessionPartial,
} from "./manhuaWriterSession.js";
import {
  normalizeManhuaFinalPostProdBinding,
  normalizeManhuaFinalVersionIdentities,
  type ManhuaFinalPostProdBinding,
  type ManhuaFinalVersionIdentity,
} from "./manhuaFinalPostProd.js";
import {
  MANHUA_CLIP_QUALITY_KEYS,
  emptyManhuaClipQualityChecks,
  type ManhuaClipQualityReport,
} from "./manhuaClipQuality.js";
import {
  isSeedance25EvolinkMode,
  type SeedanceEvolinkMode,
} from "./seedanceEvolinkModels.js";

export const MANHUA_CLOUD_DRAFT_FORMAT = "mv-manhua-cloud-draft-v1" as const;
/** 约 3.5MB JSON 上限，避免撑爆单行 */
export const MANHUA_CLOUD_DRAFT_MAX_CHARS = 3_500_000;
/** 云端草稿保留天数（按最近一次成功同步起算） */
export const MANHUA_CLOUD_DRAFT_RETENTION_DAYS = 30;

/** 工作台常驻：暂存口径 + 定时导出提醒（用户可见，零技术泄漏） */
export const MANHUA_DRAFT_RETENTION_HINT_ZH =
  "登录后会暂存约 30 天的剧本、静帧、画布与视频版本记录。视频链接可能过期，请下载原片备份；版本记录不等于永久视频存档。";

/** 成片坞导出旁短提示 */
export const MANHUA_DRAFT_EXPORT_HINT_ZH =
  "成片出完会自动下载到本机；建议再导出工程包备份剧本与静帧。平台暂存约 30 天，不成片仓库。";

export type ManhuaCloudDraftCanvasBlock = {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt: string;
  parentId?: string;
  episodeIndex?: number;
  episodeTitle?: string;
  status?: string;
  outputText?: string;
  /** 当前产物及历史地址；视频只保存引用，不内嵌字节。 */
  outputUrl?: string;
  outputUrls?: string[];
  refImageUrl?: string;
  /** 关键静帧融图参考（含站点相对 /manhua-* 路径） */
  editFusionUrls?: string[];
  /** 微调遮罩(三审 P1-1:不落它=换机后局部改图参考全丢) */
  editMaskUrl?: string;
  /** 上段末帧续拍锚(三审 P1-1) */
  lastFrameUrl?: string;
  imageMode?: string;
  aspectRatio?: string;
  /**
   * 成片引擎。不落这一项就只能在恢复时靠会话猜，猜错就是段表、时长和每段扣费一起变；
   * 节点盖的档必须原样带回来，不能根据视频来源猜档。
   */
  videoModel?: string;
  pathCameraRecipeId?: string;
  pathAnnotationJson?: unknown;
  /**
   * 长排队成片任务(Wan 公测等):taskId 必须随云草稿往返,换机/仅存云备份时
   * 也能恢复轮询并把晚到的成功回填原节点(复审 P1-3)。
   */
  videoTaskId?: string;
  videoTaskEngine?: string;
  videoTaskStatus?: string;
  /** 成片节点的真实裁切合同；视频字节不进草稿，但合成参数必须可恢复。 */
  manhuaEditTrim?: {
    /** 源视频真实总长；旧稿缺失时由客户端按已编译目标时长回退。 */
    sourceDurationSec?: number;
    inSec: number;
    outSec: number;
    shotPieces?: Array<{
      shotIndex: number;
      timelineOrder?: number;
      trimInSec: number;
      trimOutSec: number;
      durationSec: number;
    }>;
    updatedAt?: number;
  };
  /** final-eXX 的烧字任务身份与 GCS 长期身份。 */
  manhuaFinalPostProd?: ManhuaFinalPostProdBinding;
  manhuaFinalVersions?: ManhuaFinalVersionIdentity[];
  archivedFromPreviousScript?: boolean;
  /** 必须与当前视频一起保存，否则失败片恢复后会落入无报告历史放行分支。 */
  manhuaClipQuality?: ManhuaClipQualityReport;
  error?: string;
  refVideoUrl?: string;
  seedance25WorkMode?: SeedanceEvolinkMode;
  seedance25RefVideoUrls?: string[];
  seedance25RefAudioUrls?: string[];
  seedance25TimestampStoryboard?: string;
  seedance25ReshootFromSec?: number;
  seedance25ReshootToSec?: number;
  videoResolution?: "720p" | "1080p" | "2K" | "4K";
  manhuaRetake?: {
    variable:
      | "camera"
      | "performance"
      | "lighting"
      | "reference"
      | "duration"
      | "framing";
    attempt: number;
    maxAttempts: number;
  };
};

export type ManhuaCloudDraftEdge = { fromId: string; toId: string };

export type ManhuaCloudDraftPayload = {
  format: typeof MANHUA_CLOUD_DRAFT_FORMAT;
  /** 客户端本地修订时间 ISO */
  clientUpdatedAt: string;
  writerSession: ManhuaWriterSession;
  /** 只在读取旧草稿时出现；提示前端旧内部模板选择已安全清除。 */
  migration?: { clearedLegacyPrivateTemplate: true };
  canvas: {
    blocks: ManhuaCloudDraftCanvasBlock[];
    edges: ManhuaCloudDraftEdge[];
  };
  factoryPrefs?: Record<string, unknown> | null;
};

function isHttpUrl(u: unknown): u is string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s);
}

/** HTTPS 或站点内漫剧资产相对路径（垫图/融图必须能落盘，否则重开页就丢参考） */
function isPersistableAssetUrl(u: unknown): u is string {
  const s = String(u || "").trim();
  if (!s || s.startsWith("blob:") || s.startsWith("data:")) return false;
  if (/^https?:\/\//i.test(s)) return true;
  return (
    s.startsWith("/manhua-") ||
    s.startsWith("/assets/") ||
    s.startsWith("/demo/") ||
    s.startsWith("/public/") ||
    // 站内永久图链(现签现跳),生成图的云备份形态(复审 P0-1:过滤它=云备份/ZIP 全丢生成图)
    s.startsWith("/api/canvas-media/")
  );
}

function keepImageUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .map(u => String(u || "").trim())
    .filter(isPersistableAssetUrl)
    .slice(0, 16);
}

function keepHttpUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map(u => String(u || "").trim()).filter(isHttpUrl);
}

function optionalSeconds(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : undefined;
}

/** 坏报告不能被清成“无报告”后放行；完整原文保留，超限由整个草稿大小门拒绝。 */
function sanitizeVideoQuality(
  raw: unknown
): ManhuaClipQualityReport | undefined {
  if (raw == null) return undefined;
  const q =
    typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Partial<ManhuaClipQualityReport>)
      : {};
  const valid =
    ["pending", "passed", "failed", "unverified", "unverified_waived"].includes(
      String(q.status)
    ) &&
    MANHUA_CLIP_QUALITY_KEYS.every(
      key => typeof q.checks?.[key] === "boolean"
    ) &&
    Array.isArray(q.failedKeys) &&
    q.failedKeys.every(key => MANHUA_CLIP_QUALITY_KEYS.includes(key)) &&
    typeof q.summary === "string" &&
    typeof q.raw === "string" &&
    typeof q.reviewedAt === "string" &&
    typeof q.attempts === "number" &&
    Number.isFinite(q.attempts) &&
    q.attempts >= 0 &&
    (q.status !== "passed" ||
      (q.failedKeys!.length === 0 &&
        MANHUA_CLIP_QUALITY_KEYS.every(key => q.checks![key]))) &&
    (q.status !== "unverified_waived" || q.userAcceptedDespiteQc === true);
  if (!valid)
    return {
      status: "unverified",
      checks: emptyManhuaClipQualityChecks(),
      failedKeys: [],
      summary: "原质检记录不完整，请重新核验；视频与原记录已保留。",
      raw: typeof q.raw === "string" ? q.raw : JSON.stringify(raw),
      attempts: 0,
      reviewedAt: "",
    };
  return {
    status: q.status!,
    checks: { ...q.checks! },
    failedKeys: [...q.failedKeys!],
    summary: q.summary!,
    raw: q.raw!,
    reviewedAt: q.reviewedAt!,
    attempts: q.attempts!,
    ...(q.sourceKeyartId ? { sourceKeyartId: q.sourceKeyartId } : {}),
    ...(isPersistableAssetUrl(q.sourceKeyartUrl)
      ? { sourceKeyartUrl: q.sourceKeyartUrl }
      : {}),
    ...(typeof q.userAcceptedDespiteQc === "boolean"
      ? { userAcceptedDespiteQc: q.userAcceptedDespiteQc }
      : {}),
  };
}

/** 是否为成片/视频节点（媒体引用与图片分别清洗） */
export function isManhuaCloudDraftVideoBlock(block: {
  id?: string;
  kind?: string;
}): boolean {
  const id = String(block.id || "");
  const kind = String(block.kind || "");
  if (kind === "video") return true;
  if (/^(clip|omni_edit)-/i.test(id)) return true;
  return false;
}

/** 当前整集节点标识；历史归档节点不作为当前整集参与合成。 */
export function isManhuaCloudDraftFinalVideoBlock(block: {
  id?: string;
  kind?: string;
}): boolean {
  return (
    String(block.kind || "") === "video" &&
    /^final-e\d+$/i.test(String(block.id || ""))
  );
}

function sanitizeManhuaEditTrim(
  raw: unknown
): ManhuaCloudDraftCanvasBlock["manhuaEditTrim"] {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const inSec = Number(row.inSec);
  const outSec = Number(row.outSec);
  if (
    !Number.isFinite(inSec) ||
    !Number.isFinite(outSec) ||
    outSec - inSec < 0.5
  ) {
    return undefined;
  }
  const shotPieces = Array.isArray(row.shotPieces)
    ? row.shotPieces
        .filter(
          (piece): piece is Record<string, unknown> =>
            Boolean(piece) && typeof piece === "object"
        )
        .map(piece => {
          const p = piece as Record<string, unknown>;
          const trimInSec = Number(p.trimInSec);
          const trimOutSec = Number(p.trimOutSec);
          return {
            shotIndex: Math.floor(Number(p.shotIndex) || 0),
            ...(p.timelineOrder !== undefined
              ? { timelineOrder: normalizeManhuaTimelineOrder(p.timelineOrder) }
              : {}),
            trimInSec,
            trimOutSec,
            durationSec:
              Number(p.durationSec) || Math.max(0, trimOutSec - trimInSec),
          };
        })
        .filter(
          piece =>
            piece.shotIndex >= 1 &&
            Number.isFinite(piece.trimInSec) &&
            Number.isFinite(piece.trimOutSec) &&
            piece.trimOutSec - piece.trimInSec >= 0.5
        )
    : [];
  return {
    sourceDurationSec:
      Number.isFinite(Number(row.sourceDurationSec)) &&
      Number(row.sourceDurationSec) >= 0.5
        ? Number(row.sourceDurationSec)
        : undefined,
    inSec,
    outSec,
    shotPieces: shotPieces.length ? shotPieces : undefined,
    updatedAt: Math.max(0, Math.floor(Number(row.updatedAt) || 0)) || undefined,
  };
}

/**
 * 从画布块抽出可云存字段：视频引用/任务/质检同批保留，剔除本地 blob 和内嵌字节。
 */
export function sanitizeManhuaCloudDraftBlock(
  raw: unknown
): ManhuaCloudDraftCanvasBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = String(b.id || "").trim();
  if (!id) return null;
  const kind = String(b.kind || "text").trim() || "text";
  const retake = b.manhuaRetake as
    | Partial<NonNullable<ManhuaCloudDraftCanvasBlock["manhuaRetake"]>>
    | undefined;
  const base: ManhuaCloudDraftCanvasBlock = {
    id,
    kind,
    x: Math.round(Number(b.x) || 0),
    y: Math.round(Number(b.y) || 0),
    width: Math.max(120, Math.round(Number(b.width) || 420)),
    height: Math.max(120, Math.round(Number(b.height) || 360)),
    prompt: String(b.prompt || "").slice(0, 120_000),
    parentId: b.parentId != null ? String(b.parentId) : undefined,
    episodeIndex:
      typeof b.episodeIndex === "number" && b.episodeIndex >= 1
        ? Math.floor(b.episodeIndex)
        : undefined,
    episodeTitle:
      b.episodeTitle != null ? String(b.episodeTitle).slice(0, 120) : undefined,
    status: b.status != null ? String(b.status).slice(0, 24) : undefined,
    imageMode:
      b.imageMode != null ? String(b.imageMode).slice(0, 24) : undefined,
    aspectRatio:
      b.aspectRatio === "16:9" || b.aspectRatio === "9:16"
        ? b.aspectRatio
        : undefined,
    videoModel:
      b.videoModel != null ? String(b.videoModel).slice(0, 48) : undefined,
    pathCameraRecipeId:
      b.pathCameraRecipeId != null
        ? String(b.pathCameraRecipeId).slice(0, 80)
        : undefined,
    pathAnnotationJson: b.pathAnnotationJson,
    videoTaskId:
      b.videoTaskId != null ? String(b.videoTaskId).slice(0, 80) : undefined,
    videoTaskEngine:
      b.videoTaskEngine != null
        ? String(b.videoTaskEngine).slice(0, 40)
        : undefined,
    videoTaskStatus:
      b.videoTaskStatus != null
        ? String(b.videoTaskStatus).slice(0, 40)
        : undefined,
    manhuaEditTrim: sanitizeManhuaEditTrim(b.manhuaEditTrim),
    manhuaFinalPostProd: normalizeManhuaFinalPostProdBinding(
      b.manhuaFinalPostProd
    ),
    manhuaFinalVersions: normalizeManhuaFinalVersionIdentities(
      b.manhuaFinalVersions
    ),
    archivedFromPreviousScript:
      b.archivedFromPreviousScript === true ? true : undefined,
    videoResolution: ["720p", "1080p", "2K", "4K"].includes(
      String(b.videoResolution)
    )
      ? (b.videoResolution as ManhuaCloudDraftCanvasBlock["videoResolution"])
      : undefined,
    manhuaRetake:
      retake &&
      [
        "camera",
        "performance",
        "lighting",
        "reference",
        "duration",
        "framing",
      ].includes(String(retake.variable))
        ? {
            variable: retake.variable!,
            attempt: Math.max(1, Math.floor(Number(retake.attempt) || 1)),
            maxAttempts: Math.max(
              1,
              Math.floor(Number(retake.maxAttempts) || 3)
            ),
          }
        : undefined,
  };

  if (isManhuaCloudDraftVideoBlock(base)) {
    const outputUrls = keepHttpUrls(b.outputUrls);
    const outputUrl = isHttpUrl(b.outputUrl)
      ? String(b.outputUrl).trim()
      : undefined;
    return {
      ...base,
      // 有原片不代表本次编辑成功；运行/失败/人工核对状态必须原样恢复。
      status: base.status === "done" && !outputUrl ? "idle" : base.status,
      outputUrl,
      outputUrls:
        outputUrl && !outputUrls.includes(outputUrl)
          ? [outputUrl, ...outputUrls]
          : outputUrls,
      error: typeof b.error === "string" ? b.error : undefined,
      manhuaClipQuality: sanitizeVideoQuality(b.manhuaClipQuality),
      refVideoUrl: isHttpUrl(b.refVideoUrl)
        ? String(b.refVideoUrl).trim()
        : undefined,
      seedance25WorkMode: isSeedance25EvolinkMode(b.seedance25WorkMode)
        ? b.seedance25WorkMode
        : undefined,
      seedance25RefVideoUrls: keepHttpUrls(b.seedance25RefVideoUrls),
      seedance25RefAudioUrls: keepHttpUrls(b.seedance25RefAudioUrls),
      seedance25TimestampStoryboard:
        typeof b.seedance25TimestampStoryboard === "string"
          ? b.seedance25TimestampStoryboard
          : undefined,
      seedance25ReshootFromSec: optionalSeconds(b.seedance25ReshootFromSec),
      seedance25ReshootToSec: optionalSeconds(b.seedance25ReshootToSec),
      refImageUrl: isPersistableAssetUrl(b.refImageUrl)
        ? String(b.refImageUrl).trim()
        : undefined,
      editFusionUrls: keepImageUrls(b.editFusionUrls),
      lastFrameUrl: isPersistableAssetUrl(b.lastFrameUrl)
        ? String(b.lastFrameUrl).trim()
        : undefined,
    };
  }

  const outputUrls = keepImageUrls(b.outputUrls);
  const outputUrl = isPersistableAssetUrl(b.outputUrl)
    ? String(b.outputUrl).trim()
    : outputUrls[0];
  const refImageUrl = isPersistableAssetUrl(b.refImageUrl)
    ? String(b.refImageUrl).trim()
    : undefined;
  const editFusionUrls = keepImageUrls(b.editFusionUrls)
    .filter(u => u !== refImageUrl)
    .slice(0, 15);
  const outputText =
    kind === "text" || kind === "copy_organize" || kind === "video_reverse"
      ? String(b.outputText || "").slice(0, 200_000) || undefined
      : undefined;

  return {
    ...base,
    outputText,
    outputUrl,
    outputUrls:
      outputUrl && !outputUrls.includes(outputUrl)
        ? [outputUrl, ...outputUrls]
        : outputUrls,
    refImageUrl,
    editFusionUrls: editFusionUrls.length ? editFusionUrls : undefined,
    editMaskUrl: isPersistableAssetUrl(b.editMaskUrl)
      ? String(b.editMaskUrl).trim()
      : undefined,
    lastFrameUrl: isPersistableAssetUrl(b.lastFrameUrl)
      ? String(b.lastFrameUrl).trim()
      : undefined,
  };
}

export function buildManhuaCloudDraftPayload(input: {
  clientUpdatedAt?: string | Date;
  writerSession: ManhuaWriterSessionPartial;
  blocks: unknown[];
  edges: unknown[];
  factoryPrefs?: Record<string, unknown> | null;
}): ManhuaCloudDraftPayload {
  const clientUpdatedAt = new Date(
    input.clientUpdatedAt || Date.now()
  ).toISOString();
  const blocks = (input.blocks || [])
    .map(b => sanitizeManhuaCloudDraftBlock(b))
    .filter((b): b is ManhuaCloudDraftCanvasBlock => Boolean(b));
  const edges = (input.edges || [])
    .map(e => {
      if (!e || typeof e !== "object") return null;
      const o = e as { fromId?: unknown; toId?: unknown };
      const fromId = String(o.fromId || "").trim();
      const toId = String(o.toId || "").trim();
      if (!fromId || !toId) return null;
      return { fromId, toId };
    })
    .filter((e): e is ManhuaCloudDraftEdge => Boolean(e));

  const templateMigration = migrateManhuaWriterTemplateId(input.writerSession);
  return {
    format: MANHUA_CLOUD_DRAFT_FORMAT,
    clientUpdatedAt,
    writerSession: buildManhuaWriterSession(input.writerSession),
    migration: templateMigration.clearedLegacyPrivateTemplate
      ? { clearedLegacyPrivateTemplate: true }
      : undefined,
    canvas: { blocks, edges },
    factoryPrefs: input.factoryPrefs || null,
  };
}

export function parseManhuaCloudDraftPayload(
  raw: unknown
): ManhuaCloudDraftPayload | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Partial<ManhuaCloudDraftPayload>;
  if (o.format !== MANHUA_CLOUD_DRAFT_FORMAT) return null;
  const clientUpdatedAt = String(o.clientUpdatedAt || "").trim();
  if (!clientUpdatedAt || Number.isNaN(Date.parse(clientUpdatedAt)))
    return null;
  const rawWriterSession = o.writerSession || {};
  const templateMigration = migrateManhuaWriterTemplateId(rawWriterSession);
  const writerSession = buildManhuaWriterSession(rawWriterSession);
  const blocks = Array.isArray(o.canvas?.blocks)
    ? o
        .canvas!.blocks.map(b => sanitizeManhuaCloudDraftBlock(b))
        .filter((b): b is ManhuaCloudDraftCanvasBlock => Boolean(b))
    : [];
  const edges = Array.isArray(o.canvas?.edges)
    ? o
        .canvas!.edges.map(e => {
          const fromId = String(
            (e as ManhuaCloudDraftEdge)?.fromId || ""
          ).trim();
          const toId = String((e as ManhuaCloudDraftEdge)?.toId || "").trim();
          return fromId && toId ? { fromId, toId } : null;
        })
        .filter((e): e is ManhuaCloudDraftEdge => Boolean(e))
    : [];
  return {
    format: MANHUA_CLOUD_DRAFT_FORMAT,
    clientUpdatedAt,
    writerSession,
    migration: templateMigration.clearedLegacyPrivateTemplate
      ? { clearedLegacyPrivateTemplate: true }
      : undefined,
    canvas: { blocks, edges },
    factoryPrefs:
      o.factoryPrefs && typeof o.factoryPrefs === "object"
        ? (o.factoryPrefs as Record<string, unknown>)
        : null,
  };
}

export function serializeManhuaCloudDraftPayload(
  payload: ManhuaCloudDraftPayload
): string {
  return JSON.stringify(payload);
}

export function manhuaCloudDraftPayloadSizeOk(serialized: string): boolean {
  return (
    serialized.length > 0 && serialized.length <= MANHUA_CLOUD_DRAFT_MAX_CHARS
  );
}

/** 云端修订是否比本机更新（相等时视为云端优先，便于跨设备拉取） */
export function isManhuaCloudDraftNewer(
  cloudIso: string,
  localIso: string | null | undefined
): boolean {
  const c = Date.parse(cloudIso);
  if (!Number.isFinite(c)) return false;
  const l = Date.parse(String(localIso || ""));
  if (!Number.isFinite(l)) return true;
  return c >= l;
}

/** 是否超过保留窗口（默认 30 天，按最近活动时间） */
export function isManhuaCloudDraftExpired(
  lastActivityIso: string | Date | null | undefined,
  nowMs: number = Date.now(),
  retentionDays: number = MANHUA_CLOUD_DRAFT_RETENTION_DAYS
): boolean {
  const t =
    lastActivityIso instanceof Date
      ? lastActivityIso.getTime()
      : Date.parse(String(lastActivityIso || ""));
  if (!Number.isFinite(t)) return true;
  const windowMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  return nowMs - t > windowMs;
}
