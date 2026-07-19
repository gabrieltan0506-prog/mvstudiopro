/**
 * Stage2 六条蓝图前：Responses Pro 深度选题优化（按 windowDays 读 trend 热点 + 近期标题去重）。
 * 不替代六维 Chat 生成，只产出可注入的方向包。
 */
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches.js";
import { invokeGpt56ResponsesText } from "./gpt56ResponsesClient.js";

export type Stage2ProTopicDirection = {
  dimIndex: number;
  angle: string;
  workingTitle: string;
  differenceHook: string;
  avoidMotifs: string[];
  trendBorrow: string;
};

export type Stage2ProTopicOptimizeBrief = {
  ok: boolean;
  via?: string;
  summary: string;
  banMotifs: string[];
  directions: Stage2ProTopicDirection[];
  rawError?: string;
};

const DIM_NAMES = [
  "核心专业洞察",
  "跨界结合与价值观",
  "目标受众痛点暴击",
  "个人经历与人设魅力",
  "强冲突场景与深层热点转译",
  "长尾常青与搜索流量",
] as const;

function extractJsonObject(text: string): unknown {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeBrief(parsed: unknown): Stage2ProTopicOptimizeBrief | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const directionsRaw = Array.isArray(root.directions) ? root.directions : [];
  const directions: Stage2ProTopicDirection[] = [];
  for (let i = 0; i < 6; i++) {
    const row = (directionsRaw[i] && typeof directionsRaw[i] === "object"
      ? directionsRaw[i]
      : {}) as Record<string, unknown>;
    const avoid = Array.isArray(row.avoidMotifs)
      ? row.avoidMotifs.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6)
      : [];
    directions.push({
      dimIndex: i + 1,
      angle: String(row.angle || row.focus || DIM_NAMES[i]).trim().slice(0, 120),
      workingTitle: String(row.workingTitle || row.title || "").trim().slice(0, 80),
      differenceHook: String(row.differenceHook || row.hook || "").trim().slice(0, 160),
      avoidMotifs: avoid,
      trendBorrow: String(row.trendBorrow || row.borrow || "").trim().slice(0, 160),
    });
  }
  const banMotifs = Array.isArray(root.banMotifs)
    ? root.banMotifs.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 24)
    : [];
  const summary = String(root.summary || root.brief || "").trim().slice(0, 400);
  if (!summary && directions.every((d) => !d.workingTitle && !d.angle)) return null;
  return {
    ok: true,
    summary: summary || "已按窗口热点与人设完成六向差异化选题优化。",
    banMotifs,
    directions,
  };
}

/**
 * Pro 深度选题优化。失败时返回 ok:false，调用方继续六维生成（不阻断 Stage2）。
 */
export async function optimizeStage2TopicsWithPro(params: {
  context: string;
  windowDays: number;
  requestedPlatforms: string[];
  /** dynamicDecisionChain 精简版（平台 + 高互动样本标题） */
  trendDigest: unknown;
  stage1SeedTitles?: string[];
  recentUserTitles?: string[];
  abortSignal?: AbortSignal;
}): Promise<Stage2ProTopicOptimizeBrief> {
  const recent = (params.recentUserTitles || []).map((t) => String(t || "").trim()).filter(Boolean).slice(0, 36);
  const seeds = (params.stage1SeedTitles || []).map((t) => String(t || "").trim()).filter(Boolean).slice(0, 12);
  const instructions = `你是创作者选题策略顾问。只输出合法 JSON 对象，不要 Markdown 围栏。
任务：在用户看到六条正式选题之前，先做「深度选题优化」。
必须：
1) 严格使用用户所选 windowDays=${params.windowDays} 天窗口内的热点消化结果（见 user JSON trendDigest）
2) 结合人设，给出恰好 6 个互不雷同的方向（对应六维）
3) 主动避开 recentUserTitles / 同质母题，禁止复读前几天已出过的标题切口
4) workingTitle 只是工作标题草案，最终文案由下游再写；你要保证角度差异够大
禁止：空壳「创作者/博主」套话；抄 trend 样本原标题；六条同情绪同场景。`;

  const input = JSON.stringify({
    personaContext: String(params.context || "").slice(0, 3500),
    windowDays: params.windowDays,
    requestedPlatforms: params.requestedPlatforms,
    trendDigest: params.trendDigest,
    stage1SeedTitles: seeds,
    recentUserTitles: recent,
    dimensions: DIM_NAMES.map((name, i) => ({ dimIndex: i + 1, name })),
    outputSchema: {
      summary: "string 一句话策略",
      banMotifs: ["string 本批禁止复读的母题"],
      directions: [
        {
          dimIndex: 1,
          angle: "本维独特角度",
          workingTitle: "工作标题草案",
          differenceHook: "与另外五条的差异钩子",
          avoidMotifs: ["本维额外避开"],
          trendBorrow: "借热点的哪一层结构/情绪，非抄标题",
        },
      ],
    },
  });

  try {
    const text = await invokeGpt56ResponsesText({
      instructions,
      input,
      modelName: getPlatformStage2OpenAiModel(),
      reasoningMode: "pro",
      reasoningEffort: "medium",
      store: false,
      jsonObject: true,
      abortSignal: params.abortSignal,
      timeoutMs: 180_000,
    });
    const normalized = normalizeBrief(extractJsonObject(text));
    if (!normalized) {
      return {
        ok: false,
        summary: "",
        banMotifs: [],
        directions: [],
        rawError: "pro_optimize_parse_failed",
      };
    }
    return { ...normalized, via: "responses_pro" };
  } catch (e) {
    return {
      ok: false,
      summary: "",
      banMotifs: [],
      directions: [],
      rawError: e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240),
    };
  }
}
