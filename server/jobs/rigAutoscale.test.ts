import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RIG_IDLE_STOP_MS,
  RIG_START_COOLDOWN_MS,
  ensureRigStartedForPending,
  maybeStopIdleRig,
  resolveRigAutoscaleDeps,
  resolveRigIdleStopMs,
  rigAutoscaleEnabled,
  type RigAutoscaleDeps,
} from "./rigAutoscale";
import { listRigMachines, needsStart, resolveFlyMachinesConfig } from "../services/flyMachines";

function makeDeps(over: Partial<RigAutoscaleDeps> = {}) {
  let clock = 1_000_000;
  const started: string[] = [];
  const stopped: string[] = [];
  const calls: string[] = [];
  const failedReasons: string[] = [];
  const deps: RigAutoscaleDeps = {
    now: () => clock,
    queuedBlenderJobs: async () => 0,
    pendingBlenderJobs: async () => 0,
    failQueuedBlenderJobs: async (reason: string) => {
      failedReasons.push(reason);
      return ["job-1"];
    },
    appName: "mvstudiopro",
    onStopDecided: () => void calls.push("gate_closed"),
    onStopAborted: () => void calls.push("gate_reopened"),
    listRig: async () => [{ id: "rig-1", state: "stopped", processGroup: "rig" }],
    startMachine: async (id) => void started.push(id),
    stopMachine: async (id) => {
      calls.push("stop:" + id);
      stopped.push(id);
    },
    selfMachineId: "rig-1",
    idleStopMs: DEFAULT_RIG_IDLE_STOP_MS,
    log: () => {},
    ...over,
  };
  return { deps, started, stopped, calls, failedReasons, advance: (ms: number) => (clock += ms), at: () => clock };
}

