#!/usr/bin/env tsx

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadCollectorSeenRegistry,
  processWeixinChannelsRawRun,
  retryPendingObservations,
  syncPersistedCollectorIdentities,
} from "./weixin-channels-capture.mts";
import {
  cleanupWeixinChannelsCollectorTempFiles,
  defaultWeixinChannelsRawSpoolRoot,
  failWeixinChannelsRawRun,
  listWeixinChannelsRawRuns,
  pruneWeixinChannelsCompletedRawRuns,
} from "./weixin-channels-raw-spool.mts";

const WORKER_LOCK_DIRECTORY = ".offline-worker-lock";
const IDLE_POLL_MS = 2_000;
const FAILURE_BACKOFF_MS = 5_000;
const PENDING_IDLE_RETRY_MS = 60_000;
const MAX_PENDING_BATCHES_PER_DRAIN = 25;
const MAX_PROCESSING_FAILURES_PER_RUN = 3;

let stopping = false;
const processingFailuresByRun = new Map<string, number>();

function valueArg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireWorkerLock(root: string) {
  const lock = path.join(root, WORKER_LOCK_DIRECTORY);
  await fs.mkdir(root, { recursive: true });
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const ownerFile = path.join(lock, "owner.json");
    try {
      const owner = JSON.parse(await fs.readFile(ownerFile, "utf8")) as { pid?: number };
      if (owner.pid && owner.pid > 0) process.kill(owner.pid, 0);
      throw new Error(`weixin_channels_raw_worker_already_running:${owner.pid || "unknown"}`);
    } catch (ownerError) {
      if (ownerError instanceof Error
        && ownerError.message.startsWith("weixin_channels_raw_worker_already_running:")) {
        throw ownerError;
      }
      await fs.rm(lock, { recursive: true, force: true });
      await fs.mkdir(lock);
    }
  }
  await fs.writeFile(
    path.join(lock, "owner.json"),
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
  return async () => {
    await fs.rm(lock, { recursive: true, force: true });
  };
}

async function drainPending(server: string, token: string) {
  let batches = 0;
  let persisted = 0;
  let newlyQualifiedPersisted = 0;
  while (!stopping && batches < MAX_PENDING_BATCHES_PER_DRAIN) {
    const recovery = await retryPendingObservations({ server, token });
    if (recovery.persisted <= 0) break;
    batches += 1;
    persisted += recovery.persisted;
    newlyQualifiedPersisted += recovery.persistedUnique;
    for (const event of recovery.events) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
  }
  if (batches > 0) {
    process.stdout.write(`${JSON.stringify({
      event: "raw_worker_pending_drained",
      batches,
      persisted,
      newlyQualifiedPersisted,
    })}\n`);
  }
}

async function processNextRun(root: string, server: string, token: string) {
  const run = (await listWeixinChannelsRawRuns({ root, phase: "processing" }))[0];
  if (!run) return false;
  const registry = await loadCollectorSeenRegistry();
  try {
    await syncPersistedCollectorIdentities({ server, token, registry });
  } catch (error) {
    // Fly 暂时不可用时仍允许完成本地 OCR；最终 ingest 继续幂等去重。
    process.stderr.write(`raw_worker_identity_sync_deferred:${
      error instanceof Error ? error.message : String(error)
    }\n`);
  }
  try {
    await processWeixinChannelsRawRun({
      root,
      run,
      knownVideoIdentities: new Set(registry.entries.keys()),
      knownObservationIds: new Set(registry.observationIds),
    });
    processingFailuresByRun.delete(run.runId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const attempts = (processingFailuresByRun.get(run.runId) || 0) + 1;
    processingFailuresByRun.set(run.runId, attempts);
    if (attempts < MAX_PROCESSING_FAILURES_PER_RUN) throw error;
    await failWeixinChannelsRawRun({ root, run, reason, attempts });
    processingFailuresByRun.delete(run.runId);
    process.stderr.write(`raw_worker_run_quarantined:${JSON.stringify({
      runId: run.runId,
      attempts,
      reason,
    })}\n`);
    return true;
  }
  await drainPending(server, token);
  const pruned = await pruneWeixinChannelsCompletedRawRuns({ root });
  const temporary = await cleanupWeixinChannelsCollectorTempFiles({});
  process.stdout.write(`${JSON.stringify({
    event: "raw_worker_storage_maintenance",
    ...pruned,
    temporary,
  })}\n`);
  return true;
}

async function main() {
  const server = String(valueArg("server") || "").replace(/\/$/, "");
  if (!server) throw new Error("weixin_channels_raw_worker_server_required");
  const token = String(process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN || "").trim();
  if (!token) throw new Error("WEIXIN_CHANNELS_COLLECTOR_TOKEN is required for raw worker");
  const root = valueArg("root") || defaultWeixinChannelsRawSpoolRoot();
  const releaseLock = await acquireWorkerLock(root);
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let lastPendingDrainAt = 0;
  try {
    while (!stopping) {
      try {
        if (await processNextRun(root, server, token)) {
          lastPendingDrainAt = Date.now();
          continue;
        }
        if (Date.now() - lastPendingDrainAt >= PENDING_IDLE_RETRY_MS) {
          await drainPending(server, token);
          lastPendingDrainAt = Date.now();
        }
        await wait(IDLE_POLL_MS);
      } catch (error) {
        process.stderr.write(`raw_worker_cycle_failed:${
          error instanceof Error ? error.message : String(error)
        }\n`);
        await wait(FAILURE_BACKOFF_MS);
      }
    }
  } finally {
    await releaseLock();
    process.stderr.write(`raw_worker_stopped:${os.hostname()}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
