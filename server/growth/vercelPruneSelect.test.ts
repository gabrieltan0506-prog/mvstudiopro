import { describe, expect, it } from "vitest";
import {
  isKnownPreviewDeployment,
  normalizeKeepDays,
  selectPrunableDeployments,
} from "../../scripts/vercelPruneSelect.mjs";

/**
 * 删除 Vercel 部署不可逆。这组测试钉的是「失败方向必须是少删而不是误删」。
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
const ago = (days: number) => NOW - days * DAY;

const dep = (over: Record<string, unknown> = {}) => ({
  uid: `dpl_${Math.random().toString(36).slice(2)}`,
  created: ago(30),
  target: null,
  readyState: "READY",
  ...over,
});

const run = (deployments: unknown[], over: Record<string, unknown> = {}) =>
  selectPrunableDeployments({
    deployments: deployments as never,
    now: NOW,
    ...over,
  });

describe("三道闸", () => {
  it("生产部署永远不进目标集", () => {
    const prod = dep({ target: "production", created: ago(400) });
    const { targets, productionCount } = run([prod, dep()]);
    expect(productionCount).toBe(1);
    expect(targets.map(t => t.uid)).not.toContain(prod.uid);
  });

  it("认不出类型的一律跳过，并计数报出来", () => {
    const staging = dep({ target: "staging", created: ago(400) });
    const noKey = { uid: "dpl_nokey", created: ago(400), readyState: "READY" };
    const { targets, unknown } = run([staging, noKey, dep()]);
    expect(targets.map(t => t.uid)).not.toContain(staging.uid);
    expect(targets.map(t => t.uid)).not.toContain("dpl_nokey");
    expect(unknown).toBe(2);
    expect(isKnownPreviewDeployment(staging)).toBe(false);
    expect(isKnownPreviewDeployment(noKey)).toBe(false);
  });

  it("target 为 null 或 \"preview\" 都认得出（现网返回的是 null）", () => {
    expect(isKnownPreviewDeployment(dep({ target: null }))).toBe(true);
    expect(isKnownPreviewDeployment(dep({ target: "preview" }))).toBe(true);
    expect(isKnownPreviewDeployment(dep({ target: undefined }))).toBe(true);
  });

  it("当前线上生产部署被显式排除", () => {
    const live = dep({ uid: "dpl_live", created: ago(400) });
    const { targets } = run([live, dep()], { liveProductionIds: new Set(["dpl_live"]) });
    expect(targets.map(t => t.uid)).not.toContain("dpl_live");
  });

  it("恰好 6 天不删、恰好 8 天删（保留 7 天）", () => {
    const young = dep({ uid: "dpl_6d", created: ago(6) });
    const old = dep({ uid: "dpl_8d", created: ago(8) });
    const { targets } = run([young, old], { keepDays: 7 });
    expect(targets.map(t => t.uid)).toEqual(["dpl_8d"]);
  });
});

describe("失败与取消的部署", () => {
  it("今天刚炸的构建不删——inspect 页和日志正是排查要用的", () => {
    const brokenToday = dep({ uid: "dpl_err", created: ago(0.2), readyState: "ERROR" });
    const canceledToday = dep({ uid: "dpl_cancel", created: ago(0.2), readyState: "CANCELED" });
    const { targets } = run([brokenToday, canceledToday], { keepDays: 7, failedKeepDays: 1 });
    expect(targets).toEqual([]);
  });

  it("超过失败保留期才删，而且不必等满 7 天", () => {
    const broken = dep({ uid: "dpl_err2", created: ago(2), readyState: "ERROR" });
    const { targets } = run([broken], { keepDays: 7, failedKeepDays: 1 });
    expect(targets.map(t => t.uid)).toEqual(["dpl_err2"]);
  });
});

describe("保留天数的输入清洗", () => {
  it("0 不许把刚建的预览删掉——下限钉 1 天", () => {
    expect(normalizeKeepDays("0", 7)).toBe(1);
    expect(normalizeKeepDays(0, 7)).toBe(1);
    expect(normalizeKeepDays(-5, 7)).toBe(1);
    const fresh = dep({ uid: "dpl_fresh", created: NOW - 60_000 });
    expect(run([fresh], { keepDays: normalizeKeepDays("0", 7) }).targets).toEqual([]);
  });

  it("空值与非数字回落默认", () => {
    expect(normalizeKeepDays("", 7)).toBe(7);
    expect(normalizeKeepDays(undefined, 7)).toBe(7);
    expect(normalizeKeepDays("abc", 7)).toBe(7);
    expect(normalizeKeepDays("14", 7)).toBe(14);
  });
});

describe("自检与排序", () => {
  it("正常输入下自检必须为 0", () => {
    const { breach } = run([
      dep({ target: "production", created: ago(400) }),
      dep({ created: ago(400) }),
      dep({ target: "staging", created: ago(400) }),
    ]);
    expect(breach).toEqual([]);
  });

  it("小件优先：按创建时间从旧到新", () => {
    const a = dep({ uid: "a", created: ago(100) });
    const b = dep({ uid: "b", created: ago(300) });
    const c = dep({ uid: "c", created: ago(200) });
    expect(run([a, b, c]).targets.map(t => t.uid)).toEqual(["b", "c", "a"]);
  });

  it("空输入与非数组输入都不炸", () => {
    expect(run([]).targets).toEqual([]);
    expect(selectPrunableDeployments({ deployments: undefined as never, now: NOW }).targets).toEqual([]);
  });
});
