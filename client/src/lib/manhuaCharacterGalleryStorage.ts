/**
 * 角色卡画廊本地记忆（最近/收藏/自定义套组/筛选偏好）
 */
import {
  getManhuaCharacterById,
  type ManhuaArtStyleId,
  type ManhuaCharacterGender,
} from "@shared/manhuaCharacterAssetLibrary";

export const RECENT_LS_KEY = "mv-manhua-character-recent-v1";
export const FAV_LS_KEY = "mv-manhua-character-fav-v1";
export const CUSTOM_COUPLE_LS_KEY = "mv-manhua-character-custom-couples-v1";
export const LIBRARY_PREFS_LS_KEY = "mv-manhua-character-library-prefs-v1";

export type LibraryPrefs = {
  tab?: ManhuaCharacterGender;
  packFilterId?: string;
  sortMode?: "default" | "name" | "age";
  dense?: boolean;
};

export type CustomCouple = {
  id: string;
  labelZh: string;
  femaleId: string;
  maleId: string;
  artStyleId?: ManhuaArtStyleId;
};

export function loadLibraryPrefs(): LibraryPrefs {
  try {
    const raw = localStorage.getItem(LIBRARY_PREFS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LibraryPrefs;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLibraryPrefs(prefs: LibraryPrefs) {
  try {
    localStorage.setItem(LIBRARY_PREFS_LS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function loadCustomCouples(): CustomCouple[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COUPLE_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => x as Partial<CustomCouple>)
      .filter(
        (x) =>
          x &&
          typeof x.id === "string" &&
          typeof x.femaleId === "string" &&
          typeof x.maleId === "string" &&
          Boolean(getManhuaCharacterById(x.femaleId)) &&
          Boolean(getManhuaCharacterById(x.maleId)),
      )
      .map((x) => ({
        id: String(x.id),
        labelZh: String(x.labelZh || "我的套组").slice(0, 24),
        femaleId: String(x.femaleId),
        maleId: String(x.maleId),
        artStyleId: x.artStyleId,
      }))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function saveCustomCouples(list: CustomCouple[]): CustomCouple[] {
  const next = list.slice(0, 8);
  try {
    localStorage.setItem(CUSTOM_COUPLE_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function loadIdList(key: string, max: number): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, max) : [];
  } catch {
    return [];
  }
}

export function loadRecentIds(): string[] {
  return loadIdList(RECENT_LS_KEY, 8);
}

export function pushRecentId(id: string) {
  const key = String(id || "").trim();
  if (!key) return;
  const next = [key, ...loadRecentIds().filter((x) => x !== key)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function clearRecentIds(): string[] {
  try {
    localStorage.removeItem(RECENT_LS_KEY);
  } catch {
    /* ignore */
  }
  return [];
}

export function loadFavoriteIds(): string[] {
  return loadIdList(FAV_LS_KEY, 24);
}

export function toggleFavoriteId(id: string): string[] {
  const key = String(id || "").trim();
  if (!key) return loadFavoriteIds();
  const cur = loadFavoriteIds();
  const next = cur.includes(key) ? cur.filter((x) => x !== key) : [key, ...cur].slice(0, 24);
  try {
    localStorage.setItem(FAV_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function saveFavoriteIds(ids: string[]): string[] {
  const next = ids.map(String).filter((id) => Boolean(getManhuaCharacterById(id))).slice(0, 24);
  try {
    localStorage.setItem(FAV_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export async function copyText(text: string): Promise<boolean> {
  const t = String(text || "").trim();
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
