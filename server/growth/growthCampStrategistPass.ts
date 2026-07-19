import {
  type GrowthAnalysisMode,
  type GrowthAnalysisScores,
  growthAnalysisScoresSchema,
  hasGrowthCoreScores,
  deriveGrowthCoreScoresFromPartial,
  normalizeGrowthAnalysisScoreValue,
  parseGrowthAnalysisScores,
  coerceDisplayText,
  coerceStringList,
  growthLlmSchema,
  remixLlmSchema,
  growthPremiumContentSchema,
} from "@shared/growth";
import { invokeLLM, extractJsonString } from "../_core/llm";
import {
  resolveGrowthCampStrategistEngine,
  growthCampPhase2InvokeOpts,
  type GrowthCampStrategistEngine,
} from "./extractorPipeline";

type StrategistUserContent = Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "high" | "auto" | "low" } }
>;

function strategistInvokeBase(engine: GrowthCampStrategistEngine) {
  return growthCampPhase2InvokeOpts(engine);
}

function parseLlmJsonResponse<T extends Record<string, unknown>>(raw: string): T {
  const content = String(raw || "").trim();
  if (!content) return {} as T;
  try {
    return JSON.parse(extractJsonString(content)) as T;
  } catch {
    throw new Error(`LLM 返回内容无法解析为 JSON：${content.slice(0, 160)}`);
  }
}

function growthCoreScoreJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      composition: { type: "number", description: "画面构图 0-100" },
      color: { type: "number", description: "色彩搭配 0-100" },
      lighting: { type: "number", description: "灯光 0-100" },
      impact: { type: "number", description: "视觉冲击力 0-100" },
      viralPotential: { type: "number", description: "传播潜力 0-100" },
      explosiveIndex: { type: "number", description: "综合爆款指数 1-10" },
    },
    required: ["composition", "color", "lighting", "impact", "viralPotential", "explosiveIndex"],
  };
}

function serializeStrategistUserContent(content: StrategistUserContent): string {
  return JSON.stringify(
    content.map((part) => {
      if (part.type === "text") return part;
      return { type: part.type, image_url: { detail: part.image_url.detail ?? "auto" } };
    }),
    null,
    2,
  ).slice(0, 15000);
}

