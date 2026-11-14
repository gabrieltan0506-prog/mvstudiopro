import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_WAIT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
const RETRY_INTERVAL_MS = 200;

function getGrowthStoreDir() {
  return path.resolve(process.env.GROWTH_STORE_DIR || path.join(path.resolve(process.cwd(), ".cache"), "growth"));
}

export function getGrowthStoreMutationLockPath() {
  return path.join(getGrowthStoreDir(), ".growth-store-mutation.lock");
}

export type GrowthStoreMutationLease = {
  /** Check immediately before committing a snapshot or another atomic replacement. */
  assertOwned: () => Promise<void>;
  signal: AbortSignal;
};

type LockOwner = { token?: unknown; pid?: unknown; bootId?: unknown; pidStartTicks?: unknown; operation?: unknown; acquiredAt?: unknown };

/**
 * Identity of "this process on this boot". A pid number alone is not enough:
 * after a machine restart (Fly redeploy) the old owner's pid can be reused by an
 * unrelated process (seen 2026-11-08: pid 632 became a kernel worker), so a plain
 * `kill(pid, 0)` keeps reporting the dead owner as alive and the lock is never
 * reclaimed. Boot id changes on every (VM) boot; the pid start time (clock ticks
 * since boot, /proc/<pid>/stat field 22) tells a reused pid from the original.
 */
function readBootId(): string | null {
  try { return fsSync.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || null; }
  catch { return null; }
}

function readPidStartTicks(pid: number): string | null {
  try {
    const stat = fsSync.readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm may contain spaces/parens; fields after the last ")" are fixed-position.
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return rest[19] || null; // field 22 overall == index 19 after state(3)
  } catch { return null; }
}

let selfIdentity: { bootId: string | null; pidStartTicks: string | null } | null = null;
function self() {
  if (!selfIdentity) selfIdentity = { bootId: readBootId(), pidStartTicks: readPidStartTicks(process.pid) };
  return selfIdentity;
}

/**
 * Wall-clock time this kernel booted. Independent of boot_id (which may be
 * unreadable) and of the lock contents (which may be empty after a crash):
 * every writer refreshes the lock mtime at least every 30 s, so a lock whose
 * mtime predates this boot by more than that cannot belong to a live process.
 */
function systemBootTimeMs(now: number) {
  const uptimeSec = os.uptime();
  return Number.isFinite(uptimeSec) && uptimeSec > 0 ? now - uptimeSec * 1000 : null;
}
/** Heartbeat is at most every 30 s; demand two missed beats plus slack. Locks carrying this boot's id never take this path; for id-less locks a large forward clock step early in boot could still misjudge, which is accepted as very unlikely. */
const PREVIOUS_BOOT_MIN_AGE_MS = 65_000;
const BOOT_TIME_TOLERANCE_MS = 1_000;

