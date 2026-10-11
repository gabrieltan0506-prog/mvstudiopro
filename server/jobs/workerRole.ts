/**
 * 0917：Blender（绑骨/白模渲染）独立进程组。
 * 用户实测：绑定阶段 Blender 把 2 vCPU 吃满 10–30 分钟，同机 web 与其他任务一起慢；nice 只让位不减载。
 * 角色由进程命令注入（fly.toml [processes]）：
 *   app —— web + 全部队列；开了 MANHUA_RIG_WORKER_SPLIT=1 后不再领 Blender 后期任务
 *   rig —— 只领 Blender 后期任务（manhua_auto_rig / manhua_previs），不跑 growth、不做学习任务恢复
 */
export type JobWorkerRole = "app" | "rig";
export const BLENDER_POST_PROD_ACTIONS = ["manhua_auto_rig", "manhua_previs", "manhua_vfx", "art_motion"] as const;
export type PostProdClaimFilter = "blender" | "non_blender" | "bgm" | "non_bgm" | "non_blender_non_bgm" | "none" | undefined;

export function resolveJobWorkerRole(env: NodeJS.ProcessEnv = process.env): JobWorkerRole {
  return String(env.JOB_WORKER_ROLE || "").trim().toLowerCase() === "rig" ? "rig" : "app";
}
export function rigWorkerSplitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANHUA_RIG_WORKER_SPLIT || "").trim() === "1";
}
export function isBlenderPostProdAction(action: unknown): boolean {
  return (BLENDER_POST_PROD_ACTIONS as readonly string[]).includes(String(action || ""));
}
/** 特效只允许指定工作机执行；关闭分流开关也不能回退生产机。 */
export function canRenderManhuaVfx(env: NodeJS.ProcessEnv = process.env): boolean {
  const target = String(env.MANHUA_HEAVY_MACHINE_ID || "").trim();
  return resolveJobWorkerRole(env) === "rig" && Boolean(target) && env.FLY_MACHINE_ID === target;
}
export function assertManhuaVfxWorker(env: NodeJS.ProcessEnv = process.env): void {
  if (!canRenderManhuaVfx(env)) throw new Error("特效渲染只能在指定工作机执行，不回退生产机");
}
/** 本进程该领哪类后期任务：rig 只领 Blender；app 开了分流就不领 Blender；没开分流全领（单机模式，兼容旧部署）。 */
export function resolvePostProdClaimFilter(env: NodeJS.ProcessEnv = process.env): PostProdClaimFilter {
  const role = resolveJobWorkerRole(env);
  if (heavyWorkerSplitEnabled(env)) return role === "rig" ? undefined : "none";
  if (role === "rig") return "blender";
  return rigWorkerSplitEnabled(env) ? "non_blender" : undefined;
}

/** Opt-in only after the two-machine deployment has been explicitly approved. */
export function heavyWorkerSplitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANHUA_HEAVY_WORKER_SPLIT || "").trim() === "1";
}

/** 分机时由工作机直接领取整条学习任务；单机部署仍由 app 领取。 */
export function shouldConsumeManhuaLearning(env: NodeJS.ProcessEnv = process.env): boolean {
  return heavyWorkerSplitEnabled(env) ? resolveJobWorkerRole(env) === "rig" : resolveJobWorkerRole(env) === "app";
}
