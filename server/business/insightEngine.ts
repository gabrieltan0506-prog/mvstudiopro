export interface BusinessInsight {
  commercialModel: string[];
  targetAudience: string;
  conversionPoint: string;
}

export async function buildInsight(_data: unknown): Promise<BusinessInsight> {
  return {
    commercialModel: [
      "带货",
      "品牌合作",
    ],
    targetAudience: "年轻家庭",
    conversionPoint: "评论区引导购买",
  };
}
