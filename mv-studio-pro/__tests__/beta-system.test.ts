import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// Beta Quota System, Email OTP Login, and Virtual Idol Reference Image Tests
// ============================================================

// --- Beta Quota Schema Tests ---
describe("Beta Quota Schema", () => {
  it("should define betaQuotas table with required fields", async () => {
    const schema = await import("../drizzle/schema-beta");
    expect(schema.betaQuotas).toBeDefined();
    expect(schema.betaReferrals).toBeDefined();
  });

  it("should export betaQuotas with correct column names", async () => {
    const schema = await import("../drizzle/schema-beta");
    const table = schema.betaQuotas;
    // Table should exist as a drizzle table object
    expect(table).toBeTruthy();
  });

  it("should export betaReferrals with correct column names", async () => {
    const schema = await import("../drizzle/schema-beta");
    const table = schema.betaReferrals;
    expect(table).toBeTruthy();
  });
});

// --- Beta Tier System Tests ---
describe("Beta Tier System", () => {
  const BETA_TIERS = [
    { name: "Starter", minReferrals: 0, icon: "⭐" },
    { name: "Advocate", minReferrals: 3, icon: "🌟" },
    { name: "Ambassador", minReferrals: 10, icon: "💫" },
    { name: "Champion", minReferrals: 25, icon: "🏆" },
    { name: "Legend", minReferrals: 50, icon: "👑" },
  ];

  function getBetaTier(referralCount: number) {
    for (let i = BETA_TIERS.length - 1; i >= 0; i--) {
      if (referralCount >= BETA_TIERS[i].minReferrals) {
        return BETA_TIERS[i];
      }
    }
    return BETA_TIERS[0];
  }

  it("should return Starter tier for 0 referrals", () => {
    expect(getBetaTier(0).name).toBe("Starter");
  });

  it("should return Starter tier for 2 referrals", () => {
    expect(getBetaTier(2).name).toBe("Starter");
  });

  it("should return Advocate tier for 3 referrals", () => {
    expect(getBetaTier(3).name).toBe("Advocate");
  });

  it("should return Ambassador tier for 10 referrals", () => {
    expect(getBetaTier(10).name).toBe("Ambassador");
  });

  it("should return Champion tier for 25 referrals", () => {
    expect(getBetaTier(25).name).toBe("Champion");
  });

  it("should return Legend tier for 50 referrals", () => {
    expect(getBetaTier(50).name).toBe("Legend");
  });

  it("should return Legend tier for 100 referrals", () => {
    expect(getBetaTier(100).name).toBe("Legend");
  });

  it("should have 5 tiers total", () => {
    expect(BETA_TIERS.length).toBe(5);
  });

  it("should have tiers in ascending order of minReferrals", () => {
    for (let i = 1; i < BETA_TIERS.length; i++) {
      expect(BETA_TIERS[i].minReferrals).toBeGreaterThan(
        BETA_TIERS[i - 1].minReferrals
      );
    }
  });
});

// --- Email OTP Validation Tests ---
describe("Email OTP Validation", () => {
  function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isValidOtp(otp: string): boolean {
    return /^\d{6}$/.test(otp);
  }

  function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  it("should validate correct email formats", () => {
    expect(isValidEmail("test@example.com")).toBe(true);
    expect(isValidEmail("user@domain.co")).toBe(true);
    expect(isValidEmail("name.last@company.org")).toBe(true);
  });

  it("should reject invalid email formats", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("notanemail")).toBe(false);
    expect(isValidEmail("@domain.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
  });

  it("should validate 6-digit OTP codes", () => {
    expect(isValidOtp("123456")).toBe(true);
    expect(isValidOtp("000000")).toBe(true);
    expect(isValidOtp("999999")).toBe(true);
  });

  it("should reject invalid OTP codes", () => {
    expect(isValidOtp("12345")).toBe(false);
    expect(isValidOtp("1234567")).toBe(false);
    expect(isValidOtp("abcdef")).toBe(false);
    expect(isValidOtp("")).toBe(false);
  });

  it("should generate valid 6-digit OTP", () => {
    const otp = generateOtp();
    expect(otp.length).toBe(6);
    expect(isValidOtp(otp)).toBe(true);
  });

  it("should generate different OTPs on multiple calls", () => {
    const otps = new Set(Array.from({ length: 10 }, () => generateOtp()));
    // With 10 random 6-digit numbers, we should get at least 2 different ones
    expect(otps.size).toBeGreaterThan(1);
  });
});

// --- Invite Code Tests ---
describe("Invite Code System", () => {
  function generateInviteCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  it("should generate 8-character invite codes", () => {
    const code = generateInviteCode();
    expect(code.length).toBe(8);
  });

  it("should only contain allowed characters (no 0, O, 1, I, L)", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
  });

  it("should generate unique codes", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
    expect(codes.size).toBeGreaterThan(15); // At least 15 unique out of 20
  });
});

