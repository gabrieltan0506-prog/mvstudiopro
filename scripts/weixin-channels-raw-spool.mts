import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const WEIXIN_CHANNELS_RAW_BATCH_LIMIT = 2_000;
export const WEIXIN_CHANNELS_RAW_LATEST_LIMIT = 50;
/** 每轮只让 UI 子进程连续工作二十分钟，随后由 launcher 换新进程。 */
export const WEIXIN_CHANNELS_RAW_BATCH_INTERVAL_MS = 20 * 60_000;
export const WEIXIN_CHANNELS_RAW_COMPLETED_RUNS_WITH_ASSETS = 2;

export type WeixinChannelsRawSource =
  | "recommendation"
  | "search_latest"
  | "search_hottest";

export type WeixinChannelsRawAssetKind =
  | "player_base"
  | "player_progress"
  | "comments_page"
  | "comments_close_attempt"
  | "comments_close_result"
  | "player_closed"
  | "search_result";

export type WeixinChannelsRawAsset = {
  kind: WeixinChannelsRawAssetKind;
  file: string;
  progress?: number;
  page?: number;
  sha256: string;
  bytes: number;
};

export type WeixinChannelsRawManifestState =
  | "complete"
  | "processing"
  | "accepted"
  | "rejected"
  | "duplicate"
  | "failed";

export type WeixinChannelsRawManifest = {
  version: 1;
  rawId: string;
  runId: string;
  state: WeixinChannelsRawManifestState;
  source: WeixinChannelsRawSource;
  taskId: string;
  query: string;
  windowId: number;
  capturedAt: string;
  completedAt: string;
  captureElapsedMs: number;
  /** v1 旧批次可能没有；35 秒是本机 UI 退让诊断值，不是离线/服务端拒收上限。 */
  captureBudgetMs?: number;
  commentsStatus:
    | "captured"
    | "entry_missing"
    | "open_unconfirmed"
    | "closed_confirmed"
    | "skipped_not_required"
    | "skipped_budget";
  searchSelectedAgeDays?: number;
  assets: WeixinChannelsRawAsset[];
  rejectionReason?: string;
  observationId?: string;
};

export type WeixinChannelsRawReservation = {
  version: 1;
  rawId: string;
  runId: string;
  source: WeixinChannelsRawSource;
  taskId: string;
  query: string;
  windowId: number;
  searchSelectedAgeDays?: number;
  reservedAt: string;
};

export type WeixinChannelsRawFailureEvidence = {
  version: 1;
  rawId: string;
  runId: string;
  windowId: number;
  recordedAt: string;
  reason: string;
  ocrLines: Array<{ text: string; confidence: number; x: number; y: number; width: number; height: number }>;
  screenshot?: string;
};

export type WeixinChannelsRawRunState = {
  version: 1;
  runId: string;
  createdAt: string;
  harvestUntil: string;
  maxItems: number;
  latestLimit: number;
  phase: "harvesting" | "processing" | "complete" | "failed";
  sealedAt?: string;
  abandonedReservations?: number;
  failedAt?: string;
  failureReason?: string;
  processingFailures?: number;
};

export type WeixinChannelsRawSpoolSnapshot = {
  run: WeixinChannelsRawRunState;
  complete: number;
  reservations: number;
  latestComplete: number;
  latestReservations: number;
  remaining: number;
};

const ACTIVE_RUN_FILE = "active-run.json";
const RUN_STATE_FILE = "run.json";
const RUN_SUMMARY_FILE = "summary.json";
const SPOOL_LOCK_DIRECTORY = ".spool-lock";
const SPOOL_LOCK_OWNER_FILE = "owner.json";

