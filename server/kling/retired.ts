/**
 * 可灵停用（方案 A）服务端守卫：所有「新建可灵任务」的入口统一走这里判定。
 * - 开关真源：shared/klingRetired.ts（缺省停用；KLING_RETIRED=0 紧急恢复）。
 * - 只拦「新建」：轮询 / 查询 / 结算 / 退款 / 历史展示一律放行，保证在途任务能收尾。
 * - HTTP 入口返回 410 + kling_retired；tRPC 没有 410 码，用 PRECONDITION_FAILED（412）+ 中文提示。
 */
import { TRPCError } from "@trpc/server";
import { isKlingRetired, KLING_RETIRED_ERROR, KLING_RETIRED_MESSAGE_ZH } from "../../shared/klingRetired.js";

export const KLING_RETIRED_HTTP_STATUS = 410 as const;

/** 停用时新建入口抛出的错误；message 以 kling_retired 打头，便于日志与任务失败原因检索。 */
export class KlingRetiredError extends Error {
  readonly code = KLING_RETIRED_ERROR;
  constructor() {
    super(`${KLING_RETIRED_ERROR}: ${KLING_RETIRED_MESSAGE_ZH}`);
    this.name = "KlingRetiredError";
  }
}

export function isKlingRetiredError(err: unknown): boolean {
  return err instanceof KlingRetiredError || String((err as any)?.message || "").startsWith(`${KLING_RETIRED_ERROR}:`);
}

/** HTTP 410 响应体（api/*.ts 与 Express 入口共用）。 */
export function klingRetiredBody() {
  return { ok: false as const, error: KLING_RETIRED_ERROR, code: KLING_RETIRED_ERROR, message: KLING_RETIRED_MESSAGE_ZH };
}

/** 底层（server/kling/** 的创建函数）兜底：停用时直接抛错，绝不打上游。 */
export function assertKlingNotRetired(env?: Record<string, string | undefined>): void {
  if (isKlingRetired(env)) throw new KlingRetiredError();
}

/** tRPC 新建入口：停用时抛 PRECONDITION_FAILED，message 为面向用户的中文提示。 */
export function assertKlingNotRetiredTrpc(env?: Record<string, string | undefined>): void {
  if (isKlingRetired(env)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: KLING_RETIRED_MESSAGE_ZH, cause: new KlingRetiredError() });
  }
}

/** 通用任务队列（POST /api/jobs → runner）里会新建可灵上游任务的 action。 */
const KLING_JOB_ACTIONS = new Set(["omni_t2v", "omni_i2v", "omni_storyboard", "motion_control", "lip_sync", "kling_image"]);

export function isKlingJobAction(raw: unknown): boolean {
  return KLING_JOB_ACTIONS.has(String(raw || "").trim());
}

/**
 * api/jobs.ts 里会新建可灵上游任务的 op（小写归一）。
 * - klingtask 是轮询，放行；
 * - workflowgeneratevideo 是旧大师级视频基地整片出片，唯一通道就是可灵图生视频，停用即下线。
 */
const KLING_CREATE_JOBS_OPS = new Set(["klingcreate", "klingt2v", "klingi2v", "workflowgeneratevideo"]);

export function isKlingCreateJobsOp(raw: unknown): boolean {
  return KLING_CREATE_JOBS_OPS.has(String(raw || "").trim().toLowerCase());
}

/** 自动路由 / fallback 链里的可灵通道名。 */
const KLING_PROVIDERS = new Set(["kling", "kling-cn", "kling_beijing", "fal_kling_video"]);

export function isKlingProvider(raw: unknown): boolean {
  return KLING_PROVIDERS.has(String(raw || "").trim());
}

/** 停用时从通道链里剔除可灵，其余通道保持原顺序。 */
export function withoutKlingProviders<T extends string>(chain: readonly T[], env?: Record<string, string | undefined>): T[] {
  if (!isKlingRetired(env)) return [...chain];
  return chain.filter((p) => !isKlingProvider(p));
}
