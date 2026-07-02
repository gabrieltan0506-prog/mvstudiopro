import { type GrowthAnalysisMode, type GrowthAnalysisScores } from "@shared/growth";
import { getPublicGcsHttpsUrl, signGsUriV4ReadUrl, uploadBufferToGcs } from "../services/gcs";
import { resolveGrowthCampExtractScanEngine } from "./extractorPipeline";
import { runGrowthCampStrategistForImages } from "./growthCampStrategistPass";

export type GrowthCampImageAssetInput = {
  /** @deprecated 优先使用 gcsUri（客户端 GCS 直传，避免 tRPC 请求体过大） */
  fileBase64?: string;
  gcsUri?: string;
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
    /** true = 主模型失败后由 Gemini 3.5 Flash 重试成功 */
    fallback: boolean;
    primaryError?: string;
  };
};

type ImageVisionRef = {
  mime: "image/png" | "image/jpeg";
  gcsUri: string;
  signedReadUrl: string;
  publicUrl: string;
};

type VisionUserContent = Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "high" | "auto" | "low" } }
>;

function normalizeImageMime(mimeType: string, fileName?: string): "image/png" | "image/jpeg" | null {
  const mime = String(mimeType || "").trim().toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (mime === "image/png" || name.endsWith(".png")) return "image/png";
  if (mime === "image/jpeg" || mime === "image/jpg" || /\.jpe?g$/i.test(name)) return "image/jpeg";
  return null;
}

async function ensureGcsUri(
  img: GrowthCampImageAssetInput,
  index: number,
  mime: "image/png" | "image/jpeg",
): Promise<string> {
  const existing = String(img.gcsUri || "").trim();
  if (existing) return existing;

  const base64 = String(img.fileBase64 || "").trim();
  if (!base64) {
    throw new Error(`第 ${index + 1} 张图片缺少 gcsUri 或 fileBase64`);
  }

  const buffer = Buffer.from(base64, "base64");
  const keyName = img.fileName || `image-${index + 1}.${mime === "image/png" ? "png" : "jpg"}`;
  const uploaded = await uploadBufferToGcs({
    objectName: `growth-camp/images/${Date.now()}-${index}-${keyName}`,
    buffer,
    contentType: mime,
  });
  return uploaded.gcsUri;
}

/** 解析为 GCS 引用 + 短时签名 HTTPS 直链（不在服端转 base64） */
async function resolveImageVisionRefs(images: GrowthCampImageAssetInput[]): Promise<ImageVisionRef[]> {
  const refs: ImageVisionRef[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const mime = normalizeImageMime(img.mimeType, img.fileName);
    if (!mime) {
      throw new Error(`不支持的图片格式：${img.fileName || img.mimeType || "unknown"}`);
    }

    const gcsUri = await ensureGcsUri(img, i, mime);
    refs.push({
      mime,
      gcsUri,
      signedReadUrl: signGsUriV4ReadUrl(gcsUri, 3600),
      publicUrl: getPublicGcsHttpsUrl(gcsUri),
    });
  }

  return refs;
}

function buildAnalysisPromptText(imageCount: number, context?: string): string {
  return [
    `用户上传了 ${imageCount} 张图片（PNG/JPG），请基于画面内容做商业增长与视觉策略分析。`,
    context?.trim() ? `业务背景：${context.trim()}` : "业务背景：未提供",
    "请综合所有图片中的文字、人物、产品、场景、版式与视觉风格做判断，输出须具体、可执行，禁止空泛模板句。",
  ].join("\n\n");
}

/** Evolink / GPT：传签名 HTTPS 直链，由上游自行拉取，请求体不含 base64 */
function buildOpenAiVisionUserContent(refs: ImageVisionRef[], context?: string): VisionUserContent {
  const userContent: VisionUserContent = [
    { type: "text", text: buildAnalysisPromptText(refs.length, context) },
  ];

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!;
    userContent.push({
      type: "image_url",
      image_url: {
        url: ref.signedReadUrl,
        detail: i < 2 ? "high" : "auto",
      },
    });
  }

  return userContent;
}

/** Vertex Gemini fallback：传 gs:// URI，由 Vertex 直读 GCS，不经服端 base64 */
function buildVertexVisionUserContent(refs: ImageVisionRef[], context?: string): VisionUserContent {
  const userContent: VisionUserContent = [
    { type: "text", text: buildAnalysisPromptText(refs.length, context) },
  ];

  for (let i = 0; i < refs.length; i++) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: refs[i]!.gcsUri,
        detail: i < 2 ? "high" : "auto",
      },
    });
  }

  return userContent;
}

function formatAnalysisError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function analyzeGrowthCampImages(params: {
  images: GrowthCampImageAssetInput[];
  context?: string;
  modelName?: string;
  mode?: GrowthAnalysisMode;
}): Promise<GrowthCampImageAnalysisResult> {
  const images = (params.images || []).filter(
    (img) => String(img.gcsUri || "").trim() || String(img.fileBase64 || "").trim(),
  );
  if (!images.length) {
    throw new Error("请至少上传一张 PNG 或 JPG 图片");
  }

  const refs = await resolveImageVisionRefs(images);
  const fileUrls = refs.map((ref) => ref.publicUrl);
  const openAiUserContent = buildOpenAiVisionUserContent(refs, params.context);
  const vertexUserContent = buildVertexVisionUserContent(refs, params.context);
  const primaryModel = params.modelName || "gpt-5.5";

  let analysis: GrowthAnalysisScores;
  let fallback = false;
  let provider = "growth-camp-strategist";
  let model = primaryModel;
  let primaryError: string | undefined;

  try {
    analysis = await runGrowthCampStrategistForImages({
      userContent: openAiUserContent,
      context: params.context,
      mode: params.mode,
      modelName: primaryModel,
    });
  } catch (primaryFailure: unknown) {
    primaryError = formatAnalysisError(primaryFailure);
    console.warn("[growth.analyzeGrowthCampImages] primary failed, retry Gemini 3.5 Flash:", primaryError);

    const geminiEngine = resolveGrowthCampExtractScanEngine();
    try {
      analysis = await runGrowthCampStrategistForImages({
        userContent: vertexUserContent,
        context: params.context,
        mode: params.mode,
        strategistEngine: geminiEngine,
      });
    } catch (fallbackFailure: unknown) {
      console.warn("[growth.analyzeGrowthCampImages] fallback failed:", formatAnalysisError(fallbackFailure));
      throw new Error("图片分析失败，请稍后重试");
    }

    fallback = true;
    provider = "vertex-gemini-flash-fallback";
    model = geminiEngine.modelName;
  }

  return {
    analysis,
    imageMeta: {
      fileUrls,
      imageCount: images.length,
      provider,
      model,
      fallback,
      primaryError: fallback ? primaryError : undefined,
    },
  };
}
