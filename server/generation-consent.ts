import {
  createOrUpdateContentUsageAgreement,
  getContentUsageAgreementByUserId,
  hasAgreedToContentUsage,
} from "./db-extended";
import { getUserPlan } from "./credits";

export const CONSENT_REQUIRED_CODE = "CONSENT_REQUIRED";

export function isPaidPlan(plan: string): boolean {
  return plan === "paid" || plan === "pro" || plan === "enterprise";
}

export async function isPaidUser(userId: number, role?: string): Promise<boolean> {
  if (role === "admin") return true;
  const plan = await getUserPlan(userId);
  return isPaidPlan(plan);
}

export async function ensureGenerationConsent(userId: number): Promise<void> {
  const accepted = await hasAgreedToContentUsage(userId);
  if (accepted) return;

  const err = new Error("Generation consent required") as Error & { code?: string };
  err.code = CONSENT_REQUIRED_CODE;
  throw err;
}

export async function getGenerationConsentStatus(userId: number): Promise<{ hasAccepted: boolean; acceptedAt: string | null }> {
  const agreement = await getContentUsageAgreementByUserId(userId);
  return {
    hasAccepted: Boolean(agreement?.agreedToTerms),
    acceptedAt: agreement?.agreedAt ? agreement.agreedAt.toISOString() : null,
  };
}

export async function acceptGenerationConsent(userId: number): Promise<{ acceptedAt: string }> {
  const now = new Date();
  const existing = await getContentUsageAgreementByUserId(userId);

  await createOrUpdateContentUsageAgreement({
    userId,
    agreedToTerms: true,
    agreedAt: now,
    allowPlatformDisplay: existing?.allowPlatformDisplay ?? true,
    allowMarketingUse: existing?.allowMarketingUse ?? true,
    allowModelTraining: existing?.allowModelTraining ?? true,
    preferAnonymous: existing?.preferAnonymous ?? false,
  });

  return { acceptedAt: now.toISOString() };
}
