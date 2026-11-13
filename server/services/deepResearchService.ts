/**
 * 战略智库（AI 上帝视角）研报任务 · 遗留任务收尾。
 *
 * 1113 站长拍板：深度研究（战略智库 / 赛道雷达 / IP 矩阵 / VIP 追踪）生成链路已下线并删除——
 * 不再新建任务、不再续跑、不再补生封面或配图。本文件只保留：
 *   - 读任务文件（主编后台 / 历史查看仍可能用到）
 *   - 启动时把仍处于未终态的遗留任务一律标失败，并按原规则经 paidJobLedger 幂等退积分
 *   - 管理员强制取消遗留任务（同样幂等退积分）
 * 历史研报正文与封面在 Neon user_creations（deep_research_report）里，查看与手工修订见 routers deepResearch.*；
 * 任务文件目录 /data/growth/deep-research 不删除。
 */
import fs from "fs/promises";
import path from "path";
import { refundCreditsOnFailure, type PaidJobRefundReason } from "./paidJobLedger";

// Storage root for job state. Default = Fly persistent volume. Override via env var
// for local tests / CI smoke tests.
const REPORT_DIR = process.env.DEEP_RESEARCH_REPORT_DIR || "/data/growth/deep-research";

// ── Fly 磁盘 Job 结构 ────────────────────────────────────────────────────────

export type DeepResearchProductType = "magazine_single" | "magazine_sub" | "personalized" | "enterprise_flagship" | "platform_ip_matrix" | "competitor_radar" | "vip_baseline" | "vip_monthly";

export interface DeepResearchJob {
  jobId: string;
  userId: string;
  topic: string;
  productType?: DeepResearchProductType;
  dbRecordId?: number;
  // 状态机：pending（排队）→ running（生成中）→ awaiting_review（草稿待主编审核）→ completed（已出刊） / failed
  status: "pending" | "planning" | "awaiting_plan_approval" | "running" | "awaiting_review" | "completed" | "failed";
  progress?: string;
  reportMarkdown?: string;   // 出刊后的最终版（出刊前为空）
  draftMarkdown?: string;    // 草稿版（生成完成后写入）
  error?: string;
  createdAt: string;
  completedAt?: string;
  // ── 防中断追踪字段（resilience tracking） ─────────────────────────────────
  /** 最后一次任意写入时间。worker 心跳：每 30s 自动更新一次。重启时若 heartbeat
   *  落后超过 RESUME_THRESHOLD 即视为「进程已死」，自动重新拉起或标失败。 */
  lastHeartbeatAt?: string;
  /** 当前持有该任务的进程 PID。仅供调试，下面的判定逻辑只看 heartbeat 时间。 */
  pid?: number;
  /** 重启次数（attemptCount）。超过 MAX_RESUME_ATTEMPTS 则不再重启，直接 failed + 退积分。 */
  attemptCount?: number;
  /** 启动任务时实际扣除的积分（用于失败时退积分）。0 = 管理员/免费，无需退分。 */
  creditsUsed?: number;
  /** Google Interactions API 返回的当前阶段 interaction ID（plan 或 execute） */
  interactionId?: string;
  /** Plan 阶段返回的 interactionId（执行阶段用 previous_interaction_id 续接） */
  planInteractionId?: string;
  /** Plan 阶段 Agent 提出的研究计划文本（待用户审核） */
  planText?: string;
  /** 用户审核计划时填入的反馈（如「不要看快手数据」） */
  planFeedback?: string;
  /** Execute 阶段产生的接地数据（harvested.text），便于断线恢复 */
  harvestedText?: string;
  /** 可选：覆盖 executeApprovedResearch 的 input（VIP 月度更新场景：传月度新数据） */
  executeOverrideInput?: string;
  /** 可选：任务完成后的回填钩子（如 VIP 档案需回填 baseInteractionId） */
  onCompletedHook?: { kind: "vip_base" | "vip_monthly"; ownerId: string; vipId: string };
  /** 用户上传的补充资料：文字说明 + 文件（已存 GCS，注入阶段 A Deep Research） */
  supplementaryText?: string;
  supplementaryFiles?: Array<{ name: string; type: "image" | "pdf"; mimeType: string; url: string; gcsUri: string }>;
  /**
   * 企业专属 IP 基因（B 端拦截弹窗收集）
   * 注入到 Plan / Execute 的 prompt [全局战略预设] 段，让推演 80% 篇幅锁定
   * 高客单转化路径、合规与定价战略，避免变成大众视角的"小生意建议"。
   */
  ipProfile?: {
    industry: string;
    advantage: string;
    audience: string;
    taboos?: string;
    flagship: string;
  };
  /** GodView 首购尝鲜：封面与场景配图 prompt 嵌入试读样本对角水印（TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION） */
  strategicImagesTrialWatermark?: boolean;
  /** 失败时的结构化错误详情（DeepResearchApiError.toDetailString()）。Supervisor Debug 直接展示。 */
  errorDetail?: string;
  /** 用户/管理员发起的取消请求时间戳（ISO）。worker 在 polling 循环检测到该字段
   *  即抛 USER_CANCELLED 进入失败路径，由 paidJobLedger 幂等退积分。 */
  cancelRequestedAt?: string;
  cancelRequestedBy?: "user" | "admin" | "deploy" | "reaper";
  /** 取消时希望传给 refundCreditsOnFailure 的 reason（默认根据 cancelRequestedBy 推断）：
   *   - by="user" → "user_cancelled_no_refund"（主动取消不退积分，防恶意刷算力）
   *   - by="admin" / "reaper" → "user_cancelled"（仍然幂等退积分）
   *   - by="deploy" → "deploy_killed"（仍然幂等退积分）
   *  调用方可显式覆盖。 */
  cancelRefundReason?: PaidJobRefundReason;
}