async function withSpoolLock<T>(root: string, operation: () => Promise<T>) {
  const lock = path.join(root, SPOOL_LOCK_DIRECTORY);
  await fs.mkdir(root, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.mkdir(lock);
      try {
        await fs.writeFile(
          path.join(lock, SPOOL_LOCK_OWNER_FILE),
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        return await operation();
      } finally {
        await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let deadOwner = false;
      try {
        const owner = await readJson<{ pid?: number }>(path.join(lock, SPOOL_LOCK_OWNER_FILE));
        if (Number.isInteger(owner.pid) && Number(owner.pid) > 0) {
          try {
            process.kill(Number(owner.pid), 0);
          } catch (ownerError) {
            if ((ownerError as NodeJS.ErrnoException).code === "ESRCH") deadOwner = true;
          }
        }
      } catch (ownerReadError) {
        if ((ownerReadError as NodeJS.ErrnoException).code !== "ENOENT"
          && !(ownerReadError instanceof SyntaxError)) throw ownerReadError;
      }
      if (deadOwner) {
        await fs.rm(lock, { recursive: true, force: true });
        continue;
      }
      const stat = await fs.stat(lock).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > 60_000) {
        await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 2));
    }
  }
  throw new Error("weixin_channels_raw_spool_lock_timeout");
}

export function defaultWeixinChannelsRawSpoolRoot() {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "mvstudiopro",
    "weixin-channels-raw",
  );
}

function assertSafeSegment(value: string, field: string) {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(value)) {
    throw new Error(`weixin_channels_raw_${field}_invalid`);
  }
  return value;
}

function runDirectory(root: string, runId: string) {
  return path.join(root, "runs", assertSafeSegment(runId, "run_id"));
}

function runStateFile(root: string, runId: string) {
  return path.join(runDirectory(root, runId), RUN_STATE_FILE);
}

function manifestDirectory(root: string, runId: string) {
  return path.join(runDirectory(root, runId), "items");
}

function reservationDirectory(root: string, runId: string) {
  return path.join(runDirectory(root, runId), "reservations");
}

function manifestFile(root: string, runId: string, rawId: string) {
  return path.join(manifestDirectory(root, runId), assertSafeSegment(rawId, "raw_id"), "manifest.json");
}

