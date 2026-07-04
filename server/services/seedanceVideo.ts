import { fal } from "@fal-ai/client";
import { buildGrowthCampVideoObjectName, signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";

export type SeedanceDurationInput = number | "auto";

function normalizeDurationParam(d: SeedanceDurationInput): "auto" | `${number}` {
  if (d === "auto") return "auto";
  const n = Math.floor(Number(d));
  const clamped = Math.min(15, Math.max(4, Number.isFinite(n) ? n : 8));
  return String(clamped) as `${number}`;
}

/** fal.queue.result / subscribe 回傳的 data 各版 schema；優先取可直接下載的 https URL */
function extractSeedanceVideoUrl(data: unknown): string {
  const tryVideoField = (v: unknown): string => {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v.trim();
    if (v && typeof v === "object" && "url" in v && typeof (v as { url: unknown }).url === "string") {
      const u = String((v as { url: string }).url).trim();
      if (/^https?:\/\//i.test(u)) return u;
    }
    return "";
  };

  const walk = (node: unknown, depth: number): string => {
    if (depth > 4 || node == null) return "";

    if (Array.isArray(node)) {
      for (const item of node) {
        const u = walk(item, depth + 1);
        if (u) return u;
      }
      return "";
    }

    if (typeof node !== "object") return "";

    const o = node as Record<string, unknown>;

    const direct =
      tryVideoField(o.video) ||
      (typeof o.video_url === "string" && /^https?:\/\//i.test(o.video_url) ? o.video_url.trim() : "");
    if (direct) return direct;

    if (o.output && typeof o.output === "object") {
      const nested = walk(o.output, depth + 1);
      if (nested) return nested;
    }

    if (o.data && typeof o.data === "object") {
      const nested = walk(o.data, depth + 1);
      if (nested) return nested;
    }

    return "";
  };

  return walk(data, 0);
}

function seedanceSubscribeTimeoutMs(): number {
  const raw = Number(process.env.FAL_SEEDANCE_SUBSCRIBE_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 120_000) return Math.min(raw, 1_200_000);
  return 900_000;
}

/** 與 fal GPT-image-2 {@link mirrorImageUrlToGcsSignedUrl} 同款思路：臨時 CDN URL → 本機拉取 → 永續桶 + V4 簽名，避免前端/過期鏈路抓不下來。 */
function isAlreadyGcsSignedReadUrl(u: string): boolean {
  const s = u.toLowerCase();
  if (!s.includes("storage.googleapis.com")) return false;
  return s.includes("x-goog-signature") || s.includes("x-goog-algorithm");
}

export async function mirrorSeedanceMp4ToGcsSignedUrl(sourceVideoUrl: string): Promise<string> {
  const u = String(sourceVideoUrl || "").trim();
  if (!u) throw new Error("seedance_mirror_empty_url");
  if (isAlreadyGcsSignedReadUrl(u)) return u;

  const downloadTimeoutMs = Math.min(
    600_000,
    Math.max(60_000, Number(process.env.SEEDANCE_MP4_DOWNLOAD_TIMEOUT_MS) || 300_000),
  );

  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2500));
    }
    const r = await fetch(u, {
      redirect: "follow",
      headers: { "User-Agent": "mvstudiopro/1.0 (+seedance-gcs-mirror)" },
      signal: AbortSignal.timeout(downloadTimeoutMs),
    });
    lastStatus = r.status;
    if (!r.ok) continue;

    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) continue;

    const rawCt = (r.headers.get("content-type") || "video/mp4").split(";")[0].trim();
    const contentType = rawCt.startsWith("video/") ? rawCt : "video/mp4";
    const objectName = buildGrowthCampVideoObjectName(`seedance-i2v-${Date.now()}.mp4`);
    const { gcsUri } = await uploadBufferToGcs({ objectName, buffer: buf, contentType });
    return signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
  }

  throw new Error(`seedance_gcs_mirror_fetch_failed lastHttp=${lastStatus} url=${u.slice(0, 160)}`);
}

