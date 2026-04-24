import { and, eq, not, like, count, isNotNull } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { betaQuotas } from "../../drizzle/schema-beta";
import { paymentSubmissions } from "../../drizzle/schema-payments";
import { creditTransactions } from "../../drizzle/schema-stripe";
import { getDb } from "../db";
import { getUserPlan } from "../credits";
import type { GenerationProvider } from "./provider-manager";
import { hasUnlimitedAccess, isSupervisorAccount } from "./access-policy";

export type UserTier = "free" | "beta" | "paid" | "supervisor";
export type ProviderSurface = "image" | "video" | "text";

const PROVIDER_CHAINS: Record<UserTier, Record<ProviderSurface, GenerationProvider[]>> = {
  supervisor: {
    image: ["nano-banana-pro", "nano-banana-flash", "kling_image"],
    video: ["veo_3_1", "kling_beijing", "fal_kling_video", "cometapi"],
    text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
  },
  free: {
    image: ["nano-banana-flash", "nano-banana-pro", "kling_image"],
    video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
    text: ["basic_model", "gemini_3_flash", "gemini_3_pro"],
  },
  beta: {
    image: ["nano-banana-flash", "nano-banana-pro", "kling_image"],
    video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
    text: ["gemini_3_flash", "basic_model", "gemini_3_pro"],
  },
  paid: {
    image: ["nano-banana-pro", "nano-banana-flash", "kling_image"],
    video: ["veo_3_1", "fal_kling_video", "kling_beijing", "cometapi"],
    text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
  },
};

export function getTierProviderChain(tier: UserTier, surface: ProviderSurface): GenerationProvider[] {
  return [...PROVIDER_CHAINS[tier][surface]];
}

export function shouldApplyWatermarkForTier(tier: UserTier): boolean {
  return tier !== "paid" && tier !== "supervisor";
}

/**
 * 精細化水印判斷：僅試用包（trial199）帳號才需要加水印。
 * 只要曾有任何正式加值包（non-trial199 靜態付款審核通過，或 Stripe 正式購買），
 * 即視為付費用戶，不加水印。
 */
export async function resolveWatermark(userId: number, isAdminUser: boolean): Promise<boolean> {
  const tier = await resolveUserTier(userId, isAdminUser);
  // role-based paid / supervisor → 一律不加水印
  if (tier === "paid" || tier === "supervisor") return false;

  const db = await getDb();
  if (!db) return true;

  // 靜態付款：是否有任何非 trial199 的審核通過訂單
  const [staticRow] = await db
    .select({ n: count() })
    .from(paymentSubmissions)
    .where(
      and(
        eq(paymentSubmissions.userId, userId),
        eq(paymentSubmissions.status, "approved"),
        not(like(paymentSubmissions.packageType, "trial199_%")),
      ),
    );
  if (Number(staticRow?.n ?? 0) > 0) return false;

  // Stripe 購買：source="purchase" 且有 stripePaymentIntentId（Stripe 僅開放 small/medium/large，非 trial）
  const [stripeRow] = await db
    .select({ n: count() })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        eq(creditTransactions.source, "purchase"),
        isNotNull(creditTransactions.stripePaymentIntentId),
      ),
    );
  if (Number(stripeRow?.n ?? 0) > 0) return false;

  // 僅 trial199 或免費帳號 → 加水印
  return true;
}

export async function resolveUserTier(userId: number, isAdminUser: boolean): Promise<UserTier> {
  try {
    const db = await getDb();
    const [user] = db
      ? await db
          .select({ role: users.role, email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      : [];

    if (hasUnlimitedAccess({ role: user?.role, email: user?.email })) {
      return isSupervisorAccount({ role: user?.role, email: user?.email })
        ? "supervisor"
        : "paid";
    }

    if (isAdminUser) return "paid";
    if (user?.role === "supervisor") return "supervisor";
    if (user?.role === "paid") return "paid";
    if (user?.role === "beta") return "beta";
    if (user?.role === "free") return "free";

    const plan = await getUserPlan(userId);
    if (plan === "pro" || plan === "enterprise") {
      return "paid";
    }

    if (!db) return "free";

    const [activeBeta] = await db
      .select({ id: betaQuotas.id })
      .from(betaQuotas)
      .where(and(eq(betaQuotas.userId, userId), eq(betaQuotas.isActive, true)))
      .limit(1);

    return activeBeta ? "beta" : "free";
  } catch (error) {
    console.error("[TierRouting] resolveUserTier failed, defaulting to free:", error);
    return "free";
  }
}
