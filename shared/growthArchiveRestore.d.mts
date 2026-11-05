export type GrowthArchiveInventoryFile = { path: string; bytes: number; sha256: string; items: number };
export type GrowthArchiveColdManifest = {
  schemaVersion: number;
  dir: string;
  sourceFingerprint?: string;
  archive: { assetName: string; bytes: number; sha256: string };
  parts: Array<{ assetName: string; bytes: number; sha256: string; index: number }>;
  inventory?: GrowthArchiveInventoryFile[];
};
export function parseGrowthArchiveManifest(value: unknown, dir: string): GrowthArchiveColdManifest;
export function restoreGrowthArchive(options: {
  dir: string;
  cacheRoot: string;
  fetchAsset: (name: string, legacyOnly: boolean, releaseTag?: string) => Promise<Response | null>;
}): Promise<string | null>;
