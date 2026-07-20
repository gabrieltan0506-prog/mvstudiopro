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
import {
  normalizeCanvasBlock,
  type CanvasBlock,
  type CanvasBlockKind,
  type CanvasEdge,
} from "@/lib/canvasTypes";

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

/** 本机落盘瘦身：去视频产物与 blob，降低多集撑爆配额 */
export function slimBlocksForLocalPersist(blocks: CanvasBlock[]): CanvasBlock[] {
  return blocks.map((b) => {
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
    const outputUrls = (b.outputUrls || []).filter(isHttpUrl).slice(0, 8);
    const outputUrl = isHttpUrl(b.outputUrl) ? String(b.outputUrl).trim() : outputUrls[0];
    return {
      ...b,
      outputUrl,
      outputUrls: outputUrl && !outputUrls.includes(outputUrl) ? [outputUrl, ...outputUrls] : outputUrls,
      refImageUrl: isHttpUrl(b.refImageUrl) ? String(b.refImageUrl).trim() : undefined,
      uploadedAssets: [],
      uploadFailures: undefined,
      editMaskUrl: isHttpUrl(b.editMaskUrl) ? b.editMaskUrl : undefined,
      editFusionUrls: (b.editFusionUrls || []).filter(isHttpUrl).slice(0, 8),
    };
  });
}

export function trySaveLocalCanvas(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  const slim = slimBlocksForLocalPersist(blocks);
  try {
    storage.setItem(CANVAS_LS_KEY, JSON.stringify({ blocks: slim, edges }));
    return true;
  } catch {
    // 配额仍满：再砍静帧 URL，只留节点壳 + 剧本侧由其它键负责
    try {
      const shell = slim.map((b) => ({
        ...b,
        outputUrl: undefined,
        outputUrls: [] as string[],
        refImageUrl: undefined,
        outputText: b.kind === "text" || b.kind === "copy_organize" || b.kind === "video_reverse"
          ? String(b.outputText || "").slice(0, 8_000) || undefined
          : undefined,
      }));
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

export function cloudDraftBlocksToCanvas(blocks: ManhuaCloudDraftPayload["canvas"]["blocks"]): CanvasBlock[] {
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
      imageMode: raw.imageMode === "edit" ? "edit" : "generate",
      aspectRatio: raw.aspectRatio === "16:9" ? "16:9" : "9:16",
      pathCameraRecipeId: raw.pathCameraRecipeId,
      pathAnnotationJson: raw.pathAnnotationJson,
      textModel: "gpt-5.6-sol",
      imageModel: "gpt-image-2",
      videoModel: "gemini-omni-flash",
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
  return buildManhuaCloudDraftPayload({
    clientUpdatedAt: input.clientUpdatedAt || new Date().toISOString(),
    writerSession: input.writerSession,
    blocks: input.blocks,
    edges: input.edges,
    factoryPrefs: input.factoryPrefs,
  });
}

export function serializeCloudDraftForUpload(payload: ManhuaCloudDraftPayload): string | null {
  const s = serializeManhuaCloudDraftPayload(payload);
  return manhuaCloudDraftPayloadSizeOk(s) ? s : null;
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
    blocks: cloudDraftBlocksToCanvas(draft.canvas.blocks),
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