describe("rig 唤醒（app 机）", () => {
  it("队列为空不碰机器", async () => {
    const { deps, started } = makeDeps();
    expect(await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).toEqual({ action: "idle" });
    expect(started).toEqual([]);
  });

  it("有排队任务且 rig 停着就启动它", async () => {
    const { deps, started } = makeDeps({ queuedBlenderJobs: async () => 2 });
    const out = await ensureRigStartedForPending(deps, { lastAttemptAt: 0 });
    expect(out).toEqual({ action: "started", machineIds: ["rig-1"] });
    expect(started).toEqual(["rig-1"]);
  });

  it("rig 已经在跑就不重复发启动命令", async () => {
    const { deps, started } = makeDeps({
      queuedBlenderJobs: async () => 1,
      listRig: async () => [{ id: "rig-1", state: "started", processGroup: "rig" }],
    });
    expect(await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).toEqual({ action: "already_running" });
    expect(started).toEqual([]);
  });

  it("冷却期内不重复调用 Fly API；过了冷却才再试", async () => {
    const { deps, started, advance, at } = makeDeps({ queuedBlenderJobs: async () => 1 });
    const state = { lastAttemptAt: 0 };
    await ensureRigStartedForPending(deps, state);
    expect(started).toEqual(["rig-1"]);
    advance(RIG_START_COOLDOWN_MS - 1);
    expect(await ensureRigStartedForPending(deps, state)).toEqual({ action: "cooldown" });
    expect(started).toEqual(["rig-1"]);
    advance(2);
    await ensureRigStartedForPending(deps, state);
    expect(started).toEqual(["rig-1", "rig-1"]);
    expect(state.lastAttemptAt).toBe(at());
  });

  it("唤醒只数 queued：另一台在跑的 running 单不该把其它 rig 机也拉起来", async () => {
    const { deps, started } = makeDeps({
      queuedBlenderJobs: async () => 0,
      pendingBlenderJobs: async () => 1, // 有一单正在别的机器上跑
      listRig: async () => [
        { id: "rig-1", state: "started", processGroup: "rig" },
        { id: "rig-2", state: "stopped", processGroup: "rig" },
      ],
    });
    expect(await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).toEqual({ action: "idle" });
    expect(started).toEqual([]);
  });

  it("没机器可启的轮次不烧冷却（rig 处在 stopping 时不该让唤醒多等一个周期）", async () => {
    const state = { lastAttemptAt: 0 };
    const { deps, started } = makeDeps({
      queuedBlenderJobs: async () => 1,
      listRig: async () => [{ id: "rig-1", state: "stopping", processGroup: "rig" }],
    });
    expect(await ensureRigStartedForPending(deps, state)).toEqual({ action: "already_running" });
    expect(state.lastAttemptAt).toBe(0);
    const next = makeDeps({ queuedBlenderJobs: async () => 1 });
    expect((await ensureRigStartedForPending(next.deps, state)).action).toBe("started");
    expect(started).toEqual([]);
    expect(next.started).toEqual(["rig-1"]);
  });

  it("一台 rig 机都没有：排队中的 Blender 任务即时打回，错误里带可执行的命令", async () => {
    const { deps, started, failedReasons } = makeDeps({ queuedBlenderJobs: async () => 1, listRig: async () => [] });
    expect(await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).toEqual({ action: "no_machine" });
    expect(started).toEqual([]);
    expect(failedReasons).toHaveLength(1);
    expect(failedReasons[0]).toContain("Blender 后期机不存在或不可唤醒");
    expect(failedReasons[0]).toContain("fly scale count rig=1 -a mvstudiopro");
  });

  it("机器在、但一台都起不来：也打回，错误里点名具体机器 ID", async () => {
    const { deps, failedReasons } = makeDeps({
      queuedBlenderJobs: async () => 1,
      startMachine: async () => {
        throw new Error("fly 500");
      },
    });
    const out = await ensureRigStartedForPending(deps, { lastAttemptAt: 0 });
    expect(out.action).toBe("error");
    expect(failedReasons[0]).toContain("fly machine start rig-1 -a mvstudiopro");
  });

  it("反例对照：机器只是停着（正常状态）不许当成没有，要去启动它、不许打回任务", async () => {
    const { deps, started, failedReasons } = makeDeps({ queuedBlenderJobs: async () => 1 });
    expect((await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).action).toBe("started");
    expect(started).toEqual(["rig-1"]);
    expect(failedReasons).toEqual([]);
  });

  it("反例对照：列举 Machines API 失败时不打回（查不到 ≠ 没有机器）", async () => {
    const { deps, failedReasons } = makeDeps({
      queuedBlenderJobs: async () => 1,
      listRig: async () => {
        throw new Error("fly api down");
      },
    });
    expect((await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).action).toBe("error");
    expect(failedReasons).toEqual([]);
  });

  it("Fly API 报错不抛到 worker 循环", async () => {
    const { deps } = makeDeps({
      queuedBlenderJobs: async () => 1,
      listRig: async () => {
        throw new Error("boom");
      },
    });
    const out = await ensureRigStartedForPending(deps, { lastAttemptAt: 0 });
    expect(out.action).toBe("error");
  });
});