// ── Neon DB 辅助 ────────────────────────────────────────────────────────────

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const { userCreations } = await import("../../drizzle/schema-creations");
  const db = await getDb();
  return { db, userCreations };
}

/** 更新 Neon DB 研报状态 */
async function dbUpdateRecord(
  dbRecordId: number,
  status: string,
  progress: string,
  reportMarkdown?: string,
  error?: string,
  extras?: { thumbnailUrl?: string; lighthouseTitle?: string; summary?: string; duration?: string },
) {
  try {
    const { db, userCreations } = await getDbAndSchema();
    if (!db) return;
    const { eq } = await import("drizzle-orm");
    const setPayload: Record<string, unknown> = {
      status,
      metadata: JSON.stringify({
        progress,
        reportMarkdown: reportMarkdown ?? null,
        error: error ?? null,
        ...(extras?.lighthouseTitle ? { lighthouseTitle: extras.lighthouseTitle } : {}),
        ...(extras?.summary ? { summary: extras.summary } : {}),
        ...(extras?.duration ? { duration: extras.duration } : {}),
      }),
      updatedAt: new Date(),
    };
    if (extras?.thumbnailUrl) setPayload.thumbnailUrl = extras.thumbnailUrl;
    await db.update(userCreations).set(setPayload).where(eq(userCreations.id, dbRecordId));
  } catch (e: any) {
    console.warn("[deepResearch] dbUpdateRecord failed:", e?.message);
  }
}

export async function readJob(jobId: string): Promise<DeepResearchJob | null> {
  try {
    const raw = await fs.readFile(path.join(REPORT_DIR, `${jobId}.json`), "utf-8");
    return JSON.parse(raw) as DeepResearchJob;
  } catch {
    return null;
  }
}

/** 付费深潜失败时对用户的统一口径（真实原因写入 errorDetail / 日志；仅退积分，无法币退款） */
const USER_FACING_DEEP_RESEARCH_PAID_REFUND =
  "当前算力资源紧张或服务暂时不可用，请稍后再试。相关积分已退还至您的账户。";
const USER_FACING_DEEP_RESEARCH_FREE_FAIL =
  "当前算力资源紧张或服务暂时不可用，请稍后再试。";

function resolveUserFacingFailureError(
  job: DeepResearchJob,
  reason: string,
  refundReason: PaidJobRefundReason,
): string {
  if (refundReason === "user_cancelled_no_refund") return reason;
  const paid = typeof job.creditsUsed === "number" && job.creditsUsed > 0;
  if (refundReason === "user_cancelled" && paid) {
    return "您已取消任务，相关积分已退还至您的账户。";
  }
  if (refundReason === "deploy_killed" && paid) {
    return "服务正在部署维护，任务已中断，相关积分已退还至您的账户。请稍后再试。";
  }
  if (paid) return USER_FACING_DEEP_RESEARCH_PAID_REFUND;
  return USER_FACING_DEEP_RESEARCH_FREE_FAIL;
}

/** 把任务标记为彻底失败，并退还积分 + 同步 DB。
 *  detail：可选的结构化错误详情（DeepResearchApiError.toDetailString()），
 *  会写入 job.errorDetail 供 Supervisor Debug 与「查看详细原因」UI 展示。
 *
 *  ⚠️ 退积分**只**走 paidJobLedger.refundCreditsOnFailure（幂等 + 仅写积分账本）。
 *  禁止任何形式的现金退款 / 支付网关调用。文案统一「积分已退还至您的账户」（仅退积分，非原路退款）。
 *
 *  user-facing：`job.error` 使用温和表述（算力紧张等）；`reason` 参数的技术说明会并入 errorDetail。
 */
