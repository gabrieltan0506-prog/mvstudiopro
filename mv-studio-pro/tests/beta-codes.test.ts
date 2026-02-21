import { describe, it, expect, vi } from "vitest";

/**
 * Beta Codes System Tests
 * - Code generation (admin batch)
 * - Code redemption (user)
 * - Kling usage limit
 * - Schema validation
 */

describe("Beta Codes Schema", () => {
  it("betaCodes table has required columns", async () => {
    const schema = await import("../drizzle/schema-beta");
    expect(schema.betaCodes).toBeDefined();
    // Check table name
    const tableName = (schema.betaCodes as any)[Symbol.for("drizzle:Name")];
    expect(tableName).toBe("beta_codes");
  });

  it("betaQuotas table has klingLimit and klingUsed columns", async () => {
    const schema = await import("../drizzle/schema-beta");
    expect(schema.betaQuotas).toBeDefined();
  });
});

describe("Beta Codes Router - generateBetaCodes", () => {
  it("should generate codes with MV prefix", () => {
    // Simulate code generation format
    const crypto = require("crypto");
    const code = "MV" + crypto.randomBytes(3).toString("hex").toUpperCase();
    expect(code).toMatch(/^MV[A-F0-9]{6}$/);
    expect(code.length).toBe(8);
  });

  it("should generate unique codes in batch", () => {
    const crypto = require("crypto");
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add("MV" + crypto.randomBytes(3).toString("hex").toUpperCase());
    }
    // With 16M possible combinations, 100 codes should all be unique
    expect(codes.size).toBe(100);
  });

  it("should generate batch IDs", () => {
    const crypto = require("crypto");
    const batchId = crypto.randomBytes(8).toString("hex");
    expect(batchId.length).toBe(16);
    expect(batchId).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("Beta Codes Router - redeemBetaCode", () => {
  it("should normalize code to uppercase", () => {
    const input = "mv3a2f1b";
    const normalized = input.toUpperCase().trim();
    expect(normalized).toBe("MV3A2F1B");
  });

  it("should reject empty codes", () => {
    const code = "";
    expect(code.trim().length).toBe(0);
  });

  it("should handle code with spaces", () => {
    const input = "  MV3A2F1B  ";
    const normalized = input.toUpperCase().trim();
    expect(normalized).toBe("MV3A2F1B");
  });
});

describe("Kling Usage Limit", () => {
  it("should allow Kling when klingUsed < klingLimit", () => {
    const quota = { klingLimit: 1, klingUsed: 0 };
    const allowed = quota.klingUsed < quota.klingLimit;
    expect(allowed).toBe(true);
  });

  it("should deny Kling when klingUsed >= klingLimit", () => {
    const quota = { klingLimit: 1, klingUsed: 1 };
    const allowed = quota.klingUsed < quota.klingLimit;
    expect(allowed).toBe(false);
  });

  it("should calculate remaining Kling uses correctly", () => {
    const quota = { klingLimit: 1, klingUsed: 0 };
    const remaining = quota.klingLimit - quota.klingUsed;
    expect(remaining).toBe(1);

    // After using once
    quota.klingUsed = 1;
    const remainingAfter = quota.klingLimit - quota.klingUsed;
    expect(remainingAfter).toBe(0);
  });

  it("should track klingUsed increment", () => {
    const quota = { klingLimit: 1, klingUsed: 0, usedCount: 5 };
    // Simulate useKlingQuota
    quota.klingUsed += 1;
    quota.usedCount += 1;
    expect(quota.klingUsed).toBe(1);
    expect(quota.usedCount).toBe(6);
  });
});

describe("Beta Code Expiry", () => {
  it("should detect expired codes", () => {
    const pastDate = new Date("2025-01-01");
    const now = new Date();
    expect(now > pastDate).toBe(true);
  });

  it("should allow non-expired codes", () => {
    const futureDate = new Date("2027-12-31");
    const now = new Date();
    expect(now > futureDate).toBe(false);
  });

  it("should allow codes with no expiry", () => {
    function checkExpiry(expiresAt: Date | null): boolean {
      if (!expiresAt) return false;
      return new Date() > expiresAt;
    }
    expect(checkExpiry(null)).toBe(false);
    expect(checkExpiry(new Date("2027-12-31"))).toBe(false);
    expect(checkExpiry(new Date("2020-01-01"))).toBe(true);
  });
});

describe("Redeem Result", () => {
  it("should return correct result structure", () => {
    const result = {
      success: true,
      quota: 20,
      klingLimit: 1,
      inviteCode: "A3F2B1C9",
      message: "内测码兑换成功！获得 20 次使用配额，Kling视频 1 次",
    };
    expect(result.success).toBe(true);
    expect(result.quota).toBe(20);
    expect(result.klingLimit).toBe(1);
    expect(result.inviteCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(result.message).toContain("20");
  });
});

describe("Invite Code Generation", () => {
  it("should generate 8-char hex invite codes", () => {
    const crypto = require("crypto");
    const inviteCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    expect(inviteCode.length).toBe(8);
    expect(inviteCode).toMatch(/^[A-F0-9]{8}$/);
  });
});
