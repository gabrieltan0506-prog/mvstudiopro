import { type GrowthAnalysisMode, type GrowthAnalysisScores } from "@shared/growth";
import { getPublicGcsHttpsUrl, signGsUriV4ReadUrl } from "../services/gcs";
import { storagePut } from "../storage";
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

async function readImageAsDataUrl(
  img: GrowthCampImageAssetInput,
  index: number,
): Promise<{ mime: "image/png" | "image/jpeg"; dataUrl: string; publicUrl: string }> {
  const mime = normalizeImageMime(img.mimeType, img.fileName);
  if (!mime) {
    throw new Error(`不支持的图片格式：${img.fileName || img.mimeType || "unknown"}`);
  }

  const gcsUri = String(img.gcsUri || "").trim();
  if (gcsUri) {
    const readUrl = signGsUriV4ReadUrl(gcsUri, 3600);
    const response = await fetch(readUrl);
    if (!response.ok) {
      throw new Error(`第 ${index + 1} 张图片读取失败（${response.status}），请重新上传后重试`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      mime,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
      publicUrl: getPublicGcsHttpsUrl(gcsUri),
    };
  }

  const base64 = String(img.fileBase64 || "").trim();
  if (!base64) {
    throw new Error(`第 ${index + 1} 张图片缺少 gcsUri 或 fileBase64`);
  }

  const buffer = Buffer.from(base64, "base64");
  const keyName = img.fileName || `image-${index + 1}.${mime === "image/png" ? "png" : "jpg"}`;
  const { url } = await storagePut(`growth-camp/images/${Date.now()}-${index}-${keyName}`, buffer, mime);
  return {
    mime,
    dataUrl: `data:${mime};base64,${base64}`,
    publicUrl: url,
  };
}

async function resolveImageVisionUrls(images: GrowthCampImageAssetInput[]) {
  const fileUrls: string[] = [];
  const visionUrls: Array<{ mime: "image/png" | "image/jpeg"; url: string }> = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const { mime, dataUrl, publicUrl } = await readImageAsDataUrl(img, i);
    fileUrls.push(publicUrl);
    visionUrls.push({ mime, url: dataUrl });
  }

  return { fileUrls, visionUrls };
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

  const { fileUrls, visionUrls } = await resolveImageVisionUrls(images);

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "high" | "auto" | "low" } }
  > = [
    {
      type: "text",
      text: [
        `用户上传了 ${images.length} 张图片（PNG/JPG），请基于画面内容做商业增长与视觉策略分析。`,
        params.context?.trim() ? `业务背景：${params.context.trim()}` : "业务背景：未提供",
        "请综合所有图片中的文字、人物、产品、场景、版式与视觉风格做判断，输出须具体、可执行，禁止空泛模板句。",
      ].join("\n\n"),
    },
  ];

  for (let i = 0; i < visionUrls.length; i++) {
    const item = visionUrls[i]!;
    userContent.push({
      type: "image_url",
      image_url: {
        url: item.url,
        detail: i < 2 ? "high" : "auto",
      },
    });
  }

  const analysis = await runGrowthCampStrategistForImages({
    userContent,
    context: params.context,
    mode: params.mode,
    modelName: params.modelName,
  });

  return {
    analysis,
    imageMeta: {
      fileUrls,
      imageCount: images.length,
      provider: "growth-camp-strategist",
      model: params.modelName || "default",
      fallback: false,
    },
  };
}
