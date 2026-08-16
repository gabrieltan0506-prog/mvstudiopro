export const GROWTH_BURST_PLATFORMS = ["douyin", "bilibili", "xiaohongshu"] as const;

export const GROWTH_DEBUG_PLATFORMS = ["douyin", "xiaohongshu", "bilibili", "weixin_channels"] as const;

export type GrowthBurstPlatform = (typeof GROWTH_BURST_PLATFORMS)[number];

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B 站",
  weixin_channels: "视频号",
};

const PLATFORM_DEBUG_DESCRIPTIONS: Record<string, string> = {
  douyin: "短视频主阵地，优先看热点和爆发趋势。",
  xiaohongshu: "种草与搜索场景，优先看内容沉淀和转化线索。",
  bilibili: "中长视频社区，优先看深度内容和长期沉淀。",
  weixin_channels: "微信视频内容场景，读取本机正式采集并已入库的互动样本。",
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

export function isRecentGrowthPlatformTimeout(
  failure: { lastFailureAt?: string | null; lastError?: string | null },
  nowMs = Date.now(),
  visibleMs = 30_000,
) {
  const failedAt = Date.parse(String(failure.lastFailureAt || ""));
  if (!Number.isFinite(failedAt) || nowMs < failedAt || nowMs - failedAt > visibleMs) return false;
  return /timed out|timeout|aborted|abort/i.test(String(failure.lastError || ""));
}

export const GROWTH_NO_NEW_DATA_ALERT_MS = 24 * 60 * 60 * 1000;

export type GrowthNoNewDataState = {
  status: "unknown" | "fresh" | "stale";
  ageMs: number | null;
  basis: "new-data" | "monitoring" | "none";
};

/** 只按真实新增时间计时；普通抓取成功、addedCount=0 都不能掩盖断流。 */
export function getGrowthNoNewDataState(
  lastNewDataAt?: string | null,
  nowMs = Date.now(),
  alertAfterMs = GROWTH_NO_NEW_DATA_ALERT_MS,
  monitoringStartedAt?: string | null,
): GrowthNoNewDataState {
  const addedAt = Date.parse(String(lastNewDataAt || ""));
  const monitoringAt = Date.parse(String(monitoringStartedAt || ""));
  const hasAddedAt = Number.isFinite(addedAt) && Number.isFinite(nowMs) && nowMs >= addedAt;
  const hasMonitoringAt = Number.isFinite(monitoringAt) && Number.isFinite(nowMs) && nowMs >= monitoringAt;
  const referenceAt = hasAddedAt ? addedAt : hasMonitoringAt ? monitoringAt : null;
  if (referenceAt === null) {
    return { status: "unknown", ageMs: null, basis: "none" };
  }
  const ageMs = nowMs - referenceAt;
  return {
    status: ageMs >= alertAfterMs ? "stale" : "fresh",
    ageMs,
    basis: hasAddedAt ? "new-data" : "monitoring",
  };
}