function processExists(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

type OwnerVerdict = { alive: boolean; reason: string };

/** Conservative: only returns alive=false when we can prove the owner is gone. */
function assessOwner(owner: LockOwner): OwnerVerdict {
  const pid = owner.pid;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return { alive: true, reason: "no_pid" };
  const { bootId: selfBootId } = self();
  const ownerBootId = typeof owner.bootId === "string" && owner.bootId ? owner.bootId : null;
  if (ownerBootId && selfBootId && ownerBootId !== selfBootId) {
    return { alive: false, reason: "previous_boot_id" }; // no process from that boot survives.
  }
  // Within one boot a pid that no longer exists can never come back as the same owner.
  if (!processExists(Number(pid))) return { alive: false, reason: "pid_gone" };
  if (typeof owner.pidStartTicks === "string" && owner.pidStartTicks) {
    const current = readPidStartTicks(Number(pid));
    if (current !== null && current !== owner.pidStartTicks) return { alive: false, reason: "pid_reused" };
  }
  return { alive: true, reason: ownerBootId && selfBootId ? "pid_alive_same_boot" : "pid_alive_boot_unknown" };
}

type LockInspection = {
  stat: fsSync.Stats;
  raw: string;
  reclaimable: boolean;
  reason: string;
  holder: Record<string, unknown>;
};

/** Read-only look at the current lock file; decides whether it provably has no live owner. */
async function inspectLock(lockPath: string, staleAfterMs: number): Promise<LockInspection | null> {
  const stat = await fs.lstat(lockPath).catch(() => null);
  if (!stat) return null;
  const raw = await fs.readFile(lockPath, "utf8").catch(() => "");
  const now = Date.now();
  const ageMs = Math.max(0, Math.round(now - stat.mtimeMs));
  let owner: LockOwner | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.token === "string") owner = parsed;
  } catch { /* empty / truncated (e.g. crash right after open) */ }
  const ownerBootId = owner && typeof owner.bootId === "string" && owner.bootId ? owner.bootId : null;
  const selfBootId = self().bootId;
  const sameBootProven = Boolean(ownerBootId && selfBootId && ownerBootId === selfBootId);
  const bootTimeMs = systemBootTimeMs(now);
  const predatesBoot = bootTimeMs !== null && stat.mtimeMs < bootTimeMs - BOOT_TIME_TOLERANCE_MS;
  const holder: Record<string, unknown> = {
    operation: owner && typeof owner.operation === "string" ? owner.operation : null,
    acquiredAt: owner && typeof owner.acquiredAt === "string" ? owner.acquiredAt : null,
    pid: owner && Number.isSafeInteger(owner.pid) ? owner.pid : null,
    ageMs,
    bytes: stat.size,
    parsable: Boolean(owner),
    sameBoot: sameBootProven ? true : ownerBootId && selfBootId ? false : predatesBoot ? false : null,
  };
  let reclaimable = false;
  let reason = "fresh";
  if (!stat.isFile()) {
    reason = "not_a_file";
  } else if (!sameBootProven && predatesBoot && ageMs > PREVIOUS_BOOT_MIN_AGE_MS) {
    // Covers empty/legacy/unknown-boot files too: nothing written before this boot is alive.
    reclaimable = true; reason = "mtime_before_boot";
  } else if (ageMs > staleAfterMs) {
    if (!owner) {
      // A live owner refreshes and asserts its token every <=30 s; an unparsable file this old
      // fails every assertOwned(), so no legitimate holder can still be relying on it.
      reclaimable = true; reason = raw.length ? "stale_unparsable" : "stale_empty";
    } else {
      const verdict = assessOwner(owner);
      reclaimable = !verdict.alive; reason = verdict.reason;
    }
  }
  holder.ownerAlive = reclaimable ? false : reason === "fresh" ? null : true;
  holder.reason = reason;
  return { stat, raw, reclaimable, reason, holder };
}