/** Strategist 主 pass 漏掉五维评分时，用已有证据单独补跑一轮评分（strict JSON schema）。 */
export async function runGrowthCoreScorePass(params: {
  strategistEngine: GrowthCampStrategistEngine;
  evidenceText: string;
  context?: string;
}): Promise<Record<string, number>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await invokeLLM({
        ...strategistInvokeBase(params.strategistEngine),
        temperature: attempt === 0 ? 0.3 : 0.5,
        messages: [
          {
            role: "system",
            content: `你是短视频/图文商业质检员。根据 user 提供的初判证据，只输出六项数值评分 JSON。
composition/color/lighting/impact/viralPotential 为 0-100 整数；explosiveIndex 为 1-10 整数。
必须基于证据差异化给分，禁止五项全部相同。`,
          },
          {
            role: "user",
            content: [
              params.context?.trim() ? `业务背景：${params.context.trim()}` : "",
              `初判证据：\n${params.evidenceText}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "growth_core_scores",
            strict: true,
            schema: growthCoreScoreJsonSchema(),
          },
        },
      });
      const parsed = parseLlmJsonResponse<Record<string, number>>(
        String(response.choices[0]?.message?.content || "{}"),
      );
      if (!hasGrowthCoreScores(parsed)) {
        throw new Error("评分补全失败：模型未返回完整五维分数");
      }
      const explosiveIndex = typeof parsed.explosiveIndex === "number" && Number.isFinite(parsed.explosiveIndex)
        ? Math.min(10, Math.max(1, Math.round(parsed.explosiveIndex)))
        : Math.min(
          10,
          Math.max(
            1,
            Math.round(
              (parsed.composition + parsed.color + parsed.lighting + parsed.impact + parsed.viralPotential) / 50,
            ),
          ),
        );
      return {
        composition: normalizeGrowthAnalysisScoreValue(parsed.composition, 0),
        color: normalizeGrowthAnalysisScoreValue(parsed.color, 0),
        lighting: normalizeGrowthAnalysisScoreValue(parsed.lighting, 0),
        impact: normalizeGrowthAnalysisScoreValue(parsed.impact, 0),
        viralPotential: normalizeGrowthAnalysisScoreValue(parsed.viralPotential, 0),
        explosiveIndex,
      };
    } catch (err) {
      lastError = err;
      console.warn(`[growth.strategist] score pass attempt ${attempt + 1} failed:`, err);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "评分补全失败"));
}

export async function ensureGrowthCoreScores(
  partial: Record<string, unknown>,
  params: {
    strategistEngine: GrowthCampStrategistEngine;
    evidenceText: string;
    context?: string;
  },
): Promise<Record<string, unknown>> {
  if (hasGrowthCoreScores(partial)) return partial;
  console.warn("[growth.strategist] core scores missing after main pass, running dedicated score pass");
  try {
    const scores = await runGrowthCoreScorePass(params);
    return { ...partial, ...scores };
  } catch (err) {
    const derived = deriveGrowthCoreScoresFromPartial(partial);
    if (derived && hasGrowthCoreScores(derived)) {
      console.warn("[growth.strategist] score pass failed, derived scores from platformScores/explosiveIndex");
      return { ...partial, ...derived };
    }
    throw err;
  }
}

function growthCampStrategistMainJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
            composition: { type: "number", description: "画面构图评分 0-100" },
            color: { type: "number", description: "色彩搭配评分 0-100" },
            lighting: { type: "number", description: "灯光评分 0-100" },
            impact: { type: "number", description: "视觉冲击力评分 0-100" },
            viralPotential: { type: "number", description: "传播潜力评分 0-100" },
            explosiveIndex: { type: "number", description: "综合爆款指数 1-10" },
            platformScores: {
              type: "object",
              description: "仅限小红书、抖音、B站、快手，给出 1-10 分。绝对不可包含任何其他未授权平台",
              properties: {
                xiaohongshu: { type: "number" },
                douyin: { type: "number" },
                bilibili: { type: "number" },
                kuaishou: { type: "number" },
              },
              required: ["xiaohongshu", "douyin", "bilibili", "kuaishou"],
            },
            realityCheck: { type: "string", description: "犀利冷酷的现实查验点评" },
            reverseEngineering: {
              type: "object",
              properties: {
                hookStrategy: { type: "string" },
                emotionalArc: { type: "string" },
                commercialLogic: { type: "string" },
              },
              required: ["hookStrategy", "emotionalArc", "commercialLogic"],
            },
            growthStrategy: {
              type: "object",
              properties: {
                gapAnalysis: { type: "string" },
                commercialMatrix: { type: "string", description: "短视频/中长视频/图文笔记的转化埋点" },
              },
            },
            remixExecution: {
              type: "object",
              properties: {
                hookLibrary: { type: "array", items: { type: "string" } },
                emotionalPacing: { type: "string" },
                visualPaletteAndScript: { type: "string" },
	                productMatrix: { type: "string" },
	                shootingGuidance: { type: "string" },
	                businessInsight: {
	                  type: "object",
	                  description: "商业深度洞察，分别说明视频、图文笔记与变现承接的呈现逻辑",
	                  properties: {
	                    video: { type: "string", description: "视频内容如何拍、如何发、如何转化" },
	                    imageText: { type: "string", description: "图文笔记如何拍、如何排版、如何承接搜索流量" },
	                    monetizationLogic: { type: "string", description: "产品矩阵和成交路径的设计逻辑" },
	                  },
	                  required: ["video", "imageText", "monetizationLogic"],
	                },
	                shootingBlueprint: {
	                  type: "object",
	                  description: "导演级拍摄执行蓝图，必须拆成结构化字段",
	                  properties: {
	                    storyboard: {
	                      type: "array",
	                      items: { type: "string" },
	                      description: "分镜拆解，逐条说明镜头顺序、画面、动作、收音和剪辑点",
	                    },
	                    lighting: { type: "string", description: "灯光布置，包含主光、轮廓光、冷暖色温和角度" },
	                    blocking: { type: "string", description: "演员或博主走位，包含动线、站位和产品露出方式" },
	                    shotSize: { type: "string", description: "景别设计，包含特写、中景、全景、俯拍等使用时机" },
	                    emotionalTension: { type: "string", description: "情绪张力控制，包含表情、语速、停顿和冲突推进" },
	                    cameraPerformance: { type: "string", description: "镜头表现力要求，包含运动、焦段、B-roll 穿插和剪辑节奏" },
	                  },
	                  required: ["storyboard", "lighting", "blocking", "shotSize", "emotionalTension", "cameraPerformance"],
	                },
                imageTextNoteGuide: {
                  type: "object",
                  description: "小红书图文笔记攻略",
                  properties: {
                    coverSetup: { type: "string", description: "封面拍摄布置，包含视觉焦点、构图和关键词遮罩位置" },
                    titleOptions: {
                      type: "array",
                      description: "3组爆款标题，必须使用简体中文",
                      items: { type: "string" },
                    },
                    structuredBody: { type: "string", description: "带 Emoji 的结构化正文，包含分段节奏、每页图文笔记拍摄方法、配图顺序和行动引导" },
                  },
                  required: ["coverSetup", "titleOptions", "structuredBody"],
                },
                xiaohongshuLayout: { type: "string" },
              },
              required: [
                "hookLibrary",
                "emotionalPacing",
                "visualPaletteAndScript",
	                "productMatrix",
	                "shootingGuidance",
	                "businessInsight",
	                "shootingBlueprint",
                "imageTextNoteGuide",
                "xiaohongshuLayout",
              ],
            },
            summary: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            improvements: { type: "array", items: { type: "string" } },
            languageExpression: { type: "string" },
            emotionalExpression: { type: "string" },
            cameraEmotionTension: { type: "string" },
            bgmAnalysis: { type: "string" },
            musicRecommendation: { type: "string" },
            sunoPrompt: { type: "string" },
            titleSuggestions: { type: "array", items: { type: "string" } },
            creatorCenterSignals: { type: "array", items: { type: "string" } },
            timestampSuggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  timestamp: { type: "string" },
                  issue: { type: "string" },
                  fix: { type: "string" },
                  opportunity: { type: "string" },
                },
                required: ["timestamp", "issue", "fix"],
              },
            },
            weakFrameReferences: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  timestamp: { type: "string" },
                  reason: { type: "string" },
                  fix: { type: "string" },
                },
                required: ["timestamp", "reason", "fix"],
              },
            },
            commercialAngles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  scenario: { type: "string" },
                  whyItFits: { type: "string" },
                  brands: { type: "array", items: { type: "string" } },
                  execution: { type: "string" },
                  hook: { type: "string" },
                  veoPrompt: { type: "string" },
                },
                required: ["title", "scenario", "whyItFits", "brands", "execution", "hook"],
              },
            },
            followUpPrompt: { type: "string" },
          },
    required: [
      "composition",
      "color",
      "lighting",
      "impact",
      "viralPotential",
      "explosiveIndex",
      "platformScores",
      "realityCheck",
      "reverseEngineering",
    ],
  };
}

function normalizePremiumTopics(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    title: String(item?.title || ""),
    formatType: item?.formatType === "IMAGE_TEXT" ? "IMAGE_TEXT" : "VIDEO",
    businessInsight: String(item?.businessInsight || ""),
    contentBrief: String(item?.contentBrief || ""),
    directorExecution: {
      storyboard: Array.isArray(item?.directorExecution?.storyboard)
        ? item.directorExecution.storyboard.map(String).filter(Boolean)
        : [],
      lighting: String(item?.directorExecution?.lighting || ""),
      blocking: String(item?.directorExecution?.blocking || ""),
      emotionalTension: String(item?.directorExecution?.emotionalTension || ""),
    },
  })).filter((item) => item.title || item.contentBrief);
}

function normalizeShootingBlueprint(value: unknown, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const item = value as any;
    return {
      storyboard: Array.isArray(item.storyboard)
        ? item.storyboard.map(String).filter(Boolean)
        : [],
      lighting: String(item.lighting || ""),
      blocking: String(item.blocking || ""),
      shotSize: String(item.shotSize || ""),
      emotionalTension: String(item.emotionalTension || ""),
      cameraPerformance: String(item.cameraPerformance || ""),
    };
  }

  const text = String(value || fallback || "");
  return {
    storyboard: text ? [text] : [],
    lighting: "",
    blocking: "",
    shotSize: "",
    emotionalTension: "",
    cameraPerformance: "",
  };
}

function buildLegacyFieldsFromStrategist(parsed: any) {
  const platformScores = {
    xiaohongshu: Number(parsed?.platformScores?.xiaohongshu || 0),
    douyin: Number(parsed?.platformScores?.douyin || 0),
    bilibili: Number(parsed?.platformScores?.bilibili || 0),
    kuaishou: Number(parsed?.platformScores?.kuaishou || 0),
  };
  const reverseEngineering = {
    hookStrategy: coerceDisplayText(parsed?.reverseEngineering?.hookStrategy),
    emotionalArc: coerceDisplayText(parsed?.reverseEngineering?.emotionalArc),
    commercialLogic: coerceDisplayText(parsed?.reverseEngineering?.commercialLogic),
  };
  const basePremium =
    parsed?.premiumContent && typeof parsed.premiumContent === "object" && !Array.isArray(parsed.premiumContent)
      ? (parsed.premiumContent as Record<string, unknown>)
      : {};
  const fromParsedTopics = normalizePremiumTopics(parsed?.premiumContent?.topics);
  const premiumTopics =
    fromParsedTopics.length > 0 ? fromParsedTopics : normalizePremiumTopics(basePremium.topics);
  const premiumSummary = String(parsed?.premiumContent?.summary || basePremium.summary || "");
  const growthStrategy = {
    gapAnalysis: String(parsed?.growthStrategy?.gapAnalysis || ""),
    commercialMatrix: String(parsed?.growthStrategy?.commercialMatrix || ""),
  };
  const remixExecution = {
    hookLibrary: Array.isArray(parsed?.remixExecution?.hookLibrary)
      ? parsed.remixExecution.hookLibrary.map(String)
      : [],
    emotionalPacing: String(parsed?.remixExecution?.emotionalPacing || ""),
    visualPaletteAndScript: String(parsed?.remixExecution?.visualPaletteAndScript || ""),
    productMatrix: String(parsed?.remixExecution?.productMatrix || ""),
    shootingGuidance: String(parsed?.remixExecution?.shootingGuidance || ""),
    businessInsight: {
      video: String(parsed?.remixExecution?.businessInsight?.video || ""),
      imageText: String(parsed?.remixExecution?.businessInsight?.imageText || ""),
      monetizationLogic: String(parsed?.remixExecution?.businessInsight?.monetizationLogic || ""),
    },
    shootingBlueprint: normalizeShootingBlueprint(
      parsed?.remixExecution?.shootingBlueprint,
      parsed?.remixExecution?.shootingGuidance,
    ),
    imageTextNoteGuide: {
      coverSetup: String(parsed?.remixExecution?.imageTextNoteGuide?.coverSetup || ""),
      titleOptions: Array.isArray(parsed?.remixExecution?.imageTextNoteGuide?.titleOptions)
        ? parsed.remixExecution.imageTextNoteGuide.titleOptions.map(String)
        : [],
      structuredBody: String(parsed?.remixExecution?.imageTextNoteGuide?.structuredBody || ""),
    },
    xiaohongshuLayout: String(parsed?.remixExecution?.xiaohongshuLayout || ""),
  };

  return {
    ...(hasGrowthCoreScores(parsed)
      ? {
        composition: normalizeGrowthAnalysisScoreValue(parsed.composition, 0),
        color: normalizeGrowthAnalysisScoreValue(parsed.color, 0),
        lighting: normalizeGrowthAnalysisScoreValue(parsed.lighting, 0),
        impact: normalizeGrowthAnalysisScoreValue(parsed.impact, 0),
        viralPotential: normalizeGrowthAnalysisScoreValue(parsed.viralPotential, 0),
      }
      : {}),
    explosiveIndex: Number(parsed?.explosiveIndex || 0),
    platformScores,
    realityCheck: String(parsed?.realityCheck || ""),
    reverseEngineering,
    premiumContent: {
      ...basePremium,
      summary: premiumSummary,
      topics: premiumTopics,
    },
    growthStrategy,
    remixExecution,
    summary: String(
      parsed?.summary
      || parsed?.realityCheck
      || growthStrategy.gapAnalysis
      || reverseEngineering.commercialLogic
      || premiumSummary
      || "",
    ),
    strengths: Array.isArray(parsed?.strengths) && parsed.strengths.length
      ? coerceStringList(parsed.strengths)
      : [reverseEngineering.hookStrategy, reverseEngineering.emotionalArc].filter(Boolean),
    improvements: Array.isArray(parsed?.improvements) && parsed.improvements.length
      ? coerceStringList(parsed.improvements)
      : [coerceDisplayText(parsed?.realityCheck), reverseEngineering.commercialLogic].filter(Boolean),
    titleSuggestions: Array.isArray(parsed?.titleSuggestions) && parsed.titleSuggestions.length
      ? parsed.titleSuggestions.map(String)
      : premiumTopics.slice(0, 4).map((item) => item.title).filter(Boolean),
    commercialAngles: Array.isArray(parsed?.commercialAngles) && parsed.commercialAngles.length
      ? parsed.commercialAngles
      : premiumTopics.slice(0, 4).map((item) => ({
          title: item.title || "二次创作方向",
          scenario: premiumSummary || "把原视频改造成更有情绪张力和商业承接的版本。",
          whyItFits: reverseEngineering.commercialLogic || "这条方向更容易创建信任并承接成交动作。",
          brands: [],
          execution: item.contentBrief || "把人物、灯光、场景和结果镜头重组成更能停留的脚本。",
          hook: reverseEngineering.hookStrategy || "先抛最刺痛的问题或结果。",
          veoPrompt: "",
        })),
    followUpPrompt: String(
      parsed?.followUpPrompt
      || `请基于以下商业拆解与二次创作方向，继续输出一版可直接拍摄的脚本：钩子策略：${reverseEngineering.hookStrategy}；情绪弧线：${reverseEngineering.emotionalArc}；商业逻辑：${reverseEngineering.commercialLogic}`,
    ),
  };
}

const STRATEGIST_PREMIUM_TOPIC_ITEM_JSON: Record<string, unknown> = {
  type: "object",
  properties: {
    title: { type: "string" },
    formatType: { type: "string", enum: ["VIDEO", "IMAGE_TEXT"] },
    businessInsight: {
      type: "string",
      description: "引流品、利润品、转化路径的顾问级深度分析，不少于200字",
    },
    contentBrief: { type: "string" },
    directorExecution: {
      type: "object",
      properties: {
        storyboard: { type: "array", items: { type: "string" }, description: "完整分镜脚本" },
        lighting: { type: "string", description: "灯光布置" },
        blocking: { type: "string", description: "走位调度" },
        emotionalTension: { type: "string", description: "情绪控制" },
      },
      required: ["storyboard", "lighting", "blocking", "emotionalTension"],
    },
  },
  required: ["title", "formatType", "businessInsight", "contentBrief", "directorExecution"],
};

function strategistPremiumVertexSchema(mode: GrowthAnalysisMode): Record<string, unknown> {
  if (mode === "GROWTH") {
    return {
      type: "object",
      properties: {
        strategy: { type: "string", description: "顶级商业顾问：人设拆解与产品矩阵规划" },
        actionableTopics: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          description: "恰好 3 个即时可执行选题，导演级分镜",
          items: STRATEGIST_PREMIUM_TOPIC_ITEM_JSON,
        },
        topics: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          description: "恰好 3 个核心爆款选题，导演级分镜",
          items: STRATEGIST_PREMIUM_TOPIC_ITEM_JSON,
        },
        explosiveTopicAnalysis: { type: "string", description: "爆款选题深度综述" },
        musicAndExpressionAnalysis: { type: "string", description: "原视频表达与配乐分析，不少于 100 字" },
        musicPrompt: {
          type: "string",
          description: "Suno/Udio：[Music Style], [Instruments], [Mood], [Tempo]",
        },
      },
      required: [
        "strategy",
        "actionableTopics",
        "topics",
        "explosiveTopicAnalysis",
        "musicAndExpressionAnalysis",
        "musicPrompt",
      ],
    };
  }
  return {
    type: "object",
    properties: {
      actionableTopics: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        description:
          "针对用户背景量身定制的 3 个即时改编选题；每个 businessInsight 引流品/利润品深度不少于 300 字",
        items: STRATEGIST_PREMIUM_TOPIC_ITEM_JSON,
      },
      topics: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        description:
          "恰好 3 个深度二次创作选题，与 actionableTopics 递进延伸，导演级分镜，每个 businessInsight 不少于 200 字",
        items: STRATEGIST_PREMIUM_TOPIC_ITEM_JSON,
      },
      remixVisualAnalysis: {
        type: "string",
        description:
          "二次创作视觉分析（借鉴与避坑）：分析原视频优缺点，明确指出新选题该借鉴什么、避开什么。",
      },
      remixExpressionAnalysis: {
        type: "string",
        description:
          "二次创作专属表达指导：必须含 **参考语言表达力**、**参考情感表达方式**、**参考镜头表现与情绪张力** 三个加粗小标题（用字一致）。",
      },
      musicPrompt: {
        type: "string",
        description: "仅针对用户【新选题】的英文 BGM（Style, Mood, Instruments, Tempo/BPM）",
      },
    },
    required: ["actionableTopics", "topics", "remixVisualAnalysis", "remixExpressionAnalysis", "musicPrompt"],
  };
}

function mapStrategistPremiumLlmToPremiumContent(mode: GrowthAnalysisMode, raw: unknown) {
  const r = raw as Record<string, unknown>;
  if (mode === "GROWTH") {
    const parsed = growthLlmSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[GROWTH LLM] Zod parse failed, using partial data:", parsed.error.message.slice(0, 200));
    }
    const llm = parsed.success ? parsed.data : {
      strategy: String(r?.strategy || ""),
      actionableTopics: Array.isArray(r?.actionableTopics) ? r.actionableTopics : [],
      topics: Array.isArray(r?.topics) ? r.topics : [],
      explosiveTopicAnalysis: String(r?.explosiveTopicAnalysis || ""),
      musicAndExpressionAnalysis: String(r?.musicAndExpressionAnalysis || ""),
      musicPrompt: String(r?.musicPrompt || ""),
    };
    return growthPremiumContentSchema.parse({
      summary: "",
      strategy: llm.strategy,
      actionableTopics: llm.actionableTopics,
      topics: llm.topics,
      explosiveTopicAnalysis: llm.explosiveTopicAnalysis,
      musicAndExpressionAnalysis: llm.musicAndExpressionAnalysis,
      remixVisualAnalysis: "",
      remixExpressionAnalysis: "",
      musicPrompt: llm.musicPrompt,
    });
  }
  // REMIX
  const parsed = remixLlmSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[REMIX LLM] Zod parse failed, using partial data:", parsed.error.message.slice(0, 200));
  }
  const llm = parsed.success ? parsed.data : {
    actionableTopics: Array.isArray(r?.actionableTopics) ? r.actionableTopics : [],
    topics: Array.isArray(r?.topics) ? r.topics : [],
    remixVisualAnalysis: String(r?.remixVisualAnalysis || ""),
    remixExpressionAnalysis: String(r?.remixExpressionAnalysis || ""),
    musicPrompt: String(r?.musicPrompt || ""),
  };
  return growthPremiumContentSchema.parse({
    summary: "",
    strategy: "",
    actionableTopics: llm.actionableTopics,
    topics: llm.topics,
    explosiveTopicAnalysis: "",
    musicAndExpressionAnalysis: "",
    remixVisualAnalysis: llm.remixVisualAnalysis,
    remixExpressionAnalysis: llm.remixExpressionAnalysis,
    musicPrompt: llm.musicPrompt,
  });
}

function buildStrategistPremiumPrompts(
  mode: GrowthAnalysisMode,
  businessGoal: string,
  mediaKind: "video" | "image",
) {
  const sourceLabel = mediaKind === "image" ? "原图片素材" : "原视频";
  if (mode === "GROWTH") {
    return `你是顶级商业IP操盘手与大师级导演。模式：商业成长营
用户业务背景（必须严格对齐）：${businessGoal}
【排版要求】Markdown 条列（- ）与 **加粗（关键字）**；段落之间空一行。
【输出要求 — 禁止套话｜必须量身定做】

1. strategy：人设转化＋产品矩阵（品名、定价区间、平台、转化路径），条列加粗，禁止只写标题。

2. actionableTopics：恰好 3 个「本周就能拍」的即时改编选题。每个选题必须：
   - title：10字以内、带情绪张力的选题标题（禁止泛泛如「职场感悟」）
   - contentBrief：必须分三段，用 **加粗** 标出段落名：
     **【开场钩子（前3秒口播）】**：直接写出可说的具体文本（不是描述，是台词）
     **【核心论述与拍摄思路】**：选题逻辑、拍摄手法、情绪推进
     **【结尾行动召唤】**：引导观众点赞/留言/关注的收尾文本
   - businessInsight：引流品（品名+定价+获客方式）→ 利润品（品名+客单价）→ 转化路径（3步骤），不少于 300 字
   - directorExecution.storyboard：恰好 5-6 条，每条严格格式：「[景别][时长] 画面描述 | 口播：「...」 | 情绪：...」

3. topics：恰好 3 个长线IP定位选题，与 actionableTopics 角度递进（不重复）；格式要求同上（storyboard 5-6 条），businessInsight 不少于 200 字。

4. explosiveTopicAnalysis：综合拆解 3 个 actionableTopics 的爆款逻辑与差异。

5. musicAndExpressionAnalysis：${sourceLabel}的视觉/文案/表达分析，不少于 100 字。

6. musicPrompt：Suno/Udio 格式：[Music Style], [Instruments], [Mood], [Tempo/BPM]。`;
  }
  return `你是顶级商业IP操盘手与大师级导演。模式：实战爆款 · 二次创作
用户业务背景（必须严格对齐）：${businessGoal}
【排版要求】Markdown 条列（- ）与 **加粗（关键字）**；段落之间空一行。
【输出要求 — 禁止敷衍｜必须量身定做｜禁止套话】

1. actionableTopics：恰好 3 个「本周就能拍」的即时改编选题，角度各异。每个选题必须：
   - title：10字以内、带情绪张力的选题标题（直接写，禁止泛泛如「职场感悟」）
   - contentBrief：必须分三段，用 **加粗** 标出段落名：
     **【开场钩子（前3秒口播）】**：直接写出可说的具体台词（不是描述镜头，是可直接读出的话）
     **【核心论述与拍摄思路】**：选题逻辑、情绪推进方式、如何借鉴原片
     **【结尾行动召唤】**：引导观众留言/关注/私信的具体收尾文本
   - businessInsight：引流品（品名+定价区间+获客平台）→ 利润品（品名+客单价）→ 转化路径（3步骤），不少于 300 字
   - directorExecution.storyboard：恰好 5-6 条，每条严格格式：「[景别][时长] 画面描述 | 口播：「...」 | 情绪：...」

2. topics：恰好 3 个长线IP定位选题，与 actionableTopics 递进（不重复角度，提升到 3 个月 IP 积累视角）；格式要求同上（storyboard 5-6 条）；businessInsight 不少于 200 字。

3. remixVisualAnalysis：**二次创作视觉分析（借鉴与避坑）**。
   - **借鉴**：${sourceLabel}哪些视觉手法值得学习（具体到景别/灯光/版式）
   - **避坑**：${sourceLabel}哪些视觉缺点必须避开（具体到画面细节）
   - 结合用户业务和新选题，禁止空泛套话。

4. remixExpressionAnalysis：**二次创作专属表达指导**（必须针对用户新选题，禁止照搬原片套话）。内文必须含且 **加粗** 三个小标题（用字一致）：
   **参考语言表达力**：用户应使用哪些语气/词汇/表达技巧
   **参考情感表达方式**：情绪节奏如何设计，从开场到结尾
   **参考镜头表现与情绪张力**：具体镜头语言建议（景别、眼神、节奏）

5. musicPrompt：抛弃原素材配乐思路，仅针对用户新选题调性输出英文 BGM：[Music Style], [Instruments], [Mood], [Tempo/BPM]。`;
}

export async function runGrowthCampStrategistMultimodalPass(params: {
  systemMain: string;
  userContent: StrategistUserContent;
  mode: GrowthAnalysisMode;
  strategistEngine: GrowthCampStrategistEngine;
  businessGoal: string;
  mediaKind: "video" | "image";
  /** Platform 素材区：仅 main pass，跳过 premium 第二轮（约省 3–8 分钟） */
  skipPremiumPass?: boolean;
}): Promise<Record<string, unknown>> {
  const { mode, strategistEngine, businessGoal, mediaKind, skipPremiumPass } = params;
  const premiumPrompt = buildStrategistPremiumPrompts(mode, businessGoal, mediaKind);
  let strategistPassResult: Record<string, unknown> | undefined;
  let _retries = 3;
  let _scoreRetries = 2;
  let _delayMs = 5000;
  while (_retries > 0) {
    try {
      let mainResponse: Awaited<ReturnType<typeof invokeLLM>>;
      let premiumResult: Awaited<ReturnType<typeof invokeLLM>> | null = null;

      if (skipPremiumPass) {
        mainResponse = await invokeLLM({
          ...strategistInvokeBase(strategistEngine),
          temperature: 0.7,
          topP: 0.9,
          messages: [
            { role: "system", content: params.systemMain },
            { role: "user", content: params.userContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "growth_camp_strategist_output",
              strict: true,
              schema: growthCampStrategistMainJsonSchema(),
            },
          },
        });
      } else {
        [mainResponse, premiumResult] = await Promise.all([
          invokeLLM({
            ...strategistInvokeBase(strategistEngine),
            temperature: 0.7,
            topP: 0.9,
            messages: [
              { role: "system", content: params.systemMain },
              { role: "user", content: params.userContent },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "growth_camp_strategist_output",
                strict: true,
                schema: growthCampStrategistMainJsonSchema(),
              },
            },
          }),
          invokeLLM({
            ...strategistInvokeBase(strategistEngine),
            temperature: 0.7,
            topP: 0.9,
            messages: [
              { role: "system", content: premiumPrompt },
              { role: "user", content: params.userContent },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: mode === "GROWTH" ? "growth_camp_premium_growth" : "growth_camp_premium_remix",
                strict: true,
                schema: strategistPremiumVertexSchema(mode),
              },
            },
          }).catch((premiumErr: unknown) => {
            const errMsg = premiumErr instanceof Error ? premiumErr.message : String(premiumErr);
            console.error(`[${mode} Premium LLM] 并行分析失败，降级为空内容:`, errMsg);
            return null;
          }),
        ]);
      }

      const parsedMain = parseLlmJsonResponse<Record<string, unknown>>(
        String(mainResponse.choices[0]?.message?.content || "{}"),
      );
      if (!hasGrowthCoreScores(parsedMain) && _scoreRetries > 0) {
        _scoreRetries--;
        console.warn("[growth.strategist] main pass missing core scores, retrying strategist LLM");
        continue;
      }

      let premiumContent: ReturnType<typeof mapStrategistPremiumLlmToPremiumContent>;
      const emptyPremium = {
        summary: "", strategy: "", actionableTopics: [], topics: [],
        explosiveTopicAnalysis: "", musicAndExpressionAnalysis: "",
        remixVisualAnalysis: "", remixExpressionAnalysis: "", musicPrompt: "",
      } as ReturnType<typeof mapStrategistPremiumLlmToPremiumContent>;

      if (premiumResult !== null) {
        try {
          const premiumRaw = parseLlmJsonResponse<Record<string, unknown>>(
            String(premiumResult.choices[0]?.message?.content || "{}"),
          );
          premiumContent = mapStrategistPremiumLlmToPremiumContent(mode, premiumRaw);
        } catch (parseErr: unknown) {
          const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.error(`[${mode} Premium LLM] parse失败，降级为空内容:`, errMsg);
          premiumContent = {
            summary: "", strategy: "", actionableTopics: [], topics: [],
            explosiveTopicAnalysis: "", musicAndExpressionAnalysis: "",
            remixVisualAnalysis: "", remixExpressionAnalysis: "", musicPrompt: "",
          } as ReturnType<typeof mapStrategistPremiumLlmToPremiumContent>;
        }
      } else {
        premiumContent = emptyPremium;
      }

      const withPremium = { ...parsedMain, premiumContent };
      strategistPassResult = {
        ...withPremium,
        ...buildLegacyFieldsFromStrategist(withPremium),
      };
      break;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit =
        (err as { status?: number })?.status === 429 ||
        msg.includes("429") ||
        msg.includes("Resource exhausted") ||
        msg.includes("RESOURCE_EXHAUSTED");
      if (isRateLimit && _retries > 1) {
        _retries--;
        console.warn(`[Vertex AI] 429 限制，等待 ${_delayMs / 1000}s 后重试，剩余 ${_retries} 次`);
        await new Promise<void>((resolve) => setTimeout(resolve, _delayMs));
        _delayMs *= 2;
      } else {
        console.error("[Vertex AI] Strategist LLM 调用失败:", err);
        throw err;
      }
    }
  }
  if (!strategistPassResult) {
    throw new Error("无法从 Vertex AI 获取分析结果，请稍后再试。");
  }
  return ensureGrowthCoreScores(strategistPassResult, {
    strategistEngine,
    context: params.businessGoal,
    evidenceText: serializeStrategistUserContent(params.userContent),
  });
}

export function buildGrowthCampStrategistSystemMainForImages(
  mode: GrowthAnalysisMode,
  businessGoal: string,
): string {
  return `
你是顶级商业IP操盘手与大师级导演。
模式：${mode === "REMIX" ? "实战爆款 · 二次创作" : "商业成长营"}
用户业务背景（必须严格对齐，禁止忽略）：${businessGoal}
素材类型：静态图片（封面/分镜/图文笔记页/海报），无口播与 BGM。

【排版禁令：禁止文本墙】
所有长文必须 Markdown 条列（- ）与 **加粗**；段落间空行。禁止「暂无」「待补充」。禁止「请建议」「您可以」等软弱语气。
平台仅限【抖音、快手、小红书、B站】，严禁「视频号」。

【静态图片分析 · 强制规则】
1. reverseEngineering.emotionalArc：基于画面构图、文案语气、视觉层级与信息节奏，写出「阅读/浏览情绪曲线」（开场抓眼→信息展开→行动召唤）。
2. remixExecution.emotionalPacing：基于图文排版节奏、标题冲击力、留白与 CTA 位置，写信息推进节奏。
3. remixExecution.shootingBlueprint / imageTextNoteGuide：必须结合上传图片中可见的文字、人物、产品、版式做**具体**建议，禁止空泛。
4. 若有多张图片，说明它们之间是封面+内页、分镜序列还是 A/B 方案，并分别点评。

【本轮输出】
请完整产出 JSON Schema 所要求的评分、reverseEngineering、remixExecution 等字段。不要输出 premiumContent（该区块由下一轮专模单独生成；禁止在 JSON 中加入 premiumContent 键）。
`;
}

export async function runGrowthCampStrategistForImages(params: {
  userContent: StrategistUserContent;
  context?: string;
  mode?: GrowthAnalysisMode;
  modelName?: string;
  /** 覆写引擎（例如主路径失败后走 Gemini 3.5 Flash fallback） */
  strategistEngine?: GrowthCampStrategistEngine;
  /** Platform 素材区：跳过 premium 专模，先出主报告 */
  skipPremiumPass?: boolean;
}): Promise<GrowthAnalysisScores> {
  const mode = params.mode || "GROWTH";
  const businessGoal = (params.context || "未提供").trim() || "未提供";
  const strategistEngine = params.strategistEngine || resolveGrowthCampStrategistEngine(params.modelName);
  const systemMain = buildGrowthCampStrategistSystemMainForImages(mode, businessGoal);
  const result = await runGrowthCampStrategistMultimodalPass({
    systemMain,
    userContent: params.userContent,
    mode,
    strategistEngine,
    businessGoal,
    mediaKind: "image",
    skipPremiumPass: params.skipPremiumPass,
  });
  const evidenceText = typeof params.userContent === "string"
    ? params.userContent
    : JSON.stringify(params.userContent, null, 2);
  const withScores = await ensureGrowthCoreScores(result, {
    strategistEngine,
    context: params.context,
    evidenceText,
  });
  return parseGrowthAnalysisScores({ ...withScores, mode });
}
