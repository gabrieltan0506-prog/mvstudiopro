// Credit costs configuration
export const CREDIT_COSTS = {
  storyboard: 5,
  analysis: 3,
  avatar: 10,
  videoGenerationFast720: 15,
  videoGenerationFast1080: 25,
  videoGenerationStd720: 20,
  videoGenerationStd1080: 35,
  threeDConversion: 20,
  audioAnalysis: 5,
  imageGeneration: 8,
  remixVideo: 15,
  wechatSticker: 5,
};

export type CreditCostKey = keyof typeof CREDIT_COSTS;

export function getCreditCost(key: CreditCostKey): number {
  return CREDIT_COSTS[key] || 0;
}
