import { submitWavespeedPredictionRequest } from "./wavespeedWanVideo.js";
import { getWavespeedApiKey } from "./wavespeedVideoUpscale.js";

export const WAVESPEED_TRIPO_H31_IMAGE_TO_3D_PATH =
  "/api/v3/tripo3d/h3.1/image-to-3d" as const;

export type TripoH31Quality = "standard" | "detailed";
export type TripoH31TextureAlignment = "original_image" | "geometry";
export type TripoH31Orientation = "default" | "align_image";

export type WavespeedTripo3dInput = {
  image: string;
  texture?: boolean;
  pbr?: boolean;
  textureQuality?: TripoH31Quality;
  geometryQuality?: TripoH31Quality;
  textureAlignment?: TripoH31TextureAlignment;
  orientation?: TripoH31Orientation;
  autoSize?: boolean;
  quad?: boolean;
};

type WavespeedPredictionJson = {
  data?: {
    id?: string;
    status?: string;
    outputs?: unknown[];
    error?: string;
  };
  id?: string;
  status?: string;
  outputs?: unknown[];
  error?: string;
  message?: string;
};

export type WavespeedTripo3dPollSnapshot =
  | { state: "completed"; sourceGlbUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string }
  | { state: "reconcile"; error: string };

function apiBase(): string {
  return String(
    process.env.WAVESPEED_API_BASE || "https://api.wavespeed.ai"
  ).replace(/\/$/, "");
}

function pickPrediction(json: WavespeedPredictionJson) {
  const value = json?.data ?? json;
  return {
    id: String(value?.id || "").trim(),
    status: String(value?.status || "")
      .trim()
      .toLowerCase(),
    outputs: Array.isArray(value?.outputs)
      ? value.outputs.map(item => String(item || "").trim()).filter(Boolean)
      : [],
    error: String(value?.error || json?.message || "").trim(),
  };
}

export function buildWavespeedTripo3dBody(
  input: WavespeedTripo3dInput
): Record<string, unknown> {
  const image = String(input.image || "").trim();
  if (!/^https:\/\//i.test(image)) {
    throw new Error("tripo3d_source_image_must_be_https");
  }
  const texture = input.texture !== false;
  return {
    image,
    texture_alignment: input.textureAlignment || "original_image",
    orientation: input.orientation || "align_image",
    texture,
    // WaveSpeed 契约：PBR 依赖纹理；关闭纹理时必须同步关闭，不能发矛盾参数。
    pbr: texture && input.pbr !== false,
    texture_quality: input.textureQuality || "standard",
    geometry_quality: input.geometryQuality || "standard",
    auto_size: input.autoSize === true,
    quad: input.quad === true,
  };
}

export function isWavespeedTripo3dConfigured(): boolean {
  return Boolean(getWavespeedApiKey());
}

export async function submitWavespeedTripo3d(
  input: WavespeedTripo3dInput
): Promise<{ predictionId: string }> {
  return submitWavespeedPredictionRequest(
    WAVESPEED_TRIPO_H31_IMAGE_TO_3D_PATH,
    buildWavespeedTripo3dBody(input),
    "三维资产"
  );
}

function selectGlbOutput(outputs: string[]): string {
  return outputs.find(url => /\.glb(?:$|[?#])/i.test(url)) || outputs[0] || "";
}

export async function pollWavespeedTripo3dOnce(
  predictionId: string
): Promise<WavespeedTripo3dPollSnapshot> {
  const key = getWavespeedApiKey();
  if (!key) return { state: "reconcile", error: "三维资产查询通道未配置" };

  let response: Response;
  try {
    response = await fetch(
      `${apiBase()}/api/v3/predictions/${encodeURIComponent(predictionId)}/result`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(30_000),
      }
    );
  } catch (error) {
    return {
      state: "running",
      status: `transient_fetch_error:${error instanceof Error ? error.name : "unknown"}`,
    };
  }

  if (response.status === 429 || response.status >= 500) {
    return { state: "running", status: `transient_http_${response.status}` };
  }
  if ([400, 401, 403, 404, 422].includes(response.status)) {
    await response.text().catch(() => "");
    return {
      state: "reconcile",
      error: `三维资产任务状态无法确认（HTTP ${response.status}）`,
    };
  }

  const json = (await response
    .json()
    .catch(() => ({}))) as WavespeedPredictionJson;
  if (!response.ok) {
    return { state: "running", status: `transient_http_${response.status}` };
  }
  const prediction = pickPrediction(json);
  if (prediction.status === "completed" || prediction.status === "succeeded") {
    const sourceGlbUrl = selectGlbOutput(prediction.outputs);
    if (!sourceGlbUrl) {
      return { state: "failed", error: "三维资产任务完成但没有模型文件" };
    }
    return { state: "completed", sourceGlbUrl };
  }
  if (
    ["failed", "error", "cancelled", "canceled", "timeout", "deleted"].includes(
      prediction.status
    )
  ) {
    return {
      state: "failed",
      error: prediction.error || "三维资产生成失败",
    };
  }
  if (!prediction.status) {
    return { state: "running", status: "transient_empty_status" };
  }
  return { state: "running", status: prediction.status };
}
