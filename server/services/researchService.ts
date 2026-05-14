/**
 * 竞品调研双引擎服务
 * Stage 1：**默认 gemini-3-flash-preview** — **Vertex IAM**（与 TestLab `vertexTranslate` 同闸道：`VERTEX_PROJECT_ID` + SA，不用 `GEMINI_API_KEY`）
 * · 环境变量 **`RESEARCH_STAGE1_MODEL`** 覆盖；设为 **`gemma-4-31b-it`** 时沿用 `callGemma4`（Vertex us-central1×2 → GoogleGenerativeAI×1）
 * Stage 2：**gemini-3.1-pro-preview**（Vertex 上與 `geminiScript` 一致的真實模型 ID；不帶 `-preview` 的 `gemini-3.1-pro` 在 **aiplatform** 上常 **404**）— **Vertex IAM REST**（`callGemini3_1_Pro`），不经 GEMINI_API_KEY
 */
import fs from "fs/promises";
import path from "path";
import type { ResearchPipelineDebugStep } from "../../shared/researchPipelineDebugMarker.js";
import { readTrendStoreForPlatforms } from "../growth/trendStore";
import { describeVertexGemini31ProRouting } from "./vertexGemini31ProGlobal.js";

const BACKUP_DIR = "/data/growth/research";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stage 1 模型 ID；未设时默认 Flash Preview，可改为 Gemma。 */
export function resolveResearchStage1Model(): string {
  const m = String(process.env.RESEARCH_STAGE1_MODEL || "").trim();
  return m || "gemini-3-flash-preview";
}

/** Gemma Stage1 雙通道皆失敗後對使用者展示（同模型 · 不因通道切換換模型）。 */
const RESEARCH_STAGE1_CAPACITY_MSG = "当前算力紧张，请稍后再试。";

/** Stage 2：Vertex 文本節點使用的官方預覽版模型 ID（與 `api/google.ts` geminiScript、`VERTEX_GEMINI_MODEL` 預設一致）。 */
const RESEARCH_STAGE2_MODEL = "gemini-3.1-pro-preview" as const;

/**
 * 调用生成模型：
 * - **gemini-3.1-pro-preview**（推薦）與 **gemini-3.1-pro**（僅路由別名，REST 實際模型仍由 `VERTEX_GEMINI_31_PRO_MODEL` / `VERTEX_GEMINI_MODEL` 決定，預設 **`gemini-3.1-pro-preview`**）→ Vertex IAM REST
 * - gemma-4-31b-it → `callGemma4`：Vertex **`us-central1`×2**，再 **`@google/generative-ai`×1**（**`GEMINI_API_KEY`** · 同 **`GEMMA_MODEL_ID`**）；失敗抛 `RESEARCH_STAGE1_CAPACITY_MSG`
 * - **gemini-3-flash-preview**（Stage 1 默认）→ Vertex IAM REST，与 TestLab `vertexTranslate` 同源（`VERTEX_PROJECT_ID`，非 `GEMINI_API_KEY`）
 * - 其余非 Gemma、非 3.1-pro 的 model id → Google AI Studio HTTP（`GEMINI_API_KEY`）
 */
