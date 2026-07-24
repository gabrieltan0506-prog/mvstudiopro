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
import {
  normalizeManhuaCharacterVoiceLocks,
  type ManhuaCharacterVoiceLock,
} from "./manhuaCharacterVoiceLock.js";
import { parseManhuaStylePack, type ManhuaStylePack } from "./manhuaStylePack.js";
import {
  normalizeManhuaDeliveryPackage,
  type ManhuaDeliveryPackage,
} from "./manhuaDeliveryPackage.js";
import type { ManhuaCineVocabLocale } from "./manhuaCineVocabBank.js";
import {
  normalizeManhuaCharacterLookSets,
  normalizeManhuaSegmentLookBindings,
  type ManhuaCharacterLookSet,
} from "./manhuaCharacterLookSets.js";

export const MANHUA_WRITER_SESSION_FORMAT = "mv-manhua-writer-session-v1" as const;
export const MANHUA_WRITER_SESSION_LS_KEY = "mv-manhua-writer-session-v1";

const CINE_VOCAB_LOCALES: ManhuaCineVocabLocale[] = ["zh", "en", "ja", "ko", "es", "ru"];

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
  /** 工作台阶段：大纲 / 资产 / 分镜 / 剪辑 */
  workflowPhase: "outline" | "assets" | "storyboard" | "edit";
  /** 用户上传/基于库参考生成的参考图（HTTPS + 勾选角色） */
  customAssetRefs: ManhuaCustomAssetRef[];
  /** 从有声成片抠出的角色声线参考（按 @角色N） */
  characterVoiceLocks: ManhuaCharacterVoiceLock[];
  /** 生成资产图时授权匿名进库（半价） */
  shareAssetToLibrary: boolean;
  /** 审定节奏模板 id（tpl_*）；扩写注入用 */
  viralTemplateId: string;
  /** 产品化风格包（资产阶段） */
  stylePack: ManhuaStylePack | null;
  /** 成色/字幕/配音交付包（剪辑台与成片坞同源） */
  deliveryPackage: ManhuaDeliveryPackage | null;
  /** 可拍词表注入语言 */
  cineVocabLocale: ManhuaCineVocabLocale;
  /** 链式深度：重锚后忽略该场景此前成片数 */
  chainIgnoreByScene: Record<string, number>;
  /** 人物造型套（每人最多 3；服装为人物子类） */
  characterLookSets: ManhuaCharacterLookSet[];
  /** 段手选造型：`e{集}:s{段}` → characterId → lookSetId */
  segmentLookBindings: Record<string, Record<string, string>>;
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
    input.workflowPhase === "storyboard" ||
    input.workflowPhase === "edit"
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
    characterVoiceLocks: normalizeManhuaCharacterVoiceLocks(input.characterVoiceLocks),
    shareAssetToLibrary: Boolean(input.shareAssetToLibrary),
    viralTemplateId: String(input.viralTemplateId || "").trim().slice(0, 64),
    stylePack: parseManhuaStylePack(input.stylePack) || null,
    deliveryPackage: input.deliveryPackage
      ? normalizeManhuaDeliveryPackage(input.deliveryPackage, {
          seriesTitle: normalizeWriterPack(input.writerPack)?.seriesTitle,
        })
      : null,
    cineVocabLocale: CINE_VOCAB_LOCALES.includes(input.cineVocabLocale as ManhuaCineVocabLocale)
      ? (input.cineVocabLocale as ManhuaCineVocabLocale)
      : "zh",
    chainIgnoreByScene: (() => {
      const raw = input.chainIgnoreByScene;
      if (!raw || typeof raw !== "object") return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const key = String(k || "").trim().slice(0, 48);
        const n = Math.floor(Number(v) || 0);
        if (key && n >= 0) out[key] = n;
      }
      return out;
    })(),
    characterLookSets: normalizeManhuaCharacterLookSets(input.characterLookSets),
    segmentLookBindings: normalizeManhuaSegmentLookBindings(input.segmentLookBindings),
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
