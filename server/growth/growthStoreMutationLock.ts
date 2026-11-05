import fs from "node:fs/promises";
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

function processIsAlive(pid: unknown) {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return true;
  try { process.kill(Number(pid), 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
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
    try {
      const handle = await fs.open(lockPath, "wx");
      heldHandle = handle;
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, operation, acquiredAt: new Date().toISOString() }));
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await heldHandle?.close();
        throw error;
      }
      const stat = await fs.lstat(lockPath).catch(() => null);
      if (stat?.isFile() && Date.now() - stat.mtimeMs > staleAfterMs) {
        // Age alone cannot prove that a paused process stopped writing.
        const raw = await fs.readFile(lockPath, "utf8").catch(() => "");
        let owner: { pid?: unknown; token?: unknown } = {};
        try { owner = JSON.parse(raw); } catch {}
        if (typeof owner.token === "string" && !processIsAlive(owner.pid)) {
          const current = await fs.lstat(lockPath).catch(() => null);
          if (current?.ino === stat.ino && current.dev === stat.dev
              && await fs.readFile(lockPath, "utf8").catch(() => "") === raw) {
            await fs.unlink(lockPath);
            continue;
          }
        }
      }
      if (!options?.waitUntilReleased && Date.now() - startedAt >= waitTimeoutMs) {
        throw new Error(`growth_store_mutation_lock_timeout:${operation}:${waitTimeoutMs}`);
      }
      await delay(RETRY_INTERVAL_MS);
    }
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
