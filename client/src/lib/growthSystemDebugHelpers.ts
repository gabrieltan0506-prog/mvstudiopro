export const GROWTH_BURST_PLATFORMS = ["douyin", "kuaishou", "bilibili", "xiaohongshu", "toutiao"] as const;

export type GrowthBurstPlatform = (typeof GROWTH_BURST_PLATFORMS)[number];

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B 站",
  kuaishou: "快手",
  toutiao: "头条",
};

const PLATFORM_DEBUG_DESCRIPTIONS: Record<string, string> = {
  douyin: "短视频主阵地，优先看热点和爆发趋势。",
  xiaohongshu: "种草与搜索场景，优先看内容沉淀和转化线索。",
  bilibili: "中长视频社区，优先看深度内容和长期沉淀。",
  kuaishou: "高频更新场景，优先看稳定增量和直播相关表现。",
  toutiao: "资讯分发场景，适合单独看补齐情况和历史恢复状态。",
};

export function getPlatformLabel(platform?: string) {
  const key = String(platform || "").trim();
  return PLATFORM_LABELS[key] || key || "-";
}

export function getPlatformDescription(platform?: string) {
  const key = String(platform || "").trim();
  return PLATFORM_DEBUG_DESCRIPTIONS[key] || "平台说明暂未配置。";
}

export function formatPlatformList(platforms: unknown) {
  return Array.isArray(platforms)
    ? platforms.map((platform) => getPlatformLabel(String(platform))).join("、") || "-"
    : "-";
}

export function formatTruthSource(source?: string) {
  if (source === "platform-current") return "平台真值档";
  if (source === "derived-platforms") return "平台派生档";
  if (source === "current-json") return "单一 current.json";
  return String(source || "-");
}

export function formatShanghaiDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}-${map.hour}:${map.minute}:${map.second}`;
}
