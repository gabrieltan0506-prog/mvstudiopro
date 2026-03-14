import type { GrowthHandoff } from "@shared/growth";

export const GROWTH_HANDOFF_STORAGE_KEY = "mvsp-growth-handoff";
const GROWTH_HANDOFF_VERSION = 1;

export type PersistedGrowthHandoff = {
  version: number;
  source: "creator-growth-camp";
  savedAt: string;
  handoff: GrowthHandoff;
};

export function saveGrowthHandoff(handoff: GrowthHandoff | null) {
  if (!handoff || typeof window === "undefined") return null;
  const payload: PersistedGrowthHandoff = {
    version: GROWTH_HANDOFF_VERSION,
    source: "creator-growth-camp",
    savedAt: new Date().toISOString(),
    handoff,
  };
  window.localStorage.setItem(GROWTH_HANDOFF_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function readGrowthHandoff(): PersistedGrowthHandoff | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(GROWTH_HANDOFF_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedGrowthHandoff | GrowthHandoff;
    if (parsed && typeof parsed === "object" && "handoff" in parsed) {
      return parsed as PersistedGrowthHandoff;
    }
    return {
      version: GROWTH_HANDOFF_VERSION,
      source: "creator-growth-camp",
      savedAt: "",
      handoff: parsed as GrowthHandoff,
    };
  } catch {
    return null;
  }
}

export function getGrowthHandoffStatus(handoff: GrowthHandoff | null) {
  const missing: string[] = [];
  if (!handoff?.brief?.trim()) missing.push("brief");
  if (!handoff?.storyboardPrompt?.trim()) missing.push("storyboardPrompt");
  if (!handoff?.workflowPrompt?.trim()) missing.push("workflowPrompt");
  if (!handoff?.businessGoal?.trim()) missing.push("businessGoal");
  if (!handoff?.recommendedTrack?.trim()) missing.push("recommendedTrack");
  if (!handoff?.recommendedPlatforms?.length) missing.push("recommendedPlatforms");
  return {
    ready: missing.length === 0,
    missing,
  };
}
