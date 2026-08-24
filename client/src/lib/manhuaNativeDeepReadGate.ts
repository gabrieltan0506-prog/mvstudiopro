export type ManhuaNativeDeepReadGate =
  | "legacy"
  | "blocked_unconfirmed"
  | "blocked_not_owner"
  | "ready";

/**
 * 抖音原生精读的客户端门禁。
 *
 * 只有“不是原生精读候选”的素材才允许走旧链；候选素材一旦权限状态未确认
 * 或当前账号不是 owner，就必须关闭式停止，不能静默回落到抽帧链。
 */
export function resolveManhuaNativeDeepReadGate(input: {
  candidate: boolean;
  capabilityLoading: boolean;
  capabilityError: boolean;
  ownerAllowed: boolean;
}): ManhuaNativeDeepReadGate {
  if (!input.candidate) return "legacy";
  if (input.capabilityLoading || input.capabilityError) return "blocked_unconfirmed";
  return input.ownerAllowed ? "ready" : "blocked_not_owner";
}
