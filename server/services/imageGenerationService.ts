/**
 * Vertex AI 企業版 Imagen 生圖（`aiplatform…:predict`）。
 *
 * **與 AI Studio / Consumer（`generativelanguage…:predict?key=`）的差異**（Payload 可共用 `instances` + `parameters`）：
 * - **認證**：Vertex **不**使用 `GEMINI_API_KEY`；須 **IAM → 短效 OAuth2 Bearer**（`GOOGLE_APPLICATION_CREDENTIALS_JSON` 或 `GOOGLE_APPLICATION_CREDENTIALS` 服務帳號），見 `server/utils/vertex.ts`。
 * - **端點**：`https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predict`（**非** `generativelanguage.googleapis.com`）。
 * - **專案 / 區域**：`VERTEX_PROJECT_ID` 或 `GOOGLE_CLOUD_PROJECT`，以及 `VERTEX_IMAGEN_LOCATION`（預設 `us-central1`）。
 *
 * 套件：`@google-cloud/vertexai` 主要面向 Gemini；此處 Imagen 與 `vertexImage.ts` 一致採 **REST `fetch` + Bearer**，避免誤用 `generateContent` 請求體。
 *
 * 測試策略：**不作 Ultra → Standard 自動降級**；失敗即回傳錯誤，便於對照企業節點與 IAM。
 */
import { getVertexAccessToken } from "../utils/vertex";

function s(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function jparse(t: string) {
  try {
    return JSON.parse(t) as any;
  } catch {
    return null;
  }
}

function baseUrlFor(location: string) {
  return location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
}

export type ImagenVertexPredictArgs = {
  prompt: string;
  /** 例如 imagen-4.0-ultra-generate-001（與 Consumer 側實測可用 ID 對齊） */
  model: string;
  aspectRatio?: string;
  imageSize?: string;
  numberOfImages?: number;
  seed?: number;
  /** generativelanguage predict 的小寫枚舉值，如 allow_adult */
  personGeneration?: string;
  guidanceScale?: number;
};

export type ImagenVertexPredictResult = {
  ok: boolean;
  status: number;
  model: string;
  location: string;
  url: string;
  raw?: any;
  imageUrl: string;
  imageUrls: string[];
  imageCount: number;
  error?: string;
};

function extractPredictImages(raw: any): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  const predictions = Array.isArray(raw?.predictions) ? raw.predictions : [];
  for (const item of predictions) {
    const data = s(item?.bytesBase64Encoded || item?.image?.bytesBase64Encoded || item?.b64Json).trim();
    if (data) {
      images.push({
        data,
        mimeType: s(item?.mimeType || item?.image?.mimeType || "image/png").trim() || "image/png",
      });
    }
  }
  return images;
}

function shouldRetryRateLimit(status: number, json: any, rawText: string) {
  const message = String(json?.error?.status || json?.error?.message || rawText || "").toUpperCase();
  return status === 429 || message.includes("RESOURCE_EXHAUSTED");
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * 單一路徑：指定模型 + `us-central1`（可 env 覆寫）調用 `:predict`，無降級。
 */
export async function generateImagenVertexPredict(args: ImagenVertexPredictArgs): Promise<ImagenVertexPredictResult> {
  const projectId = s(process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT).trim();
  const location = (s(process.env.VERTEX_IMAGEN_LOCATION) || "us-central1").trim();
  const model = s(args.model).trim();
  const prompt = s(args.prompt).trim();

  if (!projectId) {
    return {
      ok: false,
      status: 500,
      model,
      location,
      url: "",
      error: "missing_VERTEX_PROJECT_ID_or_GOOGLE_CLOUD_PROJECT",
      imageUrl: "",
      imageUrls: [],
      imageCount: 0,
    };
  }
  if (!model || !prompt) {
    return {
      ok: false,
      status: 400,
      model,
      location,
      url: "",
      error: "missing_model_or_prompt",
      imageUrl: "",
      imageUrls: [],
      imageCount: 0,
    };
  }

  let token: string;
  try {
    token = await getVertexAccessToken();
  } catch (e: any) {
    return {
      ok: false,
      status: 500,
      model,
      location,
      url: "",
      error: e?.message || "vertex_token_failed",
      imageUrl: "",
      imageUrls: [],
      imageCount: 0,
    };
  }

  const aspectRatio = s(args.aspectRatio || "1:1");
  const sizeU = s(args.imageSize || "1K").toUpperCase();
  const sampleCount = Math.max(1, Math.min(4, Number(args.numberOfImages) || 1));
  const seed = args.seed;
  const personGeneration = s(args.personGeneration || "");
  const guidanceScale = args.guidanceScale;

  const parameters: Record<string, unknown> = {
    sampleCount,
    aspectRatio,
    addWatermark: false,
  };
  if (sizeU === "1K" || sizeU === "2K" || sizeU === "4K") parameters.imageSize = sizeU;
  if (Number.isFinite(seed as number)) parameters.seed = Math.floor(seed as number);
  if (personGeneration) parameters.personGeneration = personGeneration;
  if (Number.isFinite(guidanceScale as number)) parameters.guidanceScale = Number(guidanceScale);

  const base = baseUrlFor(location);
  const predictUrl = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

  const requestInit: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters,
    }),
    signal: AbortSignal.timeout(120_000),
  };

  let r = await fetch(predictUrl, requestInit);
  let text = await r.text();
  let json = jparse(text);

  for (let attempt = 0; attempt < 4 && shouldRetryRateLimit(r.status, json, text); attempt += 1) {
    await sleep(2 ** attempt * 1000 + Math.floor(Math.random() * 300));
    r = await fetch(predictUrl, requestInit);
    text = await r.text();
    json = jparse(text);
  }

  const raw = json ?? text;
  if (!r.ok) {
    const errMsg =
      json?.error?.message || json?.error?.status || text?.slice(0, 2000) || `HTTP ${r.status}`;
    return {
      ok: false,
      status: r.status,
      model,
      location,
      url: predictUrl,
      raw,
      error: String(errMsg),
      imageUrl: "",
      imageUrls: [],
      imageCount: 0,
    };
  }

  const images = extractPredictImages(json);
  const imageUrls = images.map((item) => `data:${item.mimeType};base64,${item.data}`);
  return {
    ok: true,
    status: r.status,
    model,
    location,
    url: predictUrl,
    raw,
    imageUrl: imageUrls[0] || "",
    imageUrls,
    imageCount: imageUrls.length,
  };
}

/**
 * 戰略封面用 prompt 的單次生成（**僅測 Vertex**，不寫庫、不 fire-and-forget）。
 * 預設與需求一致的豎版比例；模型固定為當前 Consumer 側驗證過的 Ultra ID。
 */
export async function generateStrategicCoverVertex(
  prompt: string,
  _creationId?: number,
): Promise<string | null> {
  const model =
    s(process.env.VERTEX_IMAGEN_ULTRA_MODEL || "imagen-4.0-ultra-generate-001").trim() ||
    "imagen-4.0-ultra-generate-001";
  const r = await generateImagenVertexPredict({
    prompt,
    model,
    aspectRatio: "9:16",
    imageSize: "2K",
    numberOfImages: 1,
  });
  return r.ok && r.imageUrl ? r.imageUrl : null;
}
