import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

export type HomePhotoUpscaleLease = {
  path: string;
  token: string;
};

type PersistedLease = {
  token?: string;
  createdAtMs?: number;
};

function errorCode(error: unknown): string {
  return String((error as NodeJS.ErrnoException | undefined)?.code || "");
}

async function readLeaseCreatedAtMs(leasePath: string): Promise<number> {
  try {
    const parsed = JSON.parse(await fs.readFile(leasePath, "utf8")) as PersistedLease;
    const createdAtMs = Number(parsed.createdAtMs || 0);
    if (Number.isFinite(createdAtMs) && createdAtMs > 0) return createdAtMs;
  } catch {
    // 旧进程可能在 open 与 write 之间退出；下方用 mtime 判定是否真的过期。
  }
  try {
    return (await fs.stat(leasePath)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 用 `open(..., "wx")` 提供跨进程原子 claim。拿不到 lease 的进程不得进入外部供应商链。
 * 过期接管只负责让任务进入失败退款路径；任务自身 attempts=1 会阻止重新创建供应商任务。
 */
export async function tryAcquireHomePhotoUpscaleLease(input: {
  leasePath: string;
  staleAfterMs: number;
  nowMs?: number;
}): Promise<HomePhotoUpscaleLease | null> {
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const staleAfterMs = Math.max(1_000, Math.floor(input.staleAfterMs));

  for (let pass = 0; pass < 2; pass += 1) {
    const token = randomUUID();
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(input.leasePath, "wx", 0o600);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    if (handle) {
      try {
        await handle.writeFile(JSON.stringify({ token, createdAtMs: nowMs }));
      } catch (error) {
        await fs.unlink(input.leasePath).catch(() => {});
        throw error;
      } finally {
        await handle.close();
      }
      return { path: input.leasePath, token };
    }

    const createdAtMs = await readLeaseCreatedAtMs(input.leasePath);
    if (!createdAtMs || nowMs - createdAtMs < staleAfterMs) return null;
    try {
      await fs.unlink(input.leasePath);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return null;
    }
  }
  return null;
}

/** token 不匹配时绝不删除，避免迟到的旧进程释放了新进程刚接管的 lease。 */
export async function releaseHomePhotoUpscaleLease(
  lease: HomePhotoUpscaleLease,
): Promise<void> {
  try {
    const parsed = JSON.parse(await fs.readFile(lease.path, "utf8")) as PersistedLease;
    if (parsed.token !== lease.token) return;
    await fs.unlink(lease.path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}
