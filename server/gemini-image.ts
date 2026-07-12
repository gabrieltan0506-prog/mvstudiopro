/**
 * Vertex AI image generation（平台政策：**僅 Nano Banana 2**）。
 * **模型 ID 固定為** {@link VERTEX_NANO_BANANA_2_MODEL}`gemini-3.1-flash-image-preview`（`generateContent` + `responseModalities: IMAGE`；**不可**改用 `gemini-3-flash-image` 等未對齊本鏈的別名）。
 * 與 **`VERTEX_IMAGE_MODEL_FLASH`**（僅供 Google 端遷移時覆寫）及區域 `getVertexImageFlashLocation`。
 * 像素主路徑另可走 OhMyGPT **GPT-IMAGE-2**（見 proxyImageService）；本模組不調用 `gemini-3-pro-image-preview`。
 */
import { storagePut } from "./storage";
import { enforceSimplifiedChineseImagePrompt } from "./services/simplifiedChinese.js";
import {
  baseUrlForVertex,
  extractGeneratedImage,
  fetchRemoteAssetAsBase64,
  fetchVertexJson,
  getVertexAuthHeaders,
  getVertexImageFlashLocation,
  getVertexProjectId,
} from "./services/vertexMedia";

export type ImageQuality = "1k" | "2k" | "4k";

export interface GeminiImageOptions {
  prompt: string;
  quality: ImageQuality;
  referenceImageUrl?: string;
  negativePrompt?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  numberOfImages?: number;
  guidanceScale?: number;
  seed?: number;
  personGeneration?: "DONT_ALLOW" | "ALLOW_ADULT" | "ALLOW_ALL";
  /**
   * 可選：與 {@link proxyImageService.appendImageFlowLog} 同格式寫入，平台 jobs 前端可見「Vertex 出圖後存 Fly/GCS」步驟。
   */
  imagePersistFlowLog?: string[];
}

export interface GeminiImageResult {
  imageUrl: string;
  imageUrls?: string[];
  quality: ImageQuality;
  model?: string;
  location?: string;
}

/**
 * Vertex **Nano Banana 2** 官方（本倉）綁定模型 ID；平台出圖、proxy、TestLab 均以此為準。
 * 勿改為 `gemini-3-flash-image`；若 Google 發布新穩定 ID，應在此統一替換並回歸測試整鏈。
 */
export const VERTEX_NANO_BANANA_2_MODEL = "gemini-3.1-flash-image-preview" as const;

/** 僅 Nano Banana 2（Flash）；不串 Pro。`quality` 仍影響 Vertex `imageSize`（建議平台路徑傳 `2k`）。 */
function resolveVertexNanoImageModelAndIds(): string[] {
  const flashModel = String(process.env.VERTEX_IMAGE_MODEL_FLASH || VERTEX_NANO_BANANA_2_MODEL).trim();
  return flashModel ? [flashModel] : [VERTEX_NANO_BANANA_2_MODEL];
}

function shouldRetryVertexImage(status: number, json: any, rawText: string) {
  const message = String(json?.error?.status || json?.error?.message || rawText || "").toUpperCase();
  return status === 429 || message.includes("RESOURCE_EXHAUSTED");
}

function extFromVertexMime(mimeType: string): "jpg" | "png" | "webp" {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "png";
}

function normalizeVertexPersistContentType(mimeType: string): string {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("webp")) return "image/webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  return "image/png";
}

function appendVertexPersistLog(log: string[] | undefined, message: string): void {
  if (!log || !Array.isArray(log)) return;
  log.push(`${new Date().toISOString()}  ${message}`);
}

/**
 * 內聯像素 Buffer → 瀏覽器可讀 URL（與平台 GPT-IMAGE-2 存圖一致：Fly 公開或 GCS V4 簽名）。
 * Vertex Nano、**Gemini API Imagen** 共用；`subdir` 區分物件前綴。
 * 若先走 {@link storagePut} 到私密 R2，後續 mirror 匿名 fetch 會 403，前端也無法載入。
 */
