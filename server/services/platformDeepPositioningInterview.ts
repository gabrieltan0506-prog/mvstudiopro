import {
  platformPositioningInterviewResponseSchema,
  type PlatformDeepPositioningBrief,
  type PlatformPositioningTurn,
} from "../../shared/platformPositioningDiscovery.js";
import { buildPositioningInterviewSystemPrompt } from "../content/positioningAcquisitionSixSteps.js";
import { callGemini35FlashCopywriting } from "./gemini35FlashRuntime.js";

function extractJsonObject(raw: string): unknown {
  const text = String(raw || "").trim();
  const bracket = text.match(/\{[\s\S]*\}/);
  if (bracket) {
    try {
      return JSON.parse(bracket[0]);
    } catch {
      /* fall through */
    }
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function buildFallbackBrief(initialPrompt: string): PlatformDeepPositioningBrief {
  const p = String(initialPrompt || "").trim().slice(0, 200);
  return {
    positioningOneLiner: p || "待进一步澄清：我是谁、帮谁、解决什么问题",
    positioningType: "capability",
    uniqueSolution: "基于用户自述的 AI 内容能力与行业经验组合交付",
    painPointSummary: "目标用户尚未被精准描述，需结合窗口数据保守推断",
    targetSubgroups: [],
    recommendedPlatforms: ["xiaohongshu", "douyin"],
    primaryPlatform: "xiaohongshu",
    primaryTrack: "待结合数据快照细化",
    contentFormatRecommendation: "mixed",
    topicDirections: [],
    hookStrategy: {
      principles: ["强相关", "门槛低", "有承接"],
      conversionDirection: "评论关键词领取资料或预约咨询",
      fulfillmentNote: "24 小时内回复评论",
    },
    trustSystem: {
      resonance: "先对齐目标用户最具体的焦虑场景",
      methodology: "用可执行的步骤/清单交付方法论",
      caseProof: "用真实或合成案例展示前后对比",
      guarantee: "低门槛试用/答疑降低首次付费阻力",
    },
    fourAiCapabilities: {
      dataAbility: "结合平台快照与指数信号支撑选题",
      contentAbility: "爆款结构+钩子承接一体化",
      thinkingAbility: "深度定位洞察驱动优先级",
      productAbility: "钩子指向可交付资料/咨询/工具",
    },
    acquisitionOptimizationNotes: "先完成一轮真实用户访谈以校准人群画像",
    topicSeeds: [],
  };
}

export async function runPlatformPositioningInterview(opts: {
  initialPrompt: string;
  turns: PlatformPositioningTurn[];
  latestAnswer?: string;
  /** 四平台数据快照文本（含 trendStore + 抖音指数） */
  dataSnapshotBrief: string;
  abortSignal?: AbortSignal;
}): Promise<{
  response: ReturnType<typeof platformPositioningInterviewResponseSchema.parse>;
  modelUsed: string;
}> {
  const initialPrompt = String(opts.initialPrompt || "").trim();
  if (!initialPrompt) {
    throw new Error("请先输入你这轮最想判断什么");
  }

  const turns = [...opts.turns];
  const latestAnswer = String(opts.latestAnswer || "").trim();

  if (latestAnswer && turns.length > 0) {
    const last = turns[turns.length - 1];
    turns[turns.length - 1] = { ...last, answer: latestAnswer };
  }

  const answeredRounds = turns.filter((t) => t.answer?.trim()).length;
  const round = answeredRounds + 1;

  const historyBlock = turns
    .map((t, i) => {
      const qs = t.questions.join(" / ");
      const ans = t.answer?.trim() || "（待回答）";
      return `第 ${i + 1} 轮\n问：${qs}\n答：${ans}`;
    })
    .join("\n\n");

  const isFirstRound = answeredRounds === 0 && !latestAnswer;

  const userText = [
    opts.dataSnapshotBrief,
    `【用户初始 prompt】\n${initialPrompt}`,
    historyBlock
      ? `【已完成的访谈】\n${historyBlock}`
      : "【已完成的访谈】\n（尚无 — 请**立刻**结合上方数据快照与 prompt 反问 1-2 个最关键问题）",
    latestAnswer && turns.length === 0 ? `【用户补充】\n${latestAnswer}` : "",
    `【当前轮次】${round}`,
    isFirstRound
      ? "首轮必须引用数据快照中的至少 1 条具体信号（平台标题/指数词）来组织反问。"
      : "",
    answeredRounds >= 4
      ? "信息应已足够；请输出 status=ready 与完整 deepPositioningBrief（含平台/赛道/选题方向/钩子/转化）。"
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callGemini35FlashCopywriting({
    taskSystemInstruction: buildPositioningInterviewSystemPrompt(),
    userText,
    responseMimeType: "application/json",
    maxOutputTokens: 8192,
    abortSignal: opts.abortSignal,
  });

  const parsedRaw = extractJsonObject(raw);
  const parsed = platformPositioningInterviewResponseSchema.safeParse(parsedRaw);

  const snapshotPreview = opts.dataSnapshotBrief.slice(0, 600);

  if (parsed.success) {
    const data = parsed.data;
    if (data.status === "continue" && data.questions.length === 0) {
      return {
        response: {
          status: "continue",
          round: data.round || round,
          resonance: data.resonance || "我看了四平台数据快照，需要再确认几个关键点。",
          questions: [
            "快照里近期有几个与你方向接近的热点切口——你更擅长稳定产出「出镜短视频」还是「图文笔记」？",
            "如果只能先打一条赛道，你最想优先验证哪一类具体人群的付费意愿？",
          ],
          dataSnapshotPreview: snapshotPreview,
        },
        modelUsed: "gemini-3.5-flash",
      };
    }
    return {
      response: { ...data, dataSnapshotPreview: data.dataSnapshotPreview || snapshotPreview },
      modelUsed: "gemini-3.5-flash",
    };
  }

  if (answeredRounds >= 3) {
    return {
      response: {
        status: "ready",
        round,
        resonance: "信息已够，我先帮你整理一版深度定位与获客简报。",
        questions: [],
        deepPositioningBrief: buildFallbackBrief(initialPrompt),
        dataSnapshotPreview: snapshotPreview,
      },
      modelUsed: "gemini-3.5-flash-fallback",
    };
  }

  return {
    response: {
      status: "continue",
      round,
      resonance: "结合数据快照，我先从你最熟悉的场景问起。",
      questions: [
        "快照里近期有几个热点切口——你目前最想优先服务的具体人群是谁？他们的典型困境是什么？",
        "你能稳定产出哪种形态：出镜短视频、图文笔记，还是长视频讲透？",
      ],
      dataSnapshotPreview: snapshotPreview,
    },
    modelUsed: "gemini-3.5-flash-fallback",
  };
}
