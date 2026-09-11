export interface ArchiveReleaseAsset {
  name: string;
  size: number;
  digest?: string | null;
  state: string;
}
export interface ArchiveBatchPlan {
  selected: string[];
  reused: number;
  pending: number;
  remaining: number;
}
export function planArchiveBatch(
  snapshot: string,
  assets: ArchiveReleaseAsset[],
  manifests: Map<string, string>
): ArchiveBatchPlan;
export function loadArchiveInventory(
  directory: string,
  snapshot: string,
  repo: string,
  gh: (args: string[]) => string
): { assets: ArchiveReleaseAsset[]; manifests: Map<string, string> };
