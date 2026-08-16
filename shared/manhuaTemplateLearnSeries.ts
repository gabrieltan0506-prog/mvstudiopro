/**
 * 漫剧节奏学习：单集或合集均可；每轮按用户设定的集数顺序采集。
 * 学完 1 集即可出草版；约 16–20 集更稳，用户可继续学习并重做程序聚合。
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

/** 连续整集失败多少次停本轮；任一整集成功后重新计数。 */
export const MANHUA_LEARN_CONSECUTIVE_FAIL_STOP = 8;

/** 每轮最少采几集 */
export const MANHUA_LEARN_BATCH_MIN = 1;
/** 每轮最多采几集 */
export const MANHUA_LEARN_BATCH_MAX = 80;
/** 每轮默认采几集 */
export const MANHUA_LEARN_BATCH_DEFAULT = 8;
/** 出分析最少累计集数 */
export const MANHUA_LEARN_ANALYSIS_MIN = 16;
/** 出分析目标累计集数（有则尽量采到） */
export const MANHUA_LEARN_ANALYSIS_TARGET = 20;
/** 单集允许的最长成片（合集单集可能很长） */
export const MANHUA_LEARN_MAX_DURATION_SEC = 120 * 60;
/**
 * 分片学习检查点：每学满 N 秒就合并写入分集 JSON 一次。
 * 中断后可从 learnedThroughSec 续学，不是「只学前 N 秒」。
 */
export const MANHUA_LEARN_CHECKPOINT_SEC = 10 * 60;
/** @deprecated 使用 MANHUA_LEARN_CHECKPOINT_SEC */
export const MANHUA_LEARN_ANALYZE_WINDOW_SEC = MANHUA_LEARN_CHECKPOINT_SEC;
/** 单集内分片失败最多重试次数（含首次） */
export const MANHUA_LEARN_EPISODE_RETRY_MAX = 3;

/**
 * 集间礼貌间隔（2026-08-11 用户拍板）：真实下载相邻两集之间随机停 N 秒，
 * 纯为减轻来源压力、降低被限流概率——不伪装真人、不绕过任何风控。
 * 单核串行本就慢，此间隔对总时长影响可忽略。
 */
export const MANHUA_LEARN_EPISODE_GAP_MIN_MS = 10_000;
export const MANHUA_LEARN_EPISODE_GAP_MAX_MS = 15_000;

export type ManhuaLearnSeriesDraftEvidence = {
  laneZh: ManhuaViralTemplateLane;
  summaryZh: string;
  castShape: {
    leadDesireZh: string;
    pressureZh: string;
    foilZh?: string;
  };
};

/** [min,max] 内取一个礼貌间隔毫秒数（seed 传 0–1 随机源，便于测试确定化） */
export function pickManhuaLearnEpisodeGapMs(seed: number): number {
  const lo = MANHUA_LEARN_EPISODE_GAP_MIN_MS;
  const hi = MANHUA_LEARN_EPISODE_GAP_MAX_MS;
  const r = Number.isFinite(seed) ? Math.min(1, Math.max(0, seed)) : 0;
  return Math.round(lo + (hi - lo) * r);
}

/** 一集内的 10 分钟（或末段不足）学习块 */
export type ManhuaLearnEpisodeChunk = {
  startSec: number;
  endSec: number;
  transcriptPreview: string;
  hookNoteZh: string;
  beatHints: ManhuaViralTemplateBeat[];
  climaxNotes: string[];
  sceneHints: string[];
  /** 关键帧 API 同次产出的系列底稿结构；系列结束只做程序聚合，不再调用润色模型。 */
  seriesDraftEvidence?: ManhuaLearnSeriesDraftEvidence;
  learnedAt: string;
  /** 供人工甄别题材的代表帧；稳定 GCS 对象，不随临时目录删除。 */
  previewFrameGcsUris?: string[];
  /** 严格学习门：语音模型必须真实完成且产出可用结构。 */
  audioAnalysis?: {
    model: string;
    attempted: boolean;
    success: boolean;
    errorNote?: string;
  };
  /** 严格学习门：高密度抽帧必须达到密度下限，且画面不是限制页/静止页。 */
  denseFrames?: {
    requestedCount: number;
    extractedCount: number;
    validMotion: boolean;
    success: boolean;
    errorNote?: string;
  };
  /** 读帧 provenance（审查必须修13）：本块视觉读帧是否真实跑过、用了哪个模型 */
  vision?: {
    provider: string;
    model: string;
    attempted: boolean;
    success: boolean;
    errorNote?: string;
  };
};

