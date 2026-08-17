#!/usr/bin/env tsx
/**
 * 视频号本机采集器（第一版）：从已登录的微信视频号窗口截图 OCR，输出真实公开指标。
 * 不读取 Cookie、不调用私有接口、不点赞/关注/评论；搜索与翻页自动化单独启用。
 */
import { createHash, randomInt } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { WeixinChannelsObservation } from "../server/growth/weixinChannelsMiner";
import {
  cleanWeixinChannelsCommentTexts,
  containsWeixinChannelsAdvertisement,
  deriveWeixinChannelsSearchQueries,
  makeWeixinChannelsObservationId,
  normalizeWeixinChannelsSearchQuery,
  qualifyWeixinChannelsObservationLocally,
  weixinChannelsCaptureBudgetMs,
  WEIXIN_CHANNELS_CAPTURE_HARD_UI_ADVANCE_MS,
  WEIXIN_CHANNELS_COMMENT_THRESHOLD,
  WEIXIN_CHANNELS_HIGH_HEAT_BANDS,
  WEIXIN_CHANNELS_MAX_COMPLETE_CAPTURE_MS,
  type WeixinChannelsCommentSample,
} from "../shared/weixinChannelsRules";
import {
  buildWindowScopedControlArgs,
  buildSearchPlaybackRoutes,
  createAsyncSerialGate,
  createWeixinChannelsWindowCoordinator,
  WEIXIN_CHANNELS_MAX_TOTAL_SEARCH_TABS,
  type WeixinChannelsWindowInfo,
  type WeixinChannelsWindowSession,
} from "./weixin-channels-window-session.mts";
import {
  closeWeixinChannelsRawRun,
  commitWeixinChannelsRawItem,
  ensureWeixinChannelsRawRun,
  inspectWeixinChannelsRawSpool,
  listWeixinChannelsRawManifests,
  releaseWeixinChannelsRawSlot,
  reserveWeixinChannelsRawSlot,
  recordWeixinChannelsRawFailureEvidence,
  sealWeixinChannelsRawRun,
  updateWeixinChannelsRawManifest,
  verifyWeixinChannelsRawAsset,
  writeWeixinChannelsRawRunSummary,
  type WeixinChannelsRawManifest,
  type WeixinChannelsRawAssetKind,
  type WeixinChannelsRawRunState,
  type WeixinChannelsRawSource,
} from "./weixin-channels-raw-spool.mts";
import { decideWeixinChannelsRawOfflineItem } from "./weixin-channels-raw-filter.mts";

const execFileAsync = promisify(execFile);
const FORMAL_STOP_REQUEST_FILE = "/private/tmp/mvstudiopro-weixin-channels-local-stop.request";
const FORMAL_STOP_STATUS_FILE = "/private/tmp/mvstudiopro-weixin-channels-floating-status.json";
const COLLECTOR_CHILD_RESTART_REQUEST_FILE = "/private/tmp/mvstudiopro-weixin-channels-child-restart.request";

type CollectorFloatingStatus = {
  state: "collecting" | "stopping";
  sessionNew: number;
  formalQualifiedTotal?: number;
  rawCaptured?: number;
  updatedAt: string;
};

export function nextCollectorFloatingCounts(
  current: Pick<CollectorFloatingStatus, "sessionNew" | "formalQualifiedTotal">,
  event: Pick<WeixinChannelsPersistedObservationEvent, "runKind" | "newlyQualifiedPersisted">,
) {
  if (event.runKind !== "formal" || !event.newlyQualifiedPersisted) return current;
  return {
    sessionNew: current.sessionNew + 1,
    formalQualifiedTotal: current.formalQualifiedTotal === undefined
      ? undefined
      : current.formalQualifiedTotal + 1,
  };
}

async function writeCollectorFloatingStatus(status: CollectorFloatingStatus) {
  const temporary = `${FORMAL_STOP_STATUS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(status)}\n`, { mode: 0o600 });
  await fs.rename(temporary, FORMAL_STOP_STATUS_FILE);
}

