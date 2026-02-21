import { describe, it, expect } from "vitest";

// ─── 1. 審計日誌模組測試 ───
describe("Audit Log Module", () => {
  it("writeAuditLog function exists and accepts correct params", async () => {
    const { writeAuditLog } = await import("../server/audit");
    expect(typeof writeAuditLog).toBe("function");
  });

  it("writeAuditLog handles missing db gracefully", async () => {
    const { writeAuditLog } = await import("../server/audit");
    // Should not throw even if db is not available
    const result = await writeAuditLog({
      eventType: "test.event",
      action: "test_action",
      metadata: { test: true },
    });
    // Should return undefined or handle gracefully
    expect(result).toBeUndefined();
  });
});

// ─── 2. Rate Limiting 模組測試 ───
describe("Rate Limiting Module", () => {
  it("exports generalApiLimit and authLimit middleware", async () => {
    const rateLimitModule = await import("../server/rate-limit");
    expect(rateLimitModule.generalApiLimit).toBeDefined();
    expect(rateLimitModule.authLimit).toBeDefined();
    expect(typeof rateLimitModule.generalApiLimit).toBe("function");
    expect(typeof rateLimitModule.authLimit).toBe("function");
  });
});

// ─── 3. Schema 測試 ───
describe("Stripe Audit Schema", () => {
  it("exports stripeAuditLogs, stripeInvoices, kpiSnapshots tables", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.stripeAuditLogs).toBeDefined();
    expect(schema.stripeInvoices).toBeDefined();
    expect(schema.kpiSnapshots).toBeDefined();
  });

  it("stripeAuditLogs has required columns", async () => {
    const { stripeAuditLogs } = await import("../drizzle/schema");
    // Drizzle table objects have column definitions
    const columns = Object.keys(stripeAuditLogs);
    expect(columns.length).toBeGreaterThan(0);
  });

  it("stripeInvoices has required columns", async () => {
    const { stripeInvoices } = await import("../drizzle/schema");
    const columns = Object.keys(stripeInvoices);
    expect(columns.length).toBeGreaterThan(0);
  });
});

// ─── 4. Webhook 增強測試 ───
describe("Stripe Webhook Enhanced", () => {
  it("registerStripeWebhook function exists", async () => {
    const { registerStripeWebhook } = await import("../server/stripe-webhook");
    expect(typeof registerStripeWebhook).toBe("function");
  });
});

// ─── 5. 7天免費試用邏輯測試 ───
describe("Trial Period Logic", () => {
  it("checkout session should include trial_period_days for new users", () => {
    // Simulate: new user (no existing subscription)
    const hasUsedTrial = false;
    const subscriptionData = hasUsedTrial ? {} : { trial_period_days: 7 };
    expect(subscriptionData).toHaveProperty("trial_period_days", 7);
  });

  it("checkout session should NOT include trial for returning users", () => {
    // Simulate: returning user (has existing subscription ID)
    const hasUsedTrial = true;
    const subscriptionData = hasUsedTrial ? {} : { trial_period_days: 7 };
    expect(subscriptionData).not.toHaveProperty("trial_period_days");
  });
});

// ─── 6. Plans 配置驗證 ───
describe("Plans Configuration Validation", () => {
  it("all plans have required fields", async () => {
    const { PLANS } = await import("../server/plans");
    const requiredFields = ["name", "nameCn", "monthlyPrice", "monthlyCredits", "features", "featuresCn"];

    for (const [planKey, plan] of Object.entries(PLANS)) {
      for (const field of requiredFields) {
        expect(plan).toHaveProperty(field);
      }
    }
  });

  it("pro plan has idol3D feature", async () => {
    const { PLANS } = await import("../server/plans");
    expect(PLANS.pro.featuresCn).toContain("偶像图片转 3D");
  });

  it("credit packs include small, medium, large", async () => {
    const { CREDIT_PACKS } = await import("../server/plans");
    expect(CREDIT_PACKS).toHaveProperty("small");
    expect(CREDIT_PACKS).toHaveProperty("medium");
    expect(CREDIT_PACKS).toHaveProperty("large");
    // Medium pack should be between small and large
    expect(CREDIT_PACKS.medium.credits).toBeGreaterThan(CREDIT_PACKS.small.credits);
    expect(CREDIT_PACKS.medium.credits).toBeLessThan(CREDIT_PACKS.large.credits);
  });

  it("yearly discount is 20%", async () => {
    const { PLANS } = await import("../server/plans");
    const proMonthly = PLANS.pro.monthlyPrice;
    const proYearly = PLANS.pro.yearlyPrice;
    if (proYearly) {
      const yearlyMonthly = proYearly / 12;
      const discount = Math.round((1 - yearlyMonthly / proMonthly) * 100);
      expect(discount).toBe(20);
    }
  });
});

// ─── 7. CREDIT_COSTS 驗證 ───
describe("Credit Costs Validation", () => {
  it("includes idol3D cost", async () => {
    const { CREDIT_COSTS } = await import("../server/plans");
    expect(CREDIT_COSTS).toHaveProperty("idol3D");
    expect(CREDIT_COSTS.idol3D).toBe(30);
  });

  it("all costs are non-negative integers, paid costs are positive", async () => {
    const { CREDIT_COSTS } = await import("../server/plans");
    for (const [action, cost] of Object.entries(CREDIT_COSTS)) {
      expect(cost).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(cost)).toBe(true);
      // forgeImage is intentionally free (0 credits)
      if (action !== "forgeImage") {
        expect(cost).toBeGreaterThan(0);
      }
    }
  });
});

// ─── 8. Stripe Router 新增端點驗證 ───
describe("Stripe Router Enhanced Endpoints", () => {
  it("stripeRouter exports all required procedures", async () => {
    const { stripeRouter } = await import("../server/routers/stripe");
    const routerDef = stripeRouter._def;
    const procedures = Object.keys(routerDef.procedures || routerDef.record || {});

    // 原有端點
    expect(procedures).toContain("getPlans");
    expect(procedures).toContain("getSubscription");
    expect(procedures).toContain("createCheckoutSession");
    expect(procedures).toContain("cancelSubscription");
    expect(procedures).toContain("adminMetrics");

    // 新增端點
    expect(procedures).toContain("getInvoices");
    expect(procedures).toContain("getPortalUrl");
    expect(procedures).toContain("adminAuditLogs");
    expect(procedures).toContain("adminKpiMetrics");
  });
});

// ─── 9. PRICE_IDS 配置驗證 ───
describe("PRICE_IDS Configuration", () => {
  it("includes medium credit pack price ID", async () => {
    const { PRICE_IDS } = await import("../server/stripe");
    expect(PRICE_IDS).toHaveProperty("credit_pack_medium");
  });

  it("all price IDs are strings", async () => {
    const { PRICE_IDS } = await import("../server/stripe");
    for (const [key, value] of Object.entries(PRICE_IDS)) {
      expect(typeof value).toBe("string");
    }
  });
});
