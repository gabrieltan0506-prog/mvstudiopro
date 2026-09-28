export interface ArchiveReleaseAsset {
  name: string;
  size: number;
  digest?: string | null;
  state: string;
  releaseTag?: string;
}
export interface ArchiveBatchPlan {
  selected: string[];
  reused: number;
  reclaim: string[];
  reclaimRemaining: number;
  pending: number;
  remaining: number;
}
export function planArchiveBatch(
  snapshot: string,
  assets: ArchiveReleaseAsset[],
  manifests: Map<string, string>
): ArchiveBatchPlan;
export function writeArchivePlan(directory: string, plan: ArchiveBatchPlan): void;
export function loadArchiveInventory(
  directory: string,
  snapshot: string,
  repo: string,
  gh: (args: string[]) => string
): { assets: ArchiveReleaseAsset[]; manifests: Map<string, string> };