async function removeCollectorFloatingStatus() {
  await fs.unlink(FORMAL_STOP_STATUS_FILE).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

async function launchCollectorFloatingControl() {
  const executable = await getFloatingControlExecutable();
  return spawn(executable, [
    String(process.pid),
    FORMAL_STOP_REQUEST_FILE,
    FORMAL_STOP_STATUS_FILE,
  ], {
    stdio: "ignore",
  });
}

async function collectorLocalStopRequested() {
  try {
    await fs.access(FORMAL_STOP_REQUEST_FILE);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function persistCollectorLocalStopRequest(server: string, token: string) {
  let failureLogged = false;
  while (await collectorLocalStopRequested()) {
    try {
      const response = await fetch(`${server.replace(/\/$/, "")}/api/internal/weixin-channels/stop`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-weixin-channels-collector-token": token,
        },
        body: JSON.stringify({
          clientId: `mac-weixin-${os.hostname()}`.slice(0, 120),
          source: "floating_control",
        }),
        signal: AbortSignal.timeout(WEIXIN_CHANNELS_HTTP_CONTROL_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`local_stop_failed:${response.status}:${text.slice(0, 300)}`);
      const payload = JSON.parse(text) as { capture?: { enabled?: boolean } };
      if (payload.capture?.enabled !== false) throw new Error("local_stop_not_confirmed");
      await fs.unlink(FORMAL_STOP_REQUEST_FILE);
      await removeCollectorFloatingStatus();
      process.stderr.write("collector_floating_stop_persisted\n");
      return;
    } catch (error) {
      if (!failureLogged) {
        process.stderr.write(`collector_floating_stop_retrying:${
          error instanceof Error ? error.message : String(error)
        }\n`);
        failureLogged = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

export const WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS = 10 * 60_000;
export const WEIXIN_CHANNELS_RECOMMENDATION_TARGET = 5;
// 正常切页会在首帧确认后立即返回；4 秒仅是新视频首帧/指标迟到时的异常上限。
// 不能把整个“判断 + 滑动”压进 2 秒，否则 OCR 已完成时切页预算已耗尽，
// 右窗会误报 next_video_not_visible 并停在恢复循环。
export const WEIXIN_CHANNELS_UNQUALIFIED_DWELL_MS = 4_000;
/** 评论首屏加两次向下翻页，共读取三屏。 */
export const WEIXIN_CHANNELS_COMMENT_PANEL_SCREEN_COUNT = 3;
export const WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
/** raw 机械采集也必须给每条视频留出正常观看节奏，禁止连续高速刷页。 */
export const WEIXIN_CHANNELS_RAW_VIDEO_DWELL_MIN_MS = 10_000;
export const WEIXIN_CHANNELS_RAW_VIDEO_DWELL_MAX_MS = 15_000;
/** 到点后只允许当前原子 UI 动作收尾；禁止异常窗口无限拖住封批。 */
export const WEIXIN_CHANNELS_RAW_ROTATION_GRACE_MS = 60_000;
/** 任一窗口连续两次失败即重启整个双窗采集子进程。 */
export const WEIXIN_CHANNELS_RAW_MAX_CONSECUTIVE_FAILURES = 2;
/** 三分钟无提交/换页由外部 watchdog 强制回收整个双窗采集子进程。 */
export const WEIXIN_CHANNELS_WINDOW_LOCAL_RESET_MS = 3 * 60_000;
export const WEIXIN_CHANNELS_RAW_WINDOW_STALL_TIMEOUT_MS = WEIXIN_CHANNELS_WINDOW_LOCAL_RESET_MS;
export function collectorWindowLocalResetRequired(lastCommitOrAdvanceAtMs: number, nowMs = Date.now()) {
  return Number.isFinite(lastCommitOrAdvanceAtMs)
    && nowMs - lastCommitOrAdvanceAtMs > WEIXIN_CHANNELS_WINDOW_LOCAL_RESET_MS;
}
/** 单个外部动作必须自行超时，否则一次 Swift/截图/OCR 卡死会占住全局 FIFO。 */
export const WEIXIN_CHANNELS_UI_COMMAND_TIMEOUT_MS = 5_000;
export const WEIXIN_CHANNELS_SCREENSHOT_TIMEOUT_MS = 5_000;
export const WEIXIN_CHANNELS_REALTIME_OCR_TIMEOUT_MS = 8_000;
export const WEIXIN_CHANNELS_BATCH_OCR_TIMEOUT_MS = 60_000;
export const WEIXIN_CHANNELS_HTTP_CONTROL_TIMEOUT_MS = 15_000;
export const WEIXIN_CHANNELS_SWIFT_COMPILE_TIMEOUT_MS = 120_000;
export const WEIXIN_CHANNELS_PRECISION_SAMPLE_SIZE = 10;
export const WEIXIN_CHANNELS_MIN_QUALIFIED_RATE = 0.4;

export function remainingWeixinChannelsRawVideoDwellMs(
  startedAtMs: number,
  nowMs: number,
  targetMs: number,
) {
  const boundedTargetMs = Math.max(
    WEIXIN_CHANNELS_RAW_VIDEO_DWELL_MIN_MS,
    Math.min(WEIXIN_CHANNELS_RAW_VIDEO_DWELL_MAX_MS, Math.round(targetMs)),
  );
  return Math.max(0, boundedTargetMs - Math.max(0, nowMs - startedAtMs));
}

export function shouldUseWeixinChannelsSearchAtHour(hour: number, dayOfWeek: number) {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  return Number.isInteger(hour)
    && Number.isInteger(dayOfWeek)
    && dayOfWeek >= 0
    && dayOfWeek <= 6
    && !isWeekend
    && hour >= 0
    && hour < 6;
}

/**
 * 播放器刚切页时的 OCR/身份短暂缺失不等于窗口故障。保留同窗短退避，
 * 让下一帧重新确认；黑屏或持续同内容仍由诊断熔断处理。
 */
export function collectorWindowRecoveryDelayMs(reason: string, restart: number, deadlineAt?: number) {
  const isTransientPlayerFrame = /(?:player_state_unconfirmed|stable_identity_not_detected|recovery_continuity_unconfirmed|advance_recovery_exhausted)/
    .test(reason);
  const delayMs = isTransientPlayerFrame ? 1_250 : automaticRecoveryDelayMs(restart);
  return deadlineAt === undefined ? delayMs : Math.min(10_000, delayMs);
}

export function resolveCollectorWindowStartupMode(params: {
  isRightSearchWindow: boolean;
  hour: number;
  dayOfWeek: number;
  startupQualified: boolean;
  restart: number;
}) {
  const searchScheduled = params.isRightSearchWindow
    && shouldUseWeixinChannelsSearchAtHour(params.hour, params.dayOfWeek);
  return {
    captureCurrentBeforeSearch: searchScheduled && params.startupQualified,
    startInSearch: searchScheduled && !params.startupQualified && params.restart === 0,
  };
}
export const WEIXIN_CHANNELS_SEEN_TTL_MS = 7 * 24 * 60 * 60_000;
export const WEIXIN_CHANNELS_SEARCH_FRESHNESS_DAYS = 15;
// 搜索卡片播放量只负责候选召回，最终是否达标仍由播放器四项硬门决定。
// “最热门”数千播放的卡片也可能有爆款互动，不能在结果页先误杀。
export const WEIXIN_CHANNELS_SEARCH_HIGH_PLAY_THRESHOLD = 1_000;
/** 用户要求单条 UI 采集必须在 30–35 秒内结束；Fly 上传由后台批量链承担。 */
export const WEIXIN_CHANNELS_UNKNOWN_DURATION_CAPTURE_BUDGET_MS = 35_000;
export const WEIXIN_CHANNELS_CURRENT_VIDEO_HARD_UI_ADVANCE_MS = WEIXIN_CHANNELS_CAPTURE_HARD_UI_ADVANCE_MS;

export function collectorCurrentVideoUiDisposition(startedAtMs: number, nowMs = Date.now()) {
  const elapsedMs = nowMs - startedAtMs;
  if (elapsedMs > WEIXIN_CHANNELS_CURRENT_VIDEO_HARD_UI_ADVANCE_MS) return "hard_retreat" as const;
  if (elapsedMs > WEIXIN_CHANNELS_UNKNOWN_DURATION_CAPTURE_BUDGET_MS) return "soft_retreat" as const;
  return "continue" as const;
}

function assertCurrentVideoUiCanContinue(hardAdvanceAtMs: number) {
  if (Date.now() > hardAdvanceAtMs) {
    throw new Error("weixin_channels_current_video_ui_hard_advance_limit_reached");
  }
}
/** 打开评论前必须完整预留三屏读取、专用关闭和同视频恢复时间。 */
export const WEIXIN_CHANNELS_COMMENT_CAPTURE_MIN_BUDGET_MS = 10_000;
/** 无 pending 时同一视频最多自动补做一次 UI；第二次失败必须退出本轮。 */
export const WEIXIN_CHANNELS_MAX_SAME_VIDEO_UI_FAILURES = 2;
export type WeixinChannelsCaptureActivity = {
  observationId: string;
  videoIdentity: string;
  windowId: number;
  ownerPid: number;
  stage: "capture" | "upload_pending" | "recovery" | "window_stall_180s";
  startedAtMs: number;
  updatedAtMs: number;
};
export const WEIXIN_CHANNELS_HOUR_MS = 60 * 60_000;
export const WEIXIN_CHANNELS_HOURLY_UNIQUE_TARGET = 101;
export const WEIXIN_CHANNELS_MAX_PASSIVE_RECOVERY_SNAPSHOTS = 4;
export const WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS = [
  { elapsedMs: 15 * 60_000, minimumPersisted: 25 },
  { elapsedMs: 30 * 60_000, minimumPersisted: 50 },
] as const;
/** 2026-08-14 在动态 483×769 / 966×1538 窗口均实测命中顶栏放大镜。 */
// 440×769 双窗布局实截图中，顶栏方框搜索按钮中心为 x≈0.765、y≈0.026；
// x≈0.60 落在“视频号”标签内部，只会切换标签而不会打开搜索。
export const WEIXIN_CHANNELS_SEARCH_BUTTON_POINT = { x: 0.765, y: 0.026 } as const;
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
  if (elapsedMs >= WEIXIN_CHANNELS_HOUR_MS) {
    return persistedUnique < WEIXIN_CHANNELS_HOURLY_UNIQUE_TARGET ? "remediate" as const : "rollover" as const;
  }
  if (elapsedMs >= WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[1].elapsedMs
    && persistedUnique < WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[1].minimumPersisted) return "checkpoint_30" as const;
  if (elapsedMs >= WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[0].elapsedMs
    && persistedUnique < WEIXIN_CHANNELS_WATCHDOG_CHECKPOINTS[0].minimumPersisted) return "checkpoint_15" as const;
  return "continue" as const;
}

export function nextCollectorSearchQueryIndex(currentIndex: number, queryCount: number) {
  return queryCount > 1 ? (currentIndex + 1) % queryCount : currentIndex;
}

export function nextWeixinChannelsRawFailureCount(
  current: number,
  event: "failure" | "video_advanced",
) {
  return event === "video_advanced" ? 0 : Math.max(0, Math.floor(current)) + 1;
}

export function shouldRestartWeixinChannelsRawChild(consecutiveFailures: number) {
  return consecutiveFailures >= WEIXIN_CHANNELS_RAW_MAX_CONSECUTIVE_FAILURES;
}

export function nextRawCommittedVideoRepetition(
  previousVideoIdentity: string | undefined,
  previousCount: number,
  currentVideoIdentity: string | undefined,
) {
  const current = currentVideoIdentity?.trim();
  if (!current) return { videoIdentity: undefined, count: 0, blocked: false };
  const count = current === previousVideoIdentity
    ? Math.max(0, Math.floor(previousCount)) + 1
    : 1;
  return { videoIdentity: current, count, blocked: count >= 2 };
}

export type WeixinChannelsRawWindowProgress = {
  version: 1;
  windowId: number;
  ownerPid: number;
  state: "started" | "raw_capture_committed" | "video_advanced" | "global_restart_requested";
  rawId?: string;
  updatedAtMs: number;
};

export type CollectorWindowFailureStage =
  | "progress_locate"
  | "comments_close"
  | "page_transition"
  | "player_restore"
  | "unknown";

export type CollectorWindowErrorCode =
  | "progress_unavailable"
  | "comments_close_button_not_recognized"
  | "comments_close_click_not_effective"
  | "comments_player_restore_unconfirmed"
  | "page_transition_unconfirmed"
  | "window_binding_missing"
  | "player_structure_not_restored"
  | "window_stall_180s"
  | "ui_hard_retreat_reset_required"
  | "unknown";

export type CollectorWindowResetFailure = {
  resetAt: string;
  failedAt: string;
  stage: CollectorWindowFailureStage;
  errorClassification: CollectorWindowErrorCode;
  screenshotPath?: string;
  ocrEvidencePath?: string;
};

export type CollectorWindowResetFailureState = {
  version: 1;
  windowIndex: number;
  windowId: number;
  pid: number;
  failures: CollectorWindowResetFailure[];
  updatedAt: string;
};

export function classifyCollectorWindowFailureStage(reason: string): CollectorWindowFailureStage {
  if (/progress_(?:track|playhead)|content_sampling/.test(reason)) return "progress_locate";
  if (/comments_(?:close|panel|player_verification)|player_not_restored_after_comments/.test(reason)) {
    return "comments_close";
  }
  if (/(?:next_video|advance|transition|repeated_same_(?:video|frame))/.test(reason)) return "page_transition";
  if (/(?:player|auxiliary_page|window)/.test(reason)) return "player_restore";
  return "unknown";
}

export function classifyCollectorWindowErrorCode(reason: string): CollectorWindowErrorCode {
  const normalized = String(reason || "");
  if (/progress_(?:track|playhead)_not_found/.test(normalized)) return "progress_unavailable";
  if (/comments_close_(?:button_)?(?:not_found|not_recognized)/.test(normalized)) {
    return "comments_close_button_not_recognized";
  }
  if (/comments_close_click_not_effective/.test(normalized)) return "comments_close_click_not_effective";
  if (/player_not_restored_after_comments|comments_closed_player_verification_unconfirmed/.test(normalized)) {
    return "comments_player_restore_unconfirmed";
  }
  if (/repeated_same_(?:video|frame)/.test(normalized)
    || /(?:next_video|advance|transition).*(?:unconfirmed|not_detected|failed)/.test(normalized)) {
    return "page_transition_unconfirmed";
  }
  if (/window_binding.*(?:missing|lost)|window_not_found/.test(normalized)) return "window_binding_missing";
  if (/player.*not_restored|player_structure/.test(normalized)) return "player_structure_not_restored";
  if (/local_window_stall_180s|window_stall_180s/.test(normalized)) return "window_stall_180s";
  if (/ui_hard_retreat_reset_required|current_video_ui_hard_advance_limit/.test(normalized)) {
    return "ui_hard_retreat_reset_required";
  }
  return "unknown";
}

export function nextCollectorWindowResetFailureState(
  previous: CollectorWindowResetFailureState | undefined,
  binding: Pick<CollectorWindowResetFailureState, "windowIndex" | "windowId" | "pid">,
  failure: CollectorWindowResetFailure,
) {
  const resetAt = Date.parse(failure.resetAt);
  const failedAt = Date.parse(failure.failedAt);
  const countsAsConsecutive = Number.isFinite(resetAt)
    && Number.isFinite(failedAt)
    && failedAt >= resetAt
    && failedAt - resetAt <= WEIXIN_CHANNELS_WINDOW_LOCAL_RESET_MS;
  const sameBinding = previous?.windowId === binding.windowId && previous.pid === binding.pid;
  const failures = countsAsConsecutive
    ? [...(sameBinding ? previous!.failures : []), failure].slice(-3)
    : [];
  return {
    version: 1,
    ...binding,
    failures,
    updatedAt: failure.failedAt,
  } satisfies CollectorWindowResetFailureState;
}

export function buildCollectorWindowResetDiagnostic(params: {
  state: CollectorWindowResetFailureState;
  nowMs: number;
  lastSameVideoAtMs: number;
  lastCommitAtMs: number;
  lastAdvanceAtMs: number;
}) {
  if (params.state.failures.length < 3) return null;
  const stages = params.state.failures.map((item) => item.stage);
  const stateMachineStages = new Set(["progress_locate", "comments_close", "page_transition"]);
  const codeStageCount = stages.filter((stage) => stateMachineStages.has(stage)).length;
  const environmentCount = params.state.failures.filter((item) => (
    /(?:window_binding_missing|player_structure_not_restored)/.test(item.errorClassification)
  )).length;
  const codeChangeAssessment = codeStageCount >= 2
    ? "likely_code_state_machine" as const
    : environmentCount >= 2
      ? "likely_page_or_account_environment" as const
      : "indeterminate" as const;
  const dominantStage = stages[stages.length - 1] || "unknown";
  const recommendedCaptureMethod = dominantStage === "progress_locate"
    ? "single_progress_probe_then_skip_current_video"
    : dominantStage === "comments_close"
      ? "stop_both_windows_clear_transient_cache_restart_collector"
      : dominantStage === "page_transition"
        ? "stop_both_windows_after_two_failed_advances_then_restart_collector"
        : "inspect_window_state_before_global_collector_restart";
  const latest = params.state.failures[params.state.failures.length - 1]!;
  return {
    event: "weixin_channels_window_reset_diagnostic" as const,
    windowIndex: params.state.windowIndex,
    windowId: params.state.windowId,
    pid: params.state.pid,
    resetTimes: params.state.failures.map((item) => item.resetAt),
    failureTimes: params.state.failures.map((item) => item.failedAt),
    stages,
    errorClassifications: params.state.failures.map((item) => item.errorClassification),
    currentScreenshotPath: latest.screenshotPath,
    currentOcrEvidencePath: latest.ocrEvidencePath,
    sameVideoAgeMs: Math.max(0, params.nowMs - params.lastSameVideoAtMs),
    lastCommitAgeMs: Math.max(0, params.nowMs - params.lastCommitAtMs),
    lastAdvanceAgeMs: Math.max(0, params.nowMs - params.lastAdvanceAtMs),
    code_change_assessment: codeChangeAssessment,
    recommended_capture_method: recommendedCaptureMethod,
  };
}

function collectorWindowResetFailureStateFile(windowId: number) {
  return path.join(os.tmpdir(), `mvstudiopro-weixin-channels-reset-failures-${windowId}.json`);
}

async function persistCollectorWindowResetFailureState(state: CollectorWindowResetFailureState) {
  const file = collectorWindowResetFailureStateFile(state.windowId);
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function loadCollectorWindowResetFailureState(
  binding: Pick<CollectorWindowResetFailureState, "windowIndex" | "windowId" | "pid">,
) {
  try {
    const parsed = JSON.parse(await fs.readFile(
      collectorWindowResetFailureStateFile(binding.windowId),
      "utf8",
    )) as CollectorWindowResetFailureState;
    if (parsed.version !== 1 || parsed.windowId !== binding.windowId || parsed.pid !== binding.pid) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    return undefined;
  }
}

async function clearCollectorWindowResetFailureState(windowId: number) {
  await fs.unlink(collectorWindowResetFailureStateFile(windowId)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

export function collectorRawWindowProgressFile(windowId: number, tempDir = os.tmpdir()) {
  if (!Number.isInteger(windowId) || windowId <= 0) {
    throw new Error("weixin_channels_raw_progress_window_invalid");
  }
  return path.join(tempDir, `mvstudiopro-weixin-channels-raw-progress-${windowId}.json`);
}

export async function writeCollectorRawWindowProgress(params: {
  windowId: number;
  state: WeixinChannelsRawWindowProgress["state"];
  rawId?: string;
  tempDir?: string;
}) {
  const progress: WeixinChannelsRawWindowProgress = {
    version: 1,
    windowId: params.windowId,
    ownerPid: process.pid,
    state: params.state,
    rawId: params.rawId,
    updatedAtMs: Date.now(),
  };
  const file = collectorRawWindowProgressFile(params.windowId, params.tempDir);
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(progress)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

export function collectorCaptureActivityFile(windowId: number, tempDir = os.tmpdir()) {
  if (!Number.isInteger(windowId) || windowId <= 0) throw new Error("weixin_channels_capture_activity_window_invalid");
  return path.join(tempDir, `mvstudiopro-weixin-channels-active-capture-${windowId}.json`);
}

export function collectorCaptureActivityIsOverdue(
  activity: Pick<WeixinChannelsCaptureActivity, "startedAtMs"> & Partial<Pick<WeixinChannelsCaptureActivity, "stage">>,
  nowMs = Date.now(),
) {
  return activity.stage !== "upload_pending"
    && Number.isFinite(activity.startedAtMs)
    && nowMs - activity.startedAtMs > WEIXIN_CHANNELS_WINDOW_LOCAL_RESET_MS;
}

async function writeCollectorCaptureActivity(
  activity: WeixinChannelsCaptureActivity,
) {
  const file = collectorCaptureActivityFile(activity.windowId);
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(activity)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
  return file;
}

async function beginCollectorCaptureActivity(params: {
  observationId: string;
  videoIdentity: string;
  windowId: number;
}) {
  const file = collectorCaptureActivityFile(params.windowId);
  const now = Date.now();
  let startedAtMs = now;
  try {
    const existing = JSON.parse(await fs.readFile(file, "utf8")) as WeixinChannelsCaptureActivity;
    if (existing.observationId === params.observationId
      && existing.ownerPid === process.pid
      && Number.isFinite(existing.startedAtMs)
      && existing.startedAtMs <= now) {
      startedAtMs = existing.startedAtMs;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  const activity: WeixinChannelsCaptureActivity = {
    ...params,
    ownerPid: process.pid,
    stage: "capture",
    startedAtMs,
    updatedAtMs: now,
  };
  await writeCollectorCaptureActivity(activity);
  process.stderr.write(`collector_video_capture_started:${JSON.stringify(activity)}\n`);
  return activity;
}

async function updateCollectorCaptureActivity(
  activity: WeixinChannelsCaptureActivity,
  stage: WeixinChannelsCaptureActivity["stage"],
) {
  activity.stage = stage;
  activity.updatedAtMs = Date.now();
  await writeCollectorCaptureActivity(activity);
}

async function finishCollectorCaptureActivity(activity: WeixinChannelsCaptureActivity) {
  const elapsedMs = Date.now() - activity.startedAtMs;
  if (activity.stage !== "upload_pending"
    && elapsedMs > WEIXIN_CHANNELS_WINDOW_LOCAL_RESET_MS) {
    await updateCollectorCaptureActivity(activity, "window_stall_180s");
    process.stderr.write(`collector_window_stall_180s:${JSON.stringify({
      ...activity,
      elapsedMs,
      localResetThresholdMs: WEIXIN_CHANNELS_WINDOW_LOCAL_RESET_MS,
    })}\n`);
    throw new Error("weixin_channels_local_window_stall_180s");
  }
  const file = collectorCaptureActivityFile(activity.windowId);
  try {
    const current = JSON.parse(await fs.readFile(file, "utf8")) as WeixinChannelsCaptureActivity;
    if (current.observationId === activity.observationId) await fs.unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  process.stderr.write(`collector_video_capture_activity_finished:${JSON.stringify({
    observationId: activity.observationId,
    windowId: activity.windowId,
    elapsedMs,
  })}\n`);
}

async function failCollectorCaptureActivity(
  activity: WeixinChannelsCaptureActivity,
  reason: string,
) {
  const file = collectorCaptureActivityFile(activity.windowId);
  try {
    const current = JSON.parse(await fs.readFile(file, "utf8")) as WeixinChannelsCaptureActivity;
    if (current.observationId === activity.observationId) await fs.unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  process.stderr.write(`collector_video_capture_failed:${JSON.stringify({
    observationId: activity.observationId,
    windowId: activity.windowId,
    elapsedMs: Date.now() - activity.startedAtMs,
    reason,
  })}\n`);
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

function deadlineBoundedTimeoutMs(defaultTimeoutMs: number, deadlineAt?: number) {
  const remaining = remainingBudgetMs(deadlineAt);
  if (remaining <= 0) throw new Error("weixin_channels_capture_time_budget_exhausted");
  return Math.max(1, Math.min(defaultTimeoutMs, Math.floor(remaining)));
}

function assertCaptureDeadline(deadlineAt?: number) {
  if (remainingBudgetMs(deadlineAt) <= 0) {
    throw new Error("weixin_channels_capture_time_budget_exhausted");
  }
}

export function hasMinimumCommentCaptureBudget(deadlineAt: number, now = Date.now()) {
  return deadlineAt - now >= WEIXIN_CHANNELS_COMMENT_CAPTURE_MIN_BUDGET_MS;
}

export function collectorCaptureFailureAction(params: {
  reason: string;
  failureCount: number;
  pendingExists: boolean;
}) {
  // pending 已经证明 UI 全部结束，只需继续网络补传，绝不能重新操作播放器。
  if (params.pendingExists) return "retry_pending_upload" as const;
  // 进度条定位是单帧门禁：未命中就把已有数据收尾并滑下一条，左右窗都不得
  // 在同一视频重新点击、重新悬停或进入被动恢复循环。
  if (isWeixinChannelsProgressTrackUnavailable(params.reason)) {
    return "advance_progress_unavailable" as const;
  }
  if (/weixin_channels_(?:raw_)?comments_/.test(params.reason)
    || /player_not_restored_after_comments/.test(params.reason)) {
    return "advance_comments_unavailable" as const;
  }
  if (/weixin_channels_(?:capture_time_budget_(?:exhausted|exceeded)|single_video_capture_hard_timeout)/
    .test(params.reason)) {
    return "advance_ui_soft_limit" as const;
  }
  if (/weixin_channels_current_video_ui_hard_advance_limit_reached/.test(params.reason)) {
    return "advance_ui_soft_limit" as const;
  }
  if (/weixin_channels_current_video_ui_soft_retreat_reached/.test(params.reason)) {
    return "advance_ui_soft_limit" as const;
  }
  return params.failureCount >= WEIXIN_CHANNELS_MAX_SAME_VIDEO_UI_FAILURES
    ? "stop_ui_retry_exhausted" as const
    : "retry_ui_once" as const;
}

export function isWeixinChannelsProgressTrackUnavailable(reason: string) {
  return /weixin_channels_progress_(?:track|playhead)_not_found/.test(String(reason || ""));
}

export function shouldDeferCollectorUploads(params: {
  probe: boolean;
  maxScanned?: number;
  maxQualified?: number;
  deadlineAt?: number;
}) {
  return !params.probe
    && params.maxScanned === undefined
    && params.maxQualified === undefined
    && params.deadlineAt === undefined;
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

/** 页面切换先短等，再由调用方用 OCR 主动确认；不再无条件浪费 2–3 秒。 */
export async function waitForVisibleVideoLoad() {
  const delayMs = randomInt(450, 901);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return delayMs;
}

export function findSearchInputPoint(lines: OcrLine[]): { x: number; y: number } | null {
  const candidates = lines.filter((line) =>
    line.confidence >= 0.35
      && /(搜一搜|搜索|搜尋|输入网址|輸入網址)/i.test(line.text)
      && line.y >= 0.72
      && line.x < 0.75,
  );
  const hit = candidates.sort((left, right) => right.width - left.width)[0];
  if (hit) return { x: hit.x + Math.min(hit.width / 2, 0.08), y: 1 - (hit.y + hit.height / 2) };
  // 已有关键词时输入框不再显示“搜一搜”，只能由同一行右侧搜索按钮反推输入区。
  const button = lines.find((line) => line.confidence >= 0.35
    && /^(搜索|搜尋)$/.test(line.text.trim()) && line.x >= 0.75 && line.y >= 0.78);
  return button
    ? { x: Math.max(0.18, button.x - 0.42), y: 1 - (button.y + button.height / 2) }
    : null;
}

export function findSearchSubmitPoint(lines: OcrLine[]): { x: number; y: number } | null {
  const hit = lines
    .filter((line) => line.confidence >= 0.35 && /^(搜索|搜尋)$/.test(line.text.trim()))
    .filter((line) => line.x >= 0.72 && line.y >= 0.78 && line.y <= 0.94)
    .sort((left, right) => right.x - left.x)[0];
  return hit ? clickPoint(hit) : null;
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

export function hasSubmittedSearchKeyword(lines: OcrLine[], keyword: string) {
  const target = normalizeSearchTopicText(keyword);
  return lines.some((line) => line.confidence >= 0.25
    && line.y >= 0.82
    && line.y <= 0.94
    && normalizeSearchTopicText(line.text).includes(target));
}

export function findSearchVideosTabPoint(lines: OcrLine[]): { x: number; y: number } | null {
  const hit = lines
    .filter((line) => line.confidence >= 0.35 && /^(影片|视频|視頻)$/.test(line.text.trim()))
    // 440px 右窗中“影片”中心约为 x=0.69；旧上限 0.65 会把真实按钮拒绝，
    // 导致页面一直停在“全部”。水平导航滚动后位置还会继续右移。
    .filter((line) => line.y >= 0.72 && line.y <= 0.9 && line.x >= 0.3 && line.x <= 0.82)
    .sort((left, right) => Math.abs(left.x - 0.68) - Math.abs(right.x - 0.68))[0];
  return hit ? clickPoint(hit) : null;
}

export function findChannelsTabPoint(lines: OcrLine[]): { x: number; y: number } | null {
  const hit = lines
    .filter((line) => line.confidence >= 0.25
      && /^(?:[xX×✕])?(?:视频号|視頻號|视频|視頻|视|視)(?:[xX×✕])?$/.test(line.text.replace(/\s+/g, "")))
    .filter((line) => line.y >= 0.90 && line.x >= 0.30 && line.x <= 0.62)
    .sort((left, right) => left.x - right.x)[0];
  return hit ? {
    // Vision 会把“视频号 + X”合并或只识别出“视×”。只点文字左侧，
    // 并把纵坐标夹在窗口顶栏文字带内，绝不取含 X 整行的中心。
    x: Math.max(0.30, Math.min(0.49, hit.x + Math.min(0.015, hit.width * 0.2))),
    y: Math.max(0.02, Math.min(0.05, 1 - (hit.y + hit.height / 2))),
  } : null;
}

/**
 * 顶栏搜索入口不使用窗口绝对坐标。Vision 通常把放大镜识别为 Q/O；识别
 * 不到时，以同排“视频号”标签关闭符号为锚点，按当前字体高度推导相邻按钮。
 */
export function findSearchButtonPoint(lines: OcrLine[]): { x: number; y: number } | null {
  const glyph = lines
    .filter((line) => line.confidence >= 0.18 && /^(?:Q|O|0|🔍)$/.test(line.text.trim()))
    .filter((line) => line.y >= 0.94 && line.x >= 0.62 && line.x <= 0.9)
    .sort((left, right) => right.x - left.x)[0];
  if (glyph) return clickPoint(glyph);

  const channels = lines
    .filter((line) => line.confidence >= 0.3 && /^(?:[xX×✕])?(?:视频号|視頻號)$/.test(line.text.trim()))
    .filter((line) => line.y >= 0.94 && line.x >= 0.25 && line.x <= 0.65)
    .sort((left, right) => left.x - right.x)[0];
  if (!channels) return null;
  const close = lines
    .filter((line) => line.confidence >= 0.15 && /^(?:x|X|×|✕)$/.test(line.text.trim()))
    .filter((line) => Math.abs((line.y + line.height / 2) - (channels.y + channels.height / 2))
      <= Math.max(0.02, channels.height))
    .filter((line) => line.x > channels.x + channels.width && line.x <= 0.8)
    .sort((left, right) => left.x - right.x)[0];
  if (!close) return null;
  const fontUnit = Math.max(channels.height, close.height, 0.018);
  return {
    x: Math.min(0.92, close.x + close.width / 2 + fontUnit * 3.4),
    y: 1 - (channels.y + channels.height / 2),
  };
}

export function findAnySearchTabPoint(lines: OcrLine[]): { x: number; y: number } | null {
  const hit = lines
    .filter((line) => line.confidence >= 0.25 && line.y >= 0.90 && line.x >= 0.54 && line.x <= 0.70)
    .filter((line) => {
      const text = line.text.normalize("NFKC").replace(/\s+/g, "");
      // Vision 会把“视频号 + X”合并成“视×/视频号×”。这些都属于主标签，
      // 绝不能当作搜索标签点击，否则会关闭或切走采集窗口。
      return text.length > 0
        && !/^[xX×✕]$/.test(text)
        && !/^(?:视|視|視頻?號|视频号|視頻號)[xX×✕]?$/.test(text);
    })
    .sort((left, right) => left.x - right.x)[0];
  return hit ? {
    // Vision 常把“搜索词 + X”合成一行；只点文字左侧，永不取整行中心。
    x: Math.max(0.54, Math.min(0.64, hit.x + Math.min(0.02, hit.width * 0.2))),
    y: Math.max(0.02, Math.min(0.05, 1 - (hit.y + hit.height / 2))),
  } : null;
}

export function findSearchTabClosePoint(lines: OcrLine[]): { x: number; y: number } | null {
  const hit = lines
    .filter((line) => line.confidence >= 0.2 && /^[xX×]$/.test(line.text.trim()))
    .filter((line) => line.y >= 0.935)
    .map(clickPoint)
    // 与 Swift click-confirmed-search-tab-close 的硬门保持完全一致。
    .filter((point) => point.x >= 0.66 && point.x <= 0.72 && point.y >= 0.005 && point.y <= 0.065)
    .sort((left, right) => right.x - left.x)[0];
  return hit || null;
}

/**
 * 仅识别用户确认的“赞和收藏”个人数据页。一个标题不足以放行关闭动作，
 * 必须同时出现至少两个侧栏身份项，避免把普通视频字幕或搜索结果误判成异常页。
 */
export function isWeixinChannelsPersonalDataPage(lines: OcrLine[]) {
  const text = lines
    .filter((line) => line.confidence >= 0.25)
    .map((line) => line.text.normalize("NFKC").replace(/\s+/g, "").trim());
  const hasTitle = text.some((value) => /^(赞和收藏|讚和收藏)$/.test(value));
  const navigationSignals = [
    /^(浏览记录|瀏覽記錄)$/,
    /^(关注|關注)$/,
    /^(我的视频号|我的視頻號)$/,
    /^(发表视频|發表視頻)$/,
    /^(发起直播|發起直播)$/,
  ];
  const matchedSignals = navigationSignals.filter((pattern) => text.some((value) => pattern.test(value))).length;
  return hasTitle && matchedSignals >= 2;
}

/**
 * 关闭点只能在严格确认个人数据页后产生。优先读取 OCR 的 X；若 Vision 漏读 X，
 * 则由同排的异常标签文字或“视频号”标签动态推导，不使用屏幕绝对坐标。
 */
export function findPersonalDataTabClosePoint(lines: OcrLine[]): { x: number; y: number } | null {
  if (!isWeixinChannelsPersonalDataPage(lines)) return null;
  const explicitClose = lines
    .filter((line) => line.confidence >= 0.18 && /^(?:x|X|×|✕)$/.test(line.text.trim()))
    .filter((line) => line.y >= 0.935 && line.x >= 0.60 && line.x <= 0.76)
    .sort((left, right) => right.x - left.x)[0];
  if (explicitClose) return clickPoint(explicitClose);
  const auxiliaryTab = lines
    .filter((line) => line.confidence >= 0.2 && line.y >= 0.94 && line.x >= 0.54 && line.x <= 0.70)
    .filter((line) => /^(?:赞|讚|赞和收藏|讚和收藏)$/.test(line.text.replace(/[xX×✕\s]/g, "")))
    .sort((left, right) => right.x - left.x)[0];
  if (auxiliaryTab) {
    return {
      x: Math.max(0.60, Math.min(0.76, auxiliaryTab.x + auxiliaryTab.width + 0.025)),
      y: 1 - (auxiliaryTab.y + auxiliaryTab.height / 2),
    };
  }
  const channelsTab = findChannelsTabPoint(lines);
  if (!channelsTab) return null;
  return { x: Math.max(0.60, Math.min(0.76, channelsTab.x + 0.205)), y: channelsTab.y };
}

export function findSearchTabActivationPoint(lines: OcrLine[], keyword: string): { x: number; y: number } | null {
  const normalize = (value: string) => value.normalize("NFKC").replace(/[\s，,。.!！?？]/g, "").toLowerCase();
  const target = normalize(keyword);
  const hit = lines
    .filter((line) => line.confidence >= 0.3 && line.y >= 0.94 && line.x >= 0.54 && line.x <= 0.82)
    .filter((line) => {
      const value = normalize(line.text).replace(/[xX×]$/, "");
      return value.length >= 1 && (target.startsWith(value) || value.startsWith(target.slice(0, Math.min(2, target.length))));
    })
    .sort((left, right) => left.x - right.x)[0];
  return hit ? clickPoint(hit) : null;
}

export function findSearchSortPoint(lines: OcrLine[], sort: "latest" | "hottest") {
  const pattern = sort === "latest" ? /^(最新)$/ : /^(最热门|最熱門)$/;
  const hit = lines
    .filter((line) => line.confidence >= 0.35 && pattern.test(line.text.trim()))
    .filter((line) => line.y >= 0.68 && line.y <= 0.86)
    .sort((left, right) => right.y - left.y)[0];
  return hit ? clickPoint(hit) : null;
}

export function parseVisiblePublicationAgeDays(text: string, now = Date.now()): number | undefined {
  const value = String(text || "").trim();
  if (/^(刚刚|剛剛|今天|今日|\d+\s*(分钟|分鐘|小时|小時)前)$/.test(value)) return 0;
  if (/^(昨天|昨日)$/.test(value)) return 1;
  if (/^前天$/.test(value)) return 2;
  const relative = value.match(/^(\d+)\s*(天|周|週|个月|個月|月|年)前$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    return amount * (unit === "天" ? 1 : /周|週/.test(unit!) ? 7 : /月/.test(unit!) ? 30 : 365);
  }
  const absolute = value.match(/^(20\d{2})[./年-](\d{1,2})[./月-](\d{1,2})日?$/);
  if (absolute) {
    const publishedAt = new Date(Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3])).getTime();
    if (Number.isFinite(publishedAt) && publishedAt <= now) return Math.floor((now - publishedAt) / 86_400_000);
  }
  return undefined;
}

function normalizeSearchTopicText(value: string) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s，,。.!！?？:：'“”"·…#@｜|/\\【】\[\]（）()《》]/g, "");
}

export type WeixinChannelsSearchSortSummary = {
  matchingCount: number;
  recentMatchingCount: number;
  newestMatchingAgeDays: number | undefined;
  maxVisiblePlayCount: number;
  recentHighPlayCount: number;
  firstRecentHighPlayPoint: { x: number; y: number } | undefined;
  firstHighPlayPoint: { x: number; y: number } | undefined;
  firstMatchingPoint: { x: number; y: number } | undefined;
  firstRecentHighPlayAgeDays?: number;
  firstHighPlayAgeDays?: number;
  firstMatchingAgeDays?: number;
};

export function summarizeSearchSort(
  lines: OcrLine[],
  keyword: string,
  now = Date.now(),
): WeixinChannelsSearchSortSummary {
  void keyword;
  const records = lines.flatMap((dateLine) => {
    const ageDays = parseVisiblePublicationAgeDays(dateLine.text, now);
    if (ageDays === undefined || dateLine.y < 0.02 || dateLine.y > 0.68) return [];
    const leftColumn = dateLine.x < 0.5;
    const cardText = lines
      .filter((line) => (leftColumn ? line.x < 0.5 : line.x >= 0.48))
      .filter((line) => line.y >= dateLine.y && line.y <= dateLine.y + 0.42)
      .map((line) => line.text)
      .join(" ");
    const normalizedCard = normalizeSearchTopicText(cardText);
    const visiblePlayCount = Math.max(0, ...lines
      .filter((line) => (leftColumn ? line.x < 0.5 : line.x >= 0.48))
      .filter((line) => line.y >= dateLine.y && line.y <= dateLine.y + 0.2)
      .map((line) => parseStandaloneMetric(line.text) || 0));
    return [{
      ageDays,
      visiblePlayCount,
      // 微信已按输入词返回结果；这里不再二次 OCR 匹配标题，只以发布日期
      // 和广告标记筛选卡片，点入播放器后再读取四项真实指标。
      matchesTopic: true,
      advertisement: containsWeixinChannelsAdvertisement([cardText]),
      point: {
        x: leftColumn ? Math.max(0.16, dateLine.x + 0.2) : Math.min(0.84, dateLine.x + 0.2),
        y: Math.max(0.22, Math.min(0.68, 1 - dateLine.y - 0.24)),
      },
    }];
  });
  const matching = records.filter((record) => record.matchesTopic && !record.advertisement);
  const firstRecentHighPlay = matching
    .filter((record) => record.ageDays <= WEIXIN_CHANNELS_SEARCH_FRESHNESS_DAYS
      && record.visiblePlayCount >= WEIXIN_CHANNELS_SEARCH_HIGH_PLAY_THRESHOLD)
    .sort((left, right) => right.visiblePlayCount - left.visiblePlayCount)[0];
  const firstHighPlay = matching
    .filter((record) => record.visiblePlayCount >= WEIXIN_CHANNELS_SEARCH_HIGH_PLAY_THRESHOLD)
    .sort((left, right) => right.visiblePlayCount - left.visiblePlayCount)[0];
  const firstMatching = matching.sort((left, right) => left.ageDays - right.ageDays)[0];
  return {
    matchingCount: matching.length,
    recentMatchingCount: matching.filter((record) => record.ageDays <= WEIXIN_CHANNELS_SEARCH_FRESHNESS_DAYS).length,
    newestMatchingAgeDays: matching.length ? Math.min(...matching.map((record) => record.ageDays)) : undefined,
    maxVisiblePlayCount: matching.length ? Math.max(...matching.map((record) => record.visiblePlayCount)) : 0,
    recentHighPlayCount: matching.filter((record) => record.ageDays <= WEIXIN_CHANNELS_SEARCH_FRESHNESS_DAYS
      && record.visiblePlayCount >= WEIXIN_CHANNELS_SEARCH_HIGH_PLAY_THRESHOLD).length,
    firstRecentHighPlayPoint: firstRecentHighPlay?.point,
    firstHighPlayPoint: firstHighPlay?.point,
    firstMatchingPoint: firstMatching?.point,
    firstRecentHighPlayAgeDays: firstRecentHighPlay?.ageDays,
    firstHighPlayAgeDays: firstHighPlay?.ageDays,
    firstMatchingAgeDays: firstMatching?.ageDays,
  };
}

export function mergeSearchSortSummaries(
  summaries: WeixinChannelsSearchSortSummary[],
): WeixinChannelsSearchSortSummary {
  const newestMatchingAgeDays = summaries
    .map((summary) => summary.newestMatchingAgeDays)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right)[0];
  return {
    matchingCount: summaries.reduce((sum, summary) => sum + summary.matchingCount, 0),
    recentMatchingCount: summaries.reduce((sum, summary) => sum + summary.recentMatchingCount, 0),
    newestMatchingAgeDays,
    maxVisiblePlayCount: Math.max(0, ...summaries.map((summary) => summary.maxVisiblePlayCount)),
    recentHighPlayCount: summaries.reduce((sum, summary) => sum + summary.recentHighPlayCount, 0),
    firstRecentHighPlayPoint: summaries.find((summary) => summary.firstRecentHighPlayPoint)?.firstRecentHighPlayPoint,
    firstHighPlayPoint: summaries.find((summary) => summary.firstHighPlayPoint)?.firstHighPlayPoint,
    firstMatchingPoint: summaries.find((summary) => summary.firstMatchingPoint)?.firstMatchingPoint,
    firstRecentHighPlayAgeDays: summaries.find((summary) => summary.firstRecentHighPlayPoint)
      ?.firstRecentHighPlayAgeDays,
    firstHighPlayAgeDays: summaries.find((summary) => summary.firstHighPlayPoint)
      ?.firstHighPlayAgeDays,
    firstMatchingAgeDays: summaries.find((summary) => summary.firstMatchingPoint)
      ?.firstMatchingAgeDays,
  };
}

/** 只能使用当前可见最热门页的坐标；合并历史页坐标不得用于点击。 */
export function selectCurrentHottestSearchResultPoint(
  currentPage: WeixinChannelsSearchSortSummary,
) {
  return currentPage.firstHighPlayPoint || null;
}

export function planSearchResultSelection(params: {
  latestCurrentPage: WeixinChannelsSearchSortSummary;
  hottestCurrentPage?: WeixinChannelsSearchSortSummary;
}) {
  if (params.latestCurrentPage.firstRecentHighPlayPoint) {
    return {
      action: "open" as const,
      sourceSort: "latest" as const,
      point: params.latestCurrentPage.firstRecentHighPlayPoint,
    };
  }
  if (!params.hottestCurrentPage) return { action: "inspect_hottest" as const };
  if (params.hottestCurrentPage.firstHighPlayPoint) {
    return {
      action: "open" as const,
      sourceSort: "hottest" as const,
      point: params.hottestCurrentPage.firstHighPlayPoint,
    };
  }
  return { action: "return_to_recommendation" as const };
}

export function shouldReturnToRecommendationAfterSearchError(reason: string) {
  return /^(?:weixin_channels_search_(?:keyword_rejected|videos_tab_not_confirmed|video_sorts_not_confirmed|sort_controls_not_restored|topic_has_no_high_play_video))$/.test(reason);
}

export function assessSearchTopicHeat(params: {
  latest: WeixinChannelsSearchSortSummary;
  hottest: WeixinChannelsSearchSortSummary;
}) {
  const outdated = params.hottest.matchingCount > 0 && params.hottest.recentMatchingCount === 0;
  return {
    outdated,
    highHeat: !outdated
      && params.latest.recentHighPlayCount > 0
      && params.hottest.recentHighPlayCount > 0,
  };
}

export function shouldExpireSearchTopic(params: {
  latest: WeixinChannelsSearchSortSummary;
  hottest: WeixinChannelsSearchSortSummary;
  latestQualified: boolean;
}) {
  if (!params.latest.recentMatchingCount) return true;
  return !params.latestQualified
    && params.hottest.matchingCount > 0
    && (params.hottest.newestMatchingAgeDays || 0) > WEIXIN_CHANNELS_SEARCH_FRESHNESS_DAYS;
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

function normalizeDedupIdentityText(value: string | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?:展开|展開)$/g, "")
    .replace(/[\s，,。.!！?？:：'“”"·…⋯#@]+/g, "")
    .slice(0, 160);
}

/**
 * 历史去重身份不能包含会自然增长的互动数字。标题取稳定前缀以容忍“展开”，
 * 作者单独参与；两者都不可读时 fail-closed，不用指标拼出伪稳定 ID。
 */
export function dedupIdentityFingerprint(ocr: OcrResult) {
  const identity = extractVisibleTitleAndAuthor(ocr.lines);
  const title = normalizeDedupIdentityText(identity.title);
  const author = normalizeDedupIdentityText(identity.author);
  if (!title || !author) return undefined;
  return createHash("sha256").update(JSON.stringify({
    title,
    author,
  })).digest("hex");
}

/** 兼容既有调用名；语义已明确为历史去重身份。 */
export const visibleVideoIdentityFingerprint = dedupIdentityFingerprint;

function clickPoint(line: OcrLine) {
  return { x: line.x + line.width / 2, y: 1 - (line.y + line.height / 2) };
}

export function findCommentsOpenPoint(lines: OcrLine[]) {
  const label = lines
    .filter((line) => line.confidence >= 0.35 && /^(评论|評論)$/.test(line.text.trim()))
    .filter((line) => line.x >= 0.82 && line.y < 0.2)
    .sort((left, right) => left.y - right.y)[0];
  if (label) return clickPoint(label);
  const slots = assignBottomMetricSlots(lines);
  if (!slots.likes || !slots.shares || !slots.favorites || !slots.comments) return null;
  // 必须先由同一底部横排证明四项槽位；只点击真实评论数字所在行，
  // 禁止把收藏、头像或固定坐标误当作评论入口。
  return clickPoint(slots.comments.line);
}

export function shouldOpenVisibleComments(lines: OcrLine[]) {
  if (!hasFourVisibleMetrics(lines)) return false;
  const metrics = extractWeixinChannelsMetrics(lines);
  const qualification = qualifyWeixinChannelsObservationLocally({
    ...metrics,
    ocrTexts: metrics.rawText,
  });
  return qualification.qualified && qualification.requiresComments;
}

export function rawCommentsCaptureDisposition(
  lines: OcrLine[],
  softRetreatAt: number,
  now = Date.now(),
) {
  if (!shouldOpenVisibleComments(lines)) return "skipped_not_required" as const;
  if (now > softRetreatAt) return "skipped_budget" as const;
  return "capture_required" as const;
}

export function isWeixinChannelsAuxiliaryPage(lines: OcrLine[]) {
  const text = lines.filter((line) => line.confidence >= 0.25).map((line) => line.text.trim());
  const hasLikesCollectionNavigation = text.some((value) => /^(赞和收藏|讚和收藏)$/.test(value))
    && text.some((value) => /^(浏览记录|瀏覽記錄|我的视频号|我的視頻號|发表视频|發表視頻)$/.test(value));
  const hasSearchNavigation = text.some((value) => /^(全部)$/.test(value))
    && text.some((value) => /^(影片|视频|視頻)$/.test(value))
    && text.some((value) => /^(问答|問答|文章|底线|底線|眼见|眼見|直播|最新|最热门|最熱門)$/.test(value));
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
  const title = findCommentsPanelTitle(lines);
  if (!title) return null;
  const sameRow = lines.filter((line) => Math.abs((line.y + line.height / 2) - (title.y + title.height / 2)) <= Math.max(title.height, 0.04));
  const closeGlyph = sameRow
    .filter((line) => /^(×|x|X|✕|关闭|關閉)$/.test(line.text.trim()) && line.x > title.x)
    .sort((left, right) => right.x - left.x)[0];
  if (closeGlyph) return clickPoint(closeGlyph);
  return null;
}

/** 评论标题本身就是抽屉仍打开的证据；不能用底部入口是否被 OCR 识别来反推。 */
export function findCommentsPanelTitle(lines: OcrLine[]) {
  return lines
    .filter((line) => line.confidence >= 0.25
      && /^(评论|評論)(?:\s*\d+(?:\.\d+)?(?:万|萬|w|W)?)?$/.test(line.text.trim())
      // Vision OCR 的 y 是 bottom-origin：抽屉 header 在上方 y≈.86–.93；
      // 播放器底部“评论”入口在 y≈.03。没有此几何门会把已关闭抽屉误判为仍开。
      && line.y >= 0.75
      && line.x >= 0.02
      && line.x <= 0.65)
    .sort((left, right) => right.y - left.y)[0];
}

export type RawCommentsPanelRecovery =
  | "panel_still_visible"
  | "closed_confirmed"
  | "player_structure_not_restored";

/**
 * 关闭验证只接受三种互斥结论。评论入口图标会被控件、字幕或 OCR 漏帧遮住，
 * 因而不能作为“已恢复”的必要条件。
 */
export function classifyRawCommentsPanelRecovery(base: OcrResult, current: OcrResult): RawCommentsPanelRecovery {
  if (findCommentsPanelTitle(current.lines)) return "panel_still_visible";
  if (isWeixinChannelsAuxiliaryPage(current.lines)) return "player_structure_not_restored";
  return commentsPanelClosedOnSameVideo(base, current)
    ? "closed_confirmed"
    : "player_structure_not_restored";
}

async function recoverRawPlayerAfterCaptureDeadline(
  screenshot: string,
  playerBeforeComments: OcrResult,
) {
  // 35 秒之后不再采集素材；这里只做当前窗口的安全复位。先移出控制层，
  // 随后每次都以当前帧重新定位 X，绝不盲点头像或影响另一窗口。
  await runSwiftControl(["move-relative", "0.02", "0.50"]).catch(() => undefined);
  let clickedClose = false;
  let current = playerBeforeComments;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 120 + attempt * 100));
    await captureWindow(screenshot);
    current = await readOcr(screenshot);
    const recovery = classifyRawCommentsPanelRecovery(playerBeforeComments, current);
    if (recovery === "closed_confirmed") return current;
    if (recovery === "panel_still_visible") {
      const closePoint = await findCommentsClosePointFromScreenshot(screenshot, current.lines);
      if (!closePoint) {
        throw new Error("weixin_channels_raw_comments_close_button_not_recognized");
      }
      clickedClose = true;
      await runSwiftControl([
        "click-confirmed-comments-close",
        closePoint.x.toFixed(5),
        closePoint.y.toFixed(5),
      ]);
      continue;
    }
  }
  throw new Error(clickedClose
    ? "weixin_channels_raw_comments_close_click_not_effective"
    : "weixin_channels_raw_comments_closed_player_verification_unconfirmed");
}

async function findCommentsClosePointFromScreenshot(screenshot: string, lines: OcrLine[]) {
  const ocrPoint = findCommentsClosePoint(lines);
  if (ocrPoint) return ocrPoint;
  const title = findCommentsPanelTitle(lines);
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

async function closeConfirmedCommentsPanel(screenshot: string, lines: OcrLine[], deadlineAt?: number) {
  const closePoint = await findCommentsClosePointFromScreenshot(screenshot, lines);
  if (!closePoint) return false;
  await runSwiftControl([
    "click-confirmed-comments-close",
    closePoint.x.toFixed(5),
    closePoint.y.toFixed(5),
  ], deadlineAt);
  return true;
}

export function hasFourVisibleMetrics(lines: OcrLine[]) {
  const metrics = extractWeixinChannelsMetrics(lines);
  return [metrics.likes, metrics.shares, metrics.favorites, metrics.comments].every((value) => value !== undefined);
}

export function hasDefinitiveVisibleUnqualifiedMetrics(lines: OcrLine[]) {
  const metrics = extractWeixinChannelsMetrics(lines);
  const knownBelowThreshold = [
    metrics.likes !== undefined && metrics.likes < WEIXIN_CHANNELS_HIGH_HEAT_BANDS.likes.min,
    metrics.shares !== undefined && metrics.shares < WEIXIN_CHANNELS_HIGH_HEAT_BANDS.shares.min,
    metrics.favorites !== undefined && metrics.favorites < WEIXIN_CHANNELS_HIGH_HEAT_BANDS.favorites.min,
  ].filter(Boolean).length;
  // 高热门槛要求三项至少两项达标；两项已明确低于门槛时，缺失项无论多高
  // 都不可能改变结论，因此可安全淘汰，不必为了第四项 OCR 原地死等。
  return knownBelowThreshold >= 2;
}

export function interactionMetricsConfirmed(first: OcrResult, second: OcrResult) {
  return hasFourVisibleMetrics(first.lines)
    && hasFourVisibleMetrics(second.lines)
    && sameVideoContinuity(first, second);
}

/**
 * 评论抽屉关闭后的画面必须同时恢复四项指标，并仍由打开评论前的指标/身份
 * 证明是同一视频。只看到任意四个数字不够，否则推荐流自动切页时会把旧视频
 * 的评论与新视频的播放器状态混在一起。
 */
export function commentsPanelClosedOnSameVideo(base: OcrResult, closed: OcrResult) {
  return hasFourVisibleMetrics(closed.lines) && sameVideoContinuity(base, closed);
}

export function sampledCapturePersistenceDisposition(params: {
  advertisementDetected: boolean;
  qualified: boolean;
}) {
  return params.advertisementDetected || !params.qualified
    ? "reject_without_persist" as const
    : "persist" as const;
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
let floatingControlExecutablePromise: Promise<string> | undefined;
type CollectorSearchTabState = { windowId: number; openedTabs: number; ownerPid?: number; updatedAt: string };
const collectorSearchTabStates = new Map<number, CollectorSearchTabState>();
const collectorWindowContext = new AsyncLocalStorage<WeixinChannelsWindowSession>();
const collectorUiGate = createAsyncSerialGate();
// Fly 单机处理封面时，两窗同时 POST 会把同一实例拖到客户端超时；UI 可以并行等待，
// 但上传必须 FIFO。排队时间不计入单次 HTTP 超时，真实请求开始后才启动计时。
const collectorUploadGate = createAsyncSerialGate();
let collectorWindowScopeRequired = false;

function requireCollectorWindowSession() {
  const session = collectorWindowContext.getStore();
  if (!session) throw new Error("weixin_channels_window_context_required");
  return session;
}

async function getCollectorSearchTabState() {
  const { windowId } = requireCollectorWindowSession();
  let state = collectorSearchTabStates.get(windowId);
  if (!state) {
    state = await loadCollectorSearchTabState(windowId);
    collectorSearchTabStates.set(windowId, state);
  }
  return state;
}

function totalCollectorSearchTabs() {
  return Array.from(collectorSearchTabStates.values())
    .reduce((total, state) => total + state.openedTabs, 0);
}

function processIsAlive(pid: number | undefined) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function collectorSearchTabStateFile(windowId: number, tempDir = os.tmpdir()) {
  return path.join(tempDir, `weixin-channels-search-tabs-v2-${windowId}.json`);
}

type CollectorSearchCalibration = {
  windowId: number;
  pid: number;
  point: { x: number; y: number };
  calibratedAt: string;
  scope?: "probe" | "formal";
  /**
   * 网页采集开关每次停/开都会递增。只有同一控制版本内的二十分钟子进程
   * 轮换才允许复用；恢复采集后必须让左右窗各自重新校准。
   */
  controlRevision?: number;
};

function collectorSearchCalibrationFile(session: WeixinChannelsWindowSession, tempDir = os.tmpdir()) {
  return path.join(
    tempDir,
    `weixin-channels-search-calibration-v1-${session.pid}-${session.windowId}.json`,
  );
}

export function collectorCalibrationRevisionMatches(
  savedRevision: number | undefined,
  requiredRevision: number | undefined,
) {
  return requiredRevision === undefined || savedRevision === requiredRevision;
}

export function collectorCalibrationCoversExactDualWindows(
  sessionWindowIds: number[],
  calibratedWindowIds: number[],
) {
  const expected = Array.from(new Set(sessionWindowIds)).sort((left, right) => left - right);
  const actual = Array.from(new Set(calibratedWindowIds)).sort((left, right) => left - right);
  return expected.length === 2
    && actual.length === 2
    && expected.every((windowId, index) => actual[index] === windowId);
}

async function loadCollectorSearchCalibration(
  requiredScope?: "formal",
  requiredControlRevision?: number,
) {
  const session = requireCollectorWindowSession();
  try {
    const parsed = JSON.parse(
      await fs.readFile(collectorSearchCalibrationFile(session), "utf8"),
    ) as CollectorSearchCalibration;
    if (parsed.windowId !== session.windowId
      || parsed.pid !== session.pid
      || (requiredScope && parsed.scope !== requiredScope)
      || !collectorCalibrationRevisionMatches(parsed.controlRevision, requiredControlRevision)
      || parsed.point.x < 0.55
      || parsed.point.x > 0.9
      || parsed.point.y < 0.005
      || parsed.point.y > 0.075) return null;
    return parsed.point;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function calibrateCollectorSearchButton(
  session: WeixinChannelsWindowSession,
  label: string,
  scope: "probe" | "formal" = "probe",
  controlRevision?: number,
) {
  return collectorWindowContext.run(session, async () => {
    const { stdout } = await runSwiftControl(["calibrate-point", label]);
    const point = JSON.parse(stdout) as { x?: number; y?: number };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x! < 0.55 || point.x! > 0.9
      || point.y! < 0.005 || point.y! > 0.075) {
      throw new Error("weixin_channels_search_calibration_invalid");
    }
    const calibration: CollectorSearchCalibration = {
      windowId: session.windowId,
      pid: session.pid,
      point: { x: point.x!, y: point.y! },
      calibratedAt: new Date().toISOString(),
      scope,
      controlRevision,
    };
    const file = collectorSearchCalibrationFile(session);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(calibration, null, 2), "utf8");
    await fs.rename(temporary, file);
    process.stderr.write(`search_button_calibrated:${JSON.stringify(calibration)}\n`);
    return calibration.point;
  });
}

async function calibrateCollectorSearchButtonsForSessions(
  sessions: WeixinChannelsWindowSession[],
  options: { formal?: boolean; force?: boolean; controlRevision?: number } = {},
) {
  if (options.formal && sessions.length !== 2) {
    throw new Error("weixin_channels_formal_calibration_requires_exact_two_windows");
  }
  collectorWindowScopeRequired = true;
  const points: Array<{ windowId: number; point: { x: number; y: number } }> = [];
  for (const session of [...sessions].sort((left, right) => left.bounds.x - right.bounds.x)) {
    const saved = options.force
      ? null
      : await collectorWindowContext.run(
        session,
        () => loadCollectorSearchCalibration(
          options.formal ? "formal" : undefined,
          options.controlRevision,
        ),
      );
    const point = saved || await calibrateCollectorSearchButton(
      session,
      `${session.slot === 1 ? "左窗" : "右窗"}：请点击顶部方框放大镜`,
      options.formal ? "formal" : "probe",
      options.controlRevision,
    );
    if (saved) {
      process.stderr.write(`search_button_calibration_reused:${JSON.stringify({
        windowId: session.windowId,
        pid: session.pid,
        point,
      })}\n`);
    }
    points.push({ windowId: session.windowId, point });
  }
  if (options.formal && !collectorCalibrationCoversExactDualWindows(
    sessions.map((session) => session.windowId),
    points.map((item) => item.windowId),
  )) {
    throw new Error("weixin_channels_dual_window_calibration_incomplete");
  }
  if (options.formal) {
    process.stderr.write(`dual_window_search_calibration_complete:${JSON.stringify({
      windowIds: points.map((item) => item.windowId),
      controlRevision: options.controlRevision,
      forced: Boolean(options.force),
    })}\n`);
  }
  return points;
}

export async function calibrateDualWindowSearchButtons(windowIds: number[]) {
  await prepareWeixinCollectorExecutables();
  const sessions = await discoverCollectorWindowSessions(windowIds);
  if (sessions.length !== 2) throw new Error("weixin_channels_dual_window_probe_requires_two_windows");
  return calibrateCollectorSearchButtonsForSessions(sessions);
}

export async function inspectSearchCalibrationOnWindow(params: {
  windowId: number;
  keyword: string;
  screenshot: string;
}) {
  await prepareWeixinCollectorExecutables();
  const sessions = await discoverCollectorWindowSessions([params.windowId]);
  const session = sessions[0];
  if (!session) throw new Error("weixin_channels_required_window_not_found");
  collectorWindowScopeRequired = true;
  collectorSearchTabStates.set(
    session.windowId,
    await loadCollectorSearchTabState(session.windowId),
  );
  return collectorWindowContext.run(session, async () => {
    const result = await searchKeyword(params.keyword, params.screenshot);
    return {
      windowId: session.windowId,
      keyword: params.keyword,
      latest: result.latest,
      hottest: result.hottest,
      heat: assessSearchTopicHeat({ latest: result.latest, hottest: result.hottest }),
    };
  });
}

export async function loadCollectorSearchTabState(windowId: number, tempDir = os.tmpdir(), now = Date.now()) {
  try {
    const parsed = JSON.parse(await fs.readFile(collectorSearchTabStateFile(windowId, tempDir), "utf8")) as CollectorSearchTabState;
    if (parsed.windowId === windowId && now - Date.parse(parsed.updatedAt) <= WEIXIN_CHANNELS_SEEN_TTL_MS) {
      return { ...parsed, openedTabs: Math.max(0, Math.min(1, Math.floor(parsed.openedTabs || 0))) };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // 单窗口 v1 只在 windowId 完全一致时迁移，绝不能把左窗标签数套到右窗。
    try {
      const legacy = JSON.parse(await fs.readFile(path.join(tempDir, "weixin-channels-search-tabs-v1.json"), "utf8")) as CollectorSearchTabState;
      if (legacy.windowId === windowId && now - Date.parse(legacy.updatedAt) <= WEIXIN_CHANNELS_SEEN_TTL_MS) {
        return { ...legacy, openedTabs: Math.max(0, Math.min(1, Math.floor(legacy.openedTabs || 0))) };
      }
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") throw legacyError;
    }
  }
  // 当前窗口已经由 ensureVideoPlayerVisible 证明是播放器，基线只占推荐页一个标签。
  return { windowId, openedTabs: 0, ownerPid: undefined, updatedAt: new Date(now).toISOString() };
}

async function persistCollectorSearchTabState(state: CollectorSearchTabState, tempDir = os.tmpdir()) {
  state.updatedAt = new Date().toISOString();
  const file = collectorSearchTabStateFile(state.windowId, tempDir);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, file);
}

export type CollectorVideoState =
  | "in_flight"
  | "persisted"
  | "pending_upload"
  | "terminal_unqualified"
  | "retryable_failed"
  | "unsafe_ui_state";

export function collectorVideoStateAfterCapture(result: {
  qualified: boolean;
  persisted?: boolean;
  queuedForUpload?: boolean;
}) {
  if (result.qualified && result.persisted !== true && result.queuedForUpload !== true) {
    return { state: "retryable_failed" as const, stopWithoutAdvance: true };
  }
  return {
    state: result.persisted === true
      ? "persisted" as const
      : result.queuedForUpload === true
        ? "pending_upload" as const
        : "terminal_unqualified" as const,
    stopWithoutAdvance: false,
  };
}

export type CollectorAdvanceEvidence = {
  metricsOcrConfirmed: boolean;
  advertisementRejected?: boolean;
  terminalDuplicate?: boolean;
  unqualifiedInFlightDuplicate?: boolean;
  captureState?: CollectorVideoState;
};

export function collectorAdvanceAllowed(evidence: CollectorAdvanceEvidence) {
  if (!evidence.metricsOcrConfirmed) return false;
  return evidence.advertisementRejected === true
    || evidence.terminalDuplicate === true
    || evidence.unqualifiedInFlightDuplicate === true
    || evidence.captureState === "persisted"
    || evidence.captureState === "pending_upload"
    || evidence.captureState === "terminal_unqualified";
}

export function qualifiedCaptureHasAdvanceEvidence(result: {
  qualified: boolean;
  persisted?: boolean;
  queuedForUpload?: boolean;
  observation?: Record<string, unknown>;
}) {
  if (!result.qualified) return true;
  if ((result.persisted !== true && result.queuedForUpload !== true) || !result.observation) return false;
  const qualification = qualifyWeixinChannelsObservationLocally(result.observation);
  return !qualification.requiresComments
    || (Array.isArray(result.observation.commentSamples)
      && result.observation.commentSamples.length > 0);
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
    const state = entry.state === "persisted"
      || entry.state === "pending_upload"
      || entry.state === "terminal_unqualified"
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
  const terminal = entry?.state === "persisted"
    || entry?.state === "pending_upload"
    || entry?.state === "terminal_unqualified";
  return terminal || Boolean(observationId && registry.observationIds.has(observationId));
}

export function automaticRecoveryDelayMs(failureCount: number) {
  return Math.min(5 * 60_000, 5_000 * (2 ** Math.max(0, Math.min(6, failureCount - 1))));
}

export function isCollectorWindowBindingFailure(reason: string) {
  return /weixin_channels_(?:window_not_found|required_window_not_found|window_binding|windows_pid_mismatch)/
    .test(String(reason || ""));
}

export function collectorBoundWindowPresent(
  windows: WeixinChannelsWindowInfo[],
  session: Pick<WeixinChannelsWindowSession, "windowId" | "pid">,
) {
  return windows.some((window) => window.windowId === session.windowId && window.pid === session.pid);
}

async function collectorWindowBindingMissingPersistently(session: WeixinChannelsWindowSession) {
  const executable = await getControlExecutable();
  // AX/CGWindow 在评论抽屉关闭动画期间偶尔会返回一次空结果。连续三次都找不到
  // 原 windowId+PID 才交给外层重绑；任一次重新出现就按瞬态 UI 错误恢复。
  for (const delayMs of [0, 180, 420]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const { stdout } = await execFileAsync(executable, ["windows"], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: WEIXIN_CHANNELS_UI_COMMAND_TIMEOUT_MS,
      });
      const windows = JSON.parse(stdout) as WeixinChannelsWindowInfo[];
      if (collectorBoundWindowPresent(windows, session)) return false;
    } catch {
      // 读取失败也必须经过完整三次确认，不能一次异常就终止双窗。
    }
  }
  return true;
}

export function shouldLaunchdRestartCollector(stopped: string, maxScanned?: number, maxQualified?: number) {
  return maxScanned === undefined
    && maxQualified === undefined
    && !stopped.startsWith("capture_disabled")
    && stopped !== "dual_window_fail_closed";
}

export type CollectorRecoveryState = {
  consecutiveBlackScreens: number;
  consecutiveSameContent: number;
  lastIdentityByWindow: Record<string, string>;
  lastStopReason?: string;
  updatedAt: string;
};

export function nextCollectorRecoveryState(
  previous: CollectorRecoveryState,
  evidence: { allBlack: boolean; allSameContent: boolean; identities: Record<string, string>; stopReason: string },
  now = Date.now(),
) {
  const sameContentEligible = /(?:next_video_not_visible|advance_recovery_exhausted|persistent_same_content)/
    .test(evidence.stopReason);
  const state: CollectorRecoveryState = {
    consecutiveBlackScreens: evidence.allBlack ? previous.consecutiveBlackScreens + 1 : 0,
    consecutiveSameContent: evidence.allSameContent && sameContentEligible
      ? previous.consecutiveSameContent + 1
      : 0,
    lastIdentityByWindow: evidence.identities,
    lastStopReason: evidence.stopReason,
    updatedAt: new Date(now).toISOString(),
  };
  const fuseReason = state.consecutiveBlackScreens >= 3
    ? "persistent_black_screen" as const
    : state.consecutiveSameContent >= 3
      ? "persistent_same_content" as const
      : undefined;
  return { state, fuseReason };
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
    const moduleCache = path.join(os.tmpdir(), "mvstudiopro-swift-module-cache");
    await fs.mkdir(moduleCache, { recursive: true });
    const compilerArgs = [script, "-o", temporary];
    // 始终使用 xcode-select 当前 Swift 工具链配套 SDK。固定旧 SDK 会在系统
    // 升级后出现 swiftinterface 版本不匹配，导致 launchd 每轮启动都编译失败。
    const compilerOptions = {
      maxBuffer: 20 * 1024 * 1024,
      timeout: WEIXIN_CHANNELS_SWIFT_COMPILE_TIMEOUT_MS,
      env: { ...process.env, CLANG_MODULE_CACHE_PATH: moduleCache },
    };
    try {
      await execFileAsync("/usr/bin/swiftc", compilerArgs, compilerOptions);
    } catch (primaryError) {
      // CommandLineTools 更新有时会让 MacOSX.sdk 指向与当前 swiftc 小版本不配套的 SDK。
      // 依次尝试本机保留的具名 SDK；当前机器的 6.2 编译器与 26.0 SDK 已实编验证。
      const compatibilitySdks = [
        "/Library/Developer/CommandLineTools/SDKs/MacOSX26.0.sdk",
        "/Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk",
        "/Library/Developer/CommandLineTools/SDKs/MacOSX12.1.sdk",
      ];
      let compiled = false;
      for (const compatibilitySdk of compatibilitySdks) {
        try {
          await fs.access(compatibilitySdk);
          await execFileAsync("/usr/bin/swiftc", [
            "-sdk", compatibilitySdk,
            "-target", "arm64-apple-macosx12.0",
            ...compilerArgs,
          ], compilerOptions);
          compiled = true;
          break;
        } catch {
          // 当前 SDK 不兼容时继续尝试下一份已安装 SDK。
        }
      }
      if (!compiled) throw primaryError;
    }
    await fs.rename(temporary, executable).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await fs.unlink(temporary).catch(() => undefined);
    });
  }
  return executable;
}

async function runSwiftControl(args: string[], deadlineAt?: number) {
  const session = collectorWindowContext.getStore();
  if (collectorWindowScopeRequired && !session) {
    throw new Error("weixin_channels_unscoped_ui_action_blocked");
  }
  const scopedArgs = session ? buildWindowScopedControlArgs(session, args) : args;
  return collectorUiGate.run(async () => {
    assertCaptureDeadline(deadlineAt);
    const executable = await getControlExecutable();
    try {
      return await execFileAsync(executable, scopedArgs, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: deadlineBoundedTimeoutMs(WEIXIN_CHANNELS_UI_COMMAND_TIMEOUT_MS, deadlineAt),
      });
    } catch (error) {
      assertCaptureDeadline(deadlineAt);
      throw error;
    }
  });
}

async function discoverCollectorWindowSessions(
  requiredWindowIds: number[] = [],
  allowExactTwoAutoBinding = false,
) {
  const executable = await getControlExecutable();
  const { stdout } = await collectorUiGate.run(() => execFileAsync(
    executable,
    ["windows"],
    {
      maxBuffer: 10 * 1024 * 1024,
      timeout: WEIXIN_CHANNELS_UI_COMMAND_TIMEOUT_MS,
    },
  ));
  const windows = JSON.parse(stdout) as WeixinChannelsWindowInfo[];
  const coordinator = createWeixinChannelsWindowCoordinator(windows, requiredWindowIds, {
    allowExactTwoAutoBinding,
  });
  if (!coordinator.sessions.length) throw new Error("weixin_channels_window_not_found");
  return coordinator.sessions;
}

export function collectorScreenshotForWindow(baseScreenshot: string, windowId: number) {
  const extension = path.extname(baseScreenshot) || ".png";
  const stem = baseScreenshot.slice(0, baseScreenshot.length - path.extname(baseScreenshot).length);
  return `${stem}-window-${windowId}${extension}`;
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

async function getFloatingControlExecutable() {
  floatingControlExecutablePromise ||= compileSwiftExecutable(
    "weixin-channels-emergency-stop.swift",
    "mvstudiopro-weixin-channels-floating-control",
  );
  return floatingControlExecutablePromise;
}

export async function prepareWeixinCollectorExecutables() {
  // 双核机器串行预编译；编译发生在单条 SLA 计时之前，后续 OCR/控制动作复用二进制。
  await getControlExecutable();
  await getOcrExecutable();
  await getFloatingControlExecutable();
}

async function readOcr(screenshot: string, deadlineAt?: number): Promise<OcrResult> {
  assertCaptureDeadline(deadlineAt);
  const executable = await getOcrExecutable();
  try {
    const { stdout } = await execFileAsync(executable, [screenshot], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: deadlineBoundedTimeoutMs(WEIXIN_CHANNELS_REALTIME_OCR_TIMEOUT_MS, deadlineAt),
    });
    assertCaptureDeadline(deadlineAt);
    return JSON.parse(stdout) as OcrResult;
  } catch (error) {
    assertCaptureDeadline(deadlineAt);
    throw error;
  }
}

async function readOcrBatch(screenshots: string[], deadlineAt?: number): Promise<OcrResult[]> {
  assertCaptureDeadline(deadlineAt);
  const executable = await getOcrExecutable();
  try {
    const { stdout } = await execFileAsync(executable, ["--batch", ...screenshots], {
      maxBuffer: 30 * 1024 * 1024,
      timeout: deadlineBoundedTimeoutMs(WEIXIN_CHANNELS_BATCH_OCR_TIMEOUT_MS, deadlineAt),
    });
    assertCaptureDeadline(deadlineAt);
    return JSON.parse(stdout) as OcrResult[];
  } catch (error) {
    assertCaptureDeadline(deadlineAt);
    throw error;
  }
}

const FOCUSED_METRICS_REGION = { left: 0.39, top: 0.935, width: 0.58, height: 0.05 } as const;

export function mergeFocusedMetricOcr(
  base: OcrResult,
  focused: OcrResult,
  region = FOCUSED_METRICS_REGION,
): OcrResult {
  const bottomOffset = 1 - region.top - region.height;
  return {
    ...base,
    lines: [
      ...base.lines,
      ...focused.lines.map((line) => ({
        ...line,
        x: region.left + line.x * region.width,
        y: bottomOffset + line.y * region.height,
        width: line.width * region.width,
        height: line.height * region.height,
      })),
    ],
  };
}

async function enrichBottomMetricsFromFocusedOcr(screenshot: string, base: OcrResult) {
  if (hasFourVisibleMetrics(base.lines)) return base;
  const metadata = await sharp(screenshot).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width < 100 || height < 100) return base;
  const left = Math.round(width * FOCUSED_METRICS_REGION.left);
  const top = Math.round(height * FOCUSED_METRICS_REGION.top);
  const cropWidth = Math.min(width - left, Math.round(width * FOCUSED_METRICS_REGION.width));
  const cropHeight = Math.min(height - top, Math.round(height * FOCUSED_METRICS_REGION.height));
  const focusedFile = `${screenshot}.metrics-${process.pid}-${Date.now()}.png`;
  try {
    // 只在全图 OCR 连续漏底部数字时执行一次。高阈值去掉视频自带的灰色
    // 相机水印，实测可把重叠的“1408 / 508 / ISO3200”拆回四个白字指标。
    await sharp(screenshot)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize({ width: cropWidth * 3 })
      .greyscale()
      .threshold(205)
      .png()
      .toFile(focusedFile);
    const focused = (await readOcrBatch([focusedFile]))[0];
    return focused ? mergeFocusedMetricOcr(base, focused) : base;
  } finally {
    await fs.unlink(focusedFile).catch(() => undefined);
  }
}

async function captureWindow(output: string, deadlineAt?: number) {
  const session = collectorWindowContext.getStore();
  if (collectorWindowScopeRequired && !session) throw new Error("weixin_channels_unscoped_ui_action_blocked");
  const args = session ? buildWindowScopedControlArgs(session, ["window"]) : ["window"];
  // Raise、焦点反查与截屏必须占用同一个全局 UI 临界区；否则另一窗可能在
  // window 命令返回后、screencapture 前抢走焦点或改变控制条悬停状态。
  await collectorUiGate.run(async () => {
    assertCaptureDeadline(deadlineAt);
    const executable = await getControlExecutable();
    const { stdout } = await execFileAsync(executable, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: deadlineBoundedTimeoutMs(WEIXIN_CHANNELS_UI_COMMAND_TIMEOUT_MS, deadlineAt),
    });
    const window = JSON.parse(stdout) as { x: number; y: number; width: number; height: number };
    const region = [window.x, window.y, window.width, window.height].map((value) => Math.round(value)).join(",");
    await execFileAsync("/usr/sbin/screencapture", ["-x", `-R${region}`, output], {
      timeout: deadlineBoundedTimeoutMs(WEIXIN_CHANNELS_SCREENSHOT_TIMEOUT_MS, deadlineAt),
    });
    assertCaptureDeadline(deadlineAt);
  });
}

async function captureWindowAfterHover(
  output: string,
  relX: number,
  relY: number,
  settleMs: number,
  deadlineAt?: number,
) {
  const session = collectorWindowContext.getStore();
  if (collectorWindowScopeRequired && !session) {
    throw new Error("weixin_channels_unscoped_ui_action_blocked");
  }
  const scoped = (args: string[]) => session
    ? buildWindowScopedControlArgs(session, args)
    : args;
  await collectorUiGate.run(async () => {
    assertCaptureDeadline(deadlineAt);
    const executable = await getControlExecutable();
    // 悬停、控件显现与截图必须是同一个 UI 临界区。旧版在等待 180–400ms
    // 时释放 FIFO，另一窗会抢走焦点和鼠标，导致本窗进度条明明存在却识别失败。
    await execFileAsync(executable, scoped([
      "move-relative",
      relX.toFixed(4),
      relY.toFixed(4),
    ]), {
      maxBuffer: 10 * 1024 * 1024,
      timeout: deadlineBoundedTimeoutMs(WEIXIN_CHANNELS_UI_COMMAND_TIMEOUT_MS, deadlineAt),
    });
    await waitWithinCaptureBudget(deadlineAt, settleMs, settleMs);
    const { stdout } = await execFileAsync(executable, scoped(["window"]), {
      maxBuffer: 10 * 1024 * 1024,
      timeout: deadlineBoundedTimeoutMs(WEIXIN_CHANNELS_UI_COMMAND_TIMEOUT_MS, deadlineAt),
    });
    const window = JSON.parse(stdout) as { x: number; y: number; width: number; height: number };
    const region = [window.x, window.y, window.width, window.height]
      .map((value) => Math.round(value))
      .join(",");
    await execFileAsync("/usr/sbin/screencapture", ["-x", `-R${region}`, output], {
      timeout: deadlineBoundedTimeoutMs(WEIXIN_CHANNELS_SCREENSHOT_TIMEOUT_MS, deadlineAt),
    });
    assertCaptureDeadline(deadlineAt);
  });
}

export function metricsRemainOnSameVideo(
  base: ReturnType<typeof extractWeixinChannelsMetrics>,
  sample: ReturnType<typeof extractWeixinChannelsMetrics>,
) {
  const keys = ["likes", "shares", "favorites", "comments"] as const;
  const comparable = keys.filter((key) => base[key] !== undefined && sample[key] !== undefined);
  // 进度控制条会遮住一至两项底部指标；两项稳定即可确认仍为同一视频，
  // 少于两项才视为无法证明。四项齐全时允许一项 OCR 补回漏掉的首位数字
  // （实测 860→1860），但至少三项必须稳定，不能把新视频拼进旧 observation。
  if (comparable.length < 2) return false;
  const stable = comparable.filter(
    (key) => Math.abs(sample[key]! - base[key]!) <= Math.max(5, base[key]! * 0.03),
  );
  return stable.length >= Math.max(2, comparable.length - 1);
}

/** 当前播放器连续性只做短时容错判断，不参与跨重启历史去重。 */
export function sameVideoContinuity(base: OcrResult, sample: OcrResult) {
  const baseIdentity = extractVisibleTitleAndAuthor(base.lines);
  const sampleIdentity = extractVisibleTitleAndAuthor(sample.lines);
  const compatibleText = (leftValue?: string, rightValue?: string) => {
    const left = normalizeDedupIdentityText(leftValue);
    const right = normalizeDedupIdentityText(rightValue);
    if (!left || !right || left === right || left.includes(right) || right.includes(left)) return true;
    const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      let diagonal = rows[0]!;
      rows[0] = rightIndex;
      for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const above = rows[leftIndex]!;
        rows[leftIndex] = Math.min(
          rows[leftIndex]! + 1,
          rows[leftIndex - 1]! + 1,
          diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
        );
        diagonal = above;
      }
    }
    return rows[left.length]! <= Math.max(1, Math.ceil(Math.max(left.length, right.length) * 0.2));
  };
  // 标题展开和轻微 OCR 差异可容忍；两边都读到且明确矛盾时必须 fail-closed，
  // 不能仅因两个低互动视频数字接近就把新视频写进旧 observationId。
  if (!compatibleText(baseIdentity.title, sampleIdentity.title)
    || !compatibleText(baseIdentity.author, sampleIdentity.author)) return false;
  return metricsRemainOnSameVideo(
    extractWeixinChannelsMetrics(base.lines),
    extractWeixinChannelsMetrics(sample.lines),
  );
}

export async function detectVisibleProgressTrack(screenshot: string) {
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let best: { start: number; end: number; y: number; length: number; score: number } | null = null;
  // 横视频与竖视频的控制区高度不同；两张真实双窗截图分别位于 73.3% 与 82.2%。
  const minY = Math.round(info.height * 0.65);
  const maxY = Math.round(info.height * 0.86);
  for (let y = minY; y <= maxY; y += 1) {
    const grayXs: number[] = [];
    for (let x = Math.round(info.width * 0.09); x < Math.round(info.width * 0.86); x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset]!;
      const green = data[offset + 1]!;
      const blue = data[offset + 2]!;
      // 微信会把未播放轨道染成半透明蓝灰（实测 RGB 约 94/123/146，色差 52），
      // 旧的 45 阈值只认中性灰，导致画面明明有轨道却无限重试。背景深蓝 red≈0，
      // 继续由 red>=55 排除，因此放宽到 65 不会把整片视频背景当进度条。
      const gray = Math.max(red, green, blue) - Math.min(red, green, blue) <= 65 && red >= 55 && red <= 255;
      if (gray) grayXs.push(x);
    }
    let runStart = grayXs[0];
    let lastGray = grayXs[0];
    const commitRun = () => {
      if (runStart === undefined || lastGray === undefined) return;
      const rawStartRatio = runStart / info.width;
      const endRatio = lastGray / info.width;
      const playButtonJoined = rawStartRatio >= 0.085 && rawStartRatio < 0.1;
      const normalizedStart = playButtonJoined ? Math.round(info.width * 0.136) : runStart;
      const startRatio = normalizedStart / info.width;
      const length = lastGray - normalizedStart;
      if (length >= info.width * 0.25 && startRatio >= 0.1 && startRatio <= 0.2
        // 双窗真实轨道末端稳定在约 69.9%；收紧范围可排除同高度字幕横画。
        && endRatio >= 0.67 && endRatio <= 0.72) {
        const score = length
          - Math.abs(startRatio - 0.136) * info.width
          - Math.abs(endRatio - 0.699) * info.width;
        if (!best || score > best.score) best = { start: normalizedStart, end: lastGray, y, length, score };
      }
    };
    for (let index = 1; index <= grayXs.length; index += 1) {
      const current = grayXs[index];
      if (current === undefined || lastGray === undefined || current - lastGray > Math.max(4, Math.round(info.width * 0.005))) {
        commitRun();
        runStart = current;
      }
      lastGray = current;
    }
  }
  {
    // 浅色路面会让播放按钮、轨道和背景连成一整段。用轨道相对上下
    // 6px 的亮度突变确认真实横线，再采用已由双窗截图校准的两端。
    let edgeBest: { y: number; count: number; score: number } | undefined;
    const start = Math.round(info.width * 0.136);
    const end = Math.round(info.width * 0.70);
    const luminance = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return (data[offset]! + data[offset + 1]! + data[offset + 2]!) / 3;
    };
    for (let y = minY + 6; y <= maxY - 6; y += 1) {
      let count = 0;
      let score = 0;
      for (let x = start; x <= end; x += 1) {
        const contrast = luminance(x, y) - (luminance(x, y - 6) + luminance(x, y + 6)) / 2;
        // 深色视频上的轨道比背景亮，浅色视频上的灰轨道则比背景暗。
        // 两者都是同一条横向边缘，不能只接受正向亮度差。
        if (Math.abs(contrast) > 25) count += 1;
        score += Math.abs(contrast);
      }
      if (count >= info.width * 0.25 && (!edgeBest || count > edgeBest.count || (count === edgeBest.count && score > edgeBest.score))) {
        edgeBest = { y, count, score };
      }
    }
    // 边缘证据比“浅色连续段”更能区分道路/字幕，命中时优先采用。
    if (edgeBest) best = { start, end, y: edgeBest.y, length: end - start, score: edgeBest.score };
  }
  if (!best) throw new Error("weixin_channels_progress_track_not_found");
  return {
    startX: best.start / info.width,
    endX: best.end / info.width,
    y: best.y / info.height,
  };
}

async function detectVisibleProgressTrackReliably(screenshot: string) {
  try {
    return await detectVisibleProgressTrack(screenshot);
  } catch {
    // 横版素材的控制条约在 73%，竖版约在 82%。旧实现依次经过两个高度
    // 后只在 82% 截图，导致横版控制条刚出现就又被鼠标移走。现在每个布局
    // 各截一帧并立即检测，首个命中就停止，最多增加两张被动截图。
  }
  let lastError: unknown;
  for (const hoverY of ["0.73", "0.82"] as const) {
    await captureWindowAfterHover(screenshot, 0.50, Number(hoverY), 180);
    try {
      return await detectVisibleProgressTrack(screenshot);
    } catch (error) {
      lastError = error;
    }
  }
  // 部分横版视频仅移动鼠标不会显示控制条；点击视频安全中心只切换暂停，
  // 再悬停底部即可定位轨道。该点不在头像、标签 X 或作者区域。
  await runSwiftControl(["click-relative", "0.5000", "0.5000"]);
  await captureWindowAfterHover(screenshot, 0.50, 0.82, 180);
  try {
    return await detectVisibleProgressTrack(screenshot);
  } catch (error) {
    lastError = error;
  }
  throw lastError instanceof Error ? lastError : new Error("weixin_channels_progress_track_not_found");
}

async function detectProgressPlayheadRatio(
  screenshot: string,
  track: { startX: number; endX: number; y: number },
) {
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const start = Math.round(track.startX * info.width);
  const end = Math.round(track.endX * info.width);
  const centerY = Math.round(track.y * info.height);
  let rightmost = -1;
  for (let x = start; x <= end; x += 1) {
    let bright = 0;
    for (let y = Math.max(0, centerY - 4); y <= Math.min(info.height - 1, centerY + 4); y += 1) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset]!, green = data[offset + 1]!, blue = data[offset + 2]!;
      if (red >= 190 && green >= 190 && blue >= 190 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 35) bright += 1;
    }
    if (bright >= 2) rightmost = x;
  }
  if (rightmost < start) throw new Error("weixin_channels_progress_playhead_not_found");
  return Math.max(0, Math.min(1, (rightmost - start) / Math.max(1, end - start)));
}

