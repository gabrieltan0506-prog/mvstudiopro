import { type GrowthAnalysisScores, growthAnalysisScoresSchema } from "@shared/growth";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import { extractDocumentText } from "./documentExtract";

type DocumentAnalysisResult = {
  analysis: GrowthAnalysisScores;
  documentMeta: {
    fileUrl: string;
    extractionMethod: "docx_xml" | "pdf_strings" | "none";
    extractedTextPreview: string;
    provider: string;
    model: string;
    fallback: boolean;
  };
};

function resolveGrowthCampFinalModel(modelName?: string): string {
  return String(
    modelName
      || process.env.GROWTH_CAMP_FINAL_MODEL
      || process.env.VERTEX_GROWTH_FINAL_MODEL
      || "gemini-2.5-pro",
  ).trim() || "gemini-2.5-pro";
}

function truncate(value: string, max = 6000) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function buildFallbackDocumentAnalysis(text: string, context: string) {
  const normalized = text.trim();
  const summary = normalized
    ? `文档已提取到可分析正文，当前更适合围绕清晰结构、商业定位和平台适配来输出成长营报告。`
    : "文档正文提取有限，当前报告基于文件主题和业务背景做保守分析。";
  const isCommercial = /品牌|招商|服务|客户|案例|转化/.test(`${normalized}\n${context}`);
  const isEducation = /课程|教学|培训|教程|知识|方法/.test(`${normalized}\n${context}`);

  return growthAnalysisScoresSchema.parse({
    composition: normalized ? 78 : 64,
    color: normalized ? 72 : 60,
    lighting: normalized ? 80 : 66,
    impact: isCommercial ? 74 : 68,
    viralPotential: isEducation || isCommercial ? 82 : 72,
    strengths: [
      "内容可整理成更明确的单一主题和商业落点。",
      "适合继续拆成平台适配版、案例版和方法版。",
      "可进一步沉淀成创作 brief 和执行计划。",
    ],
    improvements: [
      "建议明确目标受众和唯一转化目标。",
      "文档表达还需要更强标题和章节层次。",
      "最好补充更具体的商业 CTA 或承接动作。",
    ],
    platforms: isEducation ? ["B站", "小红书", "抖音"] : ["小红书", "B站", "抖音"],
    summary,
  });
}

export async function analyzeDocument(params: {
  fileBase64: string;
  mimeType: string;
  fileName?: string;
  context?: string;
  modelName?: string;
}): Promise<DocumentAnalysisResult> {
  const finalModel = resolveGrowthCampFinalModel(params.modelName);
  const buffer = Buffer.from(params.fileBase64, "base64");
  const keyName = params.fileName || `document-${Date.now()}.bin`;
  const { url: fileUrl } = await storagePut(`growth-camp/documents/${Date.now()}-${keyName}`, buffer, params.mimeType);
  const extracted = await extractDocumentText({
    buffer,
    mimeType: params.mimeType,
    fileName: params.fileName,
  });
  const extractedPreview = truncate(extracted.text, 5000);

  try {
    const userContent: any[] = [
      {
        type: "text",
        text: [
          `文件名：${params.fileName || "未命名文档"}`,
          `业务背景：${params.context?.trim() || "未提供"}`,
          extractedPreview
            ? `已抽取正文（节选）：\n${extractedPreview}`
            : "未能稳定抽取正文，请结合文件本身和业务背景理解。",
        ].join("\n\n"),
      },
    ];

    if (params.mimeType === "application/pdf") {
      userContent.push({
        type: "file_url",
        file_url: {
          url: `data:application/pdf;base64,${params.fileBase64}`,
          mime_type: "application/pdf",
        },
      });
    }

    const response = await invokeLLM({
      model: "pro",
      provider: "vertex",
      modelName: finalModel,
      messages: [
        {
          role: "system",
          content: `你是一位创作者商业增长顾问。请分析用户上传的文档，并返回 Creator Growth Camp 所需的统一评分结构。

注意：
0. 必须优先依据“已抽取正文”做判断，不能只根据业务背景或文件名给建议。summary、strengths、improvements 里至少要有一半内容直接来自正文主题、结构或具体信息。
1. 这不是视觉审美评分，而是文档内容的增长可执行性评分。
2. 评分字段语义改写如下：
- composition: 结构质量
- color: 包装与表达潜力
- lighting: 信息清晰度
- impact: 钩子与传播张力
- viralPotential: 商业增长潜力
3. platforms 直接返回最适合首发或分发的平台名称数组。
4. strengths / improvements 用简体中文，保持具体可执行。
5. summary 要同时覆盖：内容主题、结构摘要、商业定位、受众/平台建议、成长机会、可转成 brief 的方向。

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
        {
          role: "user",
          content: userContent,
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
    return {
      analysis: growthAnalysisScoresSchema.parse(parsed),
      documentMeta: {
        fileUrl,
        extractionMethod: extracted.method,
        extractedTextPreview: extractedPreview,
        provider: response.provider || "unknown",
        model: response.model || "unknown",
        fallback: false,
      },
    };
  } catch (error) {
    console.warn("[growth.analyzeDocument] Falling back to deterministic analysis:", error);
    return {
      analysis: buildFallbackDocumentAnalysis(extracted.text, params.context || ""),
      documentMeta: {
        fileUrl,
        extractionMethod: extracted.method,
        extractedTextPreview: extractedPreview,
        provider: "fallback",
        model: "deterministic",
        fallback: true,
      },
    };
  }
}
