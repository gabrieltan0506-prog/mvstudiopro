import { and, eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { betaQuotas } from "../../drizzle/schema-beta";
import { getDb } from "../db";
import { getUserPlan } from "../credits";
import type { GenerationProvider } from "./provider-manager";
import { hasUnlimitedAccess, isSupervisorAccount } from "./access-policy";

export type UserTier = "free" | "beta" | "paid" | "supervisor";
export type ProviderSurface = "image" | "video" | "text";

const PROVIDER_CHAINS: Record<UserTier, Record<ProviderSurface, GenerationProvider[]>> = {
  supervisor: {
    image: ["nano-banana-pro", "forge", "kling_image"],
    video: ["veo_3_1", "kling_beijing", "fal_kling_video", "cometapi"],
    text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
  },
  free: {
    image: ["forge", "nano-banana-pro", "kling_image"],
    video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
    text: ["basic_model", "gemini_3_flash", "gemini_3_pro", "gpt_5_1"],
  },
  beta: {
    image: ["forge", "nano-banana-pro", "kling_image"],
    video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
    text: ["gemini_3_flash", "basic_model", "gemini_3_pro", "gpt_5_1"],
  },
  paid: {
    image: ["nano-banana-pro", "forge", "kling_image"],
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
