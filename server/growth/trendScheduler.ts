import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { GrowthPlatform } from "@shared/growth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collectPlatformTrends } from "./trendCollector";
import { bootstrapGrowthTrendBackfillWorker, stopGrowthTrendBackfillWorker } from "./trendBackfill";
import {
  exportSingleTrendCollectionCsv,
  isTrendCollectionStale,
  readTrendMailDigestState,
  readTrendSchedulerState,
  readTrendStore,
  mergeTrendCollections,
  reconcileTrendHistoryState,
  updateTrendMailDigestState,
  updateTrendSchedulerState,
} from "./trendStore";
import { sendMailWithAttachments } from "../services/smtp-mailer";
import { nowShanghaiIso } from "./time";
import type { PlatformTrendCollection } from "./trendCollector";

const PRIORITY_PLATFORMS: GrowthPlatform[] = ["douyin", "kuaishou", "bilibili", "xiaohongshu", "toutiao"];
const RETRY_BASE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const JITTER_MAX_MS = 20 * 60 * 1000;
const BURST_INTERVAL_MINUTES = Math.max(5, Number(process.env.GROWTH_BURST_INTERVAL_MINUTES || 15) || 15);
const LOW_YIELD_INTERVAL_MINUTES = Math.max(1, Number(process.env.GROWTH_BURST_LOW_YIELD_INTERVAL_MINUTES || 2) || 2);
const LOW_YIELD_LIMIT = Math.max(1, Number(process.env.GROWTH_BURST_LOW_YIELD_LIMIT || 5) || 5);
const BURST_TRIGGER_MIN_COUNT = Math.max(6, Number(process.env.GROWTH_BURST_TRIGGER_MIN_COUNT || 10) || 10);
const BURST_TRIGGER_GROWTH_RATIO = Math.max(0.1, Number(process.env.GROWTH_BURST_TRIGGER_GROWTH_RATIO || 0.2) || 0.2);
const BURST_EXIT_DROP_RATIO = Math.max(0.05, Number(process.env.GROWTH_BURST_EXIT_DROP_RATIO || 0.3) || 0.3);
const BURST_MIN_STABLE_RUNS = Math.max(1, Number(process.env.GROWTH_BURST_MIN_STABLE_RUNS || 2) || 2);
const MAIL_DIGEST_INTERVAL_MINUTES = Math.max(
  15,
  Number(process.env.GROWTH_MAIL_DIGEST_INTERVAL_MINUTES || 60) || 60,
);
const MAIL_DIGEST_INTERVAL_MS = MAIL_DIGEST_INTERVAL_MINUTES * 60 * 1000;
const MAIL_ATTACHMENT_SPLIT_THRESHOLD_BYTES = 10 * 1024 * 1024;
const MAIL_ATTACHMENT_CHUNK_LIMIT_BYTES = 10 * 1024 * 1024;
const SCHEDULER_TIMEZONE = "Asia/Shanghai";
const FORCE_BURST_PLATFORMS = new Set(
  String(process.env.GROWTH_FORCE_BURST_PLATFORMS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
const FORCE_BURST_UNTIL_MS = (() => {
  const raw = String(process.env.GROWTH_FORCE_BURST_UNTIL || "").trim();
  if (!raw) return 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
})();
const ENABLE_BACKFILL_BOOTSTRAP = /^(1|true|yes)$/i.test(
  String(process.env.GROWTH_ENABLE_BACKFILL_BOOTSTRAP || "").trim(),
);
let schedulerStarted = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;
const execFileAsync = promisify(execFile);

function isStorageFullError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /\bENOSPC\b|no space left on device/i.test(message);
}

function withJitter(baseMs: number) {
  return baseMs + Math.floor(Math.random() * JITTER_MAX_MS);
}

function nextRunIso(baseMs: number) {
  return nowShanghaiIso(Date.now() + withJitter(baseMs));
}

function readPlatformMinutesEnv(platform: GrowthPlatform, suffix: string, fallbackMinutes: number) {
  const value = Number(process.env[`${platform.toUpperCase()}_${suffix}`] || fallbackMinutes);
  return Number.isFinite(value) ? Math.max(1, value) : fallbackMinutes;
}

function getPlatformBurstIntervalMinutes(platform: GrowthPlatform) {
  return readPlatformMinutesEnv(platform, "BURST_INTERVAL_MINUTES", BURST_INTERVAL_MINUTES);
}

function getPlatformBurstIntervalMs(platform: GrowthPlatform) {
  return getPlatformBurstIntervalMinutes(platform) * 60 * 1000;
}

function getPlatformLowYieldIntervalMinutes(platform: GrowthPlatform) {
  return readPlatformMinutesEnv(platform, "BURST_LOW_YIELD_INTERVAL_MINUTES", LOW_YIELD_INTERVAL_MINUTES);
}

function getPlatformLowYieldIntervalMs(platform: GrowthPlatform) {
  return getPlatformLowYieldIntervalMinutes(platform) * 60 * 1000;
}

function getPlatformBurstTriggerMinCount(platform: GrowthPlatform) {
  return Math.max(1, readPlatformMinutesEnv(platform, "BURST_TRIGGER_MIN_COUNT", BURST_TRIGGER_MIN_COUNT));
}

function getPlatformBurstTriggerGrowthRatio(platform: GrowthPlatform) {
  const value = Number(process.env[`${platform.toUpperCase()}_BURST_TRIGGER_GROWTH_RATIO`] || BURST_TRIGGER_GROWTH_RATIO);
  return Number.isFinite(value) ? Math.max(0.05, value) : BURST_TRIGGER_GROWTH_RATIO;
}

function getPlatformBurstExitDropRatio(platform: GrowthPlatform) {
  const value = Number(process.env[`${platform.toUpperCase()}_BURST_EXIT_DROP_RATIO`] || BURST_EXIT_DROP_RATIO);
  return Number.isFinite(value) ? Math.max(0.05, value) : BURST_EXIT_DROP_RATIO;
}

function getSchedulerHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULER_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((part) => part.type === "hour")?.value;
  return Number(hourPart || 0);
}

function getShanghaiDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday: get("weekday"),
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function isWeekendOrHoliday(now = new Date()) {
  const { weekday, isoDate } = getShanghaiDateParts(now);
  if (weekday === "Sat" || weekday === "Sun") return true;
  const configured = String(process.env.GROWTH_HOLIDAY_DATES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.includes(isoDate);
}

function getSchedulerIntervalMinutes(now = new Date()) {
  if (isWeekendOrHoliday(now)) return 10;
  const hour = getSchedulerHour(now);
  if (hour >= 17 && hour < 22) return 60;
  if (hour >= 22 || hour < 6) return 120;
  return 180;
}

function nextScheduledRunIso(now = new Date()) {
  return nextRunIso(getSchedulerIntervalMinutes(now) * 60 * 1000);
}

function getSchedulerFrequencyLabel(now = new Date()) {
  const interval = getSchedulerIntervalMinutes(now);
  if (isWeekendOrHoliday(now)) return "周末 / 节假日每 10 分钟一次";
  if (interval < 60) return `每 ${interval} 分钟一次`;
  return `每 ${interval / 60} 小时一次`;
}

function getBurstFrequencyLabel(platform: GrowthPlatform) {
  return `${getPlatformBurstIntervalMinutes(platform)} 分钟一次`;
}

function getLowYieldFrequencyLabel(platform: GrowthPlatform) {
  return `低产出回退 / 每 ${getPlatformLowYieldIntervalMinutes(platform)} 分钟一次`;
}

function getForceBurstLabel(platform: GrowthPlatform) {
  const until = FORCE_BURST_UNTIL_MS
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: SCHEDULER_TIMEZONE,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(FORCE_BURST_UNTIL_MS))
    : "手动关闭";
  return `强制 burst（至 ${until}）/${getPlatformBurstIntervalMinutes(platform)} 分钟一次`;
}

function isForceBurstActive(platform: GrowthPlatform) {
  return FORCE_BURST_UNTIL_MS > Date.now() && FORCE_BURST_PLATFORMS.has(platform);
}

