/** 合成身份只取服务端会话／持久任务，客户端身份字段仅作一致性检查。 */
export function resolveManhuaAssembleAccess(input: {
  user: { id: unknown; openId?: unknown } | null | undefined;
  claimedUserId?: unknown;
  type?: unknown;
}): { ok: true; userId: string } | { ok: false; status: number; error: string } {
  const id = Number(input.user?.id);
  if (!input.user || !Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, status: 401, error: "请先登录后再合成成片" };
  }
  const claim = input.claimedUserId;
  if (claim != null && claim !== "" && (
    typeof claim !== "string" ||
    (claim !== String(id) && claim !== input.user.openId)
  )) {
    return { ok: false, status: 403, error: "合成任务身份与当前登录账号不一致" };
  }
  if (input.type !== undefined && input.type !== "video") {
    return { ok: false, status: 400, error: "合成仅支持视频任务" };
  }
  return { ok: true, userId: String(id) };
}

export function assertManhuaAssembleJobOwner(input: {
  userId: unknown;
  jobId: unknown;
  job: { id: unknown; userId: unknown; type: unknown; status: unknown; input: unknown } | null;
}): number {
  const userId = Number(input.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0 || String(userId) !== input.userId) {
    throw new Error("合成任务缺少有效登录身份，已停止执行");
  }
  const job = input.job;
  if (!input.jobId || !job || job.id !== input.jobId || String(job.userId) !== String(userId) ||
    job.type !== "video" || job.status !== "running" ||
    !job.input || typeof job.input !== "object" || Array.isArray(job.input) ||
    (job.input as { action?: unknown }).action !== "manhua_assemble_final") {
    throw new Error("合成任务归属或执行状态不匹配，已停止执行");
  }
  if (!hasCurrentManhuaAssembleBillingContract((job.input as { params?: unknown }).params)) {
    throw new Error("合成计费协议已更新，请刷新页面后重新确认，未重复扣费");
  }
  return userId;
}

export function hasCurrentManhuaAssembleBillingContract(params: unknown): boolean {
  return !!params && typeof params === "object" && !Array.isArray(params) &&
    (params as { billingContractVersion?: unknown }).billingContractVersion === "manhua-assemble-v1";
}
