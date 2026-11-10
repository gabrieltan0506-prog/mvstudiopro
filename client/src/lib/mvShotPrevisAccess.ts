/**
 * 1110 白模入口权限：用户定规「白模工作台对普通用户开放」（服务端 manhuaPrevis 路由 1109 已改 protectedProcedure）。
 * 只对 MV 镜头块（musicMvShot）放开：任意已登录用户可走顾问白模试看/应用；
 * 其他 3D/3DGS/绑骨/漫剧片段白模入口仍按 canUseManhua3d（admin/supervisor），本函数不改变它们。
 * 费用不变：白模渲染 0 积分；顾问咨询走面板额度（每作品 5 次免费、超额确认、管理员免扣）。
 */
export function canUseAdvisorPrevisFor(input: {
  /** 页面原 3D 门槛（admin/supervisor）。 */
  canUseManhua3d: boolean;
  /** 当前登录用户 id；未登录不放开。 */
  userId?: string | number | null;
  /** 目标块；只有 MV 镜头块对普通用户放开。 */
  clip?: { musicMvShot?: unknown } | null;
}): boolean {
  if (input.canUseManhua3d) return true;
  return input.userId != null && input.userId !== "" && Boolean(input.clip?.musicMvShot);
}

/** MV 镜头白模入口（mvPrevisBridge）是否可用：已登录即可，不看 3D 门槛。 */
export function mvShotPrevisBridgeUnavailableZh(input: { userId?: string | number | null; factoryBusy?: boolean }): string | undefined {
  if (input.userId == null || input.userId === "") return "请先登录后再生成白模动作参考";
  if (input.factoryBusy) return "正在制作中，结束后再生成白模";
  return undefined;
}