async function measureVideoDurationFromProgressMotion(params: {
  screenshot: string;
  track: { startX: number; endX: number; y: number };
}) {
  const measure = async () => {
    const startedAt = Date.now();
    const first = await detectProgressPlayheadRatio(params.screenshot, params.track);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await captureWindow(params.screenshot);
    const second = await detectProgressPlayheadRatio(params.screenshot, params.track);
    const elapsedSec = (Date.now() - startedAt) / 1_000;
    return { delta: second - first, elapsedSec };
  };
  let sample = await measure();
  if (sample.delta <= 0.002) {
    // 播放器可能处于暂停态；只切换一次播放状态后重新量测，仍不移动进度。
    await runSwiftControl(["click-relative", "0.50", "0.50"]);
    await runSwiftControl(["move-relative", "0.50", params.track.y.toFixed(4)]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await captureWindow(params.screenshot);
    sample = await measure();
  }
  if (sample.delta <= 0.002) throw new Error("weixin_channels_progress_motion_not_detected");
  const duration = Math.round(sample.elapsedSec / sample.delta);
  if (!Number.isFinite(duration) || duration < 3 || duration > 86_400) {
    throw new Error("weixin_channels_progress_motion_duration_invalid");
  }
  return duration;
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
    // 末端时长浮层消失很快：先在拖动后 120ms 截取真实总时长，再把
    // 剩余加载等待留给后续五点采样，不能等 650ms 后才读已经消失的浮层。
    await new Promise((resolve) => setTimeout(resolve, 120));
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
    if (duration) await new Promise((resolve) => setTimeout(resolve, 530));
  }
  if (!duration) throw new Error("weixin_channels_video_duration_not_detected");
  return duration;
}

export async function sampleVideoContentAtProgress(
  screenshot: string,
  baseMetrics: ReturnType<typeof extractWeixinChannelsMetrics>,
  captureStartedAt: number,
  videoDurationHintSec?: number,
) {
  const ocrTexts: string[] = [];
  const videoDurationSec = videoDurationHintSec;
  const deadlineAt = captureStartedAt + WEIXIN_CHANNELS_CURRENT_VIDEO_HARD_UI_ADVANCE_MS;
  // 点击视频使控制条出现；真实探针确认进度条横跨窗口宽度约 12.5%–91%、纵向约 82.3%。
  await runSwiftControl(["click-relative", "0.50", "0.50"]);
  await captureWindowAfterHover(screenshot, 0.50, 0.82, 400);
  // 用户要求左右窗都只认当前帧一次：定位不到立即滑走，禁止再换高度、点击
  // 播放器或对同一视频重做内容采样。
  const track = await detectVisibleProgressTrack(screenshot);
  const startX = track.startX;
  let previousX = startX;
  const sampleScreenshots: string[] = [];
  const windowToken = String(collectorWindowContext.getStore()?.windowId || "single");
  await runSwiftControl(["click-relative", startX.toFixed(4), track.y.toFixed(4)]);
  try {
    for (let index = 0; index < WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS.length; index += 1) {
      assertCurrentVideoUiCanContinue(deadlineAt);
      const progress = WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS[index]!;
      const targetX = startX + (track.endX - startX) * progress;
      // drag-relative 已在同一个 Swift 原子动作内处理跨窗安全归位与头像路径门禁；
      // 旧版每个采样点额外启动一次 move 进程，五点会重复 Raise/焦点确认五次。
      await runSwiftControl(["drag-relative", previousX.toFixed(4), track.y.toFixed(4), targetX.toFixed(4), track.y.toFixed(4)]);
      // VPN 下拖动进度后先等画面完成同步，再只截一张内容样本。
      await waitWithinCaptureBudget(undefined, 650, 650);
      await captureWindow(screenshot);
      const sampleFile = path.join(os.tmpdir(), `weixin-channels-sample-${process.pid}-${windowToken}-${index}.png`);
      await fs.copyFile(screenshot, sampleFile);
      sampleScreenshots.push(sampleFile);
      previousX = targetX;
    }
    const results = await readOcrBatch(sampleScreenshots);
    let lastOcr = results[results.length - 1];
    if (!lastOcr || !metricsRemainOnSameVideo(baseMetrics, extractWeixinChannelsMetrics(lastOcr.lines))) {
      // VPN seek 后最后一帧偶尔只漏掉互动指标，不能因此重跑整套五点。
      // 保持在 90% 位置等待画面稳定，只允许补截当前帧一次。
      await waitWithinCaptureBudget(undefined, 900, 900);
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
    }
    return {
      ocrTexts,
      videoDurationSec,
      deadlineAt,
    };
  } finally {
    await Promise.all(sampleScreenshots.map((sample) => fs.unlink(sample).catch(() => undefined)));
  }
}

export function collectorSamplingModeForComments(comments: number) {
  return Math.max(0, Number(comments) || 0) >= WEIXIN_CHANNELS_COMMENT_THRESHOLD
    ? "five_point_comments" as const
    : "single_representative_frame" as const;
}

async function captureSingleRepresentativeFrame(
  screenshot: string,
  baseOcr: OcrResult,
  captureStartedAt: number,
) {
  const ocrText = baseOcr.lines
    .filter((line) => line.confidence >= 0.45)
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(" | ");

  return {
    ocrTexts: [ocrText],
    videoDurationSec: undefined,
    deadlineAt: captureStartedAt + 15_000,
  };
}

type CollectorRawSearchEvidence = {
  file?: string;
  selectedAgeDays?: number;
};

