export const GROWTH_BACKUP_POINTER: string;
export const GROWTH_BACKUP_MANIFEST: string;
export const GROWTH_BACKUP_PART_BYTES: number;
export type BackupPart = {
  assetName: string;
  bytes: number;
  sha256: string;
  index: number;
  offset: number;
};
export type BackupGenerationFile = {
  logicalAssetName: string;
  bytes: number;
  sha256: string;
  parts: BackupPart[];
};
export type BackupGenerationPointer = {
  schemaVersion: number;
  batchId: string;
  releaseTag: string;
  manifest: { assetName: string; bytes: number; sha256: string };
};
export type BackupGenerationManifest = {
  schemaVersion: number;
  batchId: string;
  releaseTag: string;
  scope: string;
  coverage: unknown;
  files: BackupGenerationFile[];
};
export type BackupGeneration = {
  pointer: BackupGenerationPointer;
  manifest: BackupGenerationManifest;
};
export function generationAssetUrl(
  baseUrl: string,
  releaseTag: string,
  assetName: string
): string;
export function validateBackupGenerationManifest(
  manifest: unknown,
  pointer: BackupGenerationPointer
): BackupGenerationManifest;
export function loadGrowthBackupGeneration(
  baseUrl: string,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal }
): Promise<BackupGeneration | null>;
export function downloadGrowthBackupGenerationAsset(options: {
  baseUrl: string;
  logicalName: string;
  cacheDir: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  generation?: BackupGeneration | null | Promise<BackupGeneration | null>;
}): Promise<{
  attempted: boolean;
  filePath: string | null;
  generationId?: string;
}>;