function isClearlyHigherThanPrevious(platform: GrowthPlatform, currentCount: number, previousCount: number) {
  if (previousCount <= 0) return currentCount >= getPlatformBurstTriggerMinCount(platform);
  return currentCount >= previousCount + Math.max(3, Math.ceil(previousCount * getPlatformBurstTriggerGrowthRatio(platform)));
}

function resolveNextRunPlan(params: {
  platform: GrowthPlatform;
  currentCount: number;
  previousCount: number;
  burstMode: boolean;
  burstStableRuns: number;
  burstLowYieldRuns: number;
}) {
  if (isForceBurstActive(params.platform)) {
    const lowYieldRuns = isClearlyHigherThanPrevious(params.platform, params.currentCount, params.previousCount)
      ? 0
      : params.burstLowYieldRuns + 1;
    const lowYieldMode = lowYieldRuns >= LOW_YIELD_LIMIT;
    return {
      burstMode: true,
      nextRunAt: nextRunIso(lowYieldMode ? getPlatformLowYieldIntervalMs(params.platform) : getPlatformBurstIntervalMs(params.platform)),
      frequencyLabel: lowYieldMode ? getLowYieldFrequencyLabel(params.platform) : getForceBurstLabel(params.platform),
      burstStableRuns: params.burstStableRuns,
      burstLowYieldRuns: lowYieldRuns,
      burstEvent: params.burstMode ? ("stay" as const) : ("enter" as const),
    };
  }

  if (params.burstMode) {
    const exitThreshold = Math.max(0, Math.floor(params.previousCount * (1 - getPlatformBurstExitDropRatio(params.platform))));
    if (params.currentCount < exitThreshold && params.burstStableRuns >= BURST_MIN_STABLE_RUNS) {
      return {
        burstMode: false,
        nextRunAt: nextScheduledRunIso(),
        frequencyLabel: getSchedulerFrequencyLabel(),
        burstStableRuns: 0,
        burstLowYieldRuns: 0,
        burstEvent: "exit" as const,
      };
    }
    const lowYieldRuns = isClearlyHigherThanPrevious(params.platform, params.currentCount, params.previousCount)
      ? 0
      : params.burstLowYieldRuns + 1;
    const lowYieldMode = lowYieldRuns >= LOW_YIELD_LIMIT;
    return {
      burstMode: true,
      nextRunAt: nextRunIso(lowYieldMode ? getPlatformLowYieldIntervalMs(params.platform) : getPlatformBurstIntervalMs(params.platform)),
      frequencyLabel: lowYieldMode ? getLowYieldFrequencyLabel(params.platform) : getBurstFrequencyLabel(params.platform),
      burstStableRuns: params.currentCount >= params.previousCount ? params.burstStableRuns + 1 : 0,
      burstLowYieldRuns: lowYieldRuns,
      burstEvent: "stay" as const,
    };
  }

  if (isClearlyHigherThanPrevious(params.platform, params.currentCount, params.previousCount)) {
    return {
      burstMode: true,
      nextRunAt: nextRunIso(getPlatformBurstIntervalMs(params.platform)),
      frequencyLabel: getBurstFrequencyLabel(params.platform),
      burstStableRuns: 0,
      burstLowYieldRuns: 0,
      burstEvent: "enter" as const,
    };
  }

  return {
    burstMode: false,
    nextRunAt: nextScheduledRunIso(),
    frequencyLabel: getSchedulerFrequencyLabel(),
    burstStableRuns: 0,
    burstLowYieldRuns: 0,
    burstEvent: "none" as const,
  };
}

function buildRetryDelayMs(failureCount: number) {
  return Math.min(60 * 60 * 1000, RETRY_BASE_MS * Math.max(1, 2 ** Math.max(0, failureCount - 1)));
}

async function getAttachmentSize(attachment: {
  path?: string;
  content?: string | Buffer;
}) {
  if (attachment.path) {
    const stat = await fs.stat(attachment.path);
    return stat.size;
  }
  if (typeof attachment.content === "string") {
    return Buffer.byteLength(attachment.content);
  }
  if (attachment.content) {
    return attachment.content.length;
  }
  return 0;
}