async function captureVisibleVideoToRawSpool(params: {
  screenshot: string;
  safetyOcr: OcrResult;
  root: string;
  run: WeixinChannelsRawRunState;
  taskId: string;
  query: string;
  source: WeixinChannelsRawSource;
  searchEvidence?: CollectorRawSearchEvidence;
}) {
  const windowId = requireCollectorWindowSession().windowId;
  const slot = await reserveWeixinChannelsRawSlot({
    root: params.root,
    run: params.run,
    source: params.source,
    taskId: params.taskId,
    query: params.query,
    windowId,
    searchSelectedAgeDays: params.searchEvidence?.selectedAgeDays,
  });
  if (!slot) {
    if (params.searchEvidence?.file) {
      await fs.unlink(params.searchEvidence.file).catch(() => undefined);
    }
    return { stopped: "raw_harvest_batch_ready" as const };
  }
  const captureStartedAt = Date.now();
  const captureDeadlineAt = captureStartedAt + WEIXIN_CHANNELS_CURRENT_VIDEO_HARD_UI_ADVANCE_MS;
  const dwellTargetMs = randomInt(
    WEIXIN_CHANNELS_RAW_VIDEO_DWELL_MIN_MS,
    WEIXIN_CHANNELS_RAW_VIDEO_DWELL_MAX_MS + 1,
  );
  const capturedAt = new Date(captureStartedAt).toISOString();
  const temporaryFiles: string[] = [];
  const assets: Array<{
    kind: WeixinChannelsRawAssetKind;
    sourceFile: string;
    progress?: number;
    page?: number;
  }> = [];
  const makeTemporary = (label: string) => path.join(
    os.tmpdir(),
    "weixin-channels-raw-" + process.pid + "-" + windowId + "-"
    + slot.reservation.rawId + "-" + label + ".jpg",
  );
  const saveCurrentFrame = async (
    kind: (typeof assets)[number]["kind"],
    label: string,
    extra: Pick<(typeof assets)[number], "progress" | "page"> = {},
  ) => {
    const file = makeTemporary(label);
    await sharp(params.screenshot).jpeg({ quality: 88, mozjpeg: true }).toFile(file);
    temporaryFiles.push(file);
    assets.push({ kind, sourceFile: file, ...extra });
    return file;
  };
  let commentsStatus: WeixinChannelsRawManifest["commentsStatus"] = "entry_missing";
  let currentSafetyOcr = params.safetyOcr;
  let playerBeforeComments = params.safetyOcr;
  let progressTrackUnavailable = false;
  let captureBudgetExhausted = false;
  try {
    await captureWindow(params.screenshot);
    await saveCurrentFrame("player_base", "base");
    if (params.searchEvidence?.file) {
      assets.push({ kind: "search_result", sourceFile: params.searchEvidence.file });
    }

    // raw 实时阶段只拖动并保存原图，不读取帧中文字，也不做资格、广告或去重判断。
    try {
      await runSwiftControl(["click-relative", "0.50", "0.50"]);
      await captureWindowAfterHover(params.screenshot, 0.50, 0.82, 250);
      // raw 双窗与正式采集使用同一单帧门禁；禁止可靠定位函数内部的多高度
      // 截图和补点击重试，否则右窗会长期困在同一条视频。
      const track = await detectVisibleProgressTrack(params.screenshot);
      let previousX = track.startX;
      await runSwiftControl(["click-relative", track.startX.toFixed(4), track.y.toFixed(4)]);
      for (let index = 0; index < WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS.length; index += 1) {
        assertCurrentVideoUiCanContinue(captureDeadlineAt);
        const progress = WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS[index]!;
        const targetX = track.startX + (track.endX - track.startX) * progress;
        await runSwiftControl([
          "drag-relative",
          previousX.toFixed(4),
          track.y.toFixed(4),
          targetX.toFixed(4),
          track.y.toFixed(4),
        ]);
        await waitWithinCaptureBudget(undefined, 350, 350);
        await captureWindow(params.screenshot);
        await saveCurrentFrame("player_progress", "progress-" + index, { progress });
        previousX = targetX;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      progressTrackUnavailable = isWeixinChannelsProgressTrackUnavailable(reason);
      captureBudgetExhausted = /weixin_channels_capture_time_budget_exhausted/.test(reason)
        || Date.now() >= captureDeadlineAt;
      // 单个播放器没有可拖动进度条时仍提交已经取得的 base，随后立即滑走；
      // 不打开评论、不等待停留时长，也不对当前视频再次定位。
      process.stderr.write((progressTrackUnavailable
        ? "raw_progress_track_unavailable_advance:"
        : "raw_progress_capture_partial:") + slot.reservation.rawId + ":" + reason + "\n");
      if (!progressTrackUnavailable && !captureBudgetExhausted) {
      assertCurrentVideoUiCanContinue(captureDeadlineAt);
        await runSwiftControl(["key", "escape"]).catch(() => undefined);
      }
    }

    try {
      if (!progressTrackUnavailable && !captureBudgetExhausted) {
      // 先把鼠标移出控制条，再以当前帧真实四项资格决定是否需要评论。
      // raw 也必须遵守 qualified + requiresComments 双门禁，低评论/不达标视频
      // 不得为了“多留素材”打开抽屉。
      await runSwiftControl(["move-relative", "0.02", "0.50"]);
      await waitWithinCaptureBudget(undefined, 120, 180);
      await captureWindow(params.screenshot);
      currentSafetyOcr = await readOcr(params.screenshot);
      const commentDisposition = rawCommentsCaptureDisposition(
        currentSafetyOcr.lines,
        captureStartedAt + WEIXIN_CHANNELS_UNKNOWN_DURATION_CAPTURE_BUDGET_MS,
      );
      if (commentDisposition !== "capture_required") {
        commentsStatus = commentDisposition;
      } else {
        playerBeforeComments = currentSafetyOcr;
        const commentPoint = findCommentsOpenPoint(currentSafetyOcr.lines);
        if (!commentPoint) {
          commentsStatus = "entry_missing";
        } else {
          await runSwiftControl([
            "click-relative",
            commentPoint.x.toFixed(5),
            commentPoint.y.toFixed(5),
          ]);
          let panel: OcrResult | undefined;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            assertCurrentVideoUiCanContinue(captureDeadlineAt);
            await waitWithinCaptureBudget(undefined, 180 + attempt * 80, 260 + attempt * 80);
            await captureWindow(params.screenshot);
            const candidate = await readOcr(params.screenshot);
            currentSafetyOcr = candidate;
            if (findCommentsPanelTitle(candidate.lines)
              || await findCommentsClosePointFromScreenshot(params.screenshot, candidate.lines)) {
              panel = candidate;
              break;
            }
          }
          if (panel) {
            commentsStatus = "captured";
            for (let page = 0; page < WEIXIN_CHANNELS_COMMENT_PANEL_SCREEN_COUNT; page += 1) {
              assertCurrentVideoUiCanContinue(captureDeadlineAt);
              if (page > 0) {
                await runSwiftControl(["scroll-relative", "0.75", "0.68", "-6"]);
                await waitWithinCaptureBudget(undefined, 300, 350);
                await captureWindow(params.screenshot);
                panel = await readOcr(params.screenshot);
                currentSafetyOcr = panel;
              }
              await saveCurrentFrame("comments_page", "comments-" + page, { page });
            }
            let closed = false;
            let closeFailure: string | undefined;
            // 每次点击前重新截图、重新定位当前帧 X；点击后保存结果帧并立刻
            // 更新对应 OCR，保证失败证据永远是同一帧，而不是打开前的旧 OCR。
            for (let closeAttempt = 0; closeAttempt < 3; closeAttempt += 1) {
              assertCurrentVideoUiCanContinue(captureDeadlineAt);
              await captureWindow(params.screenshot);
              const beforeClose = await readOcr(params.screenshot);
              currentSafetyOcr = beforeClose;
              await saveCurrentFrame("comments_close_attempt", "comments-close-attempt-" + closeAttempt);
              const closePoint = await findCommentsClosePointFromScreenshot(
                params.screenshot,
                beforeClose.lines,
              );
              if (!closePoint) {
                const recovery = classifyRawCommentsPanelRecovery(playerBeforeComments, beforeClose);
                if (recovery === "closed_confirmed") {
                  commentsStatus = "closed_confirmed";
                  closed = true;
                } else {
                  closeFailure = recovery === "panel_still_visible"
                    ? "weixin_channels_raw_comments_close_button_not_recognized"
                    : "weixin_channels_raw_comments_closed_player_verification_unconfirmed";
                }
                break;
              }
              await runSwiftControl([
                "click-confirmed-comments-close",
                closePoint.x.toFixed(5),
                closePoint.y.toFixed(5),
              ]);
              await waitWithinCaptureBudget(undefined, 220 + closeAttempt * 100, 320 + closeAttempt * 100);
              await captureWindow(params.screenshot);
              const afterClose = await readOcr(params.screenshot);
              currentSafetyOcr = afterClose;
              await saveCurrentFrame("comments_close_result", "comments-close-result-" + closeAttempt);
              const recovery = classifyRawCommentsPanelRecovery(playerBeforeComments, afterClose);
              if (recovery === "closed_confirmed") {
                commentsStatus = "closed_confirmed";
                closed = true;
                break;
              }
              if (recovery === "panel_still_visible") {
                closeFailure = closeAttempt === 2
                  ? "weixin_channels_raw_comments_close_click_not_effective"
                  : undefined;
                continue;
              }
              closeFailure = "weixin_channels_raw_comments_closed_player_verification_unconfirmed";
              break;
            }
            if (!closed) {
              throw new Error(closeFailure || "weixin_channels_raw_comments_panel_still_visible");
            }
          } else {
            commentsStatus = "open_unconfirmed";
            await runSwiftControl(["key", "escape"]);
            await waitWithinCaptureBudget(undefined, 180, 220);
            await captureWindow(params.screenshot);
            currentSafetyOcr = await readOcr(params.screenshot);
            const recovery = classifyRawCommentsPanelRecovery(playerBeforeComments, currentSafetyOcr);
            if (recovery === "panel_still_visible") {
              throw new Error("weixin_channels_raw_comments_close_button_not_recognized");
            }
            if (recovery !== "closed_confirmed") {
              throw new Error("weixin_channels_raw_comments_closed_player_verification_unconfirmed");
            }
          }
        }
      }

      if (isWeixinChannelsAuxiliaryPage(currentSafetyOcr.lines)
        || !commentsPanelClosedOnSameVideo(params.safetyOcr, currentSafetyOcr)) {
        throw new Error("weixin_channels_raw_player_structure_not_confirmed_without_comments");
      }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const deadlineExhausted = /weixin_channels_capture_time_budget_exhausted/.test(reason)
        || Date.now() >= captureDeadlineAt;
      if (!deadlineExhausted) throw error;
      // 采集预算耗尽不等于播放器必须停住。先在当前窗完成安全复位，随后只保留
      // 已有 base/progress；不完整评论素材不得在离线阶段误晋级。
      currentSafetyOcr = await recoverRawPlayerAfterCaptureDeadline(
        params.screenshot,
        playerBeforeComments,
      );
      captureBudgetExhausted = true;
      commentsStatus = "skipped_budget";
      for (let index = assets.length - 1; index >= 0; index -= 1) {
        if (assets[index]!.kind.startsWith("comments_")) assets.splice(index, 1);
      }
      process.stderr.write(`raw_capture_deadline_partial_committing:${slot.reservation.rawId}:${reason}\n`);
    }

    // 进度条缺失或预算到点时保留已经取得的 base，不再做任何当前视频 UI 动作。
    // 其余路径保存抽屉关闭后的播放器帧，供离线连续性与指标读取。
    if (!progressTrackUnavailable && !captureBudgetExhausted) {
      await saveCurrentFrame("player_closed", "closed");
    }
    const dwellRemainingMs = remainingWeixinChannelsRawVideoDwellMs(
      captureStartedAt,
      Date.now(),
      dwellTargetMs,
    );
    if (!progressTrackUnavailable && !captureBudgetExhausted && dwellRemainingMs > 0) {
      const boundedDwellMs = Math.min(
        dwellRemainingMs,
        Math.max(0, remainingBudgetMs(captureDeadlineAt) - 100),
      );
      if (boundedDwellMs > 0) {
        await waitWithinCaptureBudget(captureDeadlineAt, boundedDwellMs, boundedDwellMs);
      }
    }
    const captureElapsedMs = Date.now() - captureStartedAt;
    const committed = await commitWeixinChannelsRawItem({
      root: params.root,
      reservation: slot.reservation,
      capturedAt,
      completedAt: new Date().toISOString(),
      captureElapsedMs,
      captureBudgetMs: WEIXIN_CHANNELS_MAX_COMPLETE_CAPTURE_MS,
      commentsStatus,
      videoIdentity: visibleVideoIdentityFingerprint(currentSafetyOcr),
      assets,
    });
    process.stdout.write(JSON.stringify({
      event: "raw_capture_committed",
      rawId: committed.manifest.rawId,
      runId: committed.manifest.runId,
      windowId,
      source: committed.manifest.source,
      commentsStatus,
      captureElapsedMs: committed.manifest.captureElapsedMs,
      rawOnly: true,
      modelCalls: 0,
    }) + "\n");
    return {
      stopped: null,
      manifest: committed.manifest,
      safetyOcr: currentSafetyOcr,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordWeixinChannelsRawFailureEvidence({
      root: params.root,
      reservation: slot.reservation,
      reason,
      ocrLines: currentSafetyOcr.lines,
      screenshot: params.screenshot,
    }).catch((evidenceError) => {
      process.stderr.write(`raw_failure_evidence_write_failed:${
        evidenceError instanceof Error ? evidenceError.message : String(evidenceError)
      }\n`);
    });
    await releaseWeixinChannelsRawSlot({
      root: params.root,
      reservation: slot.reservation,
    });
    throw error;
  } finally {
    await Promise.all(temporaryFiles.map((file) => fs.unlink(file).catch(() => undefined)));
    if (params.searchEvidence?.file) {
      await fs.unlink(params.searchEvidence.file).catch(() => undefined);
    }
  }
}

export function hasConfirmedRawMetricTransition(previous: OcrResult, next: OcrResult) {
  const before = extractWeixinChannelsMetrics(previous.lines);
  const after = extractWeixinChannelsMetrics(next.lines);
  const keys = ["likes", "shares", "favorites", "comments"] as const;
  const comparable = keys.filter((key) => before[key] !== undefined && after[key] !== undefined);
  if (comparable.length < 3 || metricsRemainOnSameVideo(before, after)) return false;
  const materiallyChanged = comparable.filter((key) => (
    Math.abs(after[key]! - before[key]!) > Math.max(10, before[key]! * 0.1)
  ));
  return materiallyChanged.length >= 3;
}

export function classifyRawFrameAfterAdvance(
  previous: OcrResult,
  current: OcrResult,
): "same_video" | "transitioned" | "comments_panel_visible" | "unconfirmed" {
  if (findCommentsPanelTitle(current.lines)) return "comments_panel_visible";
  if (isWeixinChannelsAuxiliaryPage(current.lines)) return "unconfirmed";
  if (sameVideoContinuity(previous, current)) return "same_video";
  const previousIdentity = visibleVideoIdentityFingerprint(previous);
  const currentIdentity = visibleVideoIdentityFingerprint(current);
  if (previousIdentity && currentIdentity && previousIdentity === currentIdentity) return "same_video";
  if (hasConfirmedVideoTransition(previous, current)
    || hasConfirmedRawMetricTransition(previous, current)) return "transitioned";
  return "unconfirmed";
}

async function advanceRawToNextVideo(previous: OcrResult, screenshot: string) {
  // 每条最多实际滑动两次。两次都不能证明新视频身份/指标已稳定，就由外层
  // 强制重启整个双窗采集进程，不能留一个窗口继续制造重复数据。
  for (let scrollAttempt = 0; scrollAttempt < WEIXIN_CHANNELS_RAW_MAX_CONSECUTIVE_FAILURES; scrollAttempt += 1) {
    await runSwiftControl(["scroll-relative", "0.50", "0.50", "-6"]);
    for (let frameAttempt = 0; frameAttempt < 3; frameAttempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 220 + frameAttempt * 100));
      await captureWindow(screenshot);
      const candidate = await readOcr(screenshot);
      if (isWeixinChannelsMediaViewer(candidate.lines)) {
        const closePoint = findMediaViewerClosePoint(candidate.lines);
        if (closePoint) {
          await runSwiftControl([
            "click-relative",
            closePoint.x.toFixed(5),
            closePoint.y.toFixed(5),
          ]);
        } else {
          await runSwiftControl(["key", "escape"]);
        }
        continue;
      }
      const state = classifyRawFrameAfterAdvance(previous, candidate);
      if (state === "comments_panel_visible") {
        throw new Error("weixin_channels_raw_comments_panel_still_visible_before_advance");
      }
      if (state !== "transitioned") continue;
      await new Promise((resolve) => setTimeout(resolve, 160));
      await captureWindow(screenshot);
      const stable = await readOcr(screenshot);
      if (sameVideoContinuity(candidate, stable)) return stable;
    }
  }
  throw new Error("weixin_channels_raw_next_video_transition_not_confirmed_after_two_attempts");
}

export async function processWeixinChannelsRawRun(params: {
  root: string;
  run: WeixinChannelsRawRunState;
  knownVideoIdentities?: ReadonlySet<string>;
  knownObservationIds?: ReadonlySet<string>;
}) {
  if (params.run.phase !== "processing") {
    throw new Error("weixin_channels_raw_run_not_sealed");
  }
  const processingRun = params.run;
  const manifests = await listWeixinChannelsRawManifests({
    root: params.root,
    runId: processingRun.runId,
  });
  const duplicateVideoIdentities = new Set(params.knownVideoIdentities || []);
  const duplicateObservationIds = new Set(params.knownObservationIds || []);
  let accepted = 0;
  let rejected = 0;
  let duplicate = 0;
  let failed = 0;
  for (const original of manifests) {
    if (original.state !== "complete" && original.state !== "processing") continue;
    let manifest = await updateWeixinChannelsRawManifest({
      root: params.root,
      manifest: original,
      state: "processing",
    });
    try {
      const verifiedAssetFiles = new Map<WeixinChannelsRawManifest["assets"][number], string>();
      // 任何 OCR 前都重新核对实际 bytes + SHA-256；manifest 只声明哈希，不能
      // 证明素材在提交后没有被截断、替换或半同步。
      for (const asset of manifest.assets) {
        const verified = await verifyWeixinChannelsRawAsset({
          root: params.root,
          manifest,
          asset,
        });
        verifiedAssetFiles.set(asset, verified.file);
      }
      const playerAssets = manifest.assets.filter((asset) => (
        asset.kind === "player_base"
          || asset.kind === "player_progress"
          || asset.kind === "player_closed"
      ));
      const playerFiles = playerAssets.map((asset) => verifiedAssetFiles.get(asset)!);
      if (!playerFiles.length) throw new Error("offline_player_frames_missing");
      const playerOcr = await readOcrBatch(playerFiles);
      const ranked = playerOcr.map((ocr, index) => ({
        ocr,
        index,
        metricCount: Object.values(extractWeixinChannelsMetrics(ocr.lines))
          .filter((value) => typeof value === "number").length,
        hasIdentity: Boolean(visibleVideoIdentityFingerprint(ocr)),
      })).sort((left, right) => (
        Number(right.hasIdentity) - Number(left.hasIdentity)
          || right.metricCount - left.metricCount
      ));
      const best = ranked[0];
      if (!best) throw new Error("offline_player_ocr_missing");
      const metrics = extractWeixinChannelsMetrics(best.ocr.lines);
      const identity = extractVisibleTitleAndAuthor(best.ocr.lines);
      const videoIdentity = visibleVideoIdentityFingerprint(best.ocr);
      const ocrTexts = playerOcr.map((ocr) => ocr.lines
        .filter((line) => line.confidence >= 0.35)
        .map((line) => line.text.trim())
        .filter(Boolean)
        .join(" | "));
      const commentAssets = manifest.assets.filter((asset) => asset.kind === "comments_page");
      const commentFiles = commentAssets.map((asset) => verifiedAssetFiles.get(asset)!);
      const commentOcr = commentFiles.length ? await readOcrBatch(commentFiles) : [];
      const commentSamples = extractCommentSamples(commentOcr.flatMap((ocr) => (
        extractCommentPanelContentLines(ocr.lines)
      )));
      const decision = decideWeixinChannelsRawOfflineItem({
        manifest,
        duplicateVideoIdentities,
        duplicateObservationIds,
        analysis: {
          query: manifest.query,
          title: identity.title || "当前视频",
          author: identity.author,
          videoIdentity,
          likes: metrics.likes,
          shares: metrics.shares,
          favorites: metrics.favorites,
          comments: metrics.comments,
          ocrTexts,
          commentSamples,
        },
      });
      if (decision.state === "accepted") {
        const output = path.join(
          os.tmpdir(),
          "weixin-channels-pending-" + decision.observationId + ".json",
        );
        await persistPendingFile(output, decision.observation);
        duplicateVideoIdentities.add(videoIdentity!);
        duplicateObservationIds.add(decision.observationId);
        accepted += 1;
        manifest = await updateWeixinChannelsRawManifest({
          root: params.root,
          manifest,
          state: "accepted",
          observationId: decision.observationId,
        });
      } else if (decision.state === "duplicate") {
        duplicate += 1;
        manifest = await updateWeixinChannelsRawManifest({
          root: params.root,
          manifest,
          state: "duplicate",
          rejectionReason: decision.reason,
          observationId: decision.observationId,
        });
      } else {
        rejected += 1;
        manifest = await updateWeixinChannelsRawManifest({
          root: params.root,
          manifest,
          state: "rejected",
          rejectionReason: decision.reason,
        });
      }
    } catch (error) {
      failed += 1;
      await updateWeixinChannelsRawManifest({
        root: params.root,
        manifest,
        state: "failed",
        rejectionReason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const finalManifests = await listWeixinChannelsRawManifests({
    root: params.root,
    runId: processingRun.runId,
  });
  const cumulative = {
    accepted: finalManifests.filter((item) => item.state === "accepted").length,
    rejected: finalManifests.filter((item) => item.state === "rejected").length,
    duplicate: finalManifests.filter((item) => item.state === "duplicate").length,
    failed: finalManifests.filter((item) => item.state === "failed").length,
  };
  await closeWeixinChannelsRawRun({ root: params.root, run: processingRun });
  const summary = {
    event: "raw_offline_batch_processed",
    runId: processingRun.runId,
    found: finalManifests.length,
    ...cumulative,
    resumedThisProcess: {
      accepted,
      rejected,
      duplicate,
      failed,
    },
    abandonedReservations: processingRun.abandonedReservations || 0,
    modelCalls: 0,
  };
  await writeWeixinChannelsRawRunSummary({
    root: params.root,
    runId: processingRun.runId,
    summary,
  });
  process.stdout.write(JSON.stringify(summary) + "\n");
  return summary;
}

async function collectVisibleComments(screenshot: string, baseOcr: OcrResult, deadlineAt: number) {
  // 即使上层资格分支被未来改动误调用，底层仍以当前播放器四项指标硬挡：
  // 前置高热不足或评论少于 80 时都绝不触碰评论入口。
  if (!shouldOpenVisibleComments(baseOcr.lines)) {
    throw new Error("weixin_channels_comments_qualification_gate_blocked");
  }
  const openPoint = findCommentsOpenPoint(baseOcr.lines);
  if (!openPoint) throw new Error("weixin_channels_comments_entry_not_found");
  // 35 秒只用于失败时退出重复操作，不能阻止已经正常推进的真实评论链。
  assertCurrentVideoUiCanContinue(deadlineAt);
  await runSwiftControl(["click-relative", openPoint.x.toFixed(5), openPoint.y.toFixed(5)]);
  let panel: OcrResult | undefined;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    assertCurrentVideoUiCanContinue(deadlineAt);
    await waitWithinCaptureBudget(undefined, 180, 320);
    await captureWindow(screenshot);
    const candidate = await readOcr(screenshot);
    if (await findCommentsClosePointFromScreenshot(screenshot, candidate.lines)) {
      panel = candidate;
      break;
    }
  }
  if (!panel) throw new Error("weixin_channels_comments_open_not_confirmed");
  const collected: OcrLine[] = [];
  const pageLimit = WEIXIN_CHANNELS_COMMENT_PANEL_SCREEN_COUNT;
  for (let page = 0; page < pageLimit; page += 1) {
    assertCurrentVideoUiCanContinue(deadlineAt);
    if (page > 0) {
      await captureWindow(screenshot);
      panel = await readOcr(screenshot);
    }
    collected.push(...extractCommentPanelContentLines(panel.lines));
    if (page < pageLimit - 1) {
      await runSwiftControl(["scroll-relative", "0.75", "0.68", "-6"]);
      await waitWithinCaptureBudget(undefined, 150, 500);
    }
  }
  // 循环最后一页的 panel 与当前 UI 属于同一帧；旧实现无页面变化却又截图和
  // 精确 OCR 一次，只为重新找同一个 X，平白增加数秒。
  if (!await closeConfirmedCommentsPanel(screenshot, panel.lines)) {
    throw new Error("weixin_channels_comments_close_not_found");
  }
  // 关闭动画和指标重绘偶尔超过首帧；只允许最多三次被动补拍，不再点击、
  // 不滑动。每帧都必须证明仍是打开评论前的同一视频。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assertCurrentVideoUiCanContinue(deadlineAt);
    await waitWithinCaptureBudget(undefined, 100 + attempt * 100, 350 + attempt * 150);
    await captureWindow(screenshot);
    let closed = await readOcr(screenshot);
    if (attempt === 0 && !hasFourVisibleMetrics(closed.lines)) {
      closed = await enrichBottomMetricsFromFocusedOcr(screenshot, closed);
    }
    if (commentsPanelClosedOnSameVideo(baseOcr, closed)) {
      return { samples: extractCommentSamples(collected), closedOcr: closed };
    }
  }
  throw new Error("weixin_channels_comments_close_same_video_not_confirmed");
}

async function ensureInteractionMetricsVisible(screenshot: string, ocr: OcrResult) {
  if (hasFourVisibleMetrics(ocr.lines)) return ocr;
  // 鼠标停在视频上会显示“倍速播放中”等控制层并遮住前两项数字。
  // 先移到左侧黑边并被动补拍；这是普通播放器恢复，不点击任何内容。
  await runSwiftControl(["move-relative", "0.02", "0.50"]);
  await new Promise((resolve) => setTimeout(resolve, 450));
  await captureWindow(screenshot);
  let closed = await readOcr(screenshot);
  if (hasFourVisibleMetrics(closed.lines)) return closed;
  if (!await closeConfirmedCommentsPanel(screenshot, closed.lines)) {
    return enrichBottomMetricsFromFocusedOcr(screenshot, closed);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200 + attempt * 150));
    await captureWindow(screenshot);
    closed = await readOcr(screenshot);
    if (hasFourVisibleMetrics(closed.lines)) return closed;
  }
  closed = await enrichBottomMetricsFromFocusedOcr(screenshot, closed);
  if (hasFourVisibleMetrics(closed.lines)) return closed;

  // 切到下一条后的短暂首帧有时会显示“喜欢/分享/赞/评论”按钮文字，
  // 但数字尚未绘制；旧逻辑约一秒后就把这种真实播放器误判成不可恢复，
  // 导致右窗连续两次推进后停在恢复循环。只清理控制层并在原窗口被动补拍，
  // 不点击视频中心、不滑动，也不把未知指标当成不达标。
  await runSwiftControl(["key", "escape"]);
  await runSwiftControl(["move-relative", "0.02", "0.50"]);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 350 + attempt * 250));
    await captureWindow(screenshot);
    closed = await readOcr(screenshot);
    if (hasFourVisibleMetrics(closed.lines)
      || hasDefinitiveVisibleUnqualifiedMetrics(closed.lines)) return closed;
    if (attempt === 1 || attempt === 3) {
      closed = await enrichBottomMetricsFromFocusedOcr(screenshot, closed);
      if (hasFourVisibleMetrics(closed.lines)
        || hasDefinitiveVisibleUnqualifiedMetrics(closed.lines)) return closed;
    }
  }
  throw new Error("weixin_channels_previous_comments_close_not_confirmed");
}

async function confirmVisibleInteractionMetrics(screenshot: string, first: OcrResult) {
  let stableFirst = first;
  for (let attempt = 0;
    !hasFourVisibleMetrics(stableFirst.lines)
      && !hasDefinitiveVisibleUnqualifiedMetrics(stableFirst.lines)
      && attempt < 3;
    attempt += 1) {
    // OCR 对底部白色数字偶发漏帧；只被动补拍，不点击、不滑动，也不降低四项门槛。
    await new Promise((resolve) => setTimeout(resolve, 180));
    await captureWindow(screenshot);
    stableFirst = await readOcr(screenshot);
  }
  if (!hasFourVisibleMetrics(stableFirst.lines)
    && !hasDefinitiveVisibleUnqualifiedMetrics(stableFirst.lines)) {
    stableFirst = await enrichBottomMetricsFromFocusedOcr(screenshot, stableFirst);
    if (!hasFourVisibleMetrics(stableFirst.lines)
      && !hasDefinitiveVisibleUnqualifiedMetrics(stableFirst.lines)) {
      throw new Error("weixin_channels_qualification_metrics_not_visible");
    }
  }
  let second: OcrResult | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 160));
    await captureWindow(screenshot);
    let candidate = await readOcr(screenshot);
    if (!hasFourVisibleMetrics(candidate.lines)
      && !hasDefinitiveVisibleUnqualifiedMetrics(candidate.lines)) {
      candidate = await enrichBottomMetricsFromFocusedOcr(screenshot, candidate);
    }
    if (interactionMetricsConfirmed(stableFirst, candidate)
      || (hasDefinitiveVisibleUnqualifiedMetrics(stableFirst.lines)
        && hasDefinitiveVisibleUnqualifiedMetrics(candidate.lines)
        && sameVideoContinuity(stableFirst, candidate))) {
      second = candidate;
      break;
    }
  }
  if (!second) {
    throw new Error("weixin_channels_qualification_metrics_not_stable_across_snapshots");
  }
  return second;
}

async function ensureVideoPlayerVisible(screenshot: string, ocr: OcrResult) {
  let current = ocr;
  let recoveryAttempted = false;
  for (let attempt = 0; attempt < 2 && isWeixinChannelsAuxiliaryPage(current.lines); attempt += 1) {
    recoveryAttempted = true;
    process.stderr.write("auxiliary_page_closing\n");
    const mediaClosePoint = findMediaViewerClosePoint(current.lines);
    if (isWeixinChannelsMediaViewer(current.lines)) {
      if (mediaClosePoint) {
        await runSwiftControl(["click-relative", mediaClosePoint.x.toFixed(5), mediaClosePoint.y.toFixed(5)]);
      } else {
        await runSwiftControl(["key", "escape"]);
      }
    } else if (isWeixinChannelsPersonalDataPage(current.lines)) {
      const personalDataClosePoint = findPersonalDataTabClosePoint(current.lines);
      if (!personalDataClosePoint) throw new Error("weixin_channels_personal_data_close_not_proven");
      await runSwiftControl([
        "click-confirmed-personal-data-tab-close",
        personalDataClosePoint.x.toFixed(5),
        personalDataClosePoint.y.toFixed(5),
      ]);
      process.stderr.write("personal_data_page_close_requested\n");
    } else {
      // 搜索页是每窗保留的唯一搜索标签；只能切回“视频号”，不能关闭标签。
      const channelsTabPoint = findChannelsTabPoint(current.lines);
      if (!channelsTabPoint) throw new Error("weixin_channels_auxiliary_page_recovery_not_proven");
      await runSwiftControl(["click-relative", channelsTabPoint.x.toFixed(5), channelsTabPoint.y.toFixed(5)]);
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    await captureWindow(screenshot);
    current = await readOcr(screenshot);
  }
  if (isWeixinChannelsAuxiliaryPage(current.lines)) {
    throw new Error("weixin_channels_auxiliary_page_not_closed");
  }
  if (recoveryAttempted && !dedupIdentityFingerprint(current) && !hasFourVisibleMetrics(current.lines)) {
    throw new Error("weixin_channels_video_player_not_restored_after_auxiliary_page");
  }
  return current;
}

async function persistPendingFile(output: string, observation: unknown) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(observation, null, 2), "utf8");
  await fs.rename(temp, output);
}

export function buildIncompleteProgressBaseObservation(params: {
  observationId: string;
  taskId: string;
  query: string;
  videoIdentity: string;
  windowId: number;
  reason: string;
  ocr: OcrResult;
}) {
  const metrics = extractWeixinChannelsMetrics(params.ocr.lines);
  const identity = extractVisibleTitleAndAuthor(params.ocr.lines);
  return {
    version: 1,
    state: "incomplete" as const,
    eligibleForIngest: false as const,
    incompleteReason: params.reason,
    observationId: params.observationId,
    taskId: params.taskId,
    query: params.query,
    videoIdentity: params.videoIdentity,
    windowId: params.windowId,
    recordedAt: new Date().toISOString(),
    title: identity.title,
    author: identity.author,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    favorites: metrics.favorites,
    ocrLines: params.ocr.lines,
  };
}

