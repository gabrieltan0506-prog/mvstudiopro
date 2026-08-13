#!/usr/bin/env tsx
/**
 * 视频号本机采集器（第一版）：从已登录的微信视频号窗口截图 OCR，输出真实公开指标。
 * 不读取 Cookie、不调用私有接口、不点赞/关注/评论；搜索与翻页自动化单独启用。
 */
import { createHash, randomInt } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  cleanWeixinChannelsCommentTexts,
  containsWeixinChannelsAdvertisement,
  makeWeixinChannelsObservationId,
  qualifyWeixinChannelsObservationLocally,
  weixinChannelsCaptureBudgetMs,
  WEIXIN_CHANNELS_COMMENT_THRESHOLD,
  type WeixinChannelsCommentSample,
} from "../shared/weixinChannelsRules";

const execFileAsync = promisify(execFile);

export const WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS = 10 * 60_000;
export const WEIXIN_CHANNELS_RECOMMENDATION_TARGET = 5;
export const WEIXIN_CHANNELS_UNQUALIFIED_DWELL_MS = 2_000;
export const WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
export const WEIXIN_CHANNELS_PRECISION_SAMPLE_SIZE = 10;
export const WEIXIN_CHANNELS_MIN_QUALIFIED_RATE = 0.4;

export function shouldSwitchRecommendationToSearch(params: {
  startedAt: number;
  now: number;
  qualifiedCount: number;
  scannedCount?: number;
}) {
  const lowPrecisionSample = (params.scannedCount || 0) >= WEIXIN_CHANNELS_PRECISION_SAMPLE_SIZE
    && params.qualifiedCount / (params.scannedCount || 1) < WEIXIN_CHANNELS_MIN_QUALIFIED_RATE;
  const timedOutWithoutEnoughHits = params.now - params.startedAt >= WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS
    && params.qualifiedCount < WEIXIN_CHANNELS_RECOMMENDATION_TARGET;
  return lowPrecisionSample || timedOutWithoutEnoughHits;
}

export function shouldRotateSearchQuery(params: { scannedCount: number; qualifiedCount: number }) {
  return params.scannedCount >= WEIXIN_CHANNELS_PRECISION_SAMPLE_SIZE
    && params.qualifiedCount / params.scannedCount < WEIXIN_CHANNELS_MIN_QUALIFIED_RATE;
}

type OcrLine = { text: string; confidence: number; x: number; y: number; width: number; height: number };
type OcrResult = { width: number; height: number; lines: OcrLine[] };

export function parseVisibleVideoClockSeconds(text: string) {
  const values = Array.from(String(text || "").matchAll(/(?:^|\D)(\d{1,2}):([0-5]\d)(?=\D|$)/g))
    .map((match) => Number(match[1]) * 60 + Number(match[2]))
    .filter((value) => value > 0);
  return values.length ? Math.max(...values) : undefined;
}

export function deriveVideoDurationSeconds(samples: Array<{ progress: number; text: string }>) {
  const estimates = samples
    .map((sample) => {
      const current = parseVisibleVideoClockSeconds(sample.text);
      return current && sample.progress > 0 ? current / sample.progress : undefined;
    })
    .filter((value): value is number => Number.isFinite(value) && value! > 0)
    .sort((left, right) => left - right);
  if (!estimates.length) return undefined;
  return Math.round(estimates[Math.floor(estimates.length / 2)]!);
}

export function captureBudgetMsForVideo(videoDurationSec: number) {
  return weixinChannelsCaptureBudgetMs(videoDurationSec);
}

function remainingBudgetMs(deadlineAt?: number) {
  return deadlineAt === undefined ? Number.POSITIVE_INFINITY : Math.max(0, deadlineAt - Date.now());
}

async function waitWithinCaptureBudget(deadlineAt: number | undefined, preferredMinMs: number, preferredMaxMs: number) {
  const remaining = remainingBudgetMs(deadlineAt);
  if (remaining <= 100) throw new Error("weixin_channels_capture_time_budget_exhausted");
  const ceiling = Math.max(50, Math.min(preferredMaxMs, remaining - 100));
  const floor = Math.min(preferredMinMs, ceiling);
  const delayMs = ceiling <= floor ? ceiling : randomInt(Math.ceil(floor), Math.floor(ceiling) + 1);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return delayMs;
}

/** 给视频、封面和互动数字留出真实加载时间；每次 2–3 秒，严格串行。 */
export async function waitForVisibleVideoLoad() {
  const delayMs = randomInt(2_000, 3_001);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return delayMs;
}

export function findSearchInputPoint(lines: OcrLine[]): { x: number; y: number } | null {
  const candidates = lines.filter((line) =>
    line.confidence >= 0.35
      && /(搜一搜|搜索|搜尋|输入网址|輸入網址)/i.test(line.text)
      && line.y >= 0.72,
  );
  const hit = candidates.sort((left, right) => right.width - left.width)[0];
  if (!hit) return null;
  return { x: hit.x + Math.min(hit.width / 2, 0.08), y: 1 - (hit.y + hit.height / 2) };
}

export function ocrFingerprint(ocr: OcrResult) {
  return createHash("sha256").update(
    ocr.lines.filter((line) => line.confidence >= 0.35).map((line) => line.text.trim()).join("|"),
  ).digest("hex");
}

function clickPoint(line: OcrLine) {
  return { x: line.x + line.width / 2, y: 1 - (line.y + line.height / 2) };
}

export function findCommentsOpenPoint(lines: OcrLine[]) {
  const label = lines
    .filter((line) => line.confidence >= 0.35 && /^(评论|評論)$/.test(line.text.trim()))
    .sort((left, right) => left.y - right.y)[0];
  if (label) return clickPoint(label);
  const bottomNumbers = lines
    .filter((line) => line.confidence >= 0.35 && line.y < 0.25 && line.x > 0.45 && parseVisibleMetric(line.text) !== undefined)
    .sort((left, right) => left.x - right.x);
  return bottomNumbers.length >= 4 ? clickPoint(bottomNumbers[bottomNumbers.length - 1]!) : null;
}

