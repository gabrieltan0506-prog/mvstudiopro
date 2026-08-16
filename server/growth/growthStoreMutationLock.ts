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

function delay(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function withGrowthStoreMutationLock<T>(
  operation: string,
  work: () => Promise<T>,
  options?: { waitTimeoutMs?: number; staleAfterMs?: number },
): Promise<T> {
  const lockPath = getGrowthStoreMutationLockPath();
  const waitTimeoutMs = Math.max(1_000, options?.waitTimeoutMs || DEFAULT_WAIT_TIMEOUT_MS);
  const staleAfterMs = Math.max(waitTimeoutMs, options?.staleAfterMs || DEFAULT_STALE_AFTER_MS);
  const startedAt = Date.now();
  const token = `${process.pid}:${randomUUID()}`;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, operation, acquiredAt: new Date().toISOString() }));
      await handle.close();
      heartbeat = setInterval(() => {
        const now = new Date();
        void fs.utimes(lockPath, now, now).catch(() => {});
      }, Math.min(30_000, Math.max(1_000, Math.floor(staleAfterMs / 3))));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > staleAfterMs) {
        await fs.unlink(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() - startedAt >= waitTimeoutMs) {
        throw new Error(`growth_store_mutation_lock_timeout:${operation}:${waitTimeoutMs}`);
      }
      await delay(RETRY_INTERVAL_MS);
    }
  }

  try {
    return await work();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    const owner = await fs.readFile(lockPath, "utf8").catch(() => "");
    if (owner.includes(token)) {
      await fs.unlink(lockPath).catch(() => {});
    }
  }
}
