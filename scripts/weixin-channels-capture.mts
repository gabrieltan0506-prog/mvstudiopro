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
  deriveWeixinChannelsSearchQueries,
  makeWeixinChannelsObservationId,
  normalizeWeixinChannelsSearchQuery,
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
export const WEIXIN_CHANNELS_SEEN_TTL_MS = 7 * 24 * 60 * 60_000;
export const WEIXIN_CHANNELS_HOUR_MS = 60 * 60_000;
export const WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS = [
  { elapsedMs: 15 * 60_000, minimumPersisted: 12 },
  { elapsedMs: 30 * 60_000, minimumPersisted: 25 },
] as const;
/** 2026-08-14 在动态 483×769 / 966×1538 窗口均实测命中顶栏放大镜。 */
export const WEIXIN_CHANNELS_SEARCH_BUTTON_POINT = { x: 0.785, y: 0.026 } as const;
export const WEIXIN_CHANNELS_SEARCH_INPUT_POINT = { x: 0.58, y: 0.026 } as const;

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

export function collectorWatchdogDecision(elapsedMs: number, persistedUnique: number) {
  if (elapsedMs >= WEIXIN_CHANNELS_HOUR_MS) return persistedUnique < 50 ? "remediate" as const : "rollover" as const;
  if (elapsedMs >= WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[1].elapsedMs
    && persistedUnique < WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[1].minimumPersisted) return "checkpoint_30" as const;
  if (elapsedMs >= WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[0].elapsedMs
    && persistedUnique < WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[0].minimumPersisted) return "checkpoint_15" as const;
  return "continue" as const;
}

