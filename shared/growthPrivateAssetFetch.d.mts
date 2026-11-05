export function createGrowthPrivateAssetFetch(options: {
  repository: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): typeof fetch;
