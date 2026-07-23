/**
 * Platform「学节奏」结果面板：会话态 ↔ GCS snapshot 映射，本机记住最近合集 key。
 * 进度阶段真源：shared/manhuaTemplateLearnPipeline（产品流水线，非仅 Cursor skill）。
 */

import {
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_ANALYSIS_TARGET,
} from "@shared/manhuaTemplateLearnSeries";
import {
  MANHUA_LEARN_STAGE,
  appendManhuaLearnProgressLine,
  buildManhuaLearnStartLines,
  buildManhuaLocalLearnPanelSteps,
  manhuaLearnStageLabelZh,
  type ManhuaLearnChannel,
  type ManhuaLearnProgressLine,
} from "@shared/manhuaTemplateLearnPipeline";

export const LS_MANHUA_LEARN_SERIES_KEY = "mv-manhua-learn-focus-series-v1";

export type ManhuaLearnResultUi = {
  seriesKey: string;
  analysisReady: boolean;
  learnedCount: number;
  analysisMin: number;
  analysisTarget: number;
  batchLearned: number;
  messageZh: string;
  /** 云端学习失败时填写；有值则面板以错误态展示 */
  errorZh?: string;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
  listedEpisodeCount?: number;
  pendingCount?: number;
  /** cloud | local */
  channel?: ManhuaLearnChannel;
  /** queued | running | succeeded | failed | local */
  liveStatus?: "queued" | "running" | "succeeded" | "failed" | "local";
  livePhase?: string;
  liveLabelZh?: string;
  progressLines?: ManhuaLearnProgressLine[];
  startedAtIso?: string;
  digestsPreview: Array<{
    episodeIndex: number;
    title: string;
    hookNoteZh: string;
    transcriptPreview: string;
    durationSec: number;
    categoryLabelZh?: string;
    tagLabelsZh?: string[];
  }>;
  proposal: {
    id: string;
    nameZh: string;
    hook3sZh: string;
    laneZh: string;
    summaryZh: string;
    card?: Record<string, unknown>;
  } | null;
};

function parseProgressLines(raw: unknown): ManhuaLearnProgressLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        atIso: String(r.atIso || "").trim() || new Date().toISOString(),
        stage: String(r.stage || "").trim() || MANHUA_LEARN_STAGE.queued,
        detailZh: String(r.detailZh || "").trim(),
      };
    })
    .filter((l) => Boolean(l.detailZh));
}

/** 一点学节奏就立刻落面板（开始态），避免长时间只有按钮「学习中」 */
export function manhuaLearnResultFromStart(input: {
  channel: ManhuaLearnChannel;
  url?: string;
  title?: string;
  seriesKey?: string;
}): ManhuaLearnResultUi {
  const lines = buildManhuaLearnStartLines(input);
  return {
    seriesKey:
      String(input.seriesKey || "").trim() ||
      `learn_${Date.now().toString(36)}`,
    analysisReady: false,
    learnedCount: 0,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    batchLearned: 0,
    messageZh: lines[0]?.detailZh || "学节奏已开始",
    channel: input.channel,
    liveStatus: input.channel === "local" ? "local" : "queued",
    livePhase: MANHUA_LEARN_STAGE.queued,
    liveLabelZh: lines[0]?.detailZh,
    progressLines: lines,
    startedAtIso: lines[0]?.atIso,
    digestsPreview: [],
    proposal: null,
  };
}

/** 轮询中把 job.output 阶段刷进面板 */
export function mergeManhuaLearnLiveProgress(
  prev: ManhuaLearnResultUi | null,
  tick: {
    status: string;
    output?: Record<string, unknown>;
  },
): ManhuaLearnResultUi {
  const base =
    prev ||
    manhuaLearnResultFromStart({ channel: "cloud" });
  const out = tick.output || {};
  const label =
    String(out.analysisStageLabel || "").trim() ||
    manhuaLearnStageLabelZh(String(out.analysisStage || "").replace(/^manhua_learn_/, ""));
  const fromJob = parseProgressLines(out.learnProgressLog);
  const progressLines =
    fromJob.length > 0
      ? fromJob
      : label
        ? appendManhuaLearnProgressLine(
            base.progressLines,
            String(out.analysisStage || "").replace(/^manhua_learn_/, "") ||
              MANHUA_LEARN_STAGE.queued,
            label,
          )
        : base.progressLines || [];
  const liveStatus =
    tick.status === "queued"
      ? "queued"
      : tick.status === "running"
        ? "running"
        : tick.status === "failed"
          ? "failed"
          : tick.status === "succeeded"
            ? "succeeded"
            : base.liveStatus || "running";
  return {
    ...base,
    channel: "cloud",
    liveStatus,
    livePhase: String(out.analysisStage || base.livePhase || "").replace(/^manhua_learn_/, ""),
    liveLabelZh: label || base.liveLabelZh,
    progressLines,
    messageZh: label || base.messageZh,
  };
}

