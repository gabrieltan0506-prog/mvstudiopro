export type ManhuaNativeDeepReadGate =
  | "unsupported_source"
  | "blocked_unconfirmed"
  | "blocked_not_owner"
  | "ready";

/**
 * 抖音原生精读的客户端门禁。
 *
 * 当前学习入口只建立原生视频精读任务。任何不满足原生精读契约的素材、
 * 权限未确认或账号不匹配都关闭式停止，不得建立已退出的抽帧学习任务。
 */
export function resolveManhuaNativeDeepReadGate(input: {
  candidate: boolean;
  capabilityLoading: boolean;
  capabilityError: boolean;
  ownerAllowed: boolean;
}): ManhuaNativeDeepReadGate {
  if (!input.candidate) return "unsupported_source";
  if (input.capabilityLoading || input.capabilityError) return "blocked_unconfirmed";
  return input.ownerAllowed ? "ready" : "blocked_not_owner";
}
