/**
 * 漫剧云端草稿：分集剧本 + 静帧；刻意不落成片视频。
 */

import {
  buildManhuaWriterSession,
  type ManhuaWriterSession,
  type ManhuaWriterSessionPartial,
} from "./manhuaWriterSession.js";

export const MANHUA_CLOUD_DRAFT_FORMAT = "mv-manhua-cloud-draft-v1" as const;
/** 约 3.5MB JSON 上限，避免撑爆单行 */
export const MANHUA_CLOUD_DRAFT_MAX_CHARS = 3_500_000;
/** 云端草稿保留天数（按最近一次成功同步起算） */
export const MANHUA_CLOUD_DRAFT_RETENTION_DAYS = 30;

/** 工作台常驻：暂存口径 + 定时导出提醒（用户可见，零技术泄漏） */
export const MANHUA_DRAFT_RETENTION_HINT_ZH =
  "登录后会暂存约 30 天的剧本、静帧与画布（不含成片视频）。请定时导出备份，勿只依赖自动保存。";

/** 成片坞导出旁短提示 */
export const MANHUA_DRAFT_EXPORT_HINT_ZH =
  "建议重要节点导出工程包；平台暂存约 30 天，成片视频不在云端保留。";

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
  /** 静帧 / 图片节点产物（可多张） */
  outputUrl?: string;
  outputUrls?: string[];
  refImageUrl?: string;
  /** 关键静帧融图参考（含站点相对 /manhua-* 路径） */
  editFusionUrls?: string[];
  imageMode?: string;
  aspectRatio?: string;
  pathCameraRecipeId?: string;
  pathAnnotationJson?: unknown;
};

export type ManhuaCloudDraftEdge = { fromId: string; toId: string };

export type ManhuaCloudDraftPayload = {
  format: typeof MANHUA_CLOUD_DRAFT_FORMAT;
  /** 客户端本地修订时间 ISO */
  clientUpdatedAt: string;
  writerSession: ManhuaWriterSession;
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
    s.startsWith("/public/")
  );
}

function keepImageUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map((u) => String(u || "").trim()).filter(isPersistableAssetUrl).slice(0, 16);
}

/** 是否为成片/视频节点（云端不存其产物） */
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

/**
 * 从画布块抽出可云存字段：保留文本与静帧图 URL，剔除视频产物与本地 blob。
 */
