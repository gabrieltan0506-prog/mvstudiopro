#!/usr/bin/env tsx
/**
 * 视频号双窗口正式链路探针。
 *
 * 直接运行双窗口采集状态机，不再启动旧的 --pool 子进程。通过条件是指定数量的
 * 正式 observation 逐条得到 Fly 持久化确认；全部通过后才各调用一次 DeepSeek
 * 与 Terra，采集阶段严格保持零模型调用。
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  invokeWeixinChannelsDeepSeekBatch,
  invokeWeixinChannelsTerraCleanup,
  persistableWeixinChannelsObservation,
  type FinalAnalysisJob,
} from "../server/growth/weixinChannelsMiner";
import {
  executeDualWindowProbeEngine,
  type WeixinChannelsPersistedObservationEvent,
} from "./weixin-channels-capture.mts";
import {
  qualifyWeixinChannelsObservationLocally,
  WEIXIN_CHANNELS_COMMENT_THRESHOLD,
} from "../shared/weixinChannelsRules";

const execFileAsync = promisify(execFile);
const DEFAULT_SERVER = "https://api.mvstudiopro.com";
const DEFAULT_TARGET = 10;
const DEFAULT_TIMEOUT_MINUTES = 15;
const PROBE_LOCK_DIR = path.join(os.tmpdir(), "mvstudiopro-weixin-channels-dual-probe.lock");
const PROBE_LOCK_OWNER = path.join(PROBE_LOCK_DIR, "owner.json");
const EMERGENCY_STOP_SCRIPT = path.join(import.meta.dirname, "weixin-channels-emergency-stop.swift");

function launchEmergencyStopButton(targetPid: number) {
  return spawn("/usr/bin/swift", [EMERGENCY_STOP_SCRIPT, String(targetPid)], {
    stdio: "ignore",
  });
}

type ObservationEvent = WeixinChannelsPersistedObservationEvent;

type SummaryEvent = {
  event: "collector_session_summary";
  stopped: string;
  qualifiedPersistedTotal: number;
  qualificationElapsedMs: number;
  modelCalls: number;
  windowRoles: {
    leftRecommendationWindowId: number;
    rightSearchWindowId: number;
  };
};

export function parseDualWindowProbeArgs(args: string[]) {
  const value = (name: string) => args.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  const windowIds = args.filter((item) => item.startsWith("--window-id=")).map((item) => Number(item.slice(12)));
  const target = Number(value("target") || DEFAULT_TARGET);
  const timeoutMinutes = Number(value("timeout-minutes") || DEFAULT_TIMEOUT_MINUTES);
  const server = String(value("server") || DEFAULT_SERVER).replace(/\/$/, "");
  if (!args.includes("--execute-dual-window-probe")) throw new Error("dual_window_probe_explicit_execute_flag_required");
  if (windowIds.length !== 2 || new Set(windowIds).size !== 2
    || windowIds.some((windowId) => !Number.isInteger(windowId) || windowId <= 0)) {
    throw new Error("dual_window_probe_requires_two_unique_window_ids");
  }
  if (!Number.isInteger(target) || target <= 0 || target > 20) throw new Error("dual_window_probe_target_invalid");
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 30) {
    throw new Error("dual_window_probe_timeout_invalid");
  }
  return { windowIds, target, timeoutMs: Math.round(timeoutMinutes * 60_000), server };
}

export function validateDualWindowProbeResult(params: {
  events: ObservationEvent[];
  summary?: SummaryEvent;
  windowIds: number[];
  target: number;
  persistedIds: Set<string>;
}) {
  const unique = new Map(params.events.map((event) => [event.observationId, event]));
  const events = Array.from(unique.values());
  if (!params.summary || params.summary.stopped !== "qualified_target_reached") {
    throw new Error(`dual_window_probe_target_not_reached:${params.summary?.stopped || "summary_missing"}`);
  }
  if (params.summary.modelCalls !== 0 || events.some((event) => event.modelCalls !== 0)) {
    throw new Error("dual_window_probe_model_call_detected");
  }
  if (events.length < params.target || params.summary.qualifiedPersistedTotal < params.target) {
    throw new Error(`dual_window_probe_unique_target_missing:${events.length}/${params.target}`);
  }
  const invalid = events.find((event) => {
    const qualification = qualifyWeixinChannelsObservationLocally(event.analysisObservation);
    return event.runKind !== "formal"
      || !event.qualified
      || !qualification.qualified
      || !event.serverQualified
      || !event.persisted
      || !event.newlyPersisted
      || !event.newlyQualifiedPersisted
      || (event.comments >= WEIXIN_CHANNELS_COMMENT_THRESHOLD && event.commentSampleCount <= 0);
  });
  if (invalid) throw new Error(`dual_window_probe_invalid_observation:${invalid.observationId}`);
  const leftWindowId = params.summary.windowRoles.leftRecommendationWindowId;
  const rightWindowId = params.summary.windowRoles.rightSearchWindowId;
  if (!params.windowIds.includes(leftWindowId) || !params.windowIds.includes(rightWindowId)
    || leftWindowId === rightWindowId) {
    throw new Error("dual_window_probe_window_roles_invalid");
  }
  if (!events.some((event) => event.windowId === leftWindowId && event.query === "推荐页")) {
    throw new Error("dual_window_probe_left_recommendation_path_missing");
  }
  if (!events.some((event) => event.windowId === rightWindowId)) {
    throw new Error("dual_window_probe_right_window_path_missing");
  }
  const missingFly = events.find((event) => !params.persistedIds.has(event.observationId));
  if (missingFly) throw new Error(`dual_window_probe_fly_identity_missing:${missingFly.observationId}`);
  return {
    ok: true as const,
    target: params.target,
    uniquePersisted: events.length,
    leftRecommendationPersisted: events.filter((event) => event.windowId === leftWindowId).length,
    rightWindowPersisted: events.filter((event) => event.windowId === rightWindowId).length,
    observationIds: events.map((event) => event.observationId),
    elapsedMs: params.summary.qualificationElapsedMs,
    modelCalls: 0,
  };
}

async function readCollectorToken() {
  const existing = String(process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN || "").trim();
  if (existing) return existing;
  const account = os.userInfo().username;
  const { stdout } = await execFileAsync("/usr/bin/security", [
    "find-generic-password",
    "-a",
    account,
    "-s",
    "mvstudiopro-weixin-channels-collector",
    "-w",
  ]);
  const token = stdout.trim();
  if (!token) throw new Error("dual_window_probe_collector_token_missing");
  return token;
}

async function assertNoCollectorPool() {
  try {
    const { stdout } = await execFileAsync("/usr/bin/pgrep", [
      "-f",
      "[s]cripts/weixin-channels-capture.mts.*--pool",
    ]);
    if (stdout.trim()) throw new Error(`dual_window_probe_collector_already_running:${stdout.trim().replace(/\s+/g, ",")}`);
  } catch (error) {
    const code = String((error as NodeJS.ErrnoException).code || "");
    if (code !== "1") throw error;
  }
}

function processIsAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireProbeLock() {
  const owner = { pid: process.pid, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.mkdir(PROBE_LOCK_DIR);
      await fs.writeFile(PROBE_LOCK_OWNER, JSON.stringify(owner), "utf8");
      return owner;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing: { pid?: number } = await fs.readFile(PROBE_LOCK_OWNER, "utf8")
        .then((text) => JSON.parse(text) as { pid?: number })
        .catch(() => ({} as { pid?: number }));
      if (existing.pid && processIsAlive(existing.pid)) {
        throw new Error(`dual_window_probe_already_running:${existing.pid}`);
      }
      await fs.rm(PROBE_LOCK_DIR, { recursive: true, force: true });
    }
  }
  throw new Error("dual_window_probe_lock_acquire_failed");
}

async function releaseProbeLock(owner: { pid: number; startedAt: string }) {
  const existing = await fs.readFile(PROBE_LOCK_OWNER, "utf8")
    .then((text) => JSON.parse(text) as { pid?: number; startedAt?: string })
    .catch(() => undefined);
  if (existing?.pid === owner.pid && existing.startedAt === owner.startedAt) {
    await fs.rm(PROBE_LOCK_DIR, { recursive: true, force: true });
  }
}

async function fetchJson(server: string, token: string, pathname: string) {
  const response = await fetch(`${server}${pathname}`, {
    headers: { "x-weixin-channels-collector-token": token },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`dual_window_probe_http_failed:${response.status}:${text.slice(0, 300)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function runPaidAnalysis(events: ObservationEvent[], startedAt: string) {
  const observations = events.map((event) =>
    persistableWeixinChannelsObservation(event.analysisObservation));
  if (observations.length !== events.length
    || observations.some((item) => !item.qualified || item.invalid)) {
    throw new Error("dual_window_probe_paid_input_invalid");
  }
  const stamp = startedAt.replace(/\D/g, "").slice(0, 14);
  const now = new Date().toISOString();
  const deepseekJob: FinalAnalysisJob = {
    jobId: `wxc_dual_probe_deepseek_${stamp}`,
    kind: "probe",
    stage: "deepseek_batch",
    threshold: observations.length,
    rawCount: observations.length,
    locallyDedupedCount: observations.length,
    observationIds: observations.map((item) => item.observationId),
    analysisObservationIds: observations.map((item) => item.observationId),
    lunaBatchIds: [],
    status: "processing",
    terraModel: "deepseek/deepseek-v4-pro-0813",
    reasoningEffort: "high",
    createdAt: now,
    updatedAt: now,
  };
  const deepseek = await invokeWeixinChannelsDeepSeekBatch({
    job: deepseekJob,
    observations,
  });
  const terraJob: FinalAnalysisJob = {
    ...deepseekJob,
    jobId: `wxc_dual_probe_terra_${stamp}`,
    stage: "terra_cleanup",
    sourceJobIds: [deepseekJob.jobId],
    observationIds: [],
    analysisObservationIds: [],
    terraModel: "gpt-5.6-terra",
  };
  const terra = await invokeWeixinChannelsTerraCleanup({
    job: terraJob,
    batchResults: [{
      jobId: deepseekJob.jobId,
      rawCount: observations.length,
      result: deepseek.result,
    }],
  });
  return {
    deepseek: {
      jobId: deepseekJob.jobId,
      model: deepseekJob.terraModel,
      provider: deepseek.provider,
      usage: deepseek.usage,
      result: deepseek.result,
    },
    terra: {
      jobId: terraJob.jobId,
      model: terraJob.terraModel,
      provider: terra.provider,
      usage: terra.usage,
      result: terra.result,
    },
  };
}

async function main() {
  const parsed = parseDualWindowProbeArgs(process.argv.slice(2));
  await assertNoCollectorPool();
  const lockOwner = await acquireProbeLock();
  let emergencyStop: ChildProcess | undefined;
  try {
    emergencyStop = launchEmergencyStopButton(process.pid);
    const token = await readCollectorToken();
    const startedAt = new Date().toISOString();
    const before = await fetchJson(parsed.server, token, "/api/internal/weixin-channels/status");
    if ((before.capture as { enabled?: boolean } | undefined)?.enabled !== true) {
      throw new Error("dual_window_probe_capture_disabled");
    }
    const engine = await executeDualWindowProbeEngine({
      windowIds: parsed.windowIds,
      screenshot: path.join(os.tmpdir(), `mvstudiopro-weixin-channels-dual-probe-${process.pid}.png`),
      server: parsed.server,
      token,
      target: parsed.target,
      timeoutMs: parsed.timeoutMs,
      calibrateSearchButtons: true,
    });
    const events = engine.events;
    const summary: SummaryEvent = {
      event: "collector_session_summary",
      stopped: engine.stopped,
      qualifiedPersistedTotal: engine.qualifiedPersistedTotal,
      qualificationElapsedMs: engine.qualificationElapsedMs,
      modelCalls: engine.modelCalls,
      windowRoles: engine.windowRoles,
    };

    const identities = await fetchJson(
      parsed.server,
      token,
      `/api/internal/weixin-channels/persisted-identities?since=${encodeURIComponent(startedAt)}`,
    );
    const persistedIds = new Set(
      ((identities.records as Array<{ observationId?: string }> | undefined) || [])
        .map((record) => record.observationId)
        .filter((value): value is string => Boolean(value)),
    );
    const result = validateDualWindowProbeResult({
      events,
      summary,
      windowIds: parsed.windowIds,
      target: parsed.target,
      persistedIds,
    });
    const acceptedEvents = Array.from(
      new Map(events.map((event) => [event.observationId, event])).values(),
    )
      .filter((event) => persistedIds.has(event.observationId))
      .slice(0, parsed.target);
    const paidAnalysis = await runPaidAnalysis(acceptedEvents, startedAt);
    process.stdout.write(`${JSON.stringify({
      event: "dual_window_probe_passed",
      startedAt,
      endedAt: new Date().toISOString(),
      beforeAccumulatedQualifiedCount: before.accumulatedQualifiedCount,
      ...result,
      paidModelCalls: 2,
      paidAnalysis,
    })}\n`);
  } finally {
    emergencyStop?.kill("SIGTERM");
    await releaseProbeLock(lockOwner);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