async function runSeedanceImageToVideoArk(
  input: {
    prompt: string;
    imageUrl: string;
    resolution: "720p" | "1080p";
    duration: SeedanceDurationInput;
    aspectRatio: string;
    generateAudio?: boolean;
    endImageUrl?: string;
  },
  arkKey: string,
): Promise<{ videoUrl: string; seed: number }> {
  const content: any[] = [
    { type: "text", text: input.prompt },
    { type: "image_url", image_url: { url: input.imageUrl }, role: "reference_image" },
  ];
  if (input.endImageUrl) {
    content.push({ type: "image_url", image_url: { url: input.endImageUrl }, role: "reference_image" });
  }

  const durationNum = input.duration === "auto" ? 10 : Number(input.duration);
  const ratio = input.aspectRatio === "auto" ? "16:9" : input.aspectRatio;

  const createRes = await fetch("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${arkKey}`,
    },
    body: JSON.stringify({
      model: "doubao-seedance-2-0-260128",
      content,
      generate_audio: input.generateAudio !== false,
      ratio,
      duration: durationNum,
      watermark: false,
    }),
  });

  const createJson = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    throw new Error(`Ark API create task failed: HTTP ${createRes.status} ${JSON.stringify(createJson)}`);
  }

  const taskId = String(createJson.id || createJson.data?.id || "").trim();
  if (!taskId) {
    throw new Error(`Ark API missing task id: ${JSON.stringify(createJson)}`);
  }

  const timeoutMs = seedanceSubscribeTimeoutMs();
  const startTime = Date.now();
  let delay = 5000;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 30000);

    const pollRes = await fetch(
      `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${arkKey}`,
          Accept: "application/json",
        },
      },
    );

    if (!pollRes.ok) {
      if (pollRes.status >= 500 || pollRes.status === 429) continue;
      throw new Error(`Ark API poll failed: HTTP ${pollRes.status}`);
    }

    const pollJson = await pollRes.json().catch(() => ({}));
    const status = String(pollJson.status || pollJson.data?.status || "").toLowerCase();

    if (status === "succeeded") {
      const sourceVideoUrl = extractSeedanceVideoUrl(pollJson);
      if (!sourceVideoUrl) {
        throw new Error(`Ark API succeeded but no video_url found: ${JSON.stringify(pollJson)}`);
      }
      const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(sourceVideoUrl);
      return { videoUrl, seed: 0 };
    }

    if (status === "failed" || status === "expired" || status === "cancelled") {
      throw new Error(`Ark API task ${status}: ${JSON.stringify(pollJson)}`);
    }
  }

  throw new Error(`Ark API timed out after ${timeoutMs}ms`);
}

/**
 * ByteDance Seedance 2.0 image-to-video（fal）。
 *
 * - `fal.subscribe` 默認等足夠長（15min，可 `FAL_SEEDANCE_SUBSCRIBE_TIMEOUT_MS`），避免雲側已完成但本機輪詢提前放棄。
 * - 解析多種 `video` / 嵌套 `output` 形狀，降低 `seedance_missing_video_url`。
 * - **產物 URL**：與 GPT-image-2（fal）一致，將 fal 臨時視頻 URL **鏡像寫入 GCS** 後回傳 **V4 簽名讀鏈**（7 天），避免只回 fal 直鏈導致前端或過期無法播放。
 */
export async function runSeedanceImageToVideo(input: {
  prompt: string;
  imageUrl: string;
  resolution: "720p" | "1080p";
  duration: SeedanceDurationInput;
  aspectRatio: string;
  generateAudio?: boolean;
  endImageUrl?: string;
}): Promise<{ videoUrl: string; seed: number }> {
  const arkKey = String(process.env.VOLCENGINE_ARK_API_KEY || process.env.ARK_API_KEY || "").trim();
  if (arkKey) {
    try {
      return await runSeedanceImageToVideoArk(input, arkKey);
    } catch (e) {
      console.warn("[runSeedanceImageToVideo] Ark API failed, falling back to fal", e);
      // Fallback to fal if FAL_KEY exists
    }
  }

  const key = String(process.env.FAL_KEY || process.env.FAL_API_KEY || "").trim();
  if (!key) {
    if (arkKey) throw new Error("Ark API failed and FAL_KEY is not configured");
    throw new Error("FAL_KEY is required for Seedance image-to-video");
  }
  fal.config({ credentials: key });

  const aspect = String(input.aspectRatio || "auto").trim() || "auto";

  const result = await fal.subscribe("bytedance/seedance-2.0/image-to-video", {
    input: {
      prompt: input.prompt,
      image_url: input.imageUrl,
      ...(input.endImageUrl ? { end_image_url: input.endImageUrl } : {}),
      resolution: input.resolution,
      duration: normalizeDurationParam(input.duration),
      aspect_ratio: aspect,
      generate_audio: input.generateAudio !== false,
    },
    logs: false,
    timeout: seedanceSubscribeTimeoutMs(),
    pollInterval: 1500,
  });

  const requestId = String(result.requestId || "").trim();
  const data: unknown = result.data;
  const falVideoUrl = extractSeedanceVideoUrl(data);
  const seed = Number(
    (data && typeof data === "object" && "seed" in data ? (data as { seed: unknown }).seed : null) ?? 0,
  );

  if (!falVideoUrl) {
    const keys =
      data && typeof data === "object" && !Array.isArray(data)
        ? Object.keys(data as object).join(",")
        : typeof data;
    throw new Error(
      `seedance_missing_video_url requestId=${requestId || "?"} dataKeys=${keys || "?"}`,
    );
  }

  const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(falVideoUrl);
  return { videoUrl, seed };
}
