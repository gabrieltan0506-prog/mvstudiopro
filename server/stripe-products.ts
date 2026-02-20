/**
 * Stripe Products & Prices configuration
 * Maps our plan types to Stripe price IDs (created dynamically on first use)
 */
import Stripe from "stripe";
import { ENV } from "./_core/env";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    _stripe = new Stripe(key, { apiVersion: "2025-04-30.basil" as any });
  }
  return _stripe;
}

// ─── Subscription Products ──────────────────
export const SUBSCRIPTION_PRODUCTS = {
  pro_monthly: {
    name: "MV Studio Pro - 专业版 (月付)",
    description: "每月 500 Credits，无限 MV 分析、虚拟偶像、分镜脚本",
    priceAmount: 2900, // $29.00
    currency: "usd",
    interval: "month" as const,
    planType: "pro" as const,
    credits: 500,
  },
  pro_yearly: {
    name: "MV Studio Pro - 专业版 (年付)",
    description: "每月 500 Credits，年付享 20% 折扣",
    priceAmount: 27800, // $278.00
    currency: "usd",
    interval: "year" as const,
    planType: "pro" as const,
    credits: 500,
  },
  enterprise_monthly: {
    name: "MV Studio Pro - 企业版 (月付)",
    description: "每月 2000 Credits，API 访问、白标授权、团队席位",
    priceAmount: 9900, // $99.00
    currency: "usd",
    interval: "month" as const,
    planType: "enterprise" as const,
    credits: 2000,
  },
  enterprise_yearly: {
    name: "MV Studio Pro - 企业版 (年付)",
    description: "每月 2000 Credits，年付享 20% 折扣",
    priceAmount: 95000, // $950.00
    currency: "usd",
    interval: "year" as const,
    planType: "enterprise" as const,
    credits: 2000,
  },
} as const;

// ─── Credit Packs (One-time purchase) ───────
export const CREDIT_PACK_PRODUCTS = {
  small: {
    name: "100 Credits 入门包",
    description: "100 Credits，适合轻度使用",
    priceAmount: 999, // $9.99
    currency: "usd",
    credits: 100,
  },
  medium: {
    name: "250 Credits 进阶包",
    description: "250 Credits，性价比之选",
    priceAmount: 2299, // $22.99
    currency: "usd",
    credits: 250,
  },
  large: {
    name: "500 Credits 专业包",
    description: "500 Credits，专业创作者首选",
    priceAmount: 3999, // $39.99
    currency: "usd",
    credits: 500,
  },
} as const;

// ─── Student Plans ──────────────────────────
export const STUDENT_PRODUCTS = {
  student_half_year: {
    name: "创作者扶持计划 (半年)",
    description: "学生专属优惠，半年使用权",
    priceAmount: 1200, // $12.00
    currency: "usd",
    interval: "month" as const,
    intervalCount: 6,
  },
  student_yearly: {
    name: "创作者扶持计划 (一年)",
    description: "学生专属优惠，一年使用权",
    priceAmount: 2000, // $20.00
    currency: "usd",
    interval: "year" as const,
    intervalCount: 1,
  },
} as const;

// ─── Dynamic Price Creation ─────────────────
// Cache created price IDs to avoid re-creating
const priceCache = new Map<string, string>();

export async function getOrCreatePrice(
  productKey: string,
  config: { name: string; description: string; priceAmount: number; currency: string; interval?: string }
): Promise<string> {
  const cacheKey = `${productKey}_${config.priceAmount}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey)!;

  const stripe = getStripe();

  // Search for existing product
  const products = await stripe.products.search({
    query: `metadata['key']:'${productKey}'`,
  });

  let productId: string;
  if (products.data.length > 0) {
    productId = products.data[0].id;
  } else {
    const product = await stripe.products.create({
      name: config.name,
      description: config.description,
      metadata: { key: productKey },
    });
    productId = product.id;
  }

  // Search for existing price
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 10,
  });

  const matchingPrice = prices.data.find(
    (p) => p.unit_amount === config.priceAmount && p.currency === config.currency
  );

  if (matchingPrice) {
    priceCache.set(cacheKey, matchingPrice.id);
    return matchingPrice.id;
  }

  // Create new price
  const priceParams: Stripe.PriceCreateParams = {
    product: productId,
    unit_amount: config.priceAmount,
    currency: config.currency,
  };

  if (config.interval) {
    priceParams.recurring = { interval: config.interval as "month" | "year" };
  }

  const price = await stripe.prices.create(priceParams);
  priceCache.set(cacheKey, price.id);
  return price.id;
}
