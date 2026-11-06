import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const WORKER_QUIET_WINDOW_MS = 10 * 60_000;
export type WorkerActivity = { lastRequestAt: number; lastProgressAt: number };
export function workerActivityDirectory() {
  return path.join(process.env.WORKER_PROBE_LEASE_DIR || "/tmp/mvstudiopro-worker-probe-leases", "activity");
}
const queues = new Map<string, Promise<void>>();
/** 分进程、分事件原子落盘，不记录请求内容或凭证；有新请求/进度就延后空闲窗口。 */
export async function recordWorkerActivity(kind: "request" | "progress", root = workerActivityDirectory(), at = Date.now()) {
  if (!Number.isFinite(at) || at < 0) throw Error("工作机活动时间无效");
  const file = path.join(root, `${process.pid}-${kind}.json`);
  // 本次失败仍向调用方抛出；下一次事件在磁盘恢复后必须能重新写入。
  const work = (queues.get(file) || Promise.resolve()).catch(() => undefined).then(async () => {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    let prior = 0;
    try { prior = JSON.parse(await fs.readFile(file,"utf8")).at; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (!Number.isFinite(prior)) throw Error("工作机活动记录损坏，拒绝误判空闲");
    const tmp = `${file}.${randomUUID()}.tmp`, handle = await fs.open(tmp,"wx",0o600);
    try { await handle.writeFile(JSON.stringify({kind,at:Math.max(prior,at)})); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(tmp,file);
  });
  queues.set(file,work);
  return work;
}
export async function readWorkerActivity(root = workerActivityDirectory()): Promise<WorkerActivity> {
  const result = { lastRequestAt:0,lastProgressAt:0 };
  let names:string[];
  try { names = await fs.readdir(root); }
  catch(e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return result; throw e; }
  for (const name of names.filter(n=>n.endsWith(".json"))) {
    const value = JSON.parse(await fs.readFile(path.join(root,name),"utf8"));
    if (!["request","progress"].includes(value.kind) || !Number.isFinite(value.at) || value.at < 0)
      throw Error("工作机活动记录损坏，拒绝空闲停机");
    const key = value.kind === "request" ? "lastRequestAt" : "lastProgressAt";
    result[key] = Math.max(result[key],value.at);
  }
  return result;
}
