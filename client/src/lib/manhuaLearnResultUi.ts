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
export const LS_MANHUA_LEARN_ACTIVE_JOB = "mvs-manhua-learn-active-job-v1";
export const LS_MANHUA_LEARN_RESULT = "mvs-manhua-learn-result-v1";
const LS_MANHUA_LEARN_BASKET_PREFIX = "mvs-manhua-learn-basket-v1";

export type ManhuaLearnActiveJobRecord = {
  jobId: string;
  busyKey: string;
  continuation: {
    row: {
      url?: string | null;
      gcsUri?: string | null;
      fileName?: string | null;
      localFileName?: string | null;
      learnLlm?: "claude" | "gpt";
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
    channel: "cloud",
    liveStatus,
    livePhase: String(out.analysisStage || base.livePhase || "").replace(/^manhua_learn_/, ""),
    liveLabelZh: label || base.liveLabelZh,
    progressLines,
    messageZh: label || base.messageZh,
    learnedCount,
    batchLearned,
    listedEpisodeCount: listedEpisodeCount || undefined,
    pendingCount: listedEpisodeCount > 0
      ? Math.max(0, listedEpisodeCount - learnedCount)
      : base.pendingCount,
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

/**
 * 后台学习任务接力记录。刷新只接管同一个 job，绝不重新入队；
 * 同时兼容链接学习与素材分析上传的 gs:// 输入。
 */
export function readManhuaLearnActiveJob(): ManhuaLearnActiveJobRecord | null {
  try {
    const raw = localStorage.getItem(LS_MANHUA_LEARN_ACTIVE_JOB);
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
      localStorage.removeItem(LS_MANHUA_LEARN_ACTIVE_JOB);
      return null;
    }
    const learnLlm = row?.learnLlm === "claude" || row?.learnLlm === "gpt"
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

export function writeManhuaLearnActiveJob(value: ManhuaLearnActiveJobRecord | null): void {
  try {
    if (value) localStorage.setItem(LS_MANHUA_LEARN_ACTIVE_JOB, JSON.stringify(value));
    else localStorage.removeItem(LS_MANHUA_LEARN_ACTIVE_JOB);
  } catch {
    // localStorage 禁用时仍保留当前会话状态；不阻断服务端任务。
  }
}

/** 页面刷新后保留已解析总数、累计已学与待学习数；用户明确清空时才删除。 */
export function readManhuaLearnResult(): ManhuaLearnResultUi | null {
  try {
    const raw = localStorage.getItem(LS_MANHUA_LEARN_RESULT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManhuaLearnResultUi>;
    if (!String(parsed.seriesKey || "").trim()) {
      localStorage.removeItem(LS_MANHUA_LEARN_RESULT);
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

export function writeManhuaLearnResult(value: ManhuaLearnResultUi | null): void {
  try {
    if (value) localStorage.setItem(LS_MANHUA_LEARN_RESULT, JSON.stringify(value));
    else localStorage.removeItem(LS_MANHUA_LEARN_RESULT);
  } catch {
    // 存储空间不足时不影响当前学习任务与 GCS 检查点。
  }
}

function manhuaLearnBasketStorageKey(userKey: string): string {
  const safe = String(userKey || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return `${LS_MANHUA_LEARN_BASKET_PREFIX}:${safe || "anonymous"}`;
}

/** 当前登录用户自己的剧集篮子；只保存待学习项，完成后自动消失。 */
export function readManhuaLearnBasket(userKey: string): ManhuaLearnBasketItem[] {
  try {
    const raw = localStorage.getItem(manhuaLearnBasketStorageKey(userKey));
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
          && (typeof item.result.pendingCount !== "number" || item.result.pendingCount > 0),
        );
      })
      .map((item) => item as ManhuaLearnBasketItem)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function writeManhuaLearnBasket(userKey: string, items: ManhuaLearnBasketItem[]): void {
  try {
    const pending = (items || [])
      .filter(
        (item) => /^https?:\/\//i.test(String(item.continuation.row.url || "").trim())
          && (typeof item.result.pendingCount !== "number" || item.result.pendingCount > 0),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
    if (pending.length) {
      localStorage.setItem(manhuaLearnBasketStorageKey(userKey), JSON.stringify(pending));
    } else {
      localStorage.removeItem(manhuaLearnBasketStorageKey(userKey));
    }
  } catch {
    // 篮子写入失败不阻断真实后台任务与 GCS 检查点。
  }
}

/** 同一来源从临时 learn_* key 升级到真实 seriesKey 时原位替换，不生成重复剧卡。 */
export function upsertManhuaLearnBasketItem(
  items: ManhuaLearnBasketItem[],
  item: ManhuaLearnBasketItem,
): ManhuaLearnBasketItem[] {
  const source = String(
    item.continuation.row.gcsUri || item.continuation.row.url || "",
  ).trim();
  const kept = (items || []).filter((current) => {
    const currentSource = String(
      current.continuation.row.gcsUri || current.continuation.row.url || "",
    ).trim();
    return current.seriesKey !== item.seriesKey && (!source || currentSource !== source);
  });
  if (typeof item.result.pendingCount === "number" && item.result.pendingCount <= 0) {
    return kept;
  }
  return [item, ...kept].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
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

/** 服务端 jobs 是并发/关页恢复真源；按来源把各 Job 合并回对应剧集，而不是覆盖当前选中剧。 */
export function mergeManhuaLearnServerJobsIntoBasket(
  items: ManhuaLearnBasketItem[],
  jobs: ManhuaLearnServerJobSnapshot[],
  now = Date.now(),
): ManhuaLearnBasketItem[] {
  let next = [...(items || [])];
  const ordered = [...(jobs || [])].reverse();
  for (const job of ordered) {
    const params = job.input?.params || {};
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
      result = manhuaLearnResultFromFailure({
        errorZh: String(job.error || "云端学习失败"),
        url,
        title,
        prev: base,
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
      savedAt: now,
    };
    next = upsertManhuaLearnBasketItem(next, {
      seriesKey,
      continuation,
      result,
      updatedAt: Number.isFinite(Date.parse(String(job.updatedAt || "")))
        ? Date.parse(String(job.updatedAt))
        : now,
      jobId: job.jobId,
      jobStatus: job.status,
      jobErrorZh: job.status === "failed" ? String(job.error || "云端学习失败") : undefined,
    });
  }
  return next;
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
    errorZh: emptyFail ? messageZh || "本轮未能成功采下新集" : undefined,
    categoryLabelZh: String(out.categoryLabelZh || "").trim() || undefined,
    tagLabelsZh: seriesTags.length ? seriesTags : undefined,
    listedEpisodeCount: listed || undefined,
    pendingCount: listed > 0 ? Math.max(0, listed - learnedCount) : undefined,
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
  } | null;
  digestsPreview: ManhuaLearnResultUi["digestsPreview"];
  /** 服务端已整集学完数；preview 含未学完检查点，不能拿长度冒充完成数 */
  completedCount?: number;
  analysisReady: boolean;
  proposal: Record<string, unknown> | null;
}): ManhuaLearnResultUi {
  const learnedCount = Number.isFinite(Number(input.completedCount))
    ? Math.max(0, Math.floor(Number(input.completedCount)))
    : input.digestsPreview.length;
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
