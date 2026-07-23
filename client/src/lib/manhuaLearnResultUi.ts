/**
 * Platform「学节奏」结果面板：会话态 ↔ GCS snapshot 映射，本机记住最近合集 key。
 */

import {
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_ANALYSIS_TARGET,
} from "@shared/manhuaTemplateLearnSeries";

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

/** 失败也落面板，避免只 toast / 复制本机命令却看不见原因 */
export function manhuaLearnResultFromFailure(input: {
  errorZh: string;
  url?: string;
  title?: string;
  seriesKey?: string;
}): ManhuaLearnResultUi {
  const errorZh = String(input.errorZh || "云端学习失败").trim().slice(0, 400);
  const titleHint = String(input.title || "").trim().slice(0, 40);
  const urlHint = String(input.url || "").trim().slice(0, 80);
  const seriesKey =
    String(input.seriesKey || "").trim() ||
    `fail_${Date.now().toString(36)}`;
  const context = [titleHint, urlHint].filter(Boolean).join(" · ");
  return {
    seriesKey,
    analysisReady: false,
    learnedCount: 0,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    batchLearned: 0,
    messageZh: context ? `${errorZh}（${context}）` : errorZh,
    errorZh,
    digestsPreview: [],
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
