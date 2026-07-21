import vm from "node:vm";
import {
  growthPlatformValues,
  type GrowthPlatform,
} from "@shared/growth";
import { classifyTrendItem, countLabels } from "./trendTaxonomy";
import { filterTrendItemsByWindowDays, getTrendItemAgeDays } from "./trendWindow";
import { getKuaishouCreatorSeeds, getKuaishouDiscoveryKeywords, getPlatformSeeds } from "./trendSeedLibrary";
import { nowShanghaiIso, toShanghaiIso } from "./time";
import { normalizeStringList } from "./trendNormalize";
import { getAdaptiveRouteDecision, prioritizeAdaptiveSeeds, recordAdaptiveRouteRun, recordAdaptiveSeedRun } from "./trendAdaptiveConfig";
import { normalizeManhuaMixNameKey } from "../../shared/manhuaDramaClassify";

export type TrendSource = "live" | "seed";

/** 抖音合集/短剧分类：AI 漫剧 vs 普通短剧 vs 无法判定 */
export type DouyinDramaKind = "ai_manhua" | "short_drama" | "unknown";

export type DouyinDramaInfo = {
  mixId: string;
  mixName: string;
  currentEpisode?: number;
  totalEpisodes?: number;
  /** 合集总播放量（剧级热度主指标） */
  mixPlayCount?: number;
};

export type TrendItem = {
  id: string;
  title: string;
  bucket?: string;
  author?: string;
  /** 平台 V 认证 / 企业认证 / 蓝V — 任何一种 verify 都置 true（用于过滤投流账号） */
  authorVerified?: boolean;
  /** 账号身份分类（让"个人创作者爆发信号"区别于"企业号付费投流"）
   *  - personal: 个人原生创作者（最值得参考的"自然爆发"信号）
   *  - creator: 已认证 MCN/达人（中性）
   *  - enterprise: 企业蓝V/品牌/旗舰店（极易投流，应排除或重度降权）
   *  - media: 官媒/新闻号（信息流性质，与商业爆款无关，降权）
   *  - government: 政务号（同上）
   *  - unknown: 无法判定
   */
  accountType?: "personal" | "creator" | "enterprise" | "media" | "government" | "unknown";
  /** 账号身份判定依据（debug 用，例如 "verify_type=2" / "name_match:旗舰店"） */
  accountTypeReason?: string;
  url?: string;
  publishedAt?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  hotValue?: number;
  contentType?: "video" | "note" | "topic";
  tags?: string[];
  commentSamples?: Array<{
    author?: string;
    text: string;
    likeCount?: number;
  }>;
  industryLabels?: string[];
  ageLabels?: string[];
  contentLabels?: string[];
  /** 信息流 / DOU+ / 薯条 / 品牌合作标等——平台若返回则标记，便于从「自然爆款」池剔除 */
  isPaidPromotion?: boolean;
  paidPromotionReason?: string;
  /** 是否为短剧/合集（抖音 aweme.mix_info） */
  isDrama?: boolean;
  /** AI 漫剧 / 普通短剧 / 未知（标题+合集名启发式） */
  dramaKind?: DouyinDramaKind;
  dramaInfo?: DouyinDramaInfo;
};

/** 抖音 Web author 常见字段：企业认证、政务媒体、蓝标文案（用于结构化排除商业号） */
function metaFromDouyinAuthor(author: unknown): Partial<Pick<TrendItem, "accountType" | "accountTypeReason" | "authorVerified">> {
  const a = author as Record<string, any> | null | undefined;
  if (!a || typeof a !== "object") return {};
  const ent = String(a.enterprise_verify_reason ?? a.enterpriseVerifyReason ?? "").trim();
  if (ent) {
    return { accountType: "enterprise", accountTypeReason: "douyin:enterprise_verify_reason", authorVerified: true };
  }
  if (a.is_government_media === true || a.isGovernmentMedia === true) {
    return { accountType: "government", accountTypeReason: "douyin:is_government_media", authorVerified: true };
  }
  const custom = String(a.custom_verify ?? a.customVerify ?? "").trim();
  if (custom && /(媒体|新闻|日报社|广播电视台|中央广播电视|财经网|经济观察)/.test(custom)) {
    return { accountType: "media", accountTypeReason: "douyin:custom_verify_media", authorVerified: true };
  }
  if (custom && /(政府|政务|公安|法院|检察|发布|司法局)/.test(custom)) {
    return { accountType: "government", accountTypeReason: "douyin:custom_verify_gov", authorVerified: true };
  }
  return {};
}

const AI_MANHUA_HINT_RE = /AI\s*漫剧|AI漫|动态漫|漫剧|条漫剧|AI\s*短剧|虚拟角色剧/i;
/** DataEye/红果常见漫剧题材切口（无「漫剧」二字时的软判定） */
const AI_MANHUA_SOFT_TITLE_RE = /剑宗|师妹|仙盆|杂灵根|万妖图|罪妻开荒|团宠|重生之|穿越成|系统觉醒|修仙|灵根|宗门/;
const SHORT_DRAMA_HINT_RE = /短剧|红果|竖屏剧|微短剧|连载剧/;

/** 标题 / 合集名 / 标签 → AI 漫剧 vs 普通短剧 */
export function inferDouyinDramaKind(text: string, tags: string[] = []): DouyinDramaKind {
  const hay = `${text} ${tags.join(" ")}`.trim();
  if (!hay) return "unknown";
  if (AI_MANHUA_HINT_RE.test(hay)) return "ai_manhua";
  // 已是合集语境且命中漫剧题材词 → 倾向 AI 漫剧（避免把所有短剧都标成漫剧）
  if (AI_MANHUA_SOFT_TITLE_RE.test(hay) && (tags.includes("AI漫剧检索") || /漫|仙|妖|灵|宗|穿越|重生/.test(hay))) {
    return "ai_manhua";
  }
  if (SHORT_DRAMA_HINT_RE.test(hay)) return "short_drama";
  if (AI_MANHUA_SOFT_TITLE_RE.test(hay)) return "ai_manhua";
  return "unknown";
}

/** 从 aweme.mix_info 提取短剧合集字段 */
export function dramaMetaFromDouyinAweme(
  item: unknown,
  fallbackTitle = "",
  fallbackTags: string[] = [],
): Partial<Pick<TrendItem, "isDrama" | "dramaKind" | "dramaInfo">> {
  const it = item as Record<string, any> | null | undefined;
  if (!it || typeof it !== "object") return {};
  const mix = it.mix_info ?? it.mixInfo ?? it.aweme_info?.mix_info ?? it.aweme_info?.mixInfo;
  if (!mix || typeof mix !== "object") return {};

  const mixId = String(mix.mix_id ?? mix.mixId ?? mix.mix_id_str ?? "").trim();
  const mixName = String(mix.mix_name ?? mix.mixName ?? mix.title ?? "").trim();
  if (!mixId && !mixName) return { isDrama: true, dramaKind: "unknown" };

  const statis = mix.statis ?? mix.stats ?? mix.statistics ?? {};
  const currentEpisode = Number(statis.current_episode ?? statis.currentEpisode ?? mix.current_episode ?? 0) || undefined;
  const totalEpisodes = Number(
    statis.updated_to_episode
    ?? statis.updatedToEpisode
    ?? statis.total_episode
    ?? statis.totalEpisode
    ?? mix.total_episode
    ?? 0,
  ) || undefined;
  const mixPlayCount = Number(
    statis.play_view_count
    ?? statis.playViewCount
    ?? statis.play_count
    ?? statis.playCount
    ?? mix.play_count
    ?? 0,
  ) || undefined;

  const dramaKind = inferDouyinDramaKind(
    `${mixName} ${fallbackTitle} ${String(it.desc ?? "")}`,
    fallbackTags,
  );

  return {
    isDrama: true,
    dramaKind,
    dramaInfo: {
      mixId: mixId || mixName,
      mixName: mixName || mixId || fallbackTitle || "未命名合集",
      currentEpisode,
      totalEpisodes,
      mixPlayCount,
    },
  };
}

/** 抖音单条：信息流广告 / raw_ad + 短剧合集 mix_info */
function metaFromDouyinAweme(
  item: unknown,
  options?: { title?: string; tags?: string[] },
): Partial<Pick<TrendItem, "isPaidPromotion" | "paidPromotionReason" | "isDrama" | "dramaKind" | "dramaInfo">> {
  const it = item as Record<string, any> | null | undefined;
  if (!it || typeof it !== "object") return {};
  const out: Partial<Pick<TrendItem, "isPaidPromotion" | "paidPromotionReason" | "isDrama" | "dramaKind" | "dramaInfo">> = {
    ...dramaMetaFromDouyinAweme(it, options?.title, options?.tags),
  };
  if (it.is_ads === 1 || it.is_ads === true) {
    out.isPaidPromotion = true;
    out.paidPromotionReason = "douyin:is_ads";
  } else if (it.raw_ad_data != null && typeof it.raw_ad_data === "object") {
    out.isPaidPromotion = true;
    out.paidPromotionReason = "douyin:raw_ad_data";
  } else if (it.advertisement != null || it.aweme_advertisement != null) {
    out.isPaidPromotion = true;
    out.paidPromotionReason = "douyin:advertisement";
  } else if (Number(it.ad_label_version ?? it.adLabelVersion ?? 0) > 0) {
    out.isPaidPromotion = true;
    out.paidPromotionReason = "douyin:ad_label_version";
  }
  return out;
}

/** 网页搜索返回体 → aweme 节点列表（兼容 data[].aweme_info / aweme_list） */
export function extractDouyinSearchAwemes(payload: unknown): Array<Record<string, any>> {
  const root = payload as Record<string, any> | null | undefined;
  if (!root || typeof root !== "object") return [];
  const out: Array<Record<string, any>> = [];
  const pushAweme = (aweme: unknown) => {
    if (!aweme || typeof aweme !== "object") return;
    const id = String((aweme as any).aweme_id ?? (aweme as any).group_id ?? "").trim();
    if (!id) return;
    out.push(aweme as Record<string, any>);
  };

  if (Array.isArray(root.aweme_list)) {
    root.aweme_list.forEach(pushAweme);
  }

  const data = root.data;
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      if ((entry as any).aweme_info) pushAweme((entry as any).aweme_info);
      if (Array.isArray((entry as any).aweme_list)) {
        (entry as any).aweme_list.forEach(pushAweme);
      }
      // 部分搜索卡片本身就是 aweme
      if ((entry as any).aweme_id) pushAweme(entry);
    }
  } else if (data && typeof data === "object") {
    if (Array.isArray((data as any).aweme_list)) {
      (data as any).aweme_list.forEach(pushAweme);
    }
  }

  return out;
}

/** 小红书 noteCard / 搜索 note：企业专业号、品牌合作笔记 */
function metaFromXhsNote(noteCard: unknown): Partial<Pick<TrendItem, "accountType" | "accountTypeReason" | "authorVerified" | "isPaidPromotion" | "paidPromotionReason">> {
  const nc = noteCard as Record<string, any> | null | undefined;
  if (!nc || typeof nc !== "object") return {};
  const out: Partial<Pick<TrendItem, "accountType" | "accountTypeReason" | "authorVerified" | "isPaidPromotion" | "paidPromotionReason">> = {};
  const user = nc.user as Record<string, any> | undefined;
  if (user && typeof user === "object") {
    const vt = Number(user.redOfficialVerifyType ?? user.red_official_verify_type ?? NaN);
    // 社区常见：2 ≈ 企业 / 品牌专业号（具体枚举未公开文档，仅用明确企业类）
    if (vt === 2) {
      out.accountType = "enterprise";
      out.accountTypeReason = "xhs:redOfficialVerifyType=2";
      out.authorVerified = true;
    }
    const ut = String(user.userType ?? user.user_type ?? "").trim();
    if (/品牌|企业|商家|机构/.test(ut)) {
      out.accountType = "enterprise";
      out.accountTypeReason = "xhs:userType";
      out.authorVerified = true;
    }
  }
  const hasCoop = (Array.isArray(nc.cooperateBinds) && nc.cooperateBinds.length > 0)
    || (Array.isArray(nc.cooperate_binds) && nc.cooperate_binds.length > 0);
  const commercialFlag = Number(nc.commercialFlag ?? nc.commercial_flag ?? 0);
  const commercialNote = nc.commercial === true
    || nc.noteAttributes?.commercial === true
    || nc.note_activity_info?.commercial === true;
  if (hasCoop) {
    out.isPaidPromotion = true;
    out.paidPromotionReason = "xhs:cooperateBinds";
  } else if (commercialFlag === 1) {
    out.isPaidPromotion = true;
    out.paidPromotionReason = "xhs:commercialFlag";
  } else if (commercialNote) {
    out.isPaidPromotion = true;
    out.paidPromotionReason = "xhs:commercial_note";
  }
  return out;
}

export type TrendCollectionStats = {
  platform: GrowthPlatform;
  itemCount: number;
  uniqueAuthorCount: number;
  bucketCounts: Record<string, number>;
  requestCount: number;
  pageDepth: number;
  targetPerRun: number;
  referenceMinItems: number;
  referenceMaxItems: number;
  collectorMode: "authenticated_feed" | "public_feed" | "hot_topics" | "hybrid" | "warehouse" | "seed";
  industryCounts: Record<string, number>;
  ageCounts: Record<string, number>;
  contentCounts: Record<string, number>;
  /** 本轮抓取原始条数（去重前，由 collector 传入） */
  rawFetchedCount?: number;
  /** 去重后条数（传入 finalize 的 items 长度） */
  afterDedupCount?: number;
  /** 若应用入库窗口裁剪后的条数（warehouse 模式仅作观测，不入库） */
  afterWindowFilterCount?: number;
  /** warehouse 模式：true 表示全量入库、读取时再按窗口过滤 */
  warehouseIngest?: boolean;
};

export type PlatformTrendCollection = {
  platform: GrowthPlatform;
  source: TrendSource;
  collectedAt: string;
  windowDays: number;
  items: TrendItem[];
  notes: string[];
  stats: TrendCollectionStats;
};

const PLATFORM_BUCKET_DEFAULTS: Partial<Record<GrowthPlatform, string>> = {
  douyin: "douyin_feed",
  kuaishou: "kuaishou_feed",
  bilibili: "bilibili_feed",
  xiaohongshu: "xiaohongshu_feed",
  weixin_channels: "weixin_channels_feed",
  toutiao: "toutiao_feed",
};

const PLATFORM_REFERENCE_RANGES: Partial<Record<GrowthPlatform, { min: number; max: number }>> = {
  douyin: { min: 12, max: 30 },
  // Kuaishou crawl intensity increased: reference range widened
  kuaishou: { min: 20, max: 80 },
  bilibili: { min: 40, max: 80 },
  // Xiaohongshu crawl intensity increased
  xiaohongshu: { min: 40, max: 100 },
  // Toutiao crawl intensity increased: reference range widened
  toutiao: { min: 40, max: 120 },
};

const DEFAULT_WINDOW_DAYS = 365;
const WINDOW_FALLBACKS = [60, 90, 120, 180, 270, 365];
const MIN_PLATFORM_ITEM_TARGET = 10_000;

function parseNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

function parsePreferredNumberEnv(preferredName: string, legacyName: string, fallback: number) {
  const preferred = Number(process.env[preferredName] || "");
  if (Number.isFinite(preferred)) return preferred;
  return parseNumberEnv(legacyName, fallback);
}

function isBooleanEnvEnabled(name: string, fallback = false) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function getTargetWindowDays() {
  return Math.max(7, parseNumberEnv("GROWTH_TARGET_WINDOW_DAYS", DEFAULT_WINDOW_DAYS));
}

function getPlatformWindowExtraDays(platform?: GrowthPlatform) {
  const envName = platform ? `${platform.toUpperCase()}_WINDOW_EXTRA_DAYS` : "";
  const configured = envName
    ? String(process.env[envName] || "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > getTargetWindowDays() && item <= 365)
      .sort((left, right) => left - right)
    : [];
  if (configured.length) return configured;
  if (platform === "kuaishou") return [270, 365];
  return [];
}

function getFallbackWindowDays(platform?: GrowthPlatform) {
  const configured = parseCsvEnv("GROWTH_WINDOW_FALLBACK_DAYS")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > getTargetWindowDays() && item <= 365)
    .sort((left, right) => left - right);
  const merged = configured.length ? configured : WINDOW_FALLBACKS;
  return Array.from(new Set([...merged, ...getPlatformWindowExtraDays(platform)])).sort((left, right) => left - right);
}

function getWindowCandidates(platform?: GrowthPlatform) {
  return [getTargetWindowDays(), ...getFallbackWindowDays(platform)];
}

function getMaxWindowDays(platform?: GrowthPlatform) {
  return getWindowCandidates(platform).slice(-1)[0] || DEFAULT_WINDOW_DAYS;
}

function getPlatformTargetItemCount(platform: GrowthPlatform) {
  return Math.max(
    MIN_PLATFORM_ITEM_TARGET,
    parseNumberEnv(`${platform.toUpperCase()}_TREND_MIN_ITEMS`, MIN_PLATFORM_ITEM_TARGET),
  );
}

function parseChineseCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/,/g, "");
  const wan = normalized.match(/^([\d.]+)\s*万$/);
  if (wan) return Math.round(Number(wan[1]) * 10_000);
  const yi = normalized.match(/^([\d.]+)\s*亿$/);
  if (yi) return Math.round(Number(yi[1]) * 100_000_000);
  const num = Number(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : undefined;
}

function safeDateFromUnix(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  return toShanghaiIso(timestamp * 1000);
}

function safeDateFromTimestamp(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  return toShanghaiIso(timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000);
}

/**
 * 小红书 noteCard / 搜索 note：尽量解析发布时间。
 * 缺 publishedAt 时短窗（3/7/15 天）评分会把样本整批丢掉，导致「有效数据」极低。
 */
function extractXhsPublishedAt(noteCard: unknown): string | undefined {
  const nc = noteCard as Record<string, any> | null | undefined;
  if (!nc || typeof nc !== "object") return undefined;

  const candidates: unknown[] = [
    nc.time,
    nc.timestamp,
    nc.createTime,
    nc.createdAt,
    nc.lastUpdateTime,
    nc.updateTime,
    nc?.noteCard?.time,
    nc?.noteCard?.timestamp,
    nc?.interactInfo?.time,
    nc?.cornerTagInfo?.V2?.text,
    nc?.cornerTagInfo?.text,
  ];

  for (const raw of candidates) {
    if (raw == null) continue;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      const iso = safeDateFromTimestamp(raw);
      if (iso) return iso;
    }
    const text = String(raw).trim();
    if (!text) continue;

    // 「x 天前 / x 小时前 / x 分钟前 / 刚刚」
    const relative =
      text.match(/^(\d+)\s*(分钟|小時|小时|天|周|週|个月|個月)前$/) ||
      text.match(/^(\d+)\s*(min|hour|day|week|month)s?\s*ago$/i);
    if (relative) {
      const n = Number(relative[1]);
      const unit = relative[2];
      if (Number.isFinite(n) && n >= 0) {
        const now = Date.now();
        const ms =
          /分钟|min/i.test(unit) ? n * 60_000 :
          /小时|小時|hour/i.test(unit) ? n * 3_600_000 :
          /天|day/i.test(unit) ? n * 86_400_000 :
          /周|週|week/i.test(unit) ? n * 7 * 86_400_000 :
          /月|month/i.test(unit) ? n * 30 * 86_400_000 :
          0;
        if (ms > 0) return toShanghaiIso(now - ms);
      }
    }
    if (/^刚刚$|^剛才$|^just now$/i.test(text)) {
      return toShanghaiIso(Date.now());
    }

    // 纯数字时间戳（秒/毫秒）
    if (/^\d{10,13}$/.test(text)) {
      const iso = safeDateFromTimestamp(Number(text));
      if (iso) return iso;
    }

    // ISO / 常见日期串
    const parsed = Date.parse(text.replace(/年|月/g, "-").replace(/日/g, "").replace(/\./g, "-"));
    if (Number.isFinite(parsed) && parsed > 0) return toShanghaiIso(parsed);
  }
  return undefined;
}

