/**
 * 同集镜间接力：上一镜静帧 → 下一镜静帧（A）；上一镜成片末帧 → 下一镜成片（B）。
 * 用户可分别开关；默认均开启。
 */

import { resolveKeyartShotIndex } from "./manhuaScriptWorkbench.js";

export const MANHUA_SHOT_CONTINUITY_PREFS_LS_KEY = "mv-manhua-shot-continuity-prefs-v1";

export type ManhuaShotContinuityPrefs = {
  /** A：下一镜静帧以上一镜静帧为 edit/融图底图 */
  keyartFromPrevStill: boolean;
  /** B：下一镜成片挂上一镜成片（抽末帧）作连续参考 */
  clipFromPrevTail: boolean;
};

export const DEFAULT_MANHUA_SHOT_CONTINUITY_PREFS: ManhuaShotContinuityPrefs = {
  keyartFromPrevStill: true,
  clipFromPrevTail: true,
};

export const MANHUA_SHOT_KEYART_CONTINUITY_HINT_ZH =
  "【镜间静帧接力】以上一镜静帧为身份/场景/道具/光线起点，只改本镜动作与构图所需差异，禁止换人换景重开一局。";

export const MANHUA_SHOT_CLIP_CONTINUITY_HINT_ZH =
  "【镜间成片接力】承接上一镜成片末几帧的人物站位、服装、场景纵深与光向，再演绎本镜事件；禁止跳切重置造型与空间。";

export type ShotContinuityBlockLike = {
  id: string;
  kind?: string;
  episodeIndex?: number | null;
  prompt?: string;
  outputUrl?: string | null;
  outputUrls?: string[] | null;
  status?: string;
};

function episodeOf(block: ShotContinuityBlockLike): number | null {
  if (typeof block.episodeIndex === "number" && block.episodeIndex >= 1) {
    return Math.floor(block.episodeIndex);
  }
  const m = String(block.id || "").match(/-e(\d{2})(?:-|$)/i);
  if (m) return Number(m[1]);
  return null;
}

function mediaUrl(block: ShotContinuityBlockLike): string | undefined {
  const u = String(block.outputUrl || block.outputUrls?.[0] || "").trim();
  return u || undefined;
}

export function normalizeManhuaShotContinuityPrefs(
  raw?: Partial<ManhuaShotContinuityPrefs> | null,
): ManhuaShotContinuityPrefs {
  return {
    keyartFromPrevStill:
      raw?.keyartFromPrevStill === undefined
        ? DEFAULT_MANHUA_SHOT_CONTINUITY_PREFS.keyartFromPrevStill
        : Boolean(raw.keyartFromPrevStill),
    clipFromPrevTail:
      raw?.clipFromPrevTail === undefined
        ? DEFAULT_MANHUA_SHOT_CONTINUITY_PREFS.clipFromPrevTail
        : Boolean(raw.clipFromPrevTail),
  };
}

export function loadManhuaShotContinuityPrefs(
  storage: Pick<Storage, "getItem"> = localStorage,
): ManhuaShotContinuityPrefs {
  try {
    const raw = storage.getItem(MANHUA_SHOT_CONTINUITY_PREFS_LS_KEY);
    if (!raw) return { ...DEFAULT_MANHUA_SHOT_CONTINUITY_PREFS };
    return normalizeManhuaShotContinuityPrefs(JSON.parse(raw) as Partial<ManhuaShotContinuityPrefs>);
  } catch {
    return { ...DEFAULT_MANHUA_SHOT_CONTINUITY_PREFS };
  }
}

export function saveManhuaShotContinuityPrefs(
  prefs: Partial<ManhuaShotContinuityPrefs>,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): ManhuaShotContinuityPrefs {
  const next = normalizeManhuaShotContinuityPrefs({
    ...loadManhuaShotContinuityPrefs(storage),
    ...prefs,
  });
  try {
    storage.setItem(MANHUA_SHOT_CONTINUITY_PREFS_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** 同集上一镜已完成的静帧 URL（shotIndex≥2） */
export function resolvePreviousShotKeyartUrl(
  blocks: ShotContinuityBlockLike[],
  episodeIndex: number,
  shotIndex: number,
): string | undefined {
  const ep = Math.floor(episodeIndex);
  const shot = Math.floor(shotIndex);
  if (!(ep >= 1) || !(shot >= 2)) return undefined;
  const prev = shot - 1;
  const candidates = blocks
    .filter((b) => String(b.id || "").startsWith("keyart-"))
    .filter((b) => {
      const be = episodeOf(b);
      return be == null ? ep === 1 : be === ep;
    })
    .filter((b) => resolveKeyartShotIndex(b.id, b.prompt) === prev)
    .filter((b) => !b.status || b.status === "done");
  for (const b of candidates) {
    const url = mediaUrl(b);
    if (url && /^https?:\/\//i.test(url)) return url;
    if (url) return url;
  }
  return undefined;
}

/** 同集上一镜已完成的成片 URL（shotIndex≥2） */
export function resolvePreviousShotClipUrl(
  blocks: ShotContinuityBlockLike[],
  episodeIndex: number,
  shotIndex: number,
): string | undefined {
  const ep = Math.floor(episodeIndex);
  const shot = Math.floor(shotIndex);
  if (!(ep >= 1) || !(shot >= 2)) return undefined;
  const prev = shot - 1;
  const candidates = blocks
    .filter((b) => String(b.id || "").startsWith("clip-"))
    .filter((b) => {
      const be = episodeOf(b);
      return be == null ? ep === 1 : be === ep;
    })
    .filter((b) => resolveKeyartShotIndex(b.id, b.prompt) === prev)
    .filter((b) => !b.status || b.status === "done");
  for (const b of candidates) {
    const url = mediaUrl(b);
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return undefined;
}
