/** 已停用或仅供监管验收的同步媒体入口。普通用户不得直接调用付费上游。 */
const INTERNAL_GOOGLE_MEDIA_OPS = new Set([
  "nanoImage",
]);

const RETIRED_GOOGLE_VIDEO_OPS = new Set([
  "veoCreate",
  "veoTask",
  "omniVideoCreate",
  "omniVideoTask",
  "omniMaterialUrl",
  "omniInteractionCreate",
  "omniInteractionGet",
  "translateForVeo",
]);

export function isInternalGoogleMediaOp(raw: unknown): boolean {
  return INTERNAL_GOOGLE_MEDIA_OPS.has(String(raw || "").trim());
}

export function isRetiredGoogleVideoOp(raw: unknown): boolean {
  return RETIRED_GOOGLE_VIDEO_OPS.has(String(raw || "").trim());
}

/**
 * 大师级视频基地已经转为监管验收页，因此整个 workflow 命名空间都要 fail closed。
 * 用前缀而非手写动作清单，避免 workflowTest、workflowStatus 或未来新增动作漏网。
 */
export function isSupervisorWorkflowOp(raw: unknown): boolean {
  const op = String(raw || "").trim().toLowerCase();
  return op === "startworkflow" || op.startsWith("workflow");
}

export function hasSupervisorRole(role: unknown): boolean {
  return role === "admin" || role === "supervisor";
}

/**
 * /api/jobs 里历史上不认人的付费/代取入口（2026-11-10 排查）：一律 fail closed。
 * - supervisor：密钥探针、信息架构简报、监管页配音、测试台可灵入口 —— 只有监管/管理员页在用。
 * - internal_or_supervisor：只被服务端工作流进程内调用的脚本/出图/可灵入口。
 * - login_or_internal：音乐生成与轮询 —— 登录用户页面直调，或服务端音乐任务带内部签名调用。
 * - login：成片细剪/抽音/去角标 —— 服务端按传入链接代取视频并跑转码，至少须登录。
 */
export type LegacyJobsOpAccess = "supervisor" | "internal_or_supervisor" | "login_or_internal" | "login";

const LEGACY_JOBS_OP_ACCESS: Record<string, LegacyJobsOpAccess> = {
  probegptkeys: "supervisor",
  proberesponses: "supervisor",
  platformiabrief: "supervisor",
  canvasiabrief: "supervisor",
  generatevoice: "supervisor",
  klingcreate: "supervisor",
  klingtask: "supervisor",
  scriptgenerate: "internal_or_supervisor",
  bananagenerate: "internal_or_supervisor",
  falimagegenerate: "internal_or_supervisor",
  falimage: "internal_or_supervisor",
  klingt2v: "internal_or_supervisor",
  klingi2v: "internal_or_supervisor",
  aimusicsunocreate: "login_or_internal",
  aimusicsunotask: "login_or_internal",
  aimusicudiocreate: "login_or_internal",
  aimusicudiotask: "login_or_internal",
  suggestclipcuts: "login",
  extractclipaudio: "login",
  eraseaicornermark: "login",
};

export function legacyJobsOpAccess(raw: unknown): LegacyJobsOpAccess | null {
  const op = String(raw || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEGACY_JOBS_OP_ACCESS, op) ? LEGACY_JOBS_OP_ACCESS[op]! : null;
}

/** 纯判定：给定入口档位与调用者身份，返回放行或拒绝的状态码。 */
export function decideLegacyJobsOpAccess(
  access: LegacyJobsOpAccess,
  caller: { internal: boolean; userId?: number | null; role?: unknown },
): { ok: true } | { ok: false; status: 401 | 403 } {
  if (caller.internal && (access === "internal_or_supervisor" || access === "login_or_internal")) return { ok: true };
  const loggedIn = Number.isFinite(Number(caller.userId)) && Number(caller.userId) > 0;
  if (!loggedIn) return { ok: false, status: 401 };
  if (access === "login" || access === "login_or_internal") return { ok: true };
  return hasSupervisorRole(caller.role) ? { ok: true } : { ok: false, status: 403 };
}

/** 通用任务队列里没有服务端计费、也没有正式前端调用方的旧可灵视频 action：只留给监管探针。 */
const LEGACY_UNBILLED_KLING_JOB_ACTIONS = new Set(["omni_t2v", "omni_i2v", "omni_storyboard", "motion_control", "lip_sync"]);

export function isLegacyUnbilledKlingJobAction(raw: unknown): boolean {
  return LEGACY_UNBILLED_KLING_JOB_ACTIONS.has(String(raw || "").trim());
}
