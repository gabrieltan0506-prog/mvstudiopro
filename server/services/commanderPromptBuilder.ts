/**
 * 「指挥官指令 (Commander Prompt)」构造器
 *
 * 把 9 大板块按职责拆分：
 *   - a 战略边界 / d 核心资产 → 用户档案（commanderProfileStore）
 *   - b 痛点场景 → 场景每次必填
 *   - c 输出格式 / f 必须交付的产出 → 系统模板，用户可微调
 *   - e 战略检索任务 / g 深度交叉比对 → 由 a/b/d 自动派生
 *   - h 战略定位地图 → Agent 输出（不在 prompt 输入侧）
 *   - i 先回传研究计划 → 架构层默认开启（collaborative_planning=true）
 *
 * 同时自动接入 trendStore 的 4 大平台最新数据（抖音/B 站/小红书/快手）作为「私有数据集」
 */

import { readTrendStoreForPlatforms } from "../growth/trendStore";
import type { TrendItem } from "../growth/trendCollector";
import type { GrowthPlatform } from "../../shared/growth";
import type { CommanderProfile } from "./commanderProfileStore";

const DEFAULT_PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "bilibili", "kuaishou"];
const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B 站",
  kuaishou: "快手",
  weixin_channels: "视频号",
  toutiao: "今日头条",
};

export interface ScenarioContext {
  /** 场景类型 */
  scenario: "platform_ip_matrix" | "competitor_radar" | "vip_baseline" | "vip_monthly";
  /** b · 痛点场景（必填） */
  painPoint: string;
  /** 场景特有的额外结构化数据（如对标账号列表 / 关注维度 / VIP 基线画像） */
  scenarioPayload: Record<string, unknown>;
  /** 用户额外补充资料（自由文本） */
  freeformSupplementary?: string;
  /** 限定要拉哪些平台的趋势数据。不传则默认四大平台 */
  platformsToBriefe?: GrowthPlatform[];
  /** 每个平台抓最新 N 条爆款（默认 8） */
  topNPerPlatform?: number;
}

/** 把单条 TrendItem 压成一行紧凑摘要 */
function formatItem(item: TrendItem): string {
  const stats: string[] = [];
  if (typeof item.hotValue === "number" && item.hotValue > 0) stats.push(`hot=${item.hotValue}`);
  if (typeof item.views === "number" && item.views > 0) stats.push(`views=${item.views}`);
  if (typeof item.likes === "number" && item.likes > 0) stats.push(`likes=${item.likes}`);
  if (typeof item.comments === "number" && item.comments > 0) stats.push(`comments=${item.comments}`);
  const tags = (item.tags || []).slice(0, 3).join("/");
  const industry = (item.industryLabels || []).slice(0, 2).join("/");
  const meta = [stats.join(" "), tags && `#${tags}`, industry && `[${industry}]`].filter(Boolean).join(" · ");
  return `· ${item.title}${meta ? ` （${meta}）` : ""}`;
}

/**
 * 拉取 4 大平台最新趋势数据，压成一段紧凑的「私有数据集」
 * 来自项目内置的 trendStore（trendCollector 实时爬取的四大平台数据）
 */
export async function loadFreshPlatformBriefing(opts?: {
  platforms?: GrowthPlatform[];
  topN?: number;
}): Promise<{ briefingText: string; coveredPlatforms: GrowthPlatform[]; meta: string }> {
  const platforms = opts?.platforms?.length ? opts.platforms : DEFAULT_PLATFORMS;
  const topN = opts?.topN ?? 8;

  try {
    const store = await readTrendStoreForPlatforms(platforms, { preferDerivedFiles: true });
    const sections: string[] = [];
    const covered: GrowthPlatform[] = [];

    for (const platform of platforms) {
      const collection = store.collections?.[platform];
      if (!collection || !collection.items?.length) continue;
      covered.push(platform);

      // 按 hotValue / views / likes 综合排序
      const ranked = [...collection.items].sort((a, b) => {
        const ah = Number(a.hotValue || 0) + Number(a.views || 0) / 1000 + Number(a.likes || 0) / 100;
        const bh = Number(b.hotValue || 0) + Number(b.views || 0) / 1000 + Number(b.likes || 0) / 100;
        return bh - ah;
      });

      const top = ranked.slice(0, topN);
      const lines = top.map(formatItem).join("\n");
      const updatedLine = `（采集时间 ${collection.collectedAt} · source=${collection.source} · windowDays=${collection.windowDays} · 共 ${collection.items.length} 条已有，下列展示前 ${top.length} 热度）`;
      sections.push(`### ${PLATFORM_LABELS[platform] || platform}\n${updatedLine}\n${lines || "（暂无数据）"}`);
    }

    if (sections.length === 0) {
      return {
        briefingText: "（trendStore 暂无四大平台爆款数据，请待下一轮采集生效后再启动 Agent）",
        coveredPlatforms: [],
        meta: "no_data",
      };
    }

    const briefingText = sections.join("\n\n");
    const meta = `已注入 ${covered.length} 个平台 / 各 ≤ ${topN} 条`;
    return { briefingText, coveredPlatforms: covered, meta };
  } catch (e: any) {
    console.warn("[commanderPromptBuilder] loadFreshPlatformBriefing 失败:", e?.message);
    return {
      briefingText: "（trendStore 读取异常，本次任务将以 Agent 全网检索为主）",
      coveredPlatforms: [],
      meta: "error",
    };
  }
}

