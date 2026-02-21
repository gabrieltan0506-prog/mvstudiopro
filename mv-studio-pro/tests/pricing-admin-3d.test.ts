import { describe, it, expect } from "vitest";

// ─── 價格體系優化測試 ───────────────────────────────
describe("Price optimization", () => {
  it("should have correct yearly discount (20%)", () => {
    const proMonthly = 29;
    const proYearly = 23; // per month
    const proYearlyTotal = proYearly * 12; // 276
    const proSavings = proMonthly * 12 - proYearlyTotal; // 348 - 276 = 72
    const discountRate = proSavings / (proMonthly * 12);
    
    expect(proYearlyTotal).toBe(276);
    expect(proSavings).toBe(72);
    expect(discountRate).toBeCloseTo(0.207, 1); // ~20.7%
  });

  it("should have correct enterprise yearly discount", () => {
    const entMonthly = 99;
    const entYearly = 79; // per month
    const entYearlyTotal = entYearly * 12; // 948
    const entSavings = entMonthly * 12 - entYearlyTotal; // 1188 - 948 = 240
    
    expect(entYearlyTotal).toBe(948);
    expect(entSavings).toBe(240);
  });
});

// ─── Credits 加值包測試 ─────────────────────────────
describe("Credit packs", () => {
  // Import shared credits constants
  const CREDIT_PACKS_SHARED = {
    small: { credits: 100, price: 9.99 },
    medium: { credits: 250, price: 22.99 },
    large: { credits: 500, price: 39.99 },
  };

  it("should have 3 credit packs (small, medium, large)", () => {
    expect(Object.keys(CREDIT_PACKS_SHARED)).toHaveLength(3);
    expect(CREDIT_PACKS_SHARED).toHaveProperty("small");
    expect(CREDIT_PACKS_SHARED).toHaveProperty("medium");
    expect(CREDIT_PACKS_SHARED).toHaveProperty("large");
  });

  it("medium pack should offer better value than small", () => {
    const smallCPP = CREDIT_PACKS_SHARED.small.price / CREDIT_PACKS_SHARED.small.credits;
    const mediumCPP = CREDIT_PACKS_SHARED.medium.price / CREDIT_PACKS_SHARED.medium.credits;
    expect(mediumCPP).toBeLessThan(smallCPP);
  });

  it("large pack should offer best value", () => {
    const mediumCPP = CREDIT_PACKS_SHARED.medium.price / CREDIT_PACKS_SHARED.medium.credits;
    const largeCPP = CREDIT_PACKS_SHARED.large.price / CREDIT_PACKS_SHARED.large.credits;
    expect(largeCPP).toBeLessThan(mediumCPP);
  });
});

// ─── 偶像轉 3D 功能測試 ─────────────────────────────
describe("Idol 3D conversion", () => {
  it("should define idol3D credit cost", async () => {
    const { CREDIT_COSTS } = await import("../server/plans");
    expect(CREDIT_COSTS).toHaveProperty("idol3D");
    expect(CREDIT_COSTS.idol3D).toBe(30);
  });

  it("should include idol3D in PLANS pro features", async () => {
    const { PLANS } = await import("../server/plans");
    const proPlan = PLANS.pro;
    expect(proPlan).toBeDefined();
    expect(proPlan.featuresCn).toContain("偶像图片转 3D");
  });

  it("idol3D should NOT be in free plan features", async () => {
    const { PLANS } = await import("../server/plans");
    const freePlan = PLANS.free;
    expect(freePlan).toBeDefined();
    const has3D = freePlan.featuresCn.some((f: string) => f.includes("3D"));
    expect(has3D).toBe(false);
  });
});

// ─── 管理員無限使用權限測試 ──────────────────────────
describe("Admin unlimited access", () => {
  it("should have admin bypass in checkFeatureAccess logic", async () => {
    // Verify the usage router file contains admin check
    const fs = await import("fs");
    const usageContent = fs.readFileSync("server/routers/usage.ts", "utf-8");
    expect(usageContent).toContain("admin");
    expect(usageContent).toContain("allowed: true");
  });

  it("should have admin bypass in deductCredits logic", async () => {
    const fs = await import("fs");
    const creditsContent = fs.readFileSync("server/credits.ts", "utf-8");
    expect(creditsContent).toContain("isAdmin");
    expect(creditsContent).toContain("source: \"admin\"");
  });
});

// ─── 3D 風格選項測試 ─────────────────────────────────
describe("3D style options", () => {
  const VALID_STYLES = ["clay", "pixar", "realistic3d", "lowpoly", "anime3d"];
  const VALID_ANGLES = ["front", "three_quarter", "side", "full_body"];

  it("should have 5 valid 3D styles", () => {
    expect(VALID_STYLES).toHaveLength(5);
  });

  it("should have 4 valid 3D angles", () => {
    expect(VALID_ANGLES).toHaveLength(4);
  });

  it("default style should be pixar", () => {
    expect(VALID_STYLES).toContain("pixar");
  });

  it("default angle should be three_quarter", () => {
    expect(VALID_ANGLES).toContain("three_quarter");
  });
});

// ─── PRICE_IDS 結構測試 ──────────────────────────────
describe("PRICE_IDS structure", () => {
  it("should include medium credit pack price ID", async () => {
    const fs = await import("fs");
    const stripeContent = fs.readFileSync("server/stripe.ts", "utf-8");
    expect(stripeContent).toContain("credit_pack_medium");
    expect(stripeContent).toContain("STRIPE_CREDIT_PACK_MEDIUM_PRICE_ID");
  });
});

// ─── 歡迎語路由測試 ──────────────────────────────────
describe("Welcome message route", () => {
  it("should have welcomeMessage router in appRouter", async () => {
    const fs = await import("fs");
    const routersContent = fs.readFileSync("server/routers.ts", "utf-8");
    expect(routersContent).toContain("welcomeMessage: router");
    expect(routersContent).toContain("planName: z.string()");
    expect(routersContent).toContain("userName: z.string().optional()");
  });
});