/** 失败也落面板，避免只 toast / 复制本机命令却看不见原因 */
export function manhuaLearnResultFromFailure(input: {
  errorZh: string;
  url?: string;
  title?: string;
  seriesKey?: string;
  prev?: ManhuaLearnResultUi | null;
}): ManhuaLearnResultUi {
  const errorZh = String(input.errorZh || "云端学习失败").trim().slice(0, 400);
  const titleHint = String(input.title || "").trim().slice(0, 40);
  const urlHint = String(input.url || "").trim().slice(0, 80);
  const seriesKey =
    String(input.seriesKey || input.prev?.seriesKey || "").trim() ||
    `fail_${Date.now().toString(36)}`;
  const context = [titleHint, urlHint].filter(Boolean).join(" · ");
  const failLine = appendManhuaLearnProgressLine(
    input.prev?.progressLines,
    MANHUA_LEARN_STAGE.failed,
    errorZh,
  );
  return {
    seriesKey,
    analysisReady: false,
    learnedCount: input.prev?.learnedCount || 0,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    batchLearned: input.prev?.batchLearned || 0,
    messageZh: context ? `${errorZh}（${context}）` : errorZh,
    errorZh,
    channel: input.prev?.channel || "cloud",
    liveStatus: "failed",
    livePhase: MANHUA_LEARN_STAGE.failed,
    liveLabelZh: errorZh,
    progressLines: failLine,
    startedAtIso: input.prev?.startedAtIso,
    digestsPreview: input.prev?.digestsPreview || [],
    proposal: input.prev?.proposal || null,
    categoryLabelZh: input.prev?.categoryLabelZh,
    tagLabelsZh: input.prev?.tagLabelsZh,
    listedEpisodeCount: input.prev?.listedEpisodeCount,
    pendingCount: input.prev?.pendingCount,
  };
}

/** 本机回退：把「开始→复制命令→请终端执行」写进同一面板 */
export function manhuaLearnResultFromLocalFallback(input: {
  reasonZh: string;
  cmd: string;
  url?: string;
  title?: string;
  prev?: ManhuaLearnResultUi | null;
}): ManhuaLearnResultUi {
  const steps = buildManhuaLocalLearnPanelSteps({
    reasonZh: input.reasonZh,
    cmd: input.cmd,
    title: input.title,
  });
  const merged = [...(input.prev?.progressLines || []), ...steps].slice(-40);
  return {
    seriesKey:
      String(input.prev?.seriesKey || "").trim() ||
      `local_${Date.now().toString(36)}`,
    analysisReady: false,
    learnedCount: input.prev?.learnedCount || 0,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    batchLearned: input.prev?.batchLearned || 0,
    messageZh: steps[0]?.detailZh || input.reasonZh,
    errorZh: String(input.reasonZh || "").trim() || undefined,
    channel: "local",
    liveStatus: "local",
    livePhase: MANHUA_LEARN_STAGE.local_ready,
    liveLabelZh: manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.local_ready),
    progressLines: merged,
    startedAtIso: input.prev?.startedAtIso || steps[0]?.atIso,
    digestsPreview: input.prev?.digestsPreview || [],
    proposal: null,
  };
}

