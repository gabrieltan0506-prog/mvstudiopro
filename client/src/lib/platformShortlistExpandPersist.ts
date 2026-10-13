/**
 * 全案选题初选 + 扩写结果本机持久化。
 * 烧积分打 API 后刷新/切 Tab 也不能丢。
 */

import { XHS_CONTENT_SKILL_ID } from "@shared/xhsContentStrategy";
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

export type PlatformShortlistExpandPersist = {
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
    if (!Array.isArray(parsed.topics) && !Array.isArray(parsed.contentBlueprints)) return null;
    return {
      v: 1,
      userKey: parsed.userKey,
      savedAt: String(parsed.savedAt || ""),
      viralPreferences: readViralPreferences(parsed.viralPreferences),
      failedPicks: Array.isArray(parsed.failedPicks) ? parsed.failedPicks : [],
      pendingExpand: parsed.pendingExpand && typeof parsed.pendingExpand.jobId === "string" && Array.isArray(parsed.pendingExpand.picks) ? parsed.pendingExpand : undefined,
      // 用户要求刷新淘汰旧选题；只保留新创作候选，正文和在途任务不清除。
      topics: Array.isArray(parsed.topics) ? parsed.topics.filter(topic => Array.isArray(topic?.skillsUsed) && topic.skillsUsed.includes(XHS_CONTENT_SKILL_ID)) : [],
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
    viralPreferences?: ViralCreationPreferences;
    userKey: string;
    failedPicks?: PlatformTopicShortlistItem[];
    pendingExpand?: { jobId: string; picks: PlatformTopicShortlistItem[] };
    topics: PlatformTopicShortlistItem[];
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
      viralPreferences: readViralPreferences(input.viralPreferences),
      failedPicks: input.failedPicks?.slice(0, 20),
      pendingExpand: input.pendingExpand,
      topics: (input.topics || []).slice(0, 40),
      contentBlueprints: (input.contentBlueprints || []).slice(0, 40),
    };
    storage.setItem(PLATFORM_SHORTLIST_EXPAND_LS_KEY, JSON.stringify(payload));
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
