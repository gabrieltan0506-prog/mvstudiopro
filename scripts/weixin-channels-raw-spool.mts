import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const WEIXIN_CHANNELS_RAW_BATCH_LIMIT = 2_000;
export const WEIXIN_CHANNELS_RAW_LATEST_LIMIT = 50;
export const WEIXIN_CHANNELS_RAW_BATCH_INTERVAL_MS = 30 * 60_000;

export type WeixinChannelsRawSource =
  | "recommendation"
  | "search_latest"
  | "search_hottest";

export type WeixinChannelsRawAssetKind =
  | "player_base"
  | "player_progress"
  | "comments_page"
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
  commentsStatus: "captured" | "entry_missing" | "open_unconfirmed";
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

export type WeixinChannelsRawRunState = {
  version: 1;
  runId: string;
  createdAt: string;
  harvestUntil: string;
  maxItems: number;
  latestLimit: number;
  phase: "harvesting" | "processing" | "complete";
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
const SPOOL_LOCK_DIRECTORY = ".spool-lock";

async function withSpoolLock<T>(root: string, operation: () => Promise<T>) {
  const lock = path.join(root, SPOOL_LOCK_DIRECTORY);
  await fs.mkdir(root, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.mkdir(lock);
      try {
        return await operation();
      } finally {
        await fs.rmdir(lock).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(lock).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > 60_000) {
        await fs.rmdir(lock).catch(() => undefined);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 2));
    }
  }
  throw new Error("weixin_channels_raw_spool_lock_timeout");
}

function defaultRawSpoolRoot() {
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
  const root = params.root || defaultRawSpoolRoot();
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

export async function commitWeixinChannelsRawItem(params: {
  root: string;
  reservation: WeixinChannelsRawReservation;
  capturedAt: string;
  completedAt: string;
  captureElapsedMs: number;
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

export async function setWeixinChannelsRawRunPhase(params: {
  root: string;
  run: WeixinChannelsRawRunState;
  phase: WeixinChannelsRawRunState["phase"];
}) {
  const next = { ...params.run, phase: params.phase };
  await writeJsonAtomic(path.join(params.root, ACTIVE_RUN_FILE), next);
  return next;
}

export async function closeWeixinChannelsRawRun(params: {
  root: string;
  run: WeixinChannelsRawRunState;
}) {
  return withSpoolLock(params.root, async () => {
    const activeFile = path.join(params.root, ACTIVE_RUN_FILE);
    const active = await readJson<WeixinChannelsRawRunState>(activeFile);
    if (active.runId !== params.run.runId) {
      throw new Error("weixin_channels_raw_active_run_changed");
    }
    const complete = { ...active, phase: "complete" as const };
    await writeJsonAtomic(
      path.join(runDirectory(params.root, params.run.runId), "run.json"),
      complete,
    );
    await fs.unlink(activeFile);
    return complete;
  });
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
