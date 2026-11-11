/**
 * 可灵（Kling）停用开关：缺省停用。
 * - 停用后：所有新建可灵任务的入口返回 410 kling_retired，前端隐藏创建入口，套餐不再售卖，路由不再选可灵通道。
 * - 历史作品照常显示/下载；数据库表结构不变；代码暂留（彻底删除另行处理）。
 * - 紧急恢复：设置环境变量 KLING_RETIRED=0（仅服务端生效）。
 */
export const KLING_RETIRED_ERROR = "kling_retired" as const;
export const KLING_RETIRED_MESSAGE_ZH = "该功能已下线，请使用其他视频/图片生成功能";

export function isKlingRetired(env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {}): boolean {
  const raw = String(env.KLING_RETIRED ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/** 前端构建期常量：前端一律视为已停用（不读服务端 env）。 */
export const KLING_RETIRED_CLIENT = true;
