/**
 * 漫剧专案 Bible 快照（系列级真相源）。
 * 勿与工厂阶段 bible-*（角色卡节点）混淆。
 */

import type { ManhuaWriterPack } from "./manhuaWriterRoom.js";

export const MANHUA_PROJECT_BIBLE_FORMAT = "mv-manhua-project-bible-v1" as const;

export type ManhuaProjectBibleCast = {
  lane: "urban" | "ancient";
  characterIds: string[];
  ancientArchetypeIds: string[];
  artStyleId: string;
  sceneId?: string;
  propIds: string[];
  wardrobePropContinuityIds: string[];
  identityLockZh?: string;
  /** 集级绑定：这些造型默认覆盖的集号（1-based） */
  boundEpisodeIndexes: number[];
};

export type ManhuaProjectBible = {
  format: typeof MANHUA_PROJECT_BIBLE_FORMAT;
  confirmedAt: string;
  topic: string;
  seriesTitle: string;
  logline: string;
  charactersMd: string;
  propsMd: string;
  locationsMd: string;
  episodeCount: number;
  episodes: Array<{ index: number; title: string; endHook: string }>;
  cast: ManhuaProjectBibleCast;
  focusEpisode: number;
  /** 手选覆盖自动推荐（冲突规则：人工优先） */
  manualOverrides?: {
    femaleLead?: boolean;
    maleLead?: boolean;
    ancient?: boolean;
    artStyle?: boolean;
    scene?: boolean;
    props?: boolean;
    wardrobe?: boolean;
  };
};

export type BuildManhuaProjectBibleInput = {
  topic: string;
  pack: Pick<
    ManhuaWriterPack,
    "seriesTitle" | "logline" | "charactersMd" | "propsMd" | "locationsMd" | "episodes" | "episodeCount"
  >;
  cast: Omit<ManhuaProjectBibleCast, "boundEpisodeIndexes"> & {
    boundEpisodeIndexes?: number[];
  };
  focusEpisode?: number;
  confirmedAt?: string | Date;
  manualOverrides?: ManhuaProjectBible["manualOverrides"];
};

/** 从编剧确认瞬间的状态生成专案 Bible */
export function buildManhuaProjectBible(input: BuildManhuaProjectBibleInput): ManhuaProjectBible {
  const episodeCount = Math.max(1, Math.floor(Number(input.pack.episodeCount) || 1));
  const bound =
    input.cast.boundEpisodeIndexes?.filter((n) => n >= 1 && n <= episodeCount) ||
    Array.from({ length: episodeCount }, (_, i) => i + 1);
  const confirmedAt =
    input.confirmedAt instanceof Date
      ? input.confirmedAt.toISOString()
      : String(input.confirmedAt || new Date().toISOString());

  return {
    format: MANHUA_PROJECT_BIBLE_FORMAT,
    confirmedAt,
    topic: String(input.topic || "").trim(),
    seriesTitle: String(input.pack.seriesTitle || "").trim(),
    logline: String(input.pack.logline || "").trim(),
    charactersMd: String(input.pack.charactersMd || "").trim(),
    propsMd: String(input.pack.propsMd || "").trim(),
    locationsMd: String(input.pack.locationsMd || "").trim(),
    episodeCount,
    episodes: (input.pack.episodes || []).map((ep) => ({
      index: ep.index,
      title: String(ep.title || "").trim(),
      endHook: String(ep.endHook || "").trim(),
    })),
    cast: {
      lane: input.cast.lane === "ancient" ? "ancient" : "urban",
      characterIds: (input.cast.characterIds || []).map(String).filter(Boolean),
      ancientArchetypeIds: (input.cast.ancientArchetypeIds || []).map(String).filter(Boolean).slice(0, 2),
      artStyleId: String(input.cast.artStyleId || "").trim(),
      sceneId: String(input.cast.sceneId || "").trim() || undefined,
      propIds: (input.cast.propIds || []).map(String).filter(Boolean).slice(0, 4),
      wardrobePropContinuityIds: (input.cast.wardrobePropContinuityIds || []).map(String).filter(Boolean),
      identityLockZh: String(input.cast.identityLockZh || "").trim() || undefined,
      boundEpisodeIndexes: bound.length ? bound : [1],
    },
    focusEpisode: Math.max(1, Math.floor(Number(input.focusEpisode) || 1)),
    manualOverrides: input.manualOverrides,
  };
}

export function serializeManhuaProjectBible(bible: ManhuaProjectBible): string {
  return JSON.stringify(bible, null, 2);
}

export function parseManhuaProjectBible(raw: unknown): ManhuaProjectBible | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ManhuaProjectBible>;
  if (o.format !== MANHUA_PROJECT_BIBLE_FORMAT) return null;
  if (!o.cast || typeof o.cast !== "object") return null;
  try {
    return buildManhuaProjectBible({
      topic: String(o.topic || ""),
      pack: {
        seriesTitle: String(o.seriesTitle || ""),
        logline: String(o.logline || ""),
        charactersMd: String(o.charactersMd || ""),
        propsMd: String(o.propsMd || ""),
        locationsMd: String(o.locationsMd || ""),
        episodeCount: Number(o.episodeCount) || 1,
        episodes: Array.isArray(o.episodes)
          ? o.episodes.map((ep) => ({
              index: Number((ep as { index?: number }).index) || 1,
              title: String((ep as { title?: string }).title || ""),
              body: "",
              endHook: String((ep as { endHook?: string }).endHook || ""),
            }))
          : [],
      },
      cast: {
        lane: o.cast.lane === "ancient" ? "ancient" : "urban",
        characterIds: o.cast.characterIds || [],
        ancientArchetypeIds: o.cast.ancientArchetypeIds || [],
        artStyleId: o.cast.artStyleId || "",
        sceneId: o.cast.sceneId,
        propIds: o.cast.propIds || [],
        wardrobePropContinuityIds: o.cast.wardrobePropContinuityIds || [],
        identityLockZh: o.cast.identityLockZh,
        boundEpisodeIndexes: o.cast.boundEpisodeIndexes,
      },
      focusEpisode: o.focusEpisode,
      confirmedAt: o.confirmedAt,
      manualOverrides: o.manualOverrides,
    });
  } catch {
    return null;
  }
}

/** UI / Debug 一行摘要 */
export function summarizeManhuaProjectBible(bible: ManhuaProjectBible | null | undefined): string {
  if (!bible) return "—";
  const castBits =
    bible.cast.lane === "ancient"
      ? `古风·${bible.cast.ancientArchetypeIds.join(",") || "—"}`
      : `人物·${bible.cast.characterIds.join(",") || "—"}`;
  const eps = bible.cast.boundEpisodeIndexes.join(",");
  return `${bible.seriesTitle || bible.topic || "未命名"} · ${castBits} · 画风 ${bible.cast.artStyleId || "—"} · 绑定集 ${eps}`;
}
