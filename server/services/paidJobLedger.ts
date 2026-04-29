/**
 * 付费任务持久账本 / 单一真理来源
 *
 * ── 为什么存在 ───────────────────────────────────────────────────────────────
 *  Deep Research / Creator Growth 视频分析 / Platform IP / 二创 等任务一旦扣
 *  完积分就会真金白银地烧 Google API 算力（深潜单次 $5-15 USD）。任何意外
 *  ——进程重启、fly deploy、SIGTERM、用户主动取消、外部 API 报错——都必须保证
 *  「积分被精准、幂等地返还到平台账户余额」，**且绝对不触碰任何现金 / 法币
 *  退款通道**（Stripe / Alipay / 微信支付一律不许动）。
 *
 *  本模块做四件事：
 *   1. registerActiveJob / unregisterActiveJob：在持久卷写一份 hold 记录，
 *      让 admin 端点 / check-running-jobs.sh / pre-deploy-guard 能扫到所有
 *      正在烧钱的任务（部署闸门唯一可信数据源）。
 *   2. heartbeatActiveJob：worker 在跑时定期刷心跳，让 reaper 能区分「还活着」
 *      和「进程已死」。
 *   3. requestCancel / isCancelRequested：跨进程协同的取消信号，UI 触发后
 *      worker 在下一次 polling 时检测并自行 abort（停止烧钱）。
 *   4. refundCreditsOnFailure / reapStuckPaidJobs：失败 / 取消 / 超时 / 崩溃
 *      统一的幂等退积分入口。**仅写 creditBalances + creditTransactions 表**
 *      （server/credits.ts 的 refundCredits），**绝不调用 Stripe SDK**。
 *
 *  幂等保证：每条 hold 文件用三态机（active → settled / refunded），refund 路径
 *  会先 readHold → 仅在 status="active" 时才调 refundCredits，写入
 *  refundedAt + refundReason 后将 status 切到 "refunded"。重复调用直接 no-op。
 */

import fs from "fs/promises";
import path from "path";
import os from "os";

// ── 持久存储位置 ─────────────────────────────────────────────────────────────
// 默认走 Fly 持久卷 /data；本地 / CI 环境降级到 os.tmpdir() 并打 warn 日志，
// 让开发者立刻知道「这台机器上的退分账本不会跨重启留存」。
const PRIMARY_DIR = process.env.PAID_JOB_LEDGER_DIR || "/data/active-jobs";
let resolvedDir: string | null = null;
let warnedFallback = false;

async function getLedgerDir(): Promise<string> {
  if (resolvedDir) return resolvedDir;
  try {
    await fs.mkdir(PRIMARY_DIR, { recursive: true });
    // 试写一个探针文件确认可写
    const probe = path.join(PRIMARY_DIR, ".write-probe");
    await fs.writeFile(probe, String(Date.now()));
    await fs.unlink(probe).catch(() => {});
    resolvedDir = PRIMARY_DIR;
    return resolvedDir;
  } catch (e: any) {
    const fallback = path.join(os.tmpdir(), "mvstudiopro-active-jobs");
    if (!warnedFallback) {
      console.warn(
        `[paidJobLedger] ⚠️  primary dir ${PRIMARY_DIR} not writable (${e?.message}); ` +
          `falling back to ${fallback}. **HOLD 记录将无法跨进程重启留存** — ` +
          `仅在本地开发 / CI 环境可接受。生产部署必须挂载 /data 持久卷。`,
      );
      warnedFallback = true;
    }
    await fs.mkdir(fallback, { recursive: true });
    resolvedDir = fallback;
    return resolvedDir;
  }
}

// ── 类型定义 ─────────────────────────────────────────────────────────────────

/** 已知付费任务类型；新增任务时也允许传任意字符串（`string` 兜底）保证扩展性。 */
export type PaidTaskType =
  | "deepResearch"
  | "growthVideo"
  | "growthDocument"
  | "platformAnalysis"
  | "platformQA"
  | "competitorResearch"
  | "aiAssistEditor"
  | "imageUpscale"
  | "vipMonthly"
  | string;

export type PaidJobStatus = "active" | "settled" | "refunded";

export type PaidJobRefundReason =
  | "task_failed"
  | "task_timeout"
  | "external_api_error"
  | "user_cancelled"
  | "deploy_killed"
  | "process_crashed"
  | "manual_admin_refund";

