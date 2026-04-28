import fs from "node:fs";
import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import { normalizeStringList } from "./trendNormalize";

function parseCsvEnv(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

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
    "电商带货",
    "开店经验",
    "老板IP",
    "陶瓷",
    "家居装修",
    "家装避坑",
    "产品对比",
    "销售方法",
    "成交话术",
    "实拍案例",
    "工厂探访",
    "品牌故事",
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
  toutiao: [
    "热点解读",
    "案例拆解",
    "行业观察",
    "老板IP",
    "副业",
    "本地服务",
    "探店",
    "好物推荐",
    "装修避坑",
    "创业故事",
  ],
};

type KuaishouCreatorSeed = {
  userId: string;
  name: string;
  keyword: string;
};

const KUAISHOU_CREATOR_SEEDS: KuaishouCreatorSeed[] = [
  { userId: "3x3t4yubwineeyc", name: "居家种草", keyword: "种草" },
  { userId: "3x44js8xyu3q7a9", name: "添添种草", keyword: "种草" },
  { userId: "3xqyfwg9w7seies", name: "种草", keyword: "种草" },
];

type CachedTrendItem = {
  title?: string;
  author?: string;
  tags?: string[];
  industryLabels?: string[];
  contentLabels?: string[];
  ageLabels?: string[];
  bucket?: string;
};

type CachedTrendCollection = {
  items?: CachedTrendItem[];
};

type CachedTrendStore = {
  collections?: Partial<Record<GrowthPlatform, CachedTrendCollection>>;
};

const DEFAULT_STORE_ROOT = path.resolve(process.cwd(), ".cache");
const CURRENT_CACHE_PATH = path.resolve(
  process.env.GROWTH_STORE_DIR || path.join(DEFAULT_STORE_ROOT, "growth"),
  "current.json",
);
const LEGACY_CACHE_PATH = path.resolve(
  process.env.GROWTH_LEGACY_STORE_FILE || path.join(DEFAULT_STORE_ROOT, "growth-trends.json"),
);
const SIGNAL_SOURCE_PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "bilibili", "kuaishou", "toutiao"];

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
    const additionalCandidates = [
      path.resolve(process.cwd(), ".cache/growth/current.json"),
      path.resolve(process.cwd(), ".cache/growth-trends.json"),
      "/data/growth/current.json",
      "/data/growth-trends.json",
    ];
    const cachePath = [CURRENT_CACHE_PATH, LEGACY_CACHE_PATH, ...additionalCandidates]
      .find((candidate) => candidate && fs.existsSync(candidate)) || "";
    if (!cachePath) return null;
    return JSON.parse(fs.readFileSync(cachePath, "utf8")) as CachedTrendStore;
  } catch {
    return null;
  }
}

function getCrossPlatformSourceItemLimit(platform: GrowthPlatform) {
  if (platform === "kuaishou") return 600;
  return 200;
}

function getCrossPlatformSeedCap(platform: GrowthPlatform) {
  if (platform === "kuaishou") return 240;
  return 120;
}

function buildCrossPlatformDynamicSeeds(platform: GrowthPlatform) {
  const store = loadCachedTrendStore();
  if (!store?.collections) return [];

  const collected: string[] = [];
  const sourcePlatforms = SIGNAL_SOURCE_PLATFORMS.filter((item) => item !== platform);
  const sourceItemLimit = getCrossPlatformSourceItemLimit(platform);
  for (const sourcePlatform of sourcePlatforms) {
    const collection = store.collections[sourcePlatform];
    const items = Array.isArray(collection?.items) ? collection.items : [];
    for (const item of items.slice(0, sourceItemLimit)) {
      collected.push(...splitCandidateTerms(item.title || ""));
      collected.push(...splitCandidateTerms(item.author || ""));
      for (const tag of normalizeStringList(item.tags)) collected.push(...splitCandidateTerms(tag));
      for (const label of normalizeStringList(item.industryLabels)) collected.push(...splitCandidateTerms(label));
      for (const label of normalizeStringList(item.contentLabels)) collected.push(...splitCandidateTerms(label));
      for (const label of normalizeStringList(item.ageLabels)) collected.push(...splitCandidateTerms(label));
      collected.push(...splitCandidateTerms(item.bucket || ""));
    }
  }

  return Array.from(new Set(collected)).slice(0, getCrossPlatformSeedCap(platform));
}

