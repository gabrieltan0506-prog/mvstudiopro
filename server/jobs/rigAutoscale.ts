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
  // 空串（secret 设过又清空）当没设，走默认值；不能让 Number("")===0 静默关掉停机。
  const rawText = String(env.MANHUA_RIG_IDLE_STOP_MS ?? "").trim();
  if (!rawText) return DEFAULT_RIG_IDLE_STOP_MS;
  const raw = Number(rawText);
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
  /** 只数 queued：判「要不要唤醒一台停着的 rig」。running 的那单已经有机器在跑。 */
  queuedBlenderJobs(): Promise<number>;
  /** queued + running：判「这台能不能停」。绑定跑 12 分钟期间队列为空但机器不能停。 */
  pendingBlenderJobs(): Promise<number>;
  /** 停机命令发出前的回调：runner 用它把本进程的领单闸关掉，避免停机窗口内又领一单。 */
  onStopDecided?(): void;
  /** 停机失败时复位上面的闸。 */
  onStopAborted?(): void;
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
  let queued = 0;
  try {
    queued = await deps.queuedBlenderJobs();
  } catch (error) {
    return { action: "error", message: `queued 查询失败：${String(error)}` };
  }
  if (queued <= 0) return { action: "idle" };
  if (deps.now() - state.lastAttemptAt < RIG_START_COOLDOWN_MS) return { action: "cooldown" };

  try {
    const machines = await deps.listRig();
    if (machines.length === 0) {
      deps.log("[rig-autoscale] 没有 rig 进程组机器，Blender 任务将排队等待（检查 fly.toml [processes] 与部署）");
      return { action: "no_machine" };
    }
    const targets = machines.filter((m) => needsStart(m.state));
    // 冷却只为「真的发了启动命令」计时：没机器可启、正在 starting/stopping 的轮次不烧冷却，
    // 否则一台处于 stopping 的 rig 会让唤醒最坏多等一个冷却周期。
    if (targets.length === 0) return { action: "already_running" };
    state.lastAttemptAt = deps.now();
    const started: string[] = [];
    for (const machine of targets) {
      try {
        await deps.startMachine(machine.id);
        started.push(machine.id);
        deps.log(`[rig-autoscale] 有 ${queued} 个 Blender 任务在队，已启动 rig 机 ${machine.id}（原状态 ${machine.state}）`);
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
 * @param busy 本进程此刻是否有任务在跑。**线上一律传函数**（runner 传 `() => postProdProcessing`）：
 *              关闸前后各读一次，快照式 boolean 会漏掉停机窗口里刚领到的那一单。
 */
export async function maybeStopIdleRig(
  deps: RigAutoscaleDeps,
  state: RigIdleState,
  busy: boolean | (() => boolean),
): Promise<RigIdleOutcome> {
  // 传函数才是线上口径：下面两次 await 各跨一次网络往返，期间 1 秒一轮的 post_prod
  // 通道完全可能刚领到一单绑骨任务，快照式的 boolean 看不见它。
  const isBusy = typeof busy === "function" ? busy : () => busy;
  if (deps.idleStopMs <= 0 || !deps.selfMachineId) return { action: "disabled" };
  if (isBusy()) {
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
  // 停机前再确认一次「我这台确实是 rig」。停错机器＝把 app 机停掉＝站点下线，
  // 这条保险的代价只是停机时多一次 list 调用。
  try {
    const rigMachines = await deps.listRig();
    if (!rigMachines.some((m) => m.id === deps.selfMachineId)) {
      state.lastBusyAt = deps.now();
      return { action: "error", message: `本机 ${deps.selfMachineId} 不在 rig 进程组里，拒绝停机` };
    }
  } catch (error) {
    state.lastBusyAt = deps.now();
    return { action: "error", message: `停机前核对进程组失败：${String(error)}` };
  }
  // 先关本进程的领单闸，再发停机命令：停机要跨一次网络往返，这期间 worker 每秒还在领单，
  // 领到的绑骨任务会被随后的 SIGINT 打断，卡 running 到 reaper 判失败。
  deps.onStopDecided?.();
  // 关闸之后再核一次「本进程有没有任务在跑」。闸是同步置位的，而 runner 的
  // `processPostProdJobsOnce` 在「查闸 → 置 processing」之间没有 await，
  // 所以关闸后 isBusy() 仍为 false，才能断定停机不会打断一单已经在跑的绑骨
  // （12 分钟的活被 SIGINT 打断 = 卡 running 到 reaper 判失败，正是这条链最贵的错）。
  if (isBusy()) {
    deps.onStopAborted?.();
    state.lastBusyAt = deps.now();
    return { action: "busy" };
  }
  try {
    deps.log(`[rig-autoscale] rig 空闲 ${Math.round(idleMs / 1000)} 秒，停机 ${deps.selfMachineId}（下次有 Blender 任务时由 app 机唤醒）`);
    await deps.stopMachine(deps.selfMachineId);
    state.lastBusyAt = deps.now();
    return { action: "stopped", machineId: deps.selfMachineId };
  } catch (error) {
    // 停不掉就把闸打开，机器继续干活，别变成一台活着却不领单的空转机器。
    deps.onStopAborted?.();
    state.lastBusyAt = deps.now();
    return { action: "error", message: `停机失败：${String(error)}` };
  }
}

/** 线上依赖：没有 Fly 凭证就返回 null，调用方直接跳过（关闭式失败，不回落本机） */
export function resolveRigAutoscaleDeps(
  counters: {
    queuedBlenderJobs: () => Promise<number>;
    pendingBlenderJobs: () => Promise<number>;
  },
  hooks: { onStopDecided?: () => void; onStopAborted?: () => void } = {},
  env: NodeJS.ProcessEnv = process.env,
): RigAutoscaleDeps | null {
  if (!rigAutoscaleEnabled(env)) return null;
  const cfg = resolveFlyMachinesConfig(env);
  if (!cfg) return null;
  return {
    now: () => Date.now(),
    queuedBlenderJobs: counters.queuedBlenderJobs,
    pendingBlenderJobs: counters.pendingBlenderJobs,
    onStopDecided: hooks.onStopDecided,
    onStopAborted: hooks.onStopAborted,
    listRig: () => listRigMachines(cfg),
    startMachine: (id) => startFlyMachine(cfg, id),
    stopMachine: (id) => stopFlyMachine(cfg, id),
    selfMachineId: resolveSelfMachineId(env),
    idleStopMs: resolveRigIdleStopMs(env),
    log: (message) => console.warn(message),
  };
}
