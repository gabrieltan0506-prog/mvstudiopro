import type {
  GrowthAnalysisScores,
  GrowthAssetAdaptation,
  GrowthHandoff,
  GrowthPremiumRemix,
  GrowthPremiumRemixAssets,
  GrowthTitleExecution,
} from "@shared/growth";

export const PREMIUM_REMIX_DRAFT_STORAGE_KEY = "mvsp-premium-remix-draft-v3";
const PREMIUM_REMIX_DRAFT_VERSION = 3;

export type PersistedPremiumRemixDraft = {
  version: number;
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
    version: PREMIUM_REMIX_DRAFT_VERSION,
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
    const parsed = JSON.parse(raw) as PersistedPremiumRemixDraft;
    if (!parsed || Number(parsed.version) !== PREMIUM_REMIX_DRAFT_VERSION) {
      window.localStorage.removeItem(PREMIUM_REMIX_DRAFT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    window.localStorage.removeItem(PREMIUM_REMIX_DRAFT_STORAGE_KEY);
    return null;
  }
}

export function clearPremiumRemixDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREMIUM_REMIX_DRAFT_STORAGE_KEY);
}
