import fs from "node:fs";
import path from "node:path";
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
    "开店经验",
    "同城探店",
    "夫妻创业",
    "门店经营",
    "摆摊创业",
    "工厂直发",
    "县城创业",
    "餐饮老板",
    "装修避坑",
    "二手车",
    "宝妈副业",
    "养殖种植",
    "家常做饭",
    "物流发货",
    "三农带货",
    "真实口碑",
    "好物测评",
    "省钱攻略",
    "实体老板",
    "同城招聘",
  ],
};

type CachedTrendItem = {
  title?: string;
  author?: string;
  tags?: string[];
  industryLabels?: string[];
};

type CachedTrendCollection = {
  items?: CachedTrendItem[];
};

type CachedTrendStore = {
  collections?: Partial<Record<GrowthPlatform, CachedTrendCollection>>;
};

const CACHE_PATH = path.resolve(process.cwd(), ".cache/growth-trends.json");
const SOURCE_PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "bilibili"];

function normalizeSeed(value: string) {
  return String(value || "")
    .trim()
    .replace(/^[@#]/, "")
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldKeepSeed(seed: string) {
  if (!seed) return false;
  if (seed.length < 2 || seed.length > 18) return false;
  if (/^[\d\s]+$/.test(seed)) return false;
  if (/^(待判定行业|泛年龄|泛内容|热点话题)$/.test(seed)) return false;
  return true;
}

function splitCandidateTerms(value: string) {
  const normalized = normalizeSeed(value);
  if (!normalized) return [];
  const direct = shouldKeepSeed(normalized) ? [normalized] : [];
  const pieces = normalized
    .split(/[|/、，,：:；;！!？?\-]+/)
    .map((item) => item.trim())
    .filter(shouldKeepSeed);
  const chineseChunks = (normalized.match(/[A-Za-z0-9\u4e00-\u9fa5]{2,12}/g) || [])
    .map((item) => item.trim())
    .filter(shouldKeepSeed);
  return Array.from(new Set([...direct, ...pieces, ...chineseChunks]));
}

function loadCachedTrendStore(): CachedTrendStore | null {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CachedTrendStore;
  } catch {
    return null;
  }
}

function buildCrossPlatformDynamicSeeds(platform: GrowthPlatform) {
  if (platform !== "kuaishou") return [];
  const store = loadCachedTrendStore();
  if (!store?.collections) return [];

  const collected: string[] = [];
  for (const sourcePlatform of SOURCE_PLATFORMS) {
    const collection = store.collections[sourcePlatform];
    const items = Array.isArray(collection?.items) ? collection.items : [];
    for (const item of items.slice(0, 200)) {
      collected.push(...splitCandidateTerms(item.title || ""));
      collected.push(...splitCandidateTerms(item.author || ""));
      for (const tag of item.tags || []) collected.push(...splitCandidateTerms(tag));
      for (const label of item.industryLabels || []) collected.push(...splitCandidateTerms(label));
    }
  }

  return Array.from(new Set(collected)).slice(0, 120);
}

export function getPlatformSeeds(platform: GrowthPlatform) {
  const envSeeds = String(process.env[`${platform.toUpperCase()}_TREND_KEYWORDS`] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const base = PLATFORM_SEEDS[platform] || [];
  const crossPlatformSeeds =
    platform === "kuaishou"
      ? [
          ...(PLATFORM_SEEDS.douyin || []),
          ...(PLATFORM_SEEDS.xiaohongshu || []),
          ...(PLATFORM_SEEDS.bilibili || []),
        ]
      : [];
  const dynamicSeeds = buildCrossPlatformDynamicSeeds(platform);
  return Array.from(
    new Set([...envSeeds, ...base, ...crossPlatformSeeds, ...dynamicSeeds, ...GLOBAL_SEEDS].filter(shouldKeepSeed)),
  );
}