async function chunkMailAttachments<T extends {
  path?: string;
  content?: string | Buffer;
}>(attachments: T[], chunkLimitBytes = MAIL_ATTACHMENT_CHUNK_LIMIT_BYTES) {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;

  for (const attachment of attachments) {
    const size = await getAttachmentSize(attachment);
    if (current.length && currentSize + size > chunkLimitBytes) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(attachment);
    currentSize += size;
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
}

async function sanitizeMailAttachments<T extends {
  filename: string;
  path?: string;
  contentType?: string;
  content?: string | Buffer;
}>(attachments: T[]) {
  const valid: T[] = [];
  const dropped: T[] = [];
  const seen = new Set<string>();

  for (const attachment of attachments) {
    const dedupeKey = attachment.path || `${attachment.filename}:${attachment.contentType || "-"}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    try {
      await getAttachmentSize(attachment);
      valid.push(attachment);
    } catch {
      dropped.push(attachment);
    }
  }

  if (dropped.length) {
    console.info(
      `[growth.scheduler] dropped ${dropped.length} stale attachment(s): ${dropped
        .slice(0, 5)
        .map((attachment) => attachment.path || attachment.filename)
        .join(", ")}`,
    );
  }

  return { valid, dropped };
}

async function buildZipAttachment(
  attachments: Array<{
    filename: string;
    path?: string;
    content?: string | Buffer;
    contentType?: string;
  }>,
  index: number,
  total: number,
) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "growth-mail-zip-"));
  const zipPath = path.join(tempDir, total > 1 ? `creator-growth-camp-${index + 1}-of-${total}.zip` : "creator-growth-camp.zip");

  try {
    for (const attachment of attachments) {
      const content = attachment.path
        ? await fs.readFile(attachment.path)
        : (typeof attachment.content === "string" ? Buffer.from(attachment.content) : attachment.content);
      if (!content) continue;
      await fs.writeFile(path.join(tempDir, attachment.filename), content);
    }

    const fileNames = attachments.map((attachment) => attachment.filename);
    await execFileAsync("/usr/bin/zip", ["-q", "-9", zipPath, ...fileNames], {
      cwd: tempDir,
      maxBuffer: 50 * 1024 * 1024,
    });
    const buffer = await fs.readFile(zipPath);

    return {
      filename: path.basename(zipPath),
      content: buffer,
      contentType: "application/zip",
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function sendChunkedDigest(params: {
  recipient: string;
  subjectBase: string;
  textBase: string;
  htmlBase: string;
  attachments: Array<{
    filename: string;
    path?: string;
    contentType?: string;
    content?: string | Buffer;
  }>;
  sentAt: string;
}) {
  const { valid: sanitizedAttachments } = await sanitizeMailAttachments(params.attachments);
  const totalBytes = (await Promise.all(
    sanitizedAttachments.map((attachment) => getAttachmentSize(attachment)),
  )).reduce((sum, size) => sum + size, 0);

  if (!sanitizedAttachments.length) {
    await sendMailWithAttachments({
      to: params.recipient,
      subject: params.subjectBase,
      requireResend: true,
      text: params.textBase,
      html: params.htmlBase,
    });
    console.info("[growth.scheduler] digest sent without attachments");
    return { sentAt: params.sentAt, emailCount: 1 };
  }

  if (totalBytes <= MAIL_ATTACHMENT_SPLIT_THRESHOLD_BYTES) {
    await sendMailWithAttachments({
      to: params.recipient,
      subject: params.subjectBase,
      requireResend: true,
      text: params.textBase,
      html: params.htmlBase,
      attachments: sanitizedAttachments,
    });
    console.info(
      `[growth.scheduler] digest sent: emails=1 attachments=${sanitizedAttachments.length} totalBytes=${totalBytes} mode=raw`,
    );
    return { sentAt: params.sentAt, emailCount: 1 };
  }

  const rawChunks = await chunkMailAttachments(sanitizedAttachments);
  const zipChunks = await Promise.all(
    rawChunks.map((chunk, index) => buildZipAttachment(chunk, index, rawChunks.length)),
  );

  for (let index = 0; index < zipChunks.length; index += 1) {
    const attachment = zipChunks[index];
    await sendMailWithAttachments({
      to: params.recipient,
      subject: `${params.subjectBase} (${index + 1}/${zipChunks.length})`,
      requireResend: true,
      text: `${params.textBase}\n\n压缩附件分片：${index + 1}/${zipChunks.length}`,
      html: `${params.htmlBase}<p><strong>压缩附件分片：</strong>${index + 1}/${zipChunks.length}</p>`,
      attachments: [attachment],
    });
  }

  console.info(
    `[growth.scheduler] digest sent: emails=${zipChunks.length} attachments=${sanitizedAttachments.length} totalBytes=${totalBytes} mode=zip`,
  );

  return {
    sentAt: params.sentAt,
    emailCount: zipChunks.length,
  };
}

async function notifyCollectionUpdate(params: {
  platform: GrowthPlatform;
  itemCount: number;
  addedCount: number;
  mergedCount: number;
  collectedAt: string;
  nextRunAt: string;
  frequencyLabel: string;
  burstMode: boolean;
  live: boolean;
  collection: PlatformTrendCollection;
}) {
  const recipient = String(process.env.GROWTH_TREND_REPORT_EMAIL || "").trim();
  if (!recipient) return;
  const digestState = await readTrendMailDigestState();
  const lastSentAtMs = digestState.lastSentAt ? new Date(digestState.lastSentAt).getTime() : 0;
  const nowIso = nowShanghaiIso();
  const withinWindow = lastSentAtMs && Date.now() - lastSentAtMs < MAIL_DIGEST_INTERVAL_MS;

  if (withinWindow) {
    console.info("[growth.scheduler] digest skipped within hourly window");
    await updateTrendMailDigestState({
      lastWindowMinutes: MAIL_DIGEST_INTERVAL_MINUTES,
      pendingAttachmentBytes: 0,
      pendingCreatedAt: undefined,
      pendingSubjectBase: undefined,
      pendingTextBase: undefined,
      pendingHtmlBase: undefined,
      pendingAttachmentBatches: undefined,
    });
    return;
  }

  const scheduler = await readTrendSchedulerState();
  const exported = await exportSingleTrendCollectionCsv(params.collection);
  const platformFile = exported.files[0];
  const schedulerSummary = Object.values(scheduler || {})
    .map((item) =>
      `${item.platform}: ${item.lastCollectedCount || 0} 条 / 下次 ${item.nextRunAt || "-"} / ${item.lastFrequencyLabel || "-"}`,
    )
    .join("\n");

  const subjectBase = `Creator Growth Camp 数据汇总 - ${nowShanghaiIso().slice(0, 16).replace("T", " ")}`;
  const textBase =
    `[Growth Trend Scheduler ${MAIL_DIGEST_INTERVAL_MINUTES}分钟汇总]\n` +
    `最新触发平台：${params.platform}\n` +
    `最新抓取时间：${params.collectedAt}\n` +
    `最新新增数量：${params.addedCount}\n` +
    `最新合并数量：${params.mergedCount}\n` +
    `该平台当前总样本数：${params.itemCount}\n` +
    `当前 live 调度频率：${params.frequencyLabel}\n` +
    `当前 burst mode：${params.burstMode ? "ON" : "OFF"}\n` +
    `是否真实 live：${params.live ? "是" : "否"}\n` +
    `下次计划抓取：${params.nextRunAt}\n` +
    `\n[当前调度概览]\n${schedulerSummary}\n` +
    `\n[本次增量附件]\n` +
    `本次导出行数：${exported.rows}\n` +
    `清单：${exported.manifestPath}\n` +
    `说明：邮件仅附带本次触发平台的增量导出，不再附带全平台全量导出。`;
  const htmlBase =
    `<p><strong>汇总窗口：</strong>${MAIL_DIGEST_INTERVAL_MINUTES} 分钟</p>` +
    `<p><strong>最新触发平台：</strong>${params.platform}</p>` +
    `<p><strong>抓取时间：</strong>${params.collectedAt}</p>` +
    `<p><strong>本次新增：</strong>${params.addedCount}</p>` +
    `<p><strong>本次合并：</strong>${params.mergedCount}</p>` +
    `<p><strong>该平台当前总样本数：</strong>${params.itemCount}</p>` +
    `<p><strong>下次计划抓取：</strong>${params.nextRunAt}</p>` +
    `<p><strong>当前 live 调度频率：</strong>${params.frequencyLabel}</p>` +
    `<p><strong>当前 burst mode：</strong>${params.burstMode ? "ON" : "OFF"}</p>` +
    `<p><strong>是否真实 live：</strong>${params.live ? "是" : "否"}</p>` +
    `<p><strong>当前调度概览：</strong></p><p>${schedulerSummary.replace(/\n/g, "<br />")}</p>` +
    `<p><strong>本次导出行数：</strong>${exported.rows}</p>` +
    (platformFile ? `<p><strong>本次重点附件：</strong>${path.basename(platformFile.filePath)}</p>` : "") +
    `<p><strong>说明：</strong>邮件仅附带本次触发平台的增量导出，不再附带全平台全量导出。</p>`;

  const attachments = [
    ...exported.files.map((file) => ({
      filename: path.basename(file.filePath),
      path: file.filePath,
      contentType: "text/csv",
    })),
    {
      filename: path.basename(exported.manifestPath),
      path: exported.manifestPath,
      contentType: "application/json",
    },
  ];

  const sendResult = await sendChunkedDigest({
    recipient,
    subjectBase,
    textBase,
    htmlBase,
    attachments,
    sentAt: nowIso,
  });
  console.info(
    `[growth.scheduler] digest state updated: lastSentAt=${nowIso} emailCount=${sendResult.emailCount}`,
  );
  await updateTrendMailDigestState({
    lastSentAt: nowIso,
    lastManifestPath: exported.manifestPath,
    lastWindowMinutes: MAIL_DIGEST_INTERVAL_MINUTES,
    pendingAttachmentBytes: 0,
    pendingCreatedAt: undefined,
    pendingSubjectBase: undefined,
    pendingTextBase: undefined,
    pendingHtmlBase: undefined,
    pendingAttachmentBatches: undefined,
  });
}

async function runPlatform(platform: GrowthPlatform) {
  const startedAt = nowShanghaiIso();
  const startedAtMs = Date.now();
  const currentState = (await readTrendSchedulerState())[platform];
  await updateTrendSchedulerState(platform, {
    lastRunAt: startedAt,
  });

  try {
    const collection = await collectPlatformTrends(platform);
    const mergedStore = await mergeTrendCollections({ [platform]: collection });
    const mergedCollection = mergedStore.collections[platform];
    const currentCount = collection.stats?.itemCount || collection.items.length;
    const previousCount = currentState?.lastCollectedCount || 0;
    const plan = resolveNextRunPlan({
      platform,
      currentCount,
      previousCount,
      burstMode: Boolean(currentState?.burstMode),
      burstStableRuns: currentState?.burstStableRuns || 0,
      burstLowYieldRuns: currentState?.burstLowYieldRuns || 0,
    });
    await updateTrendSchedulerState(platform, {
      lastSuccessAt: collection.collectedAt,
      nextRunAt: plan.nextRunAt,
      failureCount: 0,
      totalRuns: (currentState?.totalRuns || 0) + 1,
      successCount: (currentState?.successCount || 0) + 1,
      lastDurationMs: Date.now() - startedAtMs,
      lastCollectedCount: currentCount,
      lastAddedCount: mergedStore.mergeStats?.[platform]?.addedCount || 0,
      lastMergedCount: mergedStore.mergeStats?.[platform]?.mergedCount || 0,
      burstMode: plan.burstMode,
      burstEnterCount: (currentState?.burstEnterCount || 0) + (plan.burstEvent === "enter" ? 1 : 0),
      burstExitCount: (currentState?.burstExitCount || 0) + (plan.burstEvent === "exit" ? 1 : 0),
      burstStableRuns: plan.burstStableRuns,
      burstLowYieldRuns: plan.burstLowYieldRuns,
      burstTriggeredAt: plan.burstMode
        ? (currentState?.burstMode ? currentState?.burstTriggeredAt : collection.collectedAt)
        : undefined,
      lastFrequencyLabel: plan.frequencyLabel,
      lastError: undefined,
    });
    if (collection.source === "live" && (mergedCollection?.items.length || 0) > 0) {
      const mergeStat = mergedStore.mergeStats?.[platform];
      await notifyCollectionUpdate({
        platform,
        itemCount: mergedCollection?.items.length || 0,
        addedCount: mergeStat?.addedCount || 0,
        mergedCount: mergeStat?.mergedCount || 0,
        collectedAt: collection.collectedAt,
        nextRunAt: plan.nextRunAt,
        frequencyLabel: plan.frequencyLabel,
        burstMode: plan.burstMode,
        live: collection.source === "live",
        collection,
      }).catch((error) => {
        console.warn(`[growth.scheduler] email notify skipped for ${platform}:`, error);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = (await readTrendSchedulerState())[platform];
    const failureCount = (current?.failureCount || 0) + 1;
    const forcedBurst = isForceBurstActive(platform);
    const storageFull = isStorageFullError(error);
    await updateTrendSchedulerState(platform, {
      failureCount,
      totalRuns: (current?.totalRuns || 0) + 1,
      totalFailures: (current?.totalFailures || 0) + 1,
      lastDurationMs: Date.now() - startedAtMs,
      lastError: message,
      burstMode: forcedBurst,
      burstStableRuns: forcedBurst ? (current?.burstStableRuns || 0) : 0,
      burstLowYieldRuns: forcedBurst ? (current?.burstLowYieldRuns || 0) : 0,
      burstTriggeredAt: forcedBurst ? (current?.burstTriggeredAt || startedAt) : undefined,
      nextRunAt: forcedBurst
        ? nextRunIso(storageFull ? getPlatformBurstIntervalMs(platform) : getPlatformLowYieldIntervalMs(platform))
        : nextRunIso(buildRetryDelayMs(failureCount)),
      lastFrequencyLabel: forcedBurst
        ? (storageFull ? getBurstFrequencyLabel(platform) : getLowYieldFrequencyLabel(platform))
        : current?.lastFrequencyLabel,
    });
    console.warn(`[growth.scheduler] ${platform} failed:`, message);
  }
}

async function runDuePlatforms() {
  if (runInFlight) return;
  runInFlight = true;
  try {
    const store = await readTrendStore();
    const scheduler = await readTrendSchedulerState();
    const queue = PRIORITY_PLATFORMS.filter((platform) => {
      const nextRunAt = scheduler[platform]?.nextRunAt;
      if (!nextRunAt) {
        const lastCollectedAt = store.collections[platform]?.collectedAt;
        return isTrendCollectionStale(lastCollectedAt, getSchedulerIntervalMinutes() / 60);
      }
      return new Date(nextRunAt).getTime() <= Date.now();
    });

    for (const platform of queue) {
      await runPlatform(platform);
    }
  } finally {
    runInFlight = false;
  }
}

export async function bootstrapGrowthTrendScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  await reconcileTrendHistoryState().catch((error) => {
    console.warn("[growth.history] reconcile on bootstrap failed:", error);
  });

  const scheduler = await readTrendSchedulerState();
  for (const platform of PRIORITY_PLATFORMS) {
    if (!scheduler[platform]?.nextRunAt) {
      await updateTrendSchedulerState(platform, {
        platform,
        failureCount: scheduler[platform]?.failureCount || 0,
        nextRunAt: nowShanghaiIso(),
      });
    }
  }

  if (ENABLE_BACKFILL_BOOTSTRAP) {
    bootstrapGrowthTrendBackfillWorker().catch((error) => {
      console.warn("[growth.backfill] bootstrap failed:", error);
    });
  } else {
    console.info("[growth.backfill] bootstrap skipped; set GROWTH_ENABLE_BACKFILL_BOOTSTRAP=1 to enable automatic historical backfill on boot.");
  }
  runDuePlatforms().catch((error) => {
    console.warn("[growth.scheduler] initial bootstrap failed:", error);
  });

  tickTimer = setInterval(() => {
    runDuePlatforms().catch((error) => {
      console.warn("[growth.scheduler] periodic tick failed:", error);
    });
  }, CHECK_INTERVAL_MS);
}

export function stopGrowthTrendScheduler() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  stopGrowthTrendBackfillWorker();
  schedulerStarted = false;
}