export function nextCollectorSearchQueryIndex(currentIndex: number, queryCount: number) {
  return queryCount > 1 ? (currentIndex + 1) % queryCount : currentIndex;
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

export function parseVisibleVideoTotalDurationSeconds(text: string) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const slash = normalized.match(/\d{1,2}:[0-5]\d\s*[\/／]\s*(\d{1,2}:[0-5]\d)/);
  if (slash?.[1]) return parseVisibleVideoClockSeconds(slash[1]);
  const labelled = normalized.match(/(?:总时长|總時長|时长|時長)\s*[:：]?\s*(\d{1,2}:[0-5]\d)/i);
  return labelled?.[1] ? parseVisibleVideoClockSeconds(labelled[1]) : undefined;
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

export function findExactSearchSuggestionPoint(lines: OcrLine[], keyword: string): { x: number; y: number } | null {
  const normalize = (value: string) => value
    .trim()
    .replace(/^[•·]\s*/, "")
    .replace(/^(找|搜|q)\s*/i, "")
    .replace(/^Al(?=[\u4e00-\u9fff])/i, "AI")
    .replace(/[\s，,。.!！?？:：'“”\"·]/g, "")
    .toLowerCase();
  const target = normalize(keyword);
  const hit = lines
    .filter((line) => line.confidence >= 0.25 && line.y >= 0.72 && line.y < 0.95)
    .filter((line) => normalize(line.text) === target)
    .sort((left, right) => right.y - left.y)[0];
  return hit ? clickPoint(hit) : null;
}

export function hasTypedSearchKeyword(lines: OcrLine[], keyword: string) {
  const normalize = (value: string) => value
    .trim()
    .replace(/^[•·]\s*/, "")
    .replace(/^(找|搜|q)\s*/i, "")
    .replace(/^Al(?=[\u4e00-\u9fff])/i, "AI")
    .replace(/[\s，,。.!！?？:：'“”\"·]/g, "")
    .toLowerCase();
  const target = normalize(keyword);
  return lines.some((line) => {
    if (line.confidence < 0.25 || line.y < 0.94) return false;
    const value = normalize(line.text);
    return value === target;
  });
}

/** 搜索结果优先点带时长的自然视频卡，避开右侧“广告”卡和账号卡。 */
export function findFirstSearchVideoPoint(lines: OcrLine[]): { x: number; y: number; videoDurationSec: number } | null {
  const durations = lines
    .filter((line) => line.confidence >= 0.35 && /^\d{1,2}:[0-5]\d$/.test(line.text.trim()))
    .filter((line) => line.x < 0.55 && line.y >= 0.25 && line.y <= 0.75)
    .sort((left, right) => right.y - left.y || left.x - right.x);
  for (const duration of durations) {
    const cardText = lines
      .filter((line) => line.confidence >= 0.25)
      .filter((line) => line.x < 0.52 && line.y >= duration.y - 0.22 && line.y <= duration.y + 0.42)
      .map((line) => line.text.trim())
      .join(" ");
    const isShortDramaContent = /(短剧|短劇|剧场|劇場|免费看|免費看|追剧|追劇|看剧|看劇|原创动画|原創動畫|男频|男頻|女频|女頻|第\s*\d+\s*集|全集|完结|完結|爽文|爽剧|爽劇)/i.test(cardText)
      && !/(教程|教學|工作流|制作|製作|怎么做|怎麼做|如何做|新手|拆解)/i.test(cardText);
    if (isShortDramaContent || /(^|\s)广告($|\s)|(^|\s)廣告($|\s)/.test(cardText)) continue;
    return {
      x: Math.max(0.12, Math.min(0.45, duration.x + 0.18)),
      y: Math.max(0.18, Math.min(0.72, 1 - (duration.y + duration.height / 2) - 0.16)),
      videoDurationSec: parseVisibleVideoClockSeconds(duration.text)!,
    };
  }
  return null;
}

export function ocrFingerprint(ocr: OcrResult) {
  return createHash("sha256").update(
    ocr.lines.filter((line) => line.confidence >= 0.35).map((line) => line.text.trim()).join("|"),
  ).digest("hex");
}

export function visibleVideoIdentityFingerprint(ocr: OcrResult) {
  const metrics = extractWeixinChannelsMetrics(ocr.lines);
  const identity = extractVisibleTitleAndAuthor(ocr.lines);
  const stableMetrics = [
    ["likes", metrics.likes],
    ["shares", metrics.shares],
    ["favorites", metrics.favorites],
    ["comments", metrics.comments],
  ].filter((entry): entry is [string, number] => entry[1] !== undefined);
  if (stableMetrics.length < 2) return undefined;
  return createHash("sha256").update(JSON.stringify({
    metrics: stableMetrics,
    title: identity.title || "",
    author: identity.author || "",
  })).digest("hex");
}

function clickPoint(line: OcrLine) {
  return { x: line.x + line.width / 2, y: 1 - (line.y + line.height / 2) };
}

export function findCommentsOpenPoint(lines: OcrLine[]) {
  const label = lines
    .filter((line) => line.confidence >= 0.35 && /^(评论|評論)$/.test(line.text.trim()))
    .filter((line) => line.x >= 0.82 && line.y < 0.2)
    .sort((left, right) => left.y - right.y)[0];
  if (label) return clickPoint(label);
  const bottomNumbers = lines
    .filter((line) => line.confidence >= 0.35 && line.y < 0.25 && line.x > 0.45 && parseVisibleMetric(line.text) !== undefined)
    .sort((left, right) => left.x - right.x);
  if (bottomNumbers.length < 4) return null;
  const rightmost = bottomNumbers[bottomNumbers.length - 1]!;
  // 缺少评论数字时，最右可见数字可能其实是“收藏”。只有落在评论槽位
  // 的数字才允许点击，禁止误入“赞和收藏”页，更不能靠头像或固定坐标猜。
  return rightmost.x >= 0.84 ? clickPoint(rightmost) : null;
}

export function isWeixinChannelsAuxiliaryPage(lines: OcrLine[]) {
  const text = lines.filter((line) => line.confidence >= 0.25).map((line) => line.text.trim());
  const hasLikesCollectionNavigation = text.some((value) => /^(赞和收藏|讚和收藏)$/.test(value))
    && text.some((value) => /^(浏览记录|瀏覽記錄|我的视频号|我的視頻號|发表视频|發表視頻)$/.test(value));
  const hasSearchNavigation = text.some((value) => /^(全部)$/.test(value))
    && text.some((value) => /^(影片|视频|視頻)$/.test(value))
    && text.some((value) => /^(朋友圈|贴图|貼圖)$/.test(value));
  return hasLikesCollectionNavigation || hasSearchNavigation || isWeixinChannelsMediaViewer(lines);
}

export function isWeixinChannelsMediaViewer(lines: OcrLine[]) {
  return lines.some((line) => line.confidence >= 0.25
    && /^(?:用新(?:窗口|視窗)(?:打开|打開|開啟)|在新(?:窗口|視窗)(?:中)?(?:打开|打開|開啟))$/.test(line.text.replace(/\s+/g, "")));
}

/** 图片/贴图查看器只点击 OCR 证明与“用新视窗开启”同排右侧的 X。 */
export function findMediaViewerClosePoint(lines: OcrLine[]) {
  const marker = lines
    .filter((line) => line.confidence >= 0.25
      && /^(?:用新(?:窗口|視窗)(?:打开|打開|開啟)|在新(?:窗口|視窗)(?:中)?(?:打开|打開|開啟))$/.test(line.text.replace(/\s+/g, "")))
    .sort((left, right) => right.y - left.y)[0];
  if (!marker) return null;
  const close = lines
    .filter((line) => /^(?:×|x|X|✕)$/.test(line.text.trim()) && line.x > marker.x)
    .filter((line) => Math.abs((line.y + line.height / 2) - (marker.y + marker.height / 2)) <= Math.max(marker.height, 0.04))
    .sort((left, right) => right.x - left.x)[0];
  return close ? clickPoint(close) : null;
}

/** 先由 OCR 找到评论标题所在行，再取同一行最右侧关闭区；不使用固定屏幕坐标。 */
export function findCommentsClosePoint(lines: OcrLine[]) {
  const title = lines
    .filter((line) => line.confidence >= 0.25 && /^(评论|評論)(?:\s*\d+(?:\.\d+)?(?:万|萬|w|W)?)?$/.test(line.text.trim()))
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
    .filter((line) => line.confidence >= 0.25 && /^(评论|評論)(?:\s*\d+(?:\.\d+)?(?:万|萬|w|W)?)?$/.test(line.text.trim()))
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

export function interactionMetricsConfirmed(first: OcrResult, second: OcrResult) {
  return hasFourVisibleMetrics(first.lines)
    && hasFourVisibleMetrics(second.lines)
    && metricsRemainOnSameVideo(
      extractWeixinChannelsMetrics(first.lines),
      extractWeixinChannelsMetrics(second.lines),
    );
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
    if (/(?:\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?|\d*(?:分钟|分鐘|小时|小時|天|月|年)前)$/.test(text)) continue;
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
      .map((candidate) => parseStandaloneMetric(candidate.text))
      .find((value) => value !== undefined);
    if ((nearbyLike || 0) >= 10) signals.push("high_like");
    samples.push({ text, likeCount: nearbyLike, signals: signals.length ? signals : undefined });
    if (samples.length >= 20) break;
  }
  return samples;
}

/**
 * 评论抽取只消费右侧评论抽屉内部、标题下方且输入框上方的 OCR。
 * 微信播放器左侧仍会显示视频字幕和缩略图，整帧抽取会把它们误当成真实评论。
 */
export function extractCommentPanelContentLines(lines: OcrLine[]) {
  const title = lines
    .filter((line) => line.confidence >= 0.25 && /^(评论|評論)(?:\s*\d+(?:\.\d+)?(?:万|萬|w|W)?)?$/.test(line.text.trim()))
    .sort((left, right) => right.y - left.y)[0];
  if (!title) return [];
  const panelLeft = Math.max(0.25, title.x - 0.06);
  return lines.filter((line) => (
    line !== title
      && line.x >= panelLeft
      && line.y >= 0.09
      && line.y + line.height <= title.y - 0.015
  ));
}

let controlExecutablePromise: Promise<string> | undefined;
let ocrExecutablePromise: Promise<string> | undefined;
type CollectorSearchTabState = { windowId: number; openedTabs: number; updatedAt: string };
let collectorSearchTabState: CollectorSearchTabState | undefined;

function collectorSearchTabStateFile(tempDir = os.tmpdir()) {
  return path.join(tempDir, "weixin-channels-search-tabs-v1.json");
}

export async function loadCollectorSearchTabState(windowId: number, tempDir = os.tmpdir(), now = Date.now()) {
  try {
    const parsed = JSON.parse(await fs.readFile(collectorSearchTabStateFile(tempDir), "utf8")) as CollectorSearchTabState;
    if (parsed.windowId === windowId && now - Date.parse(parsed.updatedAt) <= WEIXIN_CHANNELS_SEEN_TTL_MS) {
      return { ...parsed, openedTabs: Math.max(0, Math.min(1, Math.floor(parsed.openedTabs || 0))) };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // 当前窗口已经由 ensureVideoPlayerVisible 证明是播放器，基线只占推荐页一个标签。
  return { windowId, openedTabs: 0, updatedAt: new Date(now).toISOString() };
}

async function persistCollectorSearchTabState(state: CollectorSearchTabState, tempDir = os.tmpdir()) {
  state.updatedAt = new Date().toISOString();
  const file = collectorSearchTabStateFile(tempDir);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, file);
}

export type CollectorVideoState = "persisted" | "terminal_unqualified" | "retryable_failed";

export function collectorVideoStateAfterCapture(result: { qualified: boolean; persisted?: boolean }) {
  if (result.qualified && result.persisted !== true) {
    return { state: "retryable_failed" as const, stopWithoutAdvance: true };
  }
  return {
    state: result.persisted === true ? "persisted" as const : "terminal_unqualified" as const,
    stopWithoutAdvance: false,
  };
}

type CollectorSeenEntry = {
  videoIdentity: string;
  observationId?: string;
  seenAt: string;
  state: CollectorVideoState;
  retryAfter?: string;
  failureReason?: string;
};

export type CollectorSeenRegistry = {
  file: string;
  entries: Map<string, CollectorSeenEntry>;
  observationIds: Set<string>;
};

function collectorSeenFile(tempDir = os.tmpdir()) {
  return path.join(tempDir, "weixin-channels-seen-videos-v2.json");
}

export async function loadCollectorSeenRegistry(tempDir = os.tmpdir(), now = Date.now()): Promise<CollectorSeenRegistry> {
  const file = collectorSeenFile(tempDir);
  let rawEntries: Array<Partial<CollectorSeenEntry> & Pick<CollectorSeenEntry, "videoIdentity" | "seenAt">> = [];
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as { entries?: CollectorSeenEntry[] };
    rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // v1 的 seen 只代表“曾开始处理”，不能证明 Fly 已持久化。迁移为可重试失败，
    // 防止旧污染状态继续把达标视频当成重复后直接滑走。
    try {
      const legacy = JSON.parse(await fs.readFile(path.join(tempDir, "weixin-channels-seen-videos-v1.json"), "utf8")) as { entries?: Array<Pick<CollectorSeenEntry, "videoIdentity" | "observationId" | "seenAt">> };
      rawEntries = (legacy.entries || []).map((entry) => ({
        ...entry,
        state: "retryable_failed",
        failureReason: "legacy_unverified_seen",
      }));
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") throw legacyError;
    }
  }
  const entries = new Map<string, CollectorSeenEntry>();
  const observationIds = new Set<string>();
  for (const entry of rawEntries) {
    const seenAt = Date.parse(entry.seenAt);
    if (!entry.videoIdentity || !Number.isFinite(seenAt) || now - seenAt > WEIXIN_CHANNELS_SEEN_TTL_MS) continue;
    const state = entry.state === "persisted" || entry.state === "terminal_unqualified"
      ? entry.state
      : "retryable_failed";
    const normalized: CollectorSeenEntry = { ...entry, state };
    entries.set(entry.videoIdentity, normalized);
    if (entry.observationId && state !== "retryable_failed") observationIds.add(entry.observationId);
  }
  return { file, entries, observationIds };
}

export function collectorSeenContains(registry: CollectorSeenRegistry, videoIdentity: string, observationId?: string) {
  const entry = registry.entries.get(videoIdentity);
  const terminal = entry?.state === "persisted" || entry?.state === "terminal_unqualified";
  return terminal || Boolean(observationId && registry.observationIds.has(observationId));
}

export function automaticRecoveryDelayMs(failureCount: number) {
  return Math.min(5 * 60_000, 5_000 * (2 ** Math.max(0, Math.min(6, failureCount - 1))));
}

export function shouldLaunchdRestartCollector(stopped: string, maxScanned?: number) {
  return maxScanned === undefined && !stopped.startsWith("capture_disabled");
}

async function persistCollectorSeenRegistry(registry: CollectorSeenRegistry, now: number) {
  const fresh = Array.from(registry.entries.values()).filter((item) => now - Date.parse(item.seenAt) <= WEIXIN_CHANNELS_SEEN_TTL_MS);
  await fs.mkdir(path.dirname(registry.file), { recursive: true });
  const temp = `${registry.file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ version: 2, updatedAt: new Date(now).toISOString(), entries: fresh }, null, 2), "utf8");
  await fs.rename(temp, registry.file);
}

export async function rememberCollectorSeen(
  registry: CollectorSeenRegistry,
  entry: CollectorSeenEntry,
  now = Date.now(),
) {
  const normalized = { ...entry, seenAt: new Date(now).toISOString() };
  registry.entries.set(normalized.videoIdentity, normalized);
  if (normalized.observationId && normalized.state !== "retryable_failed") registry.observationIds.add(normalized.observationId);
  await persistCollectorSeenRegistry(registry, now);
}

type CollectorPhase = "metricsOcr" | "duration" | "contentSampling" | "comments" | "cover" | "upload" | "advance";

export type CollectorHourDiagnostics = {
  windowStartedAt: string;
  uniqueVideosSeen: number;
  duplicateVideosSkipped: number;
  metricsIncomplete: number;
  locallyUnqualified: number;
  durationDetectionAttempted: number;
  durationDetectionSucceeded: number;
  durationDetectionFailed: number;
  durationDetectionMs: number;
  advertisementRejected: number;
  commentsBelowThreshold: number;
  commentsOpenFailed: number;
  commentsCloseFailed: number;
  qualifiedBeforePersist: number;
  persistedUnique: number;
  duplicatePersistRejected: number;
  uploadFailed: number;
  searchQueriesUsed: string[];
  searchOutcomes: Record<string, { scanned: number; qualified: number }>;
  phaseSamples: Record<CollectorPhase, number[]>;
};

export function createCollectorHourDiagnostics(now = Date.now()): CollectorHourDiagnostics {
  return {
    windowStartedAt: new Date(now).toISOString(),
    uniqueVideosSeen: 0,
    duplicateVideosSkipped: 0,
    metricsIncomplete: 0,
    locallyUnqualified: 0,
    durationDetectionAttempted: 0,
    durationDetectionSucceeded: 0,
    durationDetectionFailed: 0,
    durationDetectionMs: 0,
    advertisementRejected: 0,
    commentsBelowThreshold: 0,
    commentsOpenFailed: 0,
    commentsCloseFailed: 0,
    qualifiedBeforePersist: 0,
    persistedUnique: 0,
    duplicatePersistRejected: 0,
    uploadFailed: 0,
    searchQueriesUsed: [],
    searchOutcomes: {},
    phaseSamples: { metricsOcr: [], duration: [], contentSampling: [], comments: [], cover: [], upload: [], advance: [] },
  };
}

function recordCollectorPhase(diagnostics: CollectorHourDiagnostics, phase: CollectorPhase, startedAt: number) {
  diagnostics.phaseSamples[phase].push(Math.max(0, Date.now() - startedAt));
}

function recordCollectorSearchOutcome(diagnostics: CollectorHourDiagnostics, query: string, qualified: boolean) {
  if (!diagnostics.searchQueriesUsed.includes(query)) diagnostics.searchQueriesUsed.push(query);
  const current = diagnostics.searchOutcomes[query] || { scanned: 0, qualified: 0 };
  current.scanned += 1;
  if (qualified) current.qualified += 1;
  diagnostics.searchOutcomes[query] = current;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]!;
}

async function countCollectorFiles(tempDir = os.tmpdir()) {
  const names = await fs.readdir(tempDir).catch(() => [] as string[]);
  const pendingCount = names.filter((name) => name.startsWith("weixin-channels-pending-") && name.endsWith(".json")).length;
  const quarantineNames = await fs.readdir(path.join(tempDir, "weixin-channels-quarantine")).catch(() => [] as string[]);
  const quarantineCount = quarantineNames.filter((name) => name.startsWith("weixin-channels-pending-") && name.endsWith(".json")).length;
  return { pendingCount, quarantineCount };
}

export async function buildCollectorHourReport(diagnostics: CollectorHourDiagnostics, now = Date.now(), tempDir = os.tmpdir()) {
  const files = await countCollectorFiles(tempDir);
  const timing = (phase: CollectorPhase) => ({
    p50: percentile(diagnostics.phaseSamples[phase], 0.5),
    p95: percentile(diagnostics.phaseSamples[phase], 0.95),
  });
  return {
    windowStartedAt: diagnostics.windowStartedAt,
    windowEndedAt: new Date(now).toISOString(),
    uniqueVideosSeen: diagnostics.uniqueVideosSeen,
    duplicateVideosSkipped: diagnostics.duplicateVideosSkipped,
    metricsIncomplete: diagnostics.metricsIncomplete,
    locallyUnqualified: diagnostics.locallyUnqualified,
    durationDetectionAttempted: diagnostics.durationDetectionAttempted,
    durationDetectionSucceeded: diagnostics.durationDetectionSucceeded,
    durationDetectionFailed: diagnostics.durationDetectionFailed,
    durationDetectionMs: diagnostics.durationDetectionMs,
    advertisementRejected: diagnostics.advertisementRejected,
    commentsBelowThreshold: diagnostics.commentsBelowThreshold,
    commentsOpenFailed: diagnostics.commentsOpenFailed,
    commentsCloseFailed: diagnostics.commentsCloseFailed,
    qualifiedBeforePersist: diagnostics.qualifiedBeforePersist,
    persistedUnique: diagnostics.persistedUnique,
    duplicatePersistRejected: diagnostics.duplicatePersistRejected,
    uploadFailed: diagnostics.uploadFailed,
    ...files,
    searchQueriesUsed: diagnostics.searchQueriesUsed,
    searchQualifiedRate: Object.fromEntries(Object.entries(diagnostics.searchOutcomes).map(([query, value]) => [
      query,
      value.scanned ? Number((value.qualified / value.scanned).toFixed(4)) : 0,
    ])),
    phaseTimings: {
      metricsOcrP50Ms: timing("metricsOcr").p50,
      metricsOcrP95Ms: timing("metricsOcr").p95,
      durationP50Ms: timing("duration").p50,
      durationP95Ms: timing("duration").p95,
      contentSamplingP50Ms: timing("contentSampling").p50,
      contentSamplingP95Ms: timing("contentSampling").p95,
      commentsP50Ms: timing("comments").p50,
      commentsP95Ms: timing("comments").p95,
      coverP50Ms: timing("cover").p50,
      coverP95Ms: timing("cover").p95,
      uploadP50Ms: timing("upload").p50,
      uploadP95Ms: timing("upload").p95,
      advanceP50Ms: timing("advance").p50,
      advanceP95Ms: timing("advance").p95,
    },
  };
}

export function shouldReuseExistingSearchTab(openedTabs: number) {
  // 推荐页占一个标签；只允许额外一个搜索标签并反复复用，总数硬上限为 2，
  // 比用户要求的最多 3 个更保守，避免进程重启前的旧标签撑爆微信内存。
  return openedTabs >= 1;
}

async function compileSwiftExecutable(scriptName: string, binaryName: string) {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), scriptName);
  const source = await fs.readFile(script);
  const fingerprint = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const executable = path.join(os.tmpdir(), `${binaryName}-${fingerprint}`);
  try {
    await fs.access(executable);
  } catch {
    const temporary = `${executable}.${process.pid}.tmp`;
    await execFileAsync("/usr/bin/swiftc", [script, "-o", temporary], { maxBuffer: 20 * 1024 * 1024 });
    await fs.rename(temporary, executable).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await fs.unlink(temporary).catch(() => undefined);
    });
  }
  return executable;
}

async function runSwiftControl(args: string[]) {
  const executable = await getControlExecutable();
  return execFileAsync(executable, args, { maxBuffer: 10 * 1024 * 1024 });
}

async function getControlExecutable() {
  controlExecutablePromise ||= compileSwiftExecutable(
    "macos-weixin-channels-control.swift",
    "mvstudiopro-weixin-channels-control",
  );
  return controlExecutablePromise;
}

async function getOcrExecutable() {
  ocrExecutablePromise ||= compileSwiftExecutable(
    "macos-weixin-channels-ocr.swift",
    "mvstudiopro-weixin-channels-ocr",
  );
  return ocrExecutablePromise;
}

export async function prepareWeixinCollectorExecutables() {
  // 双核机器串行预编译；编译发生在单条 SLA 计时之前，后续 OCR/控制动作复用二进制。
  await getControlExecutable();
  await getOcrExecutable();
}

async function readOcr(screenshot: string): Promise<OcrResult> {
  const executable = await getOcrExecutable();
  const { stdout } = await execFileAsync(executable, [screenshot], { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout) as OcrResult;
}

async function readOcrBatch(screenshots: string[]): Promise<OcrResult[]> {
  const executable = await getOcrExecutable();
  const { stdout } = await execFileAsync(executable, ["--batch", ...screenshots], { maxBuffer: 30 * 1024 * 1024 });
  return JSON.parse(stdout) as OcrResult[];
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
  // 进度控制条会遮住一至两项底部指标；两项稳定即可确认仍为同一视频，
  // 少于两项才视为无法证明，避免把 OCR 遮挡误判成切片换视频。
  if (comparable.length < 2) return false;
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
      // 微信会把未播放轨道染成半透明蓝灰（实测 RGB 约 94/123/146，色差 52），
      // 旧的 45 阈值只认中性灰，导致画面明明有轨道却无限重试。背景深蓝 red≈0，
      // 继续由 red>=55 排除，因此放宽到 65 不会把整片视频背景当进度条。
      const gray = Math.max(red, green, blue) - Math.min(red, green, blue) <= 65 && red >= 55 && red <= 255;
      if (gray) {
        if (runStart < 0 || (lastGray >= 0 && x - lastGray > Math.round(info.width * 0.025))) runStart = x;
        lastGray = x;
        const length = lastGray - runStart;
        if (length >= info.width * 0.25 && (!best || length > best.length)) best = { start: runStart, end: lastGray, y, length };
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

async function detectVisibleProgressTrackReliably(screenshot: string) {
  let lastError: unknown;
  // 首次截图失败后只允许重拍一次，避免控制条识别反复消耗单条预算。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await detectVisibleProgressTrack(screenshot);
    } catch (error) {
      lastError = error;
      // 微信控制条有淡入动画，首张截图可能只拍到视频帧；保持鼠标位于
      // 实测进度条高度并重拍，不能因一次瞬态截图等待二十秒或误造时长。
      await runSwiftControl(["move-relative", "0.50", "0.785"]);
      await new Promise((resolve) => setTimeout(resolve, 160));
      await captureWindow(screenshot);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("weixin_channels_progress_track_not_found");
}

async function detectVideoDurationBeforeSampling(params: {
  screenshot: string;
  baseMetrics: ReturnType<typeof extractWeixinChannelsMetrics>;
  videoDurationHintSec?: number;
}) {
  if (params.videoDurationHintSec && params.videoDurationHintSec > 0) return params.videoDurationHintSec;
  // 推荐页没有搜索卡时长时，只允许读取播放器明确展示的总时长；
  // 不再拖完五点后用进度比例估算一个假时长。
  await runSwiftControl(["click-relative", "0.50", "0.50"]);
  await runSwiftControl(["move-relative", "0.50", "0.82"]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await captureWindow(params.screenshot);
  const revealed = await readOcr(params.screenshot);
  if (!metricsRemainOnSameVideo(params.baseMetrics, extractWeixinChannelsMetrics(revealed.lines))) {
    throw new Error("weixin_channels_video_continuity_unconfirmed_before_duration");
  }
  const track = await detectVisibleProgressTrackReliably(params.screenshot);
  const text = revealed.lines.filter((line) => line.confidence >= 0.35).map((line) => line.text).join(" | ");
  let duration = parseVisibleVideoTotalDurationSeconds(text);
  if (!duration) {
    // 拖到真实进度条末端后读取播放器当前时钟；末端时钟就是总时长，
    // 不用固定值，也不按进度比例估算。
    await runSwiftControl([
      "drag-relative",
      track.startX.toFixed(4),
      track.y.toFixed(4),
      track.endX.toFixed(4),
      track.y.toFixed(4),
    ]);
    // VPN 下 seek 后可能先出现转圈/黑屏；给播放器一次有界缓冲时间，
    // 随后只截一张用于 OCR，不连续截图追加载动画。
    await new Promise((resolve) => setTimeout(resolve, 650));
    await captureWindow(params.screenshot);
    const atEnd = await readOcr(params.screenshot);
    if (!metricsRemainOnSameVideo(params.baseMetrics, extractWeixinChannelsMetrics(atEnd.lines))) {
      throw new Error("weixin_channels_video_continuity_unconfirmed_after_seek");
    }
    const clockText = atEnd.lines
      .filter((line) => line.confidence >= 0.35 && line.y >= 0.08 && line.y <= 0.32)
      .map((line) => line.text)
      .join(" | ");
    duration = parseVisibleVideoClockSeconds(clockText);
  }
  if (!duration) throw new Error("weixin_channels_video_duration_not_detected");
  return duration;
}

export function scoreRepresentativeFrameCandidate(params: {
  progress: number;
  ocrText: string;
  entropy: number;
  sharpness: number;
  mean: number;
}) {
  const meaningfulText = params.ocrText
    .replace(/(?:点赞|轉發|转发|收藏|评论|評論|倍速|推荐|推薦)/g, "")
    .replace(/[\d\s|:：./]+/g, "");
  const loadingPenalty = /(加载|加載|网络异常|網絡異常|重试|重試|缓冲|緩衝)/i.test(params.ocrText) ? 100 : 0;
  const exposurePenalty = params.mean < 22 || params.mean > 238 ? 45 : 0;
  const edgePreference = Math.max(0, 1 - Math.abs(params.progress - 0.5)) * 4;
  return params.entropy * 12
    + Math.min(params.sharpness, 20) * 2
    + Math.min(meaningfulText.length, 80) * 0.25
    + edgePreference
    - loadingPenalty
    - exposurePenalty;
}

export function representativeFrameNeedsSingleRetry(params: {
  ocrText: string;
  entropy: number;
  sharpness: number;
  mean: number;
}) {
  return /(加载|加載|网络异常|網絡異常|重试|重試|缓冲|緩衝|转圈|轉圈)/i.test(params.ocrText)
    || params.mean < 22
    || params.mean > 238
    || params.entropy < 1.2
    || params.sharpness < 0.8;
}

async function selectRepresentativeFrame(samples: Array<{ file: string; progress: number; ocrText: string }>) {
  if (!samples.length) throw new Error("weixin_channels_representative_frame_missing");
  const scored = await Promise.all(samples.map(async (sample) => {
    const stats = await sharp(sample.file).greyscale().stats();
    return {
      ...sample,
      entropy: stats.entropy,
      sharpness: stats.sharpness,
      mean: stats.channels[0]?.mean || 0,
      score: scoreRepresentativeFrameCandidate({
        progress: sample.progress,
        ocrText: sample.ocrText,
        entropy: stats.entropy,
        sharpness: stats.sharpness,
        mean: stats.channels[0]?.mean || 0,
      }),
    };
  }));
  return scored.sort((left, right) => right.score - left.score)[0]!;
}

export async function sampleVideoContentAtProgress(
  screenshot: string,
  baseMetrics: ReturnType<typeof extractWeixinChannelsMetrics>,
  captureStartedAt: number,
  videoDurationHintSec?: number,
) {
  if (!videoDurationHintSec) throw new Error("weixin_channels_video_duration_not_detected");
  const ocrTexts: string[] = [];
  const videoDurationSec = videoDurationHintSec;
  const deadlineAt = captureStartedAt + captureBudgetMsForVideo(videoDurationSec);
  // 点击视频使控制条出现；真实探针确认进度条横跨窗口宽度约 12.5%–91%、纵向约 82.3%。
  await runSwiftControl(["click-relative", "0.50", "0.50"]);
  await runSwiftControl(["move-relative", "0.50", "0.82"]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await captureWindow(screenshot);
  const track = await detectVisibleProgressTrackReliably(screenshot);
  const startX = track.startX;
  let previousX = startX;
  const sampleScreenshots: string[] = [];
  const sampleRecords: Array<{ file: string; progress: number; ocrText: string }> = [];
  await runSwiftControl(["click-relative", startX.toFixed(4), track.y.toFixed(4)]);
  try {
    for (let index = 0; index < WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS.length; index += 1) {
      const progress = WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS[index]!;
      const targetX = startX + (track.endX - startX) * progress;
      await runSwiftControl(["move-relative", "0.50", track.y.toFixed(4)]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await runSwiftControl(["drag-relative", previousX.toFixed(4), track.y.toFixed(4), targetX.toFixed(4), track.y.toFixed(4)]);
      // VPN 下拖动进度后先等画面完成同步，再只截一张内容样本。
      await new Promise((resolve) => setTimeout(resolve, 650));
      await captureWindow(screenshot);
      const sampleFile = path.join(os.tmpdir(), `weixin-channels-sample-${process.pid}-${index}.png`);
      await fs.copyFile(screenshot, sampleFile);
      sampleScreenshots.push(sampleFile);
      previousX = targetX;
    }
    const results = await readOcrBatch(sampleScreenshots);
    let lastOcr = results[results.length - 1];
    if (!lastOcr || !metricsRemainOnSameVideo(baseMetrics, extractWeixinChannelsMetrics(lastOcr.lines))) {
      // VPN seek 后最后一帧偶尔只漏掉互动指标，不能因此重跑整套五点。
      // 保持在 90% 位置等待画面稳定，只允许补截当前帧一次。
      await new Promise((resolve) => setTimeout(resolve, 900));
      await captureWindow(screenshot);
      const continuityRetry = await readOcr(screenshot);
      if (!metricsRemainOnSameVideo(baseMetrics, extractWeixinChannelsMetrics(continuityRetry.lines))) {
        throw new Error("weixin_channels_video_continuity_unconfirmed_after_single_recapture");
      }
      const lastIndex = sampleScreenshots.length - 1;
      await fs.copyFile(screenshot, sampleScreenshots[lastIndex]!);
      results[lastIndex] = continuityRetry;
      lastOcr = continuityRetry;
    }
    for (let index = 0; index < results.length; index += 1) {
      const ocr = results[index]!;
      const progress = WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS[index];
      if (progress === undefined) continue;
      // 播放控制条会把当前秒数、倍速等数字覆盖到互动指标槽位；抽查阶段只读取内容，
      // 不用这些遮挡后的数字推翻进入抽查前已确认的互动指标。
      const text = ocr.lines.filter((line) => line.confidence >= 0.45).map((line) => line.text.trim()).filter(Boolean).join(" | ");
      ocrTexts.push(text);
      sampleRecords.push({ file: sampleScreenshots[index]!, progress, ocrText: text });
    }
    let representative = await selectRepresentativeFrame(sampleRecords);
    if (representativeFrameNeedsSingleRetry(representative)) {
      // VPN seek 可能先给出转圈/黑屏。只回到已选中的进度补拍一次，禁止重跑整套五点。
      const retryX = startX + (track.endX - startX) * representative.progress;
      await runSwiftControl(["drag-relative", previousX.toFixed(4), track.y.toFixed(4), retryX.toFixed(4), track.y.toFixed(4)]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await captureWindow(screenshot);
      const retryFile = path.join(os.tmpdir(), `weixin-channels-sample-${process.pid}-retry.png`);
      await fs.copyFile(screenshot, retryFile);
      sampleScreenshots.push(retryFile);
      const retryOcr = await readOcr(retryFile);
      if (!metricsRemainOnSameVideo(baseMetrics, extractWeixinChannelsMetrics(retryOcr.lines))) {
        throw new Error("weixin_channels_video_continuity_unconfirmed_after_representative_retry");
      }
      const retryText = retryOcr.lines.filter((line) => line.confidence >= 0.45).map((line) => line.text.trim()).filter(Boolean).join(" | ");
      ocrTexts.push(retryText);
      sampleRecords.push({ file: retryFile, progress: representative.progress, ocrText: retryText });
      representative = await selectRepresentativeFrame(sampleRecords);
      if (representativeFrameNeedsSingleRetry(representative)) {
        throw new Error("weixin_channels_representative_frame_still_loading_after_single_retry");
      }
    }
    const visualImageBase64 = await buildVisualFrameBase64(representative.file);
    return {
      ocrTexts,
      videoDurationSec,
      deadlineAt,
      visualImageBase64,
      visualAssetKind: "representative_frame" as const,
      visualFrameProgress: representative.progress,
    };
  } finally {
    await Promise.all(sampleScreenshots.map((sample) => fs.unlink(sample).catch(() => undefined)));
  }
}

async function collectVisibleComments(screenshot: string, baseOcr: OcrResult, deadlineAt: number) {
  const openPoint = findCommentsOpenPoint(baseOcr.lines);
  if (!openPoint) throw new Error("weixin_channels_comments_entry_not_found");
  await runSwiftControl(["click-relative", openPoint.x.toFixed(5), openPoint.y.toFixed(5)]);
  await waitWithinCaptureBudget(deadlineAt, 2_000, 3_000);
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
    collected.push(...extractCommentPanelContentLines(panel.lines));
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

async function confirmVisibleInteractionMetrics(screenshot: string, first: OcrResult) {
  if (!hasFourVisibleMetrics(first.lines)) throw new Error("weixin_channels_four_metrics_not_visible");
  await new Promise((resolve) => setTimeout(resolve, 160));
  await captureWindow(screenshot);
  const second = await readOcr(screenshot);
  if (!interactionMetricsConfirmed(first, second)) {
    throw new Error("weixin_channels_four_metrics_not_stable_across_snapshots");
  }
  return second;
}

async function ensureVideoPlayerVisible(screenshot: string, ocr: OcrResult) {
  let current = ocr;
  for (let attempt = 0; attempt < 2 && isWeixinChannelsAuxiliaryPage(current.lines); attempt += 1) {
    process.stderr.write("auxiliary_page_closing\n");
    const mediaClosePoint = findMediaViewerClosePoint(current.lines);
    if (isWeixinChannelsMediaViewer(current.lines)) {
      if (mediaClosePoint) {
        await runSwiftControl(["click-relative", mediaClosePoint.x.toFixed(5), mediaClosePoint.y.toFixed(5)]);
      } else {
        await runSwiftControl(["key", "escape"]);
      }
    } else {
      await runSwiftControl(["key", "closeTab"]);
      if (collectorSearchTabState?.openedTabs) {
        collectorSearchTabState.openedTabs = Math.max(0, collectorSearchTabState.openedTabs - 1);
        await persistCollectorSearchTabState(collectorSearchTabState);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    await captureWindow(screenshot);
    current = await readOcr(screenshot);
  }
  if (isWeixinChannelsAuxiliaryPage(current.lines)) {
    throw new Error("weixin_channels_auxiliary_page_not_closed");
  }
  return current;
}

async function persistPendingFile(output: string, observation: unknown) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(observation, null, 2), "utf8");
  await fs.rename(temp, output);
}

async function buildVisualFrameBase64(screenshot: string) {
  const metadata = await sharp(screenshot).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width < 100 || height < 100) throw new Error("weixin_channels_visual_frame_invalid");
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
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = remaining === undefined
    ? undefined
    : new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("upload_timeout"));
      }, remaining);
    });
  try {
    const request = (params.fetchImpl || fetch)(`${params.server.replace(/\/$/, "")}/api/internal/weixin-channels/observations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-weixin-channels-collector-token": params.token },
      body: JSON.stringify({ taskId: params.taskId, observations: [observation] }),
      signal: controller.signal,
    });
    const response = timeoutPromise ? await Promise.race([request, timeoutPromise]) : await request;
    const body = response.text();
    const text = timeoutPromise ? await Promise.race([body, timeoutPromise]) : await body;
    if (!response.ok) throw new Error(`upload_failed:${response.status}:${text.slice(0, 500)}`);
    const payload = JSON.parse(text) as {
      persisted?: boolean;
      newlyPersisted?: boolean;
      newlyQualifiedPersisted?: boolean;
      accumulatedQualifiedCount?: number;
    };
    if (payload.persisted !== true) throw new Error("upload_not_persisted");
    await fs.unlink(params.pendingFile);
    return payload;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type PendingObservationEnvelope = {
  taskId?: string;
  videoDurationSec?: number;
  captureElapsedMs?: number;
  captureBudgetMs?: number;
  comments?: number;
  commentSamples?: unknown[];
};

export function pendingObservationHasRequiredComments(observation: PendingObservationEnvelope) {
  return (observation.comments || 0) < WEIXIN_CHANNELS_COMMENT_THRESHOLD
    || (Array.isArray(observation.commentSamples) && observation.commentSamples.length > 0);
}

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
    if (exceedsAuthoritativeCaptureBudget(observation) || !pendingObservationHasRequiredComments(observation)) continue;
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
  let persistedUnique = 0;
  let duplicatePersistRejected = 0;
  let failed = 0;
  // Fly 单机双核：每个心跳只恢复一个，避免封面上传与正常 ingest 叠加冲垮实例。
  for (const name of names.slice(0, 1)) {
    const pendingFile = path.join(tempDir, name);
    try {
      const observation = JSON.parse(await fs.readFile(pendingFile, "utf8")) as PendingObservationEnvelope;
      if (!observation.taskId) throw new Error("pending_observation_task_id_missing");
      if (!pendingObservationHasRequiredComments(observation)) {
        const quarantineDir = path.join(tempDir, "weixin-channels-quarantine");
        await fs.mkdir(quarantineDir, { recursive: true });
        await fs.rename(pendingFile, path.join(quarantineDir, name));
        process.stderr.write(`pending_quarantined:${name}:required_comments_missing\n`);
        continue;
      }
      if (exceedsAuthoritativeCaptureBudget(observation)) {
        const quarantineDir = path.join(tempDir, "weixin-channels-quarantine");
        await fs.mkdir(quarantineDir, { recursive: true });
        await fs.rename(pendingFile, path.join(quarantineDir, name));
        process.stderr.write(`pending_quarantined:${name}:capture_sla_exceeded\n`);
        continue;
      }
      const payload = await uploadPendingObservation({
        server: params.server,
        token: params.token,
        taskId: observation.taskId,
        pendingFile,
        deadlineAt: Date.now() + 60_000,
        fetchImpl: params.fetchImpl,
      });
      persisted += 1;
      if (payload.newlyQualifiedPersisted === true) persistedUnique += 1;
      else if (payload.newlyPersisted === false) duplicatePersistRejected += 1;
      process.stderr.write(`pending_recovered:${name}\n`);
    } catch (error) {
      failed += 1;
      process.stderr.write(`pending_retry_failed:${name}:${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return { found: names.length, persisted, persistedUnique, duplicatePersistRejected, failed };
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

export function hasConfirmedVideoTransition(previous: OcrResult, next: OcrResult) {
  const nextFingerprint = visibleVideoIdentityFingerprint(next);
  if (!nextFingerprint) return false;
  const previousFingerprint = visibleVideoIdentityFingerprint(previous);
  if (previousFingerprint === nextFingerprint) return false;
  const previousText = extractVisibleTitleAndAuthor(previous.lines);
  const nextText = extractVisibleTitleAndAuthor(next.lines);
  if (previousText.title && nextText.title && previousText.title !== nextText.title) return true;
  if (previousText.author && nextText.author && previousText.author !== nextText.author) return true;
  // 同一高热视频的互动数会自然增长；在容差内变化不能冒充切换成功。
  if (metricsRemainOnSameVideo(
    extractWeixinChannelsMetrics(previous.lines),
    extractWeixinChannelsMetrics(next.lines),
  )) return false;
  return true;
}

async function advanceToNextVideo(previous: OcrResult, screenshot: string, deadlineAt?: number) {
  // 真实窗口里方向键会被播放器控制条或搜索输入焦点吞掉；在视频主体滚轮向下
  // 可稳定切到下一条，并且不依赖固定像素坐标。
  await runSwiftControl(["scroll-relative", "0.50", "0.50", "-6"]);
  const timeoutMs = deadlineAt === undefined
    ? WEIXIN_CHANNELS_UNQUALIFIED_DWELL_MS
    : Math.max(50, deadlineAt - Date.now());
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await captureWindow(screenshot);
    const next = await readOcr(screenshot);
    if (isWeixinChannelsMediaViewer(next.lines)) {
      const closePoint = findMediaViewerClosePoint(next.lines);
      if (closePoint) await runSwiftControl(["click-relative", closePoint.x.toFixed(5), closePoint.y.toFixed(5)]);
      else await runSwiftControl(["key", "escape"]);
      continue;
    }
    if (hasConfirmedVideoTransition(previous, next)) return next;
  }
  throw new Error("weixin_channels_next_video_not_visible_within_2s");
}

async function advanceToNextVideoSafely(previous: OcrResult, screenshot: string, deadlineAt?: number) {
  try {
    return await advanceToNextVideo(previous, screenshot, deadlineAt);
  } catch (error) {
    process.stderr.write(`advance_recovering:${error instanceof Error ? error.message : String(error)}\n`);
    // 搜索联想框、评论或图片查看器可能吞掉滚轮。只收起浮层后重试；
    // 禁止点击视频中心，因为图片帖子会把该盲点解释为“打开图片”。
    await runSwiftControl(["key", "escape"]);
    await runSwiftControl(["key", "escape"]);
    await new Promise((resolve) => setTimeout(resolve, 180));
    await captureWindow(screenshot);
    const recovered = await readOcr(screenshot);
    if (hasConfirmedVideoTransition(previous, recovered)) return recovered;
    try {
      return await advanceToNextVideo(previous, screenshot);
    } catch (retryError) {
      // 不能把同一画面交回采集循环，否则扫描计数会虚增，达标视频还可能
      // 被重复上传。交给外层常驻监督器重新初始化窗口与任务。
      process.stderr.write(`advance_recovery_exhausted:${retryError instanceof Error ? retryError.message : String(retryError)}\n`);
      throw new Error("weixin_channels_advance_recovery_exhausted");
    }
  }
}

async function searchKeyword(keyword: string, screenshot: string) {
  const safeKeyword = normalizeWeixinChannelsSearchQuery(keyword);
  if (!safeKeyword) throw new Error("weixin_channels_search_keyword_rejected");
  keyword = safeKeyword;
  const { stdout: windowStdout } = await runSwiftControl(["window"]);
  const currentWindow = JSON.parse(windowStdout) as { windowId: number };
  if (!collectorSearchTabState || collectorSearchTabState.windowId !== currentWindow.windowId) {
    collectorSearchTabState = await loadCollectorSearchTabState(currentWindow.windowId);
    await persistCollectorSearchTabState(collectorSearchTabState);
  }
  await captureWindow(screenshot);
  let ocr = await readOcr(screenshot);
  let point = findSearchInputPoint(ocr.lines);
  if (!point && shouldReuseExistingSearchTab(collectorSearchTabState.openedTabs)) {
    // 已有一个脚本搜索标签时，先关闭当前活动页并尝试复用；推荐页加搜索页
    // 总数最多两个，禁止每轮搜索都新增标签把微信内存撑满。
    await runSwiftControl(["key", "closeTab"]);
    collectorSearchTabState.openedTabs = Math.max(0, collectorSearchTabState.openedTabs - 1);
    await persistCollectorSearchTabState(collectorSearchTabState);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await captureWindow(screenshot);
    ocr = await readOcr(screenshot);
    point = findSearchInputPoint(ocr.lines);
  }
  if (!point) {
    // 顶栏放大镜使用动态窗口相对坐标。每次搜索最多点击一次；加载较慢时
    // 只轮询 OCR，不得重复点击并意外再开一个标签。
    await runSwiftControl([
      "click-relative",
      WEIXIN_CHANNELS_SEARCH_BUTTON_POINT.x.toFixed(5),
      WEIXIN_CHANNELS_SEARCH_BUTTON_POINT.y.toFixed(5),
    ]);
    collectorSearchTabState.openedTabs += 1;
    await persistCollectorSearchTabState(collectorSearchTabState);
    for (let attempt = 0; !point && attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await captureWindow(screenshot);
      ocr = await readOcr(screenshot);
      point = findSearchInputPoint(ocr.lines);
    }
  }
  if (!point) {
    // 点击放大镜后仍无法由 OCR 证明输入框存在，就保留计数供下一轮关闭该页，
    // 但本轮绝不使用兜底坐标盲输、盲回车。
    throw new Error("weixin_channels_search_input_not_confirmed_after_single_tab_open");
  }
  const inputPoint = point;
  let typed: OcrResult | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await runSwiftControl(["click-relative", inputPoint.x.toFixed(5), inputPoint.y.toFixed(5)]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await runSwiftControl(["key", "clear"]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await runSwiftControl(["type", keyword]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await captureWindow(screenshot);
    typed = await readOcr(screenshot);
    if (hasTypedSearchKeyword(typed.lines, keyword)) break;
  }
  if (!typed) throw new Error("weixin_channels_search_keyword_not_captured");
  if (!hasTypedSearchKeyword(typed.lines, keyword)) throw new Error("weixin_channels_search_keyword_not_confirmed");
  await runSwiftControl(["key", "return"]);
  await new Promise((resolve) => setTimeout(resolve, 900));
  await captureWindow(screenshot);
  let submitted = await readOcr(screenshot);
  if (!findFirstSearchVideoPoint(submitted.lines)) {
    const suggestion = findExactSearchSuggestionPoint(submitted.lines, keyword)
      || findExactSearchSuggestionPoint(typed.lines, keyword);
    if (suggestion) {
      await runSwiftControl(["click-relative", suggestion.x.toFixed(5), suggestion.y.toFixed(5)]);
    } else {
      // 有些微信版本第一次回车只确认输入法，第二次才提交搜索。
      await runSwiftControl(["key", "return"]);
    }
  }
  const beforeResults = ocrFingerprint(submitted);
  await waitForVisibleVideoLoad();
  submitted = await waitForChangedFrame(beforeResults, screenshot);
  return submitted;
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
  // 当前桌面版常只显示横排数字而无文字标签。四项齐全时按顺序映射；
  // OCR 漏掉一项时按真实横向槽位就近归属，避免把三项可用数据整组丢弃。
  if (Object.values(result).filter((value) => value !== undefined).length < 2) {
    const bottomNumbers = textLines
      .filter((line) => line.y < 0.13 && line.x > 0.45)
      .map((line) => ({ x: line.x, y: line.y, value: parseStandaloneMetric(line.text) }))
      .filter((entry): entry is { x: number; y: number; value: number } => entry.value !== undefined)
      .sort((left, right) => left.x - right.x);
    if (bottomNumbers.length >= 4) {
      [result.likes, result.shares, result.favorites, result.comments] = bottomNumbers.slice(-4).map((entry) => entry.value);
    } else if (bottomNumbers.length >= 2) {
      const slots = [
        { key: "likes", x: 0.53 },
        { key: "shares", x: 0.65 },
        { key: "favorites", x: 0.77 },
        { key: "comments", x: 0.89 },
      ] as const;
      const claimed = new Set<string>();
      for (const entry of bottomNumbers) {
        const nearest = slots
          .filter((slot) => !claimed.has(slot.key))
          .map((slot) => ({ ...slot, distance: Math.abs(entry.x - slot.x) }))
          .sort((left, right) => left.distance - right.distance)[0];
        if (nearest && nearest.distance <= 0.075) {
          result[nearest.key] = entry.value;
          claimed.add(nearest.key);
        }
      }
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

const BLOCKED_DRAMA_QUERY = /(短剧|短劇|剧场|劇場|免费看|免費看|追剧|追劇|看剧|看劇|原创动画|原創動畫|男频|男頻|女频|女頻|爽文|爽剧|爽劇)/i;

export function buildDiverseCollectorSearchQueries(params: {
  candidates: CollectorCandidate[];
  seedQueries?: string[];
  recentlyUsed?: string[];
  limit?: number;
}) {
  const recentlyUsed = new Set((params.recentlyUsed || []).map((item) => item.trim().toLowerCase()));
  const byCategory = new Map<string, string[]>();
  const ranked = [...params.candidates].sort((left, right) => {
    const score = (item: CollectorCandidate) => {
      const text = `${item.category || ""} ${item.sourceTitle || ""} ${item.searchQueries.join(" ")}`;
      return (/AI|人工智能/i.test(text) ? 100 : 0)
        + (/(工作流|工具|实测|實測|拆解|方法|变现|變現)/i.test(text) ? 300 : 0)
        + (/(教程|教學|新手|怎么|怎麼|如何)/i.test(text) ? 200 : 0)
        - (BLOCKED_DRAMA_QUERY.test(text) ? 180 : 0);
    };
    return score(right) - score(left);
  });
  for (const item of ranked) {
    const category = String(item.category || "其他").trim() || "其他";
    const bucket = byCategory.get(category) || [];
    for (const raw of item.searchQueries) {
      for (const query of deriveWeixinChannelsSearchQueries(raw)) {
        if (BLOCKED_DRAMA_QUERY.test(query) || bucket.includes(query)) continue;
        bucket.push(query);
      }
    }
    if (bucket.length) byCategory.set(category, bucket);
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  const append = (query: string) => {
    const key = query.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(query);
    }
  };
  // 跨类目轮询到所有真实七天候选耗尽，避免旧实现只取前三轮、后续新词永远进不了词池。
  const maxRounds = Math.max(0, ...Array.from(byCategory.values(), (bucket) => bucket.length));
  for (let round = 0; round < maxRounds; round += 1) {
    for (const bucket of Array.from(byCategory.values())) {
      if (bucket[round]) append(bucket[round]!);
    }
  }
  for (const query of params.seedQueries || []) {
    for (const normalized of deriveWeixinChannelsSearchQueries(query)) {
      if (!BLOCKED_DRAMA_QUERY.test(normalized)) append(normalized);
    }
  }
  const fresh = ordered.filter((query) => !recentlyUsed.has(query.toLowerCase()));
  const used = ordered.filter((query) => recentlyUsed.has(query.toLowerCase()));
  return [...fresh, ...used].slice(0, params.limit || 24);
}

function hydrateCollectorTask(params: {
  task: HeartbeatTask;
  candidates: CollectorCandidate[];
  recentlyUsed: string[];
}) {
  return {
    ...params.task,
    searchQueries: buildDiverseCollectorSearchQueries({
      candidates: params.candidates,
      seedQueries: params.task.searchQueries,
      recentlyUsed: params.recentlyUsed,
    }),
  };
}

async function readRecentCollectorQueries(tempDir = os.tmpdir()) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(tempDir, "weixin-channels-recent-queries.json"), "utf8"));
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(-50) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function rememberCollectorQuery(query: string, tempDir = os.tmpdir()) {
  const recent = await readRecentCollectorQueries(tempDir);
  const next = [...recent.filter((item) => item.toLowerCase() !== query.toLowerCase()), query].slice(-50);
  await fs.writeFile(path.join(tempDir, "weixin-channels-recent-queries.json"), JSON.stringify(next), "utf8");
}

async function refreshCollectorCandidates(server: string, token: string) {
  const response = await fetch(`${server.replace(/\/$/, "")}/api/internal/weixin-channels/candidates`, {
    headers: { "x-weixin-channels-collector-token": token },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`candidate_refresh_failed:${response.status}:${text.slice(0, 500)}`);
  return (JSON.parse(text) as { candidates?: CollectorCandidate[] }).candidates || [];
}

export async function syncPersistedCollectorIdentities(params: {
  server: string;
  token: string;
  registry: CollectorSeenRegistry;
  fetchImpl?: typeof fetch;
  now?: number;
}) {
  const now = params.now ?? Date.now();
  const since = new Date(now - WEIXIN_CHANNELS_SEEN_TTL_MS).toISOString();
  const response = await (params.fetchImpl || fetch)(
    `${params.server.replace(/\/$/, "")}/api/internal/weixin-channels/persisted-identities?since=${encodeURIComponent(since)}`,
    { headers: { "x-weixin-channels-collector-token": params.token } },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`persisted_identity_sync_failed:${response.status}:${text.slice(0, 300)}`);
  const payload = JSON.parse(text) as { records?: Array<{ videoIdentity?: string; observationId?: string; persistedAt?: string }> };
  let synced = 0;
  for (const record of payload.records || []) {
    if (!record.videoIdentity || !record.observationId || !record.persistedAt) continue;
    const entry: CollectorSeenEntry = {
      videoIdentity: record.videoIdentity,
      observationId: record.observationId,
      seenAt: record.persistedAt,
      state: "persisted",
    };
    params.registry.entries.set(entry.videoIdentity, entry);
    params.registry.observationIds.add(entry.observationId!);
    synced += 1;
  }
  await persistCollectorSeenRegistry(params.registry, now);
  return synced;
}

export function selectReusableCollectorCandidate(candidates: CollectorCandidate[]) {
  const usable = candidates.filter((item) => item.taskId && item.searchQueries?.length);
  return usable.sort((left, right) => {
    const score = (item: CollectorCandidate) => {
      const text = `${item.category || ""} ${item.sourceTitle || ""} ${item.searchQueries.join(" ")}`;
      return (/AI|人工智能/i.test(text) ? 100 : 0)
        + (/(工作流|工具|实测|實測|拆解|方法|变现|變現)/i.test(text) ? 300 : 0)
        + (/(教程|教學|新手|怎么|怎麼|如何)/i.test(text) ? 200 : 0)
        - (/(短剧|短劇|剧场|劇場|免费看|免費看|追剧|追劇|原创动画|原創動畫|男频|男頻|女频|女頻|爽文)/i.test(text) ? 180 : 0)
        + Math.min(item.searchQueries.length, 10)
        + (Date.parse(item.createdAt || "") || 0) / 1e15;
    };
    return score(right) - score(left);
  })[0];
}

type VideoCaptureRetryCache = {
  samplingAttempts: number;
  sampled?: Awaited<ReturnType<typeof sampleVideoContentAtProgress>>;
  samplingActiveMs?: number;
};

async function captureVisibleQualifiedVideo(params: {
  ocr: OcrResult;
  screenshot: string;
  taskId: string;
  query: string;
  videoIdentity: string;
  observationId: string;
  diagnostics: CollectorHourDiagnostics;
  probe: boolean;
  server?: string;
  token?: string;
  titleOverride?: string;
  authorOverride?: string;
  outputOverride?: string;
  videoDurationHintSec?: number;
  retryCache: VideoCaptureRetryCache;
}) {
  const captureStartedAt = Date.now();
  const metricsStartedAt = Date.now();
  const metrics = extractWeixinChannelsMetrics(params.ocr.lines);
  const identity = extractVisibleTitleAndAuthor(params.ocr.lines);
  recordCollectorPhase(params.diagnostics, "metricsOcr", metricsStartedAt);
  const actualMetrics = [metrics.likes, metrics.comments, metrics.shares, metrics.favorites]
    .filter((value) => value !== undefined);
  if (actualMetrics.length < 4) {
    params.diagnostics.metricsIncomplete += 1;
    // 评论数缺失时不能假定为 0；否则实际 comments>=80 的视频会绕过真实评论门禁。
    // 抛给同视频安全恢复，禁止把它改判为不达标后直接滑走。
    throw new Error("weixin_channels_four_metrics_required_before_qualification");
  }

  if (containsWeixinChannelsAdvertisement(metrics.rawText)) {
    params.diagnostics.advertisementRejected += 1;
    params.diagnostics.locallyUnqualified += 1;
    return {
      qualified: false as const,
      reason: "OCR 检出广告，该视频立即无效",
      fingerprint: params.videoIdentity,
    };
  }

  const title = params.titleOverride || identity.title || "当前视频";
  const preliminary = qualifyWeixinChannelsObservationLocally({ ...metrics, query: params.query, title });
  if (!preliminary.qualified) {
    params.diagnostics.locallyUnqualified += 1;
    if ((metrics.comments || 0) < WEIXIN_CHANNELS_COMMENT_THRESHOLD) params.diagnostics.commentsBelowThreshold += 1;
    return { qualified: false as const, reason: preliminary.reason, fingerprint: params.videoIdentity };
  }

  const author = params.authorOverride || identity.author;
  const reusedSampling = Boolean(params.retryCache.sampled);
  let sampled = params.retryCache.sampled;
  if (!sampled) {
    params.diagnostics.durationDetectionAttempted += 1;
    const durationStartedAt = Date.now();
    let detectedVideoDurationSec: number;
    try {
      detectedVideoDurationSec = await detectVideoDurationBeforeSampling({
        screenshot: params.screenshot,
        baseMetrics: metrics,
        videoDurationHintSec: params.videoDurationHintSec,
      });
      params.diagnostics.durationDetectionSucceeded += 1;
    } catch (error) {
      params.diagnostics.durationDetectionFailed += 1;
      throw error;
    } finally {
      const elapsed = Date.now() - durationStartedAt;
      params.diagnostics.durationDetectionMs += elapsed;
      recordCollectorPhase(params.diagnostics, "duration", durationStartedAt);
    }
    if (params.retryCache.samplingAttempts >= 2) {
      // 只有真正即将执行五点抽查时才消耗次数；控制条未出现不算一次五点。
      throw new Error("weixin_channels_content_sampling_retry_exhausted");
    }
    params.retryCache.samplingAttempts += 1;
    const samplingStartedAt = Date.now();
    sampled = await sampleVideoContentAtProgress(params.screenshot, metrics, captureStartedAt, detectedVideoDurationSec);
    recordCollectorPhase(params.diagnostics, "contentSampling", samplingStartedAt);
    params.retryCache.sampled = sampled;
    params.retryCache.samplingActiveMs = Date.now() - captureStartedAt;
  } else {
    // 评论或上传阶段恢复时复用已经完成的五点结果，不再次拖动。
    sampled = {
      ...sampled,
      deadlineAt: captureStartedAt + Math.max(1_000, captureBudgetMsForVideo(sampled.videoDurationSec) - (params.retryCache.samplingActiveMs || 0)),
    };
  }
  const { ocrTexts, videoDurationSec, deadlineAt } = sampled;
  const adDetected = containsWeixinChannelsAdvertisement(ocrTexts);
  if (adDetected) params.diagnostics.advertisementRejected += 1;
  const finalQualification = qualifyWeixinChannelsObservationLocally({
    ...metrics,
    query: params.query,
    title,
    ocrTexts,
  });
  let ocr = params.ocr;
  let commentSamples: WeixinChannelsCommentSample[] | undefined;
  if (!adDetected && finalQualification.requiresComments && (metrics.comments || 0) >= WEIXIN_CHANNELS_COMMENT_THRESHOLD) {
    const commentsStartedAt = Date.now();
    try {
      const comments = await collectVisibleComments(params.screenshot, ocr, deadlineAt);
      commentSamples = comments.samples;
      if (!commentSamples.length) throw new Error("weixin_channels_real_comments_not_found");
      ocr = comments.closedOcr;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/close/.test(message)) params.diagnostics.commentsCloseFailed += 1;
      else params.diagnostics.commentsOpenFailed += 1;
      throw error;
    } finally {
      recordCollectorPhase(params.diagnostics, "comments", commentsStartedAt);
    }
  }
  const coverStartedAt = Date.now();
  const visualImageBase64 = !adDetected && finalQualification.qualified ? sampled.visualImageBase64 : undefined;
  recordCollectorPhase(params.diagnostics, "cover", coverStartedAt);
  const captureElapsedMs = (reusedSampling ? (params.retryCache.samplingActiveMs || 0) : 0)
    + (Date.now() - captureStartedAt);
  const captureBudgetMs = captureBudgetMsForVideo(videoDurationSec);
  if (captureElapsedMs > captureBudgetMs) {
    throw new Error("weixin_channels_capture_time_budget_exceeded");
  }
  if (finalQualification.qualified) params.diagnostics.qualifiedBeforePersist += 1;
  const observation = {
    observationId: params.observationId,
    videoIdentity: params.videoIdentity,
    taskId: params.taskId,
    query: params.query,
    resultRank: 1,
    title,
    author,
    visualImageBase64,
    visualAssetKind: visualImageBase64 ? sampled.visualAssetKind : undefined,
    visualFrameProgress: visualImageBase64 ? sampled.visualFrameProgress : undefined,
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
  let persisted = false;
  if (params.server) {
    if (!params.token) throw new Error("WEIXIN_CHANNELS_COLLECTOR_TOKEN is required for upload");
    const uploadStartedAt = Date.now();
    let payload: Awaited<ReturnType<typeof uploadPendingObservation>>;
    try {
      payload = await uploadPendingObservation({
        server: params.server,
        token: params.token,
        taskId: params.taskId,
        pendingFile: output,
        // 视频内容采样 SLA 与远端持久化确认分离。若沿用采样截止时间，
        // 客户端会在 Fly 仍处理中时 abort，随后重传同一大封面请求造成重叠负载。
        deadlineAt: Date.now() + 60_000,
      });
      if (payload.newlyQualifiedPersisted === true) params.diagnostics.persistedUnique += 1;
      else if (payload.newlyPersisted !== true) params.diagnostics.duplicatePersistRejected += 1;
    } catch (error) {
      params.diagnostics.uploadFailed += 1;
      throw error;
    } finally {
      recordCollectorPhase(params.diagnostics, "upload", uploadStartedAt);
    }
    // 服务端已确认 persisted=true 后，不能再把该条改判成“未达标/跳过”；
    // 超时属于 SLA 观测，入库事实与本地达标计数必须保持一致。
    if (Date.now() > deadlineAt) {
      process.stderr.write(`capture_sla_exceeded_after_persist:${observation.observationId}\n`);
    }
    process.stderr.write(`uploaded:${JSON.stringify(payload)}\n`);
    persisted = payload.persisted === true;
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
    fingerprint: params.videoIdentity,
    observation,
    persisted,
  };
}

async function openFirstSearchResult(keyword: string, screenshot: string) {
  let results = await searchKeyword(keyword, screenshot);
  let point = findFirstSearchVideoPoint(results.lines);
  for (let page = 0; !point && page < 3; page += 1) {
    await runSwiftControl(["scroll-relative", "0.75", "0.68", "-6"]);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await captureWindow(screenshot);
    results = await readOcr(screenshot);
    point = findFirstSearchVideoPoint(results.lines);
  }
  if (!point) throw new Error("weixin_channels_organic_search_video_not_found");
  await runSwiftControl(["click-relative", point.x.toFixed(5), point.y.toFixed(5)]);
  await waitForVisibleVideoLoad();
  const startedAt = Date.now();
  // 搜索结果页到播放器首次加载实测偶尔超过 8 秒；这是换源导航时间，
  // 单条内容采集计时从播放器指标可见后才开始，二者不能混为同一个 SLA。
  while (Date.now() - startedAt < 15_000) {
    await captureWindow(screenshot);
    const opened = await readOcr(screenshot);
    if (isWeixinChannelsMediaViewer(opened.lines)) {
      const closePoint = findMediaViewerClosePoint(opened.lines);
      if (closePoint) await runSwiftControl(["click-relative", closePoint.x.toFixed(5), closePoint.y.toFixed(5)]);
      else await runSwiftControl(["key", "escape"]);
      throw new Error("weixin_channels_search_result_media_viewer_not_video");
    }
    const metrics = extractWeixinChannelsMetrics(opened.lines);
    if ([metrics.likes, metrics.shares, metrics.favorites, metrics.comments].filter((value) => value !== undefined).length >= 2) {
      return { ocr: opened, videoDurationSec: point.videoDurationSec };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("weixin_channels_search_result_video_not_opened");
}

async function runCollectionPool(params: {
  screenshot: string;
  server: string;
  token: string;
  probe: boolean;
  maxScanned?: number;
}) {
  const clientId = `mac-weixin-${os.hostname()}`.slice(0, 120);
  const seenRegistry = await loadCollectorSeenRegistry();
  // 本机 v1 seen 曾在处理前写入，不能作为跳过依据。启动时必须先用 Fly 的
  // persistedAt 事实校准；同步失败直接停机，禁止带着不可信去重状态操作微信。
  const persistedIdentityCount = await syncPersistedCollectorIdentities({
    server: params.server,
    token: params.token,
    registry: seenRegistry,
  });
  process.stderr.write(`persisted_identity_sync_completed:${persistedIdentityCount}\n`);
  let diagnostics = createCollectorHourDiagnostics();
  let windowStartedAt = Date.parse(diagnostics.windowStartedAt);
  let checkpoint15Handled = false;
  let checkpoint30Handled = false;
  let forceSearchQueryRotation = false;
  await restoreEligibleQuarantinedObservations();
  const initialRecovery = await retryPendingObservations({ server: params.server, token: params.token });
  diagnostics.persistedUnique += initialRecovery.persistedUnique;
  diagnostics.duplicatePersistRejected += initialRecovery.duplicatePersistRejected;
  let candidates = await refreshCollectorCandidates(params.server, params.token);
  let heartbeat = await heartbeatCollector(params.server, params.token, clientId);
  if (!heartbeat.enabled) return { stopped: "capture_disabled", scanned: 0, qualified: 0 };
  if (!heartbeat.nextTask) {
    // 任务只能由 Fly 中抖音/B站/小红书最近七天真实数据生成；本机不维护固定热词。
    candidates = await refreshCollectorCandidates(params.server, params.token);
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

  let task = hydrateCollectorTask({
    task: heartbeat.nextTask,
    candidates,
    recentlyUsed: await readRecentCollectorQueries(),
  });
  process.stderr.write(`search_query_pool_ready:${task.searchQueries.length}\n`);
  let mode: "recommendation" | "search" = "recommendation";
  let recommendationStartedAt = Date.now();
  let recommendationQualified = 0;
  let recommendationScanned = 0;
  let totalScanned = 0;
  let totalQualified = 0;
  let totalRecovered = initialRecovery.persisted;
  let searchQueryIndex = 0;
  let scansOnCurrentQuery = 0;
  let qualifiedOnCurrentQuery = 0;
  let knownVideoDurationSec: number | undefined;
  let consecutiveDuplicates = 0;
  const inFlightVideoIdentities = new Set<string>();
  let lastHeartbeatAt = Date.now();
  await captureWindow(params.screenshot);
  let ocr = await readOcr(params.screenshot);
  ocr = await ensureVideoPlayerVisible(params.screenshot, ocr);

  const advanceTracked = async (previous: OcrResult, deadlineAt?: number) => {
    const startedAt = Date.now();
    try {
      return await advanceToNextVideoSafely(previous, params.screenshot, deadlineAt);
    } finally {
      recordCollectorPhase(diagnostics, "advance", startedAt);
    }
  };

  while (totalScanned < (params.maxScanned ?? Number.POSITIVE_INFINITY)) {
    const windowElapsedMs = Date.now() - windowStartedAt;
    if (windowElapsedMs >= WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[0].elapsedMs && !checkpoint15Handled) {
      checkpoint15Handled = true;
      if (diagnostics.persistedUnique < WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[0].minimumPersisted) forceSearchQueryRotation = true;
      process.stderr.write(`collector_watchdog_15m:${JSON.stringify(await buildCollectorHourReport(diagnostics))}\n`);
    }
    if (windowElapsedMs >= WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[1].elapsedMs && !checkpoint30Handled) {
      checkpoint30Handled = true;
      if (diagnostics.persistedUnique < WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[1].minimumPersisted) forceSearchQueryRotation = true;
      process.stderr.write(`collector_watchdog_30m:${JSON.stringify(await buildCollectorHourReport(diagnostics))}\n`);
    }
    if (windowElapsedMs >= WEIXIN_CHANNELS_HOUR_MS) {
      const report = await buildCollectorHourReport(diagnostics);
      if (diagnostics.persistedUnique < 50) {
        // 停止当前低效小时窗口并立即执行无人值守修复：刷新七天候选、强制换源，
        // 然后开启新的小时窗口。不能半夜永久停到用户早上手工重启。
        process.stderr.write(`collector_watchdog_60m_remediating:${JSON.stringify(report)}\n`);
        candidates = await refreshCollectorCandidates(params.server, params.token);
        task = hydrateCollectorTask({
          task,
          candidates,
          recentlyUsed: await readRecentCollectorQueries(),
        });
        forceSearchQueryRotation = true;
      }
      if (diagnostics.persistedUnique >= 50) {
        process.stderr.write(`collector_watchdog_60m_passed:${JSON.stringify(report)}\n`);
      }
      diagnostics = createCollectorHourDiagnostics();
      windowStartedAt = Date.parse(diagnostics.windowStartedAt);
      checkpoint15Handled = false;
      checkpoint30Handled = false;
    }

    if (Date.now() - lastHeartbeatAt >= 30_000) {
      heartbeat = await heartbeatCollector(params.server, params.token, clientId);
      const recovery = await retryPendingObservations({ server: params.server, token: params.token });
      totalRecovered += recovery.persisted;
      diagnostics.persistedUnique += recovery.persistedUnique;
      diagnostics.duplicatePersistRejected += recovery.duplicatePersistRejected;
      lastHeartbeatAt = Date.now();
      if (!heartbeat.enabled) return { stopped: "capture_disabled", scanned: totalScanned, qualified: totalQualified };
      if (heartbeat.nextTask && heartbeat.nextTask.taskId !== task.taskId) {
        candidates = await refreshCollectorCandidates(params.server, params.token);
        task = hydrateCollectorTask({
          task: heartbeat.nextTask,
          candidates,
          recentlyUsed: await readRecentCollectorQueries(),
        });
        searchQueryIndex = 0;
        process.stderr.write(`search_query_pool_refreshed:${task.searchQueries.length}\n`);
      }
    }

    if (forceSearchQueryRotation && task.searchQueries.length) {
      const nextIndex = mode === "search"
        ? nextCollectorSearchQueryIndex(searchQueryIndex, task.searchQueries.length)
        : searchQueryIndex;
      const nextQuery = task.searchQueries[nextIndex]!;
      try {
        const searchResult = await openFirstSearchResult(nextQuery, params.screenshot);
        mode = "search";
        searchQueryIndex = nextIndex;
        scansOnCurrentQuery = 0;
        qualifiedOnCurrentQuery = 0;
        ocr = searchResult.ocr;
        knownVideoDurationSec = searchResult.videoDurationSec;
        await rememberCollectorQuery(nextQuery);
        forceSearchQueryRotation = false;
        process.stderr.write(`search_query_rotated:${nextQuery}:watchdog\n`);
      } catch (error) {
        searchQueryIndex = nextIndex;
        process.stderr.write(`search_query_rotation_deferred:${nextQuery}:watchdog:${error instanceof Error ? error.message : String(error)}\n`);
        // 搜索调用可能已经改变真实页面；旧播放器 OCR 此刻必定不可信。
        // 重新截图并从循环顶部走页面门禁，禁止拿旧指标继续评论或滑动。
        await captureWindow(params.screenshot);
        ocr = await readOcr(params.screenshot);
        continue;
      }
    }

    if (mode === "recommendation" && shouldSwitchRecommendationToSearch({
      startedAt: recommendationStartedAt,
      now: Date.now(),
      qualifiedCount: recommendationQualified,
      scannedCount: recommendationScanned,
    })) {
      const query = task.searchQueries[searchQueryIndex];
      if (!query) throw new Error("weixin_channels_search_queries_empty");
      try {
        const searchResult = await openFirstSearchResult(query, params.screenshot);
        mode = "search";
        scansOnCurrentQuery = 0;
        qualifiedOnCurrentQuery = 0;
        ocr = searchResult.ocr;
        knownVideoDurationSec = searchResult.videoDurationSec;
        await rememberCollectorQuery(query);
      } catch (error) {
        // 微信可能短暂停在“赞和收藏”等子页。搜索入口失败只重置采样窗，
        // 不退出常驻进程；下一轮改试下一个七天新词，禁止反复卡在同一个词。
        const failedQuery = query;
        searchQueryIndex = nextCollectorSearchQueryIndex(searchQueryIndex, task.searchQueries.length);
        recommendationStartedAt = Date.now();
        recommendationQualified = 0;
        recommendationScanned = 0;
        process.stderr.write(`search_mode_deferred:${failedQuery}:next=${task.searchQueries[searchQueryIndex] || failedQuery}:${error instanceof Error ? error.message : String(error)}\n`);
        await captureWindow(params.screenshot);
        ocr = await readOcr(params.screenshot);
        continue;
      }
    }

    // 先退出“赞和收藏”或搜索结果等辅助标签；只允许真实视频播放器进入计数。
    ocr = await ensureVideoPlayerVisible(params.screenshot, ocr);
    // 每条再关闭上一条可能残留的评论面板，并以四项互动指标重新出现作为断言。
    // 无法证明播放器状态时原地停机；禁止靠滑动“恢复”未知页面。
    try {
      ocr = await ensureInteractionMetricsVisible(params.screenshot, ocr);
      // 长时间运行也不降低门槛：四项指标必须在两张连续截图中保持一致，
      // 单次 OCR 误读不能触发达标、评论点击或滑动。
      ocr = await confirmVisibleInteractionMetrics(params.screenshot, ocr);
    } catch (error) {
      diagnostics.metricsIncomplete += 1;
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`collector_safety_stopped:player_state_unconfirmed:${reason}\n`);
      return { stopped: "player_state_unconfirmed", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
    }
    const videoIdentity = visibleVideoIdentityFingerprint(ocr);
    if (!videoIdentity) {
      diagnostics.metricsIncomplete += 1;
      process.stderr.write("collector_safety_stopped:weixin_channels_stable_identity_not_detected\n");
      return { stopped: "stable_identity_not_detected", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
    }
    const visibleIdentity = extractVisibleTitleAndAuthor(ocr.lines);
    const observationId = makeWeixinChannelsObservationId({
      taskId: task.taskId,
      title: visibleIdentity.title || "",
      author: visibleIdentity.author,
      videoIdentity,
    });
    if (collectorSeenContains(seenRegistry, videoIdentity, observationId)) {
      diagnostics.duplicateVideosSkipped += 1;
      consecutiveDuplicates += 1;
      process.stderr.write(`duplicate_visible_video_skipped:${videoIdentity}:${observationId}\n`);
      if (consecutiveDuplicates >= 3) {
        // 不继续滑同一推荐流，也不退出等人工处理；下一轮改用另一条七天热词。
        consecutiveDuplicates = 0;
        forceSearchQueryRotation = true;
        process.stderr.write("collector_duplicate_loop_rotating_source\n");
        continue;
      }
      await waitForVisibleVideoLoad();
      ocr = await advanceTracked(ocr);
      knownVideoDurationSec = undefined;
      continue;
    }
    if (inFlightVideoIdentities.has(videoIdentity)) {
      process.stderr.write("collector_safety_stopped:inflight_video_reentered\n");
      return { stopped: "inflight_video_reentered", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
    }
    consecutiveDuplicates = 0;
    inFlightVideoIdentities.add(videoIdentity);
    diagnostics.uniqueVideosSeen += 1;
    totalScanned += 1;
    if (mode === "recommendation") recommendationScanned += 1;
    else scansOnCurrentQuery += 1;
    const itemStartedAt = Date.now();
    const query = mode === "recommendation"
      ? "推荐页"
      : task.searchQueries[searchQueryIndex] || task.searchQueries[0] || "网络热点";
    const pendingOutput = path.join(os.tmpdir(), `weixin-channels-pending-${observationId}.json`);
    const retryCache: VideoCaptureRetryCache = { samplingAttempts: 0 };
    const captureCurrentVideo = (currentOcr: OcrResult) => captureVisibleQualifiedVideo({
      ocr: currentOcr,
      screenshot: params.screenshot,
      taskId: task.taskId,
      query,
      videoIdentity,
      observationId,
      diagnostics,
      probe: params.probe,
      server: params.server,
      token: params.token,
      outputOverride: pendingOutput,
      videoDurationHintSec: knownVideoDurationSec,
      retryCache,
    });
    let result!: Awaited<ReturnType<typeof captureVisibleQualifiedVideo>>;
    let captureOcr = ocr;
    let failureCount = 0;
    let stableRecoverySnapshots = 0;
    for (;;) {
      let pendingExists = false;
      try {
        await fs.access(pendingOutput);
        pendingExists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        if (pendingExists) {
          // UI 已完整采集，只在后台重传 pending，绝不再次拖动或打开评论区。
          const observation = JSON.parse(await fs.readFile(pendingOutput, "utf8"));
          const qualification = qualifyWeixinChannelsObservationLocally(observation);
          const payload = await uploadPendingObservation({
            server: params.server,
            token: params.token,
            taskId: task.taskId,
            pendingFile: pendingOutput,
            deadlineAt: Date.now() + 60_000,
          });
          result = {
            qualified: qualification.qualified,
            inspectedContent: true as const,
            reason: qualification.reason,
            fingerprint: videoIdentity,
            observation,
            persisted: payload.persisted === true,
          };
          if (payload.newlyQualifiedPersisted === true) diagnostics.persistedUnique += 1;
          else if (payload.newlyPersisted !== true) diagnostics.duplicatePersistRejected += 1;
          if (failureCount > 0) process.stderr.write(`collector_safe_retry_succeeded:attempt=${failureCount}\n`);
          break;
        } else {
          result = await captureCurrentVideo(captureOcr);
          if (failureCount > 0) process.stderr.write(`collector_safe_retry_succeeded:attempt=${failureCount}\n`);
          break;
        }
      } catch (error) {
        failureCount += 1;
        stableRecoverySnapshots = 0;
        const reason = error instanceof Error ? error.message : String(error);
        // 任一失败进入退避前都把鼠标停到独立窗左侧黑边；绝不能悬停在头像区，
        // Swift 底层同时拒绝头像禁区的 click/drag，形成双重门禁。
        await runSwiftControl(["move-relative", "0.02", "0.50"]).catch(() => undefined);
        await rememberCollectorSeen(seenRegistry, {
          videoIdentity,
          observationId,
          seenAt: new Date().toISOString(),
          state: "retryable_failed",
          failureReason: reason,
        });
        const delayMs = automaticRecoveryDelayMs(failureCount);
        process.stderr.write(`collector_automatic_recovery_waiting:attempt=${failureCount}:delayMs=${delayMs}:pending=${pendingExists}:reason=${reason}\n`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        heartbeat = await heartbeatCollector(params.server, params.token, clientId);
        if (!heartbeat.enabled) {
          inFlightVideoIdentities.delete(videoIdentity);
          return { stopped: "capture_disabled_during_recovery", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
        }
        if (pendingExists) continue;
        // 不操作播放器，只被动截图；连续两张互动指标都证明是同一视频后，才允许再次完整采集。
        while (stableRecoverySnapshots < 2) {
          await captureWindow(params.screenshot);
          let passiveOcr = await readOcr(params.screenshot);
          let sameVideo = false;
          if (!isWeixinChannelsAuxiliaryPage(passiveOcr.lines)) {
            try {
              passiveOcr = await ensureInteractionMetricsVisible(params.screenshot, passiveOcr);
              sameVideo = metricsRemainOnSameVideo(
                extractWeixinChannelsMetrics(ocr.lines),
                extractWeixinChannelsMetrics(passiveOcr.lines),
              );
            } catch {
              sameVideo = false;
            }
          }
          if (sameVideo) {
            stableRecoverySnapshots += 1;
            captureOcr = passiveOcr;
          } else {
            stableRecoverySnapshots = 0;
          }
          if (stableRecoverySnapshots < 2) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, delayMs)));
            heartbeat = await heartbeatCollector(params.server, params.token, clientId);
            if (!heartbeat.enabled) {
              inFlightVideoIdentities.delete(videoIdentity);
              return { stopped: "capture_disabled_during_recovery", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
            }
          }
        }
      }
    }
    inFlightVideoIdentities.delete(videoIdentity);
    const terminal = collectorVideoStateAfterCapture(result);
    await rememberCollectorSeen(seenRegistry, {
      videoIdentity,
      observationId,
      seenAt: new Date().toISOString(),
      state: terminal.state,
      failureReason: terminal.stopWithoutAdvance ? "qualified_not_persisted" : undefined,
    });
    if (terminal.stopWithoutAdvance) {
      process.stderr.write("collector_safety_stopped:qualified_video_not_persisted\n");
      return { stopped: "qualified_video_not_persisted", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
    }
    if (result.qualified) {
      totalQualified += 1;
      if (mode === "recommendation") recommendationQualified += 1;
      else qualifiedOnCurrentQuery += 1;
    }
    if (mode === "search") recordCollectorSearchOutcome(diagnostics, query, result.qualified);
    process.stderr.write(`collector_progress:${JSON.stringify({ scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode })}\n`);

    if (!result.qualified && !("inspectedContent" in result)) {
      const deadlineAt = itemStartedAt + WEIXIN_CHANNELS_UNQUALIFIED_DWELL_MS;
      ocr = await advanceTracked(ocr, deadlineAt);
    } else {
      ocr = await advanceTracked(ocr);
    }
    // 推荐流/搜索结果向下切换后，禁止把上一条视频的时长提示复用给下一条。
    knownVideoDurationSec = undefined;

    if (mode === "recommendation" && Date.now() - recommendationStartedAt >= WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS) {
      if (recommendationQualified >= WEIXIN_CHANNELS_RECOMMENDATION_TARGET) {
        recommendationStartedAt = Date.now();
        recommendationQualified = 0;
        recommendationScanned = 0;
      }
    } else if (mode === "search") {
      if (scansOnCurrentQuery >= WEIXIN_CHANNELS_PRECISION_SAMPLE_SIZE) {
        const rotate = shouldRotateSearchQuery({
          scannedCount: scansOnCurrentQuery,
          qualifiedCount: qualifiedOnCurrentQuery,
        }) && task.searchQueries.length > 1;
        scansOnCurrentQuery = 0;
        qualifiedOnCurrentQuery = 0;
        if (rotate) {
          const nextIndex = (searchQueryIndex + 1) % task.searchQueries.length;
          const nextQuery = task.searchQueries[nextIndex]!;
          try {
            const searchResult = await openFirstSearchResult(nextQuery, params.screenshot);
            searchQueryIndex = nextIndex;
            ocr = searchResult.ocr;
            knownVideoDurationSec = searchResult.videoDurationSec;
            await rememberCollectorQuery(nextQuery);
            process.stderr.write(`search_query_rotated:${nextQuery}:qualified_rate_below_40_percent\n`);
          } catch (error) {
            searchQueryIndex = nextIndex;
            knownVideoDurationSec = undefined;
            process.stderr.write(`search_query_rotation_deferred:${nextQuery}:${error instanceof Error ? error.message : String(error)}\n`);
            await captureWindow(params.screenshot);
            ocr = await readOcr(params.screenshot);
          }
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
  const screenshotArg = args.find((item) => item.startsWith("--screenshot="));
  const taskArg = args.find((item) => item.startsWith("--task-id="));
  const queryArg = args.find((item) => item.startsWith("--query="));
  const titleArg = args.find((item) => item.startsWith("--title="));
  const authorArg = args.find((item) => item.startsWith("--author="));
  const serverArg = args.find((item) => item.startsWith("--server="));
  const maxScannedArg = args.find((item) => item.startsWith("--max-scanned="));
  const screenshot = screenshotArg?.slice("--screenshot=".length)
    || path.join(os.tmpdir(), `weixin-channels-window-${process.pid}.png`);
  await prepareWeixinCollectorExecutables();
  if (pool) {
    if (!serverArg) throw new Error("--pool requires --server=https://...");
    const token = String(process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN || "").trim();
    if (!token) throw new Error("WEIXIN_CHANNELS_COLLECTOR_TOKEN is required for pool mode");
    const maxScanned = maxScannedArg ? Number(maxScannedArg.slice("--max-scanned=".length)) : undefined;
    const result = await runCollectionPool({
      screenshot,
      server: serverArg.slice("--server=".length).replace(/\/$/, ""),
      token,
      probe,
      maxScanned,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    // launchd 只重启临时退出；网页关采集、小时目标未达和有界探针都是有意终止。
    if (shouldLaunchdRestartCollector(String(result.stopped || ""), maxScanned)) {
      process.exitCode = 75;
    }
    return;
  }
  if (!taskArg || !queryArg || (!titleArg && !automate && !interact)) {
    throw new Error("usage: pnpm tsx scripts/weixin-channels-capture.mts [--automate|--interact|--pool] [--probe] [--screenshot=/path/window.png] [--server=https://...] [--max-scanned=N] --task-id=... --query=... [--title=...] [--author=...]");
  }
  const query = queryArg.slice("--query=".length);
  let ocr: OcrResult;
  let videoDurationHintSec: number | undefined;
  if (automate) {
    const searchResult = await openFirstSearchResult(query, screenshot);
    ocr = searchResult.ocr;
    videoDurationHintSec = searchResult.videoDurationSec;
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
  const videoIdentity = visibleVideoIdentityFingerprint(ocr);
  if (!videoIdentity) throw new Error("weixin_channels_stable_identity_not_detected");
  const extractedIdentity = extractVisibleTitleAndAuthor(ocr.lines);
  const suppliedTitle = titleArg?.slice("--title=".length) || extractedIdentity.title || "";
  const effectiveTitle = suppliedTitle || "当前视频";
  const effectiveAuthor = authorArg?.slice("--author=".length) || extractedIdentity.author;
  const result = await captureVisibleQualifiedVideo({
    ocr,
    screenshot,
    taskId,
    query,
    videoIdentity,
    observationId: makeWeixinChannelsObservationId({ taskId, title: suppliedTitle, author: effectiveAuthor, videoIdentity }),
    diagnostics: createCollectorHourDiagnostics(),
    probe,
    server: serverArg?.slice("--server=".length).replace(/\/$/, ""),
    token,
    titleOverride: effectiveTitle,
    authorOverride: effectiveAuthor,
    outputOverride: outputArg?.slice("--output=".length),
    videoDurationHintSec,
    retryCache: { samplingAttempts: 0 },
  });
  if (!result.qualified) process.stdout.write(`${JSON.stringify({ scanned: true, qualified: false, modelCalls: 0, reason: result.reason }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