async function writeJsonAtomic(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporary, file);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function listJsonFiles(directory: string) {
  try {
    return (await fs.readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(directory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function listItemDirectories(directory: string) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function sha256File(file: string) {
  const buffer = await fs.readFile(file);
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.byteLength,
  };
}

function createRunId(now = Date.now()) {
  return `raw_${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

export async function ensureWeixinChannelsRawRun(params: {
  root?: string;
  maxItems?: number;
  latestLimit?: number;
  batchIntervalMs?: number;
  now?: number;
}) {
  const root = params.root || defaultWeixinChannelsRawSpoolRoot();
  return withSpoolLock(root, async () => {
    const activeFile = path.join(root, ACTIVE_RUN_FILE);
    try {
      const active = await readJson<WeixinChannelsRawRunState>(activeFile);
      if (active.version !== 1 || !active.runId) throw new Error("weixin_channels_raw_run_state_invalid");
      return { root, run: active };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const maxItems = Math.max(1, Math.floor(params.maxItems || WEIXIN_CHANNELS_RAW_BATCH_LIMIT));
    const latestLimit = Math.max(0, Math.min(
      maxItems,
      Math.floor(params.latestLimit ?? WEIXIN_CHANNELS_RAW_LATEST_LIMIT),
    ));
    const now = params.now ?? Date.now();
    const batchIntervalMs = Math.max(60_000, Math.floor(
      params.batchIntervalMs || WEIXIN_CHANNELS_RAW_BATCH_INTERVAL_MS,
    ));
    const run: WeixinChannelsRawRunState = {
      version: 1,
      runId: createRunId(now),
      createdAt: new Date(now).toISOString(),
      harvestUntil: new Date(now + batchIntervalMs).toISOString(),
      maxItems,
      latestLimit,
      phase: "harvesting",
    };
    await fs.mkdir(manifestDirectory(root, run.runId), { recursive: true });
    await fs.mkdir(reservationDirectory(root, run.runId), { recursive: true });
    await writeJsonAtomic(activeFile, run);
    return { root, run };
  });
}

export async function readWeixinChannelsRawRun(params: {
  root: string;
  runId: string;
}) {
  return readJson<WeixinChannelsRawRunState>(runStateFile(
    params.root,
    params.runId,
  ));
}

export async function listWeixinChannelsRawRuns(params: {
  root?: string;
  phase?: WeixinChannelsRawRunState["phase"];
}) {
  const root = params.root || defaultWeixinChannelsRawSpoolRoot();
  const directories = await listItemDirectories(path.join(root, "runs"));
  const runs: WeixinChannelsRawRunState[] = [];
  for (const directory of directories) {
    try {
      const run = await readJson<WeixinChannelsRawRunState>(
        path.join(directory, RUN_STATE_FILE),
      );
      if (run.version !== 1 || !run.runId) continue;
      if (params.phase && run.phase !== params.phase) continue;
      runs.push(run);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function listWeixinChannelsRawManifests(params: {
  root: string;
  runId: string;
}) {
  const directories = await listItemDirectories(manifestDirectory(params.root, params.runId));
  const manifests: WeixinChannelsRawManifest[] = [];
  for (const directory of directories) {
    try {
      const manifest = await readJson<WeixinChannelsRawManifest>(path.join(directory, "manifest.json"));
      if (manifest.version === 1 && manifest.runId === params.runId) manifests.push(manifest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return manifests.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

export async function inspectWeixinChannelsRawSpool(params: {
  root: string;
  run: WeixinChannelsRawRunState;
}) {
  const manifests = await listWeixinChannelsRawManifests({ root: params.root, runId: params.run.runId });
  const reservationFiles = await listJsonFiles(reservationDirectory(params.root, params.run.runId));
  const reservations = await Promise.all(reservationFiles.map((file) => readJson<WeixinChannelsRawReservation>(file)));
  const committed = manifests.filter((item) => item.state !== "failed");
  const complete = committed.length;
  const latestComplete = committed.filter((item) => item.source === "search_latest").length;
  const latestReservations = reservations.filter((item) => item.source === "search_latest").length;
  return {
    run: params.run,
    complete,
    reservations: reservations.length,
    latestComplete,
    latestReservations,
    remaining: Math.max(0, params.run.maxItems - complete - reservations.length),
  } satisfies WeixinChannelsRawSpoolSnapshot;
}

export async function reserveWeixinChannelsRawSlot(params: {
  root: string;
  run: WeixinChannelsRawRunState;
  source: WeixinChannelsRawSource;
  taskId: string;
  query: string;
  windowId: number;
  searchSelectedAgeDays?: number;
  now?: number;
}) {
  return withSpoolLock(params.root, async () => {
    if (params.run.phase !== "harvesting") return null;
    if (Date.now() >= Date.parse(params.run.harvestUntil)) return null;
    const snapshot = await inspectWeixinChannelsRawSpool({ root: params.root, run: params.run });
    if (snapshot.remaining <= 0) return null;
    if (params.source === "search_latest"
      && snapshot.latestComplete + snapshot.latestReservations >= params.run.latestLimit) {
      return null;
    }
    const now = params.now ?? Date.now();
    const rawId = `w${params.windowId}_${now}_${randomUUID().slice(0, 8)}`;
    const reservation: WeixinChannelsRawReservation = {
      version: 1,
      rawId,
      runId: params.run.runId,
      source: params.source,
      taskId: params.taskId,
      query: params.query,
      windowId: params.windowId,
      searchSelectedAgeDays: params.searchSelectedAgeDays,
      reservedAt: new Date(now).toISOString(),
    };
    const file = path.join(reservationDirectory(params.root, params.run.runId), `${rawId}.json`);
    await writeJsonAtomic(file, reservation);
    return { reservation, file };
  });
}

export async function releaseWeixinChannelsRawSlot(params: {
  root: string;
  reservation: WeixinChannelsRawReservation;
}) {
  const file = path.join(
    reservationDirectory(params.root, params.reservation.runId),
    `${assertSafeSegment(params.reservation.rawId, "raw_id")}.json`,
  );
  await fs.unlink(file).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

/** UI 失败不进入离线上传队列，但必须保留当前帧和 OCR，供右窗局部恢复复盘。 */
export async function recordWeixinChannelsRawFailureEvidence(params: {
  root: string;
  reservation: WeixinChannelsRawReservation;
  reason: string;
  ocrLines: WeixinChannelsRawFailureEvidence["ocrLines"];
  screenshot?: string;
}) {
  const directory = path.join(runDirectory(params.root, params.reservation.runId), "failures");
  await fs.mkdir(directory, { recursive: true });
  const suffix = `${assertSafeSegment(params.reservation.rawId, "raw_id")}-${Date.now()}`;
  let screenshot: string | undefined;
  if (params.screenshot) {
    const extension = path.extname(params.screenshot).toLowerCase() || ".png";
    screenshot = `${suffix}${extension}`;
    await fs.copyFile(params.screenshot, path.join(directory, screenshot)).catch(() => undefined);
  }
  const evidence: WeixinChannelsRawFailureEvidence = {
    version: 1,
    rawId: params.reservation.rawId,
    runId: params.reservation.runId,
    windowId: params.reservation.windowId,
    recordedAt: new Date().toISOString(),
    reason: String(params.reason).slice(0, 1_000),
    ocrLines: params.ocrLines,
    screenshot,
  };
  await writeJsonAtomic(path.join(directory, `${suffix}.json`), evidence);
  return evidence;
}

export async function commitWeixinChannelsRawItem(params: {
  root: string;
  reservation: WeixinChannelsRawReservation;
  capturedAt: string;
  completedAt: string;
  captureElapsedMs: number;
  captureBudgetMs?: number;
  commentsStatus: WeixinChannelsRawManifest["commentsStatus"];
  assets: Array<{
    kind: WeixinChannelsRawAssetKind;
    sourceFile: string;
    progress?: number;
    page?: number;
  }>;
}) {
  if (!params.assets.some((asset) => asset.kind === "player_base")) {
    throw new Error("weixin_channels_raw_player_base_missing");
  }
  const finalDirectory = path.dirname(manifestFile(
    params.root,
    params.reservation.runId,
    params.reservation.rawId,
  ));
  const stagingDirectory = path.join(
    manifestDirectory(params.root, params.reservation.runId),
    `.${params.reservation.rawId}.${process.pid}.${Date.now()}.staging`,
  );
  await fs.mkdir(stagingDirectory, { recursive: true });
  try {
    const assets: WeixinChannelsRawAsset[] = [];
    for (let index = 0; index < params.assets.length; index += 1) {
      const asset = params.assets[index]!;
      const extension = path.extname(asset.sourceFile).toLowerCase() || ".png";
      const name = `${String(index + 1).padStart(2, "0")}-${asset.kind}${extension}`;
      const destination = path.join(stagingDirectory, name);
      await fs.copyFile(asset.sourceFile, destination);
      const digest = await sha256File(destination);
      assets.push({
        kind: asset.kind,
        file: name,
        progress: asset.progress,
        page: asset.page,
        ...digest,
      });
    }
    const manifest: WeixinChannelsRawManifest = {
      version: 1,
      rawId: params.reservation.rawId,
      runId: params.reservation.runId,
      state: "complete",
      source: params.reservation.source,
      taskId: params.reservation.taskId,
      query: params.reservation.query,
      windowId: params.reservation.windowId,
      capturedAt: params.capturedAt,
      completedAt: params.completedAt,
      captureElapsedMs: Math.max(0, Math.round(params.captureElapsedMs)),
      captureBudgetMs: params.captureBudgetMs === undefined
        ? undefined
        : Math.max(1, Math.round(params.captureBudgetMs)),
      commentsStatus: params.commentsStatus,
      searchSelectedAgeDays: params.reservation.searchSelectedAgeDays,
      assets,
    };
    await writeJsonAtomic(path.join(stagingDirectory, "manifest.json"), manifest);
    await fs.rename(stagingDirectory, finalDirectory);
    await releaseWeixinChannelsRawSlot({ root: params.root, reservation: params.reservation });
    return { manifest, directory: finalDirectory };
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function updateWeixinChannelsRawManifest(params: {
  root: string;
  manifest: WeixinChannelsRawManifest;
  state: WeixinChannelsRawManifestState;
  rejectionReason?: string;
  observationId?: string;
}) {
  const next: WeixinChannelsRawManifest = {
    ...params.manifest,
    state: params.state,
    rejectionReason: params.rejectionReason,
    observationId: params.observationId,
  };
  await writeJsonAtomic(
    manifestFile(params.root, next.runId, next.rawId),
    next,
  );
  return next;
}

/**
 * 封存本轮采集并立即让下一轮获得新的 active-run。只有已经原子提交 manifest
 * 的素材进入离线 worker；未完成预约会被明确放弃，不能永久卡住批次。
 */
export async function sealWeixinChannelsRawRun(params: {
  root: string;
  run: WeixinChannelsRawRunState;
  now?: number;
}) {
  return withSpoolLock(params.root, async () => {
    const activeFile = path.join(params.root, ACTIVE_RUN_FILE);
    const active = await readJson<WeixinChannelsRawRunState>(activeFile);
    if (active.runId !== params.run.runId) {
      throw new Error("weixin_channels_raw_active_run_changed");
    }
    const reservations = await listJsonFiles(reservationDirectory(
      params.root,
      active.runId,
    ));
    await Promise.all(reservations.map((file) => fs.unlink(file).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    })));
    const sealed: WeixinChannelsRawRunState = {
      ...active,
      phase: "processing",
      sealedAt: new Date(params.now ?? Date.now()).toISOString(),
      abandonedReservations: reservations.length,
    };
    await writeJsonAtomic(runStateFile(params.root, active.runId), sealed);
    await fs.unlink(activeFile);
    return sealed;
  });
}

export async function closeWeixinChannelsRawRun(params: {
  root: string;
  run: WeixinChannelsRawRunState;
}) {
  return withSpoolLock(params.root, async () => {
    const stored = await readWeixinChannelsRawRun({
      root: params.root,
      runId: params.run.runId,
    });
    if (stored.phase !== "processing") {
      throw new Error("weixin_channels_raw_run_not_processing");
    }
    const complete = { ...stored, phase: "complete" as const };
    await writeJsonAtomic(runStateFile(params.root, params.run.runId), complete);
    return complete;
  });
}

/**
 * 单个损坏批次连续失败后隔离该批，保留全部素材和错误证据，避免它永久
 * 占住 processing 队首、让后续正常批次无法 OCR/入库。
 */
export async function failWeixinChannelsRawRun(params: {
  root: string;
  run: WeixinChannelsRawRunState;
  reason: string;
  attempts: number;
  now?: number;
}) {
  return withSpoolLock(params.root, async () => {
    const stored = await readWeixinChannelsRawRun({
      root: params.root,
      runId: params.run.runId,
    });
    if (stored.phase !== "processing") return stored;
    const failed: WeixinChannelsRawRunState = {
      ...stored,
      phase: "failed",
      failedAt: new Date(params.now ?? Date.now()).toISOString(),
      failureReason: String(params.reason || "raw_offline_processing_failed").slice(0, 1_000),
      processingFailures: Math.max(1, Math.floor(params.attempts)),
    };
    await writeJsonAtomic(runStateFile(params.root, params.run.runId), failed);
    return failed;
  });
}

export async function writeWeixinChannelsRawRunSummary(params: {
  root: string;
  runId: string;
  summary: unknown;
}) {
  await writeJsonAtomic(
    path.join(runDirectory(params.root, params.runId), RUN_SUMMARY_FILE),
    params.summary,
  );
}

async function directoryBytes(directory: string): Promise<number> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(file);
    else if (entry.isFile()) total += (await fs.stat(file)).size;
  }
  return total;
}

/**
 * 只清理已经完成离线处理的旧批次图片，保留 run.json/summary.json 审计信息。
 * 最近两批原图继续保留，processing/harvesting 与 pending 永不在这里删除。
 */
export async function pruneWeixinChannelsCompletedRawRuns(params: {
  root?: string;
  keepRunsWithAssets?: number;
}) {
  const root = params.root || defaultWeixinChannelsRawSpoolRoot();
  const keep = Math.max(0, Math.floor(
    params.keepRunsWithAssets ?? WEIXIN_CHANNELS_RAW_COMPLETED_RUNS_WITH_ASSETS,
  ));
  const completed = (await listWeixinChannelsRawRuns({ root, phase: "complete" }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  let prunedRuns = 0;
  let releasedBytes = 0;
  for (const run of completed.slice(keep)) {
    const items = manifestDirectory(root, run.runId);
    const reservations = reservationDirectory(root, run.runId);
    releasedBytes += await directoryBytes(items);
    releasedBytes += await directoryBytes(reservations);
    await fs.rm(items, { recursive: true, force: true });
    await fs.rm(reservations, { recursive: true, force: true });
    prunedRuns += 1;
  }
  return { completedRuns: completed.length, prunedRuns, releasedBytes };
}

export async function cleanupWeixinChannelsCollectorTempFiles(params: {
  tempDir?: string;
  olderThanMs?: number;
  now?: number;
}) {
  const tempDir = params.tempDir || os.tmpdir();
  const olderThanMs = Math.max(60_000, Math.floor(params.olderThanMs ?? 30 * 60_000));
  const now = params.now ?? Date.now();
  const prefixes = [
    "weixin-channels-raw-",
    "weixin-channels-sample-",
    "weixin-channels-window-",
    "mvstudiopro-weixin-channels-dual-probe-",
  ];
  let names: string[];
  try {
    names = await fs.readdir(tempDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { removedFiles: 0, releasedBytes: 0 };
    }
    throw error;
  }
  let removedFiles = 0;
  let releasedBytes = 0;
  for (const name of names) {
    if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
    const file = path.join(tempDir, name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || now - stat.mtimeMs < olderThanMs) continue;
      await fs.unlink(file);
      removedFiles += 1;
      releasedBytes += stat.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { removedFiles, releasedBytes };
}

export function resolveWeixinChannelsRawAssetPath(params: {
  root: string;
  manifest: WeixinChannelsRawManifest;
  asset: WeixinChannelsRawAsset;
}) {
  return path.join(
    path.dirname(manifestFile(params.root, params.manifest.runId, params.manifest.rawId)),
    assertSafeSegment(params.asset.file, "asset_file"),
  );
}

/**
 * manifest 里的大小与 SHA-256 是离线 OCR 的输入契约，不只是提交时的审计信息。
 * 每次消费前重新读取实际文件，防止截断、替换或半同步素材进入 OCR/入库链。
 */
export async function verifyWeixinChannelsRawAsset(params: {
  root: string;
  manifest: WeixinChannelsRawManifest;
  asset: WeixinChannelsRawAsset;
}) {
  const file = resolveWeixinChannelsRawAssetPath(params);
  const actual = await sha256File(file).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("weixin_channels_raw_asset_missing");
    }
    throw error;
  });
  if (actual.bytes !== params.asset.bytes) {
    throw new Error("weixin_channels_raw_asset_size_mismatch");
  }
  if (actual.sha256 !== params.asset.sha256) {
    throw new Error("weixin_channels_raw_asset_sha256_mismatch");
  }
  return { file, ...actual };
}