export interface PaidJobHold {
  /** 与业务侧 jobId 一致；用于 UI 取消按钮、状态查询、reaper 去重 */
  jobId: string;
  taskType: PaidTaskType;
  userId: number | string;
  /** 实际扣过的积分（如果是管理员免扣 / source="admin" 这里传 0，refund 会跳过） */
  creditsBilled: number;
  /** 业务侧描述，用于 audit log（如 "上帝视角研报·企业旗舰款（4500点）"） */
  action: string;
  status: PaidJobStatus;
  chargedAt: string;
  lastHeartbeatAt: string;
  pid?: number;
  /** 外部 API 估算成本（仅展示；如 "deep-research-max ~$8 USD"） */
  externalApiCostHint?: string;
  /** taskType 特有元数据，比如 dbRecordId / topic / interactionId */
  metadata?: Record<string, unknown>;
  // ── 取消信号（跨进程） ─────────────────────────────────────────────────
  cancelRequestedAt?: string;
  cancelRequestedBy?: "user" | "admin" | "deploy" | "reaper";
  // ── 暂停信号 ──────────────────────────────────────────────────────────
  /** 任务进入「等待用户决策」状态（如 Deep Research awaiting_plan_approval）时
   *  设置。reaper 会跳过 holdPausedAt 不为空的 hold，避免误判心跳停滞 → 错退积分。
   *  resumeActiveJob() 清除该字段。 */
  holdPausedAt?: string;
  // ── 终态字段 ──────────────────────────────────────────────────────────
  settledAt?: string;
  refundedAt?: string;
  refundReason?: PaidJobRefundReason;
  refundDetail?: string;
  /** 给到 audit log 的精确数值（避免名称用 amountRefunded / paymentRefunded 引发误会） */
  creditsRefunded?: number;
}

// ── 文件 IO ──────────────────────────────────────────────────────────────────

function holdFilePath(dir: string, taskType: PaidTaskType, jobId: string): string {
  // jobId 已经是只含安全字符（字母数字下划线短横线点），但仍做防御性 sanitize
  const safeId = String(jobId).replace(/[^a-zA-Z0-9_.\-]/g, "_");
  const safeType = String(taskType).replace(/[^a-zA-Z0-9_\-]/g, "_") || "unknown";
  return path.join(dir, safeType, `${safeId}.json`);
}

async function readHoldFile(filePath: string): Promise<PaidJobHold | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PaidJobHold;
  } catch {
    return null;
  }
}

async function writeHoldFile(filePath: string, hold: PaidJobHold): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // 先写临时文件再 rename 做原子写，避免读到半文件
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(hold, null, 2));
  await fs.rename(tmp, filePath);
}

// ── 注册 / 心跳 / 注销 ───────────────────────────────────────────────────────

