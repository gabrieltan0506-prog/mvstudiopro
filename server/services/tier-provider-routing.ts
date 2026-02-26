import { and, eq } from "drizzle-orm";
import { betaQuotas } from "../../drizzle/schema-beta";
import { getDb } from "../db";
import { getUserPlan } from "../credits";
import type { GenerationProvider } from "./provider-manager";

export type UserTier = "free" | "beta" | "paid";
export type ProviderSurface = "image" | "video" | "text";

const PROVIDER_CHAINS: Record<UserTier, Record<ProviderSurface, GenerationProvider[]>> = {
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
  return tier !== "paid";
}

export async function resolveUserTier(userId: number, isAdminUser: boolean): Promise<UserTier> {
  if (isAdminUser) return "paid";

  const plan = await getUserPlan(userId);
  if (plan === "pro" || plan === "enterprise") {
    return "paid";
  }

  const db = await getDb();
  if (!db) return "free";

  const [activeBeta] = await db
    .select({ id: betaQuotas.id })
    .from(betaQuotas)
    .where(and(eq(betaQuotas.userId, userId), eq(betaQuotas.isActive, true)))
    .limit(1);

  return activeBeta ? "beta" : "free";
}