function buildCrossPlatformTopicSeeds(platform: GrowthPlatform) {
  const store = loadCachedTrendStore();
  if (!store?.collections) return [];

  const topicTerms: string[] = [];
  const sourcePlatforms = SIGNAL_SOURCE_PLATFORMS.filter((item) => item !== platform);
  for (const sourcePlatform of sourcePlatforms) {
    const collection = store.collections[sourcePlatform];
    const items = Array.isArray(collection?.items) ? collection.items : [];
    for (const item of items.slice(0, sourcePlatform === "douyin" ? 500 : 300)) {
      if (String(item.title || "").includes("#")) {
        topicTerms.push(...splitCandidateTerms(item.title || ""));
      }
      for (const tag of normalizeStringList(item.tags)) {
        topicTerms.push(...splitCandidateTerms(tag));
      }
    }
  }

  return Array.from(new Set(topicTerms)).slice(0, platform === "douyin" ? 120 : 80);
}

function buildCrossPlatformAuthorSeeds(platform: GrowthPlatform) {
  const store = loadCachedTrendStore();
  if (!store?.collections) return [];

  const authorTerms: string[] = [];
  const sourcePlatforms = SIGNAL_SOURCE_PLATFORMS.filter((item) => item !== platform);
  for (const sourcePlatform of sourcePlatforms) {
    const collection = store.collections[sourcePlatform];
    const items = Array.isArray(collection?.items) ? collection.items : [];
    for (const item of items.slice(0, sourcePlatform === "douyin" ? 400 : 250)) {
      authorTerms.push(...splitCandidateTerms(item.author || ""));
    }
  }

  return Array.from(new Set(authorTerms)).slice(0, platform === "kuaishou" ? 80 : 40);
}

function buildCrossPlatformSignalSeeds(platform: GrowthPlatform) {
  const store = loadCachedTrendStore();
  if (!store?.collections) return [];

  const collected: string[] = [];
  const sourcePlatforms = SIGNAL_SOURCE_PLATFORMS.filter((item) => item !== platform);
  for (const sourcePlatform of sourcePlatforms) {
    const collection = store.collections[sourcePlatform];
    const items = Array.isArray(collection?.items) ? collection.items : [];
    for (const item of items.slice(0, sourcePlatform === "douyin" ? 600 : 360)) {
      const author = String(item.author || "").trim();
      if (author) {
        collected.push(...splitCandidateTerms(author));
        if (author.length >= 2 && author.length <= 12) {
          collected.push(`${author}同款`);
          collected.push(`${author}风格`);
        }
      }
      for (const tag of normalizeStringList(item.tags)) {
        collected.push(...splitCandidateTerms(tag));
        if (tag.length >= 2 && tag.length <= 12) {
          collected.push(`${tag}教程`);
          collected.push(`${tag}案例`);
        }
      }
      for (const label of normalizeStringList(item.industryLabels)) {
        collected.push(...splitCandidateTerms(label));
        if (label.length >= 2 && label.length <= 12) {
          collected.push(`${label}选题`);
          collected.push(`${label}热点`);
        }
      }
    }
  }

  return Array.from(new Set(collected)).slice(0, platform === "kuaishou" ? 160 : 120);
}

export function getPlatformSeeds(platform: GrowthPlatform) {
  const envSeeds = String(process.env[`${platform.toUpperCase()}_TREND_KEYWORDS`] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const base = PLATFORM_SEEDS[platform] || [];
  const crossPlatformSeeds = SIGNAL_SOURCE_PLATFORMS
    .filter((item) => item !== platform)
    .flatMap((item) => PLATFORM_SEEDS[item] || []);
  const dynamicSeeds = buildCrossPlatformDynamicSeeds(platform);
  const topicSeeds = buildCrossPlatformTopicSeeds(platform);
  const signalSeeds = buildCrossPlatformSignalSeeds(platform);
  return Array.from(
    new Set([...envSeeds, ...base, ...crossPlatformSeeds, ...dynamicSeeds, ...topicSeeds, ...signalSeeds, ...GLOBAL_SEEDS].filter(shouldKeepSeed)),
  );
}

export function getKuaishouDiscoveryKeywords() {
  const envSeeds = parseCsvEnv("KUAISHOU_DISCOVERY_KEYWORDS");
  const platformSeeds = getPlatformSeeds("kuaishou");
  const authorSeeds = buildCrossPlatformAuthorSeeds("kuaishou");
  const prioritized = [
    ...envSeeds,
    ...authorSeeds,
    ...platformSeeds,
  ].filter(shouldKeepSeed);

  return Array.from(new Set(prioritized)).slice(0, 320);
}

export function getKuaishouCreatorSeeds() {
  const envCreators = String(process.env.KUAISHOU_CREATOR_SEEDS || "")
    .split(",")
    .map((entry) => {
      const [userId, name, keyword] = entry.split("|").map((item) => String(item || "").trim());
      return { userId, name, keyword };
    })
    .filter((entry) => entry.userId && entry.name);

  return Array.from(
    new Map(
      [...envCreators, ...KUAISHOU_CREATOR_SEEDS].map((entry) => [
        entry.userId,
        { userId: entry.userId, name: entry.name, keyword: entry.keyword || entry.name },
      ]),
    ).values(),
  );
}