export function readManhuaLearnFocusSeriesKey(): string {
  try {
    return String(localStorage.getItem(LS_MANHUA_LEARN_SERIES_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeManhuaLearnFocusSeriesKey(seriesKey: string): void {
  const key = String(seriesKey || "").trim();
  try {
    if (key) localStorage.setItem(LS_MANHUA_LEARN_SERIES_KEY, key);
    else localStorage.removeItem(LS_MANHUA_LEARN_SERIES_KEY);
  } catch {
    /* ignore */
  }
}

export function manhuaLearnResultFromJobOutput(
  out: Record<string, unknown>,
): ManhuaLearnResultUi {
  const digestsRaw = Array.isArray(out.digestsPreview) ? out.digestsPreview : [];
  const digestsPreview = digestsRaw
    .map((d) => {
      const row = d as Record<string, unknown>;
      const tags = Array.isArray(row.tagLabelsZh)
        ? row.tagLabelsZh.map((t) => String(t || "").trim()).filter(Boolean)
        : [];
      return {
        episodeIndex: Math.max(0, Math.floor(Number(row.episodeIndex) || 0)),
        title: String(row.title || "").trim(),
        hookNoteZh: String(row.hookNoteZh || "").trim(),
        transcriptPreview: String(row.transcriptPreview || "").trim(),
        durationSec: Math.max(0, Number(row.durationSec) || 0),
        categoryLabelZh: String(row.categoryLabelZh || "").trim() || undefined,
        tagLabelsZh: tags.length ? tags : undefined,
      };
    })
    .filter((d) => d.episodeIndex >= 1);
  const proposalRaw = (out.proposal || null) as Record<string, unknown> | null;
  const analysisReady = Boolean(out.analysisReady) && Boolean(proposalRaw?.id);
  const seriesTags = Array.isArray(out.tagLabelsZh)
    ? out.tagLabelsZh.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
  const learnedCount = Math.max(0, Math.floor(Number(out.learnedCount) || 0));
  const listed = Math.max(0, Math.floor(Number(out.listedEpisodeCount) || 0));
  const progressLines = parseProgressLines(out.learnProgressLog);
  const doneLabel =
    String(out.analysisStageLabel || "").trim() ||
    manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.done);
  return {
    seriesKey: String(out.seriesKey || "").trim(),
    analysisReady,
    learnedCount,
    analysisMin: Math.max(1, Math.floor(Number(out.analysisMin) || MANHUA_LEARN_ANALYSIS_MIN)),
    analysisTarget: Math.max(
      1,
      Math.floor(Number(out.analysisTarget) || MANHUA_LEARN_ANALYSIS_TARGET),
    ),
    batchLearned: Math.max(0, Math.floor(Number(out.batchLearned) || 0)),
    messageZh: String(out.messageZh || "").trim(),
    categoryLabelZh: String(out.categoryLabelZh || "").trim() || undefined,
    tagLabelsZh: seriesTags.length ? seriesTags : undefined,
    listedEpisodeCount: listed || undefined,
    pendingCount: listed > 0 ? Math.max(0, listed - learnedCount) : undefined,
    channel: out.learnChannel === "local" ? "local" : "cloud",
    liveStatus: "succeeded",
    livePhase: MANHUA_LEARN_STAGE.done,
    liveLabelZh: doneLabel,
    progressLines:
      progressLines.length > 0
        ? appendManhuaLearnProgressLine(progressLines, MANHUA_LEARN_STAGE.done, doneLabel)
        : appendManhuaLearnProgressLine(undefined, MANHUA_LEARN_STAGE.done, doneLabel),
    digestsPreview,
    proposal:
      analysisReady && proposalRaw
        ? {
            id: String(proposalRaw.id || "").trim(),
            nameZh: String(proposalRaw.nameZh || out.nameZh || "系列节奏分析").trim(),
            hook3sZh: String(proposalRaw.hook3sZh || "").trim(),
            laneZh: String(proposalRaw.laneZh || "").trim(),
            summaryZh: String(proposalRaw.summaryZh || "").trim(),
            card: proposalRaw,
          }
        : null,
  };
}

/** GCS snapshot → 面板态（刷新后回显） */
export function manhuaLearnResultFromSnapshot(input: {
  seriesKey: string;
  progress: {
    listedEpisodeCount?: number;
    titleHint?: string;
    categoryLabelZh?: string;
    tagLabelsZh?: string[] | null;
  } | null;
  digestsPreview: ManhuaLearnResultUi["digestsPreview"];
  analysisReady: boolean;
  proposal: Record<string, unknown> | null;
}): ManhuaLearnResultUi {
  const learnedCount = input.digestsPreview.length;
  const listed = Math.max(0, Math.floor(Number(input.progress?.listedEpisodeCount) || 0));
  const tags = Array.isArray(input.progress?.tagLabelsZh)
    ? input.progress!.tagLabelsZh!.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
  const proposalRaw = input.proposal;
  const analysisReady = Boolean(input.analysisReady) && Boolean(proposalRaw?.id);
  return {
    seriesKey: String(input.seriesKey || "").trim(),
    analysisReady,
    learnedCount,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    batchLearned: 0,
    messageZh: analysisReady
      ? "已从云端恢复学习进度；可预览总分析后再决定是否进库。"
      : learnedCount > 0
        ? `已从云端恢复：累计 ${learnedCount} 集，未满分析门槛可继续学节奏。`
        : "尚无已学分集。",
    categoryLabelZh:
      String(input.progress?.categoryLabelZh || "").trim() || undefined,
    tagLabelsZh: tags.length ? tags : undefined,
    listedEpisodeCount: listed || undefined,
    pendingCount: listed > 0 ? Math.max(0, listed - learnedCount) : undefined,
    digestsPreview: input.digestsPreview,
    proposal:
      analysisReady && proposalRaw
        ? {
            id: String(proposalRaw.id || "").trim(),
            nameZh: String(
              proposalRaw.nameZh || input.progress?.titleHint || "系列节奏分析",
            ).trim(),
            hook3sZh: String(proposalRaw.hook3sZh || "").trim(),
            laneZh: String(proposalRaw.laneZh || "").trim(),
            summaryZh: String(proposalRaw.summaryZh || "").trim(),
            card: proposalRaw,
          }
        : null,
  };
}
