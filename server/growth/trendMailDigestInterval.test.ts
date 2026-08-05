import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMailDigestIntervalMinutes as resolveInterval } from "./trendMailDigest";

/** 上海时间某点整对应的 UTC 时刻（UTC+8 无夏令时） */
function shanghaiAt(hour: number): Date {
  return new Date(Date.UTC(2026, 7, 5, (hour - 8 + 24) % 24, 0, 0));
}

const savedOverride = process.env.GROWTH_MAIL_DIGEST_INTERVAL_MINUTES;

beforeEach(() => {
  delete process.env.GROWTH_MAIL_DIGEST_INTERVAL_MINUTES;
});

afterEach(() => {
  if (savedOverride === undefined) delete process.env.GROWTH_MAIL_DIGEST_INTERVAL_MINUTES;
  else process.env.GROWTH_MAIL_DIGEST_INTERVAL_MINUTES = savedOverride;
});

describe("汇总邮件间隔按上海时间分档", () => {
  it("00:00–17:59 每 4 小时一次", () => {
    for (const h of [0, 3, 8, 12, 17]) {
      expect(resolveInterval(shanghaiAt(h))).toBe(240);
    }
  });

  it("18:00 起每 3 小时一次", () => {
    for (const h of [18, 20, 23]) {
      expect(resolveInterval(shanghaiAt(h))).toBe(180);
    }
  });

  it("环境变量可一口价覆盖两档", () => {
    process.env.GROWTH_MAIL_DIGEST_INTERVAL_MINUTES = "30";
    expect(resolveInterval(shanghaiAt(9))).toBe(30);
    expect(resolveInterval(shanghaiAt(21))).toBe(30);
  });

  it("覆盖值再小也不低于 15 分钟，免得把机器发爆", () => {
    process.env.GROWTH_MAIL_DIGEST_INTERVAL_MINUTES = "1";
    expect(resolveInterval(shanghaiAt(9))).toBe(15);
  });
});
