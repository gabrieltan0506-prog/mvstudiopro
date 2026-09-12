import { describe, expect, it } from "vitest";
import {
  MANHUA_LEARN_ACTIVE_BASE_MS,
  MANHUA_LEARN_ACTIVE_MAX_MS,
  MANHUA_LEARN_HIDDEN_ACTIVE_MS,
  MANHUA_LEARN_HIDDEN_IDLE_MS,
  MANHUA_LEARN_IDLE_BASE_MS,
  MANHUA_LEARN_IDLE_MAX_MS,
  MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL,
  MANHUA_LEARN_SNAPSHOT_WAKE_SENTINEL,
  MANHUA_LEARN_SYNC_INITIAL,
  type ManhuaLearnSyncState,
  manhuaLearnSnapshotIntervalMs,
  manhuaLearnSyncDelayMs,
  nextManhuaLearnSyncState,
  resolveManhuaLearnSnapshotRefetch,
  resolveManhuaLearnSnapshotSchedule,
} from "./manhuaLearnPollSchedule";

const noJitter = () => 0;
const maxJitter = () => 1;

describe("manhuaLearnSyncDelayMs", () => {
  it("首段不抖动：刚进档位那一轮就是基准值，不会被抖得比改前更密", () => {
    expect(manhuaLearnSyncDelayMs({ tier: "active", rounds: 0, hidden: false, random: maxJitter }))
      .toBe(MANHUA_LEARN_ACTIVE_BASE_MS);
    expect(manhuaLearnSyncDelayMs({ tier: "idle", rounds: 0, hidden: false, random: maxJitter }))
      .toBe(MANHUA_LEARN_IDLE_BASE_MS);
  });

  it("抖动只向上，永不低于名义间隔", () => {
    for (let rounds = 1; rounds <= 8; rounds += 1) {
      const plain = manhuaLearnSyncDelayMs({ tier: "active", rounds, hidden: false, random: noJitter });
      const jittered = manhuaLearnSyncDelayMs({ tier: "active", rounds, hidden: false, random: maxJitter });
      expect(jittered).toBeGreaterThanOrEqual(plain);
      expect(plain).toBeGreaterThanOrEqual(MANHUA_LEARN_ACTIVE_BASE_MS);
    }
  });

  it("活跃档逐轮拉长并在 30 秒封顶", () => {
    const first = manhuaLearnSyncDelayMs({ tier: "active", rounds: 0, hidden: false, random: noJitter });
    const later = manhuaLearnSyncDelayMs({ tier: "active", rounds: 3, hidden: false, random: noJitter });
    expect(later).toBeGreaterThan(first);
    for (let rounds = 0; rounds <= 40; rounds += 1) {
      const v = manhuaLearnSyncDelayMs({ tier: "active", rounds, hidden: false, random: maxJitter });
      expect(v).toBeLessThanOrEqual(Math.round(MANHUA_LEARN_ACTIVE_MAX_MS * 1.25));
      expect(manhuaLearnSyncDelayMs({ tier: "active", rounds, hidden: false, random: noJitter }))
        .toBeLessThanOrEqual(MANHUA_LEARN_ACTIVE_MAX_MS);
    }
  });

  it("空闲档 15 秒起、60 秒封顶", () => {
    expect(manhuaLearnSyncDelayMs({ tier: "idle", rounds: 0, hidden: false, random: noJitter }))
      .toBe(MANHUA_LEARN_IDLE_BASE_MS);
    expect(manhuaLearnSyncDelayMs({ tier: "idle", rounds: 30, hidden: false, random: noJitter }))
      .toBe(MANHUA_LEARN_IDLE_MAX_MS);
  });

  it("后台是下限不是上限：前台已经退得更久时不会被拉回来", () => {
    expect(manhuaLearnSyncDelayMs({ tier: "active", rounds: 0, hidden: true, random: noJitter }))
      .toBe(MANHUA_LEARN_HIDDEN_ACTIVE_MS);
    expect(manhuaLearnSyncDelayMs({ tier: "idle", rounds: 0, hidden: true, random: noJitter }))
      .toBe(MANHUA_LEARN_HIDDEN_IDLE_MS);
    const longIdle = manhuaLearnSyncDelayMs({ tier: "idle", rounds: 99, hidden: true, random: maxJitter });
    expect(longIdle).toBeGreaterThanOrEqual(MANHUA_LEARN_HIDDEN_IDLE_MS);
  });
});

