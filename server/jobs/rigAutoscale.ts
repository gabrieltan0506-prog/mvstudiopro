/**
 * 0917 PR-B：rig 进程组按需启停（策略层，纯函数 + 注入 IO，可单测）。
 *
 * 背景（知识库 事故簿/0917-绑骨真模上线六次才通）：Blender 必须与 app 分机跑，
 * 但 rig 机 performance 4 核 8 GB 常驻在用户无进账阶段是纯成本。
 *
 * 两半：
 *  - app 机：看见 queued 的 Blender 后期任务 → 把停着的 rig 机拉起来（rig 起来自己会领单）。
 *  - rig 机：连续空闲超过阈值（默认 10 分钟）→ 停掉**自己这台**。
 *
 * 安全边界（写死）：
 *  - 只认 `fly_process_group === "rig"` 的机器；app 机永不参与启停。
 *  - rig 停机前必须同时满足：本进程没有任务在跑 + 队列里没有 Blender 任务。
 *  - 没有 FLY_API_TOKEN（本机、CI、未配 secret 的线上）→ 整条链 no-op，行为与本 PR 之前一致。
 *  - 起不来/停不掉只记日志，绝不改任务状态：任务照排队，rig 恢复后照领。
 */
import {
  listRigMachines,
  needsStart,
  resolveFlyMachinesConfig,
  resolveSelfMachineId,
  startFlyMachine,
  stopFlyMachine,
  type FlyMachine,
} from "../services/flyMachines.js";

export const RIG_START_COOLDOWN_MS = 60_000;
export const DEFAULT_RIG_IDLE_STOP_MS = 10 * 60_000;

export function resolveRigIdleStopMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.MANHUA_RIG_IDLE_STOP_MS);
  if (!Number.isFinite(raw)) return DEFAULT_RIG_IDLE_STOP_MS;
  if (raw <= 0) return 0; // 0 = 关闭自动停机
  return Math.max(60_000, Math.floor(raw));
}
/** 自动启停总开关：默认开；置 0 可在不回滚代码的前提下关掉（rig 保持常驻）。 */
export function rigAutoscaleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANHUA_RIG_AUTOSCALE ?? "1").trim() !== "0";
}

export type RigAutoscaleDeps = {
  now(): number;
  /** queued + running 的 Blender 后期任务条数（manhua_auto_rig / manhua_previs） */
  pendingBlenderJobs(): Promise<number>;
  listRig(): Promise<FlyMachine[]>;
  startMachine(machineId: string): Promise<void>;
  stopMachine(machineId: string): Promise<void>;
  selfMachineId: string;
  idleStopMs: number;
  log(message: string): void;
};

export type RigStartState = { lastAttemptAt: number };
export type RigIdleState = { lastBusyAt: number };

export type RigStartOutcome =
  | { action: "idle" }
  | { action: "cooldown" }
  | { action: "already_running" }
  | { action: "started"; machineIds: string[] }
  | { action: "no_machine" }
  | { action: "error"; message: string };

/** app 机：有 Blender 任务排队就把停着的 rig 机拉起来。幂等 + 冷却，不重复发命令。 */
export async function ensureRigStartedForPending(
  deps: RigAutoscaleDeps,
  state: RigStartState,
): Promise<RigStartOutcome> {
  let pending = 0;
  try {
    pending = await deps.pendingBlenderJobs();
  } catch (error) {
    return { action: "error", message: `pending 查询失败：${String(error)}` };
  }
  if (pending <= 0) return { action: "idle" };
  if (deps.now() - state.lastAttemptAt < RIG_START_COOLDOWN_MS) return { action: "cooldown" };
  state.lastAttemptAt = deps.now();

  try {
    const machines = await deps.listRig();
    if (machines.length === 0) {
      deps.log("[rig-autoscale] 没有 rig 进程组机器，Blender 任务将排队等待（检查 fly.toml [processes] 与部署）");
      return { action: "no_machine" };
    }
    const targets = machines.filter((m) => needsStart(m.state));
    if (targets.length === 0) return { action: "already_running" };
    const started: string[] = [];
    for (const machine of targets) {
      try {
        await deps.startMachine(machine.id);
        started.push(machine.id);
        deps.log(`[rig-autoscale] 有 ${pending} 个 Blender 任务在队，已启动 rig 机 ${machine.id}（原状态 ${machine.state}）`);
      } catch (error) {
        deps.log(`[rig-autoscale] 启动 rig 机 ${machine.id} 失败：${String(error)}`);
      }
    }
    return started.length ? { action: "started", machineIds: started } : { action: "error", message: "所有 rig 机启动均失败" };
  } catch (error) {
    return { action: "error", message: `列举 rig 机失败：${String(error)}` };
  }
}

export type RigIdleOutcome =
  | { action: "busy" }
  | { action: "waiting"; idleMs: number }
  | { action: "disabled" }
  | { action: "stopped"; machineId: string }
  | { action: "error"; message: string };

/**
 * rig 机：空闲够久就停自己。
 * @param busy 本进程此刻是否有任务在跑（runner 传 postProdProcessing）
 */
export async function maybeStopIdleRig(
  deps: RigAutoscaleDeps,
  state: RigIdleState,
  busy: boolean,
): Promise<RigIdleOutcome> {
  if (deps.idleStopMs <= 0 || !deps.selfMachineId) return { action: "disabled" };
  if (busy) {
    state.lastBusyAt = deps.now();
    return { action: "busy" };
  }
  let pending = 0;
  try {
    pending = await deps.pendingBlenderJobs();
  } catch (error) {
    // 查不到就当忙，宁可多开一会儿机器，也不能把有任务在队的机器停掉
    state.lastBusyAt = deps.now();
    return { action: "error", message: `pending 查询失败：${String(error)}` };
  }
  if (pending > 0) {
    state.lastBusyAt = deps.now();
    return { action: "busy" };
  }
  const idleMs = deps.now() - state.lastBusyAt;
  if (idleMs < deps.idleStopMs) return { action: "waiting", idleMs };
  try {
    deps.log(`[rig-autoscale] rig 空闲 ${Math.round(idleMs / 1000)} 秒，停机 ${deps.selfMachineId}（下次有 Blender 任务时由 app 机唤醒）`);
    await deps.stopMachine(deps.selfMachineId);
    state.lastBusyAt = deps.now();
    return { action: "stopped", machineId: deps.selfMachineId };
  } catch (error) {
    state.lastBusyAt = deps.now();
    return { action: "error", message: `停机失败：${String(error)}` };
  }
}

/** 线上依赖：没有 Fly 凭证就返回 null，调用方直接跳过（关闭式失败，不回落本机） */
export function resolveRigAutoscaleDeps(
  pendingBlenderJobs: () => Promise<number>,
  env: NodeJS.ProcessEnv = process.env,
): RigAutoscaleDeps | null {
  if (!rigAutoscaleEnabled(env)) return null;
  const cfg = resolveFlyMachinesConfig(env);
  if (!cfg) return null;
  return {
    now: () => Date.now(),
    pendingBlenderJobs,
    listRig: () => listRigMachines(cfg),
    startMachine: (id) => startFlyMachine(cfg, id),
    stopMachine: (id) => stopFlyMachine(cfg, id),
    selfMachineId: resolveSelfMachineId(env),
    idleStopMs: resolveRigIdleStopMs(env),
    log: (message) => console.warn(message),
  };
}