describe("rig 空闲停机（rig 机自己）", () => {
  it("本进程在跑任务时绝不停机，并刷新忙碌时间", async () => {
    const { deps, stopped, at } = makeDeps();
    const state = { lastBusyAt: 0 };
    expect(await maybeStopIdleRig(deps, state, true)).toEqual({ action: "busy" });
    expect(state.lastBusyAt).toBe(at());
    expect(stopped).toEqual([]);
  });

  it("队列里还有 Blender 任务时不停机（反例：只看本进程会误停）", async () => {
    const { deps, stopped } = makeDeps({ pendingBlenderJobs: async () => 1 });
    const state = { lastBusyAt: 0 };
    expect(await maybeStopIdleRig(deps, state, false)).toEqual({ action: "busy" });
    expect(stopped).toEqual([]);
  });

  it("空闲未到阈值只等待", async () => {
    const { deps, stopped, at } = makeDeps();
    const out = await maybeStopIdleRig(deps, { lastBusyAt: at() - 60_000 }, false);
    expect(out).toEqual({ action: "waiting", idleMs: 60_000 });
    expect(stopped).toEqual([]);
  });

  it("空闲超过阈值停掉自己这台，且只停自己", async () => {
    const { deps, stopped, at } = makeDeps({
      listRig: async () => [
        { id: "rig-1", state: "started", processGroup: "rig" },
        { id: "rig-2", state: "started", processGroup: "rig" },
      ],
    });
    const out = await maybeStopIdleRig(deps, { lastBusyAt: at() - DEFAULT_RIG_IDLE_STOP_MS - 1 }, false);
    expect(out).toEqual({ action: "stopped", machineId: "rig-1" });
    expect(stopped).toEqual(["rig-1"]);
  });

  it("停机命令发出之前先关本进程领单闸（审查 P1：否则停机窗口内还会领到一单被 SIGINT 打断）", async () => {
    const { deps, calls, at } = makeDeps();
    const out = await maybeStopIdleRig(deps, { lastBusyAt: at() - DEFAULT_RIG_IDLE_STOP_MS - 1 }, false);
    expect(out.action).toBe("stopped");
    expect(calls).toEqual(["gate_closed", "stop:rig-1"]);
  });

  it("关闸后本进程刚领到一单（停机窗口竞态）：撤回停机，绝不发 stop", async () => {
    // 反例对照：把 busy 当成快照 boolean 传进去，这条就是漏的那个洞。
    let busy = false;
    const { deps, stopped, calls, at } = makeDeps({
      onStopDecided: () => {
        calls.push("gate_closed");
        // 模拟：闸关上的同一刻，1 秒一轮的 post_prod 通道已经在上一次 await 期间领到了单
        busy = true;
      },
    });
    const state = { lastBusyAt: at() - DEFAULT_RIG_IDLE_STOP_MS - 1 };
    const out = await maybeStopIdleRig(deps, state, () => busy);
    expect(out).toEqual({ action: "busy" });
    expect(stopped).toEqual([]);
    expect(calls).toEqual(["gate_closed", "gate_reopened"]);
    expect(state.lastBusyAt).toBe(at());
  });

  it("正例：关闸后仍然空闲就照常停机（证明上一条不是把停机整个关掉了）", async () => {
    const { deps, stopped, calls, at } = makeDeps();
    const out = await maybeStopIdleRig(deps, { lastBusyAt: at() - DEFAULT_RIG_IDLE_STOP_MS - 1 }, () => false);
    expect(out.action).toBe("stopped");
    expect(stopped).toEqual(["rig-1"]);
    expect(calls).toEqual(["gate_closed", "stop:rig-1"]);
  });

  it("停机失败时把闸打开，机器继续领单，不变成活着却不干活的空转机", async () => {
    const { deps, calls, at } = makeDeps({
      stopMachine: async () => {
        throw new Error("fly 502");
      },
    });
    const out = await maybeStopIdleRig(deps, { lastBusyAt: at() - DEFAULT_RIG_IDLE_STOP_MS - 1 }, false);
    expect(out.action).toBe("error");
    expect(calls).toEqual(["gate_closed", "gate_reopened"]);
  });

  it("本机不在 rig 进程组里就拒绝停机（停错＝把 app 机停掉，站点下线）", async () => {
    const { deps, stopped, calls, at } = makeDeps({
      selfMachineId: "app-1",
      listRig: async () => [{ id: "rig-1", state: "started", processGroup: "rig" }],
    });
    const out = await maybeStopIdleRig(deps, { lastBusyAt: at() - DEFAULT_RIG_IDLE_STOP_MS - 1 }, false);
    expect(out.action).toBe("error");
    expect(stopped).toEqual([]);
    // 进程组核对在关闸之前：拒绝停机的那一轮不该把本机的领单闸关掉
    expect(calls).toEqual([]);
  });

  it("查不到队列时按「忙」处理，宁可多开不误停", async () => {
    const { deps, stopped, at } = makeDeps({
      pendingBlenderJobs: async () => {
        throw new Error("db down");
      },
    });
    const state = { lastBusyAt: at() - DEFAULT_RIG_IDLE_STOP_MS - 1 };
    const out = await maybeStopIdleRig(deps, state, false);
    expect(out.action).toBe("error");
    expect(stopped).toEqual([]);
    expect(state.lastBusyAt).toBe(at());
  });

  it("没有机器 ID（本机/CI）或阈值为 0 时整段关闭", async () => {
    const { deps: noId, stopped: s1 } = makeDeps({ selfMachineId: "" });
    expect(await maybeStopIdleRig(noId, { lastBusyAt: 0 }, false)).toEqual({ action: "disabled" });
    expect(s1).toEqual([]);
    const { deps: noIdle, stopped: s2 } = makeDeps({ idleStopMs: 0 });
    expect(await maybeStopIdleRig(noIdle, { lastBusyAt: 0 }, false)).toEqual({ action: "disabled" });
    expect(s2).toEqual([]);
  });
});