export async function persistPlatformGeneratedImagePublicUrl(
  buffer: Buffer,
  mimeType: string,
  flowLog?: string[],
  subdir: string = "vertex_nano",
): Promise<string> {
  const ct = normalizeVertexPersistContentType(mimeType);
  const ext = extFromVertexMime(mimeType);
  const bytes = buffer.byteLength;

  const { resolvePlatformImageStorageDriver } = await import("./config/platformSwitches.js");
  const driver = resolvePlatformImageStorageDriver();
  appendVertexPersistLog(
    flowLog,
    `[Vertex·存图] 内联像素 ${bytes} bytes · ${ct} · PLATFORM_IMAGE_STORAGE=${driver}（fly=写卷+公开 URL；gcs=uploadBufferToGcs + V4 读签名 7d）`,
  );
  console.info(`[gemini-image] persist start bytes=${bytes} mime=${ct} driver=${driver}`);

  try {
    if (driver === "fly") {
      const { writeFlyPlatformImageBuffer, buildFlyPlatformImagePublicUrl } = await import(
        "./services/flyVolumeGeneratedImages.js",
      );
      const flyCt: "image/jpeg" | "image/png" | "image/webp" =
        ct === "image/webp" ? "image/webp" : ct === "image/png" ? "image/png" : "image/jpeg";
      const { relPath } = await writeFlyPlatformImageBuffer({
        subdir,
        buffer,
        contentType: flyCt,
      });
      const flyUrl = buildFlyPlatformImagePublicUrl(relPath);
      appendVertexPersistLog(
        flowLog,
        `[Vertex·存图] Fly 卷已写入 · relPath=${relPath} · 公开 URL 预览=${String(flyUrl).slice(0, 120)}…`,
      );
      console.info("[gemini-image] persist ok backend=fly", { relPath, urlPrefix: flyUrl.slice(0, 80) });
      return flyUrl;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendVertexPersistLog(flowLog, `[Vertex·存图] Fly 写入失败，改试 GCS · ${msg.slice(0, 240)}`);
    console.warn("[gemini-image] Fly persist failed, trying GCS", msg);
  }

  try {
    const { uploadBufferToGcs, signGsUriV4ReadUrl } = await import("./services/gcs.js");
    const objectName = `generated/${subdir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    appendVertexPersistLog(flowLog, `[Vertex·存图] GCS JSON API 上传开始 · object=${objectName}`);
    const { gcsUri } = await uploadBufferToGcs({
      objectName,
      buffer,
      contentType: ct,
    });
    const signedRead = await signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
    appendVertexPersistLog(
      flowLog,
      `[Vertex·存图] GCS 已上传 · ${gcsUri} · 已生成 V4 签名读链（7d）· 预览=${String(signedRead).slice(0, 120)}…`,
    );
    console.info("[gemini-image] persist ok backend=gcs", { gcsUri, signedPrefix: signedRead.slice(0, 96) });
    return signedRead;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendVertexPersistLog(flowLog, `[Vertex·存图] GCS 上传或签名失败，回退 storagePut · ${msg.slice(0, 280)}`);
    console.warn("[gemini-image] GCS persist failed, falling back to storagePut", msg);
  }

  const fileKey = `vertex-images/inline/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { url } = await storagePut(fileKey, buffer, ct);
  appendVertexPersistLog(
    flowLog,
    `[Vertex·存图] 已回退 storagePut · key=${fileKey} · url 预览=${String(url).slice(0, 100)}（若为私密桶，前端可能仍 403）`,
  );
  console.info("[gemini-image] persist fallback=storagePut", { fileKey, urlPrefix: String(url).slice(0, 80) });
  return url;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateGeminiImage(opts: GeminiImageOptions): Promise<GeminiImageResult> {
  const projectId = getVertexProjectId();
  const headers = await getVertexAuthHeaders();

  const reference = opts.referenceImageUrl
    ? await fetchRemoteAssetAsBase64(opts.referenceImageUrl)
    : null;

  // NB2 对繁体极敏感：送图前把汉字转简体 + 追加屏内字语言锁
  const promptForImage = enforceSimplifiedChineseImagePrompt(opts.prompt);

  const contents = [
    {
      role: "user",
      parts: [
        ...(reference
          ? [{ inlineData: { data: reference.base64, mimeType: reference.mimeType } }]
          : []),
        { text: promptForImage },
      ],
    },
  ];

  const modelIds = resolveVertexNanoImageModelAndIds();
  let generated: { data: string; mimeType: string }[] | null = null;
  let selectedModel = "";
  let selectedLocation = "";
  let lastError = "";

  const location = getVertexImageFlashLocation();

  for (const model of modelIds) {
    const baseUrl = baseUrlForVertex(location);
    const url = `${baseUrl}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    let response = await fetchVertexJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents,
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: opts.aspectRatio || "16:9",
            ...(typeof opts.numberOfImages === "number" ? { numberOfImages: Math.max(1, Math.min(4, Math.floor(opts.numberOfImages))) } : {}),
            ...(typeof opts.seed === "number" ? { seed: Math.floor(opts.seed) } : {}),
            ...(opts.personGeneration ? { personGeneration: opts.personGeneration } : {}),
            ...(opts.quality !== "1k" ? { imageSize: opts.quality.toUpperCase() } : {}),
          },
        },
      }),
    });

    for (let attempt = 0; attempt < 4 && shouldRetryVertexImage(response.status, response.json, response.rawText); attempt += 1) {
      await sleep((2 ** attempt) * 1000 + Math.floor(Math.random() * 300));
      response = await fetchVertexJson(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents,
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio: opts.aspectRatio || "16:9",
              ...(typeof opts.numberOfImages === "number" ? { numberOfImages: Math.max(1, Math.min(4, Math.floor(opts.numberOfImages))) } : {}),
              ...(typeof opts.seed === "number" ? { seed: Math.floor(opts.seed) } : {}),
              ...(opts.personGeneration ? { personGeneration: opts.personGeneration } : {}),
              ...(opts.quality !== "1k" ? { imageSize: opts.quality.toUpperCase() } : {}),
            },
          },
        }),
      });
    }

    if (!response.ok) {
      lastError = `model=${model} status=${response.status} raw=${response.rawText.slice(0, 300)}`;
      continue;
    }

    const parts = response.json?.candidates?.[0]?.content?.parts;
    const images = Array.isArray(parts)
      ? parts
          .filter((part: any) => part?.inlineData?.data)
          .map((part: any) => ({
            data: String(part.inlineData.data),
            mimeType: String(part.inlineData.mimeType || "image/png"),
          }))
      : [];
    if (images.length) {
      generated = images;
      selectedModel = model;
      selectedLocation = location;
      break;
    }
    lastError = `model=${model} returned no image`;
  }

  if (!generated) {
    throw new Error(`vertex_image_failed: ${lastError}`);
  }

  const imageUrls: string[] = [];
  for (let index = 0; index < generated.length; index += 1) {
    const image = generated[index];
    const buffer = Buffer.from(image.data, "base64");
    const mimeType = image.mimeType || "image/png";
    const url = await persistPlatformGeneratedImagePublicUrl(buffer, mimeType, opts.imagePersistFlowLog);
    imageUrls.push(url);
  }

  return {
    imageUrl: imageUrls[0] || "",
    imageUrls,
    quality: opts.quality,
    model: selectedModel,
    location: selectedLocation,
  };
}

export function isGeminiImageAvailable() {
  return Boolean(
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() &&
      String(process.env.VERTEX_PROJECT_ID || "").trim(),
  );
}
