import { type GrowthAnalysisScores, growthAnalysisScoresSchema } from "@shared/growth";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import { resolveGrowthCampStrategistEngine } from "./extractorPipeline";

export type GrowthCampImageAssetInput = {
  fileBase64: string;
  mimeType: string;
  fileName?: string;
};

export type GrowthCampImageAnalysisResult = {
  analysis: GrowthAnalysisScores;
  imageMeta: {
    fileUrls: string[];
    imageCount: number;
    provider: string;
    model: string;
    fallback: boolean;
  };
};

function normalizeImageMime(mimeType: string, fileName?: string): "image/png" | "image/jpeg" | null {
  const mime = String(mimeType || "").trim().toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (mime === "image/png" || name.endsWith(".png")) return "image/png";
  if (mime === "image/jpeg" || mime === "image/jpg" || /\.jpe?g$/i.test(name)) return "image/jpeg";
  return null;
}

function buildFallbackImageAnalysis(context: string, count: number) {
  return growthAnalysisScoresSchema.parse({
    composition: 70,
    color: 72,
    lighting: 68,
    impact: 66,
    viralPotential: 70,
    strengths: [
      `已接收 ${count} 张图片素材，视觉信息可用于包装与平台适配判断。`,
      "建议明确图片所服务的商业场景与目标受众。",
      "可进一步与口播/视频素材组合成完整 brief。",
    ],
    improvements: [
      "补充更清晰的标题、卖点或 CTA 文案。",
      "建议统一视觉风格与品牌识别元素。",
      "最好说明图片将用于哪个平台与转化目标。",
    ],
    platforms: ["小红书", "抖音", "B站"],
    summary: context.trim()
      ? `基于 ${count} 张图片与业务背景「${context.trim().slice(0, 80)}」，当前更适合从视觉包装、信息清晰度与平台分发潜力做保守增长判断。`
      : `基于 ${count} 张图片，当前更适合从视觉包装、信息清晰度与平台分发潜力做保守增长判断。`,
  });
}

export async function analyzeGrowthCampImages(params: {
  images: GrowthCampImageAssetInput[];
  context?: string;
  modelName?: string;
}): Promise<GrowthCampImageAnalysisResult> {
  const images = (params.images || []).filter((img) => String(img.fileBase64 || "").trim());
  if (!images.length) {
    throw new Error("请至少上传一张 PNG 或 JPG 图片");
  }

  const strategistEngine = resolveGrowthCampStrategistEngine(params.modelName);
  const fileUrls: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const mime = normalizeImageMime(img.mimeType, img.fileName);
    if (!mime) {
      throw new Error(`不支持的图片格式：${img.fileName || img.mimeType || "unknown"}`);
    }
    const buffer = Buffer.from(img.fileBase64, "base64");
    const keyName = img.fileName || `image-${i + 1}.${mime === "image/png" ? "png" : "jpg"}`;
    const { url } = await storagePut(`growth-camp/images/${Date.now()}-${i}-${keyName}`, buffer, mime);
    fileUrls.push(url);
  }

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: [
        `用户上传了 ${images.length} 张图片（PNG/JPG），请做 Creator Growth Camp 商业增长分析。`,
        params.context?.trim() ? `业务背景：${params.context.trim()}` : "业务背景：未提供",
        "请综合所有图片中的文字、人物、产品、场景、版式与视觉风格做判断。",
      ].join("\n\n"),
    },
  ];

  for (const img of images) {
    const mime = normalizeImageMime(img.mimeType, img.fileName)!;
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${mime};base64,${img.fileBase64}`,
      },
    });
  }

  try {
    const response = await invokeLLM({
      model: "pro",
      provider: strategistEngine.provider,
      modelName: strategistEngine.modelName,
      messages: [
        {
          role: "system",
          content: `你是一位创作者商业增长顾问。请分析用户上传的图片素材，并返回 Creator Growth Camp 所需的统一评分结构。

注意：
1. 必须依据图片中可见内容（人物、产品、文字、场景、版式）做判断，不能空泛套模板。
2. 评分字段语义：
- composition: 结构/版式质量
- color: 包装与视觉表达潜力
- lighting: 信息清晰度（含文字可读性）
- impact: 钩子与传播张力
- viralPotential: 商业增长潜力
3. platforms 返回最适合首发或分发的平台名称数组。
4. strengths / improvements 用简体中文，具体可执行。
5. summary 覆盖：视觉主题、商业定位、受众/平台建议、增长机会、可转成 brief 的方向。

只返回 JSON：
{
  "composition": number,
  "color": number,
  "lighting": number,
  "impact": number,
  "viralPotential": number,
  "strengths": ["string"],
  "improvements": ["string"],
  "platforms": ["string"],
  "summary": "string"
}`,
        },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
    return {
      analysis: growthAnalysisScoresSchema.parse(parsed),
      imageMeta: {
        fileUrls,
        imageCount: images.length,
        provider: response.provider || "unknown",
        model: response.model || "unknown",
        fallback: false,
      },
    };
  } catch (error) {
    console.warn("[growth.analyzeGrowthCampImages] fallback:", error);
    return {
      analysis: buildFallbackImageAnalysis(params.context || "", images.length),
      imageMeta: {
        fileUrls,
        imageCount: images.length,
        provider: "fallback",
        model: "deterministic",
        fallback: true,
      },
    };
  }
}
