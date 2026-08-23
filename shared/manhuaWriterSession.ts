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
import {
  normalizeManhuaAudioReferenceLock,
  type ManhuaAudioReferenceLock,
} from "./manhuaAudioReferenceLock.js";
import { detectManhuaCanonWriterDrift } from "./manhuaWriterAssetCanon.js";
import { parseManhuaStylePack, type ManhuaStylePack } from "./manhuaStylePack.js";
import {
  normalizeManhuaDeliveryPackage,
  type ManhuaDeliveryPackage,
} from "./manhuaDeliveryPackage.js";
import type { ManhuaCineVocabLocale } from "./manhuaCineVocabBank.js";
import { migrateRetiredManhuaLayoutVideoModel } from "./manhuaSeedanceLayout.js";
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
  /** 工作台阶段：大纲 / 资产 / 分镜 / 剪辑 / 成片 */
  workflowPhase: ManhuaWorkflowPhase;
  /** 用户上传/基于库参考生成的参考图（HTTPS + 勾选角色） */
  customAssetRefs: ManhuaCustomAssetRef[];
  /** 从有声成片抠出的角色声线参考（按 @角色N） */
  characterVoiceLocks: ManhuaCharacterVoiceLock[];
  /** 参考音频·全集参考（软·可选）：BGM 与对白口音基准；不硬锁、不挡出片 */
  audioReferenceLock: ManhuaAudioReferenceLock | null;
  /** 生成资产图时授权匿名进库（半价） */
  shareAssetToLibrary: boolean;
  /** 匿名化剧情增强方案公开句柄（mt_*）；扩写注入用 */
  publicTemplateId: string;
  /**
   * 开场选定的成片引擎（2.0-mini / 2.0 / 2.0-fast / 2.5 / H3）。
   * 空字符串 = 尚未选择，扩写前必须选定。
   * Happy Horse 1.1 已移出漫剧，旧会话由 `migrateRetiredManhuaLayoutVideoModel` 迁到 2.0-fast。
   */
  videoModel: string;
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
  /** @deprecated 旧草稿字段；只用于把 mt_* 平移到 publicTemplateId。 */
  viralTemplateId?: string;
};

export type ManhuaWriterTemplateIdMigration = {
  publicTemplateId: string;
  /** 旧草稿保存了内部 tpl_*；客户端必须提示用户重新选择，不能继续回写。 */
  clearedLegacyPrivateTemplate: boolean;
};

export function migrateManhuaWriterTemplateId(
  input: Pick<ManhuaWriterSessionPartial, "publicTemplateId" | "viralTemplateId">,
): ManhuaWriterTemplateIdMigration {
  const current = String(input.publicTemplateId || "").trim().slice(0, 64);
  if (/^mt_[a-z0-9]{4,16}$/i.test(current)) {
    return { publicTemplateId: current.toLowerCase(), clearedLegacyPrivateTemplate: false };
  }
  const legacy = String(input.viralTemplateId || current).trim().slice(0, 64);
  if (/^mt_[a-z0-9]{4,16}$/i.test(legacy)) {
    return { publicTemplateId: legacy.toLowerCase(), clearedLegacyPrivateTemplate: false };
  }
  return {
    publicTemplateId: "",
    clearedLegacyPrivateTemplate: /^tpl_[a-z0-9_-]{1,60}$/i.test(legacy),
  };
}

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

/**
 * 工作台阶段：**全站唯一枚举**。
 *
 * 0824 收口——此前这个枚举在四处各写一遍（组件类型、本文件的持久化类型、
 * 本文件的校验、OmniCanvas 的 state 与恢复校验）。加一个阶段要同时改四处，
 * 漏掉任一处的后果是「选了新阶段、刷新后回到大纲」**且不报错**。
 */
export const MANHUA_WORKFLOW_PHASES = [
  "outline",
  "assets",
  "storyboard",
  "edit",
  "final",
] as const;

export type ManhuaWorkflowPhase = (typeof MANHUA_WORKFLOW_PHASES)[number];

/** 未知值一律回落：确认过编剧的回分镜，否则回大纲 */
export function parseManhuaWorkflowPhase(
  value: unknown,
  writerConfirmed: boolean,
): ManhuaWorkflowPhase {
  return MANHUA_WORKFLOW_PHASES.includes(value as ManhuaWorkflowPhase)
    ? (value as ManhuaWorkflowPhase)
    : writerConfirmed
      ? "storyboard"
      : "outline";
}

export function buildManhuaWriterSession(input: ManhuaWriterSessionPartial): ManhuaWriterSession {
  const mode = input.manhuaUiMode === "form" ? "form" : "workbench";
  const writerConfirmed = Boolean(input.writerConfirmed);
  const workflowPhase = parseManhuaWorkflowPhase(input.workflowPhase, writerConfirmed);
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
    audioReferenceLock: normalizeManhuaAudioReferenceLock(input.audioReferenceLock),
    shareAssetToLibrary: Boolean(input.shareAssetToLibrary),
    publicTemplateId: migrateManhuaWriterTemplateId(input).publicTemplateId,
    // 已移出漫剧的 happyhorse-1.1 旧会话迁到等价档 2.0-fast（同 6×15s 段表、同段价），
    // 不让它落到画布默认的 2.5——那会悄悄改段表、改权限门。其余未知值回到「未选引擎」。
    videoModel: migrateRetiredManhuaLayoutVideoModel(input.videoModel),
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

/**
 * 加载草稿自愈：当 `projectBible` 的 canon 与现 `writerPack` 人物表换角漂移时，
 * 不信任旧 bible（否则「按剧本重出/锁脸」会照旧角色出图——正是老角色阴魂不散的根因）。
 *
 * 剧本本体（writerPack）始终保留；仅把漂移的 bible 置空并退回未确认，交由
 * 「确认并进入资产设定」按现稿重建。返回 `healed` 供 UI 决定是否提示用户重新确认。
 *
 * 触发场景：本地/云端草稿里 writerPack 已换角但 bible 没重建（云草稿常把一周前的
 * 旧 bible 回灌，盖掉本地刚重建的新 canon）。
 */
export function healManhuaWriterSessionCanonDrift(
  session: ManhuaWriterSession | null,
): { session: ManhuaWriterSession | null; healed: boolean } {
  if (!session) return { session, healed: false };
  const drift = detectManhuaCanonWriterDrift(
    session.projectBible?.assetCanon ?? null,
    session.writerPack?.charactersMd ?? null,
  );
  if (!drift.drifted) return { session, healed: false };
  return {
    healed: true,
    session: {
      ...session,
      projectBible: null,
      writerConfirmed: false,
      directorUnlocked: false,
      workflowPhase: "outline",
    },
  };
}

export function loadManhuaWriterSessionFromStorage(
  storage: Pick<Storage, "getItem"> = localStorage,
): ManhuaWriterSession | null {
  try {
    const raw = storage.getItem(MANHUA_WRITER_SESSION_LS_KEY);
    if (!raw) return null;
    return healManhuaWriterSessionCanonDrift(parseManhuaWriterSession(raw)).session;
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
