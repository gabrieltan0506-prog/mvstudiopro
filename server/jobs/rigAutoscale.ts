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
  listFlyMachines,
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
/**
 * 「rig 不可用」必须连续观察够这么久才允许打回用户任务。
 * 理由：打回是不可逆的产品行为（用户直接看到失败），而 `fly deploy` 期间旧机被销毁、新机还没建好，
 * 列举 API 完全可能有几秒钟返回零台 rig 机。单次观察就清空队列 = 一次正常部署误杀所有排队任务。
 * 连续两轮（tick 15 秒、启动冷却 60 秒）确认之后再打回，代价只是失败晚一分钟出现。
 */
export const RIG_UNAVAILABLE_CONFIRM_MS = 60_000;

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
  /**
   * 没有 rig 机可唤醒 / 启动全失败时，把排队中的 Blender 任务打回失败（带原因带做法）。
   * 只有确实查过 Machines API 才调；「机器存在但 stopped」不算没有，那要去 start 它。
   */
  failQueuedBlenderJobs?(reason: string): Promise<string[]>;
  /** 错误文案里要写出的应用名，用于拼可执行的命令。 */
  appName?: string;
  listRig(): Promise<FlyMachine[]>;
  /**
   * 不过滤进程组的全量机器列表。只在「一台 rig 机都没有」这个分支用：
   * 「零台 rig」有两种解释——真的没有 rig 机，或者机器在、但缺 `fly_process_group` 元数据
   * （`fly machine run` 手建的调试机就没有）。后者会把一台正在干活的 rig 机误判成不存在，
   * 60 秒后清空队列。判据必须先排除这个良性解释才能打回。不传＝退回旧行为。
   */
  listAllMachines?(): Promise<FlyMachine[]>;
  startMachine(machineId: string): Promise<void>;
  stopMachine(machineId: string): Promise<void>;
  selfMachineId: string;
  idleStopMs: number;
  log(message: string): void;
};

export type RigStartState = { lastAttemptAt: number; unavailableSince?: number };
export type RigIdleState = { lastBusyAt: number };

export type RigStartOutcome =
  | { action: "idle" }
  | { action: "cooldown" }
  | { action: "already_running" }
  | { action: "started"; machineIds: string[] }
  | { action: "no_machine" }
  /** 查不到 rig 进程组机器，但存在缺进程组元数据的机器：证据不足，不打回。 */
  | { action: "unknown_topology" }
  /** rig 不可用，但还没连续够 RIG_UNAVAILABLE_CONFIRM_MS：这一轮只记录，不打回任务。 */
  | { action: "no_machine_pending"; unavailableMs: number }
  | { action: "error"; message: string };

/**
 * 「rig 不可用」是否已经连续观察够久，可以打回排队任务了。
 * 第一次观察落时间戳；恢复正常或列举失败时由调用方复位。
 * 窗口设 0 时首次观察即确认——这样「关掉确认窗口＝退回即时打回」才名副其实，
 * 不会变成「还是要等下一轮」这种说一套做一套的开关。
 */
function confirmRigUnavailable(deps: RigAutoscaleDeps, state: RigStartState): { confirmed: boolean; elapsedMs: number } {
  const now = deps.now();
  if (state.unavailableSince === undefined) state.unavailableSince = now;
  const elapsedMs = now - state.unavailableSince;
  return { confirmed: elapsedMs >= RIG_UNAVAILABLE_CONFIRM_MS, elapsedMs };
}

/**
 * 全量列表里缺进程组元数据的机器台数。列举失败当 0（沿用外层「列举失败不打回」的处理，
 * 但这里更保守：查不到就按旧行为继续走确认窗口，不会因为这条附加查询挂掉而放过真实故障）。
 */
