export type VercelDeploymentLike = {
  uid: string;
  created: number;
  target?: string | null;
  readyState?: string;
};
export declare function isKnownPreviewDeployment(deployment: unknown): boolean;
export declare function isProductionDeployment(deployment: unknown): boolean;
export declare function normalizeKeepDays(raw: unknown, fallbackDays?: number): number;
export declare function selectPrunableDeployments(params: {
  deployments: readonly VercelDeploymentLike[];
  liveProductionIds?: Set<string> | readonly string[];
  keepDays?: number;
  failedKeepDays?: number;
  now?: number;
}): {
  targets: VercelDeploymentLike[];
  breach: VercelDeploymentLike[];
  unknown: number;
  productionCount: number;
};