describe("nextManhuaLearnSyncState", () => {
  it("请求失败不清零轮次——被质询时正是最该退让的时刻", () => {
    let state: ManhuaLearnSyncState = { tier: "idle", rounds: 5 };
    state = nextManhuaLearnSyncState(state, { ok: false });
    expect(state).toEqual({ tier: "idle", rounds: 6 });
    state = nextManhuaLearnSyncState(state, { ok: false });
    expect(state.rounds).toBe(7);
    expect(manhuaLearnSyncDelayMs({ ...state, hidden: false, random: noJitter }))
      .toBe(MANHUA_LEARN_IDLE_MAX_MS);
  });

  it("档位切换时轮次归零：任务一起跑就回到 3 秒", () => {
    const idleLong = { tier: "idle" as const, rounds: 20 };
    const started = nextManhuaLearnSyncState(idleLong, { ok: true, hasActive: true });
    expect(started).toEqual({ tier: "active", rounds: 0 });
    expect(manhuaLearnSyncDelayMs({ ...started, hidden: false, random: maxJitter }))
      .toBe(MANHUA_LEARN_ACTIVE_BASE_MS);
  });

  it("同档位持续则轮次累加", () => {
    let state: ManhuaLearnSyncState = MANHUA_LEARN_SYNC_INITIAL;
    state = nextManhuaLearnSyncState(state, { ok: true, hasActive: false });
    state = nextManhuaLearnSyncState(state, { ok: true, hasActive: false });
    expect(state).toEqual({ tier: "idle", rounds: 2 });
  });

  it("任务跑完回到空闲档，轮次归零而不是继承活跃档的退避", () => {
    const activeLong = { tier: "active" as const, rounds: 12 };
    expect(nextManhuaLearnSyncState(activeLong, { ok: true, hasActive: false }))
      .toEqual({ tier: "idle", rounds: 0 });
  });
});

describe("manhuaLearnSnapshotIntervalMs", () => {
  it("对同一状态返回稳定值（含随机数会让 react-query 每 render 重建定时器并静默停更）", () => {
    for (let n = 0; n <= 10; n += 1) {
      expect(manhuaLearnSnapshotIntervalMs(n)).toBe(manhuaLearnSnapshotIntervalMs(n));
    }
  });

  it("15 秒起、60 秒封顶，且随更新次数拉长", () => {
    expect(manhuaLearnSnapshotIntervalMs(0)).toBe(MANHUA_LEARN_IDLE_BASE_MS);
    expect(manhuaLearnSnapshotIntervalMs(3)).toBeGreaterThan(MANHUA_LEARN_IDLE_BASE_MS);
    expect(manhuaLearnSnapshotIntervalMs(50)).toBe(MANHUA_LEARN_IDLE_MAX_MS);
  });

});

describe("请求量（纯函数推算，非线上）", () => {
  const countCalls = (windowMs: number, tier: "active" | "idle") => {
    let state = { tier, rounds: 0 } as { tier: "active" | "idle"; rounds: number };
    let elapsed = 0;
    let calls = 0;
    while (elapsed < windowMs) {
      calls += 1;
      elapsed += manhuaLearnSyncDelayMs({ ...state, hidden: false, random: () => 0.5 });
      state = nextManhuaLearnSyncState(state, { ok: true, hasActive: tier === "active" });
    }
    return calls;
  };

  // 注意：这一格只描述「列表停滞时」的退避曲线，**不是线上活跃任务的请求量**。
  // 线上任务持续推进时服务端每次写进度都会更新 updatedAt，列表指纹随之变化，
  // 轮次每轮归零，活跃档实际钉在 3 秒。真实数字要等线上跑一次从防火墙 Traffic 页取。
  it("活跃档在列表停滞时会退避（非线上口径）", () => {
    const stalled = countCalls(4 * 60 * 60_000, "active");
    expect(stalled).toBeLessThan(600);
    // 反过来钉住：一直有进展时它就该保持最密档，不许被退避拖慢
    let state: ManhuaLearnSyncState = { tier: "active", rounds: 0 };
    for (let i = 0; i < 50; i += 1) {
      state = nextManhuaLearnSyncState(state, { ok: true, hasActive: true, changed: true });
      expect(manhuaLearnSyncDelayMs({ ...state, hidden: false, random: maxJitter }))
        .toBe(MANHUA_LEARN_ACTIVE_BASE_MS);
    }
  });

  it("空闲档：面板空开一天从 5760 次降到 1600 次以内（这一半才是堵住 1.7k/天的）", () => {
    expect(countCalls(24 * 60 * 60_000, "idle")).toBeLessThan(1600);
  });
});

