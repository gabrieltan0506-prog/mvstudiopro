export type GrowthMonotonicSnapshot = {
  activePlatforms?: unknown;
  platforms?: Record<string, {
    currentTotal?: unknown;
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

export function hasGrowthMonotonicRegressionForPlatform(
  regressions: string[],
  platform: string,
): boolean;
