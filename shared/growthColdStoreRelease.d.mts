export const LEGACY_GROWTH_RELEASE: string;
export function growthColdStoreReleaseTag(assetName: string): string;
export function growthColdStoreAssetUrls(
  baseUrl: string,
  assetName: string
): string[];
export function fetchGrowthColdStoreAsset(
  baseUrl: string,
  assetName: string,
  options?: RequestInit
): Promise<Response | null>;