describe("resolveManhuaLearnSnapshotSchedule", () => {
  const run = (over: Partial<Parameters<typeof resolveManhuaLearnSnapshotSchedule>[0]> = {}) =>
    resolveManhuaLearnSnapshotSchedule({
      prev: MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL,
      seriesKey: "剧A",
      updateCount: 0,
      active: true,
      ...over,
    });

  it("换剧时基线跟着换归属，不拿上一部剧的基线去减这一部的计数", () => {
    // 剧A 已经退到很后面；切到剧B 时它自己的缓存条目计数是 40
    const prev = { seriesKey: "剧A", baseline: 3 };
    const { next, intervalMs } = run({ prev, seriesKey: "剧B", updateCount: 40 });
    expect(next).toEqual({ seriesKey: "剧B", baseline: 40 });
    // 不换归属的话 rounds 会是 37，直接跳 60 秒封顶
    expect(intervalMs).toBe(MANHUA_LEARN_IDLE_BASE_MS);
  });

  it("同一部剧内按差值退避", () => {
    const prev = { seriesKey: "剧A", baseline: 10 };
    expect(run({ prev, updateCount: 10, seriesKey: "剧A" }).intervalMs)
      .toBe(MANHUA_LEARN_IDLE_BASE_MS);
    expect(run({ prev, updateCount: 13, seriesKey: "剧A" }).intervalMs)
      .toBeGreaterThan(MANHUA_LEARN_IDLE_BASE_MS);
    expect(run({ prev, updateCount: 60, seriesKey: "剧A" }).intervalMs)
      .toBe(MANHUA_LEARN_IDLE_MAX_MS);
  });

  it("没有活跃任务时不轮询，并把基线归到当前计数", () => {
    const { next, intervalMs } = run({
      prev: { seriesKey: "剧A", baseline: 2 },
      updateCount: 9,
      active: false,
    });
    expect(intervalMs).toBe(false);
    expect(next).toEqual({ seriesKey: "剧A", baseline: 9 });
  });

  it("唤醒哨兵让它从 15 秒重新起退", () => {
    const prev = { seriesKey: "剧A", baseline: MANHUA_LEARN_SNAPSHOT_WAKE_SENTINEL };
    const { next, intervalMs } = run({ prev, updateCount: 27 });
    expect(next).toEqual({ seriesKey: "剧A", baseline: 27 });
    expect(intervalMs).toBe(MANHUA_LEARN_IDLE_BASE_MS);
  });

  it("对同一组入参稳定——值一变 react-query 就重建定时器", () => {
    const prev = { seriesKey: "剧A", baseline: 4 };
    const a = run({ prev, updateCount: 7 });
    const b = run({ prev: a.next, updateCount: 7 });
    expect(b.intervalMs).toBe(a.intervalMs);
    expect(b.next).toEqual(a.next);
  });

  it("换剧那一次收敛后，紧接着的调用返回同一个值（没有先错后对的中间态）", () => {
    const first = run({ prev: { seriesKey: "剧A", baseline: 3 }, seriesKey: "剧B", updateCount: 40 });
    const second = run({ prev: first.next, seriesKey: "剧B", updateCount: 40 });
    expect(second.intervalMs).toBe(first.intervalMs);
  });
});

