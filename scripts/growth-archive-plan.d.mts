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
