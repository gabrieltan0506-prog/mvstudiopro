import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertUsageOrThrow,
  clientIpOf,
  consumeUsage,
  resetUsageLimitsForTest,
  resolveUsageLimit,
  trpcUsageSubjects,
} from "./usageLimits";

const SPEC = { name: "unit_spec", perMinute: 2, perDay: 3, globalPerDay: 5 };
const T0 = Date.UTC(2026, 10, 11, 2, 0, 0); // 北京时间 10:00

beforeEach(() => resetUsageLimitsForTest());
afterEach(() => vi.unstubAllEnvs());

describe("consumeUsage", () => {
  it("每分钟上限：同一分钟第 3 次被拒，下一分钟放行", () => {
    expect(consumeUsage(SPEC, ["u:1"], T0).ok).toBe(true);
    expect(consumeUsage(SPEC, ["u:1"], T0 + 1000).ok).toBe(true);
    const denied = consumeUsage(SPEC, ["u:1"], T0 + 2000);
    expect(denied).toMatchObject({ ok: false, reason: "per_minute" });
    expect(consumeUsage(SPEC, ["u:1"], T0 + 61_000).ok).toBe(true);
  });

  it("每日上限：当日第 4 次被拒，北京时间次日零点后恢复", () => {
    for (let i = 0; i < 3; i++) expect(consumeUsage(SPEC, ["u:1"], T0 + i * 61_000).ok).toBe(true);
    expect(consumeUsage(SPEC, ["u:1"], T0 + 10 * 61_000)).toMatchObject({ ok: false, reason: "per_day" });
    const nextDayBeijing = Date.UTC(2026, 10, 11, 16, 0, 1); // 北京时间 11-12 00:00:01
    expect(consumeUsage(SPEC, ["u:1"], nextDayBeijing).ok).toBe(true);
  });

  it("全站每日总量：不同主体合计超限即拒", () => {
    for (let i = 0; i < 5; i++) expect(consumeUsage(SPEC, [`u:${i}`], T0).ok).toBe(true);
    expect(consumeUsage(SPEC, ["u:99"], T0)).toMatchObject({ ok: false, reason: "global_per_day" });
  });

  it("多主体：用户与 IP 任一超限即拒；被拒的请求不占额度", () => {
    expect(consumeUsage(SPEC, ["u:1", "ip:a"], T0).ok).toBe(true);
    expect(consumeUsage(SPEC, ["u:2", "ip:a"], T0).ok).toBe(true);
    // 同 IP 换账号：IP 维度已满
    expect(consumeUsage(SPEC, ["u:3", "ip:a"], T0)).toMatchObject({ ok: false, reason: "per_minute" });
    // u:3 被拒那次没记数：换 IP 后 u:3 仍有完整额度
    expect(consumeUsage(SPEC, ["u:3", "ip:b"], T0).ok).toBe(true);
    expect(consumeUsage(SPEC, ["u:3", "ip:c"], T0).ok).toBe(true);
  });

  it("env 覆盖数值；0 表示该维度不限", () => {
    vi.stubEnv("USAGE_LIMIT_UNIT_SPEC_PER_MIN", "0");
    vi.stubEnv("USAGE_LIMIT_UNIT_SPEC_PER_DAY", "100");
    vi.stubEnv("USAGE_LIMIT_UNIT_SPEC_GLOBAL_PER_DAY", "abc");
    expect(resolveUsageLimit(SPEC)).toEqual({ name: "unit_spec", perMinute: 0, perDay: 100, globalPerDay: 5 });
    for (let i = 0; i < 5; i++) expect(consumeUsage(SPEC, ["u:1"], T0).ok).toBe(true);
  });
});

describe("tRPC 辅助", () => {
  it("assertUsageOrThrow 超限抛 TOO_MANY_REQUESTS，文案中性", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = { name: "unit_throw", perMinute: 1, perDay: 0 };
    assertUsageOrThrow(spec, ["u:1"]);
    try {
      assertUsageOrThrow(spec, ["u:1"]);
      throw new Error("应被拒");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("TOO_MANY_REQUESTS");
      expect((error as TRPCError).message).toBe("操作太频繁，请稍后再试");
    }
  });

  it("主体：登录按用户 + IP，未登录只按 IP；IP 取 req.ip，其次 fly-client-ip", () => {
    expect(trpcUsageSubjects({ user: { id: 7 }, req: { ip: "1.1.1.1" } })).toEqual(["u:7", "ip:1.1.1.1"]);
    expect(trpcUsageSubjects({ user: null, req: { headers: { "fly-client-ip": "2.2.2.2" } } })).toEqual(["ip:2.2.2.2"]);
    expect(clientIpOf(undefined)).toBe("unknown");
  });
});
