import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCollectionCalendar, resolveCollectionMode } from "./collectionCalendar";

afterEach(() => vi.unstubAllEnvs());

describe("北京时间采集日历", () => {
  it.each([
    ["2026-11-04T23:59:59+08:00", "live"],
    ["2026-11-05T00:00:00+08:00", "backfill"],
    ["2026-11-05T06:59:59+08:00", "backfill"],
    ["2026-11-05T07:00:00+08:00", "live"],
    ["2026-11-07T00:00:00+08:00", "live"],
    ["2026-11-08T06:59:59+08:00", "live"],
    ["2026-02-14T03:00:00+08:00", "live"],
    ["2026-01-04T03:00:00+08:00", "live"],
    ["2026-02-23T03:00:00+08:00", "live"],
    ["2026-04-06T03:00:00+08:00", "live"],
    ["2026-05-05T03:00:00+08:00", "live"],
    ["2026-06-19T03:00:00+08:00", "live"],
    ["2026-09-25T03:00:00+08:00", "live"],
    ["2026-10-07T03:00:00+08:00", "live"],
    ["2026-10-08T03:00:00+08:00", "backfill"],
  ])("%s 应为 %s", (date, mode) => {
    expect(resolveCollectionCalendar(new Date(date), "").mode).toBe(mode);
  });
  it("UTC日期已变但北京时间尚未到7点时仍回填", () => {
    expect(resolveCollectionCalendar(new Date("2026-11-04T22:59:59Z"), "").mode).toBe("backfill");
    expect(resolveCollectionCalendar(new Date("2026-11-04T23:00:00Z"), "").mode).toBe("live");
  });
  it("额外节日只增加live日期，不改变周末规则", () => {
    expect(resolveCollectionCalendar(new Date("2026-11-05T03:00:00+08:00"), "2026-11-05").mode).toBe("live");
  });
  it("缺少新年度官方日历时明确标记，保留live而非猜测节日", () => {
    expect(resolveCollectionCalendar(new Date("2027-02-08T03:00:00+08:00"), "")).toMatchObject({ calendarKnown: false, mode: "live" });
  });
  it("显式管理模式保留；auto应用日历", () => {
    const now = new Date("2026-11-05T03:00:00+08:00");
    expect(resolveCollectionMode("auto", now)).toBe("backfill");
    expect(resolveCollectionMode("live", now)).toBe("live");
    expect(resolveCollectionMode("backfill", new Date("2026-11-07T12:00:00+08:00"))).toBe("backfill");
  });
});
