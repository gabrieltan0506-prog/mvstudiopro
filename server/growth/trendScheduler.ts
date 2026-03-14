import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import { collectPlatformTrends } from "./trendCollector";
import {
  exportTrendCollectionsCsv,
  isTrendCollectionStale,
  mergeTrendCollections,
  readTrendSchedulerState,
  readTrendStore,
  updateTrendSchedulerState,
} from "./trendStore";
import { sendMailWithAttachments } from "../services/smtp-mailer";

const PLATFORM_INTERVAL_MINUTES: Record<GrowthPlatform, number> = {
  douyin: 180,
  kuaishou: 240,
  bilibili: 240,
  xiaohongshu: 360,
  weixin_channels: 720,
  toutiao: 720,
};

const PRIORITY_PLATFORMS: GrowthPlatform[] = ["douyin", "kuaishou", "bilibili", "xiaohongshu"];
const RETRY_BASE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const JITTER_MAX_MS = 20 * 60 * 1000;
const DEFAULT_REPORT_EMAIL = "benjamintan0318@gmail.com";

let schedulerStarted = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;

function withJitter(baseMs: number) {
  return baseMs + Math.floor(Math.random() * JITTER_MAX_MS);
}

function nextRunIso(baseMs: number) {
  return new Date(Date.now() + withJitter(baseMs)).toISOString();
}

function buildRetryDelayMs(failureCount: number) {
  return Math.min(60 * 60 * 1000, RETRY_BASE_MS * Math.max(1, 2 ** Math.max(0, failureCount - 1)));
}

async function notifyCollectionUpdate(params: {
  platform: GrowthPlatform;
  itemCount: number;
  collectedAt: string;
  nextRunAt: string;
}) {
  const recipient = String(process.env.GROWTH_TREND_REPORT_EMAIL || DEFAULT_REPORT_EMAIL).trim();
  if (!recipient) return;

  const exported = await exportTrendCollectionsCsv();
  const platformFile = exported.files.find((file) => file.platform === params.platform);

  await sendMailWithAttachments({
    to: recipient,
    subject: `Creator Growth Camp 抓取更新 - ${params.platform}`,
    text:
      `平台：${params.platform}\n` +
      `抓取时间：${params.collectedAt}\n` +
      `新增/合并后样本数：${params.itemCount}\n` +
      `下次计划抓取：${params.nextRunAt}\n` +
      `总导出行数：${exported.rows}\n` +
      `清单：${exported.manifestPath}`,
    attachments: [
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
    ],
    html:
      `<p><strong>平台：</strong>${params.platform}</p>` +
      `<p><strong>抓取时间：</strong>${params.collectedAt}</p>` +
      `<p><strong>样本数：</strong>${params.itemCount}</p>` +
      `<p><strong>下次计划抓取：</strong>${params.nextRunAt}</p>` +
      `<p><strong>总导出行数：</strong>${exported.rows}</p>` +
      (platformFile ? `<p><strong>本次重点附件：</strong>${path.basename(platformFile.filePath)}</p>` : ""),
  });
}

async function runPlatform(platform: GrowthPlatform) {
  const startedAt = new Date().toISOString();
  await updateTrendSchedulerState(platform, {
    lastRunAt: startedAt,
  });

  try {
    const collection = await collectPlatformTrends(platform);
    const mergedStore = await mergeTrendCollections({ [platform]: collection });
    const mergedCollection = mergedStore.collections[platform];
    const nextRunAt = nextRunIso(PLATFORM_INTERVAL_MINUTES[platform] * 60 * 1000);
    await updateTrendSchedulerState(platform, {
      lastSuccessAt: collection.collectedAt,
      nextRunAt,
      failureCount: 0,
      lastError: undefined,
    });
    if (collection.source === "live" && (mergedCollection?.items.length || 0) > 0) {
      await notifyCollectionUpdate({
        platform,
        itemCount: mergedCollection?.items.length || 0,
        collectedAt: collection.collectedAt,
        nextRunAt,
      }).catch((error) => {
        console.warn(`[growth.scheduler] email notify skipped for ${platform}:`, error);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = (await readTrendSchedulerState())[platform];
    const failureCount = (current?.failureCount || 0) + 1;
    await updateTrendSchedulerState(platform, {
      failureCount,
      lastError: message,
      nextRunAt: nextRunIso(buildRetryDelayMs(failureCount)),
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
        return isTrendCollectionStale(lastCollectedAt, PLATFORM_INTERVAL_MINUTES[platform] / 60);
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

  const scheduler = await readTrendSchedulerState();
  for (const platform of PRIORITY_PLATFORMS) {
    if (!scheduler[platform]?.nextRunAt) {
      await updateTrendSchedulerState(platform, {
        platform,
        failureCount: scheduler[platform]?.failureCount || 0,
        nextRunAt: new Date().toISOString(),
      });
    }
  }

  await runDuePlatforms().catch((error) => {
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
  schedulerStarted = false;
}
