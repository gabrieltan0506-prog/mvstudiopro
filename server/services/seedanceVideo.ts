import { buildGrowthCampVideoObjectName, signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";

export type SeedanceDurationInput = number | "auto";

/** 臨時 CDN URL → 本機拉取 → 永續桶 + V4 簽名，避免前端/過期鏈路抓不下來。 */
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