/** 先由 OCR 找到评论标题所在行，再取同一行最右侧关闭区；不使用固定屏幕坐标。 */
export function findCommentsClosePoint(lines: OcrLine[]) {
  const title = lines
    .filter((line) => line.confidence >= 0.25 && /^(评论|評論)(\s*\d+)?$/.test(line.text.trim()))
    .sort((left, right) => right.y - left.y)[0];
  if (!title) return null;
  const sameRow = lines.filter((line) => Math.abs((line.y + line.height / 2) - (title.y + title.height / 2)) <= Math.max(title.height, 0.04));
  const closeGlyph = sameRow
    .filter((line) => /^(×|x|X|✕|关闭|關閉)$/.test(line.text.trim()) && line.x > title.x)
    .sort((left, right) => right.x - left.x)[0];
  if (closeGlyph) return clickPoint(closeGlyph);
  return null;
}

async function findCommentsClosePointFromScreenshot(screenshot: string, lines: OcrLine[]) {
  const ocrPoint = findCommentsClosePoint(lines);
  if (ocrPoint) return ocrPoint;
  const title = lines
    .filter((line) => line.confidence >= 0.25 && /^(评论|評論)(\s*\d+)?$/.test(line.text.trim()))
    .sort((left, right) => right.y - left.y)[0];
  if (!title) return null;
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const centerY = Math.round((1 - (title.y + title.height / 2)) * info.height);
  const minX = Math.round(Math.max(0.72, title.x + title.width + 0.2) * info.width);
  const minY = Math.max(0, centerY - Math.round(info.height * 0.035));
  const maxY = Math.min(info.height - 1, centerY + Math.round(info.height * 0.035));
  const bright = (x: number, y: number) => {
    if (x < 0 || x >= info.width || y < 0 || y >= info.height) return false;
    const offset = (y * info.width + x) * info.channels;
    return data[offset]! > 165 && data[offset + 1]! > 165 && data[offset + 2]! > 165;
  };
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x < info.width - 8; x += 2) {
      let score = 0;
      const radius = Math.max(8, Math.round(info.width * 0.014));
      for (let d = -radius; d <= radius; d += 2) {
        if (bright(x + d, y + d) || bright(x + d, y + d + 1)) score += 1;
        if (bright(x + d, y - d) || bright(x + d, y - d - 1)) score += 1;
      }
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (!best || best.score < 12) return null;
  return { x: best.x / info.width, y: best.y / info.height };
}

export function hasFourVisibleMetrics(lines: OcrLine[]) {
  const metrics = extractWeixinChannelsMetrics(lines);
  return [metrics.likes, metrics.shares, metrics.favorites, metrics.comments].every((value) => value !== undefined);
}

export function extractCommentSamples(lines: OcrLine[]): WeixinChannelsCommentSample[] {
  const visible = lines.filter((line) => line.confidence >= 0.45).sort((a, b) => b.y - a.y || a.x - b.x);
  const samples: WeixinChannelsCommentSample[] = [];
  const seen = new Set<string>();
  const cleaned = visible.map((line) => cleanWeixinChannelsCommentTexts([line.text])[0]).filter(Boolean) as string[];
  const repeated = new Map<string, number>();
  for (const text of cleaned) repeated.set(text, (repeated.get(text) || 0) + 1);
  for (const line of visible) {
    const text = cleanWeixinChannelsCommentTexts([line.text])[0];
    if (!text || text.length < 4 || /^\d+(\.\d+)?[万萬wW]?$/.test(text) || seen.has(text)) continue;
    if (/^(赞和收藏|讚和收藏|推薦|推荐|已读|已讀|换电话|換電話|换微信|換微信|发简历|發簡歷|不感兴趣|不感興趣|拒绝|拒絕|同意)$/.test(text)) continue;
    if (/^\d{1,2}:\d{2}$|^\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?$/.test(text)) continue;
    if (/^都在搜[:：]|^\d+条回复$|^[凸♡赞]\s*\d+$|作者赞过|发表评论[:：]?$|^置顶(?:\s*作者赞过)?$/.test(text)) continue;
    if (/作者.*(?:\d+月\d+日|(?:分钟|小时|天|月|年)前)$/.test(text)) continue;
    if (/(北京|上海|天津|重庆|河北|河南|云南|辽宁|黑龙江|湖南|安徽|山东|新疆|江苏|浙江|江西|湖北|广西|甘肃|山西|内蒙古|陕西|吉林|福建|贵州|广东|青海|西藏|四川|宁夏|海南|台湾|香港|澳门)\s*(?:\d+月\d+日|\d*(?:分钟|小时|天|月|年)前)$/.test(text)) continue;
    seen.add(text);
    const signals: WeixinChannelsCommentSample["signals"] = [];
    if ((repeated.get(text) || 0) > 1) signals.push("repeated");
    if (/[?？]|怎么|如何|为什么|哪[里個个]|求/.test(text)) signals.push("question");
    if (/但是|不过|反而|不认同|争议|假的|骗人|不同意/.test(text)) signals.push("controversial");
    const nearbyLike = visible
      .filter((candidate) => candidate !== line && Math.abs(candidate.y - line.y) < 0.045 && candidate.x > line.x)
      .map((candidate) => parseVisibleMetric(candidate.text))
      .find((value) => value !== undefined);
    if ((nearbyLike || 0) >= 10) signals.push("high_like");
    samples.push({ text, likeCount: nearbyLike, signals: signals.length ? signals : undefined });
    if (samples.length >= 20) break;
  }
  return samples;
}

async function runSwiftControl(args: string[]) {
  const controlScript = path.join(path.dirname(new URL(import.meta.url).pathname), "macos-weixin-channels-control.swift");
  return execFileAsync("/usr/bin/swift", [controlScript, ...args], { maxBuffer: 10 * 1024 * 1024 });
}

