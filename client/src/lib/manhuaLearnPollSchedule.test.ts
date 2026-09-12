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

  it("后台至少 120 秒", () => {
    expect(manhuaLearnSnapshotIntervalMs(0, true)).toBe(MANHUA_LEARN_HIDDEN_IDLE_MS);
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

  it("四小时活跃任务从 4800 次降到 600 次以内", () => {
    expect(countCalls(4 * 60 * 60_000, "active")).toBeLessThan(600);
  });

  it("面板空开一天从 5760 次降到 1600 次以内", () => {
    expect(countCalls(24 * 60 * 60_000, "idle")).toBeLessThan(1600);
  });
});

describe("resolveManhuaLearnSnapshotSchedule", () => {
  const run = (over: Partial<Parameters<typeof resolveManhuaLearnSnapshotSchedule>[0]> = {}) =>
    resolveManhuaLearnSnapshotSchedule({
      prev: MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL,
      seriesKey: "剧A",
      dataUpdateCount: 0,
      active: true,
      hidden: false,
      ...over,
    });

  it("换剧时基线跟着换归属，不拿上一部剧的基线去减这一部的计数", () => {
    // 剧A 已经退到很后面；切到剧B 时它自己的缓存条目计数是 40
    const prev = { seriesKey: "剧A", baseline: 3 };
    const { next, intervalMs } = run({ prev, seriesKey: "剧B", dataUpdateCount: 40 });
    expect(next).toEqual({ seriesKey: "剧B", baseline: 40 });
    // 不换归属的话 rounds 会是 37，直接跳 60 秒封顶
    expect(intervalMs).toBe(MANHUA_LEARN_IDLE_BASE_MS);
  });

  it("同一部剧内按差值退避", () => {
    const prev = { seriesKey: "剧A", baseline: 10 };
    expect(run({ prev, dataUpdateCount: 10, seriesKey: "剧A" }).intervalMs)
      .toBe(MANHUA_LEARN_IDLE_BASE_MS);
    expect(run({ prev, dataUpdateCount: 13, seriesKey: "剧A" }).intervalMs)
      .toBeGreaterThan(MANHUA_LEARN_IDLE_BASE_MS);
    expect(run({ prev, dataUpdateCount: 60, seriesKey: "剧A" }).intervalMs)
      .toBe(MANHUA_LEARN_IDLE_MAX_MS);
  });

  it("没有活跃任务时不轮询，并把基线归到当前计数", () => {
    const { next, intervalMs } = run({
      prev: { seriesKey: "剧A", baseline: 2 },
      dataUpdateCount: 9,
      active: false,
    });
    expect(intervalMs).toBe(false);
    expect(next).toEqual({ seriesKey: "剧A", baseline: 9 });
  });

  it("唤醒哨兵让它从 15 秒重新起退", () => {
    const prev = { seriesKey: "剧A", baseline: MANHUA_LEARN_SNAPSHOT_WAKE_SENTINEL };
    const { next, intervalMs } = run({ prev, dataUpdateCount: 27 });
    expect(next).toEqual({ seriesKey: "剧A", baseline: 27 });
    expect(intervalMs).toBe(MANHUA_LEARN_IDLE_BASE_MS);
  });

  it("对同一组入参稳定——值一变 react-query 就重建定时器", () => {
    const prev = { seriesKey: "剧A", baseline: 4 };
    const a = run({ prev, dataUpdateCount: 7 });
    const b = run({ prev: a.next, dataUpdateCount: 7 });
    expect(b.intervalMs).toBe(a.intervalMs);
    expect(b.next).toEqual(a.next);
  });

  it("换剧那一次收敛后，紧接着的调用返回同一个值（没有先错后对的中间态）", () => {
    const first = run({ prev: { seriesKey: "剧A", baseline: 3 }, seriesKey: "剧B", dataUpdateCount: 40 });
    const second = run({ prev: first.next, seriesKey: "剧B", dataUpdateCount: 40 });
    expect(second.intervalMs).toBe(first.intervalMs);
  });
});
