import { describe, expect, it } from "vitest";
import {
  canUsePaidVideoByPlan,
  isPaidVideoInternalRole,
  resolvePaidVideoAccess,
} from "./paidVideoAccess";

describe("resolvePaidVideoAccess", () => {
  it("正式会员放行", () => {
    expect(resolvePaidVideoAccess({ plan: "pro" }).allowed).toBe(true);
    expect(resolvePaidVideoAccess({ plan: "enterprise" }).allowed).toBe(true);
  });

  // 用户 2026-08-05 明文：视频生成不开放给邀请码用户
  it("邀请码用户（free）挡住，并给出充值指引", () => {
    const out = resolvePaidVideoAccess({ plan: "free" });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("member_only");
    expect(out.message).toContain("会员");
  });

  it("缺 plan 时按 free 处理，不能默认放行", () => {
    expect(resolvePaidVideoAccess({}).allowed).toBe(false);
    expect(resolvePaidVideoAccess({ plan: null }).allowed).toBe(false);
    expect(canUsePaidVideoByPlan(undefined)).toBe(false);
  });

  it("supervisor / admin 内部验收不受限", () => {
    expect(resolvePaidVideoAccess({ plan: "free", role: "supervisor" }).allowed).toBe(true);
    expect(resolvePaidVideoAccess({ plan: "free", role: "admin" }).allowed).toBe(true);
    expect(isPaidVideoInternalRole("user")).toBe(false);
  });
});