export interface RegisterInput {
  jobId: string;
  taskType: PaidTaskType;
  userId: number | string;
  creditsBilled: number;
  action: string;
  externalApiCostHint?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 在持久卷写入一条 active hold 记录。**必须**在 deductCredits 成功之后立即调用，
 * 这样部署闸门 / reaper / SIGTERM hook 才能看到这个任务。
 *
 * 同 jobId 重复调用是幂等的（覆盖旧记录的元数据但保留 chargedAt）。
 */
export async function registerActiveJob(input: RegisterInput): Promise<void> {
  const dir = await getLedgerDir();
  const file = holdFilePath(dir, input.taskType, input.jobId);
  const existing = await readHoldFile(file);
  const now = new Date().toISOString();
  const hold: PaidJobHold = {
    jobId: input.jobId,
    taskType: input.taskType,
    userId: input.userId,
    creditsBilled: input.creditsBilled,
    action: input.action,
    status: existing?.status === "settled" || existing?.status === "refunded"
      ? existing.status
      : "active",
    chargedAt: existing?.chargedAt ?? now,
    lastHeartbeatAt: now,
    pid: process.pid,
    ...(input.externalApiCostHint
      ? { externalApiCostHint: input.externalApiCostHint }
      : existing?.externalApiCostHint
        ? { externalApiCostHint: existing.externalApiCostHint }
        : {}),
    ...(input.metadata
      ? { metadata: { ...(existing?.metadata ?? {}), ...input.metadata } }
      : existing?.metadata
        ? { metadata: existing.metadata }
        : {}),
    ...(existing?.cancelRequestedAt ? { cancelRequestedAt: existing.cancelRequestedAt, cancelRequestedBy: existing.cancelRequestedBy } : {}),
  };
  await writeHoldFile(file, hold);
  console.log(
    `[paidJobLedger] ▶︎ register taskType=${input.taskType} jobId=${input.jobId} userId=${input.userId} credits=${input.creditsBilled}`,
  );
}

/**
 * 暂停一条 active hold。reaper 不会再扫这个文件，直到 resumeActiveJob 被调或者
 * 30 天硬上限到期（防止永久挂起）。用于 Deep Research 等待用户审核计划等场景。
 */
export async function pauseActiveJob(jobId: string, taskType: PaidTaskType): Promise<void> {
  const dir = await getLedgerDir();
  const file = holdFilePath(dir, taskType, jobId);
  const hold = await readHoldFile(file);
  if (!hold || hold.status !== "active") return;
  if (hold.holdPausedAt) return;
  hold.holdPausedAt = new Date().toISOString();
  await writeHoldFile(file, hold);
  console.log(`[paidJobLedger] ⏸ paused taskType=${taskType} jobId=${jobId}`);
}

/** 解除暂停。worker 重新接管任务时调用，重新刷新 heartbeat。 */
export async function resumeActiveJob(jobId: string, taskType: PaidTaskType): Promise<void> {
  const dir = await getLedgerDir();
  const file = holdFilePath(dir, taskType, jobId);
  const hold = await readHoldFile(file);
  if (!hold || hold.status !== "active") return;
  if (!hold.holdPausedAt) return;
  hold.holdPausedAt = undefined;
  hold.lastHeartbeatAt = new Date().toISOString();
  hold.pid = process.pid;
  await writeHoldFile(file, hold);
  console.log(`[paidJobLedger] ▶︎ resumed taskType=${taskType} jobId=${jobId}`);
}

/** Worker 在跑期间定期调用，刷新 lastHeartbeatAt + pid。 */
export async function heartbeatActiveJob(jobId: string, taskType: PaidTaskType): Promise<void> {
  const dir = await getLedgerDir();
  const file = holdFilePath(dir, taskType, jobId);
  const hold = await readHoldFile(file);
  if (!hold || hold.status !== "active") return;
  hold.lastHeartbeatAt = new Date().toISOString();
  hold.pid = process.pid;
  await writeHoldFile(file, hold).catch(() => {});
}

/**
 * 任务正常完成时调用。改 status="settled" + 写 settledAt。
 *
 * 注意：settled 之后**不会**再触发退积分。如果业务确定该任务已经成功收钱、用户
 * 拿到产物，就调这个；否则一律走 refundCreditsOnFailure。
 */
export async function unregisterActiveJob(
  jobId: string,
  taskType: PaidTaskType,
  mode: "settled" = "settled",
): Promise<{ ok: boolean }> {
  const dir = await getLedgerDir();
  const file = holdFilePath(dir, taskType, jobId);
  const hold = await readHoldFile(file);
  if (!hold) return { ok: false };
  if (hold.status !== "active") {
    // 已经 settled / refunded 就是 no-op
    return { ok: true };
  }
  hold.status = mode;
  hold.settledAt = new Date().toISOString();
  await writeHoldFile(file, hold);
  console.log(
    `[paidJobLedger] ✓ settled taskType=${taskType} jobId=${jobId} userId=${hold.userId} credits=${hold.creditsBilled}`,
  );
  return { ok: true };
}

// ── 查询 / 列表 ──────────────────────────────────────────────────────────────

export async function readActiveJob(
  jobId: string,
  taskType: PaidTaskType,
): Promise<PaidJobHold | null> {
  const dir = await getLedgerDir();
  return readHoldFile(holdFilePath(dir, taskType, jobId));
}

export async function listAllActiveJobs(): Promise<PaidJobHold[]> {
  const dir = await getLedgerDir();
  const out: PaidJobHold[] = [];
  let typeDirs: string[] = [];
  try {
    typeDirs = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const t of typeDirs) {
    if (t.startsWith(".")) continue;
    const full = path.join(dir, t);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[] = [];
    try {
      files = await fs.readdir(full);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const hold = await readHoldFile(path.join(full, f));
      if (hold && hold.status === "active") out.push(hold);
    }
  }
  return out;
}

/** healthcheck 端点用：只返计数 + 最早开始时间，不带敏感字段 */
export async function activeJobsHealthcheck(): Promise<{
  count: number;
  earliestStartedAt: string | null;
}> {
  const all = await listAllActiveJobs();
  if (all.length === 0) return { count: 0, earliestStartedAt: null };
  const earliest = all.reduce((acc, h) => (h.chargedAt < acc ? h.chargedAt : acc), all[0].chargedAt);
  return { count: all.length, earliestStartedAt: earliest };
}

// ── 取消信号 ─────────────────────────────────────────────────────────────────

/**
 * 标记取消请求。worker 进程会在下一次 isCancelRequested() 调用 / heartbeat
 * 后看到并自行 abort + refund。同一 hold 重复调用是幂等的。
 */
export async function requestCancel(
  jobId: string,
  taskType: PaidTaskType,
  by: "user" | "admin" | "deploy" | "reaper" = "user",
): Promise<{ ok: boolean; alreadyCancelled: boolean; status: PaidJobStatus | "missing" }> {
  const dir = await getLedgerDir();
  const file = holdFilePath(dir, taskType, jobId);
  const hold = await readHoldFile(file);
  if (!hold) return { ok: false, alreadyCancelled: false, status: "missing" };
  if (hold.cancelRequestedAt) {
    return { ok: true, alreadyCancelled: true, status: hold.status };
  }
  if (hold.status !== "active") {
    // 已经结清或退过，无意义
    return { ok: true, alreadyCancelled: true, status: hold.status };
  }
  hold.cancelRequestedAt = new Date().toISOString();
  hold.cancelRequestedBy = by;
  await writeHoldFile(file, hold);
  console.log(
    `[paidJobLedger] 🛑 cancel requested taskType=${taskType} jobId=${jobId} by=${by}`,
  );
  return { ok: true, alreadyCancelled: false, status: "active" };
}

export async function isCancelRequested(jobId: string, taskType: PaidTaskType): Promise<boolean> {
  const dir = await getLedgerDir();
  const hold = await readHoldFile(holdFilePath(dir, taskType, jobId));
  return Boolean(hold?.cancelRequestedAt);
}

// ── 退积分（幂等）────────────────────────────────────────────────────────────

/**
 * 任务失败 / 取消 / 超时 / 崩溃统一退积分入口。**严格幂等**：
 *   - 读 hold 文件
 *   - 仅 status="active" 时调 refundCredits（仅写 creditBalances + creditTransactions）
 *   - 改 status="refunded" + 写 refundedAt / refundReason / creditsRefunded
 *   - 重复调用 / 已 settled / 已 refunded 全部 no-op
 *
 * 严令：本函数**只**调 server/credits.ts 的 refundCredits，**禁止**调用任何
 * Stripe / Alipay / 微信支付的 refund API。文案统一用「积分已返还」。
 */
export async function refundCreditsOnFailure(
  jobId: string,
  taskType: PaidTaskType,
  reason: PaidJobRefundReason,
  detail?: string,
): Promise<{ refunded: boolean; creditsRefunded: number; status: PaidJobStatus | "missing" }> {
  const dir = await getLedgerDir();
  const file = holdFilePath(dir, taskType, jobId);
  const hold = await readHoldFile(file);
  if (!hold) {
    console.warn(
      `[paidJobLedger] refundCreditsOnFailure: hold missing taskType=${taskType} jobId=${jobId} reason=${reason}`,
    );
    return { refunded: false, creditsRefunded: 0, status: "missing" };
  }
  if (hold.status !== "active") {
    // 已经 settled / refunded：幂等 no-op
    return { refunded: false, creditsRefunded: 0, status: hold.status };
  }

  // ── 标记 refunded 在前，避免并发场景双退 ────────────────────────────────
  hold.status = "refunded";
  hold.refundedAt = new Date().toISOString();
  hold.refundReason = reason;
  hold.refundDetail = detail;
  hold.creditsRefunded = hold.creditsBilled;
  await writeHoldFile(file, hold);

  // 没扣过分（管理员 / source="admin"）就不需要还分
  if (hold.creditsBilled <= 0) {
    console.log(
      `[paidJobLedger] ↺ refund (admin/zero) taskType=${taskType} jobId=${jobId} reason=${reason}`,
    );
    return { refunded: true, creditsRefunded: 0, status: "refunded" };
  }

  // 调用积分账本（仅写 creditBalances / creditTransactions，绝不碰支付网关）
  try {
    const userIdNum = Number(hold.userId);
    if (!Number.isFinite(userIdNum)) {
      throw new Error(`invalid userId in hold: ${String(hold.userId)}`);
    }
    const { refundCredits } = await import("../credits");
    await refundCredits(
      userIdNum,
      hold.creditsBilled,
      `${hold.action} · ${reason} · 积分已返还到您的账户`,
    );
    console.log(
      `[paidJobLedger] ↺ refunded ${hold.creditsBilled} credits taskType=${taskType} jobId=${jobId} userId=${hold.userId} reason=${reason}`,
    );
    // 写 audit log（落盘 /data/audit/）
    await appendAuditEntry({
      ts: new Date().toISOString(),
      action: "refundCreditsOnFailure",
      jobId: hold.jobId,
      taskType: hold.taskType,
      userId: hold.userId,
      creditsRefunded: hold.creditsBilled,
      reason,
      detail,
    }).catch(() => {});
    return { refunded: true, creditsRefunded: hold.creditsBilled, status: "refunded" };
  } catch (e: any) {
    // 退积分失败：把 hold 状态回滚到 active，让下次 reaper / 手动重试
    console.error(
      `[paidJobLedger] ❌ refundCredits FAILED taskType=${taskType} jobId=${jobId} userId=${hold.userId} credits=${hold.creditsBilled}: ${e?.message}`,
    );
    hold.status = "active";
    hold.refundedAt = undefined;
    hold.refundReason = undefined;
    hold.refundDetail = `[failed] ${e?.message || "unknown"}`;
    hold.creditsRefunded = undefined;
    await writeHoldFile(file, hold).catch(() => {});
    throw e;
  }
}

/**
 * 标记任务被部署中断（部署闸门兜底用，仅写状态 + 立即触发退积分）。
 * 内部直接转调 refundCreditsOnFailure，独立函数仅是为了语义清晰。
 */
export async function markJobDeployKilled(
  jobId: string,
  taskType: PaidTaskType,
  detail?: string,
): Promise<void> {
  await refundCreditsOnFailure(jobId, taskType, "deploy_killed", detail);
}

// ── 启动时 / 定期 reaper ─────────────────────────────────────────────────────

export interface ReapResult {
  scanned: number;
  refunded: number;
  errors: number;
  cancelled: number;
}

/**
 * 扫描所有 active hold：
 *   - lastHeartbeatAt 落后超过 staleMs（默认 5 分钟）→ 标 process_crashed + 退积分
 *   - cancelRequestedAt 已存在但 worker 看上去死掉 → 标 user_cancelled + 退积分
 *
 * 设计原则：reaper 永远只做幂等操作，不会双退。即便和正在跑的 worker 抢，也只
 * 有一边能成功改 status="refunded"，另一边 read 到 status≠active 直接退出。
 *
 * 推荐调用时机：
 *   - 进程启动时（恢复部署中断 / SIGKILL 受害任务）
 *   - SIGTERM handler 内（但需谨慎：SIGTERM 后 worker 可能还在执行，
 *     所以 SIGTERM hook 里应该用 staleMs=0 的「无差别全部退」语义，详见
 *     reapOnShutdown 的导出版本）
 *   - 定时器（兜底，每 5 分钟跑一次）
 */
export async function reapStuckPaidJobs(opts?: {
  staleMs?: number;
  reason?: PaidJobRefundReason;
  /** 如果 true，无差别给所有 active hold 全部退积分（SIGTERM 用） */
  forceAll?: boolean;
}): Promise<ReapResult> {
  const staleMs = opts?.staleMs ?? 5 * 60 * 1000;
  const reasonForStale: PaidJobRefundReason = opts?.reason ?? "process_crashed";
  const all = await listAllActiveJobs();
  const now = Date.now();
  let refunded = 0;
  let errors = 0;
  let cancelled = 0;

  // 30 天硬上限：即便 holdPausedAt 一直挂着也不能无限压住，超期就强行退积分
  const PAUSE_HARD_CAP_MS = 30 * 24 * 60 * 60 * 1000;
  for (const hold of all) {
    try {
      const lastBeat = new Date(hold.lastHeartbeatAt).getTime();
      const lag = now - lastBeat;
      const force = opts?.forceAll === true;

      // 暂停状态的 hold 默认跳过（用户在审核 plan 等场景），除非超 30 天硬上限或 forceAll
      if (hold.holdPausedAt && !force) {
        const pausedSince = new Date(hold.holdPausedAt).getTime();
        if (now - pausedSince < PAUSE_HARD_CAP_MS) {
          continue;
        }
        // 超期，按 task_failed 退分
        await refundCreditsOnFailure(
          hold.jobId,
          hold.taskType,
          "task_failed",
          `paused over 30 days, hard cap force-refund`,
        );
        refunded += 1;
        continue;
      }

      if (force) {
        await refundCreditsOnFailure(
          hold.jobId,
          hold.taskType,
          opts?.reason ?? "deploy_killed",
          `forceAll reaper · lastHeartbeatLag=${Math.round(lag / 1000)}s`,
        );
        refunded += 1;
        continue;
      }

      // 如果有用户主动取消但 worker 看起来已经死了 → 立刻退
      if (hold.cancelRequestedAt && lag > 30_000) {
        await refundCreditsOnFailure(
          hold.jobId,
          hold.taskType,
          "user_cancelled",
          `worker pid=${hold.pid ?? "?"} 未响应取消 ${Math.round(lag / 1000)}s`,
        );
        cancelled += 1;
        continue;
      }

      if (lag > staleMs) {
        await refundCreditsOnFailure(
          hold.jobId,
          hold.taskType,
          reasonForStale,
          `lastHeartbeatLag=${Math.round(lag / 1000)}s pid=${hold.pid ?? "?"}`,
        );
        refunded += 1;
      }
    } catch (e: any) {
      errors += 1;
      console.error(
        `[paidJobLedger] reaper error jobId=${hold.jobId} taskType=${hold.taskType}: ${e?.message}`,
      );
    }
  }

  if (refunded + errors + cancelled > 0 || all.length > 0) {
    console.log(
      `[paidJobLedger] 🧹 reap done · scanned=${all.length} refunded=${refunded} cancelled=${cancelled} errors=${errors}`,
    );
  }
  return { scanned: all.length, refunded, errors, cancelled };
}

// ── audit log ────────────────────────────────────────────────────────────────

const AUDIT_DIR = process.env.PAID_JOB_AUDIT_DIR || "/data/audit";

interface AuditEntry {
  ts: string;
  action: string;
  jobId: string;
  taskType: string;
  userId: number | string;
  creditsRefunded: number;
  reason: string;
  detail?: string;
}

let auditDirReady = false;
async function ensureAuditDir(): Promise<string | null> {
  if (auditDirReady) return AUDIT_DIR;
  try {
    await fs.mkdir(AUDIT_DIR, { recursive: true });
    auditDirReady = true;
    return AUDIT_DIR;
  } catch {
    // 持久卷不可用就降级到 tmpdir
    const fallback = path.join(os.tmpdir(), "mvstudiopro-audit");
    try {
      await fs.mkdir(fallback, { recursive: true });
      return fallback;
    } catch {
      return null;
    }
  }
}

async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  const dir = await ensureAuditDir();
  if (!dir) return;
  // 一天一个文件，每行一个 JSON（jsonl）
  const dateStr = entry.ts.slice(0, 10);
  const file = path.join(dir, `paid-job-refunds-${dateStr}.jsonl`);
  await fs.appendFile(file, JSON.stringify(entry) + "\n").catch(() => {});
}

/** 把任意自定义 audit entry 写到 audit 目录（SIGTERM hook 等场景用） */
export async function writeAuditLog(payload: Record<string, unknown>): Promise<void> {
  const dir = await ensureAuditDir();
  if (!dir) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `event-${ts}-${Math.random().toString(36).slice(2, 8)}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2)).catch(() => {});
}
