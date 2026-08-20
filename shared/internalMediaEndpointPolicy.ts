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