/** 给前端「实时趋势 · 一键深潜」widget 用：返回结构化的逐条热点列表 */
export interface TrendHotspotEntry {
  platform: GrowthPlatform;
  platformLabel: string;
  id: string;
  title: string;
  url?: string;
  hotValue?: number;
  views?: number;
  likes?: number;
  comments?: number;
  tags: string[];
  industryLabels: string[];
  collectedAt: string;
  windowDays: number;
}

export async function listFreshTrendItems(opts?: {
  platforms?: GrowthPlatform[];
  topN?: number;
}): Promise<{ entries: TrendHotspotEntry[]; coveredPlatforms: GrowthPlatform[]; meta: string }> {
  const platforms = opts?.platforms?.length ? opts.platforms : DEFAULT_PLATFORMS;
  const topN = opts?.topN ?? 5;

  try {
    const store = await readTrendStoreForPlatforms(platforms, { preferDerivedFiles: true });
    const entries: TrendHotspotEntry[] = [];
    const covered: GrowthPlatform[] = [];

    for (const platform of platforms) {
      const collection = store.collections?.[platform];
      if (!collection || !collection.items?.length) continue;
      covered.push(platform);

      const ranked = [...collection.items].sort((a, b) => {
        const ah = Number(a.hotValue || 0) + Number(a.views || 0) / 1000 + Number(a.likes || 0) / 100;
        const bh = Number(b.hotValue || 0) + Number(b.views || 0) / 1000 + Number(b.likes || 0) / 100;
        return bh - ah;
      });

      for (const item of ranked.slice(0, topN)) {
        entries.push({
          platform,
          platformLabel: PLATFORM_LABELS[platform] || platform,
          id: item.id,
          title: item.title,
          url: item.url,
          hotValue: item.hotValue,
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          tags: (item.tags || []).slice(0, 4),
          industryLabels: (item.industryLabels || []).slice(0, 3),
          collectedAt: collection.collectedAt,
          windowDays: collection.windowDays,
        });
      }
    }

    return {
      entries,
      coveredPlatforms: covered,
      meta: covered.length === 0 ? "no_data" : `已加载 ${covered.length} 个平台 / 共 ${entries.length} 条`,
    };
  } catch (e: any) {
    console.warn("[commanderPromptBuilder] listFreshTrendItems 失败:", e?.message);
    return { entries: [], coveredPlatforms: [], meta: "error" };
  }
}

// ── 系统硬编码的 c 输出格式 + f 必须交付的产出（卡布奇诺黑金质感模板） ────
const OUTPUT_FORMAT_BASE = `【输出格式 · 卡布奇诺黑金质感 Markdown · 不得低于以下标准】
1. 全文严格简体中文（除专有名词外不得出现英文术语）
2. 总字数 ≥ 8000 字（VIP 月度更新可压缩到 5000 字）
3. ≥ 6 张完整 Markdown 表格（数值列将被前端自动渲染为柱图/折线图/雷达图）
4. ≥ 3 套不同分析框架（SWOT、五力、PEST、SMART、漏斗、波士顿矩阵任选）
5. 每张表必须有「数据来源」列（指向具体的爆款标题或外部接地数据）
6. 商业建议必须可在 7 天内立即执行（具体话术 + 量化指标 + 责任人/分镜）`;

const DELIVERABLE_BASE = `【必须交付的产出】
1. 战略定位地图：1 个卡布奇诺黑金质感的 IP Slogan + 3 个最具变现潜力的细分赛道
2. 内容矩阵表：≥ 4 个爆款短视频选题，列【3 秒钩子】【跨界解构视角】【私域转化话术】
3. 平台分发权重：基于 2026 年最新算法，给出抖音/小红书/B 站/快手的精力投入占比 (%) 与原因
4. 风险预警：监管/合规/平台规则变化的 3 条具体提醒`;

