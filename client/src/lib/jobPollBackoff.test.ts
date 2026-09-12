/**
 * 轮询节流回归（0912 事故后立）。
 *
 * 事故：漫剧学习任务一跑几小时，固定 2.5s→8s 两段式轮询一天打出 1.7k 次
 * `/api/jobs/manhua-learn`——同一路径、高频、规律，正是 Vercel 自动 DDoS 缓解眼里的机器流量。
 * 整站被发 JS 质询，接口拿回 HTML，前端 JSON.parse 失败报「算力紧张」。
 *
 * 这里钉住三件事：前段要快、后段要稀、后台标签页更稀；另外多标签不许齐发。
 */
import { describe, expect, it } from "vitest";
import { manhuaLearnSyncDelayMs, nextManhuaLearnSyncState, nextPollSpacingMs } from "./jobs";

const base = {
  interval: 2500,
  adaptiveAfter: 36,
  maxInterval: 30_000,
  backoffFactor: 1.35,
  hiddenInterval: 60_000,
  hidden: false,
  random: () => 0.5, // 抖动取中值，断言才稳定
};

describe("轮询间隔", () => {
  it("刚提交时保持起始间隔，反馈不能变慢", () => {
    for (const attempt of [1, 5, 20, 35]) {
      expect(nextPollSpacingMs({ ...base, attempt })).toBe(2500);
    }
  });

  it("过了阈值逐轮拉长，最终封顶在上限", () => {
    const at40 = nextPollSpacingMs({ ...base, attempt: 40 });
    const at50 = nextPollSpacingMs({ ...base, attempt: 50 });
    expect(at40).toBeGreaterThan(2500);
    expect(at50).toBeGreaterThan(at40);
    expect(nextPollSpacingMs({ ...base, attempt: 200 })).toBe(30_000);
  });

  it("后台标签页至少等 1 分钟：没人看的页面不该继续密集打接口", () => {
    // 后台档以 1 分钟为硬下限、只向上抖 0–30%（审查 P2-B）
    for (const attempt of [1, 200]) {
      const v = nextPollSpacingMs({ ...base, attempt, hidden: true });
      expect(v).toBeGreaterThanOrEqual(60_000);
      expect(v).toBeLessThanOrEqual(78_000);
    }
    expect(nextPollSpacingMs({ ...base, attempt: 200, hidden: true, random: () => 0 })).toBe(60_000);
  });

  it("退避段带抖动，多个标签页不会挤在同一刻齐发；首段不抖，不许比改前更密", () => {
    const lo = nextPollSpacingMs({ ...base, attempt: 200, random: () => 0 });
    expect(lo).toBe(Math.round(30_000 * 0.85));
    // 首段恒等于起始间隔：抖动会把 2.5s 压到 2.1s，那比改前还密
    for (const r of [0, 0.5, 1]) {
      expect(nextPollSpacingMs({ ...base, attempt: 3, random: () => r })).toBe(2500);
    }
  });

  it("backoffFactor=1 时退回固定间隔（老行为可复现）", () => {
    expect(nextPollSpacingMs({ ...base, attempt: 200, backoffFactor: 1 })).toBe(2500);
  });

  it("四小时长任务的实际请求数：旧口径近三千，新口径不到六百", () => {
    const FOUR_HOURS = 4 * 3600_000;
    // 旧口径手写，不拿被测函数自证（审查 P2-3）：前 35 轮 2.5s，之后固定 5s
    let beforeElapsed = 0;
    let before = 0;
    while (beforeElapsed < FOUR_HOURS) {
      before += 1;
      beforeElapsed += before >= 36 ? 5000 : 2500;
    }
    const after = (hidden: boolean) => {
      let elapsed = 0;
      let attempt = 0;
      while (elapsed < FOUR_HOURS) {
        attempt += 1;
        elapsed += nextPollSpacingMs({ ...base, attempt, hidden, maxInterval: 30_000 });
      }
      return attempt;
    };
    expect(before).toBeGreaterThan(2800);
    expect(before).toBeLessThan(3000);
    expect(after(false)).toBeLessThan(600);
    expect(after(true)).toBeLessThan(260);
  });

  it("退避阈值那一格也钉住（attempt === adaptiveAfter）", () => {
    expect(nextPollSpacingMs({ ...base, attempt: 35 })).toBe(2500);
    expect(nextPollSpacingMs({ ...base, attempt: 36 })).toBe(Math.round(2500 * 1.35));
  });

  it("上限小于起始间隔时按起始间隔兜底，不会算出更短的间隔", () => {
    expect(nextPollSpacingMs({ ...base, attempt: 200, maxInterval: 1000 })).toBe(2500);
  });

  it("前台抖动不越过上限；后台下限不被抖破（审查 P2-1 / P2-B）", () => {
    expect(nextPollSpacingMs({ ...base, attempt: 200, random: () => 1 })).toBe(30_000);
    expect(nextPollSpacingMs({ ...base, attempt: 200, hidden: true, random: () => 0 })).toBe(60_000);
    expect(nextPollSpacingMs({ ...base, attempt: 200, hidden: true, random: () => 1 })).toBe(78_000);
  });
});