export function sanitizeManhuaCloudDraftBlock(raw: unknown): ManhuaCloudDraftCanvasBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = String(b.id || "").trim();
  if (!id) return null;
  const kind = String(b.kind || "text").trim() || "text";
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
    episodeTitle: b.episodeTitle != null ? String(b.episodeTitle).slice(0, 120) : undefined,
    status: b.status != null ? String(b.status).slice(0, 24) : undefined,
    imageMode: b.imageMode != null ? String(b.imageMode).slice(0, 24) : undefined,
    aspectRatio: b.aspectRatio === "16:9" || b.aspectRatio === "9:16" ? b.aspectRatio : undefined,
    pathCameraRecipeId:
      b.pathCameraRecipeId != null ? String(b.pathCameraRecipeId).slice(0, 80) : undefined,
    pathAnnotationJson: b.pathAnnotationJson,
  };

  if (isManhuaCloudDraftVideoBlock(base)) {
    // 保留节点壳与提示词，不落视频 URL
    return {
      ...base,
      status: base.status === "done" ? "idle" : base.status,
      outputText: undefined,
      outputUrl: undefined,
      outputUrls: [],
      refImageUrl: isPersistableAssetUrl(b.refImageUrl)
        ? String(b.refImageUrl).trim()
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
  const editFusionUrls = keepImageUrls(b.editFusionUrls).filter((u) => u !== refImageUrl).slice(0, 15);
  const outputText =
    kind === "text" || kind === "copy_organize" || kind === "video_reverse"
      ? String(b.outputText || "").slice(0, 200_000) || undefined
      : undefined;

  return {
    ...base,
    outputText,
    outputUrl,
    outputUrls: outputUrl && !outputUrls.includes(outputUrl) ? [outputUrl, ...outputUrls] : outputUrls,
    refImageUrl,
    editFusionUrls: editFusionUrls.length ? editFusionUrls : undefined,
  };
}

export function buildManhuaCloudDraftPayload(input: {
  clientUpdatedAt?: string | Date;
  writerSession: ManhuaWriterSessionPartial;
  blocks: unknown[];
  edges: unknown[];
  factoryPrefs?: Record<string, unknown> | null;
}): ManhuaCloudDraftPayload {
  const clientUpdatedAt = new Date(input.clientUpdatedAt || Date.now()).toISOString();
  const blocks = (input.blocks || [])
    .map((b) => sanitizeManhuaCloudDraftBlock(b))
    .filter((b): b is ManhuaCloudDraftCanvasBlock => Boolean(b))
    .slice(0, 400);
  const edges = (input.edges || [])
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const o = e as { fromId?: unknown; toId?: unknown };
      const fromId = String(o.fromId || "").trim();
      const toId = String(o.toId || "").trim();
      if (!fromId || !toId) return null;
      return { fromId, toId };
    })
    .filter((e): e is ManhuaCloudDraftEdge => Boolean(e))
    .slice(0, 800);

  return {
    format: MANHUA_CLOUD_DRAFT_FORMAT,
    clientUpdatedAt,
    writerSession: buildManhuaWriterSession(input.writerSession),
    canvas: { blocks, edges },
    factoryPrefs: input.factoryPrefs || null,
  };
}

export function parseManhuaCloudDraftPayload(raw: unknown): ManhuaCloudDraftPayload | null {
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
  if (!clientUpdatedAt || Number.isNaN(Date.parse(clientUpdatedAt))) return null;
  const writerSession = buildManhuaWriterSession(o.writerSession || {});
  const blocks = Array.isArray(o.canvas?.blocks)
    ? o.canvas!.blocks
        .map((b) => sanitizeManhuaCloudDraftBlock(b))
        .filter((b): b is ManhuaCloudDraftCanvasBlock => Boolean(b))
    : [];
  const edges = Array.isArray(o.canvas?.edges)
    ? o.canvas!.edges
        .map((e) => {
          const fromId = String((e as ManhuaCloudDraftEdge)?.fromId || "").trim();
          const toId = String((e as ManhuaCloudDraftEdge)?.toId || "").trim();
          return fromId && toId ? { fromId, toId } : null;
        })
        .filter((e): e is ManhuaCloudDraftEdge => Boolean(e))
    : [];
  return {
    format: MANHUA_CLOUD_DRAFT_FORMAT,
    clientUpdatedAt,
    writerSession,
    canvas: { blocks, edges },
    factoryPrefs:
      o.factoryPrefs && typeof o.factoryPrefs === "object"
        ? (o.factoryPrefs as Record<string, unknown>)
        : null,
  };
}

export function serializeManhuaCloudDraftPayload(payload: ManhuaCloudDraftPayload): string {
  return JSON.stringify(payload);
}

export function manhuaCloudDraftPayloadSizeOk(serialized: string): boolean {
  return serialized.length > 0 && serialized.length <= MANHUA_CLOUD_DRAFT_MAX_CHARS;
}

/** 云端修订是否比本机更新（相等时视为云端优先，便于跨设备拉取） */
export function isManhuaCloudDraftNewer(cloudIso: string, localIso: string | null | undefined): boolean {
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
  retentionDays: number = MANHUA_CLOUD_DRAFT_RETENTION_DAYS,
): boolean {
  const t =
    lastActivityIso instanceof Date
      ? lastActivityIso.getTime()
      : Date.parse(String(lastActivityIso || ""));
  if (!Number.isFinite(t)) return true;
  const windowMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  return nowMs - t > windowMs;
}
