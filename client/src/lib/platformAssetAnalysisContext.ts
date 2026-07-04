import { isIpProfileReady, type IpProfile } from "@/components/IpProfileModal";

export type PlatformAssetContextInput = {
  userContext?: string;
  personaSummary?: string;
  ipProfile?: IpProfile;
  trendHints?: string[];
  /** listTrendHotspots 返回的 meta（如「18 天窗口爆款 · 抖音:…」） */
  trendStoreMeta?: string;
};

export function formatTrendHotspotHints(
  entries: Array<{ platformLabel: string; title: string; growthPercentile?: number }>,
): string[] {
  return entries
    .map((e) => {
      const title = String(e.title || "").trim();
      if (!title) return "";
      const boost =
        typeof e.growthPercentile === "number" && e.growthPercentile > 0
          ? ` (+${e.growthPercentile}%↑)`
          : "";
      return `[${e.platformLabel}] ${title}${boost}`;
    })
    .filter(Boolean);
}

/** 注入 LLM 的完整背景：用户补充 + 仪表盘人设 + IP 基因库 + 趋势库参考 */
export function buildPlatformAssetAnalysisContext(input: PlatformAssetContextInput): string {
  const parts: string[] = [];
  const user = String(input.userContext || "").trim();
  if (user) parts.push(`【本轮补充】${user}`);

  const persona = String(input.personaSummary || "").trim();
  if (persona) parts.push(`【精神气质与内容身份】${persona.slice(0, 600)}`);

  const ip = input.ipProfile;
  if (ip && isIpProfileReady(ip)) {
    parts.push(
      `【IP 视觉与商业基因】行业身份：${ip.industry.trim()}；核心优势：${ip.advantage.trim()}；目标受众：${ip.audience.trim()}；旗舰交付：${ip.flagship.trim()}${ip.taboos.trim() ? `；品牌禁忌（绝对避让）：${ip.taboos.trim()}` : ""}`,
    );
  }

  const trends = (input.trendHints || []).map((t) => String(t || "").trim()).filter(Boolean);
  if (trends.length) {
    const metaLine = input.trendStoreMeta ? `（${input.trendStoreMeta}）` : "";
    parts.push(
      `【各平台抓取趋势库 · trendStore 实时数据${metaLine}】\n须结合人设改写，禁止抄袭。\n${trends.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    );
  }

  return parts.join("\n\n").slice(0, 8000);
}

/** 上传完成、分析尚未返回时，给用户看的即时反馈文案 */
export function buildInstantFeedbackHint(input: PlatformAssetContextInput): string {
  const lines: string[] = [];
  const persona = String(input.personaSummary || "").trim();
  if (persona) lines.push(`已载入人设：${persona.slice(0, 100)}${persona.length > 100 ? "…" : ""}`);

  const ip = input.ipProfile;
  if (ip && isIpProfileReady(ip)) {
    lines.push(`IP 基因：${ip.industry.trim()} · 受众 ${ip.audience.trim()}`);
  }

  const trends = (input.trendHints || []).map((t) => String(t || "").trim()).filter(Boolean);
  if (trends[0]) lines.push(`趋势库（爬虫）对齐：${trends[0]}`);
  if (trends[1]) lines.push(`同期参考：${trends[1]}`);
  if (input.trendStoreMeta && input.trendStoreMeta !== "no_data") {
    lines.push(`数据源：${input.trendStoreMeta}`);
  }

  return lines.length
    ? lines.join("\n")
    : "正在读取各平台 trendStore 爬虫数据并结合你的背景设定分析…";
}
