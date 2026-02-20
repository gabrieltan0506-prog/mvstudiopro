export type PlanType = "free" | "pro" | "enterprise";

export interface PlanConfig {
  name: string;
  nameCn: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlyCredits: number;
  features: string[];
  featuresCn: string[];
  limits: {
    mvAnalysis: number;
    idolGeneration: number;
    storyboard: number;
    videoGeneration: number;
    idol3D: number;
  };
}

export const PLANS: Record<PlanType, PlanConfig> = {
  free: {
    name: "Free",
    nameCn: "免費版",
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlyCredits: 0,
    features: [
      "MV Analysis (first 2 free)",
      "Virtual Idol Generation (first 3 free)",
      "Storyboard Generation (first 1 free)",
      "MV Gallery Browsing",
      "Basic Community Features",
    ],
    featuresCn: [
      "视频PK评分（前 2 次免费）",
      "虛擬偶像生成（前 3 個免費）",
      "分鏡腳本生成（第 1 次免費）",
      "MV 展廳瀏覽",
      "基礎社區功能",
    ],
    limits: { mvAnalysis: 2, idolGeneration: 3, storyboard: 1, videoGeneration: 0, idol3D: 0 },
  },
  pro: {
    name: "Pro",
    nameCn: "專業版",
    monthlyPrice: 29,
    yearlyPrice: 278,
    monthlyCredits: 500,
    features: [
      "All Free features",
      "Unlimited MV Analysis",
      "Unlimited Virtual Idol Generation",
      "Unlimited Storyboard Generation",
      "MV Generation",
      "Idol Image to 3D",
      "PDF Report Export",
      "Priority Processing Queue",
      "500 Credits/month",
    ],
    featuresCn: [
      "所有免費版功能",
      "无限视频PK评分",
      "無限虛擬偶像生成",
      "無限分鏡腳本生成",
      "MV 生成",
      "偶像圖片轉 3D",
      "PDF 報告導出",
      "優先處理隊列",
      "每月 500 Credits",
    ],
    limits: { mvAnalysis: -1, idolGeneration: -1, storyboard: -1, videoGeneration: -1, idol3D: -1 },
  },
  enterprise: {
    name: "Enterprise",
    nameCn: "企業版",
    monthlyPrice: 99,
    yearlyPrice: 950,
    monthlyCredits: 2000,
    features: [
      "All Pro features",
      "API Access",
      "White-label License",
      "Dedicated Support",
      "Team Seats",
      "Custom Branding",
      "2000 Credits/month",
      "Invoice Payment",
    ],
    featuresCn: [
      "所有專業版功能",
      "API 存取",
      "白標授權",
      "專屬客服",
      "團隊席位",
      "自訂品牌",
      "每月 2000 Credits",
      "發票付款",
    ],
    limits: { mvAnalysis: -1, idolGeneration: -1, storyboard: -1, videoGeneration: -1, idol3D: -1 },
  },
};

export const CREDIT_COSTS = {
  mvAnalysis: 8,
  idolGeneration: 3,
  storyboard: 15,
  videoGeneration: 25,
  idol3D: 10,
  inspiration: 5,
  storyboardImage2K: 5,
  storyboardImage4K: 9,
} as const;

export const CREDIT_PACKS = {
  small: { credits: 100, price: 9.99, label: "100 Credits", labelCn: "100 Credits 入門包" },
  medium: { credits: 250, price: 22.99, label: "250 Credits", labelCn: "250 Credits 進階包" },
  large: { credits: 500, price: 39.99, label: "500 Credits", labelCn: "500 Credits 專業包" },
} as const;
