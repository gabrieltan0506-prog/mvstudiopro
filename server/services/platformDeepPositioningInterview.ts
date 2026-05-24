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
    acquisitionOptimizationNotes: "先完成一轮真实用户访谈以校准人群画像",
    topicSeeds: [],
  };
}

export async function runPlatformPositioningInterview(opts: {
  initialPrompt: string;
  turns: PlatformPositioningTurn[];
  /** 最新一轮用户回答（首轮可为空，表示刚提交 prompt） */
  latestAnswer?: string;
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

  const round = turns.filter((t) => t.answer?.trim()).length + 1;

  const historyBlock = turns
    .map((t, i) => {
      const qs = t.questions.join(" / ");
      const ans = t.answer?.trim() || "（待回答）";
      return `第 ${i + 1} 轮\n问：${qs}\n答：${ans}`;
    })
    .join("\n\n");

  const userText = [
    `【用户初始 prompt】\n${initialPrompt}`,
    historyBlock ? `【已完成的访谈】\n${historyBlock}` : "【已完成的访谈】\n（尚无，请立刻基于初始 prompt 反问 1-2 个最关键问题）",
    latestAnswer && turns.length === 0
      ? `【用户补充】\n${latestAnswer}`
      : "",
    `【当前轮次】${round}`,
    round >= 6 ? "信息应已足够，若可输出完整深度定位简报请 status=ready。" : "",
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

  if (parsed.success) {
    if (parsed.data.status === "continue" && parsed.data.questions.length === 0) {
      return {
        response: {
          status: "continue",
          round: parsed.data.round || round,
          resonance: parsed.data.resonance || "我需要再确认几个关键点。",
          questions: ["你目前最想优先服务的，是哪一类具体的人？他们最典型的日常困境是什么？"],
        },
        modelUsed: "gemini-3.5-flash",
      };
    }
    return { response: parsed.data, modelUsed: "gemini-3.5-flash" };
  }

  if (round >= 3) {
    return {
      response: {
        status: "ready",
        round,
        resonance: "信息已够，我先帮你整理一版深度定位。",
        questions: [],
        deepPositioningBrief: buildFallbackBrief(initialPrompt),
      },
      modelUsed: "gemini-3.5-flash-fallback",
    };
  }

  return {
    response: {
      status: "continue",
      round,
      resonance: "我先从你最熟悉的场景问起。",
      questions: [
        "你过去 3 年最常帮别人解决的具体问题是什么？哪怕免费做过也算。",
        "如果只能选一类人服务，谁最急、也最愿意为这个结果付钱？",
      ],
    },
    modelUsed: "gemini-3.5-flash-fallback",
  };
}
