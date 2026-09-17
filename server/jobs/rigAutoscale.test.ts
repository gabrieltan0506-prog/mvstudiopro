import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RIG_IDLE_STOP_MS,
  RIG_START_COOLDOWN_MS,
  RIG_UNAVAILABLE_CONFIRM_MS,
  ensureRigStartedForPending,
  maybeStopIdleRig,
  resolveRigAutoscaleDeps,
  resolveRigIdleStopMs,
  rigAutoscaleEnabled,
  type RigAutoscaleDeps,
  type RigStartState,
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

  it("一台 rig 机都没有：连续确认够久才打回，错误里带可执行的命令和用户向的说明", async () => {
    const { deps, started, failedReasons, advance } = makeDeps({ queuedBlenderJobs: async () => 1, listRig: async () => [] });
    const state = { lastAttemptAt: 0 };
    // 第一轮只记录，不打回（部署窗口内零台 rig 是暂态）
    expect(await ensureRigStartedForPending(deps, state)).toEqual({ action: "no_machine_pending", unavailableMs: 0 });
    expect(failedReasons).toEqual([]);
    advance(RIG_UNAVAILABLE_CONFIRM_MS + 1);
    expect(await ensureRigStartedForPending(deps, state)).toEqual({ action: "no_machine" });
    expect(started).toEqual([]);
    expect(failedReasons).toHaveLength(1);
    expect(failedReasons[0]).toContain("Blender 后期机不存在或不可唤醒");
    expect(failedReasons[0]).toContain("不是你的参数或配置问题");
    expect(failedReasons[0]).toContain("重新提交");
    expect(failedReasons[0]).toContain("fly scale count rig=1 -a mvstudiopro");
  });

  it("反例对照：确认窗口内（含刚好等于窗口前一刻）一个任务都不许打回", async () => {
    const { deps, failedReasons, advance } = makeDeps({ queuedBlenderJobs: async () => 1, listRig: async () => [] });
    const state = { lastAttemptAt: 0 };
    await ensureRigStartedForPending(deps, state);
    advance(RIG_UNAVAILABLE_CONFIRM_MS - 1);
    const out = await ensureRigStartedForPending(deps, state);
    expect(out.action).toBe("no_machine_pending");
    expect(failedReasons).toEqual([]);
  });

  it("rig 机在确认窗口内恢复（部署做完了）：计时复位，绝不打回", async () => {
    let machines: { id: string; state: string; processGroup: string }[] = [];
    const { deps, started, failedReasons, advance } = makeDeps({
      queuedBlenderJobs: async () => 1,
      listRig: async () => machines,
    });
    const state: RigStartState = { lastAttemptAt: 0 };
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("no_machine_pending");
    machines = [{ id: "rig-1", state: "stopped", processGroup: "rig" }];
    advance(20_000);
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("started");
    expect(state.unavailableSince).toBeUndefined();
    // 再次消失也要重新从零计时，不能沿用上一次的时间戳直接打回
    machines = [];
    advance(RIG_UNAVAILABLE_CONFIRM_MS + 1);
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("no_machine_pending");
    expect(failedReasons).toEqual([]);
    expect(started).toEqual(["rig-1"]);
  });

  it("机器在、但一台都起不来：连续确认后才打回，错误里点名具体机器 ID", async () => {
    const { deps, failedReasons, advance } = makeDeps({
      queuedBlenderJobs: async () => 1,
      startMachine: async () => {
        throw new Error("fly 500");
      },
    });
    const state = { lastAttemptAt: 0 };
    // 反例对照：偶发一次 5xx（部署/容量调度）不许清空队列
    const first = await ensureRigStartedForPending(deps, state);
    expect(first.action).toBe("error");
    expect(failedReasons).toEqual([]);
    advance(RIG_UNAVAILABLE_CONFIRM_MS + 1);
    const out = await ensureRigStartedForPending(deps, state);
    expect(out.action).toBe("error");
    expect(failedReasons).toHaveLength(1);
    expect(failedReasons[0]).toContain("fly machine start rig-1 -a mvstudiopro");
  });

  it("多台 rig：1 单排队只唤醒 1 台，剩下的停着的不动（第四轮：多唤醒的那几台在这单跑完前停不掉）", async () => {
    const { deps, started } = makeDeps({
      queuedBlenderJobs: async () => 1,
      listRig: async () => [
        { id: "rig-1", state: "stopped", processGroup: "rig" },
        { id: "rig-2", state: "stopped", processGroup: "rig" },
        { id: "rig-3", state: "stopped", processGroup: "rig" },
      ],
    });
    expect(await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).toEqual({ action: "started", machineIds: ["rig-1"] });
    expect(started).toEqual(["rig-1"]);
  });

  it("多台 rig：2 单排队唤醒 2 台（反例对照：上一条不是把多机唤醒整个关死）", async () => {
    const { deps, started } = makeDeps({
      queuedBlenderJobs: async () => 2,
      listRig: async () => [
        { id: "rig-1", state: "stopped", processGroup: "rig" },
        { id: "rig-2", state: "stopped", processGroup: "rig" },
        { id: "rig-3", state: "stopped", processGroup: "rig" },
      ],
    });
    expect((await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).action).toBe("started");
    expect(started).toEqual(["rig-1", "rig-2"]);
  });

  it("多台 rig：起不来的那台不占名额，要继续试下一台（否则一台坏机就把任务推到打回分支）", async () => {
    const attempted: string[] = [];
    const { deps, started, failedReasons } = makeDeps({
      queuedBlenderJobs: async () => 1,
      listRig: async () => [
        { id: "rig-bad", state: "stopped", processGroup: "rig" },
        { id: "rig-ok", state: "stopped", processGroup: "rig" },
        { id: "rig-3", state: "stopped", processGroup: "rig" },
      ],
      startMachine: async (id) => {
        attempted.push(id);
        if (id === "rig-bad") throw new Error("fly 500");
        started.push(id);
      },
    });
    expect(await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).toEqual({ action: "started", machineIds: ["rig-ok"] });
    expect(attempted).toEqual(["rig-bad", "rig-ok"]);
    expect(started).toEqual(["rig-ok"]);
    expect(failedReasons).toEqual([]);
  });

  it("打回之后确认窗口重新计时：刚入队的任务不被连坐秒杀（第四轮）", async () => {
    const { deps, failedReasons, advance } = makeDeps({ queuedBlenderJobs: async () => 1, listRig: async () => [] });
    const state: RigStartState = { lastAttemptAt: 0 };
    await ensureRigStartedForPending(deps, state);
    advance(RIG_UNAVAILABLE_CONFIRM_MS + 1);
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("no_machine");
    expect(failedReasons).toHaveLength(1);
    // 打回后紧接着又有人提交（队列仍 >0）：下一个 tick 不许直接再打回
    advance(15_000);
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("no_machine_pending");
    expect(failedReasons).toHaveLength(1);
    // 正例对照：新的一整个窗口走满之后照样打回，不是把打回关掉了
    advance(RIG_UNAVAILABLE_CONFIRM_MS + 1);
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("no_machine");
    expect(failedReasons).toHaveLength(2);
  });

  it("反例对照：机器只是停着（正常状态）不许当成没有，要去启动它、不许打回任务", async () => {
    const { deps, started, failedReasons } = makeDeps({ queuedBlenderJobs: async () => 1 });
    expect((await ensureRigStartedForPending(deps, { lastAttemptAt: 0 })).action).toBe("started");
    expect(started).toEqual(["rig-1"]);
    expect(failedReasons).toEqual([]);
  });

  it("反例对照：列举 Machines API 失败时不打回（查不到 ≠ 没有机器），且复位确认计时", async () => {
    let down = false;
    const { deps, failedReasons, advance } = makeDeps({
      queuedBlenderJobs: async () => 1,
      listRig: async () => {
        if (down) throw new Error("fly api down");
        return [];
      },
    });
    const state: RigStartState = { lastAttemptAt: 0 };
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("no_machine_pending");
    down = true;
    advance(1_000);
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("error");
    expect(state.unavailableSince).toBeUndefined();
    // API 恢复后必须重新从零确认，不能拿故障期间流逝的时间凑满窗口直接打回
    down = false;
    advance(RIG_UNAVAILABLE_CONFIRM_MS + 1);
    expect((await ensureRigStartedForPending(deps, state)).action).toBe("no_machine_pending");
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

  it("列举返回的不是数组（200 带错误体／空体／代理 HTML）必须抛，不许当成「没有机器」", async () => {
    const cfg = { appName: "mvstudiopro", token: "test-key", baseUrl: "https://api.machines.dev/v1" };
    for (const body of ['{"error":"unauthorized"}', "", "<html>502</html>"]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
      try {
        await expect(listRigMachines(cfg)).rejects.toThrow(/不是机器数组/);
      } finally {
        vi.unstubAllGlobals();
      }
    }
    // 正例对照：真的是空数组（应用里一台机器都没有）仍然正常返回 []，不是一抛了之
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    try {
      await expect(listRigMachines(cfg)).resolves.toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
