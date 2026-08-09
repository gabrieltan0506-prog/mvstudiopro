/**
 * 漫剧草稿双通路同步：本机 localStorage + 登录云端。
 * 任一侧失败都不放弃另一侧；恢复时用较新副本补写较弱一侧。
 */

import {
  buildManhuaCloudDraftPayload,
  isManhuaCloudDraftNewer,
  isManhuaCloudDraftVideoBlock,
  manhuaCloudDraftPayloadSizeOk,
  serializeManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "@shared/manhuaCloudDraft";
import {
  buildManhuaWriterSession,
  loadManhuaWriterSessionFromStorage,
  saveManhuaWriterSessionToStorage,
  type ManhuaWriterSession,
  type ManhuaWriterSessionPartial,
} from "@shared/manhuaWriterSession";
import { MANHUA_FACTORY_DEFAULT_VIDEO_MODEL } from "@shared/manhuaScriptWorkbench";
import {
  normalizeCanvasBlock,
  normalizeCanvasVideoModel,
  type CanvasBlock,
  type CanvasBlockKind,
  type CanvasEdge,
} from "@/lib/canvasTypes";
import {
  applyLocalMediaPointersToBlocks,
  isLocalMediaPointer,
  resolveUrlForCloudSync,
  resolveUrlForLocalPersist,
  scheduleCacheCanvasMediaToLocalStore,
} from "@/lib/manhuaLocalMediaStore";

export const MANHUA_CLOUD_DRAFT_LOCAL_AT_KEY = "mv-manhua-cloud-draft-local-at-v1";
export const MANHUA_CLOUD_DRAFT_SYNC_DEBOUNCE_MS = 2500;

const CANVAS_LS_KEY = "mv-freeform-canvas-v1";
const FACTORY_PREFS_LS_KEY = "mv-manhua-factory-character-prefs-v1";

const KIND_OK = new Set<CanvasBlockKind>([
  "text",
  "image",
  "video",
  "copy_organize",
  "video_reverse",
]);

export type ManhuaLocalPersistResult = {
  writerOk: boolean;
  canvasOk: boolean;
  prefsOk: boolean;
  atOk: boolean;
  /** 任一本机写入成功即为 true */
  anyLocalOk: boolean;
};

export function tryLoadLocalClientUpdatedAt(
  storage: Pick<Storage, "getItem"> = localStorage,
): string | null {
  try {
    const raw = storage.getItem(MANHUA_CLOUD_DRAFT_LOCAL_AT_KEY);
    if (!raw) return null;
    const iso = String(raw).trim();
    return Number.isFinite(Date.parse(iso)) ? iso : null;
  } catch {
    return null;
  }
}

export function trySaveLocalClientUpdatedAt(
  iso: string,
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  try {
    storage.setItem(MANHUA_CLOUD_DRAFT_LOCAL_AT_KEY, iso);
    return true;
  } catch {
    return false;
  }
}

export function tryLoadLocalCanvas(
  storage: Pick<Storage, "getItem"> = localStorage,
): { blocks: CanvasBlock[]; edges: CanvasEdge[] } | null {
  try {
    const raw = storage.getItem(CANVAS_LS_KEY);
    if (!raw) return { blocks: [], edges: [] };
    const parsed = JSON.parse(raw) as { blocks?: CanvasBlock[]; edges?: CanvasEdge[] };
    return {
      blocks: (parsed.blocks || []).map((b) => normalizeCanvasBlock(b as CanvasBlock)),
      edges: parsed.edges || [],
    };
  } catch {
    return null;
  }
}

function isHttpUrl(u: unknown): boolean {
  return /^https?:\/\//i.test(String(u || "").trim());
}

/** 本机落盘可保留：HTTPS / 站点垫图 / local-media 指针（二进制在 IndexedDB） */
function isPersistableAssetUrl(u: unknown): boolean {
  const s = String(u || "").trim();
  if (!s || s.startsWith("blob:") || s.startsWith("data:")) return false;
  if (isLocalMediaPointer(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  return s.startsWith("/manhua-") || s.startsWith("/assets/") || s.startsWith("/demo/");
}

function persistableLocalUrl(u: unknown): string | undefined {
  const mapped = resolveUrlForLocalPersist(u);
  if (mapped && isPersistableAssetUrl(mapped)) return mapped;
  if (isPersistableAssetUrl(u)) return String(u).trim();
  return undefined;
}

/** 本机落盘瘦身：去视频产物与 blob；已缓存图改写为 local-media: 指针 */
export function slimBlocksForLocalPersist(blocks: CanvasBlock[]): CanvasBlock[] {
  const pointed = applyLocalMediaPointersToBlocks(blocks);
  return pointed.map((b) => {
    if (isManhuaCloudDraftVideoBlock(b)) {
      return {
        ...b,
        outputUrl: undefined,
        outputUrls: [],
        refVideoUrl: undefined,
        status: b.status === "done" ? "idle" : b.status,
        error: undefined,
      };
    }
    const outputUrls = (b.outputUrls || [])
      .map((u) => persistableLocalUrl(u))
      .filter((u): u is string => Boolean(u))
      .slice(0, 8);
    const outputUrl = persistableLocalUrl(b.outputUrl) || outputUrls[0];
    return {
      ...b,
      outputUrl,
      outputUrls: outputUrl && !outputUrls.includes(outputUrl) ? [outputUrl, ...outputUrls] : outputUrls,
      refImageUrl: persistableLocalUrl(b.refImageUrl),
      uploadedAssets: [],
      uploadFailures: undefined,
      editMaskUrl: persistableLocalUrl(b.editMaskUrl),
      editFusionUrls: (b.editFusionUrls || [])
        .map((u) => persistableLocalUrl(u))
        .filter((u): u is string => Boolean(u))
        .slice(0, 15),
      lastFrameUrl: persistableLocalUrl(b.lastFrameUrl),
      manhuaRetake: b.manhuaRetake,
    };
  });
}

/** 云同步前：blob:/local-media: → 溯源 https（有则带上；无则留给本机库） */
export function blocksForCloudDraftSync(blocks: CanvasBlock[]): CanvasBlock[] {
  return blocks.map((b) => {
    if (isManhuaCloudDraftVideoBlock(b)) {
      return {
        ...b,
        outputUrl: undefined,
        outputUrls: [],
        refImageUrl: resolveUrlForCloudSync(b.refImageUrl),
      };
    }
    const outputUrls = (b.outputUrls || [])
      .map((u) => resolveUrlForCloudSync(u))
      .filter((u): u is string => Boolean(u))
      .slice(0, 8);
    const outputUrl = resolveUrlForCloudSync(b.outputUrl) || outputUrls[0];
    return {
      ...b,
      outputUrl,
      outputUrls: outputUrl && !outputUrls.includes(outputUrl) ? [outputUrl, ...outputUrls] : outputUrls,
      refImageUrl: resolveUrlForCloudSync(b.refImageUrl),
      editFusionUrls: (b.editFusionUrls || [])
        .map((u) => resolveUrlForCloudSync(u))
        .filter((u): u is string => Boolean(u))
        .slice(0, 15),
      editMaskUrl: resolveUrlForCloudSync(b.editMaskUrl),
      lastFrameUrl: resolveUrlForCloudSync(b.lastFrameUrl),
    };
  });
}

export function trySaveLocalCanvas(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  // 旁路：尽快把仍有效的远端图写入本机媒体库（下次落盘可改写为指针）
  scheduleCacheCanvasMediaToLocalStore(blocks);
  const slim = slimBlocksForLocalPersist(blocks);
  try {
    storage.setItem(CANVAS_LS_KEY, JSON.stringify({ blocks: slim, edges }));
    return true;
  } catch {
    // 配额仍满：优先保住关键静帧成图与垫图；砍视频壳字段与超长文本
    try {
      const shell = slim.map((b) => {
        const isKeyart = String(b.id || "").startsWith("keyart-");
        if (isKeyart) {
          return {
            ...b,
            outputText: undefined,
            uploadedAssets: [],
            // 保留 outputUrl / refImageUrl / editFusionUrls，避免刷新后全空再触发改图失败
          };
        }
        return {
          ...b,
          outputUrl: undefined,
          outputUrls: [] as string[],
          refImageUrl: undefined,
          editFusionUrls: [] as string[],
          outputText:
            b.kind === "text" || b.kind === "copy_organize" || b.kind === "video_reverse"
              ? String(b.outputText || "").slice(0, 4_000) || undefined
              : undefined,
        };
      });
      storage.setItem(CANVAS_LS_KEY, JSON.stringify({ blocks: shell, edges }));
      return true;
    } catch {
      return false;
    }
  }
}

export function tryLoadLocalFactoryPrefs(
  storage: Pick<Storage, "getItem"> = localStorage,
): Record<string, unknown> | null {
  try {
    const raw = storage.getItem(FACTORY_PREFS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

export function trySaveLocalFactoryPrefs(
  prefs: Record<string, unknown>,
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  try {
    storage.setItem(FACTORY_PREFS_LS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/** 本机多键各自写入：单键失败不阻断其余键 */
export function persistManhuaDraftLocally(input: {
  writerSession: ManhuaWriterSessionPartial;
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  factoryPrefs?: Record<string, unknown> | null;
  clientUpdatedAt?: string;
}): ManhuaLocalPersistResult & { clientUpdatedAt: string } {
  const clientUpdatedAt = input.clientUpdatedAt || new Date().toISOString();
  let writerOk = false;
  try {
    saveManhuaWriterSessionToStorage(input.writerSession);
    writerOk = true;
  } catch {
    writerOk = false;
  }
  const canvasOk = trySaveLocalCanvas(input.blocks, input.edges);
  const prefsOk =
    input.factoryPrefs == null ? true : trySaveLocalFactoryPrefs(input.factoryPrefs);
  const atOk = trySaveLocalClientUpdatedAt(clientUpdatedAt);
  return {
    writerOk,
    canvasOk,
    prefsOk,
    atOk,
    anyLocalOk: writerOk || canvasOk || prefsOk || atOk,
    clientUpdatedAt,
  };
}

/**
 * 云草稿 → 画布节点。
 *
 * 成片引擎按「节点自带 > 会话选型 > 兜底默认」取。节点自带是 2026-08-09 之后才落的，
 * 旧草稿没有；那时只能靠会话，会话也空就走兜底。取错的代价是恢复即变价变结构：
 * 2.5 掉成 fast 段长从 30s 变 15s，mini 掉成 fast 界面印 28 积分/段、实扣 172。
 */
export function cloudDraftBlocksToCanvas(
  blocks: ManhuaCloudDraftPayload["canvas"]["blocks"],
  opts?: { videoModel?: string | null },
): CanvasBlock[] {
  const sessionVideoModel = String(opts?.videoModel || "").trim();
  const fallbackVideoModel: CanvasBlock["videoModel"] = sessionVideoModel
    ? normalizeCanvasVideoModel(sessionVideoModel)
    : MANHUA_FACTORY_DEFAULT_VIDEO_MODEL;
  return blocks.map((raw) => {
    const kind = (KIND_OK.has(raw.kind as CanvasBlockKind) ? raw.kind : "text") as CanvasBlockKind;
    const base = {
      id: raw.id,
      kind,
      x: raw.x,
      y: raw.y,
      width: raw.width,
      height: raw.height,
      prompt: raw.prompt,
      parentId: raw.parentId,
      episodeIndex: raw.episodeIndex,
      episodeTitle: raw.episodeTitle,
      status: (raw.status as CanvasBlock["status"]) || "idle",
      outputText: raw.outputText,
      outputUrl: raw.outputUrl,
      outputUrls: raw.outputUrls || [],
      refImageUrl: raw.refImageUrl,
      editFusionUrls: raw.editFusionUrls || [],
      imageMode: raw.imageMode === "edit" ? "edit" : "generate",
      aspectRatio: raw.aspectRatio === "16:9" ? "16:9" : "9:16",
      pathCameraRecipeId: raw.pathCameraRecipeId,
      // 手动划线标注已废除，历史草稿字段读取处兼容忽略，不再还原进画布节点。
      textModel: "kimi-k3",
      imageModel: "gpt-image-2",
      videoModel: raw.videoModel
        ? normalizeCanvasVideoModel(raw.videoModel)
        : fallbackVideoModel,
      imageBatchCount: 1,
      uploadedAssets: [],
    } as CanvasBlock;
    return normalizeCanvasBlock(base);
  });
}

export function buildLocalCloudDraftSnapshot(input: {
  writerSession: ManhuaWriterSessionPartial;
  blocks: unknown[];
  edges: unknown[];
  factoryPrefs?: Record<string, unknown> | null;
  clientUpdatedAt?: string;
}): ManhuaCloudDraftPayload {
  const blocks = Array.isArray(input.blocks)
    ? blocksForCloudDraftSync(input.blocks as CanvasBlock[])
    : [];
  return buildManhuaCloudDraftPayload({
    clientUpdatedAt: input.clientUpdatedAt || new Date().toISOString(),
    writerSession: input.writerSession,
    blocks,
    edges: input.edges,
    factoryPrefs: input.factoryPrefs,
  });
}

export function serializeCloudDraftForUpload(payload: ManhuaCloudDraftPayload): string | null {
  const s = serializeManhuaCloudDraftPayload(payload);
  return manhuaCloudDraftPayloadSizeOk(s) ? s : null;
}

/** GCS 直传信封（与 server manhuaCloudDraftGcsStore 一致） */
export function buildManhuaCloudDraftGcsUploadBody(opts: {
  userId: number;
  payload: ManhuaCloudDraftPayload;
}): string {
  const serverUpdatedAt = new Date().toISOString();
  return JSON.stringify({
    format: "mv-manhua-cloud-draft-gcs-v1",
    userId: opts.userId,
    clientUpdatedAt: opts.payload.clientUpdatedAt,
    serverUpdatedAt,
    payload: opts.payload,
  });
}

function formatCloudDraftDirectError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e || "直传失败");
  // GCS PUT / 网关常返回空 body；上层若误 .json() 会抛此错——对用户给业务句
  if (
    /Unexpected end of JSON|is not valid JSON|Failed to execute 'json'|JSON\.parse/i.test(
      msg,
    )
  ) {
    return "云草稿直传响应异常，将改用备用通道";
  }
  return msg.slice(0, 160) || "直传失败";
}

/**
 * 浏览器 → GCS 签名 PUT → commit；失败时由调用方降级 upsert。
 * 注意：GCS 成功响应多为空 body，禁止对 PUT Response 调 .json()。
 */
export async function uploadManhuaCloudDraftViaGcsDirect(opts: {
  userId: number;
  payload: ManhuaCloudDraftPayload;
  prepare: () => Promise<{
    uploadUrl: string;
    requiredHeaders?: Record<string, string>;
  }>;
  commit: () => Promise<unknown>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = buildManhuaCloudDraftGcsUploadBody({
    userId: opts.userId,
    payload: opts.payload,
  });
  try {
    let prepared: {
      uploadUrl: string;
      requiredHeaders?: Record<string, string>;
    };
    try {
      prepared = await opts.prepare();
    } catch (e) {
      return { ok: false, error: formatCloudDraftDirectError(e) };
    }
    const uploadUrl = String(prepared?.uploadUrl || "").trim();
    if (!/^https:\/\//i.test(uploadUrl)) {
      return { ok: false, error: "云草稿上传地址无效" };
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(prepared.requiredHeaders || {}),
    };
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body,
    });
    // 必须消费 body（常为空），且绝不用 .json()
    await putRes.text().catch(() => "");
    if (!putRes.ok) {
      return {
        ok: false,
        error: `直传失败 ${putRes.status}`,
      };
    }
    try {
      await opts.commit();
    } catch (e) {
      return { ok: false, error: formatCloudDraftDirectError(e) };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: formatCloudDraftDirectError(e),
    };
  }
}

export type ManhuaDraftHydrateChoice =
  | { source: "cloud"; draft: ManhuaCloudDraftPayload }
  | { source: "local"; draft: ManhuaCloudDraftPayload }
  | { source: "none" };

/**
 * 选定较新草稿。本机读失败时以云端为准；云端无稿时以本机为准。
 * 相等时间戳时云端优先（跨设备拉取）。
 */
export function chooseManhuaDraftHydrate(input: {
  cloud: ManhuaCloudDraftPayload | null | undefined;
  localWriter: ManhuaWriterSession | null;
  localCanvas: { blocks: CanvasBlock[]; edges: CanvasEdge[] } | null;
  localPrefs: Record<string, unknown> | null;
  localClientUpdatedAt: string | null;
}): ManhuaDraftHydrateChoice {
  const cloud = input.cloud || null;
  const localReadable =
    input.localWriter != null || input.localCanvas != null || input.localPrefs != null;
  const localDraft =
    localReadable
      ? buildLocalCloudDraftSnapshot({
          writerSession: input.localWriter || {},
          blocks: input.localCanvas?.blocks || [],
          edges: input.localCanvas?.edges || [],
          factoryPrefs: input.localPrefs,
          clientUpdatedAt: input.localClientUpdatedAt || undefined,
        })
      : null;

  if (!cloud && !localDraft) return { source: "none" };
  if (cloud && !localDraft) return { source: "cloud", draft: cloud };
  if (!cloud && localDraft) return { source: "local", draft: localDraft };

  if (isManhuaCloudDraftNewer(cloud!.clientUpdatedAt, localDraft!.clientUpdatedAt)) {
    return { source: "cloud", draft: cloud! };
  }
  return { source: "local", draft: localDraft! };
}

/** 把胜出草稿尽量写回本机（补写失败不抛） */
export function repairLocalFromCloudDraft(draft: ManhuaCloudDraftPayload): ManhuaLocalPersistResult {
  return persistManhuaDraftLocally({
    writerSession: draft.writerSession,
    blocks: cloudDraftBlocksToCanvas(draft.canvas.blocks, {
      videoModel: draft.writerSession?.videoModel,
    }),
    edges: draft.canvas.edges,
    factoryPrefs: draft.factoryPrefs,
    clientUpdatedAt: draft.clientUpdatedAt,
  });
}

export function readLocalDraftPartsForHydrate(): {
  writer: ManhuaWriterSession | null;
  canvas: { blocks: CanvasBlock[]; edges: CanvasEdge[] } | null;
  prefs: Record<string, unknown> | null;
  clientUpdatedAt: string | null;
} {
  let writer: ManhuaWriterSession | null = null;
  try {
    writer = loadManhuaWriterSessionFromStorage();
  } catch {
    writer = null;
  }
  return {
    writer,
    canvas: tryLoadLocalCanvas(),
    prefs: tryLoadLocalFactoryPrefs(),
    clientUpdatedAt: tryLoadLocalClientUpdatedAt(),
  };
}

export function writerSessionFromCloudDraft(draft: ManhuaCloudDraftPayload): ManhuaWriterSession {
  return buildManhuaWriterSession(draft.writerSession);
}