describe("漫剧学习列表同步（0912 事故的真凶路径）", () => {
  const r = { random: () => 0.5 };
  const active = (attempt: number, hidden = false) =>
    manhuaLearnSyncDelayMs({ attempt, regime: "active", hidden, ...r });
  const idle = (attempt: number, hidden = false) =>
    manhuaLearnSyncDelayMs({ attempt, regime: "idle", hidden, ...r });

  it("活跃档：刚点下去仍是 3 秒，跑久了拉到 30 秒封顶", () => {
    for (const attempt of [1, 5, 19]) expect(active(attempt)).toBe(3000);
    expect(active(200)).toBe(30_000);
  });

  it("空闲档也退避：不再是恒定 15 秒（按量级推算，它才是 1.7k 的大头）", () => {
    expect(idle(1)).toBe(15_000);
    expect(idle(3)).toBe(15_000);
    expect(idle(4)).toBeGreaterThan(15_000);
    expect(idle(50)).toBe(60_000);
  });

  it("后台：活跃至少 1 分钟、空闲至少 2 分钟，且只向上抖不越过下限", () => {
    expect(active(200, true)).toBeGreaterThanOrEqual(60_000);
    expect(active(200, true)).toBeLessThanOrEqual(78_000);
    expect(idle(200, true)).toBeGreaterThanOrEqual(120_000);
    expect(manhuaLearnSyncDelayMs({ attempt: 200, regime: "active", hidden: true, random: () => 0 }))
      .toBe(60_000);
  });

  it("面板挂着不关一整天：空闲请求数从 5760 次降到 1500 以内", () => {
    const countIdle = (hidden: boolean) => {
      let elapsed = 0;
      let attempt = 0;
      while (elapsed < 24 * 3600_000) {
        attempt += 1;
        elapsed += idle(attempt, hidden);
      }
      return attempt;
    };
    expect(Math.floor((24 * 3600_000) / 15_000)).toBe(5760); // 旧口径：恒定 15 秒
    expect(countIdle(false)).toBeLessThan(1500);
    expect(countIdle(true)).toBeLessThan(750);
  });

  it("四小时学习任务：从 4800 次降到 600 以内，后台再降一半", () => {
    const count = (hidden: boolean) => {
      let elapsed = 0;
      let attempt = 0;
      while (elapsed < 4 * 3600_000) {
        attempt += 1;
        elapsed += active(attempt, hidden);
      }
      return attempt;
    };
    expect(Math.floor((4 * 3600_000) / 3000)).toBe(4800);
    expect(count(false)).toBeLessThan(600);
    expect(count(true)).toBeLessThan(260);
  });
});