async function countUnlabeledMachines(deps: RigAutoscaleDeps): Promise<number> {
  if (!deps.listAllMachines) return 0;
  try {
    return (await deps.listAllMachines()).filter((m) => !m.processGroup).length;
  } catch {
    return 0;
  }
}

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
  if (queued <= 0) {
    state.unavailableSince = undefined;
    return { action: "idle" };
  }
  if (deps.now() - state.lastAttemptAt < RIG_START_COOLDOWN_MS) return { action: "cooldown" };

  try {
    const machines = await deps.listRig();
    if (machines.length === 0) {
      // 行为变更（0917 用户拍板）：没有机器就即时打回，不再静默排队到 reaper 判死。
      // 但必须连续确认够久——部署窗口内零台 rig 是暂态，单次观察就打回等于每次发版误杀队列。
      const { confirmed, elapsedMs } = confirmRigUnavailable(deps, state);
      if (!confirmed) {
        deps.log(`[rig-autoscale] 暂时查不到 rig 进程组机器（已 ${Math.round(elapsedMs / 1000)} 秒），未到确认窗口，先不打回任务`);
        return { action: "no_machine_pending", unavailableMs: elapsedMs };
      }
      // 打回之前先排除「机器在、只是没有 fly_process_group 元数据」这个良性解释：
      // 手建（fly machine run）的 rig 机照样带 JOB_WORKER_ROLE=rig 在领单，把它当成不存在
      // 就会一边有机器在跑、一边把队列里其余任务全杀掉。存疑就不打回，只报警。
      const unlabeled = await countUnlabeledMachines(deps);
      if (unlabeled > 0) {
        state.unavailableSince = undefined;
        deps.log(
          `[rig-autoscale] 没查到 rig 进程组机器，但有 ${unlabeled} 台机器缺 fly_process_group 元数据（多半是 fly machine run 手建的）：` +
            "无法断定 rig 不存在，本轮不打回任何任务。请用 fly deploy 产出的机器跑 rig，或给手建机补上元数据。",
        );
        return { action: "unknown_topology" };
      }
      const app = deps.appName ? ` -a ${deps.appName}` : "";
      const failed = await deps.failQueuedBlenderJobs?.(
        "绑骨/白模任务未能开始：Blender 后期机不存在或不可唤醒。这不是你的参数或配置问题，" +
          "请稍后重新提交；若仍然失败，把这条错误原样转给管理员即可。" +
          `管理员处理：本应用当前没有 rig 进程组机器，执行 fly scale count rig=1${app} 建机` +
          "（机器可以停着，有任务会自动唤醒），并检查 fly.toml [processes] 与本次部署。",
      );
      deps.log(`[rig-autoscale] 没有 rig 进程组机器，已打回 ${failed?.length ?? 0} 个排队中的 Blender 任务（检查 fly.toml [processes] 与部署）`);
      // 打回完就把确认窗口重新开始计时：否则时间戳一直是最早那次观察，
      // 打回之后新提交进来的任务会在下一个 15 秒 tick 被连坐秒杀（等于对它没有确认窗口）。
      // 重开之后每一批被打回的任务都实打实享受满一个 RIG_UNAVAILABLE_CONFIRM_MS，
      // rig 若在这期间恢复，这批任务直接跑掉而不是先被杀。
      state.unavailableSince = deps.now();
      return { action: "no_machine" };
    }
    const targets = machines.filter((m) => needsStart(m.state));
    // 冷却只为「真的发了启动命令」计时：没机器可启、正在 starting/stopping 的轮次不烧冷却，
    // 否则一台处于 stopping 的 rig 会让唤醒最坏多等一个冷却周期。
    if (targets.length === 0) {
      state.unavailableSince = undefined;
      return { action: "already_running" };
    }
    state.lastAttemptAt = deps.now();
    const started: string[] = [];
    for (const machine of targets) {
      // 最多唤醒 queued 台：1 单排队却把 3 台停着的 rig 全拉起来，多出来的那几台在这一单跑完前
      // 都因为 pendingBlenderJobs>0 停不掉（见 maybeStopIdleRig），等于 1 单付 N 台 ×（任务时长+10 分钟）。
      // 注意是「已成功启动够 queued 台」才收手：启动失败的那台不占名额，否则一台起不来就会
      // 让另外几台可用的 rig 完全没机会被试，最后走到打回分支上误杀任务。
      if (started.length >= queued) break;
      try {
        await deps.startMachine(machine.id);
        started.push(machine.id);
        deps.log(`[rig-autoscale] 有 ${queued} 个 Blender 任务在队，已启动 rig 机 ${machine.id}（原状态 ${machine.state}）`);
      } catch (error) {
        deps.log(`[rig-autoscale] 启动 rig 机 ${machine.id} 失败：${String(error)}`);
      }
    }
    if (started.length) {
      state.unavailableSince = undefined;
      return { action: "started", machineIds: started };
    }
    // 机器在、但一台都起不来：同样打回，错误里给出具体机器 ID，管理员可以直接照抄命令。
    // 一样要连续确认：Fly 的 start 偶发 5xx（部署、容量调度）一次就清空队列同样是误杀。
    const ids = targets.map((m) => m.id).join(" / ");
    const { confirmed, elapsedMs } = confirmRigUnavailable(deps, state);
    if (!confirmed) {
      deps.log(`[rig-autoscale] rig 机 ${ids} 本轮启动失败（已 ${Math.round(elapsedMs / 1000)} 秒），未到确认窗口，先不打回任务`);
      return { action: "error", message: `所有 rig 机启动均失败（${ids}），未到打回确认窗口` };
    }
    const app = deps.appName ? ` -a ${deps.appName}` : "";
    const failed = await deps.failQueuedBlenderJobs?.(
      "绑骨/白模任务未能开始：Blender 后期机不存在或不可唤醒。这不是你的参数或配置问题，" +
        "请稍后重新提交；若仍然失败，把这条错误原样转给管理员即可。" +
        `管理员处理：rig 机 ${ids} 连续启动失败，执行 fly machine start ${targets[0].id}${app} 查看拒绝原因。`,
    );
    deps.log(`[rig-autoscale] rig 机启动全失败，已打回 ${failed?.length ?? 0} 个排队中的 Blender 任务`);
    state.unavailableSince = deps.now(); // 同上：打回一批就重开确认窗口，别让后来的任务没有窗口
    return { action: "error", message: `所有 rig 机启动均失败（${ids}）` };
  } catch (error) {
    // 列举失败 ≠ 没有机器：复位确认计时，打回必须建立在连续两次**成功**的观察上。
    state.unavailableSince = undefined;
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
  hooks: {
    onStopDecided?: () => void;
    onStopAborted?: () => void;
    failQueuedBlenderJobs?: (reason: string) => Promise<string[]>;
  } = {},
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
    failQueuedBlenderJobs: hooks.failQueuedBlenderJobs,
    appName: cfg.appName,
    listRig: () => listRigMachines(cfg),
    listAllMachines: () => listFlyMachines(cfg),
    startMachine: (id) => startFlyMachine(cfg, id),
    stopMachine: (id) => stopFlyMachine(cfg, id),
    selfMachineId: resolveSelfMachineId(env),
    idleStopMs: resolveRigIdleStopMs(env),
    log: (message) => console.warn(message),
  };
}