/** Unlink only if it is still exactly the file we inspected (same inode, mtime and content). */
async function reclaimIfUnchanged(lockPath: string, seen: LockInspection) {
  const current = await fs.lstat(lockPath).catch(() => null);
  if (!current || current.ino !== seen.stat.ino || current.dev !== seen.stat.dev || current.mtimeMs !== seen.stat.mtimeMs) return false;
  if (await fs.readFile(lockPath, "utf8").catch(() => null) !== seen.raw) return false;
  await fs.unlink(lockPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  console.warn(`[growth.lock] 已回收无存活持有者的存储锁 ${JSON.stringify(seen.holder)}`);
  return true;
}

/**
 * Boot-time cleanup: a lock left by a previous boot (deploy/VM crash) is removed
 * right away instead of failing every writer until someone intervenes. Locks that
 * might still be live are left alone and only described in the log.
 */
export async function reclaimGrowthStoreMutationLockFromPreviousBoot() {
  const lockPath = getGrowthStoreMutationLockPath();
  const seen = await inspectLock(lockPath, DEFAULT_STALE_AFTER_MS).catch(() => null);
  if (!seen) return { present: false, reclaimed: false } as const;
  if (seen.reclaimable && await reclaimIfUnchanged(lockPath, seen).catch(() => false)) {
    return { present: true, reclaimed: true, holder: seen.holder } as const;
  }
  console.warn(`[growth.lock] 启动时存储锁仍被占用，未回收 ${JSON.stringify(seen.holder)}`);
  return { present: true, reclaimed: false, holder: seen.holder } as const;
}

function delay(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function withGrowthStoreMutationLock<T>(
  operation: string,
  work: (lease: GrowthStoreMutationLease) => Promise<T>,
  options?: { waitTimeoutMs?: number; staleAfterMs?: number; signal?: AbortSignal; waitUntilReleased?: boolean; onLeaseLost?: (error: unknown) => void },
): Promise<T> {
  const lockPath = getGrowthStoreMutationLockPath();
  const waitTimeoutMs = Math.max(1_000, options?.waitTimeoutMs || DEFAULT_WAIT_TIMEOUT_MS);
  const staleAfterMs = Math.max(waitTimeoutMs, options?.staleAfterMs || DEFAULT_STALE_AFTER_MS);
  const startedAt = Date.now();
  const token = `${process.pid}:${randomUUID()}`;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let leaseLost: Error | null = null;
  let heartbeatPending: Promise<void> | null = null;
  let heldHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
  const controller = new AbortController();
  const markLost = (error: unknown) => {
    if (leaseLost) return;
    leaseLost = error instanceof Error ? error : new Error("growth_lock_ownership_lost");
    controller.abort(leaseLost);
    options?.onLeaseLost?.(leaseLost);
  };
  const assertOwned = async () => {
    options?.signal?.throwIfAborted();
    if (leaseLost) throw leaseLost;
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
      const [current, held] = await Promise.all([fs.lstat(lockPath), heldHandle!.stat()]);
      if (owner.token !== token || !current.isFile() || current.ino !== held.ino || current.dev !== held.dev)
        throw new Error("growth_lock_ownership_lost");
    } catch (error) { markLost(error); throw error; }
  };
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    options?.signal?.throwIfAborted();
    let handle: Awaited<ReturnType<typeof fs.open>>;
    try {
      handle = await fs.open(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Age alone cannot prove that a paused process stopped writing; inspectLock needs proof.
      const seen = await inspectLock(lockPath, staleAfterMs);
      if (seen?.reclaimable && await reclaimIfUnchanged(lockPath, seen)) continue;
      if (!options?.waitUntilReleased && Date.now() - startedAt >= waitTimeoutMs) {
        const holder = seen ? seen.holder : { gone: true };
        throw new Error(`growth_store_mutation_lock_timeout:${operation}:${waitTimeoutMs} holder=${JSON.stringify(holder)}`);
      }
      await delay(RETRY_INTERVAL_MS);
      continue;
    }
    try {
      const { bootId, pidStartTicks } = self();
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, bootId, pidStartTicks, operation, acquiredAt: new Date().toISOString() }));
    } catch (error) {
      // Never leave our own half-written file behind: nobody could ever prove it dead.
      try {
        const [current, held] = await Promise.all([fs.lstat(lockPath), handle.stat()]);
        if (current.ino === held.ino && current.dev === held.dev) await fs.unlink(lockPath);
      } catch { /* already gone or replaced */ }
      await handle.close().catch(() => {});
      throw error;
    }
    heldHandle = handle;
    heartbeat = setInterval(() => {
      if (heartbeatPending || leaseLost) return;
      heartbeatPending = (async () => {
        await assertOwned();
        const now = new Date();
        // Touch our inode, never a replacement owned by another process.
        await handle.utimes(now, now);
      })().catch(markLost).finally(() => { heartbeatPending = null; });
    }, Math.min(30_000, Math.max(1_000, Math.floor(staleAfterMs / 3))));
    break;
  }

  try {
    await assertOwned();
    const result = await work({ assertOwned, signal: controller.signal });
    await assertOwned();
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (heartbeatPending) await heartbeatPending;
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
      const [current, held] = await Promise.all([fs.lstat(lockPath), heldHandle!.stat()]);
      if (owner.token === token && current.ino === held.ino && current.dev === held.dev)
        await fs.unlink(lockPath);
    } catch { /* Lost/replaced leases belong to their new owner. */ }
    await heldHandle?.close();
  }
}
