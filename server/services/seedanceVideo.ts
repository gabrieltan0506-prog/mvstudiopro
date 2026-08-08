import {
  buildGrowthCampVideoObjectName,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
} from "./gcs.js";

export type SeedanceDurationInput = number | "auto";

export type SeedanceMirrorOptions = {
  requestHeaders?: Record<string, string>;
  /** 首页作品优先落长期存储；若返回私有未签名直链则必须回退 GCS V4 签名。 */
  durableStorage?: {
    keyPrefix: string;
    required?: boolean;
  };
};

/** 臨時 CDN URL → 本機拉取 → 永續桶 + V4 簽名，避免前端/過期鏈路抓不下來。 */
function isAlreadyGcsSignedReadUrl(u: string): boolean {
  const s = u.toLowerCase();
  if (!s.includes("storage.googleapis.com")) return false;
  return s.includes("x-goog-signature") || s.includes("x-goog-algorithm");
}

/**
 * 浏览器能否直接打开该视频 URL。
 * storagePut 写私有桶时会返回未签名直链 → AccessDenied（与首页照片 restored-* 同类事故）。
 */
export function isBrowserReadableVideoUrl(url: string): boolean {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (/[?&]X-Goog-(?:Signature|Algorithm)=/i.test(u)) return true;
  if (/[?&]X-Amz-Signature=/i.test(u)) return true;
  if (/\.public\.blob\.vercel-storage\.com\b/i.test(u)) return true;
  if (/[?&]op=flyVolumeMedia\b/i.test(u)) return true;
  if (/\/home-photo\//i.test(u)) return false;
  if (/^https?:\/\/storage\.googleapis\.com\//i.test(u)) return false;
  if (/polished-pond-5133/i.test(u)) return false;
  return true;
}

async function mirrorToGcsSignedReadUrl(
  buf: Buffer,
  contentType: string,
  keyHint: string,
): Promise<string> {
  const safeHint = String(keyHint || "seedance-i2v")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
  const objectName = buildGrowthCampVideoObjectName(`${safeHint || "seedance-i2v"}.mp4`);
  const { gcsUri } = await uploadBufferToGcs({
    objectName,
    buffer: buf,
    contentType,
  });
  return signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
}

export async function mirrorSeedanceMp4ToGcsSignedUrl(
  sourceVideoUrl: string,
  options?: SeedanceMirrorOptions
): Promise<string> {
  const u = String(sourceVideoUrl || "").trim();
  if (!u) throw new Error("seedance_mirror_empty_url");
  if (isAlreadyGcsSignedReadUrl(u)) return u;

  const downloadTimeoutMs = Math.min(
    600_000,
    Math.max(
      60_000,
      Number(process.env.SEEDANCE_MP4_DOWNLOAD_TIMEOUT_MS) || 300_000
    )
  );
  const durablePrefix = options?.durableStorage
    ? String(options.durableStorage.keyPrefix || "video").replace(/\/+$/, "")
    : "";
  const durableKey = durablePrefix ? `${durablePrefix}-${Date.now()}.mp4` : "";

  let lastStatus = 0;
  let durableStorageError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 2500));
    }
    const r = await fetch(u, {
      redirect: "follow",
      headers: {
        "User-Agent": "mvstudiopro/1.0 (+seedance-gcs-mirror)",
        ...(options?.requestHeaders || {}),
      },
      signal: AbortSignal.timeout(downloadTimeoutMs),
    });
    lastStatus = r.status;
    if (!r.ok) continue;

    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) continue;

    const rawCt = (r.headers.get("content-type") || "video/mp4")
      .split(";")[0]
      .trim();
    const contentType = rawCt.startsWith("video/") ? rawCt : "video/mp4";

    if (durableKey) {
      try {
        const { storagePut } = await import("../storage.js");
        const stored = await storagePut(durableKey, buf, contentType);
        const durableUrl = String(stored.url || "").trim();
        if (isBrowserReadableVideoUrl(durableUrl)) {
          return durableUrl;
        }
        durableStorageError =
          "durable storage returned private unsigned URL (browser AccessDenied)";
        console.warn(
          "[videoMirror] reject private durable URL, fallback GCS signed",
          durableUrl.slice(0, 120),
        );
      } catch (error) {
        durableStorageError =
          error instanceof Error ? error.message : "durable storage failed";
        console.error("[videoMirror] durable storage failed", error);
      }
    }

    try {
      return await mirrorToGcsSignedReadUrl(
        buf,
        contentType,
        durablePrefix || "seedance-i2v",
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "gcs_mirror_failed";
      console.error("[videoMirror] GCS signed mirror failed", msg);
      if (options?.durableStorage?.required && durableStorageError) {
        // 继续下一轮拉源；三轮后统一抛 durable / fetch 错误
        continue;
      }
      if (!options?.durableStorage?.required) {
        throw error instanceof Error ? error : new Error(msg);
      }
    }
  }

  if (durableStorageError && options?.durableStorage?.required) {
    throw new Error(`video_durable_storage_failed: ${durableStorageError}`);
  }

  throw new Error(
    `seedance_gcs_mirror_fetch_failed lastHttp=${lastStatus} url=${u.slice(0, 160)}`
  );
}

/**
 * @deprecated 请改走 `runOpenRouterSeedanceVideo`（2.0 / 2.0-fast）或探针 `runEvolinkSeedanceVideo`（Mini）。
 */
export async function runSeedanceImageToVideo(_input: {
  prompt: string;
  imageUrl: string;
  resolution: "720p" | "1080p" | "480p";
  duration: SeedanceDurationInput;
  aspectRatio: string;
  generateAudio?: boolean;
  endImageUrl?: string;
}): Promise<{ videoUrl: string; seed: number }> {
  throw new Error(
    "请配置 OPENROUTER_API_KEY 并调用 runOpenRouterSeedanceVideo（成片·标准/快速）",
  );
}
