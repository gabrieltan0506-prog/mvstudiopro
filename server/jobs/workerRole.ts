/**
 * 0917：Blender（绑骨/白模渲染）独立进程组。
 * 用户实测：绑定阶段 Blender 把 2 vCPU 吃满 10–30 分钟，同机 web 与其他任务一起慢；nice 只让位不减载。
 * 角色由进程命令注入（fly.toml [processes]）：
 *   app —— web + 全部队列；开了 MANHUA_RIG_WORKER_SPLIT=1 后不再领 Blender 后期任务
 *   rig —— 只领 Blender 后期任务（manhua_auto_rig / manhua_previs），不跑 growth、不做学习任务恢复
 */
export type JobWorkerRole = "app" | "rig";
export const BLENDER_POST_PROD_ACTIONS = ["manhua_auto_rig", "manhua_previs"] as const;
export type PostProdClaimFilter = "blender" | "non_blender" | undefined;

export function resolveJobWorkerRole(env: NodeJS.ProcessEnv = process.env): JobWorkerRole {
  return String(env.JOB_WORKER_ROLE || "").trim().toLowerCase() === "rig" ? "rig" : "app";
}
export function rigWorkerSplitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANHUA_RIG_WORKER_SPLIT || "").trim() === "1";
}
export function isBlenderPostProdAction(action: unknown): boolean {
  return (BLENDER_POST_PROD_ACTIONS as readonly string[]).includes(String(action || ""));
}
/** 本进程该领哪类后期任务：rig 只领 Blender；app 开了分流就不领 Blender；没开分流全领（单机模式，兼容旧部署）。 */
export function resolvePostProdClaimFilter(env: NodeJS.ProcessEnv = process.env): PostProdClaimFilter {
  const role = resolveJobWorkerRole(env);
  if (role === "rig") return "blender";
  return rigWorkerSplitEnabled(env) ? "non_blender" : undefined;
}
