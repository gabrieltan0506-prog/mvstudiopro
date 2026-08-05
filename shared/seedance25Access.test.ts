import { describe, expect, it } from "vitest";
import {
  SEEDANCE_25_LAUNCH_AT_MS,
  canAccessSeedance25ByPlan,
  isSeedance25Launched,
  resolveSeedance25Access,
} from "./seedance25Access";

const BEFORE = SEEDANCE_25_LAUNCH_AT_MS - 60_000;
const AFTER = SEEDANCE_25_LAUNCH_AT_MS + 60_000;

describe("canAccessSeedance25ByPlan", () => {
  it("allows stripe paid plans", () => {
    expect(canAccessSeedance25ByPlan("pro")).toBe(true);
    expect(canAccessSeedance25ByPlan("enterprise")).toBe(true);
    expect(canAccessSeedance25ByPlan("PRO")).toBe(true);
  });

  it("blocks free / invite-only (credits without paid plan)", () => {
    expect(canAccessSeedance25ByPlan("free")).toBe(false);
    expect(canAccessSeedance25ByPlan("")).toBe(false);
    expect(canAccessSeedance25ByPlan(null)).toBe(false);
    expect(canAccessSeedance25ByPlan("beta")).toBe(false);
  });
});

// 用户 2026-08-05 明文：对外 8 月 8 日上线，到点自动开放，仅正式会员；上线前只 supervisor 可走
describe("isSeedance25Launched", () => {
  it("flips at 2026-08-08 00:00 (UTC+8)", () => {
    expect(new Date(SEEDANCE_25_LAUNCH_AT_MS).toISOString()).toBe("2026-08-07T16:00:00.000Z");
    expect(isSeedance25Launched(BEFORE)).toBe(false);
    expect(isSeedance25Launched(SEEDANCE_25_LAUNCH_AT_MS)).toBe(true);
    expect(isSeedance25Launched(AFTER)).toBe(true);
  });
});

describe("resolveSeedance25Access", () => {
  it("keeps paid members out until launch", () => {
    const before = resolveSeedance25Access({ plan: "pro", now: BEFORE });
    expect(before.allowed).toBe(false);
    expect(before.reason).toBe("before_launch");
    expect(before.message).toContain("8 月 8 日");
  });

  it("opens to paid members automatically at launch", () => {
    expect(resolveSeedance25Access({ plan: "pro", now: AFTER }).allowed).toBe(true);
    expect(resolveSeedance25Access({ plan: "enterprise", now: AFTER }).allowed).toBe(true);
  });

  it("still blocks invite-code credit users after launch", () => {
    const out = resolveSeedance25Access({ plan: "free", now: AFTER });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("paid_only");
  });

  it("lets supervisor/admin in before launch regardless of plan", () => {
    expect(resolveSeedance25Access({ plan: "free", role: "supervisor", now: BEFORE }).allowed).toBe(true);
    expect(resolveSeedance25Access({ plan: null, role: "admin", now: BEFORE }).allowed).toBe(true);
    expect(resolveSeedance25Access({ plan: "free", role: "user", now: BEFORE }).allowed).toBe(false);
  });
});
