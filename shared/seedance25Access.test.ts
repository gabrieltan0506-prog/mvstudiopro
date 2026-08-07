import { describe, expect, it } from "vitest";
import {
  SEEDANCE_25_BEFORE_LAUNCH_LABEL_ZH,
  SEEDANCE_25_COUNTDOWN_SUBTITLE_ZH,
  SEEDANCE_25_LAUNCH_AT_ISO,
  SEEDANCE_25_LAUNCH_AT_MS,
  SEEDANCE_25_LAUNCH_DATE_LABEL_EN,
  SEEDANCE_25_LAUNCH_DATE_LABEL_ZH,
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

// 用户 2026-08-05 明文：对外宣称上线日，到点自动开放，仅正式会员；上线前只 supervisor 可走
describe("isSeedance25Launched", () => {
  it("flips exactly at the configured launch instant", () => {
    expect(isSeedance25Launched(BEFORE)).toBe(false);
    expect(isSeedance25Launched(SEEDANCE_25_LAUNCH_AT_MS)).toBe(true);
    expect(isSeedance25Launched(AFTER)).toBe(true);
  });

  it("pins the launch instant to 00:00 Asia/Shanghai", () => {
    expect(SEEDANCE_25_LAUNCH_AT_ISO).toMatch(/T00:00:00\+08:00$/);
    expect(Number.isFinite(SEEDANCE_25_LAUNCH_AT_MS)).toBe(true);
  });
});

/**
 * 改期时最容易漏的一处：时刻改了、对外文案里的日期忘了改（2026-08-07 由 8/8 推到 8/9 时
 * 就险些如此）。这条把「时刻」与「文案日期」钉死成同一个真源，任何一边单独改都会红。
 */
describe("对外日期文案与上线时刻一致", () => {
  it("derives both labels from the same instant", () => {
    const at = new Date(SEEDANCE_25_LAUNCH_AT_MS);
    const shanghai = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
    }).formatToParts(at);
    const month = shanghai.find((p) => p.type === "month")!.value;
    const day = shanghai.find((p) => p.type === "day")!.value;

    expect(SEEDANCE_25_LAUNCH_DATE_LABEL_ZH).toBe(`${month} 月 ${day} 日`);
    expect(SEEDANCE_25_LAUNCH_DATE_LABEL_EN).toBe(
      `${new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", month: "long" }).format(at)} ${day}`,
    );
  });

  it("keeps user-facing copy in sync with the label", () => {
    expect(SEEDANCE_25_COUNTDOWN_SUBTITLE_ZH).toContain(SEEDANCE_25_LAUNCH_DATE_LABEL_ZH);
    expect(SEEDANCE_25_BEFORE_LAUNCH_LABEL_ZH).toContain(SEEDANCE_25_LAUNCH_DATE_LABEL_ZH);
  });
});

describe("resolveSeedance25Access", () => {
  it("keeps paid members out until launch", () => {
    const before = resolveSeedance25Access({ plan: "pro", now: BEFORE });
    expect(before.allowed).toBe(false);
    expect(before.reason).toBe("before_launch");
    expect(before.message).toContain(SEEDANCE_25_LAUNCH_DATE_LABEL_ZH);
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
