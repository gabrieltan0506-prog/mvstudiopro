/**
 * 漫剧合集多集学习：每轮顺序采 8–10 集；累计 ≥16（目标凑满约 20）才出一张节奏分析提案。
 * 只借结构/节奏；成稿不写外部剧名。
 */

import {
  extractManhuaDramaTagLabelsZh,
  inferManhuaDramaKind,
  manhuaDramaCategoryLabelZh,
  type ManhuaDramaKind,
} from "./manhuaDramaClassify.js";
import {
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateBeat,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "./manhuaViralTemplateBank.js";

/** 每轮最少采几集 */
export const MANHUA_LEARN_BATCH_MIN = 8;
/** 每轮最多采几集 */
export const MANHUA_LEARN_BATCH_MAX = 10;
/** 每轮默认采几集 */
export const MANHUA_LEARN_BATCH_DEFAULT = 8;
/** 出分析最少累计集数 */
export const MANHUA_LEARN_ANALYSIS_MIN = 16;
/** 出分析目标累计集数（有则尽量采到） */
export const MANHUA_LEARN_ANALYSIS_TARGET = 20;

export type ManhuaLearnEpisodeDigest = {
  episodeIndex: number;
  url: string;
  title: string;
  durationSec: number;
  transcriptPreview: string;
  hookNoteZh: string;
  beatHints: ManhuaViralTemplateBeat[];
  climaxNotes: string[];
  sceneHints: string[];
  learnedAt: string;
  /** 与飙升榜同源归类（前台展示中文类别/标签） */
  dramaKind?: ManhuaDramaKind;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
};

export type ManhuaLearnSeriesProgress = {
  seriesKey: string;
  sourceUrl: string;
  titleHint: string;
  mixId?: string;
  listedEpisodeCount: number;
  learnedEpisodeIndexes: number[];
  updatedAt: string;
  dramaKind?: ManhuaDramaKind;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
};

/** 学节奏与飙升榜共用：从剧名/标题推断类别与题材标签 */
export function classifyManhuaLearnTitle(
  titleHint: string,
  extraText = "",
): {
  dramaKind: ManhuaDramaKind;
  categoryLabelZh: string;
  tagLabelsZh: string[];
} {
  const blob = `${titleHint} ${extraText}`.trim();
  const dramaKind = inferManhuaDramaKind(blob);
  return {
    dramaKind,
    categoryLabelZh: manhuaDramaCategoryLabelZh(dramaKind),
    tagLabelsZh: extractManhuaDramaTagLabelsZh(blob),
  };
}

export function clampManhuaLearnBatchSize(raw?: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return MANHUA_LEARN_BATCH_DEFAULT;
  return Math.max(MANHUA_LEARN_BATCH_MIN, Math.min(MANHUA_LEARN_BATCH_MAX, n));
}

/** 按剧集顺序从未学索引里取本轮 8–10 集 */
export function pickNextEpisodeIndexes(input: {
  listedIndexes: number[];
  learnedIndexes: number[];
  batchSize?: number;
}): number[] {
  const learned = new Set(input.learnedIndexes);
  const pending = input.listedIndexes
    .filter((i) => Number.isFinite(i) && i >= 1 && !learned.has(i))
    .sort((a, b) => a - b);
  if (!pending.length) return [];
  const batch = clampManhuaLearnBatchSize(input.batchSize);
  return pending.slice(0, batch);
}

export function canEmitManhuaLearnAnalysis(learnedCount: number): boolean {
  return learnedCount >= MANHUA_LEARN_ANALYSIS_MIN;
}

function guessLane(text: string): ManhuaViralTemplateLane {
  const t = text;
  if (/种田|边关|古言|开荒/.test(t)) return "古言种田";
  if (/系统|吞噬|进化|觉醒/.test(t)) return "系统觉醒";
  if (/电竞|游戏|操作|竞技/.test(t)) return "游戏竞技";
  if (/甜宠|恋爱|霸总/.test(t)) return "甜宠";
  if (/悬疑|权谋|宫斗/.test(t)) return "悬疑权谋";
  if (/沙雕|搞笑/.test(t)) return "搞笑沙雕";
  return "爽文逆袭";
}

/** 多集 digest → 一张系列节奏提案（启发式合成；服务端可再用模型润色） */
export function mergeEpisodeDigestsIntoProposal(input: {
  seriesKey: string;
  titleHint: string;
  sourceUrl: string;
  digests: ManhuaLearnEpisodeDigest[];
}): ManhuaViralTemplateCard | null {
  const digests = [...input.digests]
    .filter((d) => d && d.episodeIndex >= 1)
    .sort((a, b) => a.episodeIndex - b.episodeIndex)
    .slice(0, MANHUA_LEARN_ANALYSIS_TARGET);
  if (digests.length < MANHUA_LEARN_ANALYSIS_MIN) return null;

  const blob = digests
    .map((d) => [d.title, d.transcriptPreview, d.hookNoteZh, ...d.sceneHints].join(" "))
    .join("\n");
  const laneZh = guessLane(`${input.titleHint}\n${blob}`);
  const today = new Date().toISOString().slice(0, 10);

  const hook3sZh =
    digests
      .slice(0, 3)
      .map((d) => d.hookNoteZh)
      .find((s) => s && !/^待/.test(s))
      ?.slice(0, 200) ||
    digests[0]?.hookNoteZh?.slice(0, 200) ||
    "开场即可见冲突与人物压迫（多集采样合成，勿写外部剧名）";

  const beatMap = new Map<number, ManhuaViralTemplateBeat>();
  for (const d of digests) {
    for (const b of d.beatHints || []) {
      const key = Math.max(0, Math.floor(b.atSec));
      if (!beatMap.has(key) && b.conflictZh && b.visualZh) {
        beatMap.set(key, {
          atSec: key,
          conflictZh: b.conflictZh.slice(0, 40),
          visualZh: b.visualZh.slice(0, 80),
        });
      }
    }
  }
  let beatGrid = Array.from(beatMap.values())
    .sort((a, b) => a.atSec - b.atSec)
    .slice(0, 24);
  if (beatGrid.length < 6) {
    // 按集序铺节拍骨架（约 180s 模板密度）
    beatGrid = digests.slice(0, 12).map((d, i) => ({
      atSec: i * 15,
      conflictZh: (d.hookNoteZh || d.climaxNotes[0] || `第${d.episodeIndex}集冲突`).slice(0, 40),
      visualZh: (d.beatHints[0]?.visualZh || `第${d.episodeIndex}集可拍动作`).slice(0, 80),
    }));
  }

  const scenePoolHints = Array.from(
    new Set(digests.flatMap((d) => d.sceneHints || []).map((s) => String(s || "").trim()).filter(Boolean)),
  ).slice(0, 16);

  const nameBase = String(input.titleHint || "合集节奏").replace(/\s+/g, "").slice(0, 12);
  const card: ManhuaViralTemplateCard = {
    id: `tpl_series_${input.seriesKey}`.slice(0, 64),
    nameZh: `${nameBase || "合集"}节奏`.slice(0, 32),
    laneZh,
    summaryZh: `多集采样合成（${digests.length}集）：只借开场钩子与连载节拍，不抄剧名台词。`.slice(0, 120),
    hook3sZh,
    beatGrid,
    scenePoolHints,
    castShape: {
      leadDesireZh: "在压迫中夺回主动权",
      pressureZh: "连载式外部压力与身份冲突（多集共性）",
    },
    densityHints: {
      minBodyChars: 280,
      minDialogueLines: 8,
      minLocationHits: 2,
    },
    sourceRefs: [
      {
        url: input.sourceUrl || "series://learn",
        fetchedAt: today,
        noteZh: `累计学习${digests.length}集 · 索引${digests.map((d) => d.episodeIndex).join(",")}`
          .slice(0, 120),
      },
    ],
    status: "proposed",
    updatedAt: new Date().toISOString(),
  };
  return parseManhuaViralTemplateCard(card);
}
