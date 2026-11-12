/**
 * 爆款创作：扩写结果本机持久化。
 *
 * 站长 2026-11-11：「之前生成过的标题不要保留，刷新就删除了。」
 * 因此选题候选标题（topics）与未出稿的候选（failedPicks）只留在本次会话内存，
 * 不再写入本机，读取时也一律丢弃；旧版本已存下的这两类数据由 purgeShortlistTitlesPersist 一次性抹掉。
 * 已扩写出的正文（contentBlueprints，含其选定标题）与在途扩写任务（pendingExpand）随后续产物保留。
 */

import type { PlatformTopicShortlistItem } from "@shared/platformTopicShortlist";

export const PLATFORM_SHORTLIST_EXPAND_LS_KEY = "mvstudiopro.platform.shortlistExpand.v1";

export type ViralCreationPreferences = { platforms: Array<"xiaohongshu" | "douyin">; formats: Array<"图文" | "短视频"> };

function readViralPreferences(raw: unknown): ViralCreationPreferences | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as ViralCreationPreferences;
  if (!Array.isArray(value.platforms) || !Array.isArray(value.formats)) return undefined;
  const platforms = Array.from(new Set(value.platforms.filter(p => p === "xiaohongshu" || p === "douyin")));
  const formats = Array.from(new Set(value.formats.filter(f => f === "图文" || f === "短视频")));
  return platforms.length && formats.length ? { platforms, formats } : undefined;
}

export type CoverReferencePhotos = { byScene: Record<string, string>; global?: string };
function readReferencePhotos(raw: unknown): CoverReferencePhotos | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as CoverReferencePhotos;
  const valid = (url: unknown): url is string => typeof url === "string" && url.length <= 8192 && /^https?:\/\//.test(url);
  const byScene = Object.fromEntries(Object.entries(value.byScene && typeof value.byScene === "object" ? value.byScene : {}).filter(([id, url]) => id.length > 0 && id.length <= 128 && valid(url)));
  return { byScene, global: valid(value.global) ? value.global : undefined };
}

export type PlatformShortlistExpandPersist = {
  referencePhotos?: CoverReferencePhotos;
  viralPreferences?: ViralCreationPreferences;
  v: 1;
  userKey: string;
  savedAt: string;
  failedPicks?: PlatformTopicShortlistItem[];
  pendingExpand?: { jobId: string; picks: PlatformTopicShortlistItem[] };
  topics: PlatformTopicShortlistItem[];
  contentBlueprints: Array<Record<string, unknown>>;
};

type Ls = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultLs(): Ls | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
  return window.localStorage;
}

export function readShortlistExpandPersist(
  userKey: string,
  storage: Ls | null = defaultLs(),
): PlatformShortlistExpandPersist | null {
  if (!storage || !userKey) return null;
  try {
    const raw = storage.getItem(PLATFORM_SHORTLIST_EXPAND_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlatformShortlistExpandPersist;
    if (!parsed || parsed.v !== 1 || parsed.userKey !== userKey) return null;
    if (!Array.isArray(parsed.contentBlueprints) && !parsed.pendingExpand) return null;
    return {
      v: 1,
      userKey: parsed.userKey,
      savedAt: String(parsed.savedAt || ""),
      referencePhotos: readReferencePhotos(parsed.referencePhotos),
      viralPreferences: readViralPreferences(parsed.viralPreferences),
      // 生成过的候选标题刷新即丢：未出稿的候选与选题候选都不回填
      failedPicks: [],
      pendingExpand: parsed.pendingExpand && typeof parsed.pendingExpand.jobId === "string" && Array.isArray(parsed.pendingExpand.picks) ? parsed.pendingExpand : undefined,
      topics: [],
      contentBlueprints: Array.isArray(parsed.contentBlueprints)
        ? (parsed.contentBlueprints as Array<Record<string, unknown>>)
        : [],
    };
  } catch {
    return null;
  }
}

export function writeShortlistExpandPersist(
  input: {
    referencePhotos?: CoverReferencePhotos;
    viralPreferences?: ViralCreationPreferences;
    userKey: string;
    /** @deprecated 已忽略：候选标题不再落盘（保留参数只为兼容旧调用） */
    failedPicks?: PlatformTopicShortlistItem[];
    pendingExpand?: { jobId: string; picks: PlatformTopicShortlistItem[] };
    /** @deprecated 已忽略：选题候选标题不再落盘（保留参数只为兼容旧调用） */
    topics?: PlatformTopicShortlistItem[];
    contentBlueprints: Array<Record<string, unknown>>;
  },
  storage: Ls | null = defaultLs(),
): boolean {
  if (!storage || !input.userKey) return false;
  try {
    const payload: PlatformShortlistExpandPersist = {
      v: 1,
      userKey: input.userKey,
      savedAt: new Date().toISOString(),
      referencePhotos: readReferencePhotos(input.referencePhotos),
      viralPreferences: readViralPreferences(input.viralPreferences),
      // 候选标题不落盘：topics / failedPicks 恒为空，刷新后不再出现
      failedPicks: [],
      pendingExpand: input.pendingExpand,
      topics: [],
      contentBlueprints: (input.contentBlueprints || []).slice(0, 40),
    };
    storage.setItem(PLATFORM_SHORTLIST_EXPAND_LS_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * 一次性清理：抹掉旧版本已写入本机的选题候选标题（所有账号桶通用，只有一个 key）。
 * 只改 topics / failedPicks 两个字段，正文、在途任务、平台偏好、参考人像原样保留。
 * 返回是否实际改写了存储。
 */
export function purgeShortlistTitlesPersist(storage: Ls | null = defaultLs()): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(PLATFORM_SHORTLIST_EXPAND_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return false;
    const hasTopics = Array.isArray(parsed.topics) && parsed.topics.length > 0;
    const hasFailed = Array.isArray(parsed.failedPicks) && parsed.failedPicks.length > 0;
    if (!hasTopics && !hasFailed) return false;
    storage.setItem(PLATFORM_SHORTLIST_EXPAND_LS_KEY, JSON.stringify({ ...parsed, topics: [], failedPicks: [] }));
    return true;
  } catch {
    return false;
  }
}

export function clearShortlistExpandPersist(
  userKey?: string,
  storage: Ls | null = defaultLs(),
): void {
  if (!storage) return;
  try {
    if (userKey) {
      const cur = readShortlistExpandPersist(userKey, storage);
      if (!cur) return;
    }
    storage.removeItem(PLATFORM_SHORTLIST_EXPAND_LS_KEY);
  } catch {
    // ignore
  }
}