async function generate(model: string, prompt: string, retries = 2): Promise<string> {
  if (model === "gemini-3.1-pro" || model === "gemini-3.1-pro-preview") {
    const { callGemini3_1_Pro } = await import("./vertexGemini31ProGlobal.js");
    for (let i = 0; i <= retries; i++) {
      try {
        return await callGemini3_1_Pro(prompt, { maxOutputTokens: 8192, temperature: 0.9 });
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if ((msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) && i < retries) {
          console.log(`[researchService] Vertex 429/限流，${5 * (i + 1)}s 后重试...`);
          await sleep(5000 * (i + 1));
          continue;
        }
        throw e;
      }
    }
    return "";
  }

  if (model === "gemma-4-31b-it") {
    const { callGemma4 } = await import("./gemma4.js");
    try {
      const text = await callGemma4(prompt);
      if (text.trim()) {
        console.log(`[researchService] Gemma Stage 1 OK（Vertex us-central1×2 → GoogleGenerativeAI×1 · callGemma4）`);
        return text;
      }
    } catch (e: unknown) {
      console.error(`[researchService] Gemma Stage 1 双通道失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    throw new Error(RESEARCH_STAGE1_CAPACITY_MSG);
  }

  if (model === "gemini-3-flash-preview") {
    const { vertexGemini3FlashGenerateContent } = await import("./vertexGemini3FlashText.js");
    for (let i = 0; i <= retries; i++) {
      try {
        return await vertexGemini3FlashGenerateContent(prompt, {
          temperature: 0.4,
          maxOutputTokens: 8192,
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if ((msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) && i < retries) {
          console.log(`[researchService] Vertex Flash 429/限流，${5 * (i + 1)}s 后重试…`);
          await sleep(5000 * (i + 1));
          continue;
        }
        throw e;
      }
    }
    return "";
  }

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
  });

  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    const json: any = await res.json().catch(() => ({}));

    if (res.status === 429 && i < retries) {
      console.log(`[researchService] 429 rate limit，${5 * (i + 1)}s 后重试...`);
      await sleep(5000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${model} API ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    return String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "");
  }
  return "";
}

export interface ResearchScene {
  sceneNumber: number;
  copywriting: string;
  visualPrompt: string;
  /** 角色口播台词 + 动作拟音（直接传给 Veo，不含 BGM） */
  audioPrompt: string;
  /** 背景音乐战略提示词（预留给 Suno，不传给 Veo） */
  bgmPrompt: string;
}

export interface ResearchStrategy {
  overallStrategy?: string;
  scenes?: ResearchScene[];
  positioning?: string;
  scripts?: Array<{ title: string; hook: string; copywriting: string }>;
  visuals?: { colorPalette?: string[]; typography?: string; layoutGuide?: string };
  publishStrategy?: string;
  growthPlan30Days?: string;
  platform?: string;
  platformLabel?: string;
  generatedAt?: string;
  raw?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  bilibili: "B站",
};

/**
 * 从本地平台数据库读取当前热门趋势，作为市场背景注入提示词
 */
async function buildPlatformContext(platform: string): Promise<string> {
  try {
    const store = await readTrendStoreForPlatforms([platform as any], { preferDerivedFiles: true });
    const validPlatforms = ["douyin","kuaishou","xiaohongshu","bilibili","weixin_channels","toutiao"] as const;
    type VP = typeof validPlatforms[number];
    const key = platform as VP;
    const collection = validPlatforms.includes(key) ? store.collections?.[key] : undefined;
    if (!collection?.items?.length) return "";

    // 取最热的 30 条（按 hotValue desc，降级到 likes）
    const top30 = [...collection.items]
      .sort((a, b) => (Number((b as any).hotValue || (b as any).likes || 0)) - (Number((a as any).hotValue || (a as any).likes || 0)))
      .slice(0, 30);

    const titleList = top30.map((item: any, i: number) =>
      `${i + 1}. 【${item.title}】 热度:${item.hotValue || item.likes || 0} 标签:${((item.tags || []) as string[]).slice(0, 4).join("/")}`,
    ).join("\n");

    // 高频标签统计
    const tagFreq: Record<string, number> = {};
    for (const item of (collection.items as any[]).slice(0, 2000)) {
      for (const tag of ((item.tags || []) as string[])) {
        tagFreq[String(tag)] = (tagFreq[String(tag)] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, cnt]) => `${tag}(${cnt})`)
      .join("、");

    return `\n\n【平台数据库背景 — ${PLATFORM_LABEL[platform] || platform}，共 ${collection.items.length} 条实时数据】
当前平台TOP 30热门内容：
${titleList}

平台高频标签TOP 20：${topTags}`;
  } catch (err: any) {
    console.warn("[researchService] 读取平台数据失败（non-fatal）:", err?.message);
    return "";
  }
}

/**
 * 执行双引擎竞品调研（不含扣费，由 tRPC router 管理）
 */
const MAX_CONTENT_CHARS = 5000;

const MAX_DEBUG_DETAIL = 24_000;

function capDebugText(s: string, max = MAX_DEBUG_DETAIL): string {
  const t = String(s || "");
  return t.length <= max ? t : `${t.slice(0, max)}\n…(truncated ${t.length - max} chars)`;
}

function formatResearchErr(e: unknown): string {
  if (e instanceof Error) return capDebugText(`${e.name}: ${e.message}\n${e.stack || ""}`);
  try {
    return capDebugText(JSON.stringify(e));
  } catch {
    return capDebugText(String(e));
  }
}

function throwResearchWithDebug(
  pipelineDebug: ResearchPipelineDebugStep[],
  message: string,
): never {
  const err = new Error(message);
  (err as Error & { researchPipelineDebug?: ResearchPipelineDebugStep[] }).researchPipelineDebug = pipelineDebug;
  throw err;
}

export type ResearchRunResult = {
  strategy: ResearchStrategy;
  pipelineDebug: ResearchPipelineDebugStep[];
};

export async function runResearch(
  userId: string,
  platform: string,
  competitorData: string,
): Promise<ResearchRunResult> {
  const pipelineDebug: ResearchPipelineDebugStep[] = [];
  const push = (
    phase: string,
    status: ResearchPipelineDebugStep["status"],
    detail?: string,
    errorDetail?: string,
  ) => {
    pipelineDebug.push({
      at: new Date().toISOString(),
      phase,
      status,
      ...(detail != null && detail !== "" ? { detail } : {}),
      ...(errorDetail != null && errorDetail !== "" ? { errorDetail: capDebugText(errorDetail) } : {}),
    });
  };

  const label = PLATFORM_LABEL[platform] || platform;

  push("validate_input", "start", `platform=${platform}（${label}）· 输入 ${competitorData.length} 字`);
  if (competitorData.length > MAX_CONTENT_CHARS) {
    push(
      "validate_input",
      "fail",
      `超过 ${MAX_CONTENT_CHARS} 字上限`,
      `当前 ${competitorData.length} 字`,
    );
    throwResearchWithDebug(
      pipelineDebug,
      `字数超过 ${MAX_CONTENT_CHARS} 字限制（当前 ${competitorData.length} 字），请精简后再试`,
    );
  }
  push("validate_input", "ok", "校验通过");

  console.log(`[researchService] 读取 ${label} 平台数据库...`);
  push("platform_context", "start", "读取趋势库（readTrendStore）…");
  const platformContext = await buildPlatformContext(platform);
  if (platformContext) {
    console.log(`[researchService] 平台背景注入成功，数据长度: ${platformContext.length}`);
    push("platform_context", "ok", `已注入背景 · ${platformContext.length} 字符`);
  } else {
    push("platform_context", "warn", "无可用热点段落（继续执行，提示词中仅含竞品正文）");
  }

  // ── Stage 1：默认 Vertex Flash · 可与 RESEARCH_STAGE1_MODEL=gemma-4-31b-it 走 Gemma 双通道 ──
  const stage1Model = resolveResearchStage1Model();
  console.log(`[researchService] Stage 1 启动 (${label}) · model=${stage1Model}`);
  push("stage1_scan", "start", `调用 ${stage1Model}`);
  let stage1Raw: string;
  try {
    stage1Raw = await generate(
    stage1Model,
    `你是一位顶级内容策略师。请对以下${label}竞品内容进行深度扫描，提炼：
1. 爆款逻辑拆解（流量钩子、情绪触发点、内容结构）
2. 视觉风格特征（色调、排版、封面设计模式）
3. 受众画像与算法适配特征
4. 高频词汇与标签矩阵
${platformContext}

竞品数据：${competitorData}

输出格式：JSON，字段：hookLogic, visualStyle, audienceProfile, keywordMatrix, topPatterns`,
    );
    console.log(`[researchService] Stage 1 完成，字符数: ${stage1Raw.length}`);
    push("stage1_scan", "ok", `完成 · ${stage1Raw.length} 字符`);
  } catch (e: unknown) {
    push("stage1_scan", "fail", "Stage 1 模型/API 异常", formatResearchErr(e));
    throwResearchWithDebug(pipelineDebug, e instanceof Error ? e.message : String(e));
  }

  // ── Stage 2: Gemini 3.1 Pro Preview（Vertex aiplatform 實際 model id） ────
  console.log(`[researchService] Stage 2 Gemini 3.1 Pro Preview 启动`);
  push("stage2_prescription", "start", `Vertex IAM REST · ${describeVertexGemini31ProRouting()}`);
  let stage2Raw: string;
  try {
    stage2Raw = await generate(
    RESEARCH_STAGE2_MODEL,
    `你是集成了哈佛商学院竞争战略与${label}平台算法的顶级IP策略师，同时担任多模态视听导演。

【竞品扫描报告（Stage 1）】
${stage1Raw}
${platformContext}

为创作者生成「降维打击」竞争处方。请严格以 JSON 格式输出，结构如下：

{
  "overallStrategy": "整体账号定位与差异化战术分析（200字以内）",
  "scenes": [
    {
      "sceneNumber": 1,
      "copywriting": "【开场钩子】完整文案内容，融合平台高频热词，强情绪触发...",
      "visualPrompt": "高保真参考图生图指令：场景描述、光线、构图、风格、色调（英文优先，50字以内）",
      "audioPrompt": "【仅限角色口播台词与动作拟音，严禁包含背景音乐】角色说出的具体台词 + 场景动作音效描述（例如：角色说'三秒见效，不信你试'，随后听到清脆的点击声和轻微的心跳加速音效）",
      "bgmPrompt": "【背景音乐战略，预留给 Suno 使用，不传给 Veo】BPM、曲风、情绪、乐器组合（例如：BPM 118，治愈系钢琴+低频电子合成器，情绪：从紧张到释然的弧线）"
    }
  ],
  "visuals": {
    "colorPalette": ["#HEX1", "#HEX2", "#HEX3"],
    "typography": "字体风格描述",
    "layoutGuide": "封面构图建议"
  },
  "publishStrategy": "最优发布时间、频次、推荐话题标签",
  "growthPlan30Days": "分阶段30天行动清单"
}

核心要求（必须严格遵守）：
- audioPrompt 与 bgmPrompt 必须完全分离，audioPrompt 只包含角色人声+动作音效，bgmPrompt 只包含背景音乐战略
- 每个场景 audioPrompt 需含具体可朗读的台词文本，以确保 Veo 能实现精准对口型
- 每个场景 bgmPrompt 需含 BPM 数字、曲风关键词、情绪弧线，确保 Suno 可直接使用
- scenes 数组生成 3 到 5 个场景
- visualPrompt 必须为英文生图提示词
- 优先使用平台实时高频标签和热词
- 严格 JSON 格式，不要输出 JSON 之外的任何内容`,
    );
    console.log(`[researchService] Stage 2 完成，字符数: ${stage2Raw.length}`);
    push("stage2_prescription", "ok", `完成 · ${stage2Raw.length} 字符`);
  } catch (e: unknown) {
    push("stage2_prescription", "fail", "Stage 2 模型/API 异常", formatResearchErr(e));
    throwResearchWithDebug(pipelineDebug, e instanceof Error ? e.message : String(e));
  }

  // 解析 JSON 处方
  push("parse_strategy_json", "start", "解析 Stage2 输出为 JSON");
  const cleaned = stage2Raw.replace(/```json\n?|\n?```/g, "").trim();
  let strategy: ResearchStrategy;
  try {
    strategy = JSON.parse(cleaned);
    push("parse_strategy_json", "ok", "JSON.parse 成功");
  } catch (parseErr: unknown) {
    push(
      "parse_strategy_json",
      "warn",
      "非严格 JSON，降级为 raw 字段",
      formatResearchErr(parseErr),
    );
    strategy = { raw: stage2Raw };
  }
  strategy.platform = platform;
  strategy.platformLabel = label;
  strategy.generatedAt = new Date().toISOString();

  push("fly_backup", "start", "Fly 持久化 /data/growth/research …");
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const filename = path.join(BACKUP_DIR, `res_${platform}_${Date.now()}_u${userId}.json`);
    await fs.writeFile(filename, JSON.stringify({ userId, platform, stage1Raw, strategy, timestamp: strategy.generatedAt }, null, 2));
    console.log(`[researchService] Fly 原始数据写入: ${filename}`);
    push("fly_backup", "ok", path.basename(filename));
  } catch (e: unknown) {
    console.error("[researchService] Fly 存储失败（non-fatal）:", e instanceof Error ? e.message : e);
    push("fly_backup", "warn", "Fly 写入失败（non-fatal）", formatResearchErr(e));
  }

  return { strategy, pipelineDebug };
}
