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
      credits: 0,
      roleTag: "normal",
      contactWechat: null,
      contactPhone: null,
      verifyStatus: "none",
      enterpriseTrialPaid: false,
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
    } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
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

/**
 * caller 是 Proxy，任何键都会返回函数——`caller.stripe.随便写` 也能 toBeDefined。
 * 旧断言查的四个名字（status/createSubscription/purchaseCredits/history）路由里根本没有，
 * 却一路绿灯。改查 `_def.procedures` 的真实键名，写错才会红。
 */
describe("Stripe Router", () => {
  const procedureNames = Object.keys(appRouter._def.procedures)
    .filter((k) => k.startsWith("stripe."))
    .map((k) => k.slice("stripe.".length));

  it.each([
    "getPlans",
    "getSubscription",
    "createCheckoutSession",
    "createCreditPackCheckout",
    "cancelSubscription",
    "getTransactions",
  ])("stripe.%s route exists on appRouter", (name) => {
    expect(procedureNames).toContain(name);
  });

  it("caller 能拿到 stripe 子路由", () => {
    const caller = appRouter.createCaller(createAuthContext());
    expect(caller.stripe).toBeDefined();
  });
});