async function failJobAndRefund(
  job: DeepResearchJob,
  reason: string,
  progressMsg: string,
  detail?: string,
  refundReason: PaidJobRefundReason = "task_failed",
) {
  const userFacingError = resolveUserFacingFailureError(job, reason, refundReason);
  let mergedDetail = detail;
  if (refundReason !== "user_cancelled_no_refund" && reason?.trim()) {
    const tech = `技术摘要：${reason}`;
    mergedDetail = mergedDetail?.trim() ? `${mergedDetail.trim()}\n\n---\n\n${tech}` : tech;
  }

  const file = path.join(REPORT_DIR, `${job.jobId}.json`);
  const failedJob: DeepResearchJob = {
    ...job,
    status: "failed",
    error: userFacingError,
    progress: progressMsg,
    completedAt: new Date().toISOString(),
    errorDetail: mergedDetail ?? job.errorDetail,
  };
  try { await fs.writeFile(file, JSON.stringify(failedJob, null, 2)); } catch {}
  if (job.dbRecordId) {
    try { await dbUpdateRecord(job.dbRecordId, "failed", progressMsg, undefined, reason); } catch {}
  }
  // 退积分 — 经由 paidJobLedger 的幂等门面，重复调用 / 已 settled 自动 no-op
  try {
    const result = await refundCreditsOnFailure(
      job.jobId,
      "deepResearch",
      refundReason,
      `${userFacingError}${mergedDetail ? ` · ${mergedDetail.slice(0, 200)}` : ""}`,
    );
    // ── 兼容老任务（PR 部署前已在跑、没有 ledger hold 文件）：回退到直接积分接口 ──
    //   只有当 ledger 说 hold 缺失，且 job 自身记录了正数 creditsUsed 时才走这条路。
    if (result.status === "missing" && typeof job.creditsUsed === "number" && job.creditsUsed > 0) {
      const { refundCredits } = await import("../credits");
      await refundCredits(
        Number(job.userId),
        job.creditsUsed,
        `上帝视角研报·${reason}·积分已退还至您的账户（legacy fallback）`,
      );
      console.log(
        `[deepResearch] 💰 (legacy fallback) 已返还 ${job.creditsUsed} 积分给用户 ${job.userId}（任务 ${job.jobId}）`,
      );
    }
  } catch (e: any) {
    console.warn(`[deepResearch] paidJobLedger.refundCreditsOnFailure 失败 (job=${job.jobId}):`, e?.message);
  }
}

/**
 * 未终态（仍占着积分）的遗留任务状态。生成链路已删，这些任务不会再有 worker 接手：
 * running / pending / planning 原本会被重新拉起，awaiting_plan_approval 原本等用户批准计划（批准入口已删，
 * 其 ledger hold 原本要到 30 天硬上限才由 reaper 退分）。现在统一在启动时标失败并退积分。
 * awaiting_review 不在内：正文已生成，研报中心按已出刊展示，不退分。
 */
const LEFTOVER_STATUSES = new Set(["running", "pending", "planning", "awaiting_plan_approval"]);

/** 遗留任务的退分口径：已有取消请求的沿用请求时定下的口径（用户主动取消按原规则不退），否则按任务失败退分。 */
function leftoverRefundReason(job: DeepResearchJob): PaidJobRefundReason {
  if (job.cancelRequestedAt) {
    if (job.cancelRefundReason) return job.cancelRefundReason;
    if (job.cancelRequestedBy === "user") return "user_cancelled_no_refund";
    if (job.cancelRequestedBy === "deploy") return "deploy_killed";
    return "user_cancelled";
  }
  return "task_failed";
}

/** 服务启动时调用：把所有未终态的遗留研报任务标失败，并经 paidJobLedger 幂等退积分（重复调用 / 已结算自动 no-op）。 */
export async function recoverOrphanedJobs(): Promise<void> {
  try {
    const files = await fs.readdir(REPORT_DIR).catch(() => [] as string[]);
    let failed = 0;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(REPORT_DIR, f), "utf-8");
        const job: DeepResearchJob = JSON.parse(raw);
        if (!LEFTOVER_STATUSES.has(job.status as string)) continue;
        await failJobAndRefund(
          job,
          "研报生成功能已下线，遗留任务停止",
          `❌ 研报生成功能已下线，任务已停止，已退回积分 ${job.creditsUsed ?? 0} 点`,
          undefined,
          leftoverRefundReason(job),
        );
        failed += 1;
      } catch {}
    }
    if (failed > 0) {
      console.log(`[deepResearch] 启动收尾：遗留未完成任务 ${failed} 个已标失败并按规则退积分`);
    }
  } catch (e) {
    console.warn("[deepResearch] recoverOrphanedJobs 扫描失败:", e);
  }
}

/** 管理员强制取消遗留研报任务（admin.activeJobsCancel）：直接标失败并按「管理员取消」口径幂等退积分。 */
export async function failDeepResearchJobByAdmin(jobId: string): Promise<void> {
  const job = await readJob(jobId);
  if (!job) return;
  if (!LEFTOVER_STATUSES.has(job.status as string)) return;
  await failJobAndRefund(job, "管理员强制取消", "❌ 管理员已取消任务，积分已退还", undefined, "user_cancelled");
}
