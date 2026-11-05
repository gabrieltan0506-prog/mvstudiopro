export const REQUIRED_CORE_FILES: string[];
export const OPTIONAL_CORE_FILES: string[];
export const EXCLUDED_PLATFORMS: string[];
export const REQUIRED_CURRENT_PLATFORMS: string[];
export type GrowthCoverageEntry = {
  path: string; type: string; category: string; bytes: number | null;
  mtimeMs?: number; target?: string; anomaly?: string;
};
export function inventoryGrowthCoverage(root: string): Promise<{
  schemaVersion: number; scope: string; startedAt: string; finishedAt: string;
  contentVerified: false; remoteBackupVerified: false; fullStoreComplete: false;
  dataPlatforms: string[]; sharedLedgersMayContainExcludedPlatformMetadata: true;
  status: string; requiredFiles: string[]; requiredDirectories: string[]; excluded: GrowthCoverageEntry[]; excludedPlatforms: string[]; missingRequired: string[];
  excludedFilesystemMetadata: GrowthCoverageEntry[]; uncovered: GrowthCoverageEntry[]; separate: GrowthCoverageEntry[];
  anomalies: GrowthCoverageEntry[]; errors: Array<{path: string; error: string}>;
  directories: string[]; entries: GrowthCoverageEntry[];
}>;
