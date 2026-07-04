import { isIpProfileReady, type IpProfile } from "@/components/IpProfileModal";

export type PlatformAssetContextInput = {
  userContext?: string;
  personaSummary?: string;
  ipProfile?: IpProfile;
  trendHints?: string[];
  /** 内部 meta，勿直接展示给用户 */
  platformTrendMeta?: string;
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

function stripPlatformTag(hint: string): string {
  return String(hint || "").replace(/^\[[^\]]+\]\s*/, "").trim();
}

/** 注入 LLM 的完整背景：用户补充 + 仪表盘人设 + IP 基因库 + 平台热点参考 */
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
    parts.push(
      `【各平台近期热点参考】\n须结合人设改写，禁止抄袭。\n${trends.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    );
  }

  return parts.join("\n\n").slice(0, 8000);
}

/** 上传完成、分析尚未返回时，给用户看的即时反馈（仅热词与方向，无后台名词） */
export function buildInstantFeedbackHint(input: PlatformAssetContextInput): string {
  const lines: string[] = [];
  const persona = String(input.personaSummary || "").trim();
  if (persona) lines.push(`已载入人设：${persona.slice(0, 100)}${persona.length > 100 ? "…" : ""}`);

  const ip = input.ipProfile;
  if (ip && isIpProfileReady(ip)) {
    lines.push(`IP 定位：${ip.industry.trim()} · 受众 ${ip.audience.trim()}`);
  }

  const trends = (input.trendHints || []).map((t) => String(t || "").trim()).filter(Boolean);
  if (trends[0]) lines.push(`热词方向：${stripPlatformTag(trends[0])}`);
  if (trends[1]) lines.push(`同期参考：${stripPlatformTag(trends[1])}`);

  return lines.length
    ? lines.join("\n")
    : "封面 / 图片已优先开分析，正在结合各平台热词与你的背景设定生成方向…";
}
