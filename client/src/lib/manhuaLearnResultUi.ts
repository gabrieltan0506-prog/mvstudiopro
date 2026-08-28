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
import {
  MANHUA_NATIVE_MODEL_RECEIPT_MAX,
  type ManhuaNativeModelReceipt,
  type ManhuaNativeProviderErrorReceipt,
} from "@shared/manhuaNativeModelReceipt";

export const LS_MANHUA_LEARN_SERIES_KEY = "mv-manhua-learn-focus-series-v1";
export const LS_MANHUA_LEARN_ACTIVE_JOB = "mvs-manhua-learn-active-job-v1";
export const LS_MANHUA_LEARN_RESULT = "mvs-manhua-learn-result-v1";
const LS_MANHUA_LEARN_BASKET_PREFIX = "mvs-manhua-learn-basket-v1";
const LS_MANHUA_LEARN_MISSING_DISMISSED = "mvs-manhua-learn-missing-dismissed-v1";

function manhuaLearnUserStorageKey(baseKey: string, userKey: string): string {
  const scope = String(userKey || "").trim();
  return scope ? `${baseKey}:${encodeURIComponent(scope)}` : "";
}

/** 旧版无用户作用域缓存不得再被任一登录账号接管；服务端任务表负责真实恢复。 */
export function clearLegacyManhuaLearnStorage(): void {
  try {
    for (const key of [
      LS_MANHUA_LEARN_SERIES_KEY,
      LS_MANHUA_LEARN_ACTIVE_JOB,
      LS_MANHUA_LEARN_RESULT,
      LS_MANHUA_LEARN_MISSING_DISMISSED,
    ]) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export type ManhuaLearnActiveJobRecord = {
  jobId: string;
  busyKey: string;
  continuation: {
    row: {
      url?: string | null;
      gcsUri?: string | null;
      fileName?: string | null;
      localFileName?: string | null;
      learnLlm?: "claude" | "gpt" | "deepseek";
      mixName?: string | null;
      mixId?: string | null;
      platform?: string | null;
    };
    rank: number;
    seriesKey?: string;
    savedAt: number;
  };
  savedAt: number;
};

export type ManhuaLearnBasketItem = {
  seriesKey: string;
  continuation: ManhuaLearnActiveJobRecord["continuation"];
  result: ManhuaLearnResultUi;
  updatedAt: number;
  /** 服务端持久任务状态；刷新后由 /api/jobs/manhua-learn 回填。 */
  jobId?: string;
  jobStatus?: "queued" | "running" | "succeeded" | "failed";
  jobErrorZh?: string;
};

export type ManhuaLearnResultUi = {
  seriesKey: string;
  analysisReady: boolean;
  learnedCount: number;
  analysisMin: number;
  analysisTarget: number;
  batchLearned: number;
  messageZh: string;
  pipelineMode?: "native_deep_read" | "audio_dense_frames";
  nativeUsage?: {
    model: string;
    billingMode: "plan_quota" | "payg" | "unknown";
    inputTokens: number;
    outputTokens: number;
    priceEquivalentCny: number;
    elapsedMs: number;
    receiptComplete: boolean;
    visualInputTokens?: number;
    visualOutputTokens?: number;
    visualPriceEquivalentCny?: number;
    audioInputTokens?: number;
    audioOutputTokens?: number;
    audioCostCny?: number;
    seriesAggregationInputTokens?: number;
    seriesAggregationOutputTokens?: number;
    seriesAggregationReasoningTokens?: number;
    seriesAggregationPriceEquivalentCny?: number;
  };
  /** 云端学习失败时填写；有值则面板以错误态展示 */
  errorZh?: string;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
  listedEpisodeCount?: number;
  pendingCount?: number;
  /** 因来源受限暂跳的集号；不计入已学，可在来源恢复后重试 */
  skippedEpisodeIndexes?: number[];
  paywallEpisodeIndexes?: number[];
  paywallStartEpisodeIndex?: number;
  /** 付费段尚缺集数；与可继续学习的 pendingCount 分开。 */
  missingEpisodeCount?: number;
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
    learnedThroughSec?: number;
    complete?: boolean;
    previewFrameUrls?: string[];
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

function parseManhuaNativeUsage(raw: unknown): ManhuaLearnResultUi["nativeUsage"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  return {
    model: String(row.model || "unknown"),
    billingMode:
      row.billingMode === "plan_quota" || row.billingMode === "payg"
        ? row.billingMode
        : "unknown",
    inputTokens: Math.max(0, Number(row.inputTokens) || 0),
    outputTokens: Math.max(0, Number(row.outputTokens) || 0),
    priceEquivalentCny: Math.max(0, Number(row.priceEquivalentCny) || 0),
    elapsedMs: Math.max(0, Number(row.elapsedMs) || 0),
    receiptComplete: row.receiptComplete === true,
    visualInputTokens: Math.max(0, Number(row.visualInputTokens) || 0),
    visualOutputTokens: Math.max(0, Number(row.visualOutputTokens) || 0),
    visualPriceEquivalentCny: Math.max(0, Number(row.visualPriceEquivalentCny) || 0),
    audioInputTokens: Math.max(0, Number(row.audioInputTokens) || 0),
    audioOutputTokens: Math.max(0, Number(row.audioOutputTokens) || 0),
    audioCostCny: Math.max(0, Number(row.audioCostCny) || 0),
    seriesAggregationInputTokens: Math.max(0, Number(row.seriesAggregationInputTokens) || 0),
    seriesAggregationOutputTokens: Math.max(0, Number(row.seriesAggregationOutputTokens) || 0),
    seriesAggregationReasoningTokens: Math.max(
      0,
      Number(row.seriesAggregationReasoningTokens) || 0,
    ),
    seriesAggregationPriceEquivalentCny: Math.max(
      0,
      Number(row.seriesAggregationPriceEquivalentCny) || 0,
    ),
  };
}

function optionalReceiptText(value: unknown, maxChars: number): string | undefined {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return text ? text.slice(0, maxChars) : undefined;
}

function optionalReceiptNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function parseNativeProviderError(raw: unknown): ManhuaNativeProviderErrorReceipt | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const parsed: ManhuaNativeProviderErrorReceipt = {
    httpStatus: optionalReceiptNumber(row.httpStatus),
    code: optionalReceiptText(row.code, 256),
    message: optionalReceiptText(row.message, 2_000),
    requestId: optionalReceiptText(row.requestId, 256),
    param: optionalReceiptText(row.param, 512),
    type: optionalReceiptText(row.type, 256),
    responseBody: optionalReceiptText(row.responseBody, 4_000),
  };
  return Object.values(parsed).some((value) => value !== undefined) ? parsed : undefined;
}

/**
 * owner 技术区只读服务端 Job 快照；不把逐次回执并入结果/basket/localStorage。
 * 兼容旧行中的重复事件，按 callId+stage 取最后状态并限制总量。
 */
export function parseManhuaNativeModelReceipts(raw: unknown): ManhuaNativeModelReceipt[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, ManhuaNativeModelReceipt>();
  const order: string[] = [];
  for (const value of raw.slice(-MANHUA_NATIVE_MODEL_RECEIPT_MAX * 2)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const callId = optionalReceiptText(row.callId, 128);
    const model = optionalReceiptText(row.model, 128);
    const route = optionalReceiptText(row.route, 128);
    const stage = String(row.stage || "");
    const status = String(row.status || "");
    if (
      !callId
      || !model
      || !route
      || !["audio_model", "visual_model", "visual_parse", "series_aggregation_model"].includes(stage)
      || !["started", "completed", "failed"].includes(status)
    ) continue;
    const key = `${callId}\u0000${stage}`;
    const previous = byKey.get(key);
    const providerError = parseNativeProviderError(row.providerError);
    const receipt: ManhuaNativeModelReceipt = {
      callId,
      model,
      route,
      provider: optionalReceiptText(row.provider, 128),
      providerRequestId: optionalReceiptText(row.providerRequestId, 256),
      stage: stage as ManhuaNativeModelReceipt["stage"],
      status: status as ManhuaNativeModelReceipt["status"],
      atIso: optionalReceiptText(row.atIso, 64),
      startedAtIso: optionalReceiptText(row.startedAtIso, 64) || previous?.startedAtIso,
      finishedAtIso: optionalReceiptText(row.finishedAtIso, 64),
      episodeIndexes: Array.isArray(row.episodeIndexes)
        ? Array.from(new Set(row.episodeIndexes
            .map((episodeIndex) => Math.floor(Number(episodeIndex)))
            .filter((episodeIndex) => episodeIndex >= 1)))
            .sort((a, b) => a - b)
            .slice(0, 200)
        : [],
      chunkIndex: optionalReceiptNumber(row.chunkIndex),
      attemptNumber: optionalReceiptNumber(row.attemptNumber),
      temperature: optionalReceiptNumber(row.temperature),
      variant: row.variant === "mono_16k" || row.variant === "stereo_32k"
        ? row.variant
        : undefined,
      batchRequestId: optionalReceiptText(row.batchRequestId, 128),
      videoCount: optionalReceiptNumber(row.videoCount),
      elapsedMs: optionalReceiptNumber(row.elapsedMs),
      inputTokens: optionalReceiptNumber(row.inputTokens),
      audioInputTokens: optionalReceiptNumber(row.audioInputTokens),
      outputTokens: optionalReceiptNumber(row.outputTokens),
      reasoningTokens: optionalReceiptNumber(row.reasoningTokens),
      costUsd: optionalReceiptNumber(row.costUsd),
      priceEquivalentCny: optionalReceiptNumber(row.priceEquivalentCny),
      finishReason: optionalReceiptText(row.finishReason, 128),
      errorZh: optionalReceiptText(row.errorZh, 2_000),
      providerError: providerError || previous?.providerError,
    };
    if (!previous) order.push(key);
    const defined = Object.fromEntries(
      Object.entries(receipt).filter(([, field]) => field !== undefined),
    ) as unknown as ManhuaNativeModelReceipt;
    byKey.set(key, { ...previous, ...defined });
  }
  return order
    .map((key) => byKey.get(key))
    .filter((receipt): receipt is ManhuaNativeModelReceipt => Boolean(receipt))
    .slice(-MANHUA_NATIVE_MODEL_RECEIPT_MAX);
}

function parseManhuaPipelineMode(raw: unknown): ManhuaLearnResultUi["pipelineMode"] {
  return raw === "native_deep_read" || raw === "audio_dense_frames" ? raw : undefined;
}

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
  pipelineMode?: "native_deep_read" | "audio_dense_frames";
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
    pipelineMode: input.pipelineMode,
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
  const rawStage = String(out.analysisStage || "").replace(/^manhua_learn_/, "");
  const label =
    String(out.analysisStageLabel || "").trim() ||
    manhuaLearnStageLabelZh(
      tick.status === "queued" && !rawStage ? MANHUA_LEARN_STAGE.queued : rawStage,
    );
  const fromJob = parseProgressLines(out.learnProgressLog);
  const previousLine = base.progressLines?.[base.progressLines.length - 1];
  const fallbackStage = rawStage || MANHUA_LEARN_STAGE.queued;
  const progressLines =
    fromJob.length > 0
      ? fromJob
      : label
        ? previousLine?.stage === fallbackStage && previousLine.detailZh === label
          ? base.progressLines || []
          : appendManhuaLearnProgressLine(base.progressLines, fallbackStage, label)
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
  const logCounts = fromJob.reduce(
    (acc, line) => {
      const detail = line.detailZh;
      const batch = Number(/本轮新增\s*(\d+)/.exec(detail)?.[1] || 0);
      const learned = Number(/累计\s*(\d+)\s*集/.exec(detail)?.[1] || 0);
      const listed = Number(/已解析\s*(\d+)\s*集/.exec(detail)?.[1] || 0);
      return {
        batch: Math.max(acc.batch, batch),
        learned: Math.max(acc.learned, learned),
        listed: Math.max(acc.listed, listed),
      };
    },
    { batch: 0, learned: 0, listed: 0 },
  );
  const batchLearned = Math.max(
    base.batchLearned,
    Math.floor(Number(out.batchLearned) || 0),
    logCounts.batch,
  );
  // 兼容正在运行的旧 worker：旧日志只有“本轮新增 N”，至少不能继续显示 0；
  // 新 worker 同时写“累计 N 集”，恢复/续学时会显示精确累计值。
  const learnedCount = Math.max(
    base.learnedCount,
    Math.floor(Number(out.learnedCount) || 0),
    logCounts.learned,
    batchLearned,
  );
  const listedEpisodeCount = Math.max(
    Number(base.listedEpisodeCount) || 0,
    Math.floor(Number(out.listedEpisodeCount) || 0),
    logCounts.listed,
  );
  const livePaywallEpisodeIndexes = Array.isArray(out.paywallEpisodeIndexes)
    ? out.paywallEpisodeIndexes.map(Number).filter((index) => Number.isFinite(index) && index >= 1)
    : base.paywallEpisodeIndexes;
  const liveDigests = Array.isArray(out.digestsPreview)
    ? out.digestsPreview.map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          episodeIndex: Math.max(0, Math.floor(Number(row.episodeIndex) || 0)),
          title: String(row.title || "").trim(),
          hookNoteZh: String(row.hookNoteZh || "").trim(),
          transcriptPreview: String(row.transcriptPreview || "").trim(),
          durationSec: Math.max(0, Number(row.durationSec) || 0),
          learnedThroughSec: Math.max(0, Number(row.learnedThroughSec) || 0) || undefined,
          complete: row.complete === true,
          previewFrameUrls: Array.isArray(row.previewFrameUrls)
            ? row.previewFrameUrls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, 3)
            : undefined,
          categoryLabelZh: String(row.categoryLabelZh || "").trim() || undefined,
          tagLabelsZh: Array.isArray(row.tagLabelsZh)
            ? row.tagLabelsZh.map((tag) => String(tag || "").trim()).filter(Boolean)
            : undefined,
        };
      }).filter((row) => row.episodeIndex > 0)
    : [];
  return {
    ...base,
    seriesKey: String(out.seriesKey || base.seriesKey).trim() || base.seriesKey,
    pipelineMode: parseManhuaPipelineMode(out.pipelineMode) || base.pipelineMode,
    nativeUsage: parseManhuaNativeUsage(out.nativeUsage) || base.nativeUsage,
    channel: "cloud",
    liveStatus,
    livePhase: rawStage || (tick.status === "queued" ? MANHUA_LEARN_STAGE.queued : base.livePhase),
    liveLabelZh: label || base.liveLabelZh,
    progressLines,
    messageZh: label || base.messageZh,
    learnedCount,
    batchLearned,
    listedEpisodeCount: listedEpisodeCount || undefined,
    pendingCount: listedEpisodeCount > 0
      ? Math.max(
          0,
          listedEpisodeCount
            - learnedCount
            - (base.skippedEpisodeIndexes?.length || 0)
            - (livePaywallEpisodeIndexes?.length || 0),
        )
      : base.pendingCount,
    paywallEpisodeIndexes: livePaywallEpisodeIndexes?.length
      ? livePaywallEpisodeIndexes
      : undefined,
    paywallStartEpisodeIndex:
      Math.max(0, Math.floor(Number(out.paywallStartEpisodeIndex) || 0))
      || base.paywallStartEpisodeIndex,
    missingEpisodeCount: Math.max(
      0,
      Math.floor(Number(out.missingEpisodeCount) || livePaywallEpisodeIndexes?.length || 0),
    ),
    digestsPreview: liveDigests.length ? liveDigests : base.digestsPreview,
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
    skippedEpisodeIndexes: input.prev?.skippedEpisodeIndexes,
    paywallEpisodeIndexes: input.prev?.paywallEpisodeIndexes,
    paywallStartEpisodeIndex: input.prev?.paywallStartEpisodeIndex,
    pipelineMode: input.prev?.pipelineMode,
    nativeUsage: input.prev?.nativeUsage,
    missingEpisodeCount: input.prev?.missingEpisodeCount,
  };
}

