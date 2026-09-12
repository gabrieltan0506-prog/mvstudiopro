import { describe, expect, it } from "vitest";
import {
  MANHUA_LEARN_ACTIVE_BASE_MS,
  MANHUA_LEARN_ACTIVE_MAX_MS,
  MANHUA_LEARN_HIDDEN_ACTIVE_MS,
  MANHUA_LEARN_HIDDEN_IDLE_MS,
  MANHUA_LEARN_IDLE_BASE_MS,
  MANHUA_LEARN_IDLE_MAX_MS,
  MANHUA_LEARN_SYNC_INITIAL,
  type ManhuaLearnSyncState,
  manhuaLearnSnapshotIntervalMs,
  manhuaLearnSyncDelayMs,
  nextManhuaLearnSyncState,
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