describe("配置与安全边界", () => {
  it("没有 FLY_API_TOKEN / FLY_APP_NAME 时整条链 no-op（关闭式失败，不回落本机）", () => {
    expect(resolveFlyMachinesConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveFlyMachinesConfig({ FLY_API_TOKEN: "t" } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveFlyMachinesConfig({ FLY_APP_NAME: "a" } as NodeJS.ProcessEnv)).toBeNull();
    const counters = { queuedBlenderJobs: async () => 1, pendingBlenderJobs: async () => 1 };
    expect(resolveRigAutoscaleDeps(counters, {}, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      resolveRigAutoscaleDeps(counters, {}, {
        FLY_API_TOKEN: "t",
        FLY_APP_NAME: "a",
        MANHUA_RIG_AUTOSCALE: "0",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("总开关默认开，阈值可调但有下限，<=0 表示关闭", () => {
    expect(rigAutoscaleEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(resolveRigIdleStopMs({} as NodeJS.ProcessEnv)).toBe(DEFAULT_RIG_IDLE_STOP_MS);
    expect(resolveRigIdleStopMs({ MANHUA_RIG_IDLE_STOP_MS: "1000" } as NodeJS.ProcessEnv)).toBe(60_000);
    expect(resolveRigIdleStopMs({ MANHUA_RIG_IDLE_STOP_MS: "1800000" } as NodeJS.ProcessEnv)).toBe(1_800_000);
    expect(resolveRigIdleStopMs({ MANHUA_RIG_IDLE_STOP_MS: "0" } as NodeJS.ProcessEnv)).toBe(0);
    // 空串＝没设（secret 设过又清空），必须走默认值而不是静默关掉停机
    expect(resolveRigIdleStopMs({ MANHUA_RIG_IDLE_STOP_MS: "" } as NodeJS.ProcessEnv)).toBe(DEFAULT_RIG_IDLE_STOP_MS);
    expect(resolveRigIdleStopMs({ MANHUA_RIG_IDLE_STOP_MS: "  " } as NodeJS.ProcessEnv)).toBe(DEFAULT_RIG_IDLE_STOP_MS);
  });

  it("只有停着的机器需要启动", () => {
    expect(needsStart("stopped")).toBe(true);
    expect(needsStart("suspended")).toBe(true);
    expect(needsStart("created")).toBe(true);
    expect(needsStart("started")).toBe(false);
    expect(needsStart("starting")).toBe(false);
    expect(needsStart("replacing")).toBe(false);
  });

  it("listRigMachines 只返回 rig 进程组，app 机不在候选里", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { id: "app-1", state: "started", config: { metadata: { fly_process_group: "app" } } },
          { id: "rig-1", state: "stopped", config: { metadata: { fly_process_group: "rig" } } },
          { id: "orphan", state: "started", config: {} },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const machines = await listRigMachines({ appName: "mvstudiopro", token: "test-key", baseUrl: "https://api.machines.dev/v1" });
      expect(machines.map((m) => m.id)).toEqual(["rig-1"]);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.machines.dev/v1/apps/mvstudiopro/machines");
      expect(init.method).toBe("GET");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
