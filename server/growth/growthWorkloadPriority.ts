import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
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

/**
 * `/data` 满盘时，前台任务仍要能登记租约并继续执行。Fly 的 root `/tmp` 与
 * `/data` 是两套文件系统；备用目录只保存几十字节的运行中租约，任务结束即删。
 */
function fallbackWorkloadDir() {
  return path.resolve(
    process.env.GROWTH_INTERACTIVE_FALLBACK_DIR
      || path.join(os.tmpdir(), "mvstudiopro-growth-runtime-interactive-workloads"),
  );
}

function isPrimaryLeaseStorageUnavailable(error: unknown) {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOSPC" || code === "EDQUOT" || code === "EROFS";
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
  const token = `${process.pid}-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  let file = "";
  const primaryDir = workloadDir();
  try {
    await fs.mkdir(primaryDir, { recursive: true });
    file = path.join(primaryDir, `${token}.json`);
    await writeLease(file, token, label, startedAt);
  } catch (error) {
    if (!isPrimaryLeaseStorageUnavailable(error)) throw error;
    if (file) await fs.unlink(file).catch(() => {});
    const fallbackDir = fallbackWorkloadDir();
    file = path.join(fallbackDir, `${token}.json`);
    await fs.mkdir(fallbackDir, { recursive: true });
    await writeLease(file, token, label, startedAt);
    console.warn(
      `[growth.workload-priority] 主存储不可写，前台租约已转入临时盘：${(error as NodeJS.ErrnoException).code}`,
    );
  }
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
  for (const dir of [workloadDir(), fallbackWorkloadDir()]) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      // EACCES/ENOTDIR/I/O 异常不能等同“没有前台任务”；交给调用方按安全暂停处理。
      throw error;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(dir, entry);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) continue;
      if (nowMs - stat.mtimeMs > STALE_MS) {
        await fs.unlink(file).catch(() => {});
        continue;
      }
      return true;
    }
  }
  return false;
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
