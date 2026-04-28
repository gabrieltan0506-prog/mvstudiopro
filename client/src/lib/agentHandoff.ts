/**
 * Agent 场景预填 Handoff
 *
 * 当用户在「实时趋势」widget 上点击「→ IP 矩阵」或「→ 竞品雷达」时，
 * 把这条爆款热点数据塞进 sessionStorage（一次性消费，避免污染下一轮新建）。
 *
 * 目标场景页 mount 时主动 readAgentHandoff(target) 并 clear。
 */

export type AgentHandoffTarget = "platform_ip_matrix" | "competitor_radar";

export interface AgentTrendHandoff {
  source: "trend_hotspot";
  target: AgentHandoffTarget;
  savedAt: string;
  /** 平台 id（douyin / bilibili 等） */
  platform: string;
  platformLabel: string;
  /** 爆款标题，用于自动填到 painPoint / topicDirection / 对标账号 */
  title: string;
  url?: string;
  hotValue?: number;
  views?: number;
  likes?: number;
  tags: string[];
  industryLabels: string[];
}

const STORAGE_KEY = "mvsp-agent-trend-handoff";

export function saveAgentHandoff(handoff: AgentTrendHandoff) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    /* ignore */
  }
}

/** 读取并立即 clear。只在目标场景页 mount 时调用 */
export function readAndClearAgentHandoff(target: AgentHandoffTarget): AgentTrendHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentTrendHandoff;
    if (parsed?.target !== target) return null;
    window.sessionStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}

/** 把热点数据格式化成可作为「痛点场景」的一段中文描述 */
export function formatHandoffAsPainPoint(h: AgentTrendHandoff): string {
  const stats: string[] = [];
  if (h.hotValue) stats.push(`热度 ${h.hotValue}`);
  if (h.views) stats.push(`播放 ${h.views.toLocaleString()}`);
  if (h.likes) stats.push(`点赞 ${h.likes.toLocaleString()}`);
  const tagsLine = h.tags.length ? `\n标签：${h.tags.map((t) => `#${t}`).join(" ")}` : "";
  const industryLine = h.industryLabels.length ? `\n行业：${h.industryLabels.join("、")}` : "";
  const statsLine = stats.length ? `\n实时数据：${stats.join(" · ")}` : "";
  const urlLine = h.url ? `\n来源：${h.url}` : "";
  return `【来自 ${h.platformLabel} 实时爆款】\n标题：${h.title}${statsLine}${tagsLine}${industryLine}${urlLine}\n\n请基于这条平台爆款，结合我的核心资产，深潜出降维打击的差异化路径。`;
}
