import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { extractJsonString, invokeLLM } from "../_core/llm.js";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import { fetchSafeRemoteImage } from "./remoteImageFetch.js";

const OLD_PHOTO_BOUNDARY_MODEL = "gpt-5.6-terra" as const;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export type OldPhotoAspect = "square" | "portrait" | "landscape";

export type OldPhotoCropDecision = {
  containsPhysicalPhoto: boolean;
  confidence: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type OldPhotoCropBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type OldPhotoAutoCropResult = {
  imageUrl: string;
  aspect: OldPhotoAspect;
  applied: boolean;
  confidence: number;
  box?: OldPhotoCropBox;
  fallbackReason?: string;
};

function boundedNumber(raw: unknown, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function parseOldPhotoCropDecision(
  rawText: string
): OldPhotoCropDecision {
  const raw = JSON.parse(extractJsonString(rawText)) as Record<string, unknown>;
  return {
    containsPhysicalPhoto: raw.containsPhysicalPhoto === true,
    confidence: boundedNumber(raw.confidence, 0, 1),
    left: boundedNumber(raw.left, 0, 1000),
    top: boundedNumber(raw.top, 0, 1000),
    right: boundedNumber(raw.right, 0, 1000),
    bottom: boundedNumber(raw.bottom, 0, 1000),
  };
}

export function computeOldPhotoCropBox(
  decision: OldPhotoCropDecision,
  width: number,
  height: number
): OldPhotoCropBox | null {
  if (!decision.containsPhysicalPhoto || decision.confidence < 0.72)
    return null;
  if (width < 160 || height < 160) return null;

  const left = Math.floor((decision.left / 1000) * width);
  const top = Math.floor((decision.top / 1000) * height);
  const right = Math.ceil((decision.right / 1000) * width);
  const bottom = Math.ceil((decision.bottom / 1000) * height);
  const cropWidth = Math.min(width, right) - Math.max(0, left);
  const cropHeight = Math.min(height, bottom) - Math.max(0, top);
  const areaRatio = (cropWidth * cropHeight) / (width * height);
  const removedEdgeRatio = 1 - areaRatio;

  if (cropWidth < 160 || cropHeight < 160) return null;
  if (areaRatio < 0.12 || removedEdgeRatio < 0.025) return null;
  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: cropWidth,
    height: cropHeight,
  };
}

function aspectFor(width: number, height: number): OldPhotoAspect {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.18) return "landscape";
  if (ratio < 0.85) return "portrait";
  return "square";
}

async function fetchOldPhotoBuffer(imageUrl: string): Promise<Buffer> {
  const source = await fetchSafeRemoteImage({
    imageUrl,
    maxBytes: MAX_SOURCE_BYTES,
    userAgent: "mvstudiopro/1.0 (+old-photo-auto-crop)",
  });
  return source.buffer;
}

/**
 * 手机拍摄的纸质老照片先做无感边界识别与像素裁切；任何识别异常都回退原图，
 * 不让用户多做一步，也不让裁错图阻断付费修复。
 */
export async function autoCropOldPhoto(
  imageUrl: string,
  fallbackAspect: OldPhotoAspect
): Promise<OldPhotoAutoCropResult> {
  try {
    const source = await fetchOldPhotoBuffer(imageUrl);
    const normalized = await sharp(source, { failOn: "none" })
      .rotate()
      .toBuffer();
    const metadata = await sharp(normalized, { failOn: "none" }).metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (!width || !height) throw new Error("invalid_image_dimensions");

    const preview = await sharp(normalized, { failOn: "none" })
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const response = await invokeLLM({
      model: "pro",
      provider: "openai",
      modelName: OLD_PHOTO_BOUNDARY_MODEL,
      reasoningEffort: "low",
      max_tokens: 700,
      response_format: { type: "json_object" },
      abortSignal: AbortSignal.timeout(45_000),
      messages: [
        {
          role: "system",
          content:
            "你是照片扫描边界识别器。只识别用户上传画面中纸质照片的内容边界，不分析人物，不重绘图片。坐标按已旋正整张输入图归一化为 0 到 1000。边界应落在纸质照片的有效影像内侧，排除桌面、床单、相框、手指、白边和阴影。如果输入本身已经是完整数字照片，containsPhysicalPhoto=false。只输出 JSON。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: '输出 {"containsPhysicalPhoto":boolean,"confidence":0到1,"left":0到1000,"top":0到1000,"right":0到1000,"bottom":0到1000}。不确定时 confidence 必须低于 0.72。',
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${preview.toString("base64")}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    });
    const content = String(
      response.choices?.[0]?.message?.content || ""
    ).trim();
    const decision = parseOldPhotoCropDecision(content);
    const box = computeOldPhotoCropBox(decision, width, height);
    if (!box) {
      return {
        imageUrl,
        aspect: aspectFor(width, height) || fallbackAspect,
        applied: false,
        confidence: decision.confidence,
        fallbackReason: "boundary_not_confident",
      };
    }

    const cropped = await sharp(normalized, { failOn: "none" })
      .extract(box)
      .png()
      .toBuffer();
    if (!cropped.length) throw new Error("empty_cropped_image");
    const uploaded = await uploadBufferToGcs({
      objectName: `home-photo/auto-crop/${Date.now()}-${randomUUID()}.png`,
      buffer: cropped,
      contentType: "image/png",
    });
    return {
      imageUrl: signGsUriV4ReadUrl(uploaded.gcsUri, 60 * 60),
      aspect: aspectFor(box.width, box.height),
      applied: true,
      confidence: decision.confidence,
      box,
    };
  } catch (error) {
    console.warn("[oldPhotoAutoCrop] fallback to original", error);
    return {
      imageUrl,
      aspect: fallbackAspect,
      applied: false,
      confidence: 0,
      fallbackReason:
        error instanceof Error ? error.message : "auto_crop_failed",
    };
  }
}
