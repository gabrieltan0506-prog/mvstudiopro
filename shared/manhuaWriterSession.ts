/**
 * 漫剧编剧室会话快照（本机 localStorage）。
 * 硬刷新后恢复剧情包 / 确认态 / Project Bible，避免线上重扩烧积分。
 */

import {
  parseManhuaProjectBible,
  type ManhuaProjectBible,
} from "./manhuaProjectBible.js";
import {
  clampWriterEpisodeCount,
  writerPackLooksReady,
  type ManhuaWriterPack,
} from "./manhuaWriterRoom.js";
import {
  normalizeManhuaCustomAssetRefs,
  type ManhuaCustomAssetRef,
} from "./manhuaCustomAssetRefs.js";

export const MANHUA_WRITER_SESSION_FORMAT = "mv-manhua-writer-session-v1" as const;
export const MANHUA_WRITER_SESSION_LS_KEY = "mv-manhua-writer-session-v1";

export type ManhuaWriterSession = {
  format: typeof MANHUA_WRITER_SESSION_FORMAT;
  topic: string;
  brief: string;
  episodeCount: number;
  focusEpisode: number;
  writerPack: ManhuaWriterPack | null;
  writerConfirmed: boolean;
  directorUnlocked: boolean;
  projectBible: ManhuaProjectBible | null;
  manhuaUiMode: "workbench" | "form";
  /** 资产设定缺图时用户选择跳过；硬刷新后仍可进分镜 */
  assetsSkipped: boolean;
  /** 工作台三阶段：大纲 / 资产 / 分镜 */
  workflowPhase: "outline" | "assets" | "storyboard";
  /** 用户上传/基于库参考生成的参考图（HTTPS + 勾选角色） */
  customAssetRefs: ManhuaCustomAssetRef[];
  /** 生成资产图时授权匿名进库（半价） */
  shareAssetToLibrary: boolean;
};

export type ManhuaWriterSessionPartial = Partial<Omit<ManhuaWriterSession, "format">> & {
  format?: string;
};

function normalizeWriterPack(raw: unknown): ManhuaWriterPack | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ManhuaWriterPack>;
  const episodeCount = clampWriterEpisodeCount(o.episodeCount);
  const episodes = Array.isArray(o.episodes)
    ? o.episodes
        .map((ep, i) => ({
          index: Math.max(1, Math.floor(Number((ep as { index?: number }).index) || i + 1)),
          title: String((ep as { title?: string }).title || "").trim(),
          body: String((ep as { body?: string }).body || "").trim(),
          endHook: String((ep as { endHook?: string }).endHook || "").trim(),
        }))
        .filter((ep) => ep.title || ep.body || ep.endHook)
    : [];
  const pack: ManhuaWriterPack = {
    seriesTitle: String(o.seriesTitle || "").trim(),
    logline: String(o.logline || "").trim(),
    charactersMd: String(o.charactersMd || "").trim(),
    propsMd: String(o.propsMd || "").trim(),
    locationsMd: String(o.locationsMd || "").trim(),
    episodes,
    rawMarkdown: String(o.rawMarkdown || "").trim(),
    episodeCount: episodes.length || episodeCount,
  };
  return writerPackLooksReady(pack) ? pack : pack.seriesTitle || pack.episodes.length ? pack : null;
}

export function buildManhuaWriterSession(input: ManhuaWriterSessionPartial): ManhuaWriterSession {
  const mode = input.manhuaUiMode === "form" ? "form" : "workbench";
  const writerConfirmed = Boolean(input.writerConfirmed);
  const workflowPhase =
    input.workflowPhase === "outline" ||
    input.workflowPhase === "assets" ||
    input.workflowPhase === "storyboard"
      ? input.workflowPhase
      : writerConfirmed
        ? "storyboard"
        : "outline";
  return {
    format: MANHUA_WRITER_SESSION_FORMAT,
    topic: String(input.topic || "").trim(),
    brief: String(input.brief || "").trim(),
    episodeCount: clampWriterEpisodeCount(input.episodeCount),
    focusEpisode: Math.max(1, Math.floor(Number(input.focusEpisode) || 1)),
    writerPack: normalizeWriterPack(input.writerPack),
    writerConfirmed,
    directorUnlocked: Boolean(input.directorUnlocked),
    projectBible: parseManhuaProjectBible(input.projectBible),
    manhuaUiMode: mode,
    assetsSkipped: Boolean(input.assetsSkipped),
    workflowPhase,
    customAssetRefs: normalizeManhuaCustomAssetRefs(input.customAssetRefs),
    shareAssetToLibrary: Boolean(input.shareAssetToLibrary),
  };
}

export function serializeManhuaWriterSession(session: ManhuaWriterSession): string {
  return JSON.stringify(session);
}

export function parseManhuaWriterSession(raw: unknown): ManhuaWriterSession | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as ManhuaWriterSessionPartial;
  if (o.format !== MANHUA_WRITER_SESSION_FORMAT) return null;
  return buildManhuaWriterSession(o);
}

export function loadManhuaWriterSessionFromStorage(
  storage: Pick<Storage, "getItem"> = localStorage,
): ManhuaWriterSession | null {
  try {
    const raw = storage.getItem(MANHUA_WRITER_SESSION_LS_KEY);
    if (!raw) return null;
    return parseManhuaWriterSession(raw);
  } catch {
    return null;
  }
}

export function saveManhuaWriterSessionToStorage(
  session: ManhuaWriterSessionPartial,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    const normalized = buildManhuaWriterSession(session);
    storage.setItem(MANHUA_WRITER_SESSION_LS_KEY, serializeManhuaWriterSession(normalized));
  } catch {
    /* ignore quota / private mode */
  }
}