function parseCsvEnv(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseColonPairCsvEnv(name: string) {
  return parseCsvEnv(name)
    .map((entry) => {
      const [left, right] = entry.split(":").map((part) => part.trim());
      return { left, right };
    })
    .filter((entry) => entry.left);
}

function parseCookieHeader(rawCookie: string) {
  return String(rawCookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) return null;
      return {
        name: entry.slice(0, separator).trim(),
        value: entry.slice(separator + 1).trim(),
      };
    })
    .filter(Boolean) as Array<{ name: string; value: string }>;
}

function parsePairPoolEnv(name: string) {
  return String(process.env[name] || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((entry) => {
      const [left, right] = entry.split("|").map((part) => String(part || "").trim());
      return { left, right };
    })
    .filter((entry) => entry.left);
}

function isBackfillCollectorActive() {
  const raw = String(process.env.GROWTH_BACKFILL_ACTIVE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "live" || raw === "history";
}

function parseCookiePool(primaryName: string, backupName?: string) {
  const raw = [
    String(process.env[primaryName] || "").trim(),
    backupName ? String(process.env[backupName] || "").trim() : "",
    ...String(process.env[`${primaryName}_POOL`] || "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
  ].filter(Boolean);
  const deduped = Array.from(new Set(raw));
  const rotateOffset = Math.max(0, Number(process.env.GROWTH_BACKFILL_COOKIE_OFFSET || 0) || 0);
  const shouldRotate = isBackfillCollectorActive() && deduped.length > 1 && rotateOffset > 0;
  if (!shouldRotate) return deduped;
  const offset = rotateOffset % deduped.length;
  return [...deduped.slice(offset), ...deduped.slice(0, offset)];
}

function parseCookieValue(rawCookie: string, key: string) {
  const segments = String(rawCookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name !== key) continue;
    return segment.slice(separator + 1).trim();
  }
  return "";
}

function extractEmbeddedState(html: string) {
  const patterns = [
    /window\.__INITIAL_STATE__=(\{[\s\S]*?\})\s*<\/script>/,
    /<script id="RENDER_DATA" type="application\/json">([\s\S]*?)<\/script>/,
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const raw = String(match[1] || "").trim();
    if (!raw) continue;
    try {
      if (pattern === patterns[0]) {
        return vm.runInNewContext(`(${raw})`, {}) as Record<string, any>;
      }
      const decoded = pattern === patterns[1] ? decodeURIComponent(raw) : raw;
      return JSON.parse(decoded) as Record<string, any>;
    } catch {
      continue;
    }
  }
  return null;
}

type ToutiaoAcrawler = {
  init: (config: Record<string, any>) => void;
  sign: (payload: { url: string; body?: string }) => string;
};

function createToutiaoSigner(script: string): ToutiaoAcrawler | null {
  const context = {
    window: {} as Record<string, any>,
    global: null as Record<string, any> | null,
    self: null as Record<string, any> | null,
    location: {
      protocol: "https:",
      host: "www.toutiao.com",
      href: "https://www.toutiao.com/",
    },
    navigator: {
      userAgent: "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
      language: "zh-CN",
      languages: ["zh-CN", "zh"],
      platform: "MacIntel",
      webdriver: false,
    },
    document: {
      cookie: "",
      referrer: "",
      createElement() {
        return {
          style: {},
          setAttribute() { return undefined; },
          getContext() { return {}; },
          appendChild() { return undefined; },
          removeChild() { return undefined; },
          src: "",
          href: "",
        };
      },
      documentElement: { clientWidth: 1440, clientHeight: 900 },
      body: {
        appendChild() { return undefined; },
        removeChild() { return undefined; },
        clientWidth: 1440,
        clientHeight: 900,
      },
      addEventListener() { return undefined; },
      removeEventListener() { return undefined; },
      getElementsByTagName() {
        return [{ appendChild() { return undefined; }, removeChild() { return undefined; } }];
      },
      querySelector() {
        return null;
      },
    },
    screen: {
      width: 1440,
      height: 900,
      availWidth: 1440,
      availHeight: 900,
      colorDepth: 24,
      pixelDepth: 24,
    },
    history: { length: 2 },
    performance: { now: () => Date.now(), timing: {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    escape,
    unescape,
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    console,
  };
  context.window = context as unknown as Record<string, any>;
  context.global = context.window;
  context.self = context.window;
  try {
    vm.runInNewContext(script, context, { timeout: 5_000 });
    const acrawler = context.window.byted_acrawler as ToutiaoAcrawler | undefined;
    if (!acrawler || typeof acrawler.init !== "function" || typeof acrawler.sign !== "function") return null;
    acrawler.init({ aid: 24, dfp: true });
    return acrawler;
  } catch {
    return null;
  }
}

function parseToutiaoFeedItems(payload: Record<string, any>, category: string) {
  const list = Array.isArray(payload?.data) ? payload.data as Array<Record<string, any>> : [];
  return list.map((entry, index) => {
    const streamCell = entry.stream_cell ?? {};
    const baseCell = entry.base_cell ?? {};
    const parsedRawData = (() => {
      const raw = String(streamCell.raw_data ?? "").trim();
      if (!raw) return null;
      try {
        return JSON.parse(raw) as Record<string, any>;
      } catch {
        return null;
      }
    })();
    const article = parsedRawData?.itemCell ?? parsedRawData ?? {};
    const user = article.user ?? {};
    const title = String(
      article.title
      ?? article.content
      ?? streamCell.abstract
      ?? streamCell.title
      ?? baseCell.title
      ?? "",
    ).trim();
    if (!title) return null;
    const id = String(
      streamCell.id
      ?? article.group_id
      ?? article.thread_id
      ?? article.item_id
      ?? `${category}-${index}`,
    ).trim();
    const author = String(
      user.screen_name
      ?? user.name
      ?? streamCell.source
      ?? "",
    ).trim();
    const likes = parseChineseCount(article.digg_count ?? baseCell.digg_count);
    const comments = parseChineseCount(article.comment_count ?? baseCell.comment_count);
    const shares = parseChineseCount(article.forward_info?.forward_count ?? baseCell.share_count);
    const views = parseChineseCount(article.read_count ?? article.display_count ?? baseCell.read_count);
    const tags = [
      String(parsedRawData?.forum?.forum_name ?? "").trim(),
      String(article.publish_loc_info ?? "").trim(),
    ].filter(Boolean);
    return {
      id,
      title,
      bucket: category === "profile_all" ? "toutiao_feed" : `toutiao_${category}`,
      author: author || undefined,
      url: article.share_url || streamCell.share_url || undefined,
      publishedAt: safeDateFromUnix(Number(article.publish_time ?? article.create_time ?? baseCell.behot_time)),
      likes,
      comments,
      shares,
      views,
      hotValue: (likes || 0) + (comments || 0),
      contentType: category === "pc_profile_video" ? "video" : "note",
      tags,
    } satisfies TrendItem;
  }).filter(Boolean) as TrendItem[];
}

function parseToutiaoVideoItems(payload: Record<string, any>) {
  const list = Array.isArray(payload?.data) ? payload.data as Array<Record<string, any>> : [];
  return list.map((entry, index) => {
    const title = String(entry.title ?? "").trim();
    if (!title) return null;
    const id = String(entry.group_id ?? entry.item_id ?? `${index}`).trim();
    const views = parseChineseCount(entry.go_detail_count ?? entry.detail_play_effective_count);
    return {
      id,
      title,
      bucket: "toutiao_video",
      author: String(entry.source ?? "").trim() || undefined,
      url: String(entry.display_url ?? entry.source_url ?? "").trim() || undefined,
      publishedAt: undefined,
      likes: undefined,
      comments: parseChineseCount(entry.comments_count),
      shares: undefined,
      views,
      hotValue: views,
      contentType: "video",
      tags: [String(entry.article_genre ?? "").trim()].filter(Boolean),
    } satisfies TrendItem;
  }).filter(Boolean) as TrendItem[];
}

function parseToutiaoMediaHotItems(payload: Record<string, any>) {
  const list = Array.isArray(payload?.data) ? payload.data as Array<Record<string, any>> : [];
  return list.map((entry, index) => {
    const title = String(entry.title ?? entry.name ?? entry.keyword ?? "").trim();
    if (!title) return null;
    const id = String(entry.group_id ?? entry.item_id ?? entry.id ?? `media-hot-${index}`).trim();
    const views = parseChineseCount(entry.read_count ?? entry.show_count ?? entry.play_count);
    const likes = parseChineseCount(entry.digg_count ?? entry.like_count);
    const comments = parseChineseCount(entry.comment_count);
    return {
      id,
      title,
      bucket: "toutiao_media_hot",
      author: String(entry.source ?? entry.media_name ?? "").trim() || undefined,
      url: String(entry.display_url ?? entry.share_url ?? "").trim() || undefined,
      publishedAt: safeDateFromUnix(Number(entry.publish_time ?? entry.create_time)),
      likes,
      comments,
      shares: parseChineseCount(entry.share_count),
      views,
      hotValue: (views || 0) + (likes || 0) + (comments || 0),
      contentType: String(entry.article_genre ?? "").includes("video") ? "video" : "note",
      tags: [String(entry.chinese_tag ?? "").trim()].filter(Boolean),
    } satisfies TrendItem;
  }).filter(Boolean) as TrendItem[];
}

function parseToutiaoSearchItems(payload: Record<string, any>, keyword: string) {
  const list = Array.isArray(payload?.data) ? payload.data as Array<Record<string, any>> : [];
  return list.map((entry, index) => {
    const title = String(
      entry.title
      ?? entry.abstract
      ?? entry.name
      ?? entry.keyword
      ?? "",
    ).replace(/<[^>]+>/g, "").trim();
    if (!title) return null;
    const id = String(
      entry.group_id
      ?? entry.item_id
      ?? entry.id
      ?? entry.log_pb?.group_id
      ?? `toutiao-search-${keyword}-${index}`,
    ).trim();
    const views = parseChineseCount(entry.read_count ?? entry.show_count ?? entry.play_count ?? entry.impression_count);
    const likes = parseChineseCount(entry.digg_count ?? entry.like_count);
    const comments = parseChineseCount(entry.comment_count);
    return {
      id,
      title,
      bucket: "toutiao_search_feed",
      author: String(entry.source ?? entry.media_name ?? entry.user_name ?? "").trim() || undefined,
      url: String(entry.article_url ?? entry.display_url ?? entry.share_url ?? "").trim() || undefined,
      publishedAt: safeDateFromUnix(Number(entry.publish_time ?? entry.create_time ?? entry.behot_time)),
      likes,
      comments,
      shares: parseChineseCount(entry.share_count),
      views,
      hotValue: (views || 0) + (likes || 0) + (comments || 0),
      contentType: String(entry.article_genre ?? entry.group_source ?? "").includes("video") ? "video" : "note",
      tags: Array.from(new Set([keyword, ...normalizeStringList(entry.chinese_tag)])),
    } satisfies TrendItem;
  }).filter(Boolean) as TrendItem[];
}

function extractToutiaoFeedCursor(payload: Record<string, any>) {
  return String(
    payload?.next?.max_behot_time
    ?? payload?.next?.behot_time
    ?? payload?.max_behot_time
    ?? payload?.behot_time
    ?? "",
  ).trim();
}

function extractDouyinCreatorItems(state: unknown) {
  const items: TrendItem[] = [];
  const visited = new Set<unknown>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as Record<string, any>;
    const title = String(
      record.desc
      ?? record.title
      ?? record.caption
      ?? record.aweme_info?.desc
      ?? record.item?.title
      ?? "",
    ).trim();
    const awemeId = String(
      record.aweme_id
      ?? record.awemeId
      ?? record.group_id
      ?? record.item_id
      ?? record.id
      ?? record.aweme_info?.aweme_id
      ?? "",
    ).trim();
    const stats = record.statistics ?? record.stats ?? record.aweme_info?.statistics ?? {};
    const author = record.author ?? record.user ?? record.aweme_info?.author ?? {};

    if (title && awemeId) {
      items.push({
        id: awemeId,
        title,
        bucket: "douyin_creator_center",
        author: String(author.nickname ?? author.name ?? author.uid ?? "").trim() || undefined,
        url: `https://www.douyin.com/video/${awemeId}`,
        publishedAt: safeDateFromUnix(Number(record.create_time ?? record.aweme_info?.create_time)),
        likes: Number(stats.digg_count ?? stats.like_count ?? 0) || undefined,
        comments: Number(stats.comment_count ?? 0) || undefined,
        shares: Number(stats.share_count ?? 0) || undefined,
        views: Number(stats.play_count ?? stats.view_count ?? 0) || undefined,
        hotValue: Number(stats.digg_count ?? stats.like_count ?? 0) + Number(stats.comment_count ?? 0),
        contentType: "video",
        tags: Array.isArray(record.text_extra)
          ? record.text_extra
            .map((entry) => String(entry?.hashtag_name ?? "").trim())
            .filter(Boolean)
          : [],
        ...metaFromDouyinAuthor(author),
        ...metaFromDouyinAweme(record.aweme_info ?? record, { title, tags: Array.isArray(record.text_extra)
          ? record.text_extra.map((entry: any) => String(entry?.hashtag_name ?? "").trim()).filter(Boolean)
          : [] }),
      });
    }

    Object.values(record).forEach(visit);
  };

  visit(state);
  return dedupeById(items);
}

function extractDouyinCreatorBillboardItems(payload: unknown, bucket: string) {
  const records = Array.isArray((payload as any)?.item_list) ? (payload as any).item_list as Array<Record<string, any>> : [];
  const items: TrendItem[] = [];

  records.forEach((record) => {
    const baseItemId = String(record.item_id ?? record.query_id ?? "").trim();
    const awemeList = Array.isArray(record.aweme_list) ? record.aweme_list : [];

    if (awemeList.length) {
      awemeList.forEach((entry) => {
        const awemeId = String(entry?.aweme_id ?? entry?.group_id ?? entry?.item_id ?? baseItemId).trim();
        const title = String(entry?.desc ?? entry?.title ?? record.title ?? record.author_name ?? "").trim();
        if (!awemeId || !title) return;
        const author = entry?.author ?? {};
        const stats = entry?.statistics ?? {};
        items.push({
          id: awemeId,
          title,
          bucket,
          author: String(author.nickname ?? record.author_name ?? "").trim() || undefined,
          url: `https://www.douyin.com/video/${awemeId}`,
          publishedAt: safeDateFromUnix(Number(entry?.create_time)),
          likes: Number(stats.digg_count ?? record.like_count ?? 0) || undefined,
          comments: Number(stats.comment_count ?? record.comment_count ?? 0) || undefined,
          shares: Number(stats.share_count ?? 0) || undefined,
          views: Number(stats.play_count ?? record.play_count ?? 0) || undefined,
          hotValue: Number(record.hot_score ?? stats.play_count ?? record.play_count ?? 0) || undefined,
          contentType: "video",
          tags: Array.isArray(record.key_words)
            ? record.key_words.map((item) => String(item ?? "").trim()).filter(Boolean)
            : [],
          ...metaFromDouyinAuthor(author),
          ...metaFromDouyinAweme(entry, {
            title,
            tags: Array.isArray(record.key_words)
              ? record.key_words.map((item: any) => String(item ?? "").trim()).filter(Boolean)
              : [],
          }),
        });
      });
      return;
    }

    const title = String(record.title ?? record.author_name ?? record.query_tag_name ?? "").trim();
    if (!baseItemId || !title) return;
    items.push({
      id: baseItemId,
      title,
      bucket,
      author: String(record.author_name ?? "").trim() || undefined,
      url: record.query_id ? `https://www.douyin.com/hot/${record.query_id}` : undefined,
      publishedAt: safeDateFromTimestamp(Number(record.hot_onboard_time)),
      likes: Number(record.like_count ?? 0) || undefined,
      comments: Number(record.comment_count ?? 0) || undefined,
      shares: undefined,
      views: Number(record.play_count ?? 0) || undefined,
      hotValue: Number(record.hot_score ?? 0) || undefined,
      contentType: "topic",
      tags: Array.isArray(record.key_words)
        ? record.key_words.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
    });
  });

  return dedupeById(items);
}

function parseKuaishouCookiePool() {
  const primary = String(process.env.KUAISHOU_COOKIE || "").trim();
  if (process.env.KUAISHOU_USE_COOKIE_POOL !== "1") {
    return primary ? [primary] : [];
  }
  const cookies = parseCookiePool("KUAISHOU_COOKIE", "KUAISHOU_COOKIE_BACKUP");
  const seen = new Set<string>();
  return cookies.filter((cookie) => {
    const userId = parseCookieValue(cookie, "userId");
    const identity = userId || cookie;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function normalizeTrendBucket(platform: GrowthPlatform, bucket?: string, contentType?: TrendItem["contentType"]) {
  const raw = String(bucket || "").trim();
  if (raw) return raw;
  if (platform === "douyin" && contentType === "topic") return "douyin_topics";
  return PLATFORM_BUCKET_DEFAULTS[platform] || `${platform}_${contentType || "feed"}`;
}

function getBucketCounts(items: TrendItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const bucket = String(item.bucket || item.contentType || "default").trim() || "default";
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
}

function dedupeById(items: TrendItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.id || ""}::${item.title || ""}::${item.author || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCommentSamples(
  samples: TrendItem["commentSamples"],
  limit: number,
): TrendItem["commentSamples"] {
  if (!Array.isArray(samples) || !samples.length || limit <= 0) return undefined;
  const seen = new Set<string>();
  const normalized = samples
    .map((sample) => ({
      author: sample?.author ? String(sample.author).trim() : undefined,
      text: String(sample?.text || "").trim(),
      likeCount: Number(sample?.likeCount || 0) || undefined,
    }))
    .filter((sample) => sample.text)
    .filter((sample) => {
      const key = `${sample.author || ""}::${sample.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
  return normalized.length ? normalized : undefined;
}

async function runBatches<T>(tasks: Array<() => Promise<T>>, concurrency: number) {
  const results: T[] = [];
  for (let index = 0; index < tasks.length; index += concurrency) {
    const batch = tasks.slice(index, index + concurrency);
    const settled = await Promise.allSettled(batch.map((task) => task()));
    for (const item of settled) {
      if (item.status === "fulfilled") results.push(item.value);
    }
  }
  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectDouyinCreatorCenterItems(cookies: string[], _keywords: string[]) {
  const items: TrendItem[] = [];
  const notes: string[] = [];
  let requestCount = 0;

  if (!isBooleanEnvEnabled("DOUYIN_CREATOR_CENTER_ENABLED", false)) {
    notes.push("Douyin creator center skipped: DOUYIN_CREATOR_CENTER_ENABLED is off.");
    return { items, notes, requestCount };
  }

  const creatorCookies = Array.from(new Set([
    String(process.env.DOUYIN_CREATOR_CENTER_COOKIE || "").trim(),
    String(process.env.DOUYIN_CREATOR_CENTER_COOKIE_BACKUP || "").trim(),
    ...cookies,
  ].filter(Boolean)));
  const endpoint = String(
    process.env.DOUYIN_CREATOR_CENTER_ENDPOINT
    || "https://creator.douyin.com/web/api/creator/material/center/billboard/",
  ).trim();
  const billboardTypes = parseCsvEnv("DOUYIN_CREATOR_CENTER_BILLBOARD_TYPES")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const selectedBillboardTypes = billboardTypes.length ? billboardTypes : [1, 3];

  if (!creatorCookies.length) {
    notes.push("Douyin creator center skipped: no creator cookie or douyin cookie available.");
    return { items, notes, requestCount };
  }

  if (!endpoint) {
    notes.push("Douyin creator center skipped: endpoint is empty.");
    return { items, notes, requestCount };
  }

  const tasks = selectedBillboardTypes.map((billboardType) => async () => {
    for (const cookie of creatorCookies) {
      const pageUrl = new URL(endpoint);
      pageUrl.searchParams.set("billboard_type", String(billboardType));
      pageUrl.searchParams.set("billboard_tag", "0");
      pageUrl.searchParams.set("order_key", "1");
      pageUrl.searchParams.set("time_filter", "1");
      pageUrl.searchParams.set("limit", String(parseNumberEnv("DOUYIN_CREATOR_CENTER_LIMIT", 10)));
      pageUrl.searchParams.set("aweme_limit", String(parseNumberEnv("DOUYIN_CREATOR_CENTER_AWEME_LIMIT", 10)));
      if (billboardType === 3) {
        pageUrl.searchParams.set("hot_search_type", String(parseNumberEnv("DOUYIN_CREATOR_CENTER_HOT_SEARCH_TYPE", 1)));
      }

      try {
        const response = await fetch(pageUrl.toString(), {
          headers: {
            accept: "application/json,text/plain,*/*",
            cookie,
            referer: "https://creator.douyin.com/creator-micro/home",
            "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
          },
        });
        requestCount += 1;
        if (!response.ok) {
          notes.push(`Douyin creator center billboard ${billboardType} responded with ${response.status}.`);
          return;
        }
        const payload = await response.json() as Record<string, any>;
        if (Number(payload?.status_code) !== 0) {
          notes.push(`Douyin creator center billboard ${billboardType} returned status_code=${payload?.status_code ?? "unknown"} (${String(payload?.status_msg ?? payload?.status_message ?? "unknown")}).`);
          return;
        }
        const bucket = billboardType === 1
          ? "douyin_creator_center_hot_video"
          : billboardType === 2
            ? "douyin_creator_center_hot_topic"
            : "douyin_creator_center_hot_search";
        const pageItems = extractDouyinCreatorBillboardItems(payload, bucket);
        items.push(...pageItems);
        notes.push(`Fetched ${pageItems.length} Douyin creator center items for billboard ${billboardType}.`);
        if (pageItems.length) return;
      } catch (error) {
        requestCount += 1;
        notes.push(`Douyin creator center billboard ${billboardType} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  await runBatches(tasks, 1);
  return { items: dedupeById(items), notes, requestCount };
}

function buildDouyinCreatorIndexHeaders(cookie: string, csrfToken: string, referer: string) {
  return {
    accept: "application/json, text/plain, */*",
    appsource: "PC",
    "content-type": "application/json",
    cookie,
    origin: "https://creator.douyin.com",
    referer,
    "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
    "x-secsdk-csrf-token": csrfToken,
  };
}

async function resolveDouyinCreatorIndexCsrfToken(cookies: string[]) {
  const explicit = String(
    process.env.DOUYIN_CREATOR_INDEX_CSRF_TOKEN
    || process.env.DOUYIN_CREATOR_CENTER_CSRF_TOKEN
    || "",
  ).trim();
  if (explicit) {
    return {
      token: explicit,
      note: "Douyin creator index csrf token: using configured env token.",
    };
  }

  for (const cookie of cookies) {
    try {
      const response = await fetch("https://creator.douyin.com/creator-micro/home", {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          cookie,
          referer: "https://creator.douyin.com/",
          "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
        },
      });
      const headerToken = String(response.headers.get("x-secsdk-csrf-token") || "").trim();
      if (response.ok && headerToken) {
        return {
          token: headerToken,
          note: "Douyin creator index csrf token: resolved from creator home response header.",
        };
      }
    } catch {}
  }

  return {
    token: "",
    note: "Douyin creator index csrf token missing: env token not configured and creator home response did not return x-secsdk-csrf-token.",
  };
}

function parseDouyinCreatorBrandSeeds() {
  return parseColonPairCsvEnv("DOUYIN_CREATOR_INDEX_BRANDS")
    .map((entry) => ({
      brandName: entry.left,
      categoryId: entry.right,
    }))
    .filter((entry) => entry.brandName && entry.categoryId);
}

function extractDouyinCreatorKeywordSeeds(seedItems: TrendItem[], prioritizedSeeds: string[] = []) {
  const explicit = parseCsvEnv("DOUYIN_CREATOR_INDEX_KEYWORDS");
  const derived = seedItems
    .flatMap((item) => [item.title, ...normalizeStringList(item.tags)])
    .map((value) => String(value || "").trim())
    .filter((value) => value && value.length <= 16 && !/^douyin[-_:]/i.test(value))
    .slice(0, Math.max(2, parseNumberEnv("DOUYIN_CREATOR_INDEX_KEYWORD_LIMIT", 6)));
  return Array.from(new Set([...prioritizedSeeds, ...explicit, ...derived]))
    .slice(0, Math.max(2, parseNumberEnv("DOUYIN_CREATOR_INDEX_KEYWORD_LIMIT", 6)));
}

async function probeDouyinCreatorIndexEndpoint(
  creatorCookies: string[],
  csrfToken: string,
  options: {
    url: string;
    referer: string;
    label: string;
    body: Record<string, any>;
  },
) {
  for (const cookie of creatorCookies) {
    const response = await fetch(options.url, {
      method: "POST",
      headers: buildDouyinCreatorIndexHeaders(cookie, csrfToken, options.referer),
      body: JSON.stringify(options.body),
    });
    if (!response.ok) {
      return {
        requestCount: 1,
        payloadKind: "http_error" as const,
        note: `${options.label} responded with ${response.status}.`,
      };
    }
    const payload = await response.json() as Record<string, any>;
    const status = Number(payload?.status ?? payload?.status_code ?? 0);
    if (status !== 0) {
      return {
        requestCount: 1,
        payloadKind: "status_error" as const,
        note: `${options.label} returned status=${payload?.status ?? payload?.status_code ?? "unknown"} (${String(payload?.msg ?? payload?.status_msg ?? "unknown")}).`,
      };
    }
    const data = payload?.data;
    if (typeof data === "string" && data.trim()) {
      return {
        requestCount: 1,
        payloadKind: "encrypted" as const,
        note: `${options.label} returned encrypted payload.`,
      };
    }
    if (Array.isArray(data)) {
      return {
        requestCount: 1,
        payloadKind: "plain_array" as const,
        note: `${options.label} returned plain array payload (${data.length}).`,
      };
    }
    if (data && typeof data === "object") {
      return {
        requestCount: 1,
        payloadKind: "plain_object" as const,
        note: `${options.label} returned plain object payload (${Object.keys(data).length} fields).`,
      };
    }
    return {
      requestCount: 1,
      payloadKind: "empty" as const,
      note: `${options.label} returned empty payload.`,
    };
  }

  return {
    requestCount: 0,
    payloadKind: "skipped" as const,
    note: `${options.label} skipped (no creator index cookie available).`,
  };
}

function buildDouyinCreatorIndexSignalItem(params: {
  id: string;
  title: string;
  bucket: string;
  label: string;
  probeKinds: string[];
  url?: string;
}) {
  const effectiveKinds = params.probeKinds.filter((kind) => kind !== "skipped");
  if (!effectiveKinds.length) return null;

  const signalScore = effectiveKinds.reduce((score, kind) => {
    if (kind === "plain_object" || kind === "plain_array") return score + 24;
    if (kind === "encrypted") return score + 16;
    if (kind === "empty") return score + 6;
    return score + 2;
  }, 0);

  return {
    id: params.id,
    title: params.title,
    bucket: params.bucket,
    url: params.url,
    hotValue: signalScore,
    views: signalScore,
    contentType: "topic" as const,
    tags: [params.label, ...Array.from(new Set(effectiveKinds.map((kind) => `probe:${kind}`)))],
  } satisfies TrendItem;
}

async function captureDouyinCreatorPageText(url: string, cookie: string) {
  const cdpVersionUrl = String(process.env.DOUYIN_CREATOR_INDEX_CDP_URL || "http://127.0.0.1:9223").replace(/\/$/, "");
  const version = await fetch(`${cdpVersionUrl}/json/version`).then((response) => {
    if (!response.ok) throw new Error(`CDP version responded with ${response.status}`);
    return response.json() as Promise<{ webSocketDebuggerUrl?: string }>;
  });
  const browserWsUrl = String(version.webSocketDebuggerUrl || "").trim();
  if (!browserWsUrl) throw new Error("CDP browser websocket unavailable.");

  const BrowserWebSocket = (globalThis as any).WebSocket;
  if (!BrowserWebSocket) throw new Error("Global WebSocket unavailable.");

  const browserSocket = new BrowserWebSocket(browserWsUrl);
  await new Promise<void>((resolve, reject) => {
    browserSocket.onopen = () => resolve();
    browserSocket.onerror = (error: unknown) => reject(error);
  });

  let browserMessageId = 0;
  const browserPending = new Map<number, (value: any) => void>();
  browserSocket.onmessage = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data || "{}"));
    if (message.id && browserPending.has(message.id)) {
      browserPending.get(message.id)?.(message);
      browserPending.delete(message.id);
    }
  };
  const sendBrowser = (method: string, params: Record<string, any> = {}) => new Promise<any>((resolve) => {
    const id = ++browserMessageId;
    browserPending.set(id, resolve);
    browserSocket.send(JSON.stringify({ id, method, params }));
  });

  const created = await sendBrowser("Target.createTarget", { url: "about:blank" });
  const targetId = created?.result?.targetId as string | undefined;
  if (!targetId) throw new Error("Failed to create CDP target.");

  const targets = await fetch(`${cdpVersionUrl}/json/list`).then((response) => {
    if (!response.ok) throw new Error(`CDP list responded with ${response.status}`);
    return response.json() as Promise<Array<{ id: string; webSocketDebuggerUrl?: string }>>;
  });
  const page = targets.find((entry) => entry.id === targetId);
  const pageWsUrl = String(page?.webSocketDebuggerUrl || "").trim();
  if (!pageWsUrl) throw new Error("CDP page websocket unavailable.");

  const pageSocket = new BrowserWebSocket(pageWsUrl);
  await new Promise<void>((resolve, reject) => {
    pageSocket.onopen = () => resolve();
    pageSocket.onerror = (error: unknown) => reject(error);
  });

  let pageMessageId = 0;
  const pagePending = new Map<number, (value: any) => void>();
  pageSocket.onmessage = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data || "{}"));
    if (message.id && pagePending.has(message.id)) {
      pagePending.get(message.id)?.(message);
      pagePending.delete(message.id);
    }
  };
  const sendPage = (method: string, params: Record<string, any> = {}) => new Promise<any>((resolve) => {
    const id = ++pageMessageId;
    pagePending.set(id, resolve);
    pageSocket.send(JSON.stringify({ id, method, params }));
  });

  await sendPage("Network.enable");
  await sendPage("Page.enable");
  for (const parsedCookie of parseCookieHeader(cookie)) {
    await sendPage("Network.setCookie", {
      name: parsedCookie.name,
      value: parsedCookie.value,
      domain: "creator.douyin.com",
      path: "/",
      secure: true,
    });
  }

  await sendPage("Page.navigate", { url });
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  await sendPage("Runtime.evaluate", {
    expression: `(() => {
      const trigger = [...document.querySelectorAll('button,div,span')].find((node) => /确认/.test(node.textContent || ""));
      if (trigger) trigger.click();
      return true;
    })()`,
    returnByValue: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const evaluated = await sendPage("Runtime.evaluate", {
    expression: "document.body ? document.body.innerText : ''",
    returnByValue: true,
  });
  const text = String(evaluated?.result?.result?.value || "").trim();

  pageSocket.close();
  browserSocket.close();
  return text;
}

function parseDouyinCreatorPageMetric(text: string) {
  const averageMatch = text.match(/平均值\s*([\d.]+)\s*([万亿]?)/);
  if (!averageMatch) return undefined;
  const raw = `${averageMatch[1]}${averageMatch[2] || ""}`;
  return parseChineseCount(raw);
}

async function collectDouyinCreatorIndexPageItems(
  creatorCookies: string[],
  keywordSeeds: string[],
  topicIds: string[],
  brandSeeds: Array<{ brandName: string; categoryId: string }>,
) {
  const enabled = String(process.env.DOUYIN_CREATOR_INDEX_PAGE_CAPTURE || "0") === "1";
  if (!enabled || !creatorCookies.length) {
    return { items: [] as TrendItem[], notes: [] as string[], requestCount: 0 };
  }

  const cookie = creatorCookies[0];
  const items: TrendItem[] = [];
  const notes: string[] = [];
  let requestCount = 0;

  const pageTargets = [
    ...keywordSeeds.slice(0, Math.max(1, parseNumberEnv("DOUYIN_CREATOR_INDEX_KEYWORD_LIMIT", 6))).map((keyword) => ({
      id: `douyin-index-keyword-page:${keyword}`,
      bucket: "douyin_creator_index_keyword_page",
      title: `${keyword} 关键词页面结果`,
      label: keyword,
      url: `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysis?source=creator&keyword=${encodeURIComponent(keyword)}&appName=aweme`,
    })),
    ...topicIds.slice(0, Math.max(1, parseNumberEnv("DOUYIN_CREATOR_INDEX_TOPIC_LIMIT", 6))).map((topicId) => ({
      id: `douyin-index-topic-page:${topicId}`,
      bucket: "douyin_creator_index_topic_page",
      title: `${topicId} 话题页面结果`,
      label: topicId,
      url: `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysis?topic=${encodeURIComponent(topicId)}&source=creator`,
    })),
    ...brandSeeds.slice(0, Math.max(1, parseNumberEnv("DOUYIN_CREATOR_INDEX_BRAND_LIMIT", 4))).map((brand) => ({
      id: `douyin-index-brand-page:${brand.brandName}:${brand.categoryId}`,
      bucket: "douyin_creator_index_brand_page",
      title: `${brand.brandName} 品牌页面结果`,
      label: brand.brandName,
      url: `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysisTheme?source=creator&keyword=${encodeURIComponent(brand.brandName)}&categoryId=${encodeURIComponent(brand.categoryId)}&appName=aweme`,
    })),
  ];

  for (const target of pageTargets) {
    try {
      const text = await captureDouyinCreatorPageText(target.url, cookie);
      requestCount += 1;
      if (!text) {
        notes.push(`${target.title} page capture returned empty text.`);
        continue;
      }
      const hotValue = parseDouyinCreatorPageMetric(text);
      items.push({
        id: target.id,
        title: target.title,
        bucket: target.bucket,
        url: target.url,
        hotValue,
        views: hotValue,
        contentType: "topic",
        tags: [target.label, "page_capture"].filter(Boolean),
      });
      const normalized = text.replace(/\s+/g, " ").trim();
      const summaryParts = [
        `metric=${hotValue ?? "n/a"}`,
        `label=${target.label}`,
        `textLen=${normalized.length}`,
      ];
      notes.push(`${target.title} page capture summary: ${summaryParts.join(", ")}.`);
    } catch (error) {
      requestCount += 1;
      notes.push(`${target.title} page capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { items: dedupeById(items), notes, requestCount };
}

async function collectDouyinCreatorIndexItems(
  cookies: string[],
  seedItems: TrendItem[],
  prioritizedKeywords: string[] = [],
) {
  const items: TrendItem[] = [];
  const notes: string[] = [];
  let requestCount = 0;

  if (!isBooleanEnvEnabled("DOUYIN_CREATOR_INDEX_ENABLED", false)) {
    notes.push("Douyin creator index skipped: DOUYIN_CREATOR_INDEX_ENABLED is off.");
    return { items, notes, requestCount };
  }

  const creatorCookies = Array.from(new Set([
    String(process.env.DOUYIN_CREATOR_INDEX_COOKIE || "").trim(),
    String(process.env.DOUYIN_CREATOR_CENTER_COOKIE || "").trim(),
    ...cookies,
  ].filter(Boolean)));
  if (!creatorCookies.length) {
    notes.push("Douyin creator index skipped: no creator cookie or douyin cookie available.");
    return { items, notes, requestCount };
  }

  const csrfResolution = await resolveDouyinCreatorIndexCsrfToken(creatorCookies);
  notes.push(csrfResolution.note);
  const csrfToken = csrfResolution.token;
  if (!csrfToken) {
    return { items, notes, requestCount };
  }

  const seedVideoIds = Array.from(new Set([
    ...parseCsvEnv("DOUYIN_CREATOR_INDEX_VIDEO_IDS"),
    ...seedItems
      .map((item) => String(item.id || "").trim())
      .filter(Boolean)
      .slice(0, Math.max(3, parseNumberEnv("DOUYIN_CREATOR_INDEX_VIDEO_LIMIT", 8))),
  ])).slice(0, Math.max(3, parseNumberEnv("DOUYIN_CREATOR_INDEX_VIDEO_LIMIT", 8)));
  const explicitAuthorIds = parseCsvEnv("DOUYIN_CREATOR_INDEX_AUTHOR_IDS");
  const keywordSeeds = extractDouyinCreatorKeywordSeeds(seedItems, prioritizedKeywords);
  const topicIds = parseCsvEnv("DOUYIN_CREATOR_INDEX_TOPIC_IDS");
  const brandSeeds = parseDouyinCreatorBrandSeeds();
  const discoveredAuthorIds: string[] = [];
  const authorIds = new Set(explicitAuthorIds);

  for (const cookie of creatorCookies) {
    for (const itemId of seedVideoIds) {
      try {
        const baseResponse = await fetch("https://creator.douyin.com/api/v2/index/itemBase", {
          method: "POST",
          headers: buildDouyinCreatorIndexHeaders(
            cookie,
            csrfToken,
            `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/videoanalysis?id=${encodeURIComponent(itemId)}&source=creator`,
          ),
          body: JSON.stringify({ itemId }),
        });
        requestCount += 1;
        if (!baseResponse.ok) {
          notes.push(`Douyin creator index itemBase ${itemId} responded with ${baseResponse.status}.`);
          continue;
        }
        const basePayload = await baseResponse.json() as Record<string, any>;
        const baseData = basePayload?.data as Record<string, any> | undefined;
        if (!baseData?.itemId || !baseData?.title) {
          notes.push(`Douyin creator index itemBase ${itemId} returned empty data.`);
          continue;
        }
        const authorId = String(baseData.authorIdString ?? "").trim();
        if (authorId && !authorIds.has(authorId)) {
          authorIds.add(authorId);
          discoveredAuthorIds.push(authorId);
        }

        const trendResponse = await fetch("https://creator.douyin.com/api/v2/index/itemIndex", {
          method: "POST",
          headers: buildDouyinCreatorIndexHeaders(
            cookie,
            csrfToken,
            `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/videoanalysis?id=${encodeURIComponent(itemId)}&source=creator`,
          ),
          body: JSON.stringify({
            itemId,
            startDate: "",
            endDate: "",
          }),
        });
        requestCount += 1;
        if (!trendResponse.ok) {
          notes.push(`Douyin creator index itemIndex ${itemId} responded with ${trendResponse.status}.`);
          continue;
        }
        const trendPayload = await trendResponse.json() as Record<string, any>;
        const trendData = trendPayload?.data as Record<string, any> | undefined;
        const trendList = Array.isArray(trendData?.trend) ? trendData.trend as Array<Record<string, any>> : [];
        const latestTrend = trendList.slice(-1)[0] ?? {};
        const views = parseChineseCount(latestTrend.value) ?? parseChineseCount(trendData?.avg);
        const likes = parseChineseCount(baseData.likes);
        items.push({
          id: `douyin-index-video:${itemId}`,
          title: String(baseData.title).trim(),
          bucket: "douyin_creator_index_video",
          author: String(baseData.nickname ?? "").trim() || undefined,
          url: String(baseData.url ?? "").trim() || undefined,
          publishedAt: safeDateFromTimestamp(Date.parse(String(baseData.createTime || "")) || undefined),
          likes,
          views,
          hotValue: views || likes,
          contentType: "video",
          tags: [
            String(baseData.categoryName ?? "").trim(),
            String(baseData.douyinId ?? "").trim(),
          ].filter(Boolean),
        });
      } catch (error) {
        requestCount += 1;
        notes.push(`Douyin creator index video ${itemId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    break;
  }

  const authorLimit = Math.max(3, parseNumberEnv("DOUYIN_CREATOR_INDEX_AUTHOR_LIMIT", 6));
  for (const cookie of creatorCookies) {
    for (const userId of Array.from(authorIds).slice(0, authorLimit)) {
      try {
        const response = await fetch("https://creator.douyin.com/api/v2/daren/get_author_info", {
          method: "POST",
          headers: buildDouyinCreatorIndexHeaders(
            cookie,
            csrfToken,
            `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/daren/detail?uid=${encodeURIComponent(userId)}&source=creator`,
          ),
          body: JSON.stringify({ user_id: userId }),
        });
        requestCount += 1;
        if (!response.ok) {
          notes.push(`Douyin creator index author ${userId} responded with ${response.status}.`);
          continue;
        }
        const payload = await response.json() as Record<string, any>;
        const data = payload?.data as Record<string, any> | undefined;
        if (!data?.user_id || !data?.user_name) continue;
        items.push({
          id: `douyin-index-author:${String(data.user_id).trim()}`,
          title: `${String(data.user_name).trim()} 达人画像`,
          bucket: "douyin_creator_index_author",
          author: String(data.user_name).trim(),
          url: String(data.user_aweme_url ?? "").trim() || undefined,
          likes: parseChineseCount(data.like_count),
          views: parseChineseCount(data.fans_count),
          hotValue: parseChineseCount(data.fans_count),
          contentType: "topic",
          tags: [
            String(data.first_tag_name ?? "").trim(),
            String(data.second_tag_name ?? "").trim(),
          ].filter(Boolean),
        });
      } catch (error) {
        requestCount += 1;
        notes.push(`Douyin creator index author ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    break;
  }

  if (discoveredAuthorIds.length) {
    notes.push(`Douyin creator index discovered ${discoveredAuthorIds.length} author ids from video seeds.`);
  }

  if (creatorCookies.length && keywordSeeds.length) {
    const beginDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const startDate = `${beginDate.getUTCFullYear()}${String(beginDate.getUTCMonth() + 1).padStart(2, "0")}${String(beginDate.getUTCDate()).padStart(2, "0")}`;
    const today = new Date();
    const endDate = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
    const keywordWindow = keywordSeeds.slice(0, Math.max(1, parseNumberEnv("DOUYIN_CREATOR_INDEX_KEYWORD_LIMIT", 6)));
    notes.push(`Douyin creator index keyword probes: ${keywordWindow.join(", ")}.`);

    for (const keyword of keywordWindow) {
      const payload = { keyword_list: [keyword] };
      const validDateProbe = await probeDouyinCreatorIndexEndpoint(creatorCookies, csrfToken, {
        url: "https://creator.douyin.com/api/v2/index/get_keyword_valid_date",
        referer: "https://creator.douyin.com/creator-micro/creator-count/arithmetic-index",
        label: `Douyin creator index keyword valid-date ${keyword}`,
        body: payload,
      });
      requestCount += validDateProbe.requestCount;
      notes.push(validDateProbe.note);

      const hotTrendProbe = await probeDouyinCreatorIndexEndpoint(creatorCookies, csrfToken, {
        url: "https://creator.douyin.com/api/v2/index/get_multi_keyword_hot_trend",
        referer: `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysis?source=creator&keyword=${encodeURIComponent(keyword)}&appName=aweme`,
        label: `Douyin creator index keyword trend ${keyword}`,
        body: {
          keyword_list: [keyword],
          start_date: startDate,
          end_date: endDate,
          app_name: "aweme",
          region: [],
        },
      });
      requestCount += hotTrendProbe.requestCount;
      notes.push(hotTrendProbe.note);

      const interpretationProbe = await probeDouyinCreatorIndexEndpoint(creatorCookies, csrfToken, {
        url: "https://creator.douyin.com/api/v2/index/get_multi_keyword_interpretation",
        referer: `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysis?source=creator&keyword=${encodeURIComponent(keyword)}&appName=aweme`,
        label: `Douyin creator index keyword interpretation ${keyword}`,
        body: {
          keyword_list: [keyword],
          app_name: "aweme",
          start_date: startDate,
          end_date: endDate,
          region: [],
        },
      });
      requestCount += interpretationProbe.requestCount;
      notes.push(interpretationProbe.note);

      const keywordSignal = buildDouyinCreatorIndexSignalItem({
        id: `douyin-index-keyword-probe:${keyword}`,
        title: `${keyword} 关键词指数信号`,
        bucket: "douyin_creator_index_keyword_probe",
        label: keyword,
        probeKinds: [validDateProbe.payloadKind, hotTrendProbe.payloadKind, interpretationProbe.payloadKind],
        url: `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysis?source=creator&keyword=${encodeURIComponent(keyword)}&appName=aweme`,
      });
      if (keywordSignal) items.push(keywordSignal);
    }

    const hotWordProbe = await probeDouyinCreatorIndexEndpoint(creatorCookies, csrfToken, {
      url: "https://creator.douyin.com/api/v2/index/get_hot_trend_word",
      referer: "https://creator.douyin.com/creator-micro/creator-count/arithmetic-index",
      label: "Douyin creator index hot trend words",
      body: {
        app: "aweme",
        type: 0,
      },
    });
    requestCount += hotWordProbe.requestCount;
    notes.push(hotWordProbe.note);
    const hotWordSignal = buildDouyinCreatorIndexSignalItem({
      id: "douyin-index-hot-trend-words",
      title: "抖音热词指数信号",
      bucket: "douyin_creator_index_hot_words_probe",
      label: "hot_trend_words",
      probeKinds: [hotWordProbe.payloadKind],
      url: "https://creator.douyin.com/creator-micro/creator-count/arithmetic-index",
    });
    if (hotWordSignal) items.push(hotWordSignal);
  }

  if (creatorCookies.length && topicIds.length) {
    const beginDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const startDate = `${beginDate.getUTCFullYear()}${String(beginDate.getUTCMonth() + 1).padStart(2, "0")}${String(beginDate.getUTCDate()).padStart(2, "0")}`;
    const today = new Date();
    const endDate = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
    notes.push(`Douyin creator index topic probes: ${topicIds.join(", ")}.`);
    const topicProbe = await probeDouyinCreatorIndexEndpoint(creatorCookies, csrfToken, {
      url: "https://creator.douyin.com/api/v2/index/get_multi_topic_list",
      referer: `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysis?topic=${encodeURIComponent(topicIds[0])}&source=creator`,
      label: `Douyin creator index topics (${topicIds.length})`,
      body: {
        app_name: "aweme",
        topic_ids: topicIds,
        begin_date: startDate,
        end_date: endDate,
      },
    });
    requestCount += topicProbe.requestCount;
    notes.push(topicProbe.note);
    const topicSignal = buildDouyinCreatorIndexSignalItem({
      id: `douyin-index-topic-probe:${topicIds.join(",")}`,
      title: `${topicIds[0]} 话题指数信号`,
      bucket: "douyin_creator_index_topic_probe",
      label: topicIds.join(","),
      probeKinds: [topicProbe.payloadKind],
      url: `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysis?topic=${encodeURIComponent(topicIds[0])}&source=creator`,
    });
    if (topicSignal) items.push(topicSignal);
  }

  if (creatorCookies.length && brandSeeds.length) {
    const beginDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const startDate = `${beginDate.getUTCFullYear()}${String(beginDate.getUTCMonth() + 1).padStart(2, "0")}${String(beginDate.getUTCDate()).padStart(2, "0")}`;
    const today = new Date();
    const endDate = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
    const brandList = brandSeeds.slice(0, Math.max(1, parseNumberEnv("DOUYIN_CREATOR_INDEX_BRAND_LIMIT", 4))).map((brand) => ({
      brand_name: brand.brandName,
      category_id: brand.categoryId,
    }));
    notes.push(`Douyin creator index brand probes: ${brandList.map((brand) => `${brand.brand_name}:${brand.category_id}`).join(", ")}.`);

    const brandReferer = `https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysisTheme?source=creator&keyword=${encodeURIComponent(brandList[0]?.brand_name || "")}&categoryId=${encodeURIComponent(brandList[0]?.category_id || "")}&appName=aweme`;
    for (const probe of [
      {
        url: "https://creator.douyin.com/api/v2/index/get_multi_brand_index",
        label: "Douyin creator index brands",
        body: {
          brand_list: brandList,
          start_date: startDate,
          end_date: endDate,
          app_name: "aweme",
        },
      },
      {
        url: "https://creator.douyin.com/api/v2/index/getBrandLines",
        label: "Douyin creator index brand lines",
        body: {
          brand_list: brandList,
          app: "aweme",
          start_date: startDate,
          end_date: endDate,
        },
      },
      {
        url: "https://creator.douyin.com/api/v2/index/getBrandRadarChart",
        label: "Douyin creator index brand radar",
        body: {
          brand_list: brandList,
          app: "aweme",
          start_date: startDate,
          end_date: endDate,
        },
      },
      {
        url: "https://creator.douyin.com/api/v2/index/getBrandCycles",
        label: "Douyin creator index brand cycles",
        body: {
          brand_list: brandList,
          app: "aweme",
          start_date: startDate,
          end_date: endDate,
        },
      },
    ]) {
      const result = await probeDouyinCreatorIndexEndpoint(creatorCookies, csrfToken, {
        url: probe.url,
        referer: brandReferer,
        label: probe.label,
        body: probe.body,
      });
      requestCount += result.requestCount;
      notes.push(result.note);
      const brandSignal = buildDouyinCreatorIndexSignalItem({
        id: `douyin-index-brand-probe:${brandList[0]?.brand_name}:${brandList[0]?.category_id}:${probe.label}`,
        title: `${brandList[0]?.brand_name || "品牌"} 指数信号`,
        bucket: "douyin_creator_index_brand_probe",
        label: `${brandList[0]?.brand_name || ""}:${brandList[0]?.category_id || ""}:${probe.label}`,
        probeKinds: [result.payloadKind],
        url: brandReferer,
      });
      if (brandSignal) items.push(brandSignal);
    }
  }

  if (creatorCookies.length) {
    notes.push("Douyin creator index now ingests plain video/author analytics and probes keyword/topic/brand endpoints, marking encrypted payloads explicitly.");
  }

  const pageCapture = await collectDouyinCreatorIndexPageItems(
    creatorCookies,
    keywordSeeds,
    topicIds,
    brandSeeds,
  );
  items.push(...pageCapture.items);
  notes.push(...pageCapture.notes);
  requestCount += pageCapture.requestCount;

  return { items: dedupeById(items), notes, requestCount };
}

function getItemsWithinDays(items: TrendItem[], days: number) {
  return filterTrendItemsByWindowDays(items, days);
}

function getAgeDays(iso?: string) {
  return getTrendItemAgeDays(iso);
}

function resolveCollectionWindow(items: TrendItem[], referenceMinItems: number, platform: GrowthPlatform) {
  const windows = getWindowCandidates(platform).map((days) => ({
    days,
    count: getItemsWithinDays(items, days).length,
  }));
  const threshold = Math.max(referenceMinItems, Math.min(500, getPlatformTargetItemCount(platform)));
  const preferred = windows.find((window) => window.count >= threshold) || windows[windows.length - 1];
  return {
    windowDays: preferred?.days || getTargetWindowDays(),
    selectedCount: preferred?.count || items.length,
    windows,
  };
}

function finalizeCollection(
  platform: GrowthPlatform,
  source: TrendSource,
  items: TrendItem[],
  notes: string[],
  statsInput: Omit<TrendCollectionStats, "platform" | "itemCount" | "uniqueAuthorCount" | "bucketCounts" | "industryCounts" | "ageCounts" | "contentCounts"> & {
    rawFetchedCount?: number;
  },
): PlatformTrendCollection {
  const normalizedItems = items.map((item) => ({
    ...item,
    bucket: normalizeTrendBucket(platform, item.bucket, item.contentType),
    ...classifyTrendItem(item),
  }));
  const warehouseIngest = statsInput.collectorMode === "warehouse";
  const resolvedWindow = resolveCollectionWindow(
    normalizedItems,
    statsInput.referenceMinItems,
    platform,
  );
  const windowFilteredItems = getItemsWithinDays(normalizedItems, resolvedWindow.windowDays);
  const storedItems = warehouseIngest ? normalizedItems : windowFilteredItems;
  const afterDedupCount = normalizedItems.length;
  const afterWindowFilterCount = windowFilteredItems.length;
  const rawFetchedCount = statsInput.rawFetchedCount ?? afterDedupCount;
  const uniqueAuthorCount = new Set(
    storedItems.map((item) => String(item.author || "").trim()).filter(Boolean),
  ).size;
  const enrichedNotes = [
    ...notes,
    `Pipeline: rawFetched=${rawFetchedCount} afterDedup=${afterDedupCount} afterWindowFilter=${afterWindowFilterCount} mergedAdded=(see mergeStats) warehouseIngest=${warehouseIngest ? "yes" : "no"}.`,
    `Target lookback: ${getTargetWindowDays()} days; fallback windows: ${getFallbackWindowDays(platform).join(", ")} days.`,
    `Selected ${resolvedWindow.windowDays}-day window for ${platform}; sample counts by window: ${resolvedWindow.windows.map((item) => `${item.days}d=${item.count}`).join(", ")}.`,
    warehouseIngest
      ? `Warehouse ingest: storing all ${storedItems.length} deduped items; window filter applies at snapshot/dashboard read time.`
      : `Window-filtered ingest: storing ${storedItems.length} items within ${resolvedWindow.windowDays} days.`,
    `Target item floor for ${platform}: ${getPlatformTargetItemCount(platform)}.`,
  ];
  return {
    platform,
    source,
    collectedAt: nowShanghaiIso(),
    windowDays: resolvedWindow.windowDays,
    items: storedItems,
    notes: enrichedNotes,
    stats: {
      platform,
      itemCount: storedItems.length,
      uniqueAuthorCount,
      bucketCounts: getBucketCounts(storedItems),
      industryCounts: countLabels(storedItems, "industryLabels"),
      ageCounts: countLabels(storedItems, "ageLabels"),
      contentCounts: countLabels(storedItems, "contentLabels"),
      rawFetchedCount,
      afterDedupCount,
      afterWindowFilterCount,
      warehouseIngest,
      ...statsInput,
    },
  };
}

function extractXhsCommentSamples(payload: any, limit: number): TrendItem["commentSamples"] {
  const candidates = Array.isArray(payload?.data?.comments)
    ? payload.data.comments
    : Array.isArray(payload?.comments)
      ? payload.comments
      : [];
  return normalizeCommentSamples(
    candidates.map((comment: any) => ({
      author: String(comment?.user_info?.nickname ?? comment?.nickname ?? "").trim() || undefined,
      text: String(comment?.content ?? comment?.comment ?? "").trim(),
      likeCount: Number(comment?.like_count ?? comment?.liked_count ?? comment?.likes ?? 0) || undefined,
    })),
    limit,
  );
}

async function fetchXhsCommentSamples(
  noteId: string,
  cookie: string,
  limit: number,
): Promise<TrendItem["commentSamples"]> {
  if (!noteId || !cookie || limit <= 0) return undefined;
  try {
    const url = `https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${encodeURIComponent(noteId)}&cursor=&top_comment_id=&image_formats=jpg,webp,avif`;
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        accept: "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        referer: `https://www.xiaohongshu.com/explore/${noteId}`,
        cookie,
      },
    });
    if (!response.ok) return undefined;
    const payload = await response.json();
    return extractXhsCommentSamples(payload, limit);
  } catch {
    return undefined;
  }
}

async function collectBilibili(): Promise<PlatformTrendCollection> {
  const items: TrendItem[] = [];
  const notes: string[] = [];
  const cookie = String(process.env.BILIBILI_COOKIE || "").trim();
  const popularPages = Math.max(1, Math.min(6, parsePreferredNumberEnv("GROWTH_BILIBILI_TREND_PAGES", "BILIBILI_TREND_PAGES", 6)));
  const popularPageSize = Math.max(10, Math.min(50, Number(process.env.BILIBILI_TREND_PAGE_SIZE || 50) || 50));
  const authPageSize = Math.max(6, Math.min(50, Number(process.env.BILIBILI_AUTH_TREND_PAGE_SIZE || 30) || 30));
  const defaultSearchPages = Math.max(4, Math.min(6, parsePreferredNumberEnv("GROWTH_BILIBILI_SEARCH_PAGES", "BILIBILI_SEARCH_PAGES", 5)));
  const searchPageSize = Math.max(10, Math.min(50, Number(process.env.BILIBILI_SEARCH_PAGE_SIZE || 50) || 50));
  const defaultKeywordLimit = Math.max(16, Math.min(20, parsePreferredNumberEnv("GROWTH_BILIBILI_SEARCH_KEYWORD_LIMIT", "BILIBILI_SEARCH_KEYWORD_LIMIT", 16)));
  const rankingRids = (parseCsvEnv("BILIBILI_RANKING_RIDS").length
    ? parseCsvEnv("BILIBILI_RANKING_RIDS")
    : ["0", "1", "4", "5", "36", "188"])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  const regionRids = (parseCsvEnv("BILIBILI_REGION_RIDS").length
    ? parseCsvEnv("BILIBILI_REGION_RIDS")
    : ["1", "3", "4", "5"])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  const regionPageSize = Math.max(10, Math.min(30, Number(process.env.BILIBILI_REGION_PAGE_SIZE || 20) || 20));
  const searchRoute = await getAdaptiveRouteDecision("bilibili", "search_feed", {
    pageCount: defaultSearchPages,
    keywordLimit: defaultKeywordLimit,
    minimumPages: 4,
  });
  const searchPages = searchRoute.pageCount || defaultSearchPages;
  const searchKeywords = await prioritizeAdaptiveSeeds(
    "bilibili",
    "search_feed",
    getPlatformSeeds("bilibili"),
    searchRoute.keywordLimit || defaultKeywordLimit,
  );
  // 默认优先 pubdate，避免仅 click 排序导致短窗样本偏老爆款
  const searchOrders = Array.from(new Set((parseCsvEnv("BILIBILI_SEARCH_ORDERS").length
    ? parseCsvEnv("BILIBILI_SEARCH_ORDERS")
    : ["pubdate", "click"])
    .map((item) => item.trim())
    .filter((item) => ["pubdate", "click"].includes(item))));
  const concurrency = Math.max(2, Math.min(12, Number(process.env.GROWTH_COLLECTOR_CONCURRENCY || 6) || 6));
  let requestCount = 0;

  const pushBilibiliItem = (item: Record<string, any>, bucket = "bilibili_feed") => {
    const title = String(item.title ?? "").trim();
    if (!title) return;
    items.push({
      id: String(item.aid ?? item.id ?? item.bvid ?? `bili-${items.length}`),
      title,
      bucket,
      author: String(item.owner?.name ?? item.author ?? "").trim() || undefined,
      url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : undefined,
      publishedAt: safeDateFromUnix(Number(item.pubdate)),
      likes: Number(item.stat?.like ?? item.like ?? 0) || undefined,
      comments: Number(item.stat?.reply ?? item.review ?? 0) || undefined,
      shares: Number(item.stat?.share ?? 0) || undefined,
      views: Number(item.stat?.view ?? item.play ?? 0) || undefined,
      hotValue: Number(item.stat?.like ?? item.like ?? 0) + Number(item.stat?.reply ?? item.review ?? 0),
      contentType: "video",
      tags: [String(item.tname ?? item.tag ?? "").trim()].filter(Boolean),
    });
  };

  const bilibiliHeaders = (referer: string) => ({
    accept: "application/json,text/plain,*/*",
    referer,
    "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
    ...(cookie ? { cookie } : {}),
  });

  if (cookie) {
    requestCount += 1;
    const response = await fetch(`https://api.bilibili.com/x/web-interface/index/top/feed/rcmd?ps=${authPageSize}&fresh_type=4&fresh_idx=1&fresh_idx_1h=1`, {
      headers: bilibiliHeaders("https://www.bilibili.com/"),
    });
    if (!response.ok) {
      throw new Error(`Bilibili recommend API responded with ${response.status}`);
    }
    const payload = await response.json() as {
      data?: { item?: Array<Record<string, any>> };
    };
    const list = payload.data?.item ?? [];
    list.forEach((item) => pushBilibiliItem(item, "bilibili_feed"));
    notes.push(`Fetched ${list.length} authenticated Bilibili recommended videos.`);
  }

  const popularResults = await runBatches(
    Array.from({ length: popularPages }, (_, index) => index + 1).map((page) => async () => {
      requestCount += 1;
      const response = await fetch(`https://api.bilibili.com/x/web-interface/popular?pn=${page}&ps=${popularPageSize}`, {
        headers: bilibiliHeaders("https://www.bilibili.com/v/popular/all"),
      });
      if (!response.ok) return { page, list: [] as Array<Record<string, any>> };
      const payload = await response.json() as {
        data?: { list?: Array<Record<string, any>> };
      };
      return { page, list: payload.data?.list ?? [] };
    }),
    concurrency,
  );
  for (const result of popularResults) {
    result.list.forEach((item) => pushBilibiliItem(item, "bilibili_popular"));
    notes.push(`Fetched ${result.list.length} Bilibili popular videos on page ${result.page}.`);
  }

  const rankingResults = await runBatches(
    rankingRids.map((rid) => async () => {
      requestCount += 1;
      const response = await fetch(`https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`, {
        headers: bilibiliHeaders("https://www.bilibili.com/v/popular/rank/all"),
      });
      if (!response.ok) return { rid, list: [] as Array<Record<string, any>> };
      const payload = await response.json() as {
        data?: { list?: Array<Record<string, any>> };
      };
      return { rid, list: payload.data?.list ?? [] };
    }),
    concurrency,
  );
  for (const result of rankingResults) {
    result.list.forEach((item) => pushBilibiliItem(item, `bilibili_ranking_${result.rid}`));
    notes.push(`Fetched ${result.list.length} Bilibili ranking videos for rid=${result.rid}.`);
  }

  const regionResults = await runBatches(
    regionRids.map((rid) => async () => {
      requestCount += 1;
      const response = await fetch(`https://api.bilibili.com/x/web-interface/dynamic/region?ps=${regionPageSize}&rid=${rid}`, {
        headers: bilibiliHeaders(`https://www.bilibili.com/v/popular/all?rid=${rid}`),
      });
      if (!response.ok) return { rid, list: [] as Array<Record<string, any>> };
      const payload = await response.json() as {
        data?: { items?: Array<Record<string, any>> };
      };
      const list = (payload.data?.items ?? [])
        .map((row) => row?.modules?.module_dynamic?.major?.archive ?? row?.archive ?? row)
        .filter(Boolean) as Array<Record<string, any>>;
      return { rid, list };
    }),
    concurrency,
  );
  for (const result of regionResults) {
    result.list.forEach((item) => pushBilibiliItem(item, `bilibili_region_${result.rid}`));
    notes.push(`Fetched ${result.list.length} Bilibili region dynamic videos for rid=${result.rid}.`);
  }

  const searchTasks = searchKeywords.flatMap((keyword) =>
    searchOrders.flatMap((order) =>
      Array.from({ length: searchPages }, (_, index) => index + 1).map((page) => async () => {
        requestCount += 1;
        const searchUrl = new URL("https://api.bilibili.com/x/web-interface/search/type");
        searchUrl.searchParams.set("search_type", "video");
        searchUrl.searchParams.set("keyword", keyword);
        searchUrl.searchParams.set("page", String(page));
        searchUrl.searchParams.set("page_size", String(searchPageSize));
        if (order) searchUrl.searchParams.set("order", order);
        const response = await fetch(searchUrl.toString(), {
          headers: bilibiliHeaders("https://search.bilibili.com/"),
        });
        if (!response.ok) return { keyword, order, page, list: [] as Array<Record<string, any>> };
        const payload = await response.json() as {
          data?: { result?: Array<Record<string, any>> };
        };
        return { keyword, order, page, list: payload.data?.result ?? [] };
      }),
    ),
  );
  const searchResults = await runBatches(searchTasks, concurrency);
  for (const result of searchResults) {
    result.list.forEach((item) => {
      pushBilibiliItem({
        aid: item.aid,
        id: item.aid,
        bvid: item.bvid,
        title: String(item.title || "").replace(/<[^>]+>/g, ""),
        pubdate: Number(item.pubdate),
        owner: { name: item.author },
        stat: {
          like: parseChineseCount(item.like) || 0,
          reply: parseChineseCount(item.review) || 0,
          view: parseChineseCount(item.play) || 0,
          share: 0,
        },
        tname: item.tag,
      }, "bilibili_search");
    });
    notes.push(`Fetched ${result.list.length} Bilibili search videos for keyword ${result.keyword} ${result.order || "default"} page ${result.page}.`);
  }
  await recordAdaptiveRouteRun({
    platform: "bilibili",
    routeKey: "search_feed",
    yieldCount: searchResults.reduce((sum, item) => sum + item.list.length, 0),
    requestCount: searchKeywords.length * searchPages * searchOrders.length,
  });
  await recordAdaptiveSeedRun({
    platform: "bilibili",
    routeKey: "search_feed",
    seeds: searchKeywords,
    yieldedCount: searchResults.reduce((sum, item) => sum + item.list.length, 0),
  });

  const rawFetchedCount = items.length;
  const dedupedItems = dedupeById(items);
  notes.push(`Fetched ${rawFetchedCount} raw Bilibili videos; ${dedupedItems.length} after dedupe (popular+ranking+region+search).`);
  return finalizeCollection("bilibili", "live", dedupedItems, notes, {
    collectorMode: "warehouse",
    rawFetchedCount,
    requestCount,
    pageDepth: Math.max(popularPages, searchPages),
    targetPerRun: Math.max(
      popularPages * popularPageSize
        + (cookie ? authPageSize : 0)
        + rankingRids.length * 50
        + regionRids.length * regionPageSize
        + searchKeywords.length * searchPages * searchOrders.length * searchPageSize,
      getPlatformTargetItemCount("bilibili"),
    ),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.bilibili?.min || 40,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.bilibili?.max || 80,
  });
}

function mapDouyinAwemeToTrendItem(
  aweme: Record<string, any>,
  bucket: string,
  extraTags: string[] = [],
): TrendItem | null {
  const title = String(aweme.desc ?? aweme.caption ?? "").trim();
  const awemeId = String(aweme.aweme_id ?? aweme.group_id ?? "").trim();
  if (!awemeId || !title) return null;
  const stats = aweme.statistics ?? {};
  const author = aweme.author ?? {};
  const tags = Array.from(new Set([
    ...(Array.isArray(aweme.text_extra)
      ? aweme.text_extra
        .map((entry: any) => String(entry?.hashtag_name ?? "").trim())
        .filter(Boolean)
      : []),
    ...extraTags.map((tag) => String(tag || "").trim()).filter(Boolean),
  ]));
  return {
    id: awemeId,
    title,
    bucket,
    author: String(author.nickname ?? author.uid ?? "").trim() || undefined,
    url: `https://www.douyin.com/video/${awemeId}`,
    publishedAt: safeDateFromUnix(Number(aweme.create_time)),
    likes: Number(stats.digg_count ?? 0) || undefined,
    comments: Number(stats.comment_count ?? 0) || undefined,
    shares: Number(stats.share_count ?? 0) || undefined,
    views: Number(stats.play_count ?? 0) || undefined,
    hotValue: Number(stats.digg_count ?? 0) + Number(stats.comment_count ?? 0),
    contentType: "video",
    tags,
    ...metaFromDouyinAuthor(author),
    ...metaFromDouyinAweme(aweme, { title, tags }),
  };
}

/** 默认 AI 漫剧 / 短剧搜索词（可用 DOUYIN_DRAMA_SEARCH_KEYWORDS 覆盖） */
const DEFAULT_DOUYIN_DRAMA_SEARCH_KEYWORDS = [
  "AI漫剧",
  "AI短剧",
  "重生漫剧",
  "动态漫",
  "红果漫剧",
];

async function collectDouyinWebSearchItems(
  cookies: string[],
  keywords: string[],
): Promise<{ items: TrendItem[]; notes: string[]; requestCount: number }> {
  const notes: string[] = [];
  const items: TrendItem[] = [];
  let requestCount = 0;
  if (!cookies.length) {
    notes.push("Douyin web search skipped: no DOUYIN_COOKIE.");
    return { items, notes, requestCount };
  }
  if (!keywords.length) {
    notes.push("Douyin web search skipped: no drama search keywords.");
    return { items, notes, requestCount };
  }

  const enabled = String(process.env.DOUYIN_DRAMA_SEARCH_ENABLED || "1") !== "0";
  if (!enabled) {
    notes.push("Douyin web search skipped: DOUYIN_DRAMA_SEARCH_ENABLED=0.");
    return { items, notes, requestCount };
  }

  const pages = Math.max(1, Math.min(3, parseNumberEnv("DOUYIN_DRAMA_SEARCH_PAGES", 1)));
  const pageSize = Math.max(4, Math.min(20, parseNumberEnv("DOUYIN_DRAMA_SEARCH_PAGE_SIZE", 10)));
  const cookie = cookies[0];
  const searchRoute = await getAdaptiveRouteDecision("douyin", "drama_web_search", {
    keywordLimit: keywords.length,
    pageCount: pages,
    enabled: true,
  });
  if (!searchRoute.enabled) {
    notes.push("Douyin web search skipped by adaptive config due to sustained low yield.");
    return { items, notes, requestCount };
  }

  const keywordWindow = keywords.slice(0, Math.max(1, searchRoute.keywordLimit || keywords.length));
  const tasks = keywordWindow.map((keyword) => async () => {
    const keywordItems: TrendItem[] = [];
    for (let page = 0; page < pages; page += 1) {
      const offset = page * pageSize;
      const url = new URL("https://www.douyin.com/aweme/v1/web/general/search/single/");
      url.searchParams.set("device_platform", "webapp");
      url.searchParams.set("aid", "6383");
      url.searchParams.set("channel", "channel_pc_web");
      url.searchParams.set("search_channel", "aweme_general");
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("search_source", "normal_search");
      url.searchParams.set("query_correct_type", "1");
      url.searchParams.set("is_filter_search", "0");
      url.searchParams.set("from_group_id", "");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("count", String(pageSize));
      url.searchParams.set("cookie_enabled", "true");
      url.searchParams.set("browser_language", "zh-CN");
      url.searchParams.set("browser_platform", "MacIntel");
      url.searchParams.set("browser_name", "Chrome");
      url.searchParams.set("browser_version", "120.0.0.0");

      try {
        const response = await fetch(url.toString(), {
          headers: {
            accept: "application/json,text/plain,*/*",
            cookie,
            referer: `https://www.douyin.com/search/${encodeURIComponent(keyword)}`,
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        requestCount += 1;
        if (!response.ok) {
          notes.push(`Douyin web search "${keyword}" page ${page + 1} responded with ${response.status}.`);
          break;
        }
        const payload = await response.json() as Record<string, any>;
        const statusCode = Number(payload?.status_code ?? 0);
        if (statusCode !== 0 && statusCode !== 200) {
          notes.push(`Douyin web search "${keyword}" page ${page + 1} status_code=${statusCode} (${String(payload?.status_msg ?? "unknown")}).`);
          break;
        }
        const awemes = extractDouyinSearchAwemes(payload);
        for (const aweme of awemes) {
          const mapped = mapDouyinAwemeToTrendItem(
            aweme,
            `douyin_search_drama:${keyword}`,
            [keyword, "AI漫剧检索"],
          );
          if (mapped) keywordItems.push(mapped);
        }
        notes.push(`Fetched ${awemes.length} Douyin web search items for "${keyword}" page ${page + 1}.`);
        if (!awemes.length) break;
      } catch (error) {
        notes.push(`Douyin web search "${keyword}" page ${page + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    return keywordItems;
  });

  const results = await runBatches(tasks, Math.min(2, keywordWindow.length));
  results.forEach((list) => items.push(...list));
  await recordAdaptiveRouteRun({
    platform: "douyin",
    routeKey: "drama_web_search",
    yieldCount: items.length,
    requestCount,
  });
  await recordAdaptiveSeedRun({
    platform: "douyin",
    routeKey: "drama_web_search",
    seeds: keywordWindow,
    yieldedCount: items.length,
  });
  notes.push(`Douyin drama web search keywords=${keywordWindow.join(", ")}, items=${items.length}.`);
  return { items, notes, requestCount };
}

async function collectDouyin(): Promise<PlatformTrendCollection> {
  const cookies = parseCookiePool("DOUYIN_COOKIE", "DOUYIN_COOKIE_BACKUP");
  const creatorKeywordLimit = Math.max(2, parseNumberEnv("DOUYIN_CREATOR_INDEX_KEYWORD_LIMIT", 6));
  const feedPageLimitDefault = Math.max(1, Math.min(200, Number(process.env.DOUYIN_TREND_PAGES || 60) || 60));
  const feedConcurrencyDefault = Math.max(1, Math.min(4, cookies.length));
  const feedRoute = await getAdaptiveRouteDecision("douyin", "feed_live", {
    pageCount: feedPageLimitDefault,
    concurrency: feedConcurrencyDefault,
    minimumPages: 4,
  });
  const creatorIndexRoute = await getAdaptiveRouteDecision("douyin", "creator_index", {
    keywordLimit: creatorKeywordLimit,
    enabled: String(process.env.DOUYIN_CREATOR_INDEX_ENABLED || "1") !== "0",
  });
  const creatorKeywords = await prioritizeAdaptiveSeeds(
    "douyin",
    "creator_index",
    getPlatformSeeds("douyin"),
    creatorIndexRoute.keywordLimit || creatorKeywordLimit,
  );
  const explicitDramaKeywords = parseCsvEnv("DOUYIN_DRAMA_SEARCH_KEYWORDS");
  const dramaSearchKeywords = Array.from(new Set([
    ...(explicitDramaKeywords.length ? explicitDramaKeywords : DEFAULT_DOUYIN_DRAMA_SEARCH_KEYWORDS),
    ...creatorKeywords.filter((k) => /漫剧|短剧|动态漫|红果/i.test(k)),
  ])).slice(0, Math.max(2, parseNumberEnv("DOUYIN_DRAMA_SEARCH_KEYWORD_LIMIT", 5)));
  const creatorCenterEnabled = String(process.env.DOUYIN_CREATOR_CENTER_ENABLED || "1") !== "0";
  const creatorIndexEnabled = String(process.env.DOUYIN_CREATOR_INDEX_ENABLED || "1") !== "0";
  const topicItems: TrendItem[] = [];
  const topicResponse = await fetch("https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/", {
    headers: { "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0" },
  });
  if (topicResponse.ok) {
    const payload = await topicResponse.json() as {
      active_time?: string;
      word_list?: Array<Record<string, any>>;
    };
    topicItems.push(
      ...(payload.word_list ?? []).map((item, index) => ({
        id: String(item.sentence_id ?? item.word ?? index),
        title: String(item.word ?? "").trim(),
        bucket: "douyin_topics",
        hotValue: Number(item.hot_value ?? 0) || undefined,
        url: item.word ? `https://www.douyin.com/hot/${encodeURIComponent(String(item.word))}` : undefined,
        publishedAt: payload.active_time
          ? toShanghaiIso(String(payload.active_time).replace(" ", "T") + "+08:00")
          : undefined,
        contentType: "topic" as const,
        tags: [String(item.word_type ?? "").trim()].filter(Boolean),
      })),
    );
  }
  if (cookies.length) {
    const pageLimit = Math.max(1, Math.min(200, feedRoute.pageCount || feedPageLimitDefault));
    const pageSize = Math.max(8, Math.min(20, Number(process.env.DOUYIN_TREND_PAGE_SIZE || 12) || 12));
    const items: TrendItem[] = [...topicItems];
    const notes: string[] = [];
    let requestCount = 0;
    let feedRequestCount = 0;
    const cookieTasks = cookies.map((cookie, cookieIndex) => async () => {
      let maxCursor = "0";
      let hasMore = 0;
      const cookieItems: TrendItem[] = [];
      for (let page = 0; page < pageLimit; page += 1) {
        const response = await fetch(
          `https://www.douyin.com/aweme/v1/web/tab/feed/?publish_video_strategy_type=2&aid=6383&channel=channel_pc_web&cookie_enabled=true&count=${pageSize}&max_cursor=${maxCursor}&screen_width=1280&screen_height=800&browser_online=true&cpu_core_num=8&device_memory=8&downlink=10&effective_type=4g&round_trip_time=200`,
          {
            headers: {
              accept: "application/json,text/plain,*/*",
              cookie,
              referer: "https://www.douyin.com/",
              "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
            },
          },
        );

        requestCount += 1;
        feedRequestCount += 1;
        if (!response.ok) {
          throw new Error(`Douyin feed cookie ${cookieIndex + 1} responded with ${response.status}`);
        }

        const payload = await response.json() as {
          aweme_list?: Array<Record<string, any>>;
          has_more?: number;
          max_cursor?: number | string;
        };

        const pageItems = (payload.aweme_list ?? [])
          .map((item) => {
            const title = String(item.desc ?? item.caption ?? "").trim();
            if (!title) return null;
            const stats = item.statistics ?? {};
            const author = item.author ?? {};
            const tags = Array.isArray(item.text_extra)
              ? item.text_extra
                .map((entry) => String(entry?.hashtag_name ?? "").trim())
                .filter(Boolean)
              : [];
            return {
              id: String(item.aweme_id ?? item.group_id ?? ""),
              title,
              bucket: "douyin_feed",
              author: String(author.nickname ?? author.uid ?? "").trim() || undefined,
              url: item.aweme_id ? `https://www.douyin.com/video/${item.aweme_id}` : undefined,
              publishedAt: safeDateFromUnix(Number(item.create_time)),
              likes: Number(stats.digg_count ?? 0) || undefined,
              comments: Number(stats.comment_count ?? 0) || undefined,
              shares: Number(stats.share_count ?? 0) || undefined,
              views: Number(stats.play_count ?? 0) || undefined,
              hotValue: Number(stats.digg_count ?? 0) + Number(stats.comment_count ?? 0),
              contentType: "video" as const,
              tags,
              ...metaFromDouyinAuthor(author),
              ...metaFromDouyinAweme(item, { title, tags }),
            } satisfies TrendItem;
          })
          .filter(Boolean) as TrendItem[];

        cookieItems.push(...pageItems);
        hasMore = Number(payload.has_more ?? 0);
        maxCursor = String(payload.max_cursor ?? maxCursor);
        notes.push(`Fetched ${pageItems.length} Douyin authenticated feed videos on cookie ${cookieIndex + 1} page ${page + 1}.`);
        if (!hasMore || !pageItems.length) break;
      }
      notes.push(`Douyin cookie ${cookieIndex + 1} has_more: ${hasMore}`);
      return cookieItems;
    });

    const concurrency = Math.max(1, Math.min(feedRoute.concurrency || feedConcurrencyDefault, cookies.length));
    const cookieResults = await runBatches(cookieTasks, concurrency);
    cookieResults.forEach((cookieItems) => {
      items.push(...cookieItems);
    });
    notes.push(`Douyin adaptive feed route weight=${feedRoute.weight.toFixed(2)}, pages=${pageLimit}, concurrency=${concurrency}.`);

    if (creatorCenterEnabled) {
      const creatorCenter = await collectDouyinCreatorCenterItems(cookies, creatorKeywords);
      items.push(...creatorCenter.items);
      notes.push(...creatorCenter.notes);
      requestCount += creatorCenter.requestCount;
    } else {
      notes.push("Douyin creator center skipped: disabled by DOUYIN_CREATOR_CENTER_ENABLED=0.");
    }

    if (creatorIndexEnabled && creatorIndexRoute.enabled) {
      const creatorIndex = await collectDouyinCreatorIndexItems(cookies, items, creatorKeywords);
      items.push(...creatorIndex.items);
      notes.push(...creatorIndex.notes);
      requestCount += creatorIndex.requestCount;
      notes.push(`Douyin adaptive creator index weight=${creatorIndexRoute.weight.toFixed(2)}, keywords=${creatorKeywords.join(", ")}.`);
    } else if (creatorIndexEnabled) {
      notes.push("Douyin creator index skipped by adaptive config due to sustained low yield.");
    } else {
      notes.push("Douyin creator index skipped: disabled by DOUYIN_CREATOR_INDEX_ENABLED=0.");
    }

    const dramaSearch = await collectDouyinWebSearchItems(cookies, dramaSearchKeywords);
    items.push(...dramaSearch.items);
    notes.push(...dramaSearch.notes);
    requestCount += dramaSearch.requestCount;

    if (items.length) {
      const deduped = dedupeById(items);
      const feedYield = deduped.filter((item) => item.bucket === "douyin_feed").length;
      const creatorYield = deduped.filter((item) => String(item.bucket || "").startsWith("douyin_creator_")).length;
      const dramaYield = deduped.filter((item) => item.isDrama).length;
      const aiManhuaYield = deduped.filter((item) => item.dramaKind === "ai_manhua").length;
      notes.push(`Douyin drama yield: isDrama=${dramaYield}, ai_manhua=${aiManhuaYield}, searchItems=${dramaSearch.items.length}.`);
      await recordAdaptiveRouteRun({
        platform: "douyin",
        routeKey: "feed_live",
        yieldCount: feedYield,
        requestCount: feedRequestCount,
      });
      if (creatorIndexEnabled) {
        await recordAdaptiveRouteRun({
          platform: "douyin",
          routeKey: "creator_index",
          yieldCount: creatorYield,
          requestCount: Math.max(0, requestCount - feedRequestCount - dramaSearch.requestCount),
        });
        await recordAdaptiveSeedRun({
          platform: "douyin",
          routeKey: "creator_index",
          seeds: creatorKeywords,
          yieldedCount: creatorYield,
        });
      }
      return finalizeCollection("douyin", "live", deduped, notes, {
        collectorMode: "warehouse",
        requestCount,
        pageDepth: requestCount,
        targetPerRun: Math.max(cookies.length * pageLimit * pageSize, getPlatformTargetItemCount("douyin")),
        referenceMinItems: PLATFORM_REFERENCE_RANGES.douyin?.min || 12,
        referenceMaxItems: PLATFORM_REFERENCE_RANGES.douyin?.max || 30,
      });
    }
  }

  const creatorIndex = await collectDouyinCreatorIndexItems([], topicItems, creatorKeywords);
  const fallbackItems = dedupeById([...topicItems, ...creatorIndex.items]);
  const fallbackNotes = [
    `Fetched ${topicItems.length} Douyin hot search topics.`,
    ...creatorIndex.notes,
  ];
  return finalizeCollection("douyin", "live", fallbackItems, fallbackNotes, {
    collectorMode: "hot_topics",
    requestCount: 1 + creatorIndex.requestCount,
    pageDepth: 1 + creatorIndex.requestCount,
    targetPerRun: Math.max(20, getPlatformTargetItemCount("douyin")),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.douyin?.min || 12,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.douyin?.max || 30,
  });
}

/**
 * Extract the JSON value of window.__INITIAL_STATE__ from XHS HTML.
 * Uses balanced-brace counting to avoid issues with </script> inside JSON
 * or greedy regex catastrophic backtracking on large payloads.
 */
function extractXhsInitialState(html: string): string | null {
  const marker = "window.__INITIAL_STATE__=";
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) return null;
  const jsonStart = startIdx + marker.length;
  if (html[jsonStart] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(jsonStart, i + 1);
    }
  }
  return null;
}

async function collectXiaohongshu(): Promise<PlatformTrendCollection> {
  const cookie = String(process.env.XHS_COOKIE || "").trim();
  const paths = parseCsvEnv("XHS_EXPLORE_PATHS");
  const explorePaths = paths.length
    ? paths
    : [
      "https://www.xiaohongshu.com/explore",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed.fashion_v3",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed.food_v3",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed.travel_v3",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed.household_product_v3",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed.career_v3",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed.movie_and_tv_v3",
    ];
  // Xiaohongshu crawl intensity increased: pages, keyword limit, search pages, concurrency
  const pageLimit = Math.max(1, Math.min(16, parsePreferredNumberEnv("GROWTH_XHS_TREND_PAGES", "XHS_TREND_PAGES", 8)));
  const defaultXhsKeywordLimit = Math.max(3, parsePreferredNumberEnv("GROWTH_XHS_SEARCH_KEYWORD_LIMIT", "XHS_SEARCH_KEYWORD_LIMIT", 12));
  const defaultXhsSearchPages = Math.max(1, Math.min(8, parsePreferredNumberEnv("GROWTH_XHS_SEARCH_PAGES", "XHS_SEARCH_PAGES", 4)));
  const xhsCommentItemLimit = Math.max(0, Math.min(12, parsePreferredNumberEnv("GROWTH_XHS_COMMENT_SAMPLE_ITEMS", "XHS_COMMENT_SAMPLE_ITEMS", 6)));
  const xhsCommentSampleLimit = Math.max(0, Math.min(8, parsePreferredNumberEnv("GROWTH_XHS_COMMENT_SAMPLE_LIMIT", "XHS_COMMENT_SAMPLE_LIMIT", 4)));
  const xhsConcurrency = Math.max(2, Math.min(6, parsePreferredNumberEnv("GROWTH_XHS_CONCURRENCY", "XHS_CONCURRENCY", 4)));
  const xhsSearchRoute = await getAdaptiveRouteDecision("xiaohongshu", "search_feed", {
    pageCount: defaultXhsSearchPages,
    keywordLimit: defaultXhsKeywordLimit,
    minimumPages: 2,
  });
  const searchKeywords = await prioritizeAdaptiveSeeds(
    "xiaohongshu",
    "search_feed",
    getPlatformSeeds("xiaohongshu"),
    xhsSearchRoute.keywordLimit || defaultXhsKeywordLimit,
  );
  const searchPages = xhsSearchRoute.pageCount || defaultXhsSearchPages;
  // 默认加入 time_descending，提高短窗（3/7/15 天）近期有效样本占比
  const searchSorts = parseCsvEnv("XHS_SEARCH_SORTS").length
    ? parseCsvEnv("XHS_SEARCH_SORTS")
    : ["general", "time_descending", "popularity_desc"];
  const items: TrendItem[] = [];
  const notes: string[] = [];

  const exploreResults = await runBatches(
    explorePaths.slice(0, pageLimit).map((pageUrl) => async () => {
      const response = await fetch(pageUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          ...(cookie ? { cookie } : {}),
        },
      });
      if (!response.ok) return { pageUrl, items: [] as TrendItem[], debugNote: `HTTP ${response.status}` };
      const html = await response.text();
      const stateJson = extractXhsInitialState(html);
      if (!stateJson) return { pageUrl, items: [] as TrendItem[], debugNote: "no __INITIAL_STATE__ found" };
      const state = vm.runInNewContext(`(${stateJson})`, {}) as {
        feed?: { feeds?: Array<Record<string, any>> };
      };
      const feeds = state.feed?.feeds ?? [];
      const pageItems = feeds
        .map((feed, index) => {
          const noteCard = feed.noteCard;
          if (!noteCard) return null;
          const title = String(noteCard.displayTitle ?? "").trim();
          if (!title) return null;
          return {
            id: String(feed.id ?? `${pageUrl}-${index}`),
            title,
            bucket: "xiaohongshu_feed",
            author: String(noteCard.user?.nickname ?? noteCard.user?.nickName ?? "").trim() || undefined,
            url: feed.id ? `https://www.xiaohongshu.com/explore/${feed.id}` : undefined,
            likes: parseChineseCount(noteCard.interactInfo?.likedCount),
            comments: parseChineseCount(noteCard.interactInfo?.commentCount),
            shares: parseChineseCount(noteCard.interactInfo?.shareCount),
            contentType: noteCard.video ? "video" : "note",
            publishedAt: extractXhsPublishedAt(noteCard) || extractXhsPublishedAt(feed),
            ...metaFromXhsNote(noteCard),
          } satisfies TrendItem;
        })
        .filter(Boolean) as TrendItem[];
      return { pageUrl, items: pageItems, debugNote: "" };
    }),
    xhsConcurrency,
  );
  for (const result of exploreResults) {
    items.push(...result.items);
    const note = result.debugNote
      ? `Fetched ${result.items.length} Xiaohongshu items from ${result.pageUrl} [${result.debugNote}].`
      : `Fetched ${result.items.length} Xiaohongshu items from ${result.pageUrl}.`;
    notes.push(note);
  }

  const searchResults = await runBatches(
    searchKeywords.flatMap((keyword) =>
      searchSorts.flatMap((sort) =>
        Array.from({ length: searchPages }, (_, index) => index + 1).map((page) => async () => {
          const pageUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed&sort=${encodeURIComponent(sort)}&page=${page}`;
          const response = await fetch(pageUrl, {
            headers: {
              "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
              accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
              ...(cookie ? { cookie } : {}),
            },
          });
          if (!response.ok) return { keyword, sort, page, items: [] as TrendItem[], debugNote: `HTTP ${response.status}` };
          const html = await response.text();
          const stateJson = extractXhsInitialState(html);
          if (!stateJson) return { keyword, sort, page, items: [] as TrendItem[], debugNote: "no __INITIAL_STATE__ found" };
          const state = vm.runInNewContext(`(${stateJson})`, {}) as {
            searchResult?: { notes?: Array<Record<string, any>> };
            note?: { notes?: Array<Record<string, any>> };
          };
          const notesList = state.searchResult?.notes ?? state.note?.notes ?? [];
          const pageItems = notesList
            .map((note, itemIndex) => {
              const title = String(note.displayTitle ?? note.title ?? "").trim();
              if (!title) return null;
              return {
                id: String(note.id ?? `${keyword}-${sort}-${page}-${itemIndex}`),
                title,
                bucket: "xiaohongshu_feed",
                author: String(note.user?.nickname ?? note.user?.nickName ?? "").trim() || undefined,
                url: note.id ? `https://www.xiaohongshu.com/explore/${note.id}` : undefined,
                likes: parseChineseCount(note.interactInfo?.likedCount ?? note.likedCount),
                comments: parseChineseCount(note.interactInfo?.commentCount ?? note.commentCount),
                shares: parseChineseCount(note.interactInfo?.shareCount ?? note.shareCount),
                contentType: note.video ? "video" : "note",
                tags: [keyword, sort],
                publishedAt: extractXhsPublishedAt(note.noteCard ?? note) || extractXhsPublishedAt(note),
                ...metaFromXhsNote(note.noteCard ?? note),
              } satisfies TrendItem;
            })
            .filter(Boolean) as TrendItem[];
          return { keyword, sort, page, items: pageItems, debugNote: "" };
        }),
      ),
    ),
    xhsConcurrency,
  );
  for (const result of searchResults) {
    items.push(...result.items);
    const note = result.debugNote
      ? `Fetched ${result.items.length} Xiaohongshu search items for keyword ${result.keyword} sort ${result.sort} page ${result.page} [${result.debugNote}].`
      : `Fetched ${result.items.length} Xiaohongshu search items for keyword ${result.keyword} sort ${result.sort} page ${result.page}.`;
    notes.push(note);
  }
  await recordAdaptiveRouteRun({
    platform: "xiaohongshu",
    routeKey: "search_feed",
    yieldCount: searchResults.reduce((sum, item) => sum + item.items.length, 0),
    requestCount: searchKeywords.length * searchSorts.length * searchPages,
  });
  await recordAdaptiveSeedRun({
    platform: "xiaohongshu",
    routeKey: "search_feed",
    seeds: searchKeywords,
    yieldedCount: searchResults.reduce((sum, item) => sum + item.items.length, 0),
  });

  const rawFetchedCount = items.length;
  const dedupedItems = dedupeById(items);
  if (cookie && xhsCommentItemLimit > 0 && xhsCommentSampleLimit > 0) {
    const commentTargets = dedupedItems
      .filter((item) => item.id && item.url)
      .sort((left, right) => (right.hotValue || right.likes || 0) - (left.hotValue || left.likes || 0))
      .slice(0, xhsCommentItemLimit);
    const commentResults = await runBatches(
      commentTargets.map((item) => async () => ({
        id: item.id,
        samples: await fetchXhsCommentSamples(item.id, cookie, xhsCommentSampleLimit),
      })),
      2,
    );
    const byId = new Map(commentResults.filter((item) => item.samples?.length).map((item) => [item.id, item.samples]));
    for (const item of dedupedItems) {
      const samples = byId.get(item.id);
      if (samples?.length) item.commentSamples = samples;
    }
    notes.push(`Fetched Xiaohongshu comment samples for ${byId.size} items.`);
  }

  return finalizeCollection("xiaohongshu", "live", dedupedItems, notes, {
    collectorMode: "warehouse",
    rawFetchedCount,
    requestCount: Math.min(pageLimit, explorePaths.length) + (searchKeywords.length * searchSorts.length * searchPages),
    pageDepth: Math.max(Math.min(pageLimit, explorePaths.length), searchPages),
    targetPerRun: Math.max(items.length, 20 * Math.min(pageLimit, explorePaths.length), getPlatformTargetItemCount("xiaohongshu")),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.xiaohongshu?.min || 20,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.xiaohongshu?.max || 60,
  });
}

async function collectKuaishou(): Promise<PlatformTrendCollection> {
  const cookies = parseKuaishouCookiePool();
  const primaryKuaishouCookie = cookies[0] || "";
  const discoveredPrincipalIds = new Set(parseCsvEnv("KUAISHOU_TREND_PRINCIPALS").slice(0, 5));
  const endpoint = String(process.env.KUAISHOU_GRAPHQL_URL || "https://live.kuaishou.com/m_graphql").trim();
  // Kuaishou crawl intensity increased: count, pages, keyword limit
  const count = Math.max(6, Math.min(40, Number(process.env.KUAISHOU_TREND_COUNT || 36) || 36));
  const defaultPrivatePages = Math.max(1, Math.min(6, parsePreferredNumberEnv("GROWTH_KUAISHOU_PRIVATE_PAGES", "KUAISHOU_PRIVATE_PAGES", 4)));
  const privateConcurrency = Math.max(1, Math.min(3, Number(process.env.KUAISHOU_PRIVATE_CONCURRENCY || 2) || 2));
  const privateRetryLimit = Math.max(0, Math.min(4, Number(process.env.KUAISHOU_PRIVATE_RETRY_LIMIT || 2) || 2));
  const privateRetryDelayMs = Math.max(500, Math.min(8000, Number(process.env.KUAISHOU_PRIVATE_RETRY_DELAY_MS || 1500) || 1500));
  const publicPages = Math.max(1, Math.min(16, Number(process.env.KUAISHOU_TREND_PAGES || 12) || 12));
  const recoPages = Math.max(1, Math.min(4, Number(process.env.KUAISHOU_RECO_PAGES || 3) || 3));
  const visionGraphqlEndpoint = String(process.env.KUAISHOU_VISION_GRAPHQL_URL || "https://www.kuaishou.com/graphql").trim();
  const discoveryKeywords = getKuaishouDiscoveryKeywords();
  const defaultSearchKeywordLimit = Math.max(1, Math.min(24, parsePreferredNumberEnv("GROWTH_KUAISHOU_SEARCH_KEYWORD_LIMIT", "KUAISHOU_TREND_KEYWORD_LIMIT", 16)));
  const creatorSeeds = getKuaishouCreatorSeeds();
  const defaultSearchPages = Math.max(1, Math.min(8, parsePreferredNumberEnv("GROWTH_KUAISHOU_SEARCH_PAGES", "KUAISHOU_SEARCH_PAGES", 6)));
  const searchConcurrency = Math.max(2, Math.min(4, Number(process.env.KUAISHOU_SEARCH_CONCURRENCY || 3) || 3));
  const searchUserPages = Math.max(1, Math.min(3, Number(process.env.KUAISHOU_SEARCH_USER_PAGES || 2) || 2));
  const searchUserLimit = Math.max(8, Math.min(16, Number(process.env.KUAISHOU_SEARCH_USER_LIMIT || 16) || 16));
  const searchUserKeywordLimit = Math.max(6, Math.min(12, Number(process.env.KUAISHOU_SEARCH_USER_KEYWORD_LIMIT || 10) || 10));
  const publicProfileLimit = Math.max(4, Math.min(12, Number(process.env.KUAISHOU_PUBLIC_PROFILE_LIMIT || 12) || 12));
  const privateRoute = await getAdaptiveRouteDecision("kuaishou", "private_list", {
    pageCount: defaultPrivatePages,
    concurrency: privateConcurrency,
    minimumPages: 12,
  });
  const privatePages = privateRoute.pageCount || defaultPrivatePages;
  const privateLaneConcurrency = privateRoute.concurrency || privateConcurrency;
  const searchRoute = await getAdaptiveRouteDecision("kuaishou", "search_feed", {
    pageCount: defaultSearchPages,
    keywordLimit: defaultSearchKeywordLimit,
    minimumPages: 8,
  });
  const kuaishouDramaKeywords = String(process.env.KUAISHOU_DRAMA_SEARCH_KEYWORDS || "")
    .split(/[,，|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultKuaishouDramaKeywords = [
    "AI漫剧",
    "AI短剧",
    "重生漫剧",
    "动态漫",
    "红果漫剧",
    "竖屏短剧",
  ];
  const dramaKw = kuaishouDramaKeywords.length ? kuaishouDramaKeywords : defaultKuaishouDramaKeywords;
  const searchKeywords = await prioritizeAdaptiveSeeds(
    "kuaishou",
    "search_feed",
    Array.from(new Set([...dramaKw, ...discoveryKeywords])),
    searchRoute.keywordLimit || defaultSearchKeywordLimit,
  );
  const searchPages = searchRoute.pageCount || defaultSearchPages;
  const items: TrendItem[] = [];
  const notes: string[] = [];
  let privateRequestCount = 0;
  let privatePageDepth = 0;
  let searchRequestCount = 0;
  let searchPageDepth = 0;
  let discoveryRequestCount = 0;
  let recoRequestCount = 0;
  const discoveredCreators = new Map<string, { userId: string; keyword: string; name: string }>();

  creatorSeeds.forEach((creator) => {
    discoveredCreators.set(creator.userId, {
      userId: creator.userId,
      keyword: creator.keyword,
      name: creator.name,
    });
  });
  if (creatorSeeds.length) {
    notes.push(`Loaded ${creatorSeeds.length} curated Kuaishou creator seeds for discovery fallback.`);
  }
  if (discoveryKeywords.length) {
    notes.push(`Loaded ${discoveryKeywords.length} Kuaishou discovery keywords, including cross-platform title and author signals.`);
  }
  notes.push(`Kuaishou private/list tuned for depth=${privatePages}, concurrency=${privateConcurrency}, retry=${privateRetryLimit}.`);

  const resolveKuaishouBucket = (sourceLabel: string) => {
    if (sourceLabel.startsWith("private-list:")) return "kuaishou_private_list";
    if (sourceLabel.startsWith("search:")) return "kuaishou_search_feed";
    if (sourceLabel.startsWith("profile-feed:")) return "kuaishou_profile_feed";
    if (sourceLabel.startsWith("public-feed:")) return "kuaishou_public_feed";
    if (sourceLabel.startsWith("reco:")) return "kuaishou_reco_feed";
    return "kuaishou_feed";
  };

  const pushKuaishouItem = (item: Record<string, any>, sourceLabel: string) => {
    const photo = item.photo ?? item;
    const author = item.author ?? item.user ?? {};
    const caption = String(photo.caption ?? item.caption ?? "").trim();
    const tags = Array.isArray(item.tags)
      ? item.tags
        .map((tag) => String(tag?.name ?? tag ?? "").trim())
        .filter(Boolean)
      : [String(photo.expTag ?? item.expTag ?? "").trim()].filter(Boolean);
    const title = caption || tags[0];
    if (!title) return;

    const id = String(photo.id ?? item.id ?? `${sourceLabel}-${items.length}`);
    const authorId = String(author.id ?? item.author_id ?? "").trim();
    const authorName = String(author.name ?? item.author_name ?? authorId).trim();
    const likes = parseChineseCount(photo.likeCount ?? item.likeCount);
    const comments = parseChineseCount(photo.commentCount ?? item.commentCount ?? item.comment?.us_c);
    const views = parseChineseCount(photo.viewCount ?? item.viewCount);
    const isDramaSearch = /漫剧|短剧|动态漫|红果/i.test(sourceLabel) || tags.some((t) => /漫剧|短剧/.test(t));
    const enrichedTags = isDramaSearch && !tags.includes("快手漫剧检索")
      ? [...tags, "快手漫剧检索"]
      : tags;

    // 合集字段（若 API 有）优先；否则用规范化剧名作伪 mixId
    const series =
      photo.photoSeries
      ?? photo.series
      ?? photo.collection
      ?? item.photoSeries
      ?? item.series
      ?? null;
    const seriesId = String(series?.id ?? series?.seriesId ?? series?.mix_id ?? "").trim();
    const seriesName = String(series?.name ?? series?.title ?? series?.mix_name ?? "").trim();
    const dramaKind = inferDouyinDramaKind(`${seriesName} ${title}`, enrichedTags);
    const looksDrama =
      Boolean(seriesId || seriesName)
      || dramaKind !== "unknown"
      || /AI\s*漫剧|AI漫|动态漫|漫剧|短剧|红果|竖屏剧/i.test(`${title} ${enrichedTags.join(" ")}`);
    const mixName = seriesName || (looksDrama ? title.replace(/\s*第?\d+\s*集.*$/, "").trim() || title : "");
    const mixKey = seriesId || (mixName ? normalizeManhuaMixNameKey(mixName) : "");
    const mixPlayProxy = Math.max(views || 0, (likes || 0) * 20);
    const seriesUrl = String(series?.url ?? series?.shareUrl ?? "").trim();

    items.push({
      id,
      title,
      bucket: resolveKuaishouBucket(sourceLabel),
      author: authorName || authorId || undefined,
      url: seriesUrl || (id ? `https://www.kuaishou.com/short-video/${id}` : undefined),
      publishedAt: safeDateFromTimestamp(Number(photo.timestamp ?? item.timestamp)),
      likes,
      comments,
      views,
      hotValue: (likes || 0) + (comments || 0),
      contentType: "video",
      tags: enrichedTags,
      ...(looksDrama && mixKey
        ? {
            isDrama: true as const,
            dramaKind,
            dramaInfo: {
              mixId: mixKey,
              mixName: mixName || mixKey,
              mixPlayCount: mixPlayProxy || undefined,
            },
          }
        : {}),
    });
  };

  const extractKuaishouSearchList = (payload: Record<string, any>) => {
    const candidates = [
      payload?.data?.list,
      payload?.data?.feeds,
      payload?.data?.items,
      payload?.feeds,
      payload?.list,
      payload?.items,
      payload?.data?.searchFeedInfo?.list,
    ];
    const list = candidates.find((entry) => Array.isArray(entry));
    return Array.isArray(list) ? list as Array<Record<string, any>> : [];
  };

  const extractKuaishouSearchCursor = (payload: Record<string, any>) => {
    return String(
      payload?.data?.pcursor
      ?? payload?.pcursor
      ?? payload?.data?.cursor
      ?? payload?.cursor
      ?? payload?.data?.searchFeedInfo?.pcursor
      ?? "",
    ).trim();
  };

  const extractKuaishouSearchUsers = (payload: Record<string, any>) => {
    const candidates = [
      payload?.users,
      payload?.data?.users,
      payload?.data?.list,
      payload?.list,
    ];
    const list = candidates.find((entry) => Array.isArray(entry));
    return Array.isArray(list) ? list as Array<Record<string, any>> : [];
  };

  const extractKuaishouSearchUserCursor = (payload: Record<string, any>) => {
    return String(
      payload?.pcursor
      ?? payload?.data?.pcursor
      ?? payload?.cursor
      ?? payload?.data?.cursor
      ?? "",
    ).trim();
  };

  const extractKuaishouProfileFeeds = (payload: Record<string, any>) => {
    const candidates = [
      payload?.feeds,
      payload?.data?.feeds,
      payload?.profileFeed?.feeds,
      payload?.data?.profileFeed?.feeds,
    ];
    const list = candidates.find((entry) => Array.isArray(entry));
    return Array.isArray(list) ? list as Array<Record<string, any>> : [];
  };

  const extractKuaishouProfileCursor = (payload: Record<string, any>) => {
    return String(
      payload?.pcursor
      ?? payload?.data?.pcursor
      ?? payload?.profileFeed?.pcursor
      ?? payload?.data?.profileFeed?.pcursor
      ?? "",
    ).trim();
  };

  if (cookies.length) {
    const privateStartCount = items.length;
    const privateTasks = cookies.map((cookie, cookieIndex) => async () => {
      let pcursor = "";
      for (let page = 0; page < privatePages; page += 1) {
        let payload: { feeds?: Array<Record<string, any>>; pcursor?: string } | null = null;
        let responseOk = false;
        for (let attempt = 0; attempt <= privateRetryLimit; attempt += 1) {
          const url = new URL("https://www.kuaishou.com/rest/v/profile/private/list");
          if (pcursor) url.searchParams.set("pcursor", pcursor);
          const response = await fetch(url.toString(), {
            headers: {
              accept: "application/json,text/plain,*/*",
              cookie,
              referer: "https://www.kuaishou.com/new-reco",
              "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
            },
          });
          privateRequestCount += 1;
          privatePageDepth = Math.max(privatePageDepth, page + 1);
          if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            notes.push(`Kuaishou private/list cookie ${cookieIndex + 1} page ${page + 1} attempt ${attempt + 1} responded with ${response.status}.`);
            if (retryable && attempt < privateRetryLimit) {
              await sleep(privateRetryDelayMs * (attempt + 1));
              continue;
            }
            break;
          }
          payload = await response.json() as {
            feeds?: Array<Record<string, any>>;
            pcursor?: string;
          };
          responseOk = true;
          break;
        }
        if (!responseOk || !payload) break;
        const list = payload.feeds ?? [];
        list.forEach((item) => pushKuaishouItem(item, `private-list:${cookieIndex + 1}:${page + 1}`));
        notes.push(`Fetched ${list.length} Kuaishou authenticated feed items from cookie ${cookieIndex + 1} private/list page ${page + 1}.`);
        pcursor = String(payload.pcursor || "").trim();
        if (!pcursor || !list.length) break;
      }
    });

    await runBatches(privateTasks, Math.max(1, Math.min(privateLaneConcurrency, cookies.length)));
    await recordAdaptiveRouteRun({
      platform: "kuaishou",
      routeKey: "private_list",
      yieldCount: Math.max(0, items.length - privateStartCount),
      requestCount: privateRequestCount,
    });
  }

  if (cookies.length && recoPages > 0) {
    const recoStartCount = items.length;
    const recoQuery = `query visionFeedRecommend($pcursor: String, $count: Int) {
      visionFeedRecommend(pcursor: $pcursor, count: $count) {
        pcursor
        feeds {
          author { id name }
          photo { id caption timestamp likeCount viewCount commentCount expTag }
        }
      }
    }`;
    for (let cookieIndex = 0; cookieIndex < Math.min(cookies.length, 2); cookieIndex += 1) {
      const cookie = cookies[cookieIndex];
      let pcursor = "";
      for (let page = 0; page < recoPages; page += 1) {
        try {
          const response = await fetch(visionGraphqlEndpoint, {
            method: "POST",
            headers: {
              accept: "application/json,text/plain,*/*",
              "content-type": "application/json",
              cookie,
              referer: "https://www.kuaishou.com/new-reco",
              "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
              kpn: "KUAISHOU_VISION",
              kpf: "PC_WEB",
            },
            body: JSON.stringify({
              operationName: "visionFeedRecommend",
              query: recoQuery,
              variables: { pcursor, count },
            }),
          });
          recoRequestCount += 1;
          if (!response.ok) {
            notes.push(`Kuaishou visionFeedRecommend cookie ${cookieIndex + 1} page ${page + 1} responded with ${response.status}.`);
            break;
          }
          const payload = await response.json() as {
            data?: {
              visionFeedRecommend?: {
                pcursor?: string;
                feeds?: Array<Record<string, any>>;
              };
            };
            errors?: Array<{ message?: string }>;
          };
          if (payload.errors?.length) {
            notes.push(`Kuaishou visionFeedRecommend cookie ${cookieIndex + 1} page ${page + 1} errored: ${payload.errors.map((item) => item.message || "unknown").join("; ")}`);
            break;
          }
          const feeds = payload.data?.visionFeedRecommend?.feeds ?? [];
          feeds.forEach((feed) => pushKuaishouItem(feed, `reco:${cookieIndex + 1}:${page + 1}`));
          notes.push(`Fetched ${feeds.length} Kuaishou visionFeedRecommend items for cookie ${cookieIndex + 1} page ${page + 1}.`);
          pcursor = String(payload.data?.visionFeedRecommend?.pcursor || "").trim();
          if (!pcursor || !feeds.length) break;
        } catch (error) {
          notes.push(`Kuaishou visionFeedRecommend cookie ${cookieIndex + 1} page ${page + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    }
    await recordAdaptiveRouteRun({
      platform: "kuaishou",
      routeKey: "reco_feed",
      yieldCount: Math.max(0, items.length - recoStartCount),
      requestCount: recoRequestCount,
    });
  }

  const kuaishouSearchThreshold = PLATFORM_REFERENCE_RANGES.kuaishou?.min || 12;
  const shouldRunSearch = searchKeywords.length > 0;

  if (searchKeywords.length && items.length >= kuaishouSearchThreshold) {
    notes.push(
      `Kuaishou private/list already yielded ${items.length} items, but search/feed will continue to expand beyond low-diversity private samples.`,
    );
  }

  if (shouldRunSearch) {
    const searchStartCount = items.length;
    const cookiePool = cookies.length ? cookies : [""];
    const searchTasks = cookiePool.flatMap((cookie, cookieIndex) =>
      searchKeywords.map((keyword) => async () => {
        let pcursor = "";
        for (let page = 0; page < searchPages; page += 1) {
          try {
            const response = await fetch("https://www.kuaishou.com/rest/v/search/feed", {
              method: "POST",
              headers: {
                accept: "application/json,text/plain,*/*",
                "content-type": "application/json",
                referer: `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(keyword)}`,
                "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
                ...(cookie ? { cookie } : {}),
              },
              body: JSON.stringify({
                keyword,
                page: page + 1,
                pcursor,
                webPageArea: "searchResult",
              }),
            });

            searchRequestCount += 1;
            searchPageDepth = Math.max(searchPageDepth, page + 1);

            if (!response.ok) {
              notes.push(`Kuaishou search/feed cookie ${cookieIndex + 1} ${keyword} page ${page + 1} responded with ${response.status}.`);
              break;
            }

            const payload = await response.json() as Record<string, any>;
            const list = extractKuaishouSearchList(payload);
            list.forEach((item) => pushKuaishouItem(item, `search:${cookieIndex + 1}:${keyword}`));
            notes.push(`Fetched ${list.length} Kuaishou search feed items for cookie ${cookieIndex + 1} keyword ${keyword} page ${page + 1}.`);
            pcursor = extractKuaishouSearchCursor(payload);
            if (!pcursor || !list.length) break;
          } catch (error) {
            notes.push(`Kuaishou search/feed cookie ${cookieIndex + 1} ${keyword} page ${page + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
            break;
          }
        }
      }),
    );

    await runBatches(searchTasks, searchConcurrency);
    await recordAdaptiveRouteRun({
      platform: "kuaishou",
      routeKey: "search_feed",
      yieldCount: Math.max(0, items.length - searchStartCount),
      requestCount: searchRequestCount,
    });
    await recordAdaptiveSeedRun({
      platform: "kuaishou",
      routeKey: "search_feed",
      seeds: searchKeywords,
      yieldedCount: Math.max(0, items.length - searchStartCount),
    });
  }

  if (searchKeywords.length && cookies.length) {
    const discoveryTasks = searchKeywords.slice(0, Math.min(searchKeywords.length, searchUserKeywordLimit)).map((keyword) => async () => {
      let pcursor = "";
      for (let page = 0; page < searchUserPages; page += 1) {
        try {
          const response = await fetch("https://www.kuaishou.com/rest/v/search/user", {
            method: "POST",
            headers: {
              accept: "application/json,text/plain,*/*",
              "content-type": "application/json",
              cookie: cookies[0],
              referer: `https://www.kuaishou.com/search/author?searchKey=${encodeURIComponent(keyword)}`,
              "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
            },
            body: JSON.stringify({
              keyword,
              page: page + 1,
              pcursor,
            }),
          });

          discoveryRequestCount += 1;
          if (!response.ok) {
            notes.push(`Kuaishou search/user ${keyword} page ${page + 1} responded with ${response.status}.`);
            break;
          }

          const payload = await response.json() as Record<string, any>;
          const users = extractKuaishouSearchUsers(payload);
          users.forEach((user) => {
            const userId = String(user.user_id ?? user.id ?? "").trim();
            const name = String(user.user_name ?? user.name ?? "").trim();
            if (!userId || !name || discoveredCreators.has(userId)) return;
            discoveredCreators.set(userId, { userId, keyword, name });
          });
          notes.push(`Fetched ${users.length} Kuaishou search users for ${keyword} page ${page + 1}.`);
          if (discoveredCreators.size >= searchUserLimit) break;
          pcursor = extractKuaishouSearchUserCursor(payload);
          if (!pcursor || !users.length) break;
        } catch (error) {
          notes.push(`Kuaishou search/user ${keyword} page ${page + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    });

    await runBatches(discoveryTasks, Math.min(3, searchConcurrency));
  }

  if (discoveredCreators.size) {
    const sample = Array.from(discoveredCreators.values())
      .slice(0, 10)
      .map((creator) => `${creator.name}(${creator.userId})<=${creator.keyword}`)
      .join(", ");
    notes.push(`Kuaishou discovery found ${discoveredCreators.size} searchable creators. Sample: ${sample}`);
  }

  if (discoveredCreators.size && primaryKuaishouCookie) {
    const publicProfileTargets = Array.from(discoveredCreators.values()).slice(0, publicProfileLimit);
    for (const creator of publicProfileTargets) {
      try {
        const profileResponse = await fetch("https://www.kuaishou.com/rest/v/profile/user", {
          method: "POST",
          headers: {
            accept: "application/json,text/plain,*/*",
            "content-type": "application/json",
            cookie: primaryKuaishouCookie,
            referer: `https://www.kuaishou.com/profile/${creator.userId}`,
            "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
          },
          body: JSON.stringify({ user_id: creator.userId }),
        });
        discoveryRequestCount += 1;
        if (!profileResponse.ok) {
          notes.push(`Kuaishou profile/user ${creator.userId} responded with ${profileResponse.status}.`);
          continue;
        }

        const profilePayload = await profileResponse.json() as Record<string, any>;
        const userProfile = profilePayload.userProfile ?? profilePayload.data?.userProfile ?? {};
        const ownerCount = userProfile.ownerCount ?? {};
        const profile = userProfile.profile ?? {};
        const canonicalName = String(profile.user_name ?? creator.name).trim();
        const publicCount = Number(ownerCount.photo_public ?? 0) || 0;
        const userDefineId = String(userProfile.userDefineId ?? "").trim();
        if (userDefineId && !discoveredPrincipalIds.has(userDefineId)) {
          discoveredPrincipalIds.add(userDefineId);
          notes.push(`Kuaishou discovery promoted ${creator.userId} => principal ${userDefineId}.`);
        }
        notes.push(`Kuaishou profile/user ${creator.userId} => ${canonicalName || creator.name} public=${publicCount}${userDefineId ? ` uid=${userDefineId}` : ""}.`);

        let profileCursor = "";
        for (let page = 0; page < publicPages; page += 1) {
          const feedResponse = await fetch("https://www.kuaishou.com/rest/v/profile/feed", {
            method: "POST",
            headers: {
              accept: "application/json,text/plain,*/*",
              "content-type": "application/json",
              cookie: primaryKuaishouCookie,
              referer: `https://www.kuaishou.com/profile/${creator.userId}`,
              profile_referer: `https://www.kuaishou.com/profile/${creator.userId}`,
              "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
              kpn: "KUAISHOU_VISION",
              kpf: "PC_WEB",
            },
            body: JSON.stringify({
              user_id: creator.userId,
              pcursor: profileCursor,
              page: "profile",
            }),
          });
          discoveryRequestCount += 1;
          if (!feedResponse.ok) {
            notes.push(`Kuaishou profile/feed ${creator.userId} page ${page + 1} responded with ${feedResponse.status}.`);
            break;
          }

          const feedPayload = await feedResponse.json() as Record<string, any>;
          const resultCode = Number(feedPayload.result ?? 0);
          const feedList = extractKuaishouProfileFeeds(feedPayload);
          if (resultCode !== 1) {
            notes.push(`Kuaishou profile/feed ${creator.userId} page ${page + 1} blocked with result=${resultCode}${feedPayload.error_msg ? ` msg=${String(feedPayload.error_msg)}` : ""}.`);
            break;
          }

          feedList.forEach((item) => pushKuaishouItem(item, `profile-feed:${creator.userId}:${page + 1}`));
          notes.push(`Fetched ${feedList.length} Kuaishou profile/feed items for ${creator.userId} page ${page + 1}.`);
          profileCursor = extractKuaishouProfileCursor(feedPayload);
          if (!profileCursor || !feedList.length) break;
        }
      } catch (error) {
        notes.push(`Kuaishou public profile fallback ${creator.userId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const principalCandidates = Array.from(discoveredPrincipalIds).slice(0, 8);
  if (principalCandidates.length) {
    const query = `
      query publicFeeds($principalId: String!, $pcursor: String, $count: Int) {
        publicFeeds(principalId: $principalId, pcursor: $pcursor, count: $count) {
          pcursor
          list {
            id
            caption
            poster
            timestamp
            expTag
            user {
              id
              name
            }
            counts {
              displayView
              displayLike
              displayComment
            }
          }
        }
      }
    `;

    for (const principalId of principalCandidates) {
      let pcursor = "";
      for (let page = 0; page < publicPages; page += 1) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
              ...(cookies[0] ? { cookie: cookies[0] } : {}),
            },
            body: JSON.stringify({
              operationName: "publicFeeds",
              query,
              variables: {
                principalId,
                pcursor,
                count,
              },
            }),
          });

          if (!response.ok) {
            notes.push(`Kuaishou publicFeeds ${principalId} page ${page + 1} responded with ${response.status}.`);
            break;
          }

          const payload = await response.json() as {
            data?: {
              publicFeeds?: {
                list?: Array<Record<string, any>>;
                pcursor?: string;
              };
            };
            errors?: Array<{ message?: string }>;
          };

          if (payload.errors?.length) {
            notes.push(`Kuaishou publicFeeds ${principalId} page ${page + 1} errored: ${payload.errors.map((item) => item.message || "unknown error").join("; ")}`);
            break;
          }

          const list = payload.data?.publicFeeds?.list ?? [];
          list.forEach((item) => pushKuaishouItem(item, `public-feed:${principalId}:${page + 1}`));
          notes.push(`Fetched ${list.length} Kuaishou public feed items from ${principalId} page ${page + 1}.`);
          pcursor = String(payload.data?.publicFeeds?.pcursor || "").trim();
          if (!pcursor || !list.length) break;
        } catch (error) {
          notes.push(`Kuaishou publicFeeds ${principalId} page ${page + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    }
  }

  const publicRequestCount = principalCandidates.length * publicPages;
  const publicTargetCount = principalCandidates.length * publicPages * count;
  const searchTargetCount = searchKeywords.length * searchPages * count;

  if (!items.length) {
    notes.push(
      `Kuaishou collector returned 0 items in this round; discovery=${discoveredCreators.size}, principals=${principalCandidates.length}. Keeping the run degraded instead of failing hard.`,
    );
  }

  const sourceCounts = getBucketCounts(items);
  notes.push(
    `Kuaishou source counts before dedupe: ${Object.entries(sourceCounts)
      .map(([bucket, count]) => `${bucket}=${count}`)
      .join(", ") || "none"}.`,
  );

  const rawFetchedCount = items.length;
  const dedupedItems = dedupeById(items);
  notes.push(`Kuaishou pipeline pre-finalize: rawFetched=${rawFetchedCount} afterDedup=${dedupedItems.length}.`);

  return finalizeCollection("kuaishou", "live", dedupedItems, notes, {
    collectorMode: "warehouse",
    rawFetchedCount,
    requestCount: privateRequestCount + recoRequestCount + publicRequestCount + searchRequestCount + discoveryRequestCount,
    pageDepth: Math.max(privatePageDepth, searchPageDepth, recoPages, principalCandidates.length ? publicPages : 0),
    targetPerRun: Math.max(
      (cookies.length ? cookies.length * privatePages * count : 0)
        + recoRequestCount * count
        + publicTargetCount
        + searchTargetCount,
      getPlatformTargetItemCount("kuaishou"),
    ),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.kuaishou?.min || 20,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.kuaishou?.max || 80,
  });
}

async function collectToutiao(): Promise<PlatformTrendCollection> {
  const cookie = String(process.env.TOUTIAO_COOKIE || "").trim();
  const items: TrendItem[] = [];
  const notes: string[] = [];
  let requestCount = 0;

  if (!cookie) {
    throw new Error("Toutiao collector requires TOUTIAO_COOKIE.");
  }

  const antiToken = parseCookieValue(cookie, "tt_anti_token");
  const csrfToken = parseCookieValue(cookie, "csrftoken");
  const userTokenPool = Array.from(new Set([
    String(process.env.TOUTIAO_USER_TOKEN || "").trim(),
    ...parseCsvEnv("TOUTIAO_USER_TOKEN_POOL"),
  ].filter(Boolean)));
  const mediaIdPool = [
    String(process.env.TOUTIAO_MEDIA_ID || "").trim(),
    ...parseCsvEnv("TOUTIAO_MEDIA_ID_POOL"),
  ].filter(Boolean);
  // Toutiao crawl intensity increased: keyword limit, search pages, page size, author limit, profile pages
  const defaultToutiaoKeywordLimit = Math.max(4, Math.min(64, parsePreferredNumberEnv("GROWTH_TOUTIAO_SEARCH_KEYWORD_LIMIT", "TOUTIAO_SEARCH_KEYWORD_LIMIT", 36)));
  const defaultToutiaoSearchPages = Math.max(1, Math.min(20, parsePreferredNumberEnv("GROWTH_TOUTIAO_SEARCH_PAGES", "TOUTIAO_SEARCH_PAGES", 6)));
  const searchPageSize = Math.max(10, Math.min(40, Number(process.env.TOUTIAO_SEARCH_PAGE_SIZE || 25) || 25));
  const searchConcurrency = Math.max(1, Math.min(8, parsePreferredNumberEnv("GROWTH_TOUTIAO_SEARCH_CONCURRENCY", "TOUTIAO_SEARCH_CONCURRENCY", 4)));
  const authorLimit = Math.max(1, Math.min(24, parsePreferredNumberEnv("GROWTH_TOUTIAO_AUTHOR_LIMIT", "TOUTIAO_AUTHOR_LIMIT", 16)));
  const profilePages = Math.max(1, Math.min(30, parsePreferredNumberEnv("GROWTH_TOUTIAO_PROFILE_PAGES", "TOUTIAO_PROFILE_PAGES", 14)));
  const authorPairPool = parsePairPoolEnv("TOUTIAO_AUTHOR_POOL");

  if (!userTokenPool.length) {
    throw new Error("Toutiao collector requires TOUTIAO_USER_TOKEN.");
  }

  const acrawlerResponse = await fetch("https://lf3-cdn-tos.bytescm.com/obj/rc-web-sdk/acrawler.js", {
    headers: { "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0" },
  });
  requestCount += 1;
  if (!acrawlerResponse.ok) {
    throw new Error(`Toutiao acrawler script responded with ${acrawlerResponse.status}`);
  }
  const signer = createToutiaoSigner(await acrawlerResponse.text());
  if (!signer) {
    throw new Error("Toutiao acrawler signer could not be initialized.");
  }

  const baseHeaders = {
    accept: "application/json, text/plain, */*",
    cookie,
    referer: "https://www.toutiao.com/",
    origin: "https://www.toutiao.com",
    "x-csrftoken": csrfToken,
    "tt-anti-token": antiToken,
    "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
  };
  const toutiaoSearchRoute = await getAdaptiveRouteDecision("toutiao", "search_feed", {
    pageCount: defaultToutiaoSearchPages,
    keywordLimit: defaultToutiaoKeywordLimit,
    minimumPages: 2,
  });
  const searchKeywords = await prioritizeAdaptiveSeeds(
    "toutiao",
    "search_feed",
    getPlatformSeeds("toutiao"),
    toutiaoSearchRoute.keywordLimit || defaultToutiaoKeywordLimit,
  );
  const searchPages = toutiaoSearchRoute.pageCount || defaultToutiaoSearchPages;

  const authorProfiles = Array.from(new Map(
    [
      ...authorPairPool.map((entry) => ({
        userToken: entry.left,
        mediaId: entry.right || mediaIdPool[0] || "",
      })),
      ...userTokenPool.flatMap((userToken, index) => {
        const directMedia = mediaIdPool[index] || mediaIdPool[0] || "";
        const pooledMedia = mediaIdPool.slice(0, Math.min(4, mediaIdPool.length));
        const candidates = directMedia
          ? [directMedia, ...pooledMedia]
          : pooledMedia;
        if (!candidates.length) return [{ userToken, mediaId: "" }];
        return candidates.map((mediaId) => ({ userToken, mediaId }));
      }),
    ]
      .filter((entry) => entry.userToken)
      .map((entry) => [`${entry.userToken}::${entry.mediaId}`, entry]),
  ).values()).slice(0, authorLimit);
  notes.push(`Toutiao author pool size ${authorProfiles.length}; media pool size ${mediaIdPool.length}.`);
  if (searchKeywords.length) {
    notes.push(`Toutiao search keywords loaded: ${searchKeywords.slice(0, 12).join(", ")}${searchKeywords.length > 12 ? "..." : ""}.`);
  }

  if (searchKeywords.length) {
    const searchStartCount = items.length;
    const searchTasks = searchKeywords.flatMap((keyword) =>
      Array.from({ length: searchPages }, (_, index) => index).map((pageIndex) => async () => {
        try {
          const searchUrl = new URL("https://www.toutiao.com/api/search/content/");
          searchUrl.searchParams.set("keyword", keyword);
          searchUrl.searchParams.set("offset", String(pageIndex * searchPageSize));
          searchUrl.searchParams.set("count", String(searchPageSize));
          searchUrl.searchParams.set("format", "json");
          searchUrl.searchParams.set("aid", "24");
          searchUrl.searchParams.set("app_name", "toutiao_web");
          searchUrl.searchParams.set("_signature", signer.sign({ url: searchUrl.toString() }));
          const response = await fetch(searchUrl.toString(), {
            headers: {
              ...baseHeaders,
              referer: `https://so.toutiao.com/search?keyword=${encodeURIComponent(keyword)}`,
            },
          });
          requestCount += 1;
          if (!response.ok) {
            notes.push(`Toutiao search ${keyword} page ${pageIndex + 1} responded with ${response.status}.`);
            return;
          }
          const payload = await response.json() as Record<string, any>;
          const searchItems = parseToutiaoSearchItems(payload, keyword);
          items.push(...searchItems);
          notes.push(`Fetched ${searchItems.length} Toutiao search items for ${keyword} page ${pageIndex + 1}.`);
        } catch (error) {
          requestCount += 1;
          notes.push(`Toutiao search ${keyword} page ${pageIndex + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
    await runBatches(searchTasks, searchConcurrency);
    await recordAdaptiveRouteRun({
      platform: "toutiao",
      routeKey: "search_feed",
      yieldCount: Math.max(0, items.length - searchStartCount),
      requestCount: searchKeywords.length * searchPages,
    });
    await recordAdaptiveSeedRun({
      platform: "toutiao",
      routeKey: "search_feed",
      seeds: searchKeywords,
      yieldedCount: Math.max(0, items.length - searchStartCount),
    });
  }

  for (const authorProfile of authorProfiles) {
    const categoriesResponse = await fetch("https://www.toutiao.com/api/pc/user/tabs_info?aid=24&app_name=toutiao_web", {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `token=${encodeURIComponent(authorProfile.userToken)}`,
    });
    requestCount += 1;
    if (!categoriesResponse.ok) {
      notes.push(`Toutiao tabs_info ${authorProfile.userToken.slice(0, 12)} responded with ${categoriesResponse.status}.`);
      continue;
    }
    const categoriesPayload = await categoriesResponse.json() as Record<string, any>;
    const categories = Array.isArray(categoriesPayload?.data) ? categoriesPayload.data as Array<Record<string, any>> : [];
    const selectedCategories = categories
      .map((item) => String(item.category ?? "").trim())
      .filter((item) => ["profile_all", "pc_profile_video", "pc_profile_ugc"].includes(item));
    notes.push(`Fetched ${selectedCategories.length} Toutiao profile tabs for ${authorProfile.userToken.slice(0, 12)}: ${selectedCategories.join(", ")}.`);

    for (const category of selectedCategories) {
      let maxBehotTime = "0";
      for (let page = 0; page < profilePages; page += 1) {
        const pageUrl = new URL("https://www.toutiao.com/api/pc/feed/");
        pageUrl.searchParams.set("category", category);
        pageUrl.searchParams.set("utm_source", "toutiao");
        pageUrl.searchParams.set("visit_user_token", authorProfile.userToken);
        pageUrl.searchParams.set("max_behot_time", maxBehotTime);
        pageUrl.searchParams.set("aid", "24");
        pageUrl.searchParams.set("app_name", "toutiao_web");
        pageUrl.searchParams.set("_signature", signer.sign({ url: pageUrl.toString() }));
        const response = await fetch(pageUrl.toString(), { headers: baseHeaders });
        requestCount += 1;
        if (!response.ok) {
          notes.push(`Toutiao pc/feed ${category} ${authorProfile.userToken.slice(0, 12)} page ${page + 1} responded with ${response.status}.`);
          break;
        }
        const payload = await response.json() as Record<string, any>;
        const categoryItems = category === "pc_profile_video"
          ? parseToutiaoVideoItems(payload)
          : parseToutiaoFeedItems(payload, category);
        items.push(...categoryItems.map((item) => ({
          ...item,
          bucket: category === "pc_profile_video" ? "toutiao_video_feed" : "toutiao_feed",
          tags: Array.from(new Set([...normalizeStringList(item.tags), category])),
        })));
        notes.push(`Fetched ${categoryItems.length} Toutiao items for ${category} ${authorProfile.userToken.slice(0, 12)} page ${page + 1}.`);
        const nextCursor = extractToutiaoFeedCursor(payload);
        if (!nextCursor || !categoryItems.length || nextCursor === maxBehotTime) break;
        maxBehotTime = nextCursor;
      }
    }

    if (authorProfile.mediaId) {
      const mediaUrl = new URL("https://www.toutiao.com/api/pc/media_hot/");
      mediaUrl.searchParams.set("media_id", authorProfile.mediaId);
      mediaUrl.searchParams.set("user_token", authorProfile.userToken);
      mediaUrl.searchParams.set("aid", "24");
      mediaUrl.searchParams.set("app_name", "toutiao_web");
      const mediaSignature = signer.sign({ url: mediaUrl.toString() });
      mediaUrl.searchParams.set("_signature", mediaSignature);
      const response = await fetch(mediaUrl.toString(), { headers: baseHeaders });
      requestCount += 1;
      if (response.ok) {
        const payload = await response.json() as Record<string, any>;
        const mediaItems = parseToutiaoMediaHotItems(payload).map((item) => ({
          ...item,
          bucket: "toutiao_media_hot",
        }));
        items.push(...mediaItems);
        notes.push(`Fetched ${mediaItems.length} Toutiao media hot items for ${authorProfile.userToken.slice(0, 12)}.`);
      } else {
        notes.push(`Toutiao media_hot ${authorProfile.userToken.slice(0, 12)} responded with ${response.status}.`);
      }
    }
  }

  const extraMediaIds = Array.from(new Set(mediaIdPool.filter(Boolean))).slice(0, Math.max(authorLimit, 12));
  const fallbackUserTokens = Array.from(new Set(authorProfiles.map((item) => item.userToken).filter(Boolean)));
  for (const userToken of fallbackUserTokens.slice(0, Math.min(6, fallbackUserTokens.length))) {
    for (const mediaId of extraMediaIds) {
      const mediaUrl = new URL("https://www.toutiao.com/api/pc/media_hot/");
      mediaUrl.searchParams.set("media_id", mediaId);
      mediaUrl.searchParams.set("user_token", userToken);
      mediaUrl.searchParams.set("aid", "24");
      mediaUrl.searchParams.set("app_name", "toutiao_web");
      mediaUrl.searchParams.set("_signature", signer.sign({ url: mediaUrl.toString() }));
      const response = await fetch(mediaUrl.toString(), { headers: baseHeaders });
      requestCount += 1;
      if (!response.ok) {
        notes.push(`Toutiao media_hot pool ${userToken.slice(0, 12)} ${mediaId} responded with ${response.status}.`);
        continue;
      }
      const payload = await response.json() as Record<string, any>;
      const mediaItems = parseToutiaoMediaHotItems(payload).map((item) => ({
        ...item,
        bucket: "toutiao_media_hot",
        tags: Array.from(new Set([...normalizeStringList(item.tags), mediaId, userToken.slice(0, 12)])),
      }));
      items.push(...mediaItems);
      notes.push(`Fetched ${mediaItems.length} Toutiao pooled media hot items for ${userToken.slice(0, 12)} + ${mediaId}.`);
    }
  }

  const dedupedItems = dedupeById(items);
  if (!dedupedItems.length) {
    throw new Error("Toutiao collector returned 0 items.");
  }

  return finalizeCollection("toutiao", "live", dedupedItems, notes, {
    collectorMode: "warehouse",
    requestCount,
    pageDepth: Math.max(profilePages, searchPages),
    targetPerRun: Math.max(500, searchKeywords.length * searchPages * searchPageSize, getPlatformTargetItemCount("toutiao")),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.toutiao?.min || 20,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.toutiao?.max || 60,
  });
}

export async function collectPlatformTrends(platform: GrowthPlatform): Promise<PlatformTrendCollection> {
  switch (platform) {
    case "bilibili":
      return collectBilibili();
    case "douyin":
      return collectDouyin();
    case "kuaishou":
      return collectKuaishou();
    case "toutiao":
      return collectToutiao();
    case "xiaohongshu":
      return collectXiaohongshu();
    case "weixin_channels":
      // 视频号数据抓取即将启动 — 当前以 seed 模式占位，不采集，等微信公众号 API 打通后接入
      return finalizeCollection(platform, "seed", [], ["weixin_channels: collector not yet configured — data ingestion roadmap Q3 2026."], {
        collectorMode: "seed",
        requestCount: 0,
        pageDepth: 0,
        targetPerRun: 0,
        referenceMinItems: 0,
        referenceMaxItems: 0,
      });
    default:
      return finalizeCollection(platform, "seed", [], [`No live collector configured for ${platform}.`], {
        collectorMode: "seed",
        requestCount: 0,
        pageDepth: 0,
        targetPerRun: 0,
        referenceMinItems: 0,
        referenceMaxItems: 0,
      });
  }
}

export async function collectTrendPlatforms(platforms: GrowthPlatform[]) {
  const normalized = Array.from(
    new Set(platforms.filter((platform): platform is GrowthPlatform => growthPlatformValues.includes(platform))),
  );
  const results = await Promise.allSettled(normalized.map((platform) => collectPlatformTrends(platform)));
  const collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>> = {};
  const errors: Partial<Record<GrowthPlatform, string>> = {};

  results.forEach((result, index) => {
    const platform = normalized[index];
    if (result.status === "fulfilled") {
      collections[platform] = result.value;
    } else {
      errors[platform] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    }
  });

  return { collections, errors };
}