async function readOcr(screenshot: string): Promise<OcrResult> {
  const ocrScript = path.join(path.dirname(new URL(import.meta.url).pathname), "macos-weixin-channels-ocr.swift");
  const { stdout } = await execFileAsync("/usr/bin/swift", [ocrScript, screenshot], { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout) as OcrResult;
}

async function captureWindow(output: string) {
  const { stdout } = await runSwiftControl(["window"]);
  const window = JSON.parse(stdout) as { x: number; y: number; width: number; height: number };
  // 微信独立渲染窗口常拒绝 -l windowId 截图；按动态窗口边界截屏更稳定，仍不写死坐标。
  const region = [window.x, window.y, window.width, window.height].map((value) => Math.round(value)).join(",");
  await execFileAsync("/usr/sbin/screencapture", ["-x", `-R${region}`, output]);
}

export function metricsRemainOnSameVideo(
  base: ReturnType<typeof extractWeixinChannelsMetrics>,
  sample: ReturnType<typeof extractWeixinChannelsMetrics>,
) {
  const keys = ["likes", "shares", "favorites", "comments"] as const;
  const comparable = keys.filter((key) => base[key] !== undefined && sample[key] !== undefined);
  if (comparable.length < 3) return false;
  return comparable.every((key) => Math.abs(sample[key]! - base[key]!) <= Math.max(5, base[key]! * 0.03));
}

export async function detectVisibleProgressTrack(screenshot: string) {
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let best: { start: number; end: number; y: number; length: number } | null = null;
  const minY = Math.round(info.height * 0.78);
  const maxY = Math.round(info.height * 0.85);
  for (let y = minY; y <= maxY; y += 1) {
    let runStart = -1;
    let lastGray = -1;
    for (let x = Math.round(info.width * 0.09); x < Math.round(info.width * 0.86); x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset]!;
      const green = data[offset + 1]!;
      const blue = data[offset + 2]!;
      const gray = Math.max(red, green, blue) - Math.min(red, green, blue) <= 25 && red >= 60 && red <= 240;
      if (gray) {
        if (runStart < 0 || (lastGray >= 0 && x - lastGray > Math.round(info.width * 0.025))) runStart = x;
        lastGray = x;
        const length = lastGray - runStart;
        if (length >= info.width * 0.35 && (!best || length > best.length)) best = { start: runStart, end: lastGray, y, length };
      }
    }
  }
  if (!best) throw new Error("weixin_channels_progress_track_not_found");
  return {
    // 最长连续段通常从当前播放圆点右缘开始，按图像宽度回补圆点及其左侧短轨道。
    startX: Math.max(0.08, best.start / info.width - 0.04),
    endX: best.end / info.width,
    y: best.y / info.height,
  };
}