export type ManhuaLearnReloadDecision = {
  tab: "overview" | "ai_manhua";
  focusSeriesKey: string;
  result: ManhuaLearnResultUi | null;
  restoreContinuation: boolean;
  clearFailedAutoResume: boolean;
};

/**
 * 刷新只自动接回仍在执行或可继续的学习状态。
 * 失败详情保留在当前会话与服务端任务记录中，但终态失败不能反复劫持刷新后的页面。
 */
export function resolveManhuaLearnReloadDecision(input: {
  focusSeriesKey: string;
  activeJob: ManhuaLearnActiveJobRecord | null;
  result: ManhuaLearnResultUi | null;
}): ManhuaLearnReloadDecision {
  const focusSeriesKey = String(input.focusSeriesKey || "").trim();
  const terminalFailure = Boolean(
    !input.activeJob
    && input.result
    && (input.result.liveStatus === "failed" || String(input.result.errorZh || "").trim()),
  );
  if (terminalFailure) {
    return {
      tab: "overview",
      focusSeriesKey: "",
      result: null,
      restoreContinuation: false,
      clearFailedAutoResume: true,
    };
  }
  return {
    tab: focusSeriesKey || input.activeJob || input.result ? "ai_manhua" : "overview",
    focusSeriesKey,
    result: input.result,
    restoreContinuation: true,
    clearFailedAutoResume: false,
  };
}