async function persistIncompleteProgressBaseObservation(params: {
  screenshot: string;
  observation: ReturnType<typeof buildIncompleteProgressBaseObservation>;
}) {
  const stem = path.join(
    os.tmpdir(),
    `weixin-channels-incomplete-${params.observation.observationId}-${Date.now()}`,
  );
  const screenshotPath = `${stem}.png`;
  const observationPath = `${stem}.json`;
  await fs.copyFile(params.screenshot, screenshotPath);
  await persistPendingFile(observationPath, {
    ...params.observation,
    screenshotPath,
  });
  return { screenshotPath, observationPath };
}

export async function collectorPendingFileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

type PendingUploadPayload = {
  qualified?: boolean;
  invalid?: boolean;
  persisted?: boolean;
  newlyPersisted?: boolean;
  newlyQualifiedPersisted?: boolean;
  accumulatedQualifiedCount?: number;
  modelCalls?: number;
  results?: Array<{
    observationId?: string;
    newlyPersisted?: boolean;
    newlyQualifiedPersisted?: boolean;
    qualified?: boolean;
    invalid?: boolean;
    modelCalls?: number;
  }>;
};

export async function uploadPendingObservation(params: {
  server: string;
  token: string;
  taskId: string;
  pendingFile: string;
  deadlineAt?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  return uploadPendingObservationBatch({
    ...params,
    pendingFiles: [params.pendingFile],
  });
}

export async function uploadPendingObservationBatch(params: {
  server: string;
  token: string;
  taskId: string;
  pendingFiles: string[];
  deadlineAt?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  if (!params.pendingFiles.length || params.pendingFiles.length > 100) {
    throw new Error("pending_upload_batch_size_invalid");
  }
  return collectorUploadGate.run(() => uploadPendingObservationBatchUnlocked(params));
}

async function uploadPendingObservationBatchUnlocked(params: {
  server: string;
  token: string;
  taskId: string;
  pendingFiles: string[];
  deadlineAt?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  const observations = await Promise.all(params.pendingFiles.map(async (file) => {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as unknown;
  }));
  const controller = new AbortController();
  const requestDeadlineAt = params.timeoutMs === undefined
    ? params.deadlineAt
    : Date.now() + params.timeoutMs;
  const remaining = requestDeadlineAt === undefined ? undefined : remainingBudgetMs(requestDeadlineAt);
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
      body: JSON.stringify({ taskId: params.taskId, observations }),
      signal: controller.signal,
    });
    const response = timeoutPromise ? await Promise.race([request, timeoutPromise]) : await request;
    const body = response.text();
    const text = timeoutPromise ? await Promise.race([body, timeoutPromise]) : await body;
    if (!response.ok) throw new Error(`upload_failed:${response.status}:${text.slice(0, 500)}`);
    const payload = JSON.parse(text) as PendingUploadPayload;
    if (payload.persisted !== true) throw new Error("upload_not_persisted");
    if (params.pendingFiles.length > 1
      && (!Array.isArray(payload.results) || payload.results.length !== params.pendingFiles.length)) {
      throw new Error("upload_batch_result_count_mismatch");
    }
    await Promise.all(params.pendingFiles.map((file) => fs.unlink(file)));
    return payload;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type PendingObservationEnvelope = {
  observationId?: string;
  videoIdentity?: string;
  taskId?: string;
  query?: string;
  title?: string;
  runKind?: "formal" | "probe";
  collectorWindowId?: number;
  likes?: number;
  shares?: number;
  favorites?: number;
  videoDurationSec?: number;
  captureElapsedMs?: number;
  captureBudgetMs?: number;
  comments?: number;
  commentSamples?: unknown[];
  ocrTexts?: string[];
};

export function pendingObservationHasRequiredComments(observation: PendingObservationEnvelope) {
  const qualification = qualifyWeixinChannelsObservationLocally(observation);
  return qualification.qualified
    && (!qualification.requiresComments
      || (Array.isArray(observation.commentSamples) && observation.commentSamples.length > 0));
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
  const events: WeixinChannelsPersistedObservationEvent[] = [];
  const eligible: Array<{
    name: string;
    pendingFile: string;
    mtimeMs: number;
    observation: PendingObservationEnvelope & Record<string, unknown>;
  }> = [];
  for (const name of names) {
    const pendingFile = path.join(tempDir, name);
    try {
      const observation = JSON.parse(await fs.readFile(pendingFile, "utf8")) as PendingObservationEnvelope & Record<string, unknown>;
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
      const { mtimeMs } = await fs.stat(pendingFile);
      eligible.push({ name, pendingFile, mtimeMs, observation });
    } catch (error) {
      failed += 1;
      process.stderr.write(`pending_retry_failed:${name}:${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  const groups = new Map<string, typeof eligible>();
  for (const entry of eligible) {
    const taskId = entry.observation.taskId!;
    const group = groups.get(taskId) || [];
    group.push(entry);
    groups.set(taskId, group);
  }
  const selected = Array.from(groups.entries())
    .sort((left, right) => {
      const leftNewest = Math.max(...left[1].map((entry) => entry.mtimeMs));
      const rightNewest = Math.max(...right[1].map((entry) => entry.mtimeMs));
      return right[1].length - left[1].length
        || rightNewest - leftNewest
        || left[0].localeCompare(right[0]);
    })[0];
  if (selected) {
    const [taskId, entries] = selected;
    const batch = entries.slice(0, 100);
    try {
      const payload = await uploadPendingObservationBatch({
        server: params.server,
        token: params.token,
        taskId,
        pendingFiles: batch.map((entry) => entry.pendingFile),
        timeoutMs: 60_000,
        fetchImpl: params.fetchImpl,
      });
      persisted = batch.length;
      const resultByObservationId = new Map(
        (payload.results || []).map((result) => [String(result.observationId || ""), result]),
      );
      for (const entry of batch) {
        const observation = entry.observation;
        const result = resultByObservationId.get(String(observation.observationId || ""));
        const newlyPersisted = result?.newlyPersisted ?? payload.newlyPersisted === true;
        const newlyQualifiedPersisted = result?.newlyQualifiedPersisted
          ?? payload.newlyQualifiedPersisted === true;
        if (newlyQualifiedPersisted) persistedUnique += 1;
        else if (!newlyPersisted) duplicatePersistRejected += 1;
        const qualification = qualifyWeixinChannelsObservationLocally(observation);
        events.push({
          event: "observation_persisted",
          observationId: String(observation.observationId || ""),
          windowId: Number(observation.collectorWindowId || 0),
          query: String(observation.query || ""),
          runKind: observation.runKind === "probe" ? "probe" : "formal",
          qualified: qualification.qualified,
          serverQualified: result?.qualified ?? payload.qualified === true,
          persisted: true,
          newlyPersisted,
          newlyQualifiedPersisted,
          comments: Number(observation.comments || 0),
          commentSampleCount: Array.isArray(observation.commentSamples)
            ? observation.commentSamples.length
            : 0,
          captureElapsedMs: Number(observation.captureElapsedMs || 0),
          captureBudgetMs: observation.captureBudgetMs,
          modelCalls: Number(result?.modelCalls ?? payload.modelCalls ?? 0),
          analysisObservation: {
            ...observation,
            collectorWindowId: undefined,
            coverImageBase64: undefined,
            visualImageBase64: undefined,
          } as unknown as WeixinChannelsObservation,
        });
      }
      process.stderr.write(`pending_batch_recovered:${JSON.stringify({ taskId, count: batch.length })}\n`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (/weixin_channels_candidate_not_found/.test(message)) {
        const quarantineDir = path.join(tempDir, "weixin-channels-quarantine");
        await fs.mkdir(quarantineDir, { recursive: true });
        await Promise.all(batch.map((entry) => fs.rename(
          entry.pendingFile,
          path.join(quarantineDir, entry.name),
        )));
        process.stderr.write(`pending_batch_quarantined:${taskId}:${batch.length}:candidate_not_found\n`);
      } else {
        process.stderr.write(`pending_batch_retry_failed:${taskId}:${batch.length}:${message}\n`);
      }
    }
  }
  return { found: names.length, persisted, persistedUnique, duplicatePersistRejected, failed, events };
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

export function classifyLiveFrameBeforeAdvance(
  decided: OcrResult,
  live: OcrResult,
): "same_video" | "already_transitioned" | "unconfirmed" {
  if (sameVideoContinuity(decided, live)) return "same_video";
  const decidedIdentity = visibleVideoIdentityFingerprint(decided);
  const liveIdentity = visibleVideoIdentityFingerprint(live);
  if (decidedIdentity && liveIdentity && decidedIdentity === liveIdentity) return "same_video";
  if (hasConfirmedVideoTransition(decided, live)) return "already_transitioned";
  return "unconfirmed";
}

async function revalidateLiveFrameBeforeAdvance(decided: OcrResult, screenshot: string) {
  // 推荐流会在视频播完后自动切页。资格判断与真正执行滑动之间必须再次读取
  // 当前画面，否则会拿上一页的 OCR 决策去滑当前页，连续漏掉一至两条视频。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await captureWindow(screenshot);
    let live = await readOcr(screenshot);
    live = await ensureVideoPlayerVisible(screenshot, live);
    const state = classifyLiveFrameBeforeAdvance(decided, live);
    if (state === "same_video") return { state, ocr: live } as const;
    if (state === "already_transitioned") {
      // 自动切到的新页也必须连续两帧保持同一身份与四项指标，确认后交回
      // 主循环处理；这里绝不再补一次滑动。
      const stable = await confirmVisibleInteractionMetrics(screenshot, live);
      if (!sameVideoContinuity(live, stable)) continue;
      return { state, ocr: stable } as const;
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  throw new Error("weixin_channels_live_frame_before_advance_unconfirmed");
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
    if (hasConfirmedVideoTransition(previous, next)) {
      // 滑动后的第一帧可能仍是转场或上一条残影。只有第二帧证明仍是同一
      // 新视频，才允许主循环在它上面做资格判断。
      await new Promise((resolve) => setTimeout(resolve, 160));
      await captureWindow(screenshot);
      const stable = await readOcr(screenshot);
      if (sameVideoContinuity(next, stable)) return stable;
    }
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

async function searchKeyword(
  keyword: string,
  screenshot: string,
  options: { rawSort?: "latest" | "hottest" } = {},
) {
  const safeKeyword = normalizeWeixinChannelsSearchQuery(keyword);
  if (!safeKeyword) throw new Error("weixin_channels_search_keyword_rejected");
  keyword = safeKeyword;
  const collectorSearchTabState = await getCollectorSearchTabState();
  await persistCollectorSearchTabState(collectorSearchTabState);
  await captureWindow(screenshot);
  let ocr = await readOcr(screenshot);
  let point = findSearchInputPoint(ocr.lines);
  let openedSearchThisAttempt = false;
  if (!point && shouldReuseExistingSearchTab(collectorSearchTabState.openedTabs)) {
    // 已有一个脚本搜索标签时，先关闭当前活动页并尝试复用；推荐页加搜索页
    // 总数最多两个，禁止每轮搜索都新增标签把微信内存撑满。
    if (collectorSearchTabState.ownerPid !== process.pid && processIsAlive(collectorSearchTabState.ownerPid)) {
      throw new Error("weixin_channels_search_tab_ownership_unconfirmed");
    }
    collectorSearchTabState.ownerPid = process.pid;
    await persistCollectorSearchTabState(collectorSearchTabState);
    const searchTabPoint = findAnySearchTabPoint(ocr.lines);
    if (!searchTabPoint) {
      // 状态文件可能来自已关闭标签；当前页必须先证明仍是播放器才可重置。
      if (!dedupIdentityFingerprint(ocr) && !hasFourVisibleMetrics(ocr.lines)) {
        throw new Error("weixin_channels_search_tab_not_found_for_reuse");
      }
      collectorSearchTabState.openedTabs = 0;
      collectorSearchTabState.ownerPid = undefined;
      await persistCollectorSearchTabState(collectorSearchTabState);
    } else {
      await runSwiftControl(["click-relative", searchTabPoint.x.toFixed(5), searchTabPoint.y.toFixed(5)]);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await captureWindow(screenshot);
      ocr = await readOcr(screenshot);
      point = findSearchInputPoint(ocr.lines);
    }
  }
  if (!point) {
    if (collectorSearchTabState.openedTabs >= 1
      || totalCollectorSearchTabs() >= WEIXIN_CHANNELS_MAX_TOTAL_SEARCH_TABS) {
      throw new Error("weixin_channels_search_tab_limit_reached");
    }
    // 顶栏放大镜使用动态窗口相对坐标。每次搜索最多点击一次；加载较慢时
    // 只轮询 OCR，不得重复点击并意外再开一个标签。
    collectorSearchTabState.openedTabs += 1;
    collectorSearchTabState.ownerPid = process.pid;
    await persistCollectorSearchTabState(collectorSearchTabState);
    openedSearchThisAttempt = true;
  }
  const inputPoint = point
    || await loadCollectorSearchCalibration()
    || findSearchButtonPoint(ocr.lines);
  if (!inputPoint) throw new Error("weixin_channels_search_button_not_proven");
  let submitted: OcrResult | undefined;
  // 打开新搜索页时只允许点击一次放大镜；后续加载失败只能退出恢复，不能重复
  // 点击并创建多个搜索标签。复用已证明的输入框时才允许一次重输。
  const inputAttempts = point ? 2 : 1;
  for (let attempt = 0; attempt < inputAttempts; attempt += 1) {
    await runSwiftControl([
      "open-search-and-type",
      inputPoint.x.toFixed(5),
      inputPoint.y.toFixed(5),
      keyword,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await captureWindow(screenshot);
    submitted = await readOcr(screenshot);
    if (hasSubmittedSearchKeyword(submitted.lines, keyword)
      && findSearchVideosTabPoint(submitted.lines)) break;
    const submitPoint = findSearchSubmitPoint(submitted.lines);
    if (hasSubmittedSearchKeyword(submitted.lines, keyword) && submitPoint) {
      await runSwiftControl([
        "click-confirmed-search-submit",
        submitPoint.x.toFixed(5),
        submitPoint.y.toFixed(5),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await captureWindow(screenshot);
      submitted = await readOcr(screenshot);
      if (hasSubmittedSearchKeyword(submitted.lines, keyword)
        && findSearchVideosTabPoint(submitted.lines)) break;
    }
  }
  if (openedSearchThisAttempt && !submitted) {
    throw new Error("weixin_channels_search_input_not_confirmed_after_single_tab_open");
  }
  if (!submitted) throw new Error("weixin_channels_search_keyword_not_captured");
  const videosTab = findSearchVideosTabPoint(submitted.lines);
  if (!videosTab) throw new Error("weixin_channels_search_videos_tab_not_confirmed");
  await runSwiftControl(["click-relative", videosTab.x.toFixed(5), videosTab.y.toFixed(5)]);
  const waitForSortControls = async () => {
    let pageOcr = submitted!;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 350 : 220));
      await captureWindow(screenshot);
      pageOcr = await readOcr(screenshot);
      const latestPoint = findSearchSortPoint(pageOcr.lines, "latest");
      const hottestPoint = findSearchSortPoint(pageOcr.lines, "hottest");
      if (latestPoint && hottestPoint) return { ocr: pageOcr, latestPoint, hottestPoint };
    }
    return null;
  };
  let controls = await waitForSortControls();
  if (!controls) {
    // 只允许对当前 OCR 仍能证明的“影片”补点一次；没有影片/排序栏就立即
    // 退出本词，不能进入整窗 5/10/20 秒恢复。
    const confirmedVideosTab = findSearchVideosTabPoint(submitted.lines);
    if (confirmedVideosTab) {
      await runSwiftControl([
        "click-relative",
        confirmedVideosTab.x.toFixed(5),
        confirmedVideosTab.y.toFixed(5),
      ]);
      controls = await waitForSortControls();
    }
  }
  if (!controls) throw new Error("weixin_channels_search_video_sorts_not_confirmed");
  submitted = controls.ocr;

  const inspectSort = async (
    sort: "latest" | "hottest",
    point: { x: number; y: number },
    rawAnyCandidate = false,
  ) => {
    await runSwiftControl(["click-relative", point.x.toFixed(5), point.y.toFixed(5)]);
    await waitForVisibleVideoLoad();
    const pages: WeixinChannelsSearchSortSummary[] = [];
    let pageOcr = submitted!;
    let currentPageSummary: WeixinChannelsSearchSortSummary | undefined;
    for (let page = 0; page < 4; page += 1) {
      await captureWindow(screenshot);
      pageOcr = await readOcr(screenshot);
      const summary = summarizeSearchSort(pageOcr.lines, keyword);
      currentPageSummary = summary;
      pages.push(summary);
      process.stderr.write(`search_sort_page_inspected:${JSON.stringify({ keyword, sort, page: page + 1, summary })}\n`);
      // 点击坐标只能来自当前帧。“最新”只接受十五天内高播；“最热门”接受
      // 旧爆款。命中即停，禁止滚到后页后再使用前页的旧坐标。
      const currentPoint = rawAnyCandidate
        ? summary.firstMatchingPoint
        : sort === "latest"
          ? summary.firstRecentHighPlayPoint
          : summary.firstHighPlayPoint;
      if (currentPoint) break;
      if (page >= 1 && pages.slice(-2).every((item) => item.matchingCount === 0)) break;
      await runSwiftControl(["scroll-relative", "0.75", "0.68", "-6"]);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return {
      ocr: pageOcr,
      summary: mergeSearchSortSummaries(pages),
      currentPageSummary: currentPageSummary || summarizeSearchSort(pageOcr.lines, keyword),
    };
  };

  const emptySummary = (): WeixinChannelsSearchSortSummary => ({
    matchingCount: 0,
    recentMatchingCount: 0,
    newestMatchingAgeDays: undefined,
    maxVisiblePlayCount: 0,
    recentHighPlayCount: 0,
    firstRecentHighPlayPoint: undefined,
    firstHighPlayPoint: undefined,
    firstMatchingPoint: undefined,
  });

  if (options.rawSort) {
    const point = options.rawSort === "latest" ? controls.latestPoint : controls.hottestPoint;
    const inspection = await inspectSort(options.rawSort, point, true);
    return {
      latestOcr: inspection.ocr,
      hottestOcr: inspection.ocr,
      latest: options.rawSort === "latest" ? inspection.summary : emptySummary(),
      hottest: options.rawSort === "hottest" ? inspection.summary : emptySummary(),
      selectedSort: inspection.currentPageSummary.firstMatchingPoint
        ? options.rawSort
        : undefined,
      selectedCurrentPage: inspection.currentPageSummary,
      rawSelectedPoint: inspection.currentPageSummary.firstMatchingPoint,
    };
  }

  // 用户契约：影片 → 最新；十五天内流量低才检查最热门。
  const latestInspection = await inspectSort("latest", controls.latestPoint);
  const latestPlan = planSearchResultSelection({
    latestCurrentPage: latestInspection.currentPageSummary,
  });
  if (latestPlan.action === "open") {
    const hottest = emptySummary();
    process.stderr.write(`search_topic_inspected:${JSON.stringify({
      keyword,
      selectedSort: "latest",
      latest: latestInspection.summary,
      hottest,
    })}\n`);
    return {
      latestOcr: latestInspection.ocr,
      hottestOcr: latestInspection.ocr,
      latest: latestInspection.summary,
      hottest,
      selectedSort: latestPlan.sourceSort,
      selectedCurrentPage: latestInspection.currentPageSummary,
    };
  }

  // 最新滚动后排序栏可能离开视野；向上恢复并重新 OCR，绝不用旧坐标。
  let hottestControls: { ocr: OcrResult; latestPoint: { x: number; y: number }; hottestPoint: { x: number; y: number } } | null = null;
  for (let attempt = 0; attempt < 4 && !hottestControls; attempt += 1) {
    await runSwiftControl(["scroll-relative", "0.75", "0.32", "20"]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await captureWindow(screenshot);
    const restoredOcr = await readOcr(screenshot);
    const latestPoint = findSearchSortPoint(restoredOcr.lines, "latest");
    const hottestPoint = findSearchSortPoint(restoredOcr.lines, "hottest");
    if (latestPoint && hottestPoint) hottestControls = { ocr: restoredOcr, latestPoint, hottestPoint };
  }
  if (!hottestControls) throw new Error("weixin_channels_search_sort_controls_not_restored");
  submitted = hottestControls.ocr;
  const hottestInspection = await inspectSort("hottest", hottestControls.hottestPoint);
  const finalPlan = planSearchResultSelection({
    latestCurrentPage: latestInspection.currentPageSummary,
    hottestCurrentPage: hottestInspection.currentPageSummary,
  });
  process.stderr.write(`search_topic_inspected:${JSON.stringify({
    keyword,
    selectedSort: finalPlan.action === "open" ? finalPlan.sourceSort : "recommendation",
    latest: latestInspection.summary,
    hottest: hottestInspection.summary,
  })}\n`);
  return {
    latestOcr: latestInspection.ocr,
    hottestOcr: hottestInspection.ocr,
    latest: latestInspection.summary,
    hottest: hottestInspection.summary,
    selectedSort: finalPlan.action === "open" ? finalPlan.sourceSort : undefined,
    selectedCurrentPage: hottestInspection.currentPageSummary,
  };
}

async function closeSearchTabAndRestore(
  keyword: string,
  screenshot: string,
  state: CollectorSearchTabState,
  _targetOpenedTabs: number,
) {
  await captureWindow(screenshot);
  let visible = await readOcr(screenshot);
  // 搜索结果打开播放器后，当前活动页可能已经是视频号。先用 OCR 识别搜索
  // 标签文字并点击其左侧安全区；不能直接猜 X，也不能关闭整个微信窗口。
  if (dedupIdentityFingerprint(visible) || hasFourVisibleMetrics(visible.lines)) {
    const searchTabPoint = findAnySearchTabPoint(visible.lines);
    if (!searchTabPoint) {
      if (state.openedTabs > 0) {
        throw new Error("weixin_channels_search_tab_not_proven_for_close");
      }
      state.openedTabs = 0;
      state.ownerPid = undefined;
      await persistCollectorSearchTabState(state);
      return visible;
    }
    await runSwiftControl([
      "click-relative",
      searchTabPoint.x.toFixed(5),
      searchTabPoint.y.toFixed(5),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await captureWindow(screenshot);
    visible = await readOcr(screenshot);
  }
  // 只有“影片”页、排序器或当前关键词可见时，才证明活动页确为搜索页。
  // 再识别右侧搜索标签 X，走只能命中右侧 X 槽的 Swift 专用动作。
  const searchPageConfirmed = Boolean(findSearchVideosTabPoint(visible.lines))
    || Boolean(findSearchSortPoint(visible.lines, "latest") && findSearchSortPoint(visible.lines, "hottest"))
    || hasTypedSearchKeyword(visible.lines, keyword);
  if (!searchPageConfirmed) throw new Error("weixin_channels_search_page_not_confirmed_for_close");
  const closePoint = findSearchTabClosePoint(visible.lines);
  if (!closePoint) throw new Error("weixin_channels_search_tab_close_not_proven");
  await runSwiftControl([
    "click-confirmed-search-tab-close",
    closePoint.x.toFixed(5),
    closePoint.y.toFixed(5),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 700));
  await captureWindow(screenshot);
  const restored = await readOcr(screenshot);
  if (!dedupIdentityFingerprint(restored) && !hasFourVisibleMetrics(restored.lines)) {
    throw new Error("weixin_channels_search_original_video_not_restored");
  }
  state.openedTabs = 0;
  state.ownerPid = undefined;
  await persistCollectorSearchTabState(state);
  return restored;
}

async function runBoundedSearchProbe(keyword: string, screenshot: string) {
  const state = await getCollectorSearchTabState();
  const beforeOpenedTabs = state.openedTabs;
  let openedByProbe = false;
  let latestResults: Awaited<ReturnType<typeof searchKeyword>> | undefined;
  try {
    const results = await searchKeyword(keyword, screenshot);
    latestResults = results;
    openedByProbe = state.openedTabs > beforeOpenedTabs && state.ownerPid === process.pid;
    return {
      ok: Boolean(results.selectedSort),
      keyword,
      latest: results.latest,
      hottest: results.hottest,
      openedTabs: state.openedTabs,
    };
  } finally {
    openedByProbe ||= state.openedTabs > beforeOpenedTabs && state.ownerPid === process.pid;
    openedByProbe ||= Boolean(latestResults);
    if (openedByProbe) {
      await closeSearchTabAndRestore(keyword, screenshot, state, beforeOpenedTabs);
    }
  }
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
  const normalized = String(text || "").replace(/[,，\s＋+]/g, "").replace(/^[~～≈≃]+/, "");
  if (!/^\d+(?:\.\d+)?(?:万|萬|w|W)?$/.test(normalized)) return undefined;
  return parseVisibleMetric(normalized);
}

type WeixinChannelsMetricSlot = "likes" | "shares" | "favorites" | "comments";

function parseBottomMetricForSlot(text: string, slot: WeixinChannelsMetricSlot) {
  const parsed = parseStandaloneMetric(text);
  if (parsed !== undefined) return parsed;
  if (slot !== "likes") return undefined;
  // Vision 偶尔把点赞图标和首位 4 合并为“［A609”。只在底部点赞槽位
  // 接受这一种受限纠错，避免把画面正文中的 A+数字误当互动指标。
  const normalized = String(text || "").replace(/[,，\s＋+]/g, "");
  const mistakenFour = normalized.match(/^[\[［(（|丨I]?A(\d{2,})(万|萬|w|W)?$/i);
  if (!mistakenFour) return undefined;
  return parseVisibleMetric(`4${mistakenFour[1]}${mistakenFour[2] || ""}`);
}

function assignBottomMetricSlots(lines: OcrLine[]) {
  const slots = [
    { key: "likes", x: 0.53 },
    { key: "shares", x: 0.65 },
    { key: "favorites", x: 0.77 },
    { key: "comments", x: 0.89 },
  ] as const;
  const assigned: Partial<Record<WeixinChannelsMetricSlot, { line: OcrLine; value: number }>> = {};
  const candidates = lines
    .filter((line) => line.confidence >= 0.25 && line.y < 0.13 && line.x >= 0.42)
    .map((line) => ({ line, centerX: line.x + line.width / 2 }))
    .sort((left, right) => left.centerX - right.centerX);
  for (const candidate of candidates) {
    const nearest = slots
      .filter((slot) => !assigned[slot.key])
      .map((slot) => ({ ...slot, distance: Math.abs(candidate.centerX - slot.x) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest || nearest.distance > 0.08) continue;
    const value = parseBottomMetricForSlot(candidate.line.text.trim(), nearest.key);
    if (value === undefined) continue;
    assigned[nearest.key] = { line: candidate.line, value };
  }
  return assigned;
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
  // 当前桌面版常只显示横排数字而无文字标签。按每行中心点匹配真实槽位；
  // OCR 漏掉或轻微错读一项时保留其余指标，不能整组丢弃。
  if (Object.values(result).filter((value) => value !== undefined).length < 2) {
    const slots = assignBottomMetricSlots(lines);
    for (const key of ["likes", "shares", "favorites", "comments"] as const) {
      if (slots[key]) result[key] = slots[key]!.value;
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

type CollectorHeartbeat = {
  enabled: boolean;
  controlRevision?: number;
  formalQualifiedTotal?: number;
  nextTask?: HeartbeatTask;
};

export function collectorControlStopReason(
  baselineRevision: number | undefined,
  heartbeat: Pick<CollectorHeartbeat, "enabled" | "controlRevision">,
) {
  if (!heartbeat.enabled) return "capture_disabled" as const;
  if (baselineRevision !== undefined
    && heartbeat.controlRevision !== undefined
    && heartbeat.controlRevision !== baselineRevision) {
    return "capture_control_changed" as const;
  }
  return null;
}

export function shouldRestartCollectorSupervisorAfterStop(reason: string) {
  return reason.startsWith("capture_disabled") || reason === "capture_control_changed";
}

async function heartbeatCollector(server: string, token: string, clientId: string) {
  const response = await fetch(`${server.replace(/\/$/, "")}/api/internal/weixin-channels/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-weixin-channels-collector-token": token },
    body: JSON.stringify({ clientId }),
    signal: AbortSignal.timeout(WEIXIN_CHANNELS_HTTP_CONTROL_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`heartbeat_failed:${response.status}:${text.slice(0, 500)}`);
  return JSON.parse(text) as CollectorHeartbeat;
}

async function waitForCollectorWebToggleEnabled(server: string, token: string) {
  const clientId = `mac-weixin-${os.hostname()}`.slice(0, 120);
  let waitingLogged = false;
  for (;;) {
    const heartbeat = await heartbeatCollector(server, token, clientId);
    if (heartbeat.enabled) {
      if (waitingLogged) process.stderr.write("collector_web_toggle_enabled\n");
      return heartbeat;
    }
    if (!waitingLogged) {
      process.stderr.write("collector_waiting_for_web_toggle\n");
      waitingLogged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

async function waitForCollectorRecoveryDelay(params: {
  delayMs: number;
  server: string;
  token: string;
  shared: CollectorSharedRuntime;
}) {
  const clientId = `mac-weixin-${os.hostname()}`.slice(0, 120);
  const deadlineAt = Date.now() + params.delayMs;
  while (Date.now() < deadlineAt) {
    if (params.shared.abortReason) return params.shared.abortReason;
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(1_000, Math.max(0, deadlineAt - Date.now())),
    ));
    try {
      const heartbeat = await heartbeatCollector(params.server, params.token, clientId);
      const reason = params.shared.observeHeartbeat(heartbeat);
      if (reason) return reason;
    } catch (error) {
      // 网络瞬断不能把 UI 恢复误判成网页停采；保留本轮退避并由后续心跳重试。
      process.stderr.write(`collector_recovery_heartbeat_failed:${
        error instanceof Error ? error.message : String(error)
      }\n`);
    }
  }
  return null;
}

type CollectorCandidate = HeartbeatTask & {
  status?: "pending" | "claimed" | "scanned";
  sourcePlatform?: string;
  category?: string;
  sourceTitle?: string;
  createdAt?: string;
};

const BLOCKED_DRAMA_QUERY = /(短剧|短劇|剧场|劇場|免费看|免費看|追剧|追劇|看剧|看劇|原创动画|原創動畫|男频|男頻|女频|女頻|爽文|爽剧|爽劇)/i;
const ALLOWED_COLLECTOR_SEARCH_PLATFORMS = new Set(["douyin", "xiaohongshu"]);

export function compactCollectorSearchQuery(value: string) {
  const normalized = normalizeWeixinChannelsSearchQuery(value);
  if (!normalized) return undefined;
  let compact = normalized
    .normalize("NFKC")
    .replace(/[\s#＃，,。.!！?？:：'“”"·…⋯()（）【】\[\]<>《》]/g, "")
    .replace(/^(?:聊聊|说说|說說|看看|盘点|盤點|关于|關於)+/, "")
    .replace(/^(?:这家|這家|一个|一個|普通人)+/, "")
    .replace(/^(?:如何用|怎么用|怎麼用|如何|为什么|為什麼)+/, "")
    .replace(/的/g, "")
    .replace(/真(?=牛$)/, "");
  // 不靠模型时只保留可搜索的短名词主题。问句、语义残片和“鱼感”这类
  // 平台标题截断物会把右窗带到 AI 问答/全部页，必须在输入微信前拒绝。
  if (/^(?:谁|誰|什么|什麼|为何|為何|为什么|為什麼|怎么|怎麼|如何|有没有|有沒有|是否)/.test(compact)
    || /(?:谁考虑|誰考慮|考虑过|考慮過|无所谓|無所謂|鱼感|魚感)/.test(compact)) {
    return undefined;
  }
  const chars = Array.from(compact);
  if (chars.length < 4) return undefined;
  if (chars.length > 6) compact = chars.slice(0, 6).join("");
  return compact;
}

export function collectorSearchQueryVariants(value: string) {
  const compact = compactCollectorSearchQuery(value);
  if (!compact) return [];
  const variants = [compact];
  if (compact === "公司价值观" || compact === "公司價值觀") {
    variants.push("企业价值观", "企业文化");
  } else if (compact === "企业价值观" || compact === "企業價值觀") {
    variants.push("公司价值观", "企业文化");
  } else if (compact === "企业文化" || compact === "企業文化") {
    variants.push("公司价值观", "企业价值观");
  }
  const chars = Array.from(compact);
  if (chars.length >= 5 && /[牛火強强好讚赞]$/.test(compact)) {
    variants.push(chars.slice(0, -1).join(""));
  }
  return Array.from(new Set(variants
    .map((query) => compactCollectorSearchQuery(query))
    .filter((query): query is string => Boolean(query))));
}

export function buildDiverseCollectorSearchQueries(params: {
  candidates: CollectorCandidate[];
  seedQueries?: string[];
  recentlyUsed?: string[];
  limit?: number;
}) {
  const recentlyUsed = new Set((params.recentlyUsed || [])
    .map((item) => compactCollectorSearchQuery(item)?.toLowerCase())
    .filter((item): item is string => Boolean(item)));
  const byCategory = new Map<string, string[]>();
  const ranked = params.candidates
    .filter((item) => ALLOWED_COLLECTOR_SEARCH_PLATFORMS.has(String(item.sourcePlatform || "")))
    .filter((item) => !/probe|test[-_/ ]?run/i.test(`${item.taskId} ${item.category || ""}`))
    .sort((left, right) => {
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
        for (const variant of collectorSearchQueryVariants(query)) {
          if (BLOCKED_DRAMA_QUERY.test(variant) || bucket.includes(variant)) continue;
          bucket.push(variant);
        }
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
  // 跨类目轮询到所有真实十五天候选耗尽，避免旧实现只取前三轮、后续新词永远进不了词池。
  const maxRounds = Math.max(0, ...Array.from(byCategory.values(), (bucket) => bucket.length));
  for (let round = 0; round < maxRounds; round += 1) {
    for (const bucket of Array.from(byCategory.values())) {
      if (bucket[round]) append(bucket[round]!);
    }
  }
  for (const query of params.seedQueries || []) {
    for (const normalized of deriveWeixinChannelsSearchQueries(query)) {
      for (const variant of collectorSearchQueryVariants(normalized)) {
        if (!BLOCKED_DRAMA_QUERY.test(variant)) append(variant);
      }
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
  const taskSource = params.candidates.find((candidate) => candidate.taskId === params.task.taskId);
  const seedQueries = taskSource
    && ALLOWED_COLLECTOR_SEARCH_PLATFORMS.has(String(taskSource.sourcePlatform || ""))
    ? params.task.searchQueries
    : [];
  return {
    ...params.task,
    searchQueries: buildDiverseCollectorSearchQueries({
      candidates: params.candidates,
      seedQueries,
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

async function refreshCollectorCandidates(server: string, token: string, refresh = true) {
  const response = await fetch(
    `${server.replace(/\/$/, "")}/api/internal/weixin-channels/candidates${refresh ? "" : "?refresh=0"}`,
    {
      headers: { "x-weixin-channels-collector-token": token },
      signal: AbortSignal.timeout(WEIXIN_CHANNELS_HTTP_CONTROL_TIMEOUT_MS),
    },
  );
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
    {
      headers: { "x-weixin-channels-collector-token": params.token },
      signal: AbortSignal.timeout(WEIXIN_CHANNELS_HTTP_CONTROL_TIMEOUT_MS),
    },
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

export type WeixinChannelsPersistedObservationEvent = {
  event: "observation_persisted";
  observationId: string;
  windowId: number;
  query: string;
  runKind: "formal" | "probe";
  qualified: boolean;
  serverQualified: boolean;
  persisted: boolean;
  newlyPersisted: boolean;
  newlyQualifiedPersisted: boolean;
  comments: number;
  commentSampleCount: number;
  captureElapsedMs: number;
  captureBudgetMs?: number;
  modelCalls: number;
  analysisObservation: WeixinChannelsObservation;
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
  deferUpload?: boolean;
  titleOverride?: string;
  authorOverride?: string;
  outputOverride?: string;
  videoDurationHintSec?: number;
  currentVideoStartedAt?: number;
  retryCache: VideoCaptureRetryCache;
  onObservationPersisted?: (event: WeixinChannelsPersistedObservationEvent) => void;
}) {
  // 同一视频主循环只创建一次时钟，retry 不得重新获得 40 秒额度。
  const captureStartedAt = params.currentVideoStartedAt ?? Date.now();
  const metricsStartedAt = Date.now();
  const metrics = extractWeixinChannelsMetrics(params.ocr.lines);
  const identity = extractVisibleTitleAndAuthor(params.ocr.lines);
  recordCollectorPhase(params.diagnostics, "metricsOcr", metricsStartedAt);
  const actualMetrics = [metrics.likes, metrics.comments, metrics.shares, metrics.favorites]
    .filter((value) => value !== undefined);
  const definitiveUnqualified = hasDefinitiveVisibleUnqualifiedMetrics(params.ocr.lines);
  if (actualMetrics.length < 4) {
    if (definitiveUnqualified) {
      params.diagnostics.locallyUnqualified += 1;
      return {
        qualified: false as const,
        reason: "至少两项前置互动明确低于门槛",
        fingerprint: params.videoIdentity,
      };
    }
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
    if (!definitiveUnqualified
      && (metrics.comments || 0) >= WEIXIN_CHANNELS_COMMENT_THRESHOLD) {
      // 评论很高的视频一旦被 OCR 暂判为前置不达标，滑走前必须再做一轮完全
      // 被动的四项复核。复核升级为高热或无法证明仍是同一视频时都抛给当前
      // 视频恢复链，绝不能先滑走再依赖用户手动找回来。
      await new Promise((resolve) => setTimeout(resolve, 180));
      await captureWindow(params.screenshot);
      let advanceGuardOcr = await readOcr(params.screenshot);
      advanceGuardOcr = await ensureInteractionMetricsVisible(params.screenshot, advanceGuardOcr);
      advanceGuardOcr = await confirmVisibleInteractionMetrics(params.screenshot, advanceGuardOcr);
      if (!sameVideoContinuity(params.ocr, advanceGuardOcr)) {
        throw new Error("weixin_channels_unqualified_advance_same_video_not_proven");
      }
      const guardMetrics = extractWeixinChannelsMetrics(advanceGuardOcr.lines);
      const guardQualification = qualifyWeixinChannelsObservationLocally({
        ...guardMetrics,
        query: params.query,
        title: extractVisibleTitleAndAuthor(advanceGuardOcr.lines).title || title,
      });
      process.stderr.write(`unqualified_advance_guard:${JSON.stringify({
        videoIdentity: params.videoIdentity,
        metrics,
        guardMetrics,
        qualified: guardQualification.qualified,
        requiresComments: guardQualification.requiresComments,
      })}\n`);
      if (guardQualification.qualified) {
        throw new Error("weixin_channels_qualification_promoted_before_advance");
      }
    }
    params.diagnostics.locallyUnqualified += 1;
    if ((metrics.comments || 0) < WEIXIN_CHANNELS_COMMENT_THRESHOLD) params.diagnostics.commentsBelowThreshold += 1;
    return { qualified: false as const, reason: preliminary.reason, fingerprint: params.videoIdentity };
  }

  const author = params.authorOverride || identity.author;
  const reusedSampling = Boolean(params.retryCache.sampled);
  let sampled = params.retryCache.sampled;
  if (!sampled) {
    if (collectorCurrentVideoUiDisposition(captureStartedAt) !== "continue") {
      throw new Error("weixin_channels_current_video_ui_soft_retreat_reached");
    }
    if (params.retryCache.samplingAttempts >= 1) {
      // 同一视频的内容抽查只允许启动一次；进度条未出现也不得再次操作播放器。
      throw new Error("weixin_channels_content_sampling_retry_exhausted");
    }
    params.retryCache.samplingAttempts += 1;
    const samplingStartedAt = Date.now();
    sampled = collectorSamplingModeForComments(metrics.comments || 0) === "five_point_comments"
      ? await sampleVideoContentAtProgress(
        params.screenshot,
        metrics,
        captureStartedAt,
        params.videoDurationHintSec,
      )
      : await captureSingleRepresentativeFrame(
        params.screenshot,
        params.ocr,
        captureStartedAt,
      );
    recordCollectorPhase(params.diagnostics, "contentSampling", samplingStartedAt);
    params.retryCache.sampled = sampled;
    params.retryCache.samplingActiveMs = Date.now() - captureStartedAt;
  } else {
    // 评论或上传阶段恢复时复用已经完成的五点结果，不再次拖动。
    sampled = {
      ...sampled,
      deadlineAt: captureStartedAt + Math.max(
        1_000,
        (sampled.videoDurationSec
          ? captureBudgetMsForVideo(sampled.videoDurationSec)
          : WEIXIN_CHANNELS_UNKNOWN_DURATION_CAPTURE_BUDGET_MS)
          - (params.retryCache.samplingActiveMs || 0),
      ),
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
  if (sampledCapturePersistenceDisposition({
    advertisementDetected: adDetected,
    qualified: finalQualification.qualified,
  }) === "reject_without_persist") {
    // 抽查帧才出现的广告与首屏广告遵守同一契约：立即淘汰，不构造 pending、
    // 不调用 Fly。这样即使服务端 schema 能表示 invalid 记录，也不会污染入库。
    params.diagnostics.locallyUnqualified += 1;
    return {
      qualified: false as const,
      inspectedContent: true as const,
      reason: finalQualification.reason,
      fingerprint: params.videoIdentity,
    };
  }
  let ocr = params.ocr;
  let commentSamples: WeixinChannelsCommentSample[] | undefined;
  if (!adDetected && finalQualification.requiresComments && (metrics.comments || 0) >= WEIXIN_CHANNELS_COMMENT_THRESHOLD) {
    if (collectorCurrentVideoUiDisposition(captureStartedAt) !== "continue") {
      throw new Error("weixin_channels_current_video_ui_soft_retreat_reached");
    }
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
  const captureElapsedMs = (reusedSampling ? (params.retryCache.samplingActiveMs || 0) : 0)
    + (Date.now() - captureStartedAt);
  const captureBudgetMs = videoDurationSec
    ? captureBudgetMsForVideo(videoDurationSec)
    : WEIXIN_CHANNELS_UNKNOWN_DURATION_CAPTURE_BUDGET_MS;
  if (captureElapsedMs > captureBudgetMs) {
    process.stderr.write(`collector_capture_soft_limit_exceeded:${JSON.stringify({
      windowId: requireCollectorWindowSession().windowId,
      observationId: params.observationId,
      captureElapsedMs,
      softLimitMs: captureBudgetMs,
    })}\n`);
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
    // 仅用于本机 pending 的回调与去重；服务端 Zod 白名单会剥离该字段。
    collectorWindowId: requireCollectorWindowSession().windowId,
  };
  const output = params.outputOverride
    || path.join(os.tmpdir(), `weixin-channels-pending-${observation.observationId}.json`);
  await persistPendingFile(output, observation);
  if (params.deferUpload) {
    process.stderr.write(`collector_observation_queued:${JSON.stringify({
      observationId: observation.observationId,
      windowId: observation.collectorWindowId,
      captureElapsedMs: observation.captureElapsedMs,
      pendingFile: output,
    })}\n`);
    return {
      qualified: finalQualification.qualified,
      inspectedContent: true as const,
      reason: finalQualification.reason,
      fingerprint: params.videoIdentity,
      observation,
      queuedForUpload: true as const,
      persisted: false,
      newlyPersisted: false,
      serverQualified: false,
      newlyQualifiedPersisted: false,
    };
  }
  let persisted = false;
  let newlyPersisted = false;
  let serverQualified = false;
  let newlyQualifiedPersisted = false;
  let modelCalls = 0;
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
        timeoutMs: 12_000,
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
    newlyPersisted = payload.newlyPersisted === true;
    serverQualified = payload.qualified === true;
    newlyQualifiedPersisted = payload.newlyQualifiedPersisted === true;
    modelCalls = Number(payload.modelCalls || 0);
    if (modelCalls !== 0) throw new Error("weixin_channels_capture_model_call_detected");
  }
  const persistedEvent: WeixinChannelsPersistedObservationEvent = {
    event: "observation_persisted",
    observationId: observation.observationId,
    windowId: requireCollectorWindowSession().windowId,
    query: observation.query,
    runKind: observation.runKind,
    qualified: finalQualification.qualified,
    serverQualified,
    persisted,
    newlyPersisted,
    newlyQualifiedPersisted,
    comments: observation.comments || 0,
    commentSampleCount: observation.commentSamples?.length || 0,
    captureElapsedMs: observation.captureElapsedMs,
    captureBudgetMs: observation.captureBudgetMs,
    modelCalls,
    analysisObservation: {
      ...observation,
      coverImageBase64: undefined,
      visualImageBase64: undefined,
    },
  };
  params.onObservationPersisted?.(persistedEvent);
  process.stdout.write(`${JSON.stringify(persistedEvent)}\n`);
  return {
    qualified: finalQualification.qualified,
    inspectedContent: true as const,
    reason: finalQualification.reason,
    fingerprint: params.videoIdentity,
    observation,
    persisted,
    newlyPersisted,
    serverQualified,
    newlyQualifiedPersisted,
  };
}

async function openFirstSearchResult(
  keyword: string,
  screenshot: string,
  options: {
    preserveRawEvidence?: boolean;
    rawSort?: "latest" | "hottest";
  } = {},
) {
  let inspected: Awaited<ReturnType<typeof searchKeyword>>;
  try {
    inspected = await searchKeyword(keyword, screenshot, { rawSort: options.rawSort });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!shouldReturnToRecommendationAfterSearchError(reason)) throw error;
    const state = await getCollectorSearchTabState();
    await closeSearchTabAndRestore(keyword, screenshot, state, 0);
    process.stderr.write(`search_topic_returned_to_recommendation:${keyword}:${reason}\n`);
    throw new Error(`weixin_channels_search_returned_to_recommendation:${reason}`);
  }
  const plan = options.rawSort
    ? inspected.rawSelectedPoint
      ? {
        action: "open" as const,
        sourceSort: options.rawSort,
        point: inspected.rawSelectedPoint,
      }
      : { action: "return_to_recommendation" as const }
    : planSearchResultSelection({
      latestCurrentPage: inspected.selectedSort === "latest"
        ? inspected.selectedCurrentPage
        : { ...inspected.latest, firstRecentHighPlayPoint: undefined },
      hottestCurrentPage: inspected.selectedSort === "hottest"
        ? inspected.selectedCurrentPage
        : inspected.selectedSort === "latest"
          ? undefined
          : inspected.selectedCurrentPage,
    });
  if (plan.action !== "open") {
    const state = await getCollectorSearchTabState();
    await closeSearchTabAndRestore(keyword, screenshot, state, 0);
    process.stderr.write(`search_topic_returned_to_recommendation:${keyword}:no_candidate\n`);
    throw new Error("weixin_channels_search_returned_to_recommendation:no_candidate");
  }
  const point = plan.point;
  const rawSearchEvidenceFile = options.preserveRawEvidence
    ? path.join(
      os.tmpdir(),
      "weixin-channels-search-evidence-" + process.pid + "-"
        + requireCollectorWindowSession().windowId + "-" + Date.now() + ".png",
    )
    : undefined;
  if (rawSearchEvidenceFile) await fs.copyFile(screenshot, rawSearchEvidenceFile);
  const selectedAgeDays = options.rawSort
    ? inspected.selectedCurrentPage.firstMatchingAgeDays
    : plan.sourceSort === "latest"
      ? inspected.selectedCurrentPage.firstRecentHighPlayAgeDays
      : inspected.selectedCurrentPage.firstHighPlayAgeDays;
  // 坐标只来自当前可见的“最新”或“最热门”命中页。页面一滚动，旧坐标作废。
  process.stderr.write(`search_result_opening:${JSON.stringify({
    windowId: requireCollectorWindowSession().windowId,
    keyword,
    sourceSort: plan.sourceSort,
    point,
  })}\n`);
  try {
    await runSwiftControl(["click-relative", point.x.toFixed(5), point.y.toFixed(5)]);
    await waitForVisibleVideoLoad();
    const startedAt = Date.now();
    // 结果点入后主动轮询；8 秒仍无播放器就回推荐，不让坏卡拖住整个右窗。
    while (Date.now() - startedAt < 8_000) {
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
      // 搜索结果已经在视频号播放器中打开。开始五点/评论采集前，先关闭本轮
      // 搜索标签并重新证明播放器仍可见，避免搜索标签累计或误关视频号窗口。
      const searchState = await getCollectorSearchTabState();
      const restored = await closeSearchTabAndRestore(keyword, screenshot, searchState, 0);
      return {
        ocr: restored,
        videoDurationSec: undefined,
        searchInspection: { latest: inspected.latest, hottest: inspected.hottest },
        sourceSort: plan.sourceSort,
        selectedAgeDays,
        rawSearchEvidenceFile,
      };
    }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    if (rawSearchEvidenceFile) await fs.unlink(rawSearchEvidenceFile).catch(() => undefined);
    throw error;
  }
  if (rawSearchEvidenceFile) await fs.unlink(rawSearchEvidenceFile).catch(() => undefined);
  throw new Error("weixin_channels_search_result_video_not_opened");
}

type CollectorPendingRecovery = Awaited<ReturnType<typeof retryPendingObservations>>;

type CollectorSharedRuntime = {
  seenRegistry: CollectorSeenRegistry;
  inFlightVideoIdentities: Set<string>;
  nextSearchQueryIndexByWindow: Map<number, number>;
  controlRevision?: number;
  abortReason?: string;
  observeHeartbeat(heartbeat: CollectorHeartbeat): string | null;
  rememberSeen(entry: CollectorSeenEntry): Promise<void>;
  retryPending(): Promise<CollectorPendingRecovery>;
  schedulePendingUpload(): void;
  awaitPendingUploads(): Promise<void>;
  markHealthyProgress(): Promise<void>;
  qualifiedTargetReached(): boolean;
  recordQualifiedPersisted(windowId: number): void;
  qualifiedPersistedTotal(): number;
  qualificationStartedAt: number;
  rawSpool?: {
    root: string;
    run: WeixinChannelsRawRunState;
  };
};

async function prepareCollectorSharedRuntime(params: {
  server: string;
  token: string;
  maxQualified?: number;
  controlRevision?: number;
  onObservationPersisted?: (event: WeixinChannelsPersistedObservationEvent) => void;
  rawHarvest?: boolean;
}) {
  const seenRegistry = await loadCollectorSeenRegistry();
  // 旧 seen 不能作为事实。双窗启动前只做一次 Fly 对账，随后两窗共享同一份内存表。
  const persistedIdentityCount = await syncPersistedCollectorIdentities({
    server: params.server,
    token: params.token,
    registry: seenRegistry,
  });
  process.stderr.write(`persisted_identity_sync_completed:${persistedIdentityCount}\n`);
  await restoreEligibleQuarantinedObservations();
  const seenGate = createAsyncSerialGate();
  const pendingGate = createAsyncSerialGate();
  const recoveryResetGate = createAsyncSerialGate();
  let pendingUploadScheduled = false;
  let pendingUploadChain = Promise.resolve();
  let qualifiedPersistedTotal = 0;
  const qualificationStartedAt = Date.now();
  const consumePendingRecovery = async (recovery: CollectorPendingRecovery) => {
    for (const event of recovery.events) {
      if (event.modelCalls !== 0) {
        process.stderr.write(`collector_pending_model_call_rejected:${event.observationId}\n`);
        continue;
      }
      const persistedVideoIdentity = event.analysisObservation.videoIdentity;
      if (event.persisted && event.observationId && persistedVideoIdentity) {
        await seenGate.run(() => rememberCollectorSeen(seenRegistry, {
          videoIdentity: persistedVideoIdentity,
          observationId: event.observationId,
          seenAt: new Date().toISOString(),
          state: "persisted",
        }));
      }
      if (event.newlyQualifiedPersisted) {
        qualifiedPersistedTotal += 1;
        process.stderr.write(`collector_qualified_persisted:${JSON.stringify({
          windowId: event.windowId,
          qualifiedPersistedTotal,
          target: params.maxQualified,
          elapsedMs: Date.now() - qualificationStartedAt,
        })}\n`);
      }
      params.onObservationPersisted?.(event);
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
  };
  const schedulePendingUpload = () => {
    if (pendingUploadScheduled) return;
    pendingUploadScheduled = true;
    pendingUploadChain = pendingUploadChain
      .then(async () => {
        // 给左右窗一个很短的合批窗口；UI 不等待这条 Promise。
        await new Promise((resolve) => setTimeout(resolve, 750));
        pendingUploadScheduled = false;
        const recovery = await pendingGate.run(() => retryPendingObservations(params));
        await consumePendingRecovery(recovery);
        if (recovery.persisted > 0 && recovery.found > recovery.persisted) {
          // 历史 pending 可能一次超过 100 条。每批上传后继续排下一批，
          // UI 采集无需等待，仍由同一 pending gate 保证不会并发重复传。
          schedulePendingUpload();
        }
      })
      .catch((error) => {
        pendingUploadScheduled = false;
        process.stderr.write(`collector_background_upload_failed:${
          error instanceof Error ? error.message : String(error)
        }\n`);
      });
  };
  const rawSpool = params.rawHarvest
    ? await ensureWeixinChannelsRawRun({})
    : undefined;
  const shared: CollectorSharedRuntime = {
    seenRegistry,
    inFlightVideoIdentities: new Set<string>(),
    nextSearchQueryIndexByWindow: new Map<number, number>(),
    controlRevision: params.controlRevision,
    observeHeartbeat: (heartbeat) => {
      const reason = collectorControlStopReason(params.controlRevision, heartbeat);
      if (reason && !shared.abortReason) shared.abortReason = reason;
      return shared.abortReason || null;
    },
    rememberSeen: (entry: CollectorSeenEntry) => seenGate.run(() => rememberCollectorSeen(seenRegistry, entry)),
    retryPending: () => pendingGate.run(() => retryPendingObservations(params)),
    schedulePendingUpload,
    awaitPendingUploads: () => pendingUploadChain,
    markHealthyProgress: () => recoveryResetGate.run(async () => {
      await resetCollectorRecoveryState();
    }),
    qualifiedTargetReached: () => params.maxQualified !== undefined && qualifiedPersistedTotal >= params.maxQualified,
    recordQualifiedPersisted: (windowId) => {
      qualifiedPersistedTotal += 1;
      process.stderr.write(`collector_qualified_persisted:${JSON.stringify({
        windowId,
        qualifiedPersistedTotal,
        target: params.maxQualified,
        elapsedMs: Date.now() - qualificationStartedAt,
      })}\n`);
    },
    qualifiedPersistedTotal: () => qualifiedPersistedTotal,
    qualificationStartedAt,
    rawSpool,
  };
  // raw 模式由独立离线 worker 生成并批传 pending；UI 子进程只采集，避免
  // 两个进程同时领取同一 pending 文件。旧精确采集模式仍由本进程后台上传。
  if (!params.rawHarvest) schedulePendingUpload();
  return {
    shared,
    // 历史 pending 在后台恢复，不能在正式 UI 启动前阻塞最长 60 秒。
    initialRecovery: {
      found: 0,
      persisted: 0,
      persistedUnique: 0,
      duplicatePersistRejected: 0,
      failed: 0,
      events: [],
    },
  };
}

async function runCollectionPool(params: {
  screenshot: string;
  server: string;
  token: string;
  probe: boolean;
  maxScanned?: number;
  allowSearch: boolean;
  deferUploads?: boolean;
  searchScheduleManaged?: boolean;
  startInSearch?: boolean;
  deadlineAt?: number;
  onObservationPersisted?: (event: WeixinChannelsPersistedObservationEvent) => void;
  shared: CollectorSharedRuntime;
  initialRecovery?: CollectorPendingRecovery;
  rawHarvest?: boolean;
  onRawCaptureCommitted?: (manifest: WeixinChannelsRawManifest) => void | Promise<void>;
  onRawVideoAdvanced?: (manifest: WeixinChannelsRawManifest) => void | Promise<void>;
  onVideoAdvanced?: () => void | Promise<void>;
  windowProgressStalled?: () => boolean;
}) {
  const clientId = `mac-weixin-${os.hostname()}`.slice(0, 120);
  const { seenRegistry, inFlightVideoIdentities } = params.shared;
  let diagnostics = createCollectorHourDiagnostics();
  let windowStartedAt = Date.parse(diagnostics.windowStartedAt);
  let checkpoint15Handled = false;
  let checkpoint30Handled = false;
  let forceSearchQueryRotation = false;
  const initialRecovery = params.initialRecovery || {
    found: 0, persisted: 0, persistedUnique: 0, duplicatePersistRejected: 0, failed: 0, events: [],
  };
  diagnostics.persistedUnique += initialRecovery.persistedUnique;
  diagnostics.duplicatePersistRejected += initialRecovery.duplicatePersistRejected;
  // 启动只读取 Fly 已有候选，不能在两个窗口已经固定后阻塞等待外部平台刷新。
  let candidates = await refreshCollectorCandidates(params.server, params.token, false);
  let heartbeat = await heartbeatCollector(params.server, params.token, clientId);
  let controlStopReason = params.shared.observeHeartbeat(heartbeat);
  if (controlStopReason) return { stopped: controlStopReason, scanned: 0, qualified: 0 };
  if (!heartbeat.nextTask) {
    // 任务只能由 Fly 中抖音/B站/小红书最近十五天真实数据生成；本机不维护固定热词。
    candidates = await refreshCollectorCandidates(params.server, params.token, false);
    heartbeat = await heartbeatCollector(params.server, params.token, clientId);
    controlStopReason = params.shared.observeHeartbeat(heartbeat);
    if (controlStopReason) return { stopped: controlStopReason, scanned: 0, qualified: 0 };
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
  const currentWindowId = requireCollectorWindowSession().windowId;
  process.stderr.write(`search_query_pool_ready:${JSON.stringify({ windowId: currentWindowId, count: task.searchQueries.length })}\n`);
  let mode: "recommendation" | "search" = "recommendation";
  let recommendationStartedAt = Date.now();
  let recommendationQualified = 0;
  let recommendationScanned = 0;
  let totalScanned = 0;
  let totalQualified = 0;
  let totalRecovered = initialRecovery.persisted;
  let searchQueryIndex = (params.shared.nextSearchQueryIndexByWindow.get(currentWindowId) || 0)
    % Math.max(1, task.searchQueries.length);
  let scansOnCurrentQuery = 0;
  let qualifiedOnCurrentQuery = 0;
  let knownVideoDurationSec: number | undefined;
  let rawSearchEvidence: CollectorRawSearchEvidence | undefined;
  let rawSearchSource: WeixinChannelsRawSource | undefined;
  let nextRawSearchSort: "latest" | "hottest" = "latest";
  let consecutiveDuplicates = 0;
  let lastHeartbeatAt = Date.now();
  let ocr: OcrResult;
  if (params.startInSearch) {
    const firstQuery = task.searchQueries[searchQueryIndex];
    if (!firstQuery) throw new Error("weixin_channels_dual_probe_search_query_missing");
    params.shared.nextSearchQueryIndexByWindow.set(
      currentWindowId,
      nextCollectorSearchQueryIndex(searchQueryIndex, task.searchQueries.length),
    );
    try {
      const searchResult = await openFirstSearchResult(firstQuery, params.screenshot, {
        preserveRawEvidence: params.rawHarvest,
        rawSort: params.rawHarvest ? nextRawSearchSort : undefined,
      });
      mode = "search";
      ocr = searchResult.ocr;
      knownVideoDurationSec = searchResult.videoDurationSec;
      rawSearchSource = searchResult.sourceSort === "latest"
        ? "search_latest"
        : "search_hottest";
      rawSearchEvidence = {
        file: searchResult.rawSearchEvidenceFile,
        selectedAgeDays: searchResult.selectedAgeDays,
      };
      if (params.rawHarvest) nextRawSearchSort = "hottest";
      await rememberCollectorQuery(firstQuery);
      process.stderr.write(`dual_window_probe_right_search_started:${firstQuery}\n`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!reason.startsWith("weixin_channels_search_returned_to_recommendation:")) throw error;
      await rememberCollectorQuery(firstQuery);
      await captureWindow(params.screenshot);
      ocr = await readOcr(params.screenshot);
      ocr = await ensureVideoPlayerVisible(params.screenshot, ocr);
      // 子进程重启后可能继承上一轮未关掉的评论抽屉。先以评论标题/X
      // 严格恢复播放器，再开始新一条 raw，禁止重复打开或在抽屉上拖进度。
      ocr = await ensureInteractionMetricsVisible(params.screenshot, ocr);
      mode = "recommendation";
      recommendationStartedAt = Date.now();
      process.stderr.write(`right_search_fallback_to_recommendation:${firstQuery}:${reason}\n`);
    }
  } else {
    await captureWindow(params.screenshot);
    ocr = await readOcr(params.screenshot);
    ocr = await ensureVideoPlayerVisible(params.screenshot, ocr);
  }

  if (params.rawHarvest) {
    const rawSpool = params.shared.rawSpool;
    if (!rawSpool) throw new Error("weixin_channels_raw_spool_not_initialized");
    while (totalScanned < (params.maxScanned ?? Number.POSITIVE_INFINITY)
      && (params.deadlineAt === undefined || Date.now() < params.deadlineAt)) {
      if (params.windowProgressStalled?.()) {
        throw new Error("weixin_channels_local_window_stall_180s");
      }
      if (params.shared.abortReason) {
        return {
          stopped: params.shared.abortReason,
          scanned: totalScanned,
          qualified: 0,
          mode,
        };
      }
      if (Date.now() >= Date.parse(rawSpool.run.harvestUntil)) {
        return { stopped: "raw_harvest_batch_ready", scanned: totalScanned, qualified: 0, mode };
      }
      ocr = await ensureVideoPlayerVisible(params.screenshot, ocr);
      ocr = await ensureInteractionMetricsVisible(params.screenshot, ocr);
      const query = mode === "recommendation"
        ? "推荐页"
        : task.searchQueries[searchQueryIndex] || "网络热点";
      const raw = await captureVisibleVideoToRawSpool({
        screenshot: params.screenshot,
        safetyOcr: ocr,
        root: rawSpool.root,
        run: rawSpool.run,
        taskId: task.taskId,
        query,
        source: mode === "recommendation"
          ? "recommendation"
          : rawSearchSource || "search_hottest",
        searchEvidence: rawSearchEvidence,
      });
      rawSearchEvidence = undefined;
      if (raw.stopped) {
        return { stopped: raw.stopped, scanned: totalScanned, qualified: 0, mode };
      }
      totalScanned += 1;
      await params.onRawCaptureCommitted?.(raw.manifest);
      await params.shared.markHealthyProgress();
      if (mode === "recommendation") {
        ocr = await advanceRawToNextVideo(raw.safetyOcr, params.screenshot);
        await params.onRawVideoAdvanced?.(raw.manifest);
        continue;
      }
      // 搜索播放器采完后不在未知相关推荐里盲滑；每条都回到搜索状态机，
      // 换下一个词重新取得与当前帧绑定的“最新/最热门”卡片和发布日期证据。
      const nextIndex = nextCollectorSearchQueryIndex(searchQueryIndex, task.searchQueries.length);
      const nextQuery = task.searchQueries[nextIndex];
      if (!nextQuery) {
        mode = "recommendation";
        await captureWindow(params.screenshot);
        ocr = await readOcr(params.screenshot);
        ocr = await ensureVideoPlayerVisible(params.screenshot, ocr);
        continue;
      }
      try {
        const rawSnapshot = await inspectWeixinChannelsRawSpool({
          root: rawSpool.root,
          run: rawSpool.run,
        });
        const desiredSort = nextRawSearchSort === "latest"
          && rawSnapshot.latestComplete + rawSnapshot.latestReservations >= rawSpool.run.latestLimit
          ? "hottest"
          : nextRawSearchSort;
        const searchResult = await openFirstSearchResult(nextQuery, params.screenshot, {
          preserveRawEvidence: true,
          rawSort: desiredSort,
        });
        searchQueryIndex = nextIndex;
        params.shared.nextSearchQueryIndexByWindow.set(
          currentWindowId,
          nextCollectorSearchQueryIndex(nextIndex, task.searchQueries.length),
        );
        ocr = searchResult.ocr;
        rawSearchSource = searchResult.sourceSort === "latest"
          ? "search_latest"
          : "search_hottest";
        rawSearchEvidence = {
          file: searchResult.rawSearchEvidenceFile,
          selectedAgeDays: searchResult.selectedAgeDays,
        };
        nextRawSearchSort = desiredSort === "latest" ? "hottest" : "latest";
        await rememberCollectorQuery(nextQuery);
        await params.onRawVideoAdvanced?.(raw.manifest);
      } catch (error) {
        searchQueryIndex = nextIndex;
        params.shared.nextSearchQueryIndexByWindow.set(
          currentWindowId,
          nextCollectorSearchQueryIndex(nextIndex, task.searchQueries.length),
        );
        await rememberCollectorQuery(nextQuery);
        process.stderr.write("raw_search_fallback_to_recommendation:" + nextQuery + ":"
          + (error instanceof Error ? error.message : String(error)) + "\n");
        await captureWindow(params.screenshot);
        ocr = await readOcr(params.screenshot);
        ocr = await ensureVideoPlayerVisible(params.screenshot, ocr);
        mode = "recommendation";
      }
    }
    return {
      stopped: params.deadlineAt !== undefined && Date.now() >= params.deadlineAt
        ? "probe_deadline_reached"
        : "max_scanned_reached",
      scanned: totalScanned,
      qualified: 0,
      mode,
    };
  }

  const advanceTracked = async (
    previous: OcrResult,
    evidence: CollectorAdvanceEvidence,
    deadlineAt?: number,
  ) => {
    if (!collectorAdvanceAllowed(evidence)) {
      throw new Error("weixin_channels_advance_without_terminal_evidence_blocked");
    }
    const startedAt = Date.now();
    try {
      const live = await revalidateLiveFrameBeforeAdvance(previous, params.screenshot);
      if (live.state === "already_transitioned") {
        process.stderr.write("advance_skipped_video_already_auto_transitioned\n");
        await params.onVideoAdvanced?.();
        return live.ocr;
      }
      const advanced = await advanceToNextVideoSafely(live.ocr, params.screenshot, deadlineAt);
      await params.onVideoAdvanced?.();
      return advanced;
    } finally {
      recordCollectorPhase(diagnostics, "advance", startedAt);
    }
  };

  while (totalScanned < (params.maxScanned ?? Number.POSITIVE_INFINITY)
    && !params.shared.qualifiedTargetReached()
    && (params.deadlineAt === undefined || Date.now() < params.deadlineAt)) {
    if (params.windowProgressStalled?.()) {
      throw new Error("weixin_channels_local_window_stall_180s");
    }
    if (params.shared.abortReason) {
      return {
        stopped: params.shared.abortReason,
        scanned: totalScanned,
        qualified: totalQualified,
        recovered: totalRecovered,
        mode,
      };
    }
    const scheduleTime = new Date();
    if (params.searchScheduleManaged
      && params.allowSearch !== shouldUseWeixinChannelsSearchAtHour(
        scheduleTime.getHours(),
        scheduleTime.getDay(),
      )) {
      return {
        stopped: "search_schedule_changed",
        scanned: totalScanned,
        qualified: totalQualified,
        recovered: totalRecovered,
        mode,
      };
    }
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
      if (diagnostics.persistedUnique < WEIXIN_CHANNELS_HOURLY_UNIQUE_TARGET) {
        // 停止当前低效小时窗口并立即执行无人值守修复：刷新十五天候选、强制换源，
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
      if (diagnostics.persistedUnique >= WEIXIN_CHANNELS_HOURLY_UNIQUE_TARGET) {
        process.stderr.write(`collector_watchdog_60m_passed:${JSON.stringify(report)}\n`);
      }
      diagnostics = createCollectorHourDiagnostics();
      windowStartedAt = Date.parse(diagnostics.windowStartedAt);
      checkpoint15Handled = false;
      checkpoint30Handled = false;
    }

    if (Date.now() - lastHeartbeatAt >= 30_000) {
      heartbeat = await heartbeatCollector(params.server, params.token, clientId);
      controlStopReason = params.shared.observeHeartbeat(heartbeat);
      if (controlStopReason) {
        return { stopped: controlStopReason, scanned: totalScanned, qualified: totalQualified };
      }
      if (params.deferUploads) {
        params.shared.schedulePendingUpload();
      } else {
        const recovery = await params.shared.retryPending();
        totalRecovered += recovery.persisted;
        diagnostics.persistedUnique += recovery.persistedUnique;
        diagnostics.duplicatePersistRejected += recovery.duplicatePersistRejected;
      }
      lastHeartbeatAt = Date.now();
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

    if (!params.allowSearch && forceSearchQueryRotation) {
      forceSearchQueryRotation = false;
      recommendationStartedAt = Date.now();
      recommendationQualified = 0;
      recommendationScanned = 0;
      process.stderr.write("left_recommendation_window_retained_without_search\n");
    }

    if (params.allowSearch && forceSearchQueryRotation && task.searchQueries.length) {
      const nextIndex = mode === "search"
        ? nextCollectorSearchQueryIndex(searchQueryIndex, task.searchQueries.length)
        : searchQueryIndex;
      const nextQuery = task.searchQueries[nextIndex]!;
      try {
        const searchResult = await openFirstSearchResult(nextQuery, params.screenshot);
        mode = "search";
        searchQueryIndex = nextIndex;
        params.shared.nextSearchQueryIndexByWindow.set(
          currentWindowId,
          nextCollectorSearchQueryIndex(nextIndex, task.searchQueries.length),
        );
        scansOnCurrentQuery = 0;
        qualifiedOnCurrentQuery = 0;
        ocr = searchResult.ocr;
        knownVideoDurationSec = searchResult.videoDurationSec;
        await rememberCollectorQuery(nextQuery);
        forceSearchQueryRotation = false;
        process.stderr.write(`search_query_rotated:${nextQuery}:watchdog\n`);
      } catch (error) {
        searchQueryIndex = nextIndex;
        params.shared.nextSearchQueryIndexByWindow.set(
          currentWindowId,
          nextCollectorSearchQueryIndex(nextIndex, task.searchQueries.length),
        );
        await rememberCollectorQuery(nextQuery);
        process.stderr.write(`search_query_rotation_deferred:${nextQuery}:watchdog:${error instanceof Error ? error.message : String(error)}\n`);
        // 搜索调用可能已经改变真实页面；旧播放器 OCR 此刻必定不可信。
        // 重新截图并从循环顶部走页面门禁，禁止拿旧指标继续评论或滑动。
        await captureWindow(params.screenshot);
        ocr = await readOcr(params.screenshot);
        continue;
      }
    }

    if (params.allowSearch && mode === "recommendation" && shouldSwitchRecommendationToSearch({
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
        params.shared.nextSearchQueryIndexByWindow.set(
          currentWindowId,
          nextCollectorSearchQueryIndex(searchQueryIndex, task.searchQueries.length),
        );
      } catch (error) {
        // 微信可能短暂停在“赞和收藏”等子页。搜索入口失败只重置采样窗，
        // 不退出常驻进程；下一轮改试下一个十五天新词，禁止反复卡在同一个词。
        const failedQuery = query;
        searchQueryIndex = nextCollectorSearchQueryIndex(searchQueryIndex, task.searchQueries.length);
        params.shared.nextSearchQueryIndexByWindow.set(currentWindowId, searchQueryIndex);
        await rememberCollectorQuery(failedQuery);
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
    // 广告是页面级最高优先级淘汰条件：无需等待四项指标稳定，更不能进入
    // 时长、五点或评论链。只保留 scanned 事实，随后立即切到下一条。
    if (containsWeixinChannelsAdvertisement(ocr.lines.map((line) => line.text))) {
      diagnostics.advertisementRejected += 1;
      diagnostics.locallyUnqualified += 1;
      totalScanned += 1;
      if (mode === "recommendation") recommendationScanned += 1;
      else scansOnCurrentQuery += 1;
      process.stdout.write(`${JSON.stringify({ event: "advertisement_rejected", scanned: true, qualified: false, modelCalls: 0 })}\n`);
      await params.shared.markHealthyProgress();
      ocr = await advanceTracked(ocr, {
        metricsOcrConfirmed: true,
        advertisementRejected: true,
      });
      knownVideoDurationSec = undefined;
      continue;
    }
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
    const currentMetrics = extractWeixinChannelsMetrics(ocr.lines);
    const videoIdentity = visibleVideoIdentityFingerprint(ocr);
    if (!videoIdentity) {
      diagnostics.metricsIncomplete += 1;
      process.stderr.write("collector_safety_stopped:weixin_channels_stable_identity_not_detected\n");
      return { stopped: "stable_identity_not_detected", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
    }
    const visibleIdentity = extractVisibleTitleAndAuthor(ocr.lines);
    const query = mode === "recommendation"
      ? "推荐页"
      : task.searchQueries[searchQueryIndex] || task.searchQueries[0] || "网络热点";
    const currentQualification = qualifyWeixinChannelsObservationLocally({
      ...currentMetrics,
      query,
      title: visibleIdentity.title,
    });
    const observationId = makeWeixinChannelsObservationId({
      taskId: task.taskId,
      title: visibleIdentity.title || "",
      author: visibleIdentity.author,
      videoIdentity,
    });
    const seenEntry = seenRegistry.entries.get(videoIdentity);
    if (seenEntry?.state === "terminal_unqualified" && currentQualification.qualified) {
      // 旧 OCR 曾把当前视频错误写成不达标；当前四项已明确达标时撤销污染状态，
      // 禁止沿历史快速路径滑走，重新进入完整内容与评论链。
      seenRegistry.entries.delete(videoIdentity);
      seenRegistry.observationIds.delete(observationId);
      await persistCollectorSeenRegistry(seenRegistry, Date.now());
      process.stderr.write(`terminal_unqualified_reopened_as_qualified:${videoIdentity}:${observationId}\n`);
    } else if (collectorSeenContains(seenRegistry, videoIdentity, observationId)) {
      diagnostics.duplicateVideosSkipped += 1;
      consecutiveDuplicates += 1;
      process.stderr.write(`duplicate_visible_video_skipped:${videoIdentity}:${observationId}\n`);
      if (consecutiveDuplicates >= 3) {
        // 不继续滑同一推荐流，也不退出等人工处理；下一轮改用另一条十五天热词。
        consecutiveDuplicates = 0;
        forceSearchQueryRotation = true;
        process.stderr.write("collector_duplicate_loop_rotating_source\n");
        continue;
      }
      await waitForVisibleVideoLoad();
      ocr = await advanceTracked(ocr, {
        metricsOcrConfirmed: true,
        terminalDuplicate: true,
      });
      knownVideoDurationSec = undefined;
      continue;
    }
    if (inFlightVideoIdentities.has(videoIdentity) && currentQualification.qualified) {
      // 达标重复副本不能马上滑走：先等负责窗口完成。只有 Fly 已持久化后
      // 才可跳过；负责窗口失败释放 in-flight 时，本窗接手完整采集。
      for (let attempt = 0; attempt < 60 && inFlightVideoIdentities.has(videoIdentity); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const persistedByPeer = seenRegistry.entries.get(videoIdentity)?.state === "persisted"
        || seenRegistry.observationIds.has(observationId);
      if (persistedByPeer) {
        diagnostics.duplicateVideosSkipped += 1;
        process.stderr.write(`qualified_duplicate_skipped_after_peer_persisted:${videoIdentity}:${observationId}\n`);
        ocr = await advanceTracked(ocr, {
          metricsOcrConfirmed: true,
          terminalDuplicate: true,
        });
        knownVideoDurationSec = undefined;
        continue;
      }
      if (inFlightVideoIdentities.has(videoIdentity)) {
        return { stopped: "qualified_duplicate_owner_unresolved", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
      }
    }
    if (inFlightVideoIdentities.has(videoIdentity)) {
      // 截图所示双窗可能同时停在同一视频。已有另一窗完整保护该视频时，
      // 本窗只把它视为跨窗重复并切到下一条；不抢采、不上传，也不污染 seen。
      diagnostics.duplicateVideosSkipped += 1;
      consecutiveDuplicates += 1;
      process.stderr.write(`duplicate_inflight_video_skipped:${videoIdentity}:${observationId}\n`);
      if (consecutiveDuplicates >= 3) {
        consecutiveDuplicates = 0;
        forceSearchQueryRotation = true;
        process.stderr.write("collector_cross_window_duplicate_loop_rotating_source\n");
      }
      ocr = await advanceTracked(ocr, {
        metricsOcrConfirmed: true,
        unqualifiedInFlightDuplicate: true,
      });
      knownVideoDurationSec = undefined;
      continue;
    }
    consecutiveDuplicates = 0;
    inFlightVideoIdentities.add(videoIdentity);
    diagnostics.uniqueVideosSeen += 1;
    totalScanned += 1;
    if (mode === "recommendation") recommendationScanned += 1;
    else scansOnCurrentQuery += 1;
    const itemStartedAt = Date.now();
    const captureActivity = await beginCollectorCaptureActivity({
      observationId,
      videoIdentity,
      windowId: currentWindowId,
    });
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
      deferUpload: params.deferUploads,
      outputOverride: pendingOutput,
      videoDurationHintSec: knownVideoDurationSec,
      currentVideoStartedAt: itemStartedAt,
      retryCache,
      onObservationPersisted: params.onObservationPersisted,
    });
    let result!: Awaited<ReturnType<typeof captureVisibleQualifiedVideo>>;
    let captureOcr = ocr;
    let failureCount = 0;
    let stableRecoverySnapshots = 0;
    for (;;) {
      const pendingExists = await collectorPendingFileExists(pendingOutput);
      try {
        if (pendingExists) {
          await updateCollectorCaptureActivity(captureActivity, "upload_pending");
          // UI 已完整采集，只在后台重传 pending，绝不再次拖动或打开评论区。
          const observation = JSON.parse(await fs.readFile(pendingOutput, "utf8"));
          const qualification = qualifyWeixinChannelsObservationLocally(observation);
          const payload = await uploadPendingObservation({
            server: params.server,
            token: params.token,
            taskId: task.taskId,
            pendingFile: pendingOutput,
            timeoutMs: 12_000,
          });
          result = {
            qualified: qualification.qualified,
            inspectedContent: true as const,
            reason: qualification.reason,
            fingerprint: videoIdentity,
            observation,
            persisted: payload.persisted === true,
            newlyPersisted: payload.newlyPersisted === true,
            serverQualified: payload.qualified === true,
            newlyQualifiedPersisted: payload.newlyQualifiedPersisted === true,
          };
          const persistedEvent: WeixinChannelsPersistedObservationEvent = {
            event: "observation_persisted",
            observationId: observation.observationId,
            windowId: requireCollectorWindowSession().windowId,
            query: observation.query,
            runKind: observation.runKind === "probe" ? "probe" : "formal",
            qualified: qualification.qualified,
            serverQualified: payload.qualified === true,
            persisted: payload.persisted === true,
            newlyPersisted: payload.newlyPersisted === true,
            newlyQualifiedPersisted: payload.newlyQualifiedPersisted === true,
            comments: Number(observation.comments || 0),
            commentSampleCount: Array.isArray(observation.commentSamples)
              ? observation.commentSamples.length
              : 0,
            captureElapsedMs: Number(observation.captureElapsedMs || 0),
            captureBudgetMs: observation.captureBudgetMs,
            modelCalls: Number(payload.modelCalls || 0),
            analysisObservation: {
              ...observation,
              coverImageBase64: undefined,
              visualImageBase64: undefined,
            },
          };
          params.onObservationPersisted?.(persistedEvent);
          process.stdout.write(`${JSON.stringify(persistedEvent)}\n`);
          if (payload.newlyQualifiedPersisted === true) diagnostics.persistedUnique += 1;
          else if (payload.newlyPersisted !== true) diagnostics.duplicatePersistRejected += 1;
          if (failureCount > 0) process.stderr.write(`collector_safe_retry_succeeded:attempt=${failureCount}\n`);
          break;
        } else {
          await updateCollectorCaptureActivity(captureActivity, "capture");
          result = await captureCurrentVideo(captureOcr);
          if (result.queuedForUpload || result.persisted) {
            // 核心数据已安全落 pending/服务端后，三分钟只用于 UI 自检，不能再
            // 把网络补传耗时误判为当前视频失败或丢弃有效数据。
            await updateCollectorCaptureActivity(captureActivity, "upload_pending");
          }
          if (failureCount > 0) process.stderr.write(`collector_safe_retry_succeeded:attempt=${failureCount}\n`);
          break;
        }
      } catch (error) {
        failureCount += 1;
        stableRecoverySnapshots = 0;
        await updateCollectorCaptureActivity(captureActivity, "recovery");
        const reason = error instanceof Error ? error.message : String(error);
        // 任一失败进入退避前都把鼠标停到独立窗左侧黑边；绝不能悬停在头像区，
        // Swift 底层同时拒绝头像禁区的 click/drag，形成双重门禁。
        await runSwiftControl(["move-relative", "0.02", "0.50"]).catch(() => undefined);
        await params.shared.rememberSeen({
          videoIdentity,
          observationId,
          seenAt: new Date().toISOString(),
          state: "retryable_failed",
          failureReason: reason,
        });
        // captureVisibleQualifiedVideo 会先原子落盘 pending，再请求 Fly。上传若超时，
        // 本轮开始时读取的 pendingExists 仍是 false；必须在 catch 中重新读取文件系统。
        // 一旦 pending 已存在，UI 采集即已结束，后续只能补传，绝不能重拖进度或重开评论。
        const pendingExistsAfterFailure = pendingExists
          || await collectorPendingFileExists(pendingOutput);
        if (pendingExistsAfterFailure && !pendingExists) {
          await updateCollectorCaptureActivity(captureActivity, "upload_pending");
          process.stderr.write(`collector_pending_created_before_upload_failure:${observationId}:${reason}\n`);
        }
        if (params.deadlineAt !== undefined && Date.now() >= params.deadlineAt) {
          inFlightVideoIdentities.delete(videoIdentity);
          return { stopped: "probe_deadline_reached", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
        }
        const failureAction = collectorCaptureFailureAction({
          reason,
          failureCount,
          pendingExists: pendingExistsAfterFailure,
        });
        if (failureAction === "advance_progress_unavailable") {
          const incomplete = buildIncompleteProgressBaseObservation({
            observationId,
            taskId: task.taskId,
            query,
            videoIdentity,
            windowId: currentWindowId,
            reason,
            ocr: captureOcr,
          });
          const incompleteFiles = await persistIncompleteProgressBaseObservation({
            screenshot: params.screenshot,
            observation: incomplete,
          });
          process.stderr.write(`collector_progress_track_unavailable_advance:${JSON.stringify({
            windowId: currentWindowId,
            observationId,
            failureCount,
            reason,
            ...incompleteFiles,
          })}\n`);
          process.stdout.write(`${JSON.stringify({
            event: "weixin_channels_incomplete_base_observation",
            ...incomplete,
            ...incompleteFiles,
          })}\n`);
          result = {
            qualified: false as const,
            inspectedContent: true as const,
            reason: "当前帧未定位到播放进度条，已按单次门禁跳过",
            fingerprint: videoIdentity,
          };
          break;
        }
        if (failureAction === "advance_comments_unavailable"
          || failureAction === "advance_ui_soft_limit") {
          let restoredForAdvance: OcrResult;
          try {
            await captureWindow(params.screenshot);
            const failureOcr = await readOcr(params.screenshot);
            restoredForAdvance = await ensureInteractionMetricsVisible(params.screenshot, failureOcr);
            if (findCommentsPanelTitle(restoredForAdvance.lines)
              || !sameVideoContinuity(ocr, restoredForAdvance)) {
              throw new Error("weixin_channels_comments_safe_advance_not_proven");
            }
          } catch (restoreError) {
            const restoreReason = restoreError instanceof Error
              ? restoreError.message
              : String(restoreError);
            await failCollectorCaptureActivity(captureActivity, restoreReason);
            inFlightVideoIdentities.delete(videoIdentity);
            return {
              stopped: "window_local_reset_required:comments_close",
              error: restoreReason,
              scanned: totalScanned,
              qualified: totalQualified,
              recovered: totalRecovered,
              mode,
            };
          }
          captureOcr = restoredForAdvance;
          const incomplete = buildIncompleteProgressBaseObservation({
            observationId,
            taskId: task.taskId,
            query,
            videoIdentity,
            windowId: currentWindowId,
            reason,
            ocr: captureOcr,
          });
          const incompleteFiles = await persistIncompleteProgressBaseObservation({
            screenshot: params.screenshot,
            observation: incomplete,
          });
          process.stdout.write(`${JSON.stringify({
            event: "weixin_channels_incomplete_base_observation",
            ...incomplete,
            ...incompleteFiles,
          })}\n`);
          result = {
            qualified: false as const,
            inspectedContent: true as const,
            reason: "评论链未完成，已保存不可晋级 base 并安全滑走",
            fingerprint: videoIdentity,
          };
          break;
        }
        if (failureAction === "stop_ui_retry_exhausted") {
          // 预算耗尽或同视频第二次 UI 失败时，只允许严格证明评论面板后关闭一次。
          // 不滑走、不上传，也不再重进评论链；外层窗口恢复可继续保留另一窗运行。
          try {
            await captureWindow(params.screenshot);
            const failureOcr = await readOcr(params.screenshot);
            await ensureInteractionMetricsVisible(params.screenshot, failureOcr);
          } catch (restoreError) {
            process.stderr.write(`collector_capture_failure_restore_unconfirmed:${
              restoreError instanceof Error ? restoreError.message : String(restoreError)
            }\n`);
          }
          await failCollectorCaptureActivity(captureActivity, reason);
          inFlightVideoIdentities.delete(videoIdentity);
          return {
            stopped: failureAction,
            error: reason,
            scanned: totalScanned,
            qualified: totalQualified,
            recovered: totalRecovered,
            mode,
          };
        }
        // 当前视频的安全补传/补拍不走整窗 5/10/20 秒指数退避；超过一分钟
        // 由独立 watchdog 报硬异常并重启采集轮次。
        const delayMs = Math.min(1_000, automaticRecoveryDelayMs(failureCount));
        process.stderr.write(`collector_automatic_recovery_waiting:attempt=${failureCount}:delayMs=${delayMs}:pending=${pendingExistsAfterFailure}:reason=${reason}\n`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        heartbeat = await heartbeatCollector(params.server, params.token, clientId);
        controlStopReason = params.shared.observeHeartbeat(heartbeat);
        if (controlStopReason) {
          inFlightVideoIdentities.delete(videoIdentity);
          return {
            stopped: controlStopReason === "capture_disabled"
              ? "capture_disabled_during_recovery"
              : controlStopReason,
            scanned: totalScanned,
            qualified: totalQualified,
            recovered: totalRecovered,
            mode,
          };
        }
        if (pendingExistsAfterFailure) continue;
        // 不操作播放器，只被动截图；连续两张互动指标都证明是同一视频后，才允许再次完整采集。
        let passiveSnapshotAttempts = 0;
        while (stableRecoverySnapshots < 2 && passiveSnapshotAttempts < WEIXIN_CHANNELS_MAX_PASSIVE_RECOVERY_SNAPSHOTS) {
          passiveSnapshotAttempts += 1;
          await captureWindow(params.screenshot);
          let passiveOcr = await readOcr(params.screenshot);
          let sameVideo = false;
          if (!isWeixinChannelsAuxiliaryPage(passiveOcr.lines)) {
            try {
              passiveOcr = await ensureInteractionMetricsVisible(params.screenshot, passiveOcr);
              sameVideo = sameVideoContinuity(ocr, passiveOcr);
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
            await new Promise((resolve) => setTimeout(resolve, Math.min(3_000, delayMs)));
            heartbeat = await heartbeatCollector(params.server, params.token, clientId);
            controlStopReason = params.shared.observeHeartbeat(heartbeat);
            if (controlStopReason) {
              inFlightVideoIdentities.delete(videoIdentity);
              return {
                stopped: controlStopReason === "capture_disabled"
                  ? "capture_disabled_during_recovery"
                  : controlStopReason,
                scanned: totalScanned,
                qualified: totalQualified,
                recovered: totalRecovered,
                mode,
              };
            }
          }
        }
        if (stableRecoverySnapshots < 2) {
          inFlightVideoIdentities.delete(videoIdentity);
          return { stopped: "recovery_continuity_unconfirmed", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
        }
      }
    }
    await finishCollectorCaptureActivity(captureActivity);
    if (!qualifiedCaptureHasAdvanceEvidence(result)) {
      inFlightVideoIdentities.delete(videoIdentity);
      process.stderr.write("collector_safety_stopped:qualified_comments_evidence_missing_before_advance\n");
      return {
        stopped: "qualified_comments_evidence_missing_before_advance",
        scanned: totalScanned,
        qualified: totalQualified,
        recovered: totalRecovered,
        mode,
      };
    }
    inFlightVideoIdentities.delete(videoIdentity);
    const terminal = collectorVideoStateAfterCapture(result);
    await params.shared.rememberSeen({
      videoIdentity,
      observationId,
      seenAt: new Date().toISOString(),
      state: terminal.state,
      failureReason: terminal.stopWithoutAdvance ? "qualified_not_persisted" : undefined,
    });
    if (result.queuedForUpload) params.shared.schedulePendingUpload();
    if (terminal.stopWithoutAdvance) {
      process.stderr.write("collector_safety_stopped:qualified_video_not_persisted\n");
      return { stopped: "qualified_video_not_persisted", scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode };
    }
    await params.shared.markHealthyProgress();
    if (result.qualified
      && result.serverQualified
      && result.persisted
      && result.newlyPersisted
      && result.newlyQualifiedPersisted) {
      params.shared.recordQualifiedPersisted(requireCollectorWindowSession().windowId);
      totalQualified += 1;
      if (mode === "recommendation") recommendationQualified += 1;
      else qualifiedOnCurrentQuery += 1;
    }
    if (mode === "search") recordCollectorSearchOutcome(diagnostics, query, result.qualified);
    process.stderr.write(`collector_progress:${JSON.stringify({ scanned: totalScanned, qualified: totalQualified, recovered: totalRecovered, mode })}\n`);

    if (!result.qualified && !("inspectedContent" in result)) {
      ocr = await advanceTracked(ocr, {
        metricsOcrConfirmed: true,
        captureState: terminal.state,
      });
    } else {
      ocr = await advanceTracked(ocr, {
        metricsOcrConfirmed: true,
        captureState: terminal.state,
      });
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
            params.shared.nextSearchQueryIndexByWindow.set(
              currentWindowId,
              nextCollectorSearchQueryIndex(nextIndex, task.searchQueries.length),
            );
            ocr = searchResult.ocr;
            knownVideoDurationSec = searchResult.videoDurationSec;
            await rememberCollectorQuery(nextQuery);
            process.stderr.write(`search_query_rotated:${nextQuery}:qualified_rate_below_40_percent\n`);
          } catch (error) {
            searchQueryIndex = nextIndex;
            params.shared.nextSearchQueryIndexByWindow.set(
              currentWindowId,
              nextCollectorSearchQueryIndex(nextIndex, task.searchQueries.length),
            );
            await rememberCollectorQuery(nextQuery);
            knownVideoDurationSec = undefined;
            process.stderr.write(`search_query_rotation_deferred:${nextQuery}:${error instanceof Error ? error.message : String(error)}\n`);
            await captureWindow(params.screenshot);
            ocr = await readOcr(params.screenshot);
          }
        }
      }
    }
  }
  return {
    stopped: params.shared.qualifiedTargetReached()
      ? "qualified_target_reached"
      : params.deadlineAt !== undefined && Date.now() >= params.deadlineAt
        ? "probe_deadline_reached"
        : "max_scanned_reached",
    scanned: totalScanned,
    qualified: totalQualified,
    recovered: totalRecovered,
    mode,
  };
}

export function parseCollectorWindowIds(args: string[]) {
  const values = args
    .filter((item) => item.startsWith("--window-id="))
    .map((item) => Number(item.slice("--window-id=".length)));
  if (values.some((value) => !Number.isInteger(value) || value <= 0)
    || new Set(values).size !== values.length
    || values.length > 2) throw new Error("weixin_channels_window_ids_invalid");
  return values;
}

export function parseCollectorFormalPoolOptions(args: string[]) {
  const pool = args.includes("--pool");
  const options = {
    autoBindExactTwoWindows: args.includes("--auto-bind-exact-two-windows"),
    calibrateSearchButtons: args.includes("--calibrate-search-buttons"),
    superviseWebToggle: args.includes("--supervise-web-toggle"),
    rawHarvest: args.includes("--raw-harvest"),
    rawOfflineWorkerManaged: args.includes("--raw-offline-worker-managed"),
    reuseSearchCalibration: args.includes("--reuse-search-calibration"),
  };
  const windowIds = parseCollectorWindowIds(args);
  if (!pool && Object.values(options).some(Boolean)) {
    throw new Error("weixin_channels_formal_pool_flags_require_pool_mode");
  }
  if (options.autoBindExactTwoWindows && windowIds.length) {
    throw new Error("weixin_channels_window_binding_mode_conflict");
  }
  if (options.rawOfflineWorkerManaged && !options.rawHarvest) {
    throw new Error("weixin_channels_raw_worker_requires_raw_harvest");
  }
  if (options.reuseSearchCalibration && !options.calibrateSearchButtons) {
    throw new Error("weixin_channels_calibration_reuse_requires_calibration");
  }
  return { ...options, windowIds };
}

function collectorRecoveryStateFile() {
  return path.join(os.tmpdir(), "weixin-channels-recovery-v1.json");
}

async function resetCollectorRecoveryState() {
  const state: CollectorRecoveryState = {
    consecutiveBlackScreens: 0,
    consecutiveSameContent: 0,
    lastIdentityByWindow: {},
    lastStopReason: undefined,
    updatedAt: new Date().toISOString(),
  };
  const file = collectorRecoveryStateFile();
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, file);
}

async function loadCollectorRecoveryState(): Promise<CollectorRecoveryState> {
  try {
    const parsed = JSON.parse(await fs.readFile(collectorRecoveryStateFile(), "utf8")) as CollectorRecoveryState;
    return {
      consecutiveBlackScreens: Math.max(0, Math.floor(parsed.consecutiveBlackScreens || 0)),
      consecutiveSameContent: Math.max(0, Math.floor(parsed.consecutiveSameContent || 0)),
      lastIdentityByWindow: parsed.lastIdentityByWindow || {},
      lastStopReason: parsed.lastStopReason,
      updatedAt: parsed.updatedAt || new Date(0).toISOString(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { consecutiveBlackScreens: 0, consecutiveSameContent: 0, lastIdentityByWindow: {}, updatedAt: new Date(0).toISOString() };
  }
}

async function diagnoseCollectorFailure(params: {
  sessions: WeixinChannelsWindowSession[];
  screenshot: string;
  stopReason: string;
}) {
  const previous = await loadCollectorRecoveryState();
  const identities: Record<string, string> = {};
  const blackEvidence: boolean[] = [];
  for (const session of params.sessions) {
    const screenshot = collectorScreenshotForWindow(params.screenshot, session.windowId);
    try {
      const metadata = await sharp(screenshot).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      if (width < 100 || height < 100) throw new Error("diagnostic_screenshot_invalid");
      const stats = await sharp(screenshot)
        .extract({ left: 0, top: Math.round(height * 0.24), width, height: Math.round(height * 0.38) })
        .greyscale()
        .stats();
      blackEvidence.push((stats.channels[0]?.mean || 0) < 18 && stats.entropy < 1);
      const ocr = await readOcr(screenshot);
      const identity = dedupIdentityFingerprint(ocr);
      if (identity) identities[String(session.windowId)] = identity;
    } catch {
      blackEvidence.push(false);
    }
  }
  const identityEntries = Object.entries(identities);
  const allSameContent = identityEntries.length === params.sessions.length
    && identityEntries.every(([windowId, identity]) => previous.lastIdentityByWindow[windowId] === identity);
  const decision = nextCollectorRecoveryState(previous, {
    allBlack: blackEvidence.length === params.sessions.length && blackEvidence.every(Boolean),
    allSameContent,
    identities,
    stopReason: params.stopReason,
  });
  const file = collectorRecoveryStateFile();
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(decision.state, null, 2), "utf8");
  await fs.rename(temporary, file);
  return decision;
}

async function pauseCollectorForSafetyFuse(params: {
  server: string;
  token: string;
  reason: "persistent_black_screen" | "persistent_same_content";
  consecutiveFailures: number;
}) {
  const response = await fetch(`${params.server.replace(/\/$/, "")}/api/internal/weixin-channels/pause`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-weixin-channels-collector-token": params.token },
    body: JSON.stringify({ reason: params.reason, consecutiveFailures: params.consecutiveFailures }),
    signal: AbortSignal.timeout(WEIXIN_CHANNELS_HTTP_CONTROL_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`safety_pause_failed:${response.status}:${text.slice(0, 300)}`);
  const payload = JSON.parse(text) as { capture?: { enabled?: boolean } };
  if (payload.capture?.enabled !== false) throw new Error("safety_pause_not_confirmed");
}

async function captureCollectorWindowResetEvidence(params: {
  session: WeixinChannelsWindowSession;
  screenshot: string;
  reason: string;
}) {
  const stamp = Date.now();
  const evidenceScreenshot = path.join(
    os.tmpdir(),
    `mvstudiopro-weixin-channels-reset-evidence-${params.session.windowId}-${stamp}.png`,
  );
  const evidenceOcr = path.join(
    os.tmpdir(),
    `mvstudiopro-weixin-channels-reset-evidence-${params.session.windowId}-${stamp}.json`,
  );
  await captureWindow(params.screenshot);
  const ocr = await readOcr(params.screenshot);
  await fs.copyFile(params.screenshot, evidenceScreenshot);
  await fs.chmod(evidenceScreenshot, 0o600);
  const errorClassification = classifyCollectorWindowErrorCode(params.reason);
  await fs.writeFile(evidenceOcr, `${JSON.stringify({
    version: 1,
    windowId: params.session.windowId,
    pid: params.session.pid,
    recordedAt: new Date(stamp).toISOString(),
    errorClassification,
    lines: ocr.lines,
  }, null, 2)}\n`, { mode: 0o600 });
  return { screenshotPath: evidenceScreenshot, ocrEvidencePath: evidenceOcr, ocr };
}

let collectorGlobalRestartScheduled = false;

async function requestGlobalCollectorRestart(params: {
  windowId: number;
  pid: number;
  reason: string;
  consecutiveFailures: number;
}) {
  if (collectorGlobalRestartScheduled) return;
  collectorGlobalRestartScheduled = true;
  const payload = {
    requestedAt: new Date().toISOString(),
    event: "collector_global_cache_reset_restart_requested",
    windowId: params.windowId,
    pid: params.pid,
    reason: classifyCollectorWindowErrorCode(params.reason),
    consecutiveFailures: params.consecutiveFailures,
  };
  const temporary = `${COLLECTOR_CHILD_RESTART_REQUEST_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  await fs.rename(temporary, COLLECTOR_CHILD_RESTART_REQUEST_FILE);
  process.stderr.write(`collector_global_cache_reset_restart_requested:${JSON.stringify(payload)}\n`);
  // 不能等待阻塞窗口自行退出。launcher 会在进程死亡后清临时缓存，复用校准重启。
  setTimeout(() => process.exit(76), 250);
}

export async function runDualWindowCaptureStateMachine(params: {
  sessions: WeixinChannelsWindowSession[];
  screenshot: string;
  server: string;
  token: string;
  probe: boolean;
  maxScanned?: number;
  maxQualified?: number;
  dualWindowProbe?: boolean;
  deadlineAt?: number;
  controlRevision?: number;
  onObservationPersisted?: (event: WeixinChannelsPersistedObservationEvent) => void;
  rawHarvest?: boolean;
  rawOfflineWorkerManaged?: boolean;
  onRawCaptureCommitted?: (manifest: WeixinChannelsRawManifest) => void | Promise<void>;
}) {
  collectorWindowScopeRequired = params.sessions.length > 1;
  const searchRoutes = buildSearchPlaybackRoutes(params.sessions);
  const orderedSessions = [...params.sessions]
    .sort((left, right) => left.bounds.x - right.bounds.x || left.windowId - right.windowId);
  const leftRecommendationWindowId = orderedSessions[0]!.windowId;
  const rightSearchWindowId = searchRoutes[0]?.searchWindowId;
  const startupQualifiedWindowIds = new Set<number>();
  // 推荐流播完会自动切下一条。任何 Fly 同步或搜索之前，先 OCR 两窗当前
  // 视频；只有前置高热达标才拉回 10% 保留采集时间，不达标保持原语义滑走。
  for (const session of [...params.sessions].sort((left, right) => left.bounds.x - right.bounds.x)) {
    if (params.rawHarvest) break;
    await collectorWindowContext.run(session, async () => {
      const startupScreenshot = collectorScreenshotForWindow(params.screenshot, session.windowId);
      await captureWindow(startupScreenshot);
      let startupOcr = await readOcr(startupScreenshot);
      startupOcr = await ensureVideoPlayerVisible(startupScreenshot, startupOcr);
      if (!hasFourVisibleMetrics(startupOcr.lines)) {
        process.stderr.write(`startup_hold_skipped_metrics_missing:${session.windowId}\n`);
        return;
      }
      const startupMetrics = extractWeixinChannelsMetrics(startupOcr.lines);
      const startupIdentity = extractVisibleTitleAndAuthor(startupOcr.lines);
      const startupQualification = qualifyWeixinChannelsObservationLocally({
        ...startupMetrics,
        title: startupIdentity.title,
      });
      if (!startupQualification.qualified) {
        process.stderr.write(`startup_hold_skipped_unqualified:${session.windowId}\n`);
        return;
      }
      startupQualifiedWindowIds.add(session.windowId);
      try {
        const track = await detectVisibleProgressTrackReliably(startupScreenshot);
        const holdX = track.startX + (track.endX - track.startX) * WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS[0];
        await runSwiftControl(["click-relative", holdX.toFixed(4), track.y.toFixed(4)]);
        await new Promise((resolve) => setTimeout(resolve, 180));
        await captureWindow(startupScreenshot);
        const heldOcr = await readOcr(startupScreenshot);
        if (!metricsRemainOnSameVideo(startupMetrics, extractWeixinChannelsMetrics(heldOcr.lines))) {
          throw new Error(`weixin_channels_startup_hold_continuity_unconfirmed:${session.windowId}`);
        }
        process.stderr.write(`startup_qualified_video_held_at_10_percent:${session.windowId}\n`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // 启动停帧是防自动切页的优化，不能因一窗轨道暂不可见而阻断另一窗。
        // 真正的窗口绑定丢失仍向外抛出，禁止对错误窗口继续操作。
        if (isCollectorWindowBindingFailure(reason)) throw error;
        process.stderr.write(`startup_hold_skipped:${session.windowId}:${reason}\n`);
      }
    });
  }
  const events: WeixinChannelsPersistedObservationEvent[] = [];
  const recordPersistedEvent = (event: WeixinChannelsPersistedObservationEvent) => {
    events.push(event);
    params.onObservationPersisted?.(event);
  };
  const prepared = await prepareCollectorSharedRuntime({
    server: params.server,
    token: params.token,
    maxQualified: params.maxQualified,
    controlRevision: params.controlRevision,
    onObservationPersisted: recordPersistedEvent,
    rawHarvest: params.rawHarvest,
  });
  for (const session of params.sessions) {
    collectorSearchTabStates.set(session.windowId, await loadCollectorSearchTabState(session.windowId));
  }
  const failureDiagnosisGate = createAsyncSerialGate();
  const rawRotationDeadlineAt = prepared.shared.rawSpool
    ? Date.parse(prepared.shared.rawSpool.run.harvestUntil)
      + WEIXIN_CHANNELS_RAW_ROTATION_GRACE_MS
    : undefined;
  const runSession = (
    session: WeixinChannelsWindowSession,
    initialRecovery: CollectorPendingRecovery | undefined,
  ) => collectorWindowContext.run(session, async () => {
    let lastFailure = "window_failed";
    let restart = 0;
    const resetBinding = {
      windowIndex: orderedSessions.findIndex((item) => item.windowId === session.windowId) + 1,
      windowId: session.windowId,
      pid: session.pid,
    };
    let resetFailureState = await loadCollectorWindowResetFailureState(resetBinding);
    let lastWindowProgressAtMs = Date.now();
    let lastCommitAtMs = lastWindowProgressAtMs;
    let lastAdvanceAtMs = lastWindowProgressAtMs;
    let lastSameVideoAtMs = lastWindowProgressAtMs;
    let lastRawCommittedVideoIdentity: string | undefined;
    let consecutiveSameRawVideoCommits = 0;
    const markWindowHealthyProgress = (kind: "commit" | "advance") => {
      const now = Date.now();
      lastWindowProgressAtMs = now;
      if (kind === "commit") {
        lastCommitAtMs = now;
      } else {
        lastAdvanceAtMs = now;
        lastSameVideoAtMs = now;
        // commit 只能证明数据已落盘，不能证明窗口已经离开故障视频；只有
        // advance/新视频连续性成立后，才清除连续 reset 失败链。
        resetFailureState = undefined;
        void clearCollectorWindowResetFailureState(session.windowId).catch((error) => {
          process.stderr.write(`collector_window_reset_state_clear_failed:${session.windowId}:json_error\n`);
        });
      }
    };
    const recordResetFailure = async (
      resetAtMs: number,
      failedAtMs: number,
      reason: string,
      captureEvidence = true,
    ) => {
      let evidence: Awaited<ReturnType<typeof captureCollectorWindowResetEvidence>> | undefined;
      try {
        if (captureEvidence) {
          evidence = await captureCollectorWindowResetEvidence({
            session,
            screenshot: collectorScreenshotForWindow(params.screenshot, session.windowId),
            reason,
          });
        }
      } catch (evidenceError) {
        process.stderr.write(`collector_window_reset_evidence_failed:${session.windowId}:${
          evidenceError instanceof Error ? evidenceError.message : String(evidenceError)
        }\n`);
      }
      resetFailureState = nextCollectorWindowResetFailureState(
        resetFailureState,
        resetBinding,
        {
          resetAt: new Date(resetAtMs).toISOString(),
          failedAt: new Date(failedAtMs).toISOString(),
          stage: classifyCollectorWindowFailureStage(reason),
          errorClassification: classifyCollectorWindowErrorCode(reason),
          screenshotPath: evidence?.screenshotPath ? path.basename(evidence.screenshotPath) : undefined,
          ocrEvidencePath: evidence?.ocrEvidencePath ? path.basename(evidence.ocrEvidencePath) : undefined,
        },
      );
      await persistCollectorWindowResetFailureState(resetFailureState);
      const diagnostic = buildCollectorWindowResetDiagnostic({
        state: resetFailureState,
        nowMs: failedAtMs,
        lastSameVideoAtMs,
        lastCommitAtMs,
        lastAdvanceAtMs,
      });
      if (diagnostic) {
        process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
        process.stderr.write(`collector_window_reset_diagnostic:${JSON.stringify(diagnostic)}\n`);
      }
    };
    if (params.rawHarvest) {
      await writeCollectorRawWindowProgress({
        windowId: session.windowId,
        state: "started",
      });
    }
    const isRightSearchWindow = searchRoutes.some(
      (route) => route.searchWindowId === session.windowId,
    );
    const initialScheduleTime = new Date();
    let captureCurrentBeforeSearch = resolveCollectorWindowStartupMode({
      isRightSearchWindow,
      hour: initialScheduleTime.getHours(),
      dayOfWeek: initialScheduleTime.getDay(),
      startupQualified: startupQualifiedWindowIds.has(session.windowId),
      restart: 0,
    }).captureCurrentBeforeSearch;
    const sessionDeadlineAt = params.deadlineAt ?? rawRotationDeadlineAt;
    while (!prepared.shared.qualifiedTargetReached()
      && (sessionDeadlineAt === undefined || Date.now() < sessionDeadlineAt)) {
      try {
        const scheduleTime = new Date();
        const allowSearchNow = isRightSearchWindow
          && shouldUseWeixinChannelsSearchAtHour(
            scheduleTime.getHours(),
            scheduleTime.getDay(),
          );
        const startupMode = resolveCollectorWindowStartupMode({
          isRightSearchWindow,
          hour: scheduleTime.getHours(),
          dayOfWeek: scheduleTime.getDay(),
          startupQualified: captureCurrentBeforeSearch,
          restart,
        });
        const result = await runCollectionPool({
          screenshot: collectorScreenshotForWindow(params.screenshot, session.windowId),
          server: params.server,
          token: params.token,
          probe: params.probe,
          maxScanned: captureCurrentBeforeSearch ? 1 : params.maxScanned,
          // 正式无人值守长跑先原子落盘，再由共享后台批量传 Fly；有目标数或
          // 截止时间的验收探针仍同步等服务器确认，避免把 queued 冒充验收成功。
          deferUploads: shouldDeferCollectorUploads({
            probe: params.probe,
            maxScanned: params.maxScanned,
            maxQualified: params.maxQualified,
            deadlineAt: params.deadlineAt,
          }),
          allowSearch: allowSearchNow,
          searchScheduleManaged: isRightSearchWindow,
          // 夜间正式右窗与探针使用同一启动语义：先保住启动时已达标的
          // 当前视频；否则首次进入最热门搜索。恢复重启不得从未知页面直搜。
          startInSearch: startupMode.startInSearch,
          deadlineAt: sessionDeadlineAt,
          onObservationPersisted: (event) => {
            markWindowHealthyProgress("commit");
            recordPersistedEvent(event);
          },
          shared: prepared.shared,
          initialRecovery: restart === 0 ? initialRecovery : undefined,
          rawHarvest: params.rawHarvest,
          windowProgressStalled: () => (
            collectorWindowLocalResetRequired(lastWindowProgressAtMs)
          ),
          onVideoAdvanced: () => markWindowHealthyProgress("advance"),
          onRawCaptureCommitted: async (manifest) => {
            markWindowHealthyProgress("commit");
            await writeCollectorRawWindowProgress({
              windowId: session.windowId,
              state: "raw_capture_committed",
              rawId: manifest.rawId,
            });
            const repetition = nextRawCommittedVideoRepetition(
              lastRawCommittedVideoIdentity,
              consecutiveSameRawVideoCommits,
              manifest.videoIdentity,
            );
            lastRawCommittedVideoIdentity = repetition.videoIdentity;
            consecutiveSameRawVideoCommits = repetition.count;
            if (repetition.blocked) {
              const repeatedAtMs = Date.now();
              const repeatedReason = "weixin_channels_repeated_same_video_committed_twice";
              prepared.shared.abortReason = "collector_cache_reset_restart_required";
              await recordResetFailure(repeatedAtMs, repeatedAtMs, repeatedReason, false);
              await writeCollectorRawWindowProgress({
                windowId: session.windowId,
                state: "global_restart_requested",
                rawId: manifest.rawId,
              });
              process.stderr.write(`collector_repeated_same_video_blocked:${JSON.stringify({
                windowId: session.windowId,
                rawId: manifest.rawId,
                consecutiveSameRawVideoCommits,
              })}\n`);
              await requestGlobalCollectorRestart({
                windowId: session.windowId,
                pid: session.pid,
                reason: repeatedReason,
                consecutiveFailures: consecutiveSameRawVideoCommits,
              });
              return;
            }
            await params.onRawCaptureCommitted?.(manifest);
          },
          onRawVideoAdvanced: params.rawHarvest
            ? async (manifest) => {
              restart = nextWeixinChannelsRawFailureCount(restart, "video_advanced");
              markWindowHealthyProgress("advance");
              await writeCollectorRawWindowProgress({
                windowId: session.windowId,
                state: "video_advanced",
                rawId: manifest.rawId,
              });
            }
            : undefined,
        });
        const reason = String(result.stopped);
        if (captureCurrentBeforeSearch && reason === "max_scanned_reached") {
          captureCurrentBeforeSearch = false;
          process.stderr.write(`right_current_video_processed_before_search:${session.windowId}\n`);
          continue;
        }
        if (reason.startsWith("max_scanned_reached") || reason.startsWith("qualified_target_reached")
          || reason.startsWith("capture_disabled") || reason === "capture_control_changed"
          || reason.startsWith("probe_deadline_reached")
          || reason === "raw_child_restart_required"
          || reason === "raw_harvest_batch_ready") {
          return { windowId: session.windowId, ...result };
        }
        lastFailure = reason;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }
      if (isCollectorWindowBindingFailure(lastFailure)) {
        if (await collectorWindowBindingMissingPersistently(session)) {
          prepared.shared.abortReason = "window_rebind_required";
          return {
            windowId: session.windowId,
            stopped: "window_rebind_required",
            error: lastFailure,
          };
        }
        process.stderr.write(`collector_window_binding_transient:${session.windowId}:${lastFailure}\n`);
      }

      const failureAtMs = Date.now();
      const failureStage = classifyCollectorWindowFailureStage(lastFailure);
      restart = nextWeixinChannelsRawFailureCount(restart, "failure");
      const windowStalled = lastFailure === "weixin_channels_local_window_stall_180s"
        || lastFailure.startsWith("window_local_reset_required:")
        || collectorWindowLocalResetRequired(lastWindowProgressAtMs, failureAtMs);
      process.stderr.write(`collector_window_recovering:${session.windowId}:attempt=${restart}:reason=${lastFailure}\n`);

      if (params.rawHarvest) {
        // page_transition 已在 advanceRawToNextVideo 内实际滑动两次。其他错误
        // 连续两次、或任一窗口确认阻塞时，也停止整组，不能只剩单窗运行。
        const globalRestartRequired = windowStalled
          || failureStage === "page_transition"
          || shouldRestartWeixinChannelsRawChild(restart);
        if (globalRestartRequired) {
          prepared.shared.abortReason = "collector_cache_reset_restart_required";
          await writeCollectorRawWindowProgress({
            windowId: session.windowId,
            state: "global_restart_requested",
          });
          await recordResetFailure(failureAtMs, failureAtMs, lastFailure, false);
          await requestGlobalCollectorRestart({
            windowId: session.windowId,
            pid: session.pid,
            reason: lastFailure,
            consecutiveFailures: restart,
          });
          return {
            windowId: session.windowId,
            stopped: "collector_cache_reset_restart_required",
            error: lastFailure,
          };
        }
        const delayMs = collectorWindowRecoveryDelayMs(
          lastFailure,
          restart,
          sessionDeadlineAt,
        );
        const controlStopReason = await waitForCollectorRecoveryDelay({
          delayMs,
          server: params.server,
          token: params.token,
          shared: prepared.shared,
        });
        if (controlStopReason) {
          return {
            windowId: session.windowId,
            stopped: controlStopReason,
            error: lastFailure,
          };
        }
        continue;
      }

      const diagnosis = await failureDiagnosisGate.run(() => diagnoseCollectorFailure({
        sessions: [session],
        screenshot: params.screenshot,
        stopReason: `window_${session.windowId}:${lastFailure}`,
      }));
      if (diagnosis.fuseReason) {
        const consecutiveFailures = diagnosis.fuseReason === "persistent_black_screen"
          ? diagnosis.state.consecutiveBlackScreens
          : diagnosis.state.consecutiveSameContent;
        try {
          await pauseCollectorForSafetyFuse({
            server: params.server,
            token: params.token,
            reason: diagnosis.fuseReason,
            consecutiveFailures,
          });
          prepared.shared.abortReason = "capture_disabled_safety_fuse";
        } catch (error) {
          process.stderr.write(`collector_safety_pause_failed:${error instanceof Error ? error.message : String(error)}\n`);
          prepared.shared.abortReason = "dual_window_fail_closed";
        }
        return {
          windowId: session.windowId,
          stopped: prepared.shared.abortReason,
          error: diagnosis.fuseReason,
        };
      }
      const delayMs = collectorWindowRecoveryDelayMs(
        lastFailure,
        restart,
        sessionDeadlineAt,
      );
      const controlStopReason = await waitForCollectorRecoveryDelay({
        delayMs,
        server: params.server,
        token: params.token,
        shared: prepared.shared,
      });
      if (controlStopReason) {
        return {
          windowId: session.windowId,
          stopped: controlStopReason,
          error: lastFailure,
        };
      }
    }
    return {
      windowId: session.windowId,
      stopped: prepared.shared.qualifiedTargetReached()
        ? "qualified_target_reached"
        : params.rawHarvest
          ? "raw_harvest_batch_ready"
          : "probe_deadline_reached",
      error: lastFailure,
    };
  });
  // 两窗独立推进：禁止右窗等待左窗的首帧 OCR。鼠标、键盘与截图仍由全局
  // FIFO 串行，所以不会互抢物理输入；OCR、网络与等待阶段可以真正并发。
  const runs = params.sessions.map((session) => runSession(
    session,
    session.windowId === leftRecommendationWindowId ? prepared.initialRecovery : undefined,
  ));
  const windows = await Promise.all(runs);
  const stoppedReasons = windows.map((result) => String(result.stopped));
  let stopped = prepared.shared.abortReason === "capture_control_changed"
    ? "capture_control_changed"
    : prepared.shared.abortReason === "collector_cache_reset_restart_required"
      ? "collector_cache_reset_restart_required"
    : prepared.shared.abortReason === "raw_child_restart_required"
      ? "raw_child_restart_required"
    : prepared.shared.abortReason === "capture_disabled"
      ? "capture_disabled"
      : stoppedReasons.every((reason) => reason.startsWith("capture_disabled"))
        ? "capture_disabled"
    : stoppedReasons.every((reason) => reason === "dual_window_fail_closed")
      ? "dual_window_fail_closed"
      : stoppedReasons.every((reason) => reason === "window_rebind_required")
        ? "window_rebind_required"
    : stoppedReasons.every((reason) => reason === "qualified_target_reached")
      ? "qualified_target_reached"
    : stoppedReasons.every((reason) => reason === "max_scanned_reached")
      ? "max_scanned_reached"
      : params.rawHarvest
        && stoppedReasons.every((reason) => reason === "raw_harvest_batch_ready")
        ? "raw_harvest_batch_ready"
      : "all_windows_stopped";
  let rawBatch: Awaited<ReturnType<typeof processWeixinChannelsRawRun>> | undefined;
  if (stopped === "raw_harvest_batch_ready" && prepared.shared.rawSpool) {
    const sealed = await sealWeixinChannelsRawRun({
      root: prepared.shared.rawSpool.root,
      run: prepared.shared.rawSpool.run,
    });
    if (params.rawOfflineWorkerManaged) {
      rawBatch = {
        event: "raw_batch_sealed",
        runId: sealed.runId,
        found: (await listWeixinChannelsRawManifests({
          root: prepared.shared.rawSpool.root,
          runId: sealed.runId,
        })).length,
        accepted: 0,
        rejected: 0,
        duplicate: 0,
        failed: 0,
        resumedThisProcess: {
          accepted: 0,
          rejected: 0,
          duplicate: 0,
          failed: 0,
        },
        abandonedReservations: sealed.abandonedReservations || 0,
        modelCalls: 0,
      };
      stopped = "raw_batch_sealed";
    } else {
      rawBatch = await processWeixinChannelsRawRun({
        root: prepared.shared.rawSpool.root,
        run: sealed,
        knownVideoIdentities: new Set(prepared.shared.seenRegistry.entries.keys()),
        knownObservationIds: new Set(prepared.shared.seenRegistry.observationIds),
      });
      // 当前浮窗即将随本批结束而关闭；pending 由下一轮共享 runtime 启动时接管，
      // 避免旧回调在状态文件清理后又写回上一批数字。
      stopped = "raw_offline_batch_processed";
    }
  }
  let recovery: Awaited<ReturnType<typeof diagnoseCollectorFailure>> | undefined;
  if (stopped !== "qualified_target_reached"
    && stopped !== "capture_disabled"
    && stopped !== "capture_control_changed"
    && stopped !== "max_scanned_reached"
    && stopped !== "collector_cache_reset_restart_required"
    && stopped !== "raw_child_restart_required"
    && stopped !== "raw_batch_sealed"
    && stopped !== "raw_offline_batch_processed"
    && stopped !== "window_rebind_required"
    && stopped !== "dual_window_fail_closed") {
    recovery = await diagnoseCollectorFailure({
      sessions: params.sessions,
      screenshot: params.screenshot,
      stopReason: windows.map((window) => `window_${window.windowId}:${"error" in window ? window.error : window.stopped}`).join("|"),
    });
    if (recovery.fuseReason) {
      const consecutiveFailures = recovery.fuseReason === "persistent_black_screen"
        ? recovery.state.consecutiveBlackScreens
        : recovery.state.consecutiveSameContent;
      try {
        await pauseCollectorForSafetyFuse({
          server: params.server,
          token: params.token,
          reason: recovery.fuseReason,
          consecutiveFailures,
        });
        stopped = "capture_disabled_safety_fuse";
      } catch (error) {
        // 远端没有确认暂停时绝不能在本地冒充已暂停，也不能继续自动重启撞 UI。
        process.stderr.write(`collector_safety_pause_failed:${error instanceof Error ? error.message : String(error)}\n`);
        stopped = "dual_window_fail_closed";
      }
    }
  }
  return {
    stopped,
    windows,
    recovery,
    scanned: windows.reduce((sum, result) => sum + ("scanned" in result ? Number(result.scanned || 0) : 0), 0),
    qualified: windows.reduce((sum, result) => sum + ("qualified" in result ? Number(result.qualified || 0) : 0), 0),
    qualifiedPersistedTotal: prepared.shared.qualifiedPersistedTotal(),
    qualificationElapsedMs: Date.now() - prepared.shared.qualificationStartedAt,
    modelCalls: 0,
    events,
    rawBatch,
    windowRoles: {
      leftRecommendationWindowId,
      rightSearchWindowId,
    },
  };
}

export async function executeDualWindowProbeEngine(params: {
  windowIds: number[];
  screenshot: string;
  server: string;
  token: string;
  target: number;
  timeoutMs: number;
  calibrateSearchButtons?: boolean;
}) {
  await prepareWeixinCollectorExecutables();
  const sessions = await discoverCollectorWindowSessions(params.windowIds);
  if (sessions.length !== 2) throw new Error("weixin_channels_dual_window_probe_requires_two_windows");
  if (params.calibrateSearchButtons) {
    await calibrateCollectorSearchButtonsForSessions(sessions);
  }
  return runDualWindowCaptureStateMachine({
    sessions,
    screenshot: params.screenshot,
    server: params.server,
    token: params.token,
    probe: false,
    maxQualified: params.target,
    dualWindowProbe: true,
    deadlineAt: Date.now() + params.timeoutMs,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const automate = args.includes("--automate");
  const interact = args.includes("--interact");
  const pool = args.includes("--pool");
  const probe = args.includes("--probe");
  const searchProbe = args.includes("--search-probe");
  const dualWindowProbe = args.includes("--dual-window-probe");
  const {
    autoBindExactTwoWindows,
    calibrateSearchButtons,
    superviseWebToggle,
    rawHarvest,
    rawOfflineWorkerManaged,
    reuseSearchCalibration,
    windowIds: requestedWindowIds,
  } = parseCollectorFormalPoolOptions(args);
  const screenshotArg = args.find((item) => item.startsWith("--screenshot="));
  const taskArg = args.find((item) => item.startsWith("--task-id="));
  const queryArg = args.find((item) => item.startsWith("--query="));
  const titleArg = args.find((item) => item.startsWith("--title="));
  const authorArg = args.find((item) => item.startsWith("--author="));
  const serverArg = args.find((item) => item.startsWith("--server="));
  const maxScannedArg = args.find((item) => item.startsWith("--max-scanned="));
  const maxQualifiedArg = args.find((item) => item.startsWith("--max-qualified="));
  const screenshot = screenshotArg?.slice("--screenshot=".length)
    || path.join(os.tmpdir(), `weixin-channels-window-${process.pid}.png`);
  await prepareWeixinCollectorExecutables();
  if (searchProbe) {
    if (!queryArg) throw new Error("--search-probe requires --query=...");
    const sessions = await discoverCollectorWindowSessions(requestedWindowIds);
    if (sessions.length !== 1) throw new Error("weixin_channels_search_probe_single_window_required");
    collectorWindowScopeRequired = true;
    collectorSearchTabStates.set(sessions[0]!.windowId, await loadCollectorSearchTabState(sessions[0]!.windowId));
    const result = await collectorWindowContext.run(sessions[0]!, () => runBoundedSearchProbe(
      queryArg.slice("--query=".length),
      collectorScreenshotForWindow(screenshot, sessions[0]!.windowId),
    ));
    process.stdout.write(`${JSON.stringify({ event: "collector_session_summary", ...result })}\n`);
    return;
  }
  if (pool) {
    if (!serverArg) throw new Error("--pool requires --server=https://...");
    const token = String(process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN || "").trim();
    if (!token) throw new Error("WEIXIN_CHANNELS_COLLECTOR_TOKEN is required for pool mode");
    const maxScanned = maxScannedArg ? Number(maxScannedArg.slice("--max-scanned=".length)) : undefined;
    const maxQualified = maxQualifiedArg
      ? Number(maxQualifiedArg.slice("--max-qualified=".length))
      : dualWindowProbe ? 10 : undefined;
    if (maxQualified !== undefined && (!Number.isInteger(maxQualified) || maxQualified <= 0)) {
      throw new Error("weixin_channels_max_qualified_invalid");
    }
    const server = serverArg.slice("--server=".length).replace(/\/$/, "");
    let reuseCalibrationForRawCycle = reuseSearchCalibration;
    for (;;) {
      if (superviseWebToggle) {
        // 左上角按钮先写本地持久请求再终止旧进程。launchd 拉起的新进程
        // 必须先把 Fly 开关确认关闭，期间绝不发现窗口或触碰微信。
        await persistCollectorLocalStopRequest(server, token);
      }
      // 正式 launchd 进程常驻等待网页开关；停采期间不发现窗口、不截图、
      // 不弹校准层，也不触碰微信。重新开启后才重新绑定当前两窗。
      const controlHeartbeat = superviseWebToggle
        ? await waitForCollectorWebToggleEnabled(server, token)
        : undefined;
      const sessions = await discoverCollectorWindowSessions(
        requestedWindowIds,
        autoBindExactTwoWindows,
      );
      if (dualWindowProbe && sessions.length !== 2) {
        throw new Error("weixin_channels_dual_window_probe_requires_two_windows");
      }
      if (calibrateSearchButtons) {
        const controlRevision = controlHeartbeat?.controlRevision;
        // 只有同一网页控制版本内的二十分钟子进程轮换允许复用。旧校准文件
        // 没有 controlRevision，或用户停采后再开采导致版本变化时，左右窗都会
        // 逐一重新弹出十字校准；任一窗未完成就不会进入采集状态机。
        const canReuseCurrentControlRevision = reuseCalibrationForRawCycle
          && Number.isInteger(controlRevision);
        await calibrateCollectorSearchButtonsForSessions(sessions, {
          formal: true,
          force: !canReuseCurrentControlRevision,
          controlRevision,
        });
      }
      let floatingControl: ChildProcess | undefined;
      let sessionNew = 0;
      let rawCaptured = 0;
      let formalQualifiedTotal = controlHeartbeat?.formalQualifiedTotal;
      const floatingStatusGate = createAsyncSerialGate();
      if (superviseWebToggle) {
        await writeCollectorFloatingStatus({
          state: "collecting",
          sessionNew,
          rawCaptured,
          formalQualifiedTotal,
          updatedAt: new Date().toISOString(),
        });
        floatingControl = await launchCollectorFloatingControl();
        floatingControl.once("error", (error) => {
          process.stderr.write(`collector_floating_control_failed:${error.message}\n`);
        });
      }
      let result: Awaited<ReturnType<typeof runDualWindowCaptureStateMachine>>;
      try {
        result = await runDualWindowCaptureStateMachine({
          sessions,
          screenshot,
          server,
          token,
          probe,
          maxScanned,
          maxQualified,
          dualWindowProbe,
          controlRevision: controlHeartbeat?.controlRevision,
          onObservationPersisted: superviseWebToggle
            ? (event) => {
              const nextCounts = nextCollectorFloatingCounts({
                sessionNew,
                formalQualifiedTotal,
              }, event);
              if (nextCounts.sessionNew === sessionNew) return;
              sessionNew = nextCounts.sessionNew;
              formalQualifiedTotal = nextCounts.formalQualifiedTotal;
              void floatingStatusGate.run(() => writeCollectorFloatingStatus({
                state: "collecting",
                sessionNew,
                rawCaptured,
                formalQualifiedTotal,
                updatedAt: new Date().toISOString(),
              })).catch((error) => {
                process.stderr.write(`collector_floating_status_failed:${
                  error instanceof Error ? error.message : String(error)
                }\n`);
              });
            }
            : undefined,
          rawHarvest,
          rawOfflineWorkerManaged,
          onRawCaptureCommitted: superviseWebToggle
            ? () => {
              rawCaptured += 1;
              void floatingStatusGate.run(() => writeCollectorFloatingStatus({
                state: "collecting",
                sessionNew,
                rawCaptured,
                formalQualifiedTotal,
                updatedAt: new Date().toISOString(),
              })).catch((error) => {
                process.stderr.write("collector_floating_raw_status_failed:"
                  + (error instanceof Error ? error.message : String(error)) + "\n");
              });
            }
            : undefined,
        });
      } finally {
        floatingControl?.kill("SIGTERM");
        // 等所有已排队的入库计数落盘后再删除状态，避免最后一个异步写入
        // 在清理之后重新创建文件，让下次启动显示上一轮的陈旧数字。
        await floatingStatusGate.run(async () => undefined);
        await removeCollectorFloatingStatus();
      }
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (rawOfflineWorkerManaged
        && (result.stopped === "raw_batch_sealed"
          || result.stopped === "collector_cache_reset_restart_required"
          || result.stopped === "raw_child_restart_required")) {
        // launcher 识别 76 为预期轮换/整组恢复；离线 worker 不退出。
        process.exitCode = 76;
        return;
      }
      if (superviseWebToggle
        && (shouldRestartCollectorSupervisorAfterStop(String(result.stopped || ""))
          || result.stopped === "raw_offline_batch_processed")) {
        reuseCalibrationForRawCycle = result.stopped === "raw_offline_batch_processed";
        continue;
      }
      // 非正式监督模式保留原有 launchd 重启契约；有界探针永不循环。
      if (shouldLaunchdRestartCollector(String(result.stopped || ""), maxScanned, maxQualified)) {
        process.exitCode = 75;
      }
      return;
    }
  }
  if (automate || interact) {
    const sessions = await discoverCollectorWindowSessions(requestedWindowIds);
    if (sessions.length !== 1) throw new Error("weixin_channels_single_window_id_required");
    collectorWindowScopeRequired = true;
    return collectorWindowContext.run(sessions[0]!, () => runSingleCapture(args, {
      screenshot, taskArg, queryArg, titleArg, authorArg, serverArg, automate, interact, probe,
    }));
  }
  return runSingleCapture(args, {
    screenshot, taskArg, queryArg, titleArg, authorArg, serverArg, automate, interact, probe,
  });
}

async function runSingleCapture(
  args: string[],
  input: {
    screenshot: string;
    taskArg?: string;
    queryArg?: string;
    titleArg?: string;
    authorArg?: string;
    serverArg?: string;
    automate: boolean;
    interact: boolean;
    probe: boolean;
  },
) {
  const { screenshot, taskArg, queryArg, titleArg, authorArg, serverArg, automate, interact, probe } = input;
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