/** 新学习链一块必须语音、高密度画面、视觉理解三路同时成功。 */
export function isStrictManhuaLearnChunkComplete(chunk: ManhuaLearnEpisodeChunk): boolean {
  return Boolean(
    chunk.audioAnalysis?.attempted
      && chunk.audioAnalysis.success
      && chunk.denseFrames?.success
      && chunk.denseFrames.validMotion
      && chunk.denseFrames.extractedCount > 0
      && chunk.vision?.attempted
      && chunk.vision.success,
  );
}

export type ManhuaLearnEpisodeDigest = {
  episodeIndex: number;
  url: string;
  title: string;
  /** 成片总时长（秒） */
  durationSec: number;
  /** 已学到的秒数（检查点续学用） */
  learnedThroughSec?: number;
  /** 是否整集学完 */
  complete?: boolean;
  /** 分片检查点（按时间顺序） */
  chunks?: ManhuaLearnEpisodeChunk[];
  transcriptPreview: string;
  hookNoteZh: string;
  beatHints: ManhuaViralTemplateBeat[];
  climaxNotes: string[];
  sceneHints: string[];
  /** 本集各分片关键帧结构的确定性聚合。 */
  seriesDraftEvidence?: ManhuaLearnSeriesDraftEvidence;
  learnedAt: string;
  /** 每集最多 3 张代表帧，刷新后仍可查看。 */
  previewFrameGcsUris?: string[];
  /** 与飙升榜同源归类（前台展示中文类别/标签） */
  dramaKind?: ManhuaDramaKind;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
  /** 读帧 provenance 聚合（审查必须修13）：attempted/success 按块计数 */
  frameVision?: {
    provider: string;
    model: string;
    attemptedChunks: number;
    successChunks: number;
  };
  /** 新链路启用严格双通道完成口径；旧数据不在本次迁移中被静默改写。 */
  completionPolicy?: "audio_dense_frames_v1";
};

/** 旧 digest 无检查点字段视为已完成；新 digest 以 complete / learnedThroughSec 为准 */
export function isManhuaLearnEpisodeComplete(d: ManhuaLearnEpisodeDigest): boolean {
  if (d.completionPolicy === "audio_dense_frames_v1") {
    const chunks = Array.isArray(d.chunks) ? d.chunks : [];
    if (!chunks.length || !chunks.every(isStrictManhuaLearnChunkComplete)) return false;
  }
  if (d.complete === true) return true;
  if (d.complete === false) return false;
  const through = Number(d.learnedThroughSec);
  const dur = Number(d.durationSec) || 0;
  if (Number.isFinite(through) && dur > 0) {
    return through >= dur - 1;
  }
  // 无检查点字段的旧记录
  return !Array.isArray(d.chunks) || d.chunks.length === 0;
}

