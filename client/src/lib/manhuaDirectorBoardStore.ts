/**
 * 集级导演分镜板本机持久化：长期只认 gcsUri，展示/出片前现签 HTTPS。
 */

const LS_KEY = "mv-manhua-director-board-main-v2";

export type ManhuaDirectorBoardMainEntry = {
  /** gs:// 长期真源 */
  gcsUri: string;
  /** 可选缓存的签名读链（会过期；有 gcsUri 时可随时现签） */
  url?: string;
};

export type ManhuaDirectorBoardMainByEpisode = Record<number, ManhuaDirectorBoardMainEntry>;

function isGsUri(u: string): boolean {
  return /^gs:\/\//i.test(u);
}

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

/** 从 localStorage / 云草稿 prefs 恢复；兼容 v1「只存 https」旧稿（无 gcsUri 时仅作临时 url） */
export function loadManhuaDirectorBoardMainByEpisode(): ManhuaDirectorBoardMainByEpisode {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return migrateV1IfPresent();
    return normalizeDirectorBoardMainByEpisode(JSON.parse(raw));
  } catch {
    return {};
  }
}

function migrateV1IfPresent(): ManhuaDirectorBoardMainByEpisode {
  try {
    const legacy = window.localStorage.getItem("mv-manhua-director-board-main-v1");
    if (!legacy) return {};
    const map = normalizeDirectorBoardMainByEpisode(JSON.parse(legacy));
    if (Object.keys(map).length) saveManhuaDirectorBoardMainByEpisode(map);
    return map;
  } catch {
    return {};
  }
}

export function normalizeDirectorBoardMainByEpisode(
  raw: unknown,
): ManhuaDirectorBoardMainByEpisode {
  if (!raw || typeof raw !== "object") return {};
  const out: ManhuaDirectorBoardMainByEpisode = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ep = Number(k);
    if (!Number.isFinite(ep) || ep < 1) continue;
    if (typeof v === "string") {
      const s = v.trim();
      if (isGsUri(s)) out[ep] = { gcsUri: s };
      else if (isHttpUrl(s)) out[ep] = { gcsUri: "", url: s };
      continue;
    }
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const gcsUri = String(o.gcsUri || "").trim();
    const url = String(o.url || "").trim();
    if (isGsUri(gcsUri)) {
      out[ep] = {
        gcsUri,
        ...(isHttpUrl(url) ? { url } : {}),
      };
    } else if (isHttpUrl(url)) {
      out[ep] = { gcsUri: "", url };
    }
  }
  return out;
}

export function saveManhuaDirectorBoardMainByEpisode(
  map: ManhuaDirectorBoardMainByEpisode,
): void {
  if (typeof window === "undefined") return;
  try {
    const serializable: Record<string, ManhuaDirectorBoardMainEntry> = {};
    for (const [k, v] of Object.entries(map)) {
      const ep = Number(k);
      if (!Number.isFinite(ep) || ep < 1 || !v) continue;
      const gcsUri = String(v.gcsUri || "").trim();
      const url = String(v.url || "").trim();
      if (!isGsUri(gcsUri) && !isHttpUrl(url)) continue;
      serializable[String(ep)] = {
        gcsUri: isGsUri(gcsUri) ? gcsUri : "",
        ...(isHttpUrl(url) ? { url } : {}),
      };
    }
    window.localStorage.setItem(LS_KEY, JSON.stringify(serializable));
  } catch {
    /* quota */
  }
}

/** 出片 / ensure 用的集号 → HTTPS（优先缓存 url，调用方应先现签） */
export function directorBoardHttpsByEpisode(
  map: ManhuaDirectorBoardMainByEpisode,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(map)) {
    const ep = Number(k);
    const url = String(v?.url || "").trim();
    if (Number.isFinite(ep) && ep >= 1 && isHttpUrl(url)) out[ep] = url;
  }
  return out;
}