/**
 * 普通业务账号只显示产品阶段，不透出供应商、模型、token、价格或内部回执文案。
 * 技术详情由页面权限门单独展示。
 */
export function getManhuaLearnSafeProgressLabelZh(
  result: ManhuaLearnResultUi,
): string {
  if (result.liveStatus === "failed" || result.errorZh) {
    return "本轮学习未完成，已保留成功进度，可稍后重试";
  }
  if (result.liveStatus === "queued") return "等待云端任务开始";
  if (result.liveStatus === "succeeded") return "本批学习已完成";
  if (result.liveStatus === "local") return "本机接力准备中";
  if (result.liveStatus !== "running") return "学习进度已保存";

  const phase = String(result.livePhase || "").toLowerCase();
  if (/queue|list|source|download|media/.test(phase)) return "正在读取待学习剧集";
  if (/audio|sound|voice/.test(phase)) return "正在分析声音节奏";
  if (/vision|visual|frame|video/.test(phase)) return "正在分析画面节奏";
  if (/aggregate|series|synth|proposal|persist|save/.test(phase)) {
    return "正在汇总并保存学习结果";
  }
  return "正在处理本批剧集";
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

export function readManhuaLearnFocusSeriesKey(userKey: string): string {
  const storageKey = manhuaLearnUserStorageKey(LS_MANHUA_LEARN_SERIES_KEY, userKey);
  if (!storageKey) return "";
  try {
    return String(localStorage.getItem(storageKey) || "").trim();
  } catch {
    return "";
  }
}

export function writeManhuaLearnFocusSeriesKey(userKey: string, seriesKey: string): void {
  const storageKey = manhuaLearnUserStorageKey(LS_MANHUA_LEARN_SERIES_KEY, userKey);
  if (!storageKey) return;
  const key = String(seriesKey || "").trim();
  try {
    if (key) localStorage.setItem(storageKey, key);
    else localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

/**
 * 后台学习任务接力记录。刷新只接管同一个 job，绝不重新入队；
 * 同时兼容链接学习与素材分析上传的 gs:// 输入。
 */
export function readManhuaLearnActiveJob(userKey: string): ManhuaLearnActiveJobRecord | null {
  const storageKey = manhuaLearnUserStorageKey(LS_MANHUA_LEARN_ACTIVE_JOB, userKey);
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManhuaLearnActiveJobRecord>;
    const continuation = parsed.continuation;
    const row = continuation?.row;
    const url = String(row?.url || "").trim();
    const gcsUri = String(row?.gcsUri || "").trim();
    const jobId = String(parsed.jobId || "").trim();
    const savedAt = Number(parsed.savedAt);
    const validSource = /^https?:\/\//i.test(url) || /^gs:\/\//i.test(gcsUri);
    if (!jobId || !validSource || !Number.isFinite(savedAt)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    const learnLlm =
      row?.learnLlm === "claude" || row?.learnLlm === "gpt" || row?.learnLlm === "deepseek"
        ? row.learnLlm
        : undefined;
    return {
      jobId,
      busyKey: String(parsed.busyKey || jobId).trim() || jobId,
      continuation: {
        row: {
          url: url || undefined,
          gcsUri: gcsUri || undefined,
          fileName: String(row?.fileName || "").trim() || undefined,
          localFileName: String(row?.localFileName || "").trim() || undefined,
          learnLlm,
          mixName: String(row?.mixName || "").trim() || null,
          mixId: String(row?.mixId || "").trim() || null,
          platform: String(row?.platform || "").trim() || null,
        },
        rank: Math.max(0, Math.floor(Number(continuation?.rank) || 0)),
        seriesKey: String(continuation?.seriesKey || "").trim() || undefined,
        savedAt: Number(continuation?.savedAt) || savedAt,
      },
      savedAt,
    };
  } catch {
    return null;
  }
}

export function writeManhuaLearnActiveJob(
  userKey: string,
  value: ManhuaLearnActiveJobRecord | null,
): void {
  const storageKey = manhuaLearnUserStorageKey(LS_MANHUA_LEARN_ACTIVE_JOB, userKey);
  if (!storageKey) return;
  try {
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
  } catch {
    // localStorage 禁用时仍保留当前会话状态；不阻断服务端任务。
  }
}

/** 页面刷新后保留已解析总数、累计已学与待学习数；用户明确清空时才删除。 */
export function readManhuaLearnResult(userKey: string): ManhuaLearnResultUi | null {
  const storageKey = manhuaLearnUserStorageKey(LS_MANHUA_LEARN_RESULT, userKey);
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManhuaLearnResultUi>;
    if (!String(parsed.seriesKey || "").trim()) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return {
      ...(parsed as ManhuaLearnResultUi),
      seriesKey: String(parsed.seriesKey).trim(),
      learnedCount: Math.max(0, Math.floor(Number(parsed.learnedCount) || 0)),
      batchLearned: Math.max(0, Math.floor(Number(parsed.batchLearned) || 0)),
      analysisMin: Math.max(1, Math.floor(Number(parsed.analysisMin) || MANHUA_LEARN_ANALYSIS_MIN)),
      analysisTarget: Math.max(
        1,
        Math.floor(Number(parsed.analysisTarget) || MANHUA_LEARN_ANALYSIS_TARGET),
      ),
      digestsPreview: Array.isArray(parsed.digestsPreview) ? parsed.digestsPreview : [],
      proposal: parsed.proposal && typeof parsed.proposal === "object" ? parsed.proposal : null,
    };
  } catch {
    return null;
  }
}

export function writeManhuaLearnResult(userKey: string, value: ManhuaLearnResultUi | null): void {
  const storageKey = manhuaLearnUserStorageKey(LS_MANHUA_LEARN_RESULT, userKey);
  if (!storageKey) return;
  try {
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
  } catch {
    // 存储空间不足时不影响当前学习任务与 GCS 检查点。
  }
}

export function readManhuaLearnMissingDismissedKeys(userKey: string): string[] {
  const storageKey = manhuaLearnUserStorageKey(LS_MANHUA_LEARN_MISSING_DISMISSED, userKey);
  if (!storageKey) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((key) => String(key || "").trim()).filter(Boolean).slice(-100)
      : [];
  } catch {
    return [];
  }
}

export function writeManhuaLearnMissingDismissedKeys(
  userKey: string,
  keys: readonly string[],
): void {
  const storageKey = manhuaLearnUserStorageKey(LS_MANHUA_LEARN_MISSING_DISMISSED, userKey);
  if (!storageKey) return;
  try {
    const normalized = Array.from(new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))).slice(-100);
    if (normalized.length) localStorage.setItem(storageKey, JSON.stringify(normalized));
    else localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

function manhuaLearnBasketStorageKey(userKey: string): string {
  return manhuaLearnUserStorageKey(LS_MANHUA_LEARN_BASKET_PREFIX, userKey);
}

/** 当前登录用户自己的剧集篮子；只保存待学习项，完成后自动消失。 */
export function readManhuaLearnBasket(userKey: string): ManhuaLearnBasketItem[] {
  const storageKey = manhuaLearnBasketStorageKey(userKey);
  if (!storageKey) return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => value as Partial<ManhuaLearnBasketItem>)
      .filter((item) => {
        const sourceUrl = String(item.continuation?.row?.url || "").trim();
        return Boolean(
          String(item.seriesKey || "").trim()
          && /^https?:\/\//i.test(sourceUrl)
          && item.result
          && item.result.pipelineMode === "native_deep_read"
          && (
            typeof item.result.pendingCount !== "number"
            || item.result.pendingCount > 0
            || (item.result.missingEpisodeCount || 0) > 0
          ),
        );
      })
      .map((item) => item as ManhuaLearnBasketItem)
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function writeManhuaLearnBasket(userKey: string, items: ManhuaLearnBasketItem[]): void {
  const storageKey = manhuaLearnBasketStorageKey(userKey);
  if (!storageKey) return;
  try {
    const pending = (items || [])
      .filter(
        (item) => /^https?:\/\//i.test(String(item.continuation.row.url || "").trim())
          && item.result.pipelineMode === "native_deep_read"
          && (
            typeof item.result.pendingCount !== "number"
            || item.result.pendingCount > 0
            || (item.result.missingEpisodeCount || 0) > 0
          ),
      )
      .slice(0, 30);
    if (pending.length) {
      localStorage.setItem(storageKey, JSON.stringify(pending));
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // 篮子写入失败不阻断真实后台任务与 GCS 检查点。
  }
}

function sameManhuaLearnBasketItem(
  left: ManhuaLearnBasketItem,
  right: ManhuaLearnBasketItem,
): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/** 内容没有变化时复用旧结果对象，避免轮询/快照仅因对象换引用重绘面板。 */
export function reuseManhuaLearnResultIfUnchanged(
  current: ManhuaLearnResultUi | null,
  incoming: ManhuaLearnResultUi | null,
): ManhuaLearnResultUi | null {
  if (current === incoming) return current;
  if (!current || !incoming) return incoming;
  try {
    return JSON.stringify(current) === JSON.stringify(incoming) ? current : incoming;
  } catch {
    return incoming;
  }
}

/**
 * 同一来源从临时 learn_* key 升级到真实 seriesKey 时原位替换，不生成重复剧卡。
 * 已存在项不得因为后台轮询更新时间变化而换位，否则原生 select 会反复重建并跳动。
 */
export function upsertManhuaLearnBasketItem(
  items: ManhuaLearnBasketItem[],
  item: ManhuaLearnBasketItem,
): ManhuaLearnBasketItem[] {
  const currentItems = items || [];
  const source = String(
    item.continuation.row.gcsUri || item.continuation.row.url || "",
  ).trim();
  const matchesItem = (current: ManhuaLearnBasketItem) => {
    const currentSource = String(
      current.continuation.row.gcsUri || current.continuation.row.url || "",
    ).trim();
    return current.seriesKey === item.seriesKey || Boolean(source && currentSource === source);
  };
  const existingIndex = currentItems.findIndex(matchesItem);
  const kept = currentItems.filter((current) => !matchesItem(current));
  if (
    typeof item.result.pendingCount === "number"
    && item.result.pendingCount <= 0
    && (item.result.missingEpisodeCount || 0) <= 0
  ) {
    return kept.length === currentItems.length ? currentItems : kept;
  }
  if (existingIndex < 0) {
    return [item, ...kept].slice(0, 30);
  }
  if (
    kept.length === currentItems.length - 1
    && sameManhuaLearnBasketItem(currentItems[existingIndex], item)
  ) {
    return currentItems;
  }
  const insertionIndex = Math.min(existingIndex, kept.length);
  return [
    ...kept.slice(0, insertionIndex),
    item,
    ...kept.slice(insertionIndex),
  ].slice(0, 30);
}

/** 临时 seriesKey 升级时按同一素材来源续接焦点，避免 select 短暂回到空选项。 */
export function resolveManhuaLearnBasketFocusKey(
  items: ManhuaLearnBasketItem[],
  focusSeriesKey: string,
  focusSource: string,
): string {
  const key = String(focusSeriesKey || "").trim();
  if (key && (items || []).some((item) => item.seriesKey === key)) return key;
  const source = String(focusSource || "").trim();
  if (!source) return "";
  return (items || []).find((item) => String(
    item.continuation.row.gcsUri || item.continuation.row.url || "",
  ).trim() === source)?.seriesKey || "";
}

export function removeManhuaLearnBasketItem(
  items: ManhuaLearnBasketItem[],
  seriesKey: string,
): ManhuaLearnBasketItem[] {
  const key = String(seriesKey || "").trim();
  return (items || []).filter((item) => item.seriesKey !== key);
}

export type ManhuaLearnServerJobSnapshot = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  input?: { params?: Record<string, unknown> };
  output?: Record<string, unknown>;
  error?: string;
  updatedAt?: string;
};

/**
 * 任务轮询每 3 秒会拿到一份新数组；内容没变时复用旧引用，避免让整张万行页面
 * 因一次无变化的 GET 重绘原生 select。服务端每次任务写入都会同步 updatedAt，
 * 这里仍比较完整快照，防止旧任务或补写路径漏更新时间时吞掉真实进度。
 */
export function reuseManhuaLearnServerJobsIfUnchanged<
  T extends ManhuaLearnServerJobSnapshot,
>(
  current: T[],
  incoming: T[],
): T[] {
  if (current === incoming) return current;
  try {
    return JSON.stringify(current || []) === JSON.stringify(incoming || [])
      ? current
      : incoming;
  } catch {
    return incoming;
  }
}

/**
 * 原生精读任务在别的页面或 Fly owner 探针入队时，本页仍会从服务端任务表看到它。
 * 用终态签名触发一次待审列表刷新；失败任务也可能已经落下前几集卡，不能只看 succeeded。
 */
export function nativeLearnTerminalProposalRefreshSignature(
  jobs: ManhuaLearnServerJobSnapshot[],
): string {
  return (jobs || [])
    .flatMap((job) => {
      const params = job.input?.params || {};
      if (params.nativeDeepReadConfirmed !== true) return [];
      const output = job.output || {};
      const partial = output.nativePartialProposalCheckpoint;
      const partialRecord = partial && typeof partial === "object" && !Array.isArray(partial)
        ? partial as Record<string, unknown>
        : undefined;
      const partialSignature = partialRecord
        ? `${job.jobId}:partial:${Number(partialRecord.episodeIndex) || 0}:${Number(partialRecord.completedSegments) || 0}/${Number(partialRecord.totalSegments) || 0}:${String(partialRecord.updatedAt || "")}`
        : "";
      const terminalSignature = job.status === "succeeded" || job.status === "failed"
        ? `${job.jobId}:${job.status}:${String(job.updatedAt || "")}`
        : "";
      return [partialSignature, terminalSignature].filter(Boolean);
    })
    .sort()
    .join("|");
}

/** 服务端 jobs 是并发/关页恢复真源；按来源把各 Job 合并回对应剧集，而不是覆盖当前选中剧。 */
export function mergeManhuaLearnServerJobsIntoBasket(
  items: ManhuaLearnBasketItem[],
  jobs: ManhuaLearnServerJobSnapshot[],
  now = Date.now(),
): ManhuaLearnBasketItem[] {
  let next = items || [];
  const ordered = [...(jobs || [])].reverse();
  for (const job of ordered) {
    const params = job.input?.params || {};
    // 当前学习区只承载原生精读；旧抽帧任务不再恢复进页面或本地 basket。
    if (params.nativeDeepReadConfirmed !== true) continue;
    const url = String(params.url || "").trim();
    const gcsUri = String(params.gcsUri || "").trim();
    const source = gcsUri || url;
    if (!source) continue;
    const title = String(params.title || "").trim();
    const requestedSeriesKey = String(params.seriesKey || "").trim();
    const existing = next.find((item) => {
      const itemSource = String(
        item.continuation.row.gcsUri || item.continuation.row.url || "",
      ).trim();
      return itemSource === source || (requestedSeriesKey && item.seriesKey === requestedSeriesKey);
    });
    const base = existing?.result || manhuaLearnResultFromStart({
      channel: "cloud",
      url: source,
      title,
      seriesKey: requestedSeriesKey || undefined,
      pipelineMode: params.nativeDeepReadConfirmed === true
        ? "native_deep_read"
        : "audio_dense_frames",
    });
    let result: ManhuaLearnResultUi;
    if (job.status === "succeeded") {
      const out = job.output || {};
      result = isManhuaLearnEmptyBatchFailure(out)
        ? manhuaLearnResultFromFailure({
            errorZh: String(out.messageZh || "本轮未能成功采下新集"),
            url,
            title,
            prev: base,
          })
        : manhuaLearnResultFromJobOutput(out);
    } else if (job.status === "failed") {
      // 失败任务仍可能已经完成若干次模型调用并落下逐集卡；先合并服务端
      // output，再叠失败态，否则费用回执、原生模式与最后进度都会被静默丢弃。
      const failedBase = mergeManhuaLearnLiveProgress(base, {
        status: "failed",
        output: job.output,
      });
      result = manhuaLearnResultFromFailure({
        errorZh: String(job.error || "云端学习失败"),
        url,
        title,
        prev: failedBase,
      });
    } else {
      result = mergeManhuaLearnLiveProgress(base, {
        status: job.status,
        output: job.output,
      });
    }
    const seriesKey = String(result.seriesKey || requestedSeriesKey || base.seriesKey).trim();
    const continuation: ManhuaLearnActiveJobRecord["continuation"] = {
      row: {
        url: url || null,
        gcsUri: gcsUri || null,
        fileName: String(params.fileName || "").trim() || null,
        mixName: title || null,
        mixId: String(params.mixId || "").trim() || null,
        platform: String(params.platform || (/kuaishou\.com/i.test(url) ? "kuaishou" : "douyin")),
        learnLlm: params.learnLlm === "claude" ? "claude" : "gpt",
      },
      rank: Math.max(0, Math.floor(Number(params.rank) || 0)),
      seriesKey,
      savedAt: existing?.continuation.savedAt ?? now,
    };
    next = upsertManhuaLearnBasketItem(next, {
      seriesKey,
      continuation,
      result,
      updatedAt: Number.isFinite(Date.parse(String(job.updatedAt || "")))
        ? Date.parse(String(job.updatedAt))
        : existing?.updatedAt ?? now,
      jobId: job.jobId,
      jobStatus: job.status,
      jobErrorZh: job.status === "failed" ? String(job.error || "云端学习失败") : undefined,
    });
  }
  return next;
}

/**
 * 僵尸「学习进行中」降级：basket 项还挂着 running/queued，但服务端任务列表里
 * 已经找不到这个 jobId（进程重启丢任务/被回收）→ 面板必须掉到「已暂停·可继续」，
 * 不许显示进行中却没有任何 worker 在跑（2026-08-11 用户实测反馈）。
 */
export function demoteStaleRunningManhuaLearnItems(
  items: ManhuaLearnBasketItem[],
  jobs: ManhuaLearnServerJobSnapshot[],
): ManhuaLearnBasketItem[] {
  const knownJobIds = new Set((jobs || []).map((job) => job.jobId));
  let changed = false;
  const next = (items || []).map((item) => {
    const looksRunning =
      item.jobStatus === "queued"
      || item.jobStatus === "running"
      || item.result.liveStatus === "queued"
      || item.result.liveStatus === "running";
    if (!looksRunning) return item;
    if (item.jobId && knownJobIds.has(item.jobId)) return item;
    // 没有 jobId 的乐观占位（刚点开始、入队请求未返回）不动，避免误杀启动瞬间
    if (!item.jobId) return item;
    changed = true;
    return {
      ...item,
      jobStatus: undefined,
      result: {
        ...item.result,
        liveStatus: undefined,
        livePhase: undefined,
        liveLabelZh: undefined,
        // 旧 messageZh 描述的是「已开始/进行中」的过去时，保留会误导——降级必写中断说明
        messageZh: "云端任务已中断（已落盘分集与静帧保留）；点「继续」从检查点续学。",
      },
    };
  });
  return changed ? next : items;
}

export type ManhuaLearnContinueControl = {
  disabled: boolean;
  labelZh: string;
  titleZh: string;
};

/**
 * 「待学习」按钮状态：未知总集数不等于没有待学内容。
 * 有续学来源且当前无任务时，必须允许用户重新探测并从云端检查点继续。
 */
export function getManhuaLearnContinueControl(input: {
  pendingCount?: number;
  hasContinuation: boolean;
  busy: boolean;
  active: boolean;
}): ManhuaLearnContinueControl {
  if (input.busy || input.active) {
    return {
      disabled: true,
      labelZh: "当前批次学习中",
      titleZh: "当前任务结束后可继续下一批",
    };
  }
  if (!input.hasContinuation) {
    return {
      disabled: true,
      labelZh: "暂无续学来源",
      titleZh: "请重新贴入该剧链接后继续",
    };
  }
  if (typeof input.pendingCount === "number" && input.pendingCount <= 0) {
    return {
      disabled: true,
      labelZh: "已学完",
      titleZh: "当前没有待学习剧集",
    };
  }
  if (typeof input.pendingCount === "number") {
    return {
      disabled: false,
      labelZh: `待学习 ${input.pendingCount} · 继续`,
      titleZh: "继续学习下一批",
    };
  }
  return {
    disabled: false,
    labelZh: "继续学习 · 检查剩余集数",
    titleZh: "重新读取合集并从已落盘检查点继续，不会重学已完成分集",
  };
}

/** Job 虽 succeeded 但本轮 0 集：视为失败展示（兼容旧服务端软成功） */
export function isManhuaLearnEmptyBatchFailure(out: {
  batchLearned?: unknown;
  messageZh?: unknown;
  learnedCount?: unknown;
}): boolean {
  const batch = Math.max(0, Math.floor(Number(out.batchLearned) || 0));
  if (batch > 0) return false;
  const msg = String(out.messageZh || "");
  return /未能成功|本轮未能|失败：|登录态|无法拉取|请换链接/.test(msg);
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
        learnedThroughSec: Math.max(0, Number(row.learnedThroughSec) || 0) || undefined,
        complete: row.complete === true,
        previewFrameUrls: Array.isArray(row.previewFrameUrls)
          ? row.previewFrameUrls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, 3)
          : undefined,
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
  const skippedEpisodeIndexes = Array.isArray(out.skippedEpisodeIndexes)
    ? out.skippedEpisodeIndexes
        .map((n) => Math.floor(Number(n) || 0))
        .filter((n) => n >= 1)
        .sort((a, b) => a - b)
    : [];
  const paywallEpisodeIndexes = Array.isArray(out.paywallEpisodeIndexes)
    ? out.paywallEpisodeIndexes
        .map((n) => Math.floor(Number(n) || 0))
        .filter((n) => n >= 1)
        .sort((a, b) => a - b)
    : [];
  const paywallStartEpisodeIndex = Math.max(0, Math.floor(Number(out.paywallStartEpisodeIndex) || 0));
  const progressLines = parseProgressLines(out.learnProgressLog);
  const messageZh = String(out.messageZh || "").trim();
  const emptyFail = isManhuaLearnEmptyBatchFailure({
    batchLearned: out.batchLearned,
    messageZh,
    learnedCount,
  });
  const doneLabel = emptyFail
    ? messageZh || manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.failed)
    : String(out.analysisStageLabel || "").trim() ||
      manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.done);
  const linesBase =
    progressLines.length > 0
      ? progressLines
      : undefined;
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
    messageZh,
    pipelineMode: parseManhuaPipelineMode(out.pipelineMode),
    nativeUsage: parseManhuaNativeUsage(out.nativeUsage),
    errorZh: emptyFail ? messageZh || "本轮未能成功采下新集" : undefined,
    categoryLabelZh: String(out.categoryLabelZh || "").trim() || undefined,
    tagLabelsZh: seriesTags.length ? seriesTags : undefined,
    listedEpisodeCount: listed || undefined,
    // 待学 = 列表 − 已学 − 暂跳：暂跳集要走「重试暂跳集」，不算普通待学
    pendingCount:
      listed > 0
        ? Math.max(0, listed - learnedCount - skippedEpisodeIndexes.length - paywallEpisodeIndexes.length)
        : undefined,
    skippedEpisodeIndexes: skippedEpisodeIndexes.length ? skippedEpisodeIndexes : undefined,
    paywallEpisodeIndexes: paywallEpisodeIndexes.length ? paywallEpisodeIndexes : undefined,
    paywallStartEpisodeIndex: paywallStartEpisodeIndex || undefined,
    missingEpisodeCount: Math.max(
      0,
      Math.floor(Number(out.missingEpisodeCount) || paywallEpisodeIndexes.length),
    ),
    channel: out.learnChannel === "local" ? "local" : "cloud",
    liveStatus: emptyFail ? "failed" : "succeeded",
    livePhase: emptyFail ? MANHUA_LEARN_STAGE.failed : MANHUA_LEARN_STAGE.done,
    liveLabelZh: doneLabel,
    progressLines: emptyFail
      ? appendManhuaLearnProgressLine(linesBase, MANHUA_LEARN_STAGE.failed, doneLabel)
      : appendManhuaLearnProgressLine(linesBase, MANHUA_LEARN_STAGE.done, doneLabel),
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
    skippedEpisodeIndexes?: number[] | null;
    paywallEpisodeIndexes?: number[] | null;
    paywallStartEpisodeIndex?: number;
  } | null;
  digestsPreview: ManhuaLearnResultUi["digestsPreview"];
  /** 服务端已整集学完数；preview 含未学完检查点，不能拿长度冒充完成数 */
  completedCount?: number;
  pipelineMode?: "native_deep_read" | "audio_dense_frames";
  analysisReady: boolean;
  proposal: Record<string, unknown> | null;
}): ManhuaLearnResultUi {
  const learnedCount = Number.isFinite(Number(input.completedCount))
    ? Math.max(0, Math.floor(Number(input.completedCount)))
    : input.digestsPreview.length;
  const listed = Math.max(0, Math.floor(Number(input.progress?.listedEpisodeCount) || 0));
  const skippedEpisodeIndexes = Array.isArray(input.progress?.skippedEpisodeIndexes)
    ? input.progress!.skippedEpisodeIndexes!
        .map((n) => Math.floor(Number(n) || 0))
        .filter((n) => n >= 1)
        .sort((a, b) => a - b)
    : [];
  const paywallEpisodeIndexes = Array.isArray(input.progress?.paywallEpisodeIndexes)
    ? input.progress!.paywallEpisodeIndexes!
        .map((n) => Math.floor(Number(n) || 0))
        .filter((n) => n >= 1)
        .sort((a, b) => a - b)
    : [];
  const paywallStartEpisodeIndex = Math.max(
    0,
    Math.floor(Number(input.progress?.paywallStartEpisodeIndex) || 0),
  );
  const tags = Array.isArray(input.progress?.tagLabelsZh)
    ? input.progress!.tagLabelsZh!.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
  const proposalRaw = input.proposal;
  const pipelineMode = input.pipelineMode === "native_deep_read"
    ? "native_deep_read"
    : "audio_dense_frames";
  const analysisReady = pipelineMode !== "native_deep_read"
    && Boolean(input.analysisReady)
    && Boolean(proposalRaw?.id);
  return {
    seriesKey: String(input.seriesKey || "").trim(),
    analysisReady,
    learnedCount,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    batchLearned: 0,
    messageZh: pipelineMode === "native_deep_read"
      ? learnedCount > 0
        ? `已从云端恢复：累计 ${learnedCount} 张原生精读待审卡，请在待批准入库中查看。`
        : "尚无原生精读待审卡。"
      : analysisReady
      ? "已从云端恢复学习进度；可预览总分析后再决定是否进库。"
      : learnedCount > 0
        ? `已从云端恢复：累计 ${learnedCount} 集，未满分析门槛可继续学节奏。`
        : "尚无已学分集。",
    pipelineMode,
    categoryLabelZh:
      String(input.progress?.categoryLabelZh || "").trim() || undefined,
    tagLabelsZh: tags.length ? tags : undefined,
    listedEpisodeCount: listed || undefined,
    pendingCount:
      listed > 0
        ? Math.max(0, listed - learnedCount - skippedEpisodeIndexes.length - paywallEpisodeIndexes.length)
        : undefined,
    skippedEpisodeIndexes: skippedEpisodeIndexes.length ? skippedEpisodeIndexes : undefined,
    paywallEpisodeIndexes: paywallEpisodeIndexes.length ? paywallEpisodeIndexes : undefined,
    paywallStartEpisodeIndex: paywallStartEpisodeIndex || undefined,
    missingEpisodeCount: paywallEpisodeIndexes.filter(
      (episodeIndex) => !input.digestsPreview.some((digest) => digest.episodeIndex === episodeIndex && digest.complete),
    ).length,
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

/* ── 按集导出：分集报告的可导出清单与待审卡集号解析（纯函数，便于测试） ── */

export type ManhuaExportableEpisode = {
  episodeIndex: number;
  complete: true;
};

/**
 * 从 digestsPreview 里筛出**可单独导出报告**的集号（complete === true），升序返回。
 *
 * 为什么抽成纯函数：导出按钮必须一集一颗，而不是「自动挑最大 complete 集」——
 * 用户学了 1/2/3 集时要能分别导出第 1、第 2、第 3 集，这里的排序与过滤
 * 就是那份契约，测试直接打在这个函数上。
 */
export function listExportableEpisodes(
  digestsPreview:
    | ReadonlyArray<{ episodeIndex?: unknown; complete?: unknown } | null | undefined>
    | null
    | undefined,
): ManhuaExportableEpisode[] {
  return (digestsPreview || [])
    .filter(
      (d): d is { episodeIndex: number; complete: true } =>
        Boolean(d)
        && d?.complete === true
        && Number.isInteger(Number(d?.episodeIndex))
        && Number(d?.episodeIndex) >= 1,
    )
    .map((d) => ({ episodeIndex: Number(d.episodeIndex), complete: true as const }))
    .sort((a, b) => a.episodeIndex - b.episodeIndex);
}

/**
 * 从原生逐集待审卡 id（`tpl_native_<seriesKey>_epNNN`，优化提案先看
 * revision.parentTemplateId）解析出 seriesKey + episodeIndex。
 *
 * 客户端**不拼任何 GCS 对象名**：解析出来的两个字段只用于调用
 * renderEpisodeReport 接口，对象名由服务端唯一拼装。
 * 解析不出（旧系列卡、格式不符）就返回 null，调用方隐藏导出入口，不硬猜。
 */
export function parseNativeProposalEpisodeRef(
  card: { id?: unknown; revision?: { parentTemplateId?: unknown } | null } | null | undefined,
): { seriesKey: string; episodeIndex: number } | null {
  const id = String(card?.revision?.parentTemplateId || card?.id || "").trim();
  const match = id.match(/^tpl_native_([0-9A-Za-z_-]{1,40})_ep(\d{3})$/);
  if (!match) return null;
  const episodeIndex = Number(match[2]);
  if (!Number.isInteger(episodeIndex) || episodeIndex < 1) return null;
  return { seriesKey: match[1], episodeIndex };
}