async function sampleVideoContentAtProgress(
  screenshot: string,
  baseMetrics: ReturnType<typeof extractWeixinChannelsMetrics>,
  captureStartedAt: number,
) {
  const ocrTexts: string[] = [];
  const clockSamples: Array<{ progress: number; text: string }> = [];
  let videoDurationSec: number | undefined;
  let deadlineAt: number | undefined;
  // 点击视频使控制条出现；真实探针确认进度条横跨窗口宽度约 12.5%–91%、纵向约 82.3%。
  await runSwiftControl(["click-relative", "0.50", "0.50"]);
  await runSwiftControl(["move-relative", "0.50", "0.82"]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await captureWindow(screenshot);
  const track = await detectVisibleProgressTrack(screenshot);
  const startX = track.startX;
  let previousX = startX;
  await runSwiftControl(["click-relative", startX.toFixed(4), track.y.toFixed(4)]);
  for (const progress of WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS) {
    const targetX = startX + (track.endX - startX) * progress;
    await runSwiftControl(["move-relative", "0.50", track.y.toFixed(4)]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await runSwiftControl(["drag-relative", previousX.toFixed(4), track.y.toFixed(4), targetX.toFixed(4), track.y.toFixed(4)]);
    await waitWithinCaptureBudget(deadlineAt, 250, 700);
    await captureWindow(screenshot);
    const ocr = await readOcr(screenshot);
    const sampledMetrics = extractWeixinChannelsMetrics(ocr.lines);
    if (!metricsRemainOnSameVideo(baseMetrics, sampledMetrics)) {
      throw new Error("weixin_channels_video_changed_during_progress_sampling");
    }
    const text = ocr.lines.filter((line) => line.confidence >= 0.45).map((line) => line.text.trim()).filter(Boolean).join(" | ");
    ocrTexts.push(text);
    clockSamples.push({ progress, text });
    videoDurationSec = deriveVideoDurationSeconds(clockSamples);
    if (videoDurationSec) deadlineAt = captureStartedAt + captureBudgetMsForVideo(videoDurationSec);
    previousX = targetX;
  }
  if (!videoDurationSec || !deadlineAt) throw new Error("weixin_channels_video_duration_not_detected");
  return { ocrTexts, videoDurationSec, deadlineAt };
}

async function collectVisibleComments(screenshot: string, baseOcr: OcrResult, deadlineAt: number) {
  const openPoint = findCommentsOpenPoint(baseOcr.lines);
  if (!openPoint) throw new Error("weixin_channels_comments_entry_not_found");
  await runSwiftControl(["click-relative", openPoint.x.toFixed(5), openPoint.y.toFixed(5)]);
  await waitWithinCaptureBudget(deadlineAt, 150, 500);
  await captureWindow(screenshot);
  let panel = await readOcr(screenshot);
  if (!await findCommentsClosePointFromScreenshot(screenshot, panel.lines)) throw new Error("weixin_channels_comments_open_not_confirmed");
  const collected: OcrLine[] = [];
  const pageLimit = remainingBudgetMs(deadlineAt) >= 3_000 ? 2 : 1;
  for (let page = 0; page < pageLimit; page += 1) {
    if (page > 0) {
      await captureWindow(screenshot);
      panel = await readOcr(screenshot);
    }
    collected.push(...panel.lines);
    if (page === 0) {
      await runSwiftControl(["scroll-relative", "0.75", "0.68", "-6"]);
      await waitWithinCaptureBudget(deadlineAt, 150, 500);
    }
  }
  await captureWindow(screenshot);
  panel = await readOcr(screenshot);
  const closePoint = await findCommentsClosePointFromScreenshot(screenshot, panel.lines);
  if (!closePoint) throw new Error("weixin_channels_comments_close_not_found");
  await runSwiftControl(["click-relative", closePoint.x.toFixed(5), closePoint.y.toFixed(5)]);
  await waitWithinCaptureBudget(deadlineAt, 100, 350);
  await captureWindow(screenshot);
  const closed = await readOcr(screenshot);
  if (!hasFourVisibleMetrics(closed.lines)) throw new Error("weixin_channels_comments_close_not_confirmed");
  if (Date.now() > deadlineAt) throw new Error("weixin_channels_capture_time_budget_exceeded");
  return { samples: extractCommentSamples(collected), closedOcr: closed };
}

async function ensureInteractionMetricsVisible(screenshot: string, ocr: OcrResult) {
  if (hasFourVisibleMetrics(ocr.lines)) return ocr;
  const closePoint = await findCommentsClosePointFromScreenshot(screenshot, ocr.lines);
  if (!closePoint) return ocr;
  await runSwiftControl(["click-relative", closePoint.x.toFixed(5), closePoint.y.toFixed(5)]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await captureWindow(screenshot);
  const closed = await readOcr(screenshot);
  if (!hasFourVisibleMetrics(closed.lines)) throw new Error("weixin_channels_previous_comments_close_not_confirmed");
  return closed;
}

async function persistPendingFile(output: string, observation: unknown) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(observation, null, 2), "utf8");
  await fs.rename(temp, output);
}

async function buildCoverBase64(screenshot: string) {
  const metadata = await sharp(screenshot).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width < 100 || height < 100) throw new Error("weixin_channels_cover_screenshot_invalid");
  const top = Math.round(height * 0.07);
  const cropHeight = Math.max(80, Math.round(height * 0.76));
  return sharp(screenshot)
    .extract({ left: 0, top, width, height: Math.min(cropHeight, height - top) })
    .resize({ width: 720, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
    .then((buffer) => buffer.toString("base64"));
}

export async function uploadPendingObservation(params: {
  server: string;
  token: string;
  taskId: string;
  pendingFile: string;
  deadlineAt?: number;
  fetchImpl?: typeof fetch;
}) {
  const raw = await fs.readFile(params.pendingFile, "utf8");
  const observation = JSON.parse(raw) as unknown;
  const controller = new AbortController();
  const remaining = params.deadlineAt === undefined ? undefined : remainingBudgetMs(params.deadlineAt);
  if (remaining !== undefined && remaining <= 0) throw new Error("upload_capture_time_budget_exhausted");
  const timeout = remaining === undefined ? undefined : setTimeout(() => controller.abort(), remaining);
  let response: Response;
  try {
    response = await (params.fetchImpl || fetch)(`${params.server.replace(/\/$/, "")}/api/internal/weixin-channels/observations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-weixin-channels-collector-token": params.token },
      body: JSON.stringify({ taskId: params.taskId, observations: [observation] }),
      signal: controller.signal,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`upload_failed:${response.status}:${text.slice(0, 500)}`);
  const payload = JSON.parse(text) as { persisted?: boolean };
  if (payload.persisted !== true) throw new Error("upload_not_persisted");
  await fs.unlink(params.pendingFile);
  return payload;
}

type PendingObservationEnvelope = {
  taskId?: string;
  videoDurationSec?: number;
  captureElapsedMs?: number;
  captureBudgetMs?: number;
};

function exceedsAuthoritativeCaptureBudget(observation: PendingObservationEnvelope) {
  if (observation.captureElapsedMs === undefined) return false;
  const budget = observation.videoDurationSec !== undefined
    ? captureBudgetMsForVideo(observation.videoDurationSec)
    : observation.captureBudgetMs;
  return budget !== undefined && observation.captureElapsedMs > budget;
}

/** 容差口径放宽后，把符合新服务端门禁的旧隔离记录送回待传队列。 */
export async function restoreEligibleQuarantinedObservations(tempDir = os.tmpdir()) {
  const quarantineDir = path.join(tempDir, "weixin-channels-quarantine");
  let names: string[];
  try {
    names = (await fs.readdir(quarantineDir))
      .filter((name) => name.startsWith("weixin-channels-pending-") && name.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { found: 0, restored: 0 };
    throw error;
  }
  let restored = 0;
  for (const name of names) {
    const quarantinedFile = path.join(quarantineDir, name);
    const pendingFile = path.join(tempDir, name);
    const observation = JSON.parse(await fs.readFile(quarantinedFile, "utf8")) as PendingObservationEnvelope;
    if (exceedsAuthoritativeCaptureBudget(observation)) continue;
    try {
      await fs.stat(pendingFile);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.rename(quarantinedFile, pendingFile);
    restored += 1;
    process.stderr.write(`pending_restored:${name}\n`);
  }
  return { found: names.length, restored };
}

export async function retryPendingObservations(params: {
  server: string;
  token: string;
  tempDir?: string;
  fetchImpl?: typeof fetch;
}) {
  const tempDir = params.tempDir || os.tmpdir();
  const names = (await fs.readdir(tempDir))
    .filter((name) => name.startsWith("weixin-channels-pending-") && name.endsWith(".json"))
    .sort();
  let persisted = 0;
  let failed = 0;
  // Fly 单机双核：每个心跳只恢复一个，避免封面上传与正常 ingest 叠加冲垮实例。
  for (const name of names.slice(0, 1)) {
    const pendingFile = path.join(tempDir, name);
    try {
      const observation = JSON.parse(await fs.readFile(pendingFile, "utf8")) as PendingObservationEnvelope;
      if (!observation.taskId) throw new Error("pending_observation_task_id_missing");
      if (exceedsAuthoritativeCaptureBudget(observation)) {
        const quarantineDir = path.join(tempDir, "weixin-channels-quarantine");
        await fs.mkdir(quarantineDir, { recursive: true });
        await fs.rename(pendingFile, path.join(quarantineDir, name));
        process.stderr.write(`pending_quarantined:${name}:capture_sla_exceeded\n`);
        continue;
      }
      await uploadPendingObservation({
        server: params.server,
        token: params.token,
        taskId: observation.taskId,
        pendingFile,
        deadlineAt: Date.now() + 60_000,
        fetchImpl: params.fetchImpl,
      });
      persisted += 1;
      process.stderr.write(`pending_recovered:${name}\n`);
    } catch (error) {
      failed += 1;
      process.stderr.write(`pending_retry_failed:${name}:${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return { found: names.length, persisted, failed };
}

async function waitForChangedFrame(previous: string, screenshot: string, timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await captureWindow(screenshot);
    const next = await readOcr(screenshot);
    if (ocrFingerprint(next) !== previous) return next;
  }
  throw new Error("weixin_channels_frame_did_not_change");
}

async function advanceToNextVideo(previous: string, screenshot: string, deadlineAt?: number) {
  await runSwiftControl(["key", "down"]);
  const timeoutMs = deadlineAt === undefined
    ? WEIXIN_CHANNELS_UNQUALIFIED_DWELL_MS
    : Math.max(50, deadlineAt - Date.now());
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await captureWindow(screenshot);
    const next = await readOcr(screenshot);
    if (ocrFingerprint(next) !== previous) return next;
  }
  throw new Error("weixin_channels_next_video_not_visible_within_2s");
}

async function searchKeyword(keyword: string, screenshot: string) {
  await captureWindow(screenshot);
  let ocr = await readOcr(screenshot);
  let point = findSearchInputPoint(ocr.lines);
  if (!point) {
    // 视频号内容页的放大镜位于右上区域；点击后必须 OCR 复核输入框出现。
    await runSwiftControl(["click-relative", "0.94", "0.09"]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await captureWindow(screenshot);
    ocr = await readOcr(screenshot);
    point = findSearchInputPoint(ocr.lines);
  }
  if (!point) throw new Error("weixin_channels_search_input_not_found");
  await runSwiftControl(["click-relative", point.x.toFixed(5), point.y.toFixed(5)]);
  await runSwiftControl(["key", "selectAll"]);
  await runSwiftControl(["key", "delete"]);
  await runSwiftControl(["type", keyword]);
  const before = ocrFingerprint(ocr);
  await runSwiftControl(["key", "return"]);
  await waitForVisibleVideoLoad();
  return waitForChangedFrame(before, screenshot);
}

export function parseVisibleMetric(text: string): number | undefined {
  const normalized = String(text || "").replace(/[,，\s]/g, "").replace(/[＋+]/g, "");
  const match = normalized.match(/(\d+(?:\.\d+)?)(万|萬|w|W)?/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * (match[2] ? 10_000 : 1));
}

function parseStandaloneMetric(text: string): number | undefined {
  const normalized = String(text || "").replace(/[,，\s＋+]/g, "");
  if (!/^\d+(?:\.\d+)?(?:万|萬|w|W)?$/.test(normalized)) return undefined;
  return parseVisibleMetric(normalized);
}

export function extractVisibleTitleAndAuthor(lines: OcrLine[]) {
  const visible = lines.filter((line) => line.confidence >= 0.25 && line.text.trim());
  const title = visible
    .filter((line) => line.y >= 0.075 && line.y <= 0.17 && line.x < 0.85 && line.width >= 0.25)
    .filter((line) => !/^(直播|关注|朋友|推荐|视频号)/.test(line.text.trim()))
    .sort((left, right) => right.width - left.width)[0]?.text.trim();
  const author = visible
    .filter((line) => line.y >= 0.045 && line.y <= 0.095 && line.x < 0.48 && line.width >= 0.06 && line.width <= 0.35)
    .filter((line) => !/(朋友关注|已关注|\+关注)/.test(line.text))
    .sort((left, right) => right.y - left.y)[0]?.text.trim();
  return { title, author };
}

export function extractWeixinChannelsMetrics(lines: OcrLine[]) {
  const textLines = lines
    .filter((line) => line.confidence >= 0.35)
    .sort((left, right) => right.y - left.y || left.x - right.x)
    .map((line) => ({ ...line, text: line.text.trim() }))
    .filter((line) => line.text);
  const result: Record<string, number | undefined> = {};
  const labels: Array<[RegExp, string]> = [
    [/^(点赞|讚|赞)$/i, "likes"],
    [/^(转发|轉發|分享)$/i, "shares"],
    [/^(收藏)$/i, "favorites"],
    [/^(评论|評論)$/i, "comments"],
  ];
  for (const line of textLines) {
    for (const [label, key] of labels) {
      if (!label.test(line.text)) continue;
      const nearby = textLines
        .filter((candidate) => candidate !== line && Math.abs(candidate.x - line.x) < 0.12 && Math.abs(candidate.y - line.y) < 0.12)
        .map((candidate) => parseVisibleMetric(candidate.text))
        .find((value) => value !== undefined);
      if (nearby !== undefined) result[key] = nearby;
    }
  }
  // 当前桌面版常只显示四个横排数字而无文字标签；按从左到右映射点赞/转发/收藏/评论。
  if (Object.values(result).filter((value) => value !== undefined).length < 2) {
    const bottomNumbers = textLines
      .filter((line) => line.y < 0.13 && line.x > 0.45)
      .map((line) => ({ x: line.x, y: line.y, value: parseStandaloneMetric(line.text) }))
      .filter((entry): entry is { x: number; y: number; value: number } => entry.value !== undefined)
      .sort((left, right) => left.x - right.x);
    if (bottomNumbers.length >= 4) {
      [result.likes, result.shares, result.favorites, result.comments] = bottomNumbers.slice(-4).map((entry) => entry.value);
    }
  }
  return {
    likes: result.likes,
    shares: result.shares,
    favorites: result.favorites,
    comments: result.comments,
    rawText: textLines.map((line) => line.text),
  };
}

type HeartbeatTask = {
  taskId: string;
  searchQueries: string[];
};

async function heartbeatCollector(server: string, token: string, clientId: string) {
  const response = await fetch(`${server.replace(/\/$/, "")}/api/internal/weixin-channels/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-weixin-channels-collector-token": token },
    body: JSON.stringify({ clientId }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`heartbeat_failed:${response.status}:${text.slice(0, 500)}`);
  return JSON.parse(text) as { enabled: boolean; nextTask?: HeartbeatTask };
}

type CollectorCandidate = HeartbeatTask & {
  status?: "pending" | "claimed" | "scanned";
  category?: string;
  sourceTitle?: string;
  createdAt?: string;
};

async function refreshCollectorCandidates(server: string, token: string) {
  const response = await fetch(`${server.replace(/\/$/, "")}/api/internal/weixin-channels/candidates`, {
    headers: { "x-weixin-channels-collector-token": token },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`candidate_refresh_failed:${response.status}:${text.slice(0, 500)}`);
  return (JSON.parse(text) as { candidates?: CollectorCandidate[] }).candidates || [];
}

export function selectReusableCollectorCandidate(candidates: CollectorCandidate[]) {
  const usable = candidates.filter((item) => item.taskId && item.searchQueries?.length);
  return usable.sort((left, right) => {
    const score = (item: CollectorCandidate) => {
      const text = `${item.category || ""} ${item.sourceTitle || ""} ${item.searchQueries.join(" ")}`;
      return (/AI|人工智能|漫剧|漫劇/i.test(text) ? 100 : 0)
        + Math.min(item.searchQueries.length, 10)
        + (Date.parse(item.createdAt || "") || 0) / 1e15;
    };
    return score(right) - score(left);
  })[0];
}

async function captureVisibleQualifiedVideo(params: {
  ocr: OcrResult;
  screenshot: string;
  taskId: string;
  query: string;
  probe: boolean;
  server?: string;
  token?: string;
  titleOverride?: string;
  authorOverride?: string;
  outputOverride?: string;
}) {
  const captureStartedAt = Date.now();
  const metrics = extractWeixinChannelsMetrics(params.ocr.lines);
  const identity = extractVisibleTitleAndAuthor(params.ocr.lines);
  const actualMetrics = [metrics.likes, metrics.comments, metrics.shares, metrics.favorites]
    .filter((value) => value !== undefined);
  if (actualMetrics.length < 2) {
    return { qualified: false as const, reason: "ocr_metrics_incomplete", fingerprint: ocrFingerprint(params.ocr) };
  }

  const title = params.titleOverride || identity.title || "当前视频";
  const preliminary = qualifyWeixinChannelsObservationLocally({ ...metrics, query: params.query, title });
  if (!preliminary.qualified) {
    return { qualified: false as const, reason: preliminary.reason, fingerprint: ocrFingerprint(params.ocr) };
  }

  const author = params.authorOverride || identity.author;
  const sampled = await sampleVideoContentAtProgress(params.screenshot, metrics, captureStartedAt);
  const { ocrTexts, videoDurationSec, deadlineAt } = sampled;
  const adDetected = containsWeixinChannelsAdvertisement(ocrTexts);
  const finalQualification = qualifyWeixinChannelsObservationLocally({
    ...metrics,
    query: params.query,
    title,
    ocrTexts,
  });
  let ocr = params.ocr;
  let commentSamples: WeixinChannelsCommentSample[] | undefined;
  if (!adDetected && finalQualification.requiresComments && (metrics.comments || 0) >= WEIXIN_CHANNELS_COMMENT_THRESHOLD) {
    const comments = await collectVisibleComments(params.screenshot, ocr, deadlineAt);
    commentSamples = comments.samples;
    if (!commentSamples.length) throw new Error("weixin_channels_real_comments_not_found");
    ocr = comments.closedOcr;
  }
  const coverImageBase64 = !adDetected && finalQualification.qualified
    ? await buildCoverBase64(params.screenshot)
    : undefined;
  const captureElapsedMs = Date.now() - captureStartedAt;
  const captureBudgetMs = captureBudgetMsForVideo(videoDurationSec);
  if (captureElapsedMs > captureBudgetMs) {
    return {
      qualified: false as const,
      inspectedContent: true as const,
      reason: "weixin_channels_capture_time_budget_exceeded",
      fingerprint: ocrFingerprint(ocr),
    };
  }
  const observation = {
    observationId: makeWeixinChannelsObservationId({ taskId: params.taskId, title, author }),
    taskId: params.taskId,
    query: params.query,
    resultRank: 1,
    title,
    author,
    coverImageBase64,
    observedAt: new Date().toISOString(),
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    favorites: metrics.favorites,
    commentSamples,
    ocrTexts,
    videoDurationSec,
    captureBudgetMs,
    captureElapsedMs,
    evidence: "capture" as const,
    runKind: params.probe ? "probe" as const : "formal" as const,
  };
  const output = params.outputOverride
    || path.join(os.tmpdir(), `weixin-channels-pending-${observation.observationId}.json`);
  await persistPendingFile(output, observation);
  if (params.server) {
    if (!params.token) throw new Error("WEIXIN_CHANNELS_COLLECTOR_TOKEN is required for upload");
    const payload = await uploadPendingObservation({
      server: params.server,
      token: params.token,
      taskId: params.taskId,
      pendingFile: output,
      // 视频内容采样 SLA 与远端持久化确认分离。若沿用采样截止时间，
      // 客户端会在 Fly 仍处理中时 abort，随后重传同一大封面请求造成重叠负载。
      deadlineAt: Date.now() + 60_000,
    });
    // 服务端已确认 persisted=true 后，不能再把该条改判成“未达标/跳过”；
    // 超时属于 SLA 观测，入库事实与本地达标计数必须保持一致。
    if (Date.now() > deadlineAt) {
      process.stderr.write(`capture_sla_exceeded_after_persist:${observation.observationId}\n`);
    }
    process.stderr.write(`uploaded:${JSON.stringify(payload)}\n`);
  }
  process.stdout.write(`${JSON.stringify({
    event: "observation_persisted",
    observationId: observation.observationId,
    runKind: observation.runKind,
    qualified: finalQualification.qualified,
    commentSampleCount: observation.commentSamples?.length || 0,
    captureElapsedMs: observation.captureElapsedMs,
    captureBudgetMs: observation.captureBudgetMs,
  })}\n`);
  return {
    qualified: finalQualification.qualified,
    inspectedContent: true as const,
    reason: finalQualification.reason,
    fingerprint: ocrFingerprint(ocr),
    observation,
  };
}

async function openFirstSearchResult(keyword: string, screenshot: string) {
  const results = await searchKeyword(keyword, screenshot);
  const before = ocrFingerprint(results);
  await runSwiftControl(["click-relative", "0.55", "0.55"]);
  await waitForVisibleVideoLoad();
  await captureWindow(screenshot);
  const opened = await readOcr(screenshot);
  return ocrFingerprint(opened) === before
    ? waitForChangedFrame(before, screenshot)
    : opened;
}

async function runCollectionPool(params: {
  screenshot: string;
  server: string;
  token: string;
  probe: boolean;
  maxScanned?: number;
}) {
  const clientId = `mac-weixin-${os.hostname()}`.slice(0, 120);
  await restoreEligibleQuarantinedObservations();
  const initialRecovery = await retryPendingObservations({ server: params.server, token: params.token });
  let heartbeat = await heartbeatCollector(params.server, params.token, clientId);
  if (!heartbeat.enabled) return { stopped: "capture_disabled", scanned: 0, qualified: 0 };
  if (!heartbeat.nextTask) {
    // 任务只能由 Fly 中抖音/B站/小红书最近七天真实数据生成；本机不维护固定热词。
    const candidates = await refreshCollectorCandidates(params.server, params.token);
    heartbeat = await heartbeatCollector(params.server, params.token, clientId);
    if (!heartbeat.nextTask) {
      const reusable = selectReusableCollectorCandidate(candidates);
      if (reusable) {
        heartbeat.nextTask = { taskId: reusable.taskId, searchQueries: reusable.searchQueries };
        process.stderr.write(`candidate_reused:${reusable.taskId}\n`);
      }
    }
  }
  if (!heartbeat.nextTask) return { stopped: "no_candidate_task", scanned: 0, qualified: 0 };

  let task = heartbeat.nextTask;
  let mode: "recommendation" | "search" = "recommendation";
  let recommendationStartedAt = Date.now();
  let recommendationQualified = 0;
  let totalScanned = 0;
  let totalQualified = 0;
  let totalRecovered = initialRecovery.persisted;
  let searchQueryIndex = 0;
  let scansOnCurrentQuery = 0;
  let qualifiedOnCurrentQuery = 0;
  let lastHeartbeatAt = Date.now();
  await captureWindow(params.screenshot);
  let ocr = await readOcr(params.screenshot);

  while (totalScanned < (params.maxScanned ?? Number.POSITIVE_INFINITY)) {
    if (Date.now() - lastHeartbeatAt >= 30_000) {
      heartbeat = await heartbeatCollector(params.server, params.token, clientId);
      const recovery = await retryPendingObservations({ server: params.server, token: params.token });
      totalRecovered += recovery.persisted;
      lastHeartbeatAt = Date.now();
      if (!heartbeat.enabled) return { stopped: "capture_disabled", scanned: totalScanned, qualified: totalQualified };
      if (heartbeat.nextTask) task = heartbeat.nextTask;
    }

    if (mode === "recommendation" && shouldSwitchRecommendationToSearch({
      startedAt: recommendationStartedAt,
      now: Date.now(),
      qualifiedCount: recommendationQualified,
      scannedCount: totalScanned,
    })) {
      mode = "search";
      searchQueryIndex = 0;
      scansOnCurrentQuery = 0;
      qualifiedOnCurrentQuery = 0;
      const query = task.searchQueries[searchQueryIndex];
      if (!query) throw new Error("weixin_channels_search_queries_empty");
      ocr = await openFirstSearchResult(query, params.screenshot);
    }

    // 每条先关闭上一条可能残留的评论面板，并以四项互动指标重新出现作为断言。
    // 单条界面异常只跳过当前视频，不能退出整条采集池。
    try {
      ocr = await ensureInteractionMetricsVisible(params.screenshot, ocr);
    } catch (error) {
      totalScanned += 1;
      process.stderr.write(`scan_skipped:${error instanceof Error ? error.message : String(error)}\n`);
      process.stderr.write(`collector_progress:${JSON.stringify({ scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode })}\n`);
      ocr = await advanceToNextVideo(ocrFingerprint(ocr), params.screenshot);
      continue;
    }
    const itemStartedAt = Date.now();
    const query = mode === "recommendation"
      ? "推荐页"
      : task.searchQueries[searchQueryIndex] || task.searchQueries[0] || "网络热点";
    let result: Awaited<ReturnType<typeof captureVisibleQualifiedVideo>>;
    try {
      result = await captureVisibleQualifiedVideo({
        ocr,
        screenshot: params.screenshot,
        taskId: task.taskId,
        query,
        probe: params.probe,
        server: params.server,
        token: params.token,
      });
    } catch (error) {
      // 单条视频超时、评论区识别失败或上传失败不能杀死整晚采集；
      // 待传文件仍由 captureVisibleQualifiedVideo 保留，随后继续下一条。
      totalScanned += 1;
      process.stderr.write(`scan_skipped:${error instanceof Error ? error.message : String(error)}\n`);
      process.stderr.write(`collector_progress:${JSON.stringify({ scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode })}\n`);
      ocr = await advanceToNextVideo(ocrFingerprint(ocr), params.screenshot);
      continue;
    }
    totalScanned += 1;
    if (result.qualified) {
      totalQualified += 1;
      if (mode === "recommendation") recommendationQualified += 1;
      else qualifiedOnCurrentQuery += 1;
    }
    process.stderr.write(`collector_progress:${JSON.stringify({ scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode })}\n`);

    if (!result.qualified && !("inspectedContent" in result)) {
      const deadlineAt = itemStartedAt + WEIXIN_CHANNELS_UNQUALIFIED_DWELL_MS;
      ocr = await advanceToNextVideo(result.fingerprint, params.screenshot, deadlineAt);
    } else {
      ocr = await advanceToNextVideo(result.fingerprint, params.screenshot);
    }

    if (mode === "recommendation" && Date.now() - recommendationStartedAt >= WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS) {
      if (recommendationQualified >= WEIXIN_CHANNELS_RECOMMENDATION_TARGET) {
        recommendationStartedAt = Date.now();
        recommendationQualified = 0;
      }
    } else if (mode === "search") {
      scansOnCurrentQuery += 1;
      if (scansOnCurrentQuery >= WEIXIN_CHANNELS_PRECISION_SAMPLE_SIZE) {
        const rotate = shouldRotateSearchQuery({
          scannedCount: scansOnCurrentQuery,
          qualifiedCount: qualifiedOnCurrentQuery,
        }) && task.searchQueries.length > 1;
        if (rotate) searchQueryIndex = (searchQueryIndex + 1) % task.searchQueries.length;
        scansOnCurrentQuery = 0;
        qualifiedOnCurrentQuery = 0;
        if (rotate) {
          process.stderr.write(`search_query_rotated:${task.searchQueries[searchQueryIndex]}:qualified_rate_below_40_percent\n`);
          ocr = await openFirstSearchResult(task.searchQueries[searchQueryIndex]!, params.screenshot);
        }
      }
    }
  }
  return { stopped: "max_scanned_reached", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
}

async function main() {
  const args = process.argv.slice(2);
  const automate = args.includes("--automate");
  const interact = args.includes("--interact");
  const pool = args.includes("--pool");
  const probe = args.includes("--probe");
  const direction = args.includes("--previous") ? "up" : "down";
  const screenshotArg = args.find((item) => item.startsWith("--screenshot="));
  const taskArg = args.find((item) => item.startsWith("--task-id="));
  const queryArg = args.find((item) => item.startsWith("--query="));
  const titleArg = args.find((item) => item.startsWith("--title="));
  const authorArg = args.find((item) => item.startsWith("--author="));
  const serverArg = args.find((item) => item.startsWith("--server="));
  const maxScannedArg = args.find((item) => item.startsWith("--max-scanned="));
  const screenshot = screenshotArg?.slice("--screenshot=".length)
    || path.join(os.tmpdir(), `weixin-channels-window-${process.pid}.png`);
  if (pool) {
    if (!serverArg) throw new Error("--pool requires --server=https://...");
    const token = String(process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN || "").trim();
    if (!token) throw new Error("WEIXIN_CHANNELS_COLLECTOR_TOKEN is required for pool mode");
    const result = await runCollectionPool({
      screenshot,
      server: serverArg.slice("--server=".length).replace(/\/$/, ""),
      token,
      probe,
      maxScanned: maxScannedArg ? Number(maxScannedArg.slice("--max-scanned=".length)) : undefined,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (!taskArg || !queryArg || (!titleArg && !automate && !interact)) {
    throw new Error("usage: pnpm tsx scripts/weixin-channels-capture.mts [--automate|--interact|--pool] [--probe] [--screenshot=/path/window.png] [--server=https://...] [--max-scanned=N] --task-id=... --query=... [--title=...] [--author=...]");
  }
  const query = queryArg.slice("--query=".length);
  let ocr: OcrResult;
  if (automate) {
    ocr = await searchKeyword(query, screenshot);
    const before = ocrFingerprint(ocr);
    await runSwiftControl(["click-relative", "0.55", "0.55"]);
    await waitForVisibleVideoLoad();
    await runSwiftControl(["key", direction]);
    await waitForVisibleVideoLoad();
    ocr = await waitForChangedFrame(before, screenshot);
  } else if (interact) {
    await captureWindow(screenshot);
    ocr = await readOcr(screenshot);
  } else {
    ocr = await readOcr(screenshot);
  }
  const taskId = taskArg.slice("--task-id=".length);
  if (!automate && !interact) throw new Error("weixin_channels_timed_capture_requires_live_interaction");
  const outputArg = args.find((item) => item.startsWith("--output="));
  const token = String(process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN || "").trim();
  const result = await captureVisibleQualifiedVideo({
    ocr,
    screenshot,
    taskId,
    query,
    probe,
    server: serverArg?.slice("--server=".length).replace(/\/$/, ""),
    token,
    titleOverride: titleArg?.slice("--title=".length),
    authorOverride: authorArg?.slice("--author=".length),
    outputOverride: outputArg?.slice("--output=".length),
  });
  if (!result.qualified) process.stdout.write(`${JSON.stringify({ scanned: true, qualified: false, modelCalls: 0, reason: result.reason }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
