import Stripe from "stripe";

/**
 * Stripe SDK 初始化
 * 
 * STRIPE_SECRET_KEY 必须在 server 端使用，绝不以 NEXT_PUBLIC_ 前缀暴露到客户端。
 */

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!_stripe && process.env.STRIPE_SECRET_KEY) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-12-18.acacia" as any,
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Stripe Price IDs — 在 Stripe Dashboard 创建产品后填入环境变量
 */
export const PRICE_IDS = {
  pro_monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? "",
  pro_yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID ?? "",
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "",
  credit_pack_small: process.env.STRIPE_CREDIT_PACK_SMALL_PRICE_ID ?? "",
  credit_pack_medium: process.env.STRIPE_CREDIT_PACK_MEDIUM_PRICE_ID ?? "",
  credit_pack_large: process.env.STRIPE_CREDIT_PACK_LARGE_PRICE_ID ?? "",
} as const;
