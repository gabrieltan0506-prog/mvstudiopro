import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const HEARTBEAT_MS = 15_000;
const STALE_MS = 2 * 60_000;
const localTokens = new Set<string>();

export const GROWTH_BACKGROUND_PAUSED_FOR_INTERACTIVE_WORKLOAD =
  "growth_background_paused_for_interactive_workload";
export const GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START =
  "growth_background_deferred_before_collection_start";

/**
 * 只有数据库已抢占为 running、且属于真实登录用户的 platform job 才能登记前台租约。
 * users.id 是正整数；public/匿名/旧 openId 字符串都不能借此长期压住后台采集与冷备。
 */
export function isAuthenticatedRunningPlatformJob(job: {
  type?: unknown;
  status?: unknown;
  userId?: unknown;
}) {
  if (job.type !== "platform" || job.status !== "running") return false;
  return /^[1-9]\d*$/.test(String(job.userId ?? "").trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * 会与 Growth 冷备争用同一台 Fly 的前台任务统一登记租约。
 * 模板学习虽然挂在 video 队列，却会长时间占用 ffmpeg、磁盘、网络与模型连接；
 * 漏掉它会让冷备在 360 秒精读请求期间同时拉取/打包大文件。
 */
export function isAuthenticatedRunningInteractiveJob(job: {
  type?: unknown;
  status?: unknown;
  userId?: unknown;
  input?: unknown;
}) {
  if (!/^[1-9]\d*$/.test(String(job.userId ?? "").trim())) return false;
  if (job.status !== "running") return false;
  if (job.type === "platform") return true;
  return job.type === "video"
    && isRecord(job.input)
    && job.input.action === "manhua_template_learn";
}

function workloadDir() {
  const storeDir = path.resolve(
    process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache", "growth"),
  );
  return path.join(storeDir, "runtime-interactive-workloads");
}

async function writeLease(file: string, token: string, label: string, startedAt: string) {
  await fs.writeFile(file, JSON.stringify({
    version: 1,
    token,
    label,
    pid: process.pid,
    startedAt,
    heartbeatAt: new Date().toISOString(),
  }), "utf8");
}

/**
 * 登记前台平台指令。每个请求/Job 使用独立租约，避免并发用户结束一个任务时
 * 错误清掉另一个仍在运行的任务；心跳让异常退出的进程可在两分钟后自动回收。
 */
export async function beginGrowthInteractiveWorkload(label: string) {
  const dir = workloadDir();
  const token = `${process.pid}-${randomUUID()}`;
  const file = path.join(dir, `${token}.json`);
  const startedAt = new Date().toISOString();
  await fs.mkdir(dir, { recursive: true });
  await writeLease(file, token, label, startedAt);
  localTokens.add(token);
  const heartbeat = setInterval(() => {
    void writeLease(file, token, label, startedAt).catch(() => {});
  }, HEARTBEAT_MS);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    localTokens.delete(token);
    await fs.unlink(file).catch(() => {});
  };
}

export async function withGrowthInteractiveWorkload<T>(
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const release = await beginGrowthInteractiveWorkload(label);
  try {
    return await work();
  } finally {
    await release();
  }
}

export async function hasActiveGrowthInteractiveWorkload(nowMs = Date.now()) {
  if (localTokens.size > 0) return true;
  const dir = workloadDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    // EACCES/ENOTDIR/I/O 异常不能等同“没有前台任务”；交给调用方按安全暂停处理。
    throw error;
  }
  let active = false;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const file = path.join(dir, entry);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) continue;
    if (nowMs - stat.mtimeMs > STALE_MS) {
      await fs.unlink(file).catch(() => {});
      continue;
    }
    active = true;
  }
  return active;
}

export function isGrowthInteractivePriorityAbortError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    message.includes(GROWTH_BACKGROUND_PAUSED_FOR_INTERACTIVE_WORKLOAD)
    || message.includes(GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START)
  );
}

export function isGrowthCollectionDeferredBeforeStartError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes(GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START);
}