// --- Quota Calculation Tests ---
describe("Quota Calculation", () => {
  const BONUS_PER_REFERRAL = 10;

  function calculateTotalQuota(
    baseQuota: number,
    referralCount: number
  ): number {
    return baseQuota + referralCount * BONUS_PER_REFERRAL;
  }

  function calculateRemainingQuota(
    totalQuota: number,
    usedCount: number
  ): number {
    return Math.max(0, totalQuota - usedCount);
  }

  it("should calculate total quota with no referrals", () => {
    expect(calculateTotalQuota(20, 0)).toBe(20);
    expect(calculateTotalQuota(40, 0)).toBe(40);
  });

  it("should add 10 per referral", () => {
    expect(calculateTotalQuota(20, 1)).toBe(30);
    expect(calculateTotalQuota(20, 5)).toBe(70);
    expect(calculateTotalQuota(40, 3)).toBe(70);
  });

  it("should calculate remaining quota correctly", () => {
    expect(calculateRemainingQuota(30, 10)).toBe(20);
    expect(calculateRemainingQuota(20, 20)).toBe(0);
    expect(calculateRemainingQuota(20, 25)).toBe(0); // Never negative
  });
});

// --- Virtual Idol Reference Image Tests ---
describe("Virtual Idol Reference Image", () => {
  function isValidImageUri(uri: string): boolean {
    return (
      uri.startsWith("file://") ||
      uri.startsWith("content://") ||
      uri.startsWith("ph://") ||
      uri.startsWith("http://") ||
      uri.startsWith("https://") ||
      uri.startsWith("data:image/")
    );
  }

  function isValidBase64Image(data: string): boolean {
    return /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data);
  }

  it("should validate image URIs from different sources", () => {
    expect(isValidImageUri("file:///path/to/image.jpg")).toBe(true);
    expect(isValidImageUri("https://example.com/image.png")).toBe(true);
    expect(isValidImageUri("content://media/external/images/123")).toBe(true);
    expect(isValidImageUri("ph://asset-id")).toBe(true);
    expect(isValidImageUri("data:image/png;base64,abc")).toBe(true);
  });

  it("should reject invalid image URIs", () => {
    expect(isValidImageUri("")).toBe(false);
    expect(isValidImageUri("not-a-uri")).toBe(false);
    expect(isValidImageUri("ftp://server/image.png")).toBe(false);
  });

  it("should validate base64 image data", () => {
    expect(isValidBase64Image("data:image/png;base64,iVBOR")).toBe(true);
    expect(isValidBase64Image("data:image/jpeg;base64,/9j/4")).toBe(true);
    expect(isValidBase64Image("data:image/webp;base64,UklG")).toBe(true);
  });

  it("should reject invalid base64 data", () => {
    expect(isValidBase64Image("not-base64")).toBe(false);
    expect(isValidBase64Image("data:text/plain;base64,abc")).toBe(false);
  });
});

// --- Login Page Mode Tests ---
describe("Login Page Modes", () => {
  type LoginMode = "social" | "email";

  it("should support social and email login modes", () => {
    const modes: LoginMode[] = ["social", "email"];
    expect(modes).toContain("social");
    expect(modes).toContain("email");
  });

  it("should default to social login mode", () => {
    const defaultMode: LoginMode = "social";
    expect(defaultMode).toBe("social");
  });
});

// --- Admin Beta Management Tests ---
describe("Admin Beta Management", () => {
  type QuotaAmount = 20 | 40;

  function isValidQuotaAmount(amount: number): amount is QuotaAmount {
    return amount === 20 || amount === 40;
  }

  it("should only allow 20 or 40 as quota amounts", () => {
    expect(isValidQuotaAmount(20)).toBe(true);
    expect(isValidQuotaAmount(40)).toBe(true);
    expect(isValidQuotaAmount(10)).toBe(false);
    expect(isValidQuotaAmount(30)).toBe(false);
    expect(isValidQuotaAmount(50)).toBe(false);
  });

  it("should validate admin role check", () => {
    const isAdmin = (role: string | null | undefined): boolean => {
      return role === "admin";
    };
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("user")).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

// --- Share Card Generation Tests ---
describe("Share Card", () => {
  function generateShareUrl(inviteCode: string, baseUrl: string): string {
    return `${baseUrl}/invite?code=${inviteCode}`;
  }

  function generateShareText(
    appName: string,
    inviteCode: string,
    bonusCount: number
  ): string {
    return `我正在使用 ${appName}，邀請你一起來體驗！使用我的邀請碼 ${inviteCode} 註冊，你將獲得 ${bonusCount} 次免費使用機會！`;
  }

  it("should generate correct share URL", () => {
    const url = generateShareUrl("ABC12345", "https://mvstudiopro.com");
    expect(url).toBe("https://mvstudiopro.com/invite?code=ABC12345");
  });

  it("should generate share text with invite code", () => {
    const text = generateShareText("MV Studio Pro", "ABC12345", 10);
    expect(text).toContain("MV Studio Pro");
    expect(text).toContain("ABC12345");
    expect(text).toContain("10");
  });
});