describe("同步轮次推进：失败不许清零（审查 P1-B）", () => {
  it("请求失败沿用上一档并继续累加，间隔越拉越长", () => {
    const s1 = nextManhuaLearnSyncState({ attempt: 30, regime: "active", ok: false, hasActive: false });
    expect(s1).toEqual({ attempt: 31, regime: "active" });
    // 被质询时列表接口回的是 HTML、json() 抛错；这时候最不该回到 3 秒去撞墙
    expect(manhuaLearnSyncDelayMs({ ...s1, hidden: false, random: () => 0.5 })).toBe(30_000);
  });

  it("成功且确实空闲才换到空闲档，换档时轮次从 1 重新计", () => {
    expect(nextManhuaLearnSyncState({ attempt: 30, regime: "active", ok: true, hasActive: false }))
      .toEqual({ attempt: 1, regime: "idle" });
    expect(nextManhuaLearnSyncState({ attempt: 9, regime: "idle", ok: true, hasActive: true }))
      .toEqual({ attempt: 1, regime: "active" });
  });

  it("同档位内持续累加", () => {
    expect(nextManhuaLearnSyncState({ attempt: 5, regime: "active", ok: true, hasActive: true }))
      .toEqual({ attempt: 6, regime: "active" });
    expect(nextManhuaLearnSyncState({ attempt: 5, regime: "idle", ok: true, hasActive: false }))
      .toEqual({ attempt: 6, regime: "idle" });
  });
});

/**
 * 调度本身的回归（审查 P2-C / P2-F）。这次真正出问题的是 useEffect 里的调度，不是纯函数。
 *
 * 复刻必须与被测代码同构，否则测试比代码还弱（审查 P2-F 指出的原问题）：
 * 这里连 timer 句柄、clearTimeout 配对、finally 重排、以及 running 放在 finally 释放
 * 一并复刻，才能挡住「把重排挪进 try」「漏掉 timer=undefined 配对」这类回归。
 */
describe("同步调度：在途闸、失败语义与唤醒", () => {
  const makeScheduler = () => {
    let attempt = 0;
    let regime: "active" | "idle" = "idle";
    let running = false;
    let disposed = false;
    let timer: number | undefined;
    let timerSeq = 0;
    const scheduled: Array<{ id: number; fire: () => void }> = [];
    const calls: number[] = [];
    let pendingResolve: ((v: { ok: boolean; hasActive: boolean }) => void) | null = null;
    let pendingReject: ((e: unknown) => void) | null = null;

    const setTimer = (fn: () => void) => {
      timerSeq += 1;
      const id = timerSeq;
      scheduled.push({ id, fire: fn });
      return id;
    };
    const clearTimer = (id: number) => {
      const i = scheduled.findIndex((t) => t.id === id);
      if (i >= 0) scheduled.splice(i, 1);
    };

    const sync = async () => {
      if (running) return;
      running = true;
      let hasActive = false;
      let ok = false;
      calls.push(calls.length + 1);
      try {
        const r = await new Promise<{ ok: boolean; hasActive: boolean }>((resolve, reject) => {
          pendingResolve = resolve;
          pendingReject = reject;
        });
        hasActive = r.hasActive;
        ok = r.ok;
      } catch {
        /* 与真实代码一样吞掉并继续退避 */
      } finally {
        running = false;
        const next = nextManhuaLearnSyncState({ attempt, regime, ok, hasActive });
        attempt = next.attempt;
        regime = next.regime;
        if (!disposed) {
          if (timer !== undefined) clearTimer(timer);
          timer = setTimer(() => void sync());
        }
      }
    };
    const kick = () => {
      if (disposed) return;
      attempt = 0;
      regime = "idle";
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      void sync();
    };
    return {
      sync, kick, calls, scheduled,
      settle: (v: { ok: boolean; hasActive: boolean }) => { pendingResolve?.(v); pendingResolve = null; },
      reject: (e: unknown) => { pendingReject?.(e); pendingReject = null; },
      dispose: () => { disposed = true; },
      state: () => ({ attempt, regime, pendingTimers: scheduled.length }),
    };
  };
  const tick = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

  it("在途时切回前台/连点唤醒，不会分裂出第二条链，且链不会断", async () => {
    const s = makeScheduler();
    void s.sync();
    await tick();
    s.kick();
    s.kick();
    await tick();
    expect(s.calls).toHaveLength(1);
    s.settle({ ok: true, hasActive: true });
    await tick();
    // 在途那条的 finally 补上了重排：待发定时器恰好一个，链没断也没翻倍
    expect(s.state().pendingTimers).toBe(1);
  });

  it("入队唤醒：空闲稳态下立刻同步，而不是等满 60 秒", async () => {
    const s = makeScheduler();
    void s.sync();
    await tick();
    s.settle({ ok: true, hasActive: false });
    await tick();
    expect(s.state().regime).toBe("idle");
    s.kick(); // 相当于点了「开始学习」
    await tick();
    expect(s.calls).toHaveLength(2);
    expect(s.state().pendingTimers).toBe(0); // 旧的待发定时器被清掉，没有两条链
  });

  it("活跃档下连续失败：档位保持 active、轮次累加，间隔收敛到 30 秒", async () => {
    const s = makeScheduler();
    void s.sync();
    await tick();
    s.settle({ ok: true, hasActive: true });
    await tick();
    for (let i = 0; i < 30; i += 1) {
      s.scheduled.pop()?.fire();
      await tick();
      s.reject(new Error("质询页不是 JSON"));
      await tick();
    }
    const { attempt, regime } = s.state();
    expect(regime).toBe("active");
    expect(attempt).toBeGreaterThan(25);
    expect(manhuaLearnSyncDelayMs({ attempt, regime, hidden: false, random: () => 0.5 })).toBe(30_000);
  });

  it("卸载后不再重排，也不会把在途闸卡死", async () => {
    const s = makeScheduler();
    void s.sync();
    await tick();
    s.dispose();
    s.settle({ ok: true, hasActive: true });
    await tick();
    expect(s.state().pendingTimers).toBe(0);
    // 闸已释放：dispose 之后仍可被显式调用而不卡住（真实代码里由 disposed 挡住）
    void s.sync();
    await tick();
    expect(s.calls).toHaveLength(2);
  });
});

