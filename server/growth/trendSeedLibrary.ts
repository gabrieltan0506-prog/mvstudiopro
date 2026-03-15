import type { GrowthPlatform } from "@shared/growth";

const GLOBAL_SEEDS = [
  "商业咨询",
  "教育培训",
  "个人成长",
  "家庭关系",
  "健康管理",
  "实体线下",
  "电商卖家",
  "美妆穿搭",
  "母婴育儿",
  "情感心理",
  "AI工具",
  "数码科技",
  "家居家装",
  "汽车出行",
  "三农农业",
  "宠物养护",
  "文旅探店",
  "法律财税",
  "摄影设计",
];

const PLATFORM_SEEDS: Partial<Record<GrowthPlatform, string[]>> = {
  douyin: [
    "种草",
    "探店",
    "剧情口播",
    "直播切片",
    "好物推荐",
    "副业",
    "老板IP",
    "医美护肤",
    "穿搭模板",
    "健身减脂",
  ],
  xiaohongshu: [
    "清单推荐",
    "模板",
    "攻略",
    "避坑",
    "妆容",
    "穿搭",
    "探店",
    "家居",
    "母婴",
    "上岸经验",
  ],
  bilibili: [
    "案例拆解",
    "测评",
    "教程",
    "复盘",
    "工作流",
    "效率",
    "副业",
    "知识区",
    "数码开箱",
    "商业分析",
  ],
  kuaishou: [
    "真实体验",
    "到店",
    "农村生活",
    "带货",
    "口播",
    "宝妈",
    "养生",
    "创业",
    "老板",
    "本地服务",
  ],
};

export function getPlatformSeeds(platform: GrowthPlatform) {
  const envSeeds = String(process.env[`${platform.toUpperCase()}_TREND_KEYWORDS`] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const base = PLATFORM_SEEDS[platform] || [];
  return Array.from(new Set([...envSeeds, ...base, ...GLOBAL_SEEDS]));
}
