import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const WORKER_PROBE_LEASE_TTL_MS = 120_000;
export function workerProbeLeaseDirectory() {
  return process.env.WORKER_PROBE_LEASE_DIR || "/tmp/mvstudiopro-worker-probe-leases";
}
/** 租约仅用于本机隔离探针；心跳失联后过期，不能永久关闭空闲停机。 */
export async function workerProbeLeasesBusy(root = workerProbeLeaseDirectory(), now = Date.now()): Promise<boolean> {
  let names: string[];
  try { names = await fs.readdir(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  for (const name of names.filter(name => name.endsWith(".json"))) {
    let raw: string;
    try { raw = await fs.readFile(path.join(root, name), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const lease = JSON.parse(raw);
    if (!Number.isFinite(lease.expiresAt)) throw Error("探针心跳租约损坏，拒绝空闲停机");
    if (lease.expiresAt > now) return true;
  }
  return false;
}
export async function acquireWorkerProbeLease(root = workerProbeLeaseDirectory(), now = Date.now) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const id = randomUUID(), file = path.join(root, `${id}.json`);
  let released = false;
  // 串行化刷新与释放，防止finally删除后在途心跳又把租约写回来。
  let pending = Promise.resolve();
  const renew = () => {
    pending = pending.then(async () => {
      if (released) throw Error("探针租约已释放");
      const temporary = `${file}.tmp`;
      const handle = await fs.open(temporary, "w", 0o600);
      try { await handle.writeFile(JSON.stringify({ id, pid: process.pid, expiresAt: now() + WORKER_PROBE_LEASE_TTL_MS })); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, file);
    });
    return pending;
  };
  await renew();
  return { id, renew, async release() {
    released = true;
    await pending.catch(() => {});
    await fs.rm(file, { force: true });
  } };
}

/** 探针入口在任何付费或数据库动作前校验包装器持有的真实本机租约。 */
export async function assertWorkerProbeLease() {
  const id = process.env.WORKER_PROBE_LEASE_ID || "";
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error("请使用 with-worker-probe-lease 包装器执行工作机探针");
  const lease = JSON.parse(await fs.readFile(path.join(workerProbeLeaseDirectory(), `${id}.json`), "utf8"));
  if (lease.id !== id || !Number.isFinite(lease.expiresAt) || lease.expiresAt <= Date.now()) throw Error("探针租约已失效，禁止开始新请求");
}
