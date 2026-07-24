/**
 * Canvas 多模态：GPT-5.6-Terra（official_only）主路径。
 * 客户端失败后再回退 /api/google Gemini。
 */
import {
  extractFirstChoicePlainText,
  invokeLLM,
  type MessageContent,
} from "../_core/llm";
import { EVOLINK_CHAT_MODEL_GPT56_TERRA } from "./evolinkChatModel.js";
import { getOfficialOpenAiApiKey } from "./gpt56CopywritingGateway.js";
import {
  VIDEO_REVERSE_SYSTEM_PROMPT,
  buildVideoReverseUserPrompt,
  parseVideoReverseOutputMode,
  type VideoReverseOutputMode,
} from "../../shared/videoReversePrompt.js";

export const CANVAS_TERRA_MULTIMODAL_CAPACITY_MESSAGE = "算力紧张，请稍后重试";

export type CanvasTerraImageInput = {
  url: string;
  mimeType?: string;
};

function assertOfficialKey(): void {
  if (!getOfficialOpenAiApiKey()) {
    throw new Error(CANVAS_TERRA_MULTIMODAL_CAPACITY_MESSAGE);
  }
}

function toImageParts(
  images: CanvasTerraImageInput[],
  max: number,
): MessageContent[] {
  const out: MessageContent[] = [];
  for (const item of images.slice(0, max)) {
    const url = String(item.url || "").trim();
    if (!url) continue;
    out.push({
      type: "image_url",
      image_url: { url, detail: out.length < 4 ? "high" : "auto" },
    });
  }
  return out;
}

async function invokeTerraMarkdown(params: {
  system: string;
  userText: string;
  images: CanvasTerraImageInput[];
  maxImages: number;
}): Promise<string> {
  assertOfficialKey();
  const imageParts = toImageParts(params.images, params.maxImages);
  if (!imageParts.length) {
    throw new Error("缺少参考图");
  }
  const response = await invokeLLM({
    provider: "openai",
    modelName: EVOLINK_CHAT_MODEL_GPT56_TERRA,
    openAiGateway: "official_only",
    max_tokens: 16384,
    temperature: 0.4,
    messages: [
      { role: "system", content: params.system },
      {
        role: "user",
        content: [{ type: "text", text: params.userText }, ...imageParts],
      },
    ],
  });
  const text = extractFirstChoicePlainText(response).trim();
  if (!text) throw new Error(CANVAS_TERRA_MULTIMODAL_CAPACITY_MESSAGE);
  return text;
}

/** 多图视觉 → Markdown */
export async function runCanvasTerraVisionMarkdown(input: {
  prompt: string;
  images: CanvasTerraImageInput[];
}): Promise<{ markdown: string; imageCount: number; model: string }> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("缺少提示词");
  const images = (input.images || []).filter((i) => String(i.url || "").trim());
  if (!images.length) throw new Error("缺少参考图");

  const markdown = await invokeTerraMarkdown({
    system:
      "你是创作视觉分析助手。只输出 Markdown，不要 JSON 围栏、不要道歉、不要写模型名。",
    userText: [
      prompt,
      "",
      `（共 ${Math.min(images.length, 16)} 张图）`,
      "请输出 Markdown，标题清晰、条理分明。",
    ].join("\n"),
    images,
    maxImages: 16,
  });
  return {
    markdown,
    imageCount: Math.min(images.length, 16),
    model: EVOLINK_CHAT_MODEL_GPT56_TERRA,
  };
}

/** 有帧视频反推 → Markdown */
export async function runCanvasTerraVideoReverse(input: {
  userHint: string;
  images: CanvasTerraImageInput[];
  outputMode?: VideoReverseOutputMode | string;
  targetEngine?: string;
}): Promise<{ markdown: string; frameCount: number; model: string }> {
  const images = (input.images || []).filter((i) => String(i.url || "").trim());
  if (!images.length) throw new Error("缺少参考帧");
  const outputMode = parseVideoReverseOutputMode(input.outputMode);
  const targetEngine =
    String(input.targetEngine || "seedance-2.0") === "generic"
      ? "generic"
      : "seedance-2.0";
  const userHint = String(input.userHint || "").trim() || "反推分镜表与微动提示词";

  const markdown = await invokeTerraMarkdown({
    system: VIDEO_REVERSE_SYSTEM_PROMPT,
    userText: [
      buildVideoReverseUserPrompt({
        userHint,
        outputMode,
        targetEngine,
      }),
      "",
      `（共 ${Math.min(images.length, 24)} 帧，按时间顺序）`,
    ].join("\n"),
    images,
    maxImages: 24,
  });
  return {
    markdown,
    frameCount: Math.min(images.length, 24),
    model: EVOLINK_CHAT_MODEL_GPT56_TERRA,
  };
}