/**
 * 默认值口径（审查 P1-1）：hiddenIntervalMs 与 maxIntervalMs 一样，不给非零默认值。
 * 否则全仓三十多个没评估过的调用点在后台会被无差别放缓——实测危害是
 * `maxWaitMs: 60_000` 的调用点从约 24 次轮询压到 2 次，最坏整个流程超时作废。
 */
describe("默认值不许无差别改掉未评估的调用点", () => {
  it("不传 hiddenIntervalMs 时，后台行为与前台一致（默认 0）", () => {
    const noHidden = {
      attempt: 1, interval: 2500, adaptiveAfter: 36,
      maxInterval: 8000, backoffFactor: 1.35, hiddenInterval: 0,
      random: () => 0.5,
    };
    expect(nextPollSpacingMs({ ...noHidden, hidden: true })).toBe(2500);
    expect(nextPollSpacingMs({ ...noHidden, hidden: false })).toBe(2500);
  });

  it("60 秒预算的调用点在后台仍能轮询多次，而不是一次就判超时", () => {
    // 复刻 pollJobUntilTerminal 的钳位：睡眠不超过剩余预算，预算见底即收口
    const countPolls = (hiddenInterval: number) => {
      const maxWait = 60_000;
      let elapsed = 0;
      let attempt = 0;
      while (elapsed < maxWait) {
        attempt += 1;
        const spacing = nextPollSpacingMs({
          attempt, interval: 2500, adaptiveAfter: 36, maxInterval: 8000,
          backoffFactor: 1.35, hiddenInterval, hidden: true, random: () => 0.5,
        });
        const remaining = maxWait - elapsed;
        if (remaining <= 250) break;
        elapsed += Math.min(spacing, remaining - 250);
      }
      return attempt;
    };
    expect(countPolls(0)).toBeGreaterThan(20);   // 默认：与改前持平
    expect(countPolls(60_000)).toBeLessThan(4);  // 若给了非零默认值就是这个下场
  });

  it("后台下限不会被向上抖动之外的路径打破（审查 P2-1）", () => {
    // maxInterval > hiddenInterval 的配置：spacing 走前台分支，下限仍须是 hiddenInterval
    const v = nextPollSpacingMs({
      attempt: 200, interval: 2500, adaptiveAfter: 36, maxInterval: 65_000,
      backoffFactor: 1.35, hiddenInterval: 60_000, hidden: true, random: () => 0,
    });
    expect(v).toBeGreaterThanOrEqual(60_000);
  });
});
