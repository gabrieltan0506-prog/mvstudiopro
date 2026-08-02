/**
 * 全案选题初选 + 扩写结果本机持久化。
 * 烧积分打 API 后刷新/切 Tab 也不能丢。
 */

import type { PlatformTopicShortlistItem } from "@shared/platformTopicShortlist";

export const PLATFORM_SHORTLIST_EXPAND_LS_KEY = "mvstudiopro.platform.shortlistExpand.v1";

export type PlatformShortlistExpandPersist = {
  v: 1;
  userKey: string;
  savedAt: string;
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
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
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
    userKey: string;
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
