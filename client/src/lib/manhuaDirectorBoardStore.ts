/**
 * 集级导演分镜板本机持久化：长期只认 gcsUri，展示/出片前现签 HTTPS。
 */

import {
  parseManhuaBoardMotionOverlay,
  type ManhuaBoardMotionOverlay,
} from "@shared/manhuaDirectorBoardOverlay";

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

/**
 * 段级导演板（2026-08-11 拍板：段级为主、集级兜底）。
 * 结构 Record<集号, Record<段号(本集内 1 起), Entry>>；出片取板顺序 段级→集级。
 */
const LS_SEG_KEY = "mv-manhua-director-board-seg-v1";

export type ManhuaDirectorBoardBySegment = Record<
  number,
  Record<number, ManhuaDirectorBoardMainEntry>
>;

export function normalizeDirectorBoardBySegment(raw: unknown): ManhuaDirectorBoardBySegment {
  if (!raw || typeof raw !== "object") return {};
  const out: ManhuaDirectorBoardBySegment = {};
  for (const [epKey, segMapRaw] of Object.entries(raw as Record<string, unknown>)) {
    const ep = Number(epKey);
    if (!Number.isFinite(ep) || ep < 1) continue;
    const segMap = normalizeDirectorBoardMainByEpisode(segMapRaw);
    if (Object.keys(segMap).length) out[ep] = segMap;
  }
  return out;
}

export function loadManhuaDirectorBoardBySegment(): ManhuaDirectorBoardBySegment {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_SEG_KEY);
    return raw ? normalizeDirectorBoardBySegment(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveManhuaDirectorBoardBySegment(map: ManhuaDirectorBoardBySegment): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_SEG_KEY, JSON.stringify(normalizeDirectorBoardBySegment(map)));
  } catch {
    /* quota */
  }
}

/** 出片用：集号 → 段号 → HTTPS（与集级 directorBoardHttpsByEpisode 同口径） */
export function directorBoardHttpsByEpisodeSegment(
  map: ManhuaDirectorBoardBySegment,
): Record<number, Record<number, string>> {
  const out: Record<number, Record<number, string>> = {};
  for (const [epKey, segMap] of Object.entries(map)) {
    const ep = Number(epKey);
    if (!Number.isFinite(ep) || ep < 1) continue;
    const https = directorBoardHttpsByEpisode(segMap);
    if (Object.keys(https).length) out[ep] = https;
  }
  return out;
}

/**
 * 可编辑轨迹必须与底图分离：底图仍按 GCS 真源保存，矢量层单独落草稿。
 * 结构为 集号 → 本集段号 → overlay；旧稿没有此字段时返回空表。
 */
const LS_OVERLAY_KEY = "mv-manhua-director-board-overlay-v1";

export type ManhuaDirectorBoardOverlayBySegment = Record<
  number,
  Record<number, ManhuaBoardMotionOverlay>
>;

export function normalizeDirectorBoardOverlayBySegment(
  raw: unknown,
): ManhuaDirectorBoardOverlayBySegment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ManhuaDirectorBoardOverlayBySegment = {};
  for (const [epKey, segRaw] of Object.entries(raw as Record<string, unknown>)) {
    const ep = Number(epKey);
    if (!Number.isInteger(ep) || ep < 1 || !segRaw || typeof segRaw !== "object") continue;
    const segOut: Record<number, ManhuaBoardMotionOverlay> = {};
    for (const [segKey, overlayRaw] of Object.entries(segRaw as Record<string, unknown>)) {
      const seg = Number(segKey);
      if (!Number.isInteger(seg) || seg < 1) continue;
      const overlay = parseManhuaBoardMotionOverlay(overlayRaw);
      if (!overlay || overlay.episodeIndex !== ep || overlay.segmentIndex !== seg) continue;
      segOut[seg] = overlay;
    }
    if (Object.keys(segOut).length) out[ep] = segOut;
  }
  return out;
}

export function loadManhuaDirectorBoardOverlayBySegment(): ManhuaDirectorBoardOverlayBySegment {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_OVERLAY_KEY);
    return raw ? normalizeDirectorBoardOverlayBySegment(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveManhuaDirectorBoardOverlayBySegment(
  map: ManhuaDirectorBoardOverlayBySegment,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LS_OVERLAY_KEY,
      JSON.stringify(normalizeDirectorBoardOverlayBySegment(map)),
    );
  } catch {
    /* quota：内存状态仍保留，云草稿可在下一次手动备份时接住 */
  }
}