/** 把新分片合并进分集 digest（聚合字段 + chunks 追加） */
export function mergeManhuaLearnChunkIntoDigest(input: {
  prev: ManhuaLearnEpisodeDigest | null;
  chunk: ManhuaLearnEpisodeChunk;
  episodeIndex: number;
  url: string;
  title: string;
  durationSec: number;
  dramaKind?: ManhuaDramaKind;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
}): ManhuaLearnEpisodeDigest {
  const prev = input.prev;
  const usesStrictPolicy = Boolean(input.chunk.audioAnalysis || input.chunk.denseFrames);
  if (usesStrictPolicy && !isStrictManhuaLearnChunkComplete(input.chunk)) {
    throw new Error("语音分析与高密度画面分析未同时通过，拒绝推进学习检查点");
  }
  const chunks = [...(Array.isArray(prev?.chunks) ? prev!.chunks! : [])];
  const exists = chunks.some(
    (c) =>
      Math.abs(c.startSec - input.chunk.startSec) < 0.5
      && Math.abs(c.endSec - input.chunk.endSec) < 0.5,
  );
  if (!exists) chunks.push(input.chunk);
  chunks.sort((a, b) => a.startSec - b.startSec);

  const learnedThroughSec = Math.max(
    Number(prev?.learnedThroughSec) || 0,
    input.chunk.endSec,
  );
  const durationSec = Math.max(1, Number(input.durationSec) || Number(prev?.durationSec) || 1);
  const complete = learnedThroughSec >= durationSec - 1;

  const beatHints = chunks.flatMap((c) => c.beatHints || []).slice(0, 24);
  const climaxNotes = chunks.flatMap((c) => c.climaxNotes || []).slice(0, 12);
  const sceneHints = Array.from(
    new Set(chunks.flatMap((c) => c.sceneHints || [])),
  ).slice(0, 12);
  const transcriptPreview = chunks
    .map((c) => c.transcriptPreview)
    .filter(Boolean)
    .join(" … ")
    .replace(/\s+/g, " ")
    .slice(0, 800);
  const hookNoteZh =
    chunks.find((c) => c.startSec <= 1)?.hookNoteZh
    || chunks.map((c) => c.hookNoteZh).find((h) => h && h !== "待补钩子")
    || prev?.hookNoteZh
    || "待补钩子";

  // 读帧 provenance 按块聚合；model/provider 取最近一次真实尝试的记录
  const visionChunks = chunks.filter((c) => c.vision?.attempted);
  const lastVision = visionChunks.length ? visionChunks[visionChunks.length - 1].vision : undefined;
  const frameVision = lastVision
    ? {
        provider: lastVision.provider,
        model: lastVision.model,
        attemptedChunks: visionChunks.length,
        successChunks: visionChunks.filter((c) => c.vision?.success).length,
      }
    : prev?.frameVision;
  const previewFrameGcsUris = Array.from(new Set([
    ...(prev?.previewFrameGcsUris || []),
    ...(input.chunk.previewFrameGcsUris || []),
  ])).slice(0, 3);
  const evidenceRows = chunks
    .map((chunk) => chunk.seriesDraftEvidence)
    .filter((row): row is ManhuaLearnSeriesDraftEvidence => Boolean(row));
  const pickMode = <T extends string>(values: T[]): T | undefined => {
    const counts = new Map<T, number>();
    for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const seriesDraftEvidence = evidenceRows.length
    ? {
        laneZh: pickMode(evidenceRows.map((row) => row.laneZh)) || evidenceRows[0]!.laneZh,
        summaryZh: Array.from(new Set(evidenceRows.map((row) => row.summaryZh).filter(Boolean)))
          .join("；")
          .slice(0, 400),
        castShape: {
          leadDesireZh:
            pickMode(evidenceRows.map((row) => row.castShape.leadDesireZh)) || "",
          pressureZh:
            pickMode(evidenceRows.map((row) => row.castShape.pressureZh)) || "",
          foilZh: pickMode(
            evidenceRows.map((row) => row.castShape.foilZh || "").filter(Boolean),
          ) || undefined,
        },
      }
    : prev?.seriesDraftEvidence;

  return {
    episodeIndex: input.episodeIndex,
    url: input.url,
    title: input.title,
    durationSec,
    learnedThroughSec,
    complete,
    chunks,
    transcriptPreview: transcriptPreview || prev?.transcriptPreview || "",
    hookNoteZh,
    beatHints: beatHints.length ? beatHints : prev?.beatHints || [],
    climaxNotes: climaxNotes.length ? climaxNotes : prev?.climaxNotes || [],
    sceneHints: sceneHints.length ? sceneHints : prev?.sceneHints || [],
    seriesDraftEvidence,
    learnedAt: input.chunk.learnedAt,
    previewFrameGcsUris: previewFrameGcsUris.length ? previewFrameGcsUris : undefined,
    dramaKind: input.dramaKind || prev?.dramaKind,
    categoryLabelZh: input.categoryLabelZh || prev?.categoryLabelZh,
    tagLabelsZh: input.tagLabelsZh || prev?.tagLabelsZh,
    frameVision,
    completionPolicy: usesStrictPolicy
      ? "audio_dense_frames_v1"
      : prev?.completionPolicy,
  };
}

export type ManhuaLearnSeriesProgress = {
  seriesKey: string;
  sourceUrl: string;
  titleHint: string;
  /** 历史 provenance；新任务统一写 gpt，claude/deepseek 仅用于兼容旧进度命名空间。 */
  learnLlm?: "gpt" | "claude" | "deepseek";
  mixId?: string;
  listedEpisodeCount: number;
  /** 列表里出现过的全部集号（判「合集全学完」用集合包含，不用数量比较） */
  listedEpisodeIndexes?: number[];
  learnedEpisodeIndexes: number[];
  /** 当前来源不可用而暂跳的集号；用于下轮从后续集继续，不计入已学。 */
  skippedEpisodeIndexes?: number[];
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

export function nextManhuaLearnEpisodeFailureStreak(
  current: number,
  outcome: "success" | "failure",
): { count: number; shouldStop: boolean } {
  if (outcome === "success") return { count: 0, shouldStop: false };
  const count = Math.max(0, Math.floor(Number(current) || 0)) + 1;
  return {
    count,
    shouldStop: count >= MANHUA_LEARN_CONSECUTIVE_FAIL_STOP,
  };
}

/**
 * 按剧集顺序从未学索引里取本轮批次。
 * 单集/短合集：有几集采几集（不强制凑满 8）；长合集默认 8–10。
 */
export function pickNextEpisodeIndexes(input: {
  listedIndexes: number[];
  learnedIndexes: number[];
  skippedIndexes?: number[];
  batchSize?: number;
}): number[] {
  const unavailable = new Set([...input.learnedIndexes, ...(input.skippedIndexes || [])]);
  const pending = input.listedIndexes
    .filter((i) => Number.isFinite(i) && i >= 1 && !unavailable.has(i))
    .sort((a, b) => a - b);
  if (!pending.length) return [];
  const raw = Math.floor(Number(input.batchSize));
  const preferred = Number.isFinite(raw) && raw > 0
    ? raw
    : clampManhuaLearnBatchSize(undefined);
  // 剩余不足一批时吃光剩余（单集=1）
  const batch = Math.max(1, Math.min(preferred, pending.length, MANHUA_LEARN_BATCH_MAX));
  return pending.slice(0, batch);
}

/**
 * 「重试暂跳集」批次：只取此前因来源受限暂跳、且仍在本次列表里的集
 * （列表每轮重新拉取，官方播放地址随之刷新）；已学成的不再重试。
 */
export function pickRetrySkippedEpisodeIndexes(input: {
  listedIndexes: number[];
  skippedIndexes?: number[];
  learnedIndexes?: number[];
  batchSize?: number;
}): number[] {
  const listed = new Set(input.listedIndexes.filter((i) => Number.isFinite(i) && i >= 1));
  const learned = new Set(input.learnedIndexes || []);
  const pending = Array.from(new Set(input.skippedIndexes || []))
    .filter((i) => Number.isFinite(i) && i >= 1 && listed.has(i) && !learned.has(i))
    .sort((a, b) => a - b);
  if (!pending.length) return [];
  const raw = Math.floor(Number(input.batchSize));
  const preferred = Number.isFinite(raw) && raw > 0 ? raw : clampManhuaLearnBatchSize(undefined);
  return pending.slice(0, Math.max(1, Math.min(preferred, pending.length, MANHUA_LEARN_BATCH_MAX)));
}

/**
 * 草版门槛演进：16 集（老口径）→ 4 集/合集学完（2026-08-10）→
 * **学满 1 集即可出草版并入库（2026-08-11 用户拍板：不管学了多少集，都直接可落盘入库）**。
 * ≥16 集仍是「更准」的完整版口径，只影响文案不再挡门。
 */
export const MANHUA_LEARN_ANALYSIS_DRAFT_MIN = 1;

export function canEmitManhuaLearnAnalysis(
  learnedCount: number,
  _opts?: { allListedComplete?: boolean },
): boolean {
  return learnedCount >= 1;
}

/** 集合判定辅助：可靠列表非空且每一集都已完整学完 */
export function isManhuaLearnListComplete(
  listedIndexes: readonly number[] | undefined,
  completeIndexes: readonly number[],
): boolean {
  const listed = (listedIndexes || []).filter((n) => Number.isFinite(n) && n >= 1);
  if (!listed.length) return false;
  const done = new Set(completeIndexes);
  return listed.every((n) => done.has(n));
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

/** 多集 digest → 一张系列节奏提案；只做确定性聚合，不再调用润色模型。 */
export function mergeEpisodeDigestsIntoProposal(input: {
  seriesKey: string;
  titleHint: string;
  sourceUrl: string;
  digests: ManhuaLearnEpisodeDigest[];
}): ManhuaViralTemplateCard | null {
  const digests = [...input.digests]
    .filter((d) => d && d.episodeIndex >= 1)
    .sort((a, b) => a.episodeIndex - b.episodeIndex);
  // 草版口径：有多少集合成多少集；是否达到出分析门槛由 canEmitManhuaLearnAnalysis 把关
  if (!digests.length) return null;

  const blob = digests
    .map((d) => [d.title, d.transcriptPreview, d.hookNoteZh, ...d.sceneHints].join(" "))
    .join("\n");
  const seriesEvidence = digests
    .map((digest) => digest.seriesDraftEvidence)
    .filter((row): row is ManhuaLearnSeriesDraftEvidence => Boolean(row));
  const pickMode = <T extends string>(values: T[]): T | undefined => {
    const counts = new Map<T, number>();
    for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const laneZh = pickMode(seriesEvidence.map((row) => row.laneZh))
    || guessLane(`${input.titleHint}\n${blob}`);
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
    summaryZh: seriesEvidence.length
      ? `关键帧结构聚合（${digests.length}集）：${Array.from(new Set(
          seriesEvidence.map((row) => row.summaryZh).filter(Boolean),
        )).join("；")}`.slice(0, 120)
      : `多集采样合成（${digests.length}集）：只借开场钩子与连载节拍，不抄剧名台词。`.slice(0, 120),
    hook3sZh,
    beatGrid,
    scenePoolHints,
    castShape: seriesEvidence.length
      ? {
          leadDesireZh:
            pickMode(seriesEvidence.map((row) => row.castShape.leadDesireZh))
            || "在压迫中夺回主动权",
          pressureZh:
            pickMode(seriesEvidence.map((row) => row.castShape.pressureZh))
            || "连载式外部压力与身份冲突（多集共性）",
          foilZh: pickMode(
            seriesEvidence.map((row) => row.castShape.foilZh || "").filter(Boolean),
          ) || undefined,
        }
      : {
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
