export type GrowthMonotonicSnapshot = {
  activePlatforms?: unknown;
  platforms?: Record<string, {
    currentTotal?: unknown;
    currentRetentionCap?: unknown;
    archivedTotal?: unknown;
  }>;
};

export function resolveGuardPlatforms(
  baseline: GrowthMonotonicSnapshot,
  before: GrowthMonotonicSnapshot,
  after: GrowthMonotonicSnapshot,
): Set<string>;

export function findGrowthMonotonicRegressions(input: {
  baseline: GrowthMonotonicSnapshot;
  before: GrowthMonotonicSnapshot;
  after: GrowthMonotonicSnapshot;
  enforceArchived?: boolean;
  currentTolerance?: number;
}): string[];
