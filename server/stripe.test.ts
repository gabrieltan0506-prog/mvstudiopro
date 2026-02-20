import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { SUBSCRIPTION_PRODUCTS, CREDIT_PACK_PRODUCTS } from "./stripe-products";

function createAuthContext() {
  const ctx: TrpcContext = {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: { origin: "https://mvstudiopro.com" },
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
  return ctx;
}

describe("Stripe Products Configuration", () => {
  it("has all subscription products defined", () => {
    expect(SUBSCRIPTION_PRODUCTS.pro_monthly).toBeDefined();
    expect(SUBSCRIPTION_PRODUCTS.pro_yearly).toBeDefined();
    expect(SUBSCRIPTION_PRODUCTS.enterprise_monthly).toBeDefined();
    expect(SUBSCRIPTION_PRODUCTS.enterprise_yearly).toBeDefined();
  });

  it("has correct pricing for pro monthly", () => {
    expect(SUBSCRIPTION_PRODUCTS.pro_monthly.priceAmount).toBe(2900);
    expect(SUBSCRIPTION_PRODUCTS.pro_monthly.currency).toBe("usd");
    expect(SUBSCRIPTION_PRODUCTS.pro_monthly.interval).toBe("month");
  });

  it("has correct pricing for enterprise yearly", () => {
    expect(SUBSCRIPTION_PRODUCTS.enterprise_yearly.priceAmount).toBe(95000);
    expect(SUBSCRIPTION_PRODUCTS.enterprise_yearly.interval).toBe("year");
  });

  it("has all credit pack products defined", () => {
    expect(CREDIT_PACK_PRODUCTS.small).toBeDefined();
    expect(CREDIT_PACK_PRODUCTS.medium).toBeDefined();
    expect(CREDIT_PACK_PRODUCTS.large).toBeDefined();
  });

  it("credit packs have correct credits", () => {
    expect(CREDIT_PACK_PRODUCTS.small.credits).toBe(100);
    expect(CREDIT_PACK_PRODUCTS.medium.credits).toBe(250);
    expect(CREDIT_PACK_PRODUCTS.large.credits).toBe(500);
  });

  it("yearly plans offer discount over monthly", () => {
    const proMonthlyAnnual = SUBSCRIPTION_PRODUCTS.pro_monthly.priceAmount * 12;
    const proYearly = SUBSCRIPTION_PRODUCTS.pro_yearly.priceAmount;
    expect(proYearly).toBeLessThan(proMonthlyAnnual);

    const entMonthlyAnnual = SUBSCRIPTION_PRODUCTS.enterprise_monthly.priceAmount * 12;
    const entYearly = SUBSCRIPTION_PRODUCTS.enterprise_yearly.priceAmount;
    expect(entYearly).toBeLessThan(entMonthlyAnnual);
  });
});

describe("Stripe Router", () => {
  it("stripe.status route exists on appRouter", () => {
    const caller = appRouter.createCaller(createAuthContext());
    expect(caller.stripe).toBeDefined();
    expect(caller.stripe.status).toBeDefined();
  });

  it("stripe.createSubscription route exists", () => {
    const caller = appRouter.createCaller(createAuthContext());
    expect(caller.stripe.createSubscription).toBeDefined();
  });

  it("stripe.purchaseCredits route exists", () => {
    const caller = appRouter.createCaller(createAuthContext());
    expect(caller.stripe.purchaseCredits).toBeDefined();
  });

  it("stripe.cancelSubscription route exists", () => {
    const caller = appRouter.createCaller(createAuthContext());
    expect(caller.stripe.cancelSubscription).toBeDefined();
  });

  it("stripe.history route exists", () => {
    const caller = appRouter.createCaller(createAuthContext());
    expect(caller.stripe.history).toBeDefined();
  });
});
