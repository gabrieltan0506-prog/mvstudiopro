import type {
  GrowthAnalysisScores,
  GrowthAssetAdaptation,
  GrowthHandoff,
  GrowthPremiumRemix,
  GrowthPremiumRemixAssets,
  GrowthTitleExecution,
} from "@shared/growth";

export const PREMIUM_REMIX_DRAFT_STORAGE_KEY = "mvsp-premium-remix-draft";

export type PersistedPremiumRemixDraft = {
  version: 1;
  savedAt: string;
  context: string;
  transcript: string;
  analyzedVideoUrl: string;
  analysis: GrowthAnalysisScores | null;
  titleExecutions: GrowthTitleExecution[];
  assetAdaptation: GrowthAssetAdaptation | null;
  growthHandoff: GrowthHandoff | null;
  creationStoryboardPrompt: string;
  premiumRemix: GrowthPremiumRemix | null;
  premiumRemixAssets: GrowthPremiumRemixAssets | null;
};

export function savePremiumRemixDraft(draft: Omit<PersistedPremiumRemixDraft, "version" | "savedAt">) {
  if (typeof window === "undefined") return null;
  const payload: PersistedPremiumRemixDraft = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...draft,
  };
  window.localStorage.setItem(PREMIUM_REMIX_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function readPremiumRemixDraft(): PersistedPremiumRemixDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PREMIUM_REMIX_DRAFT_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedPremiumRemixDraft;
  } catch {
    return null;
  }
}