function deriveCrossDomainFusion(profile: CommanderProfile | null): string {
  if (!profile?.coreAssets?.trim()) {
    return "（用户未填核心资产，请由 Agent 自行从全网检索其历史发布内容反推护城河，并基于此进行跨界融合推演）";
  }
  return `请把【核心资产】中的关键能力（${profile.coreAssets.trim().slice(0, 200)}）拆解为 2-3 个跨学科向量，与本场景目标人群的痛点交叉，输出无法被同质化复制的差异化叙事。`;
}

function deriveSearchTask(profile: CommanderProfile | null, painPoint: string): string {
  const boundary = profile?.strategicBoundary?.trim() || "（未设定，请聚焦本次场景）";
  return `1. 在抖音/小红书/B 站/快手 2026 年近 90 天数据中，检索与「${painPoint.slice(0, 80)}」高度相关的爆款帖文 / 视频
2. 仅限【战略边界】内的领域（${boundary.slice(0, 200)}）；对边界外的内容应主动排除，避免污染推演
3. 全网交叉验证：检索 2024-2026 年权威医学论文 / 商业财报 / 监管文件 / 海外同赛道头部账号
4. 不要采用任何 ≥ 24 个月的旧资料；如必须引用历史数据，请在结论中明确标注时间点`;
}

/**
 * 把场景输入 + 用户档案 + 平台数据集，组合为「指挥官指令」
 * 这就是会被注入到 Deep Research Max 的 supplementaryText（Phase A 的最高优先级语境）
 */
export function buildCommanderPrompt(args: {
  scenario: ScenarioContext["scenario"];
  scenarioTitle: string;
  scenarioPayload: Record<string, unknown>;
  painPoint: string;
  freeformSupplementary?: string;
  profile: CommanderProfile | null;
  platformBriefing: string;
  briefingMeta?: string;
  outputFormatOverride?: string;
}): string {
  const profile = args.profile;
  const boundary = profile?.strategicBoundary?.trim();
  const coreAssets = profile?.coreAssets?.trim();
  const profileBlock = (boundary || coreAssets)
    ? `【我的指挥官档案】
${boundary ? `· 战略边界（必须严守）：${boundary}` : "· 战略边界：未设定"}
${coreAssets ? `· 核心资产（差异化护城河）：${coreAssets}` : "· 核心资产：未设定"}
${profile?.notes ? `· 长期目标 / 备注：${profile.notes}` : ""}`
    : "【我的指挥官档案】（用户尚未在「指挥官档案」中填写战略边界与核心资产，本次任务将以场景输入为最高优先级）";

  const scenarioPayloadStr = Object.entries(args.scenarioPayload)
    .filter(([, v]) => v !== undefined && v !== null && (typeof v !== "string" || v.length > 0) && (!Array.isArray(v) || v.length > 0))
    .map(([k, v]) => {
      if (Array.isArray(v)) return `· ${k}：\n${v.map((x) => `    - ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join("\n")}`;
      if (typeof v === "object") return `· ${k}：${JSON.stringify(v)}`;
      return `· ${k}：${v}`;
    })
    .join("\n");

  return `你现在是我专属的「高端商业智库 Agent」，请启动深度检索 + 思维链推理，为「${args.scenarioTitle}」交付战略蓝图。

${profileBlock}

【本次场景 · 痛点定位】
${args.painPoint.trim()}

【场景结构化输入】
${scenarioPayloadStr || "（无）"}

【私有数据集 · 抖音/小红书/B 站/快手 最新爆款（来自 trendStore，非外部公开数据）】
${args.briefingMeta ? `（${args.briefingMeta}）\n` : ""}${args.platformBriefing}

【战略检索任务（请用你的检索工具执行）】
${deriveSearchTask(profile, args.painPoint)}

【深度交叉比对】
${deriveCrossDomainFusion(profile)}

${args.outputFormatOverride?.trim() || OUTPUT_FORMAT_BASE}

${DELIVERABLE_BASE}

${args.freeformSupplementary ? `【运营者额外补充】\n${args.freeformSupplementary.trim()}\n` : ""}
【执行要求】
- 请先回传一份「深潜研究计划」供我审批，确认检索方向无误后，再执行完整的深度报告产出。
- 计划阶段请明确列出：将爬取的 5-10 个具体账号 / 30-50 个具体关键词 / 5-8 篇待引用的医学或商业文献方向。
- 执行阶段不得偏离审批后的计划方向。`;
}