describe("模块级初值必须冻结", () => {
  it("就地改共享初值会当场抛错，而不是静默污染此后所有实例", () => {
    expect(Object.isFrozen(MANHUA_LEARN_SYNC_INITIAL)).toBe(true);
    expect(Object.isFrozen(MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL)).toBe(true);
    expect(() => {
      (MANHUA_LEARN_SYNC_INITIAL as { rounds: number }).rounds = 99;
    }).toThrow();
    expect(() => {
      (MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL as { baseline: number }).baseline = 99;
    }).toThrow();
  });

  it("正常路径仍然只产出新对象，不动初值", () => {
    const after = nextManhuaLearnSyncState(MANHUA_LEARN_SYNC_INITIAL, { ok: true, hasActive: true });
    expect(after).not.toBe(MANHUA_LEARN_SYNC_INITIAL);
    expect(MANHUA_LEARN_SYNC_INITIAL).toEqual({ tier: "idle", rounds: 0 });
    const { next } = resolveManhuaLearnSnapshotSchedule({
      prev: MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL,
      seriesKey: "剧A",
      updateCount: 5,
      active: true,
    });
    expect(next).not.toBe(MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL);
    expect(MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL).toEqual({ seriesKey: "", baseline: 0 });
  });
});

describe("列表真的变了就回到最密档", () => {
  it("任务跑着且有新进展时保持 3 秒，不会一路退到 30 秒", () => {
    let state: ManhuaLearnSyncState = { tier: "active", rounds: 9 };
    expect(manhuaLearnSyncDelayMs({ ...state, hidden: false, random: noJitter }))
      .toBe(MANHUA_LEARN_ACTIVE_MAX_MS);
    state = nextManhuaLearnSyncState(state, { ok: true, hasActive: true, changed: true });
    expect(state).toEqual({ tier: "active", rounds: 0 });
    expect(manhuaLearnSyncDelayMs({ ...state, hidden: false, random: maxJitter }))
      .toBe(MANHUA_LEARN_ACTIVE_BASE_MS);
  });

  it("没有新进展才退避——停滞时用户本来就感知不到延迟", () => {
    let state: ManhuaLearnSyncState = { tier: "active", rounds: 0 };
    state = nextManhuaLearnSyncState(state, { ok: true, hasActive: true, changed: false });
    expect(state.rounds).toBe(1);
    state = nextManhuaLearnSyncState(state, { ok: true, hasActive: true });
    expect(state.rounds).toBe(2);
  });

  it("失败仍然不清零：即使这一轮被当成「有变化」也不行", () => {
    const state = nextManhuaLearnSyncState({ tier: "idle", rounds: 4 }, { ok: false, changed: true });
    expect(state).toEqual({ tier: "idle", rounds: 5 });
  });
});

describe("快照退避要把失败也算进轮次", () => {
  // 这里测的是**直接喂给 refetchInterval 的那个函数**，不是喂字面量的纯函数——
  // 否则「调用点只传了 dataUpdateCount」这种回退不会让任何测试变红。
  it("被质询时只数成功会让退避永远不启动：成功 0 次、失败 6 次也必须已经退到封顶", () => {
    const { intervalMs } = resolveManhuaLearnSnapshotRefetch({
      prev: { seriesKey: "剧A", baseline: 0 },
      seriesKey: "剧A",
      active: true,
      queryState: { dataUpdateCount: 0, errorUpdateCount: 6 },
    });
    expect(intervalMs).toBe(MANHUA_LEARN_IDLE_MAX_MS);
  });

  it("成功与失败等价累加，不是只认其中一种", () => {
    const prev = { seriesKey: "剧A", baseline: 0 };
    const bySuccess = resolveManhuaLearnSnapshotRefetch({
      prev, seriesKey: "剧A", active: true,
      queryState: { dataUpdateCount: 4, errorUpdateCount: 0 },
    });
    const byError = resolveManhuaLearnSnapshotRefetch({
      prev, seriesKey: "剧A", active: true,
      queryState: { dataUpdateCount: 0, errorUpdateCount: 4 },
    });
    const mixed = resolveManhuaLearnSnapshotRefetch({
      prev, seriesKey: "剧A", active: true,
      queryState: { dataUpdateCount: 2, errorUpdateCount: 2 },
    });
    expect(byError.intervalMs).toBe(bySuccess.intervalMs);
    expect(mixed.intervalMs).toBe(bySuccess.intervalMs);
  });
});
