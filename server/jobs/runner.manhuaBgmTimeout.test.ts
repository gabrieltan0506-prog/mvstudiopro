/**
 * 配乐任务时限与幂等摘要回归。
 *
 * 时限算错不报错——只是任务在「已建单已付费」之后被墙钟砍断，钱花了拿不到产物。
 */
import { describe, expect, it } from "vitest";
import { resolveJobTimeoutMs } from "./runner";
import { stableJson, bgmBriefDigest } from "../routers";

const bgmInput = (duration: number) => ({
  action: "manhua_bgm_v55",
  params: { billingRequestId: "x", brief: { duration } },
});

describe("resolveJobTimeoutMs · manhua_bgm_v55", () => {
  it("短曲也至少给 12 分钟（建单+双变体+量测跑不完 8 分钟默认）", () => {
    expect(resolveJobTimeoutMs("audio", bgmInput(10))).toBe(12 * 60_000);
  });

  it("按曲长线性加，360 秒不再被 8 分钟砍断", () => {
    const ms = resolveJobTimeoutMs("audio", bgmInput(360));
    expect(ms).toBeGreaterThan(12 * 60_000);
    expect(ms).toBeLessThanOrEqual(45 * 60_000);
  });

  it("上限封 45 分钟，不许无限长", () => {
    expect(resolveJobTimeoutMs("audio", bgmInput(100000))).toBe(45 * 60_000);
  });

  it("非配乐的 audio 任务不受影响", () => {
    const ms = resolveJobTimeoutMs("audio", { action: "suno_music", params: {} });
    expect(ms).toBeLessThan(12 * 60_000);
  });
});

describe("bgmBriefDigest · 同编号必须同内容", () => {
  it("键序不同但内容相同 → 同一摘要", () => {
    expect(bgmBriefDigest({ a: 1, b: { c: 2, d: 3 } })).toBe(
      bgmBriefDigest({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("内容变了摘要就变（换赛道/改时长都算变）", () => {
    expect(bgmBriefDigest({ duration: 21 })).not.toBe(bgmBriefDigest({ duration: 30 }));
  });

  it("stableJson 对数组保序（顺序是内容的一部分）", () => {
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });
});
