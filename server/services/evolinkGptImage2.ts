import { resolvePlatformImageStorageDriver } from "../config/platformSwitches.js";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs.js";

function appendImageFlowLog(log: string[] | undefined, message: string): void {
  if (!log) return;
  log.push(message);
}

const EVOLINK_BASE = String(process.env.EVOLINK_API_BASE || "https://api.evolink.ai").replace(/\/$/, "");
const EVOLINK_MODEL = "gpt-image-2" as const;
/** EvoLink 默认 quality；请求方可传 `quality` 覆写（如 2×4 宽幅固定 low）。 */
const EVOLINK_DEFAULT_QUALITY = String(process.env.EVOLINK_GPT_IMAGE2_QUALITY || "medium").trim() || "medium";
const EVOLINK_RESOLUTION = String(process.env.EVOLINK_GPT_IMAGE2_RESOLUTION || "2K").trim() || "2K";
/** 与 OhMyGPT 主路径一致：竖封 1024×1536、横版 1536×1024（显式像素；resolution 在此模式下由 EvoLink 按像素预算分档）。 */
export const EVOLINK_GPT_IMAGE2_PORTRAIT_SIZE = "1024x1536" as const;
export const EVOLINK_GPT_IMAGE2_LANDSCAPE_SIZE = "1536x1024" as const;

/** EvoLink 任务轮询：默认 2s（原 3s）；可用 EVOLINK_GPT_IMAGE2_POLL_MS 覆写，范围 1000～5000。 */
const POLL_INTERVAL_MS = Math.min(
  Math.max(Number(process.env.EVOLINK_GPT_IMAGE2_POLL_MS) || 2000, 1000),
  5000,
);
const REQUEST_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.EVOLINK_GPT_IMAGE2_TIMEOUT_MS) || 600_000, 60_000),
  900_000,
);
const MAX_POLL_MS = REQUEST_TIMEOUT_MS;

export function isEvolinkGptImage2Configured(): boolean {
  return Boolean(String(process.env.EVOLINK_API_KEY || "").trim());
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sniffBinaryImageMime(buffer: Buffer): "image/png" | "image/jpeg" {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  return "image/png";
}

function resolveEvolinkSize(aspectRatio: "9:16" | "16:9", explicitSize?: string): string {
  const custom = String(explicitSize || "").trim();
  if (custom) return custom;
  return aspectRatio === "16:9" ? EVOLINK_GPT_IMAGE2_LANDSCAPE_SIZE : EVOLINK_GPT_IMAGE2_PORTRAIT_SIZE;
}

/** 显式 WxH 时 EvoLink 忽略 resolution；比例模式才传 resolution（默认 2K）。 */
function buildEvolinkRequestBody(
  prompt: string,
  size: string,
  quality: string,
  imageUrls?: string[],
  maskUrl?: string,
): Record<string, unknown> {
  const isRatio = size.includes(":");
  const body: Record<string, unknown> = {
    model: EVOLINK_MODEL,
    prompt,
    size,
    quality,
    n: 1,
  };
  if (isRatio) {
    body.resolution = EVOLINK_RESOLUTION;
  }
  // image-to-image / edit：附参考图（1~16 张，URL 须服务器可直接抓取）。
  const refs = (imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean).slice(0, 16);
  if (refs.length > 0) {
    body.image_urls = refs;
    const mask = String(maskUrl || "").trim();
    if (mask) body.mask_url = mask;
  }
  return body;
}

type EvolinkTaskDetail = {
  id?: string;
  status?: string;
  progress?: number;
  results?: string[];
  error?: { code?: string; message?: string };
};

async function pollEvolinkTask(taskId: string, flowLog?: string[]): Promise<string[]> {
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  const started = Date.now();
  let lastStatus = "";

  while (Date.now() - started < MAX_POLL_MS) {
    const r = await fetch(`${EVOLINK_BASE}/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await r.json().catch(() => ({}))) as EvolinkTaskDetail;
    if (!r.ok) {
      const msg = json?.error?.message || JSON.stringify(json).slice(0, 300);
      throw new Error(`EvoLink task poll HTTP ${r.status}: ${msg}`);
    }

    const status = String(json.status || "").trim();
    if (status !== lastStatus) {
      lastStatus = status;
      appendImageFlowLog(
        flowLog,
        `[GPT-IMAGE-2·EvoLink] 任务 ${taskId} · status=${status || "?"} · progress=${json.progress ?? "?"}%`,
      );
    }

    if (status === "completed") {
      const urls = (json.results || []).filter((u) => typeof u === "string" && u.trim());
      if (!urls.length) throw new Error("EvoLink task completed but results[] empty");
      return urls;
    }
    if (status === "failed") {
      const err = json.error?.message || json.error?.code || "unknown";
      throw new Error(`EvoLink task failed: ${err}`);
    }

    await sleepMs(POLL_INTERVAL_MS);
  }
  throw new Error(`EvoLink task poll timeout after ${MAX_POLL_MS}ms · taskId=${taskId}`);
}

async function downloadEvolinkImage(url: string): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`EvoLink image download HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

export async function uploadBufferToPlatformStorage(
  buffer: Buffer,
  gcsSubdir: string,
  flowLog?: string[],
): Promise<string> {
  const mime = sniffBinaryImageMime(buffer);
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  const driver = resolvePlatformImageStorageDriver();

  if (driver === "fly") {
    const { writeFlyPlatformImageBuffer, buildFlyPlatformImagePublicUrl } = await import(
      "./flyVolumeGeneratedImages.js"
    );
    const flyCt: "image/jpeg" | "image/png" = mime === "image/jpeg" ? "image/jpeg" : "image/png";
    const { relPath } = await writeFlyPlatformImageBuffer({
      subdir: gcsSubdir,
      buffer,
      contentType: flyCt,
    });
    const flyUrl = buildFlyPlatformImagePublicUrl(relPath);
    appendImageFlowLog(flowLog, `[GPT-IMAGE-2·EvoLink] 已写入 Fly 卷 · relPath=${relPath}`);
    return flyUrl;
  }

  const path = `generated/${gcsSubdir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { gcsUri } = await uploadBufferToGcs({ objectName: path, buffer, contentType: mime });
  const signedUrl = await signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
  appendImageFlowLog(flowLog, `[GPT-IMAGE-2·EvoLink] 已上传 GCS · gcsUri=${gcsUri}`);
  return signedUrl;
}

/**
 * EvoLink `gpt-image-2`：异步创建任务 → 轮询 → 下载 → GCS/Fly。
 * 需环境变量 `EVOLINK_API_KEY`（https://evolink.ai/dashboard/keys）。
 */
export async function postEvolinkGptImage2AndUpload(
  prompt: string,
  gcsSubdir: string,
  opts: {
    aspectRatio?: "9:16" | "16:9";
    size?: string;
    flowLog?: string[];
    /** 覆写 EvoLink quality；未传则用 EVOLINK_GPT_IMAGE2_QUALITY（默认 medium） */
    quality?: string;
    /** image-to-image / edit：参考图 URL（1~16 张，须公网可直接抓取）。换脸/换人时传上传的人像 URL。 */
    imageUrls?: string[];
    /** 局部重绘遮罩 PNG（alpha 通道）URL，仅在传了 imageUrls 时生效。 */
    maskUrl?: string;
    /**
     * 出参：失败时回填原始错误信息，供上层判断是否为「内容审核误判」并触发澄清重试。
     * 成功返回非空 URL 时不写入；仅在返回 null 时由本函数填充 `message`。
     */
    captureError?: { message?: string };
  } = {},
): Promise<string | null> {
  const L = opts.flowLog;
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) {
    appendImageFlowLog(L, "[GPT-IMAGE-2·EvoLink] EVOLINK_API_KEY 缺失，跳过 EvoLink");
    return null;
  }

  const aspectRatio = opts.aspectRatio ?? "9:16";
  const size = resolveEvolinkSize(aspectRatio, opts.size);
  const quality = String(opts.quality || EVOLINK_DEFAULT_QUALITY).trim() || EVOLINK_DEFAULT_QUALITY;
  const promptTrimmed = String(prompt || "").trim();
  if (!promptTrimmed) {
    appendImageFlowLog(L, "[GPT-IMAGE-2·EvoLink] prompt 为空，跳过");
    return null;
  }

  const refImageUrls = (opts.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean).slice(0, 16);
  appendImageFlowLog(
    L,
    `[GPT-IMAGE-2·EvoLink] POST ${EVOLINK_BASE}/v1/images/generations · size=${size} · quality=${quality}${size.includes(":") ? ` · resolution=${EVOLINK_RESOLUTION}` : ""}${refImageUrls.length ? ` · edit模式·参考图=${refImageUrls.length}张` : ""}`,
  );

  try {
    const createRes = await fetch(`${EVOLINK_BASE}/v1/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildEvolinkRequestBody(promptTrimmed, size, quality, refImageUrls, opts.maskUrl)),
      signal: AbortSignal.timeout(60_000),
    });
    const createJson = (await createRes.json().catch(() => ({}))) as EvolinkTaskDetail & {
      error?: { message?: string };
    };
    if (!createRes.ok) {
      const msg = createJson?.error?.message || JSON.stringify(createJson).slice(0, 400);
      appendImageFlowLog(L, `[GPT-IMAGE-2·EvoLink] 创建任务失败 · HTTP ${createRes.status} · ${msg}`);
      console.warn("[evolinkGptImage2] create failed:", createRes.status, msg);
      if (opts.captureError) opts.captureError.message = String(msg);
      return null;
    }

    const taskId = String(createJson.id || "").trim();
    if (!taskId) {
      appendImageFlowLog(L, "[GPT-IMAGE-2·EvoLink] 创建响应无 task id");
      return null;
    }
    appendImageFlowLog(L, `[GPT-IMAGE-2·EvoLink] 任务已创建 · id=${taskId} · 开始轮询…`);

    const resultUrls = await pollEvolinkTask(taskId, L);
    const imageUrl = resultUrls[0];
    appendImageFlowLog(L, `[GPT-IMAGE-2·EvoLink] 生图完成 · 下载 ${String(imageUrl).slice(0, 120)}…`);
    const buffer = await downloadEvolinkImage(imageUrl);
    const publicUrl = await uploadBufferToPlatformStorage(buffer, gcsSubdir, L);
    appendImageFlowLog(L, `[GPT-IMAGE-2·EvoLink] 成功 · 公开 URL 预览：${String(publicUrl).slice(0, 180)}…`);
    return publicUrl;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendImageFlowLog(L, `[GPT-IMAGE-2·EvoLink] 异常 · ${msg}`);
    console.warn("[evolinkGptImage2] exception:", msg);
    if (opts.captureError) opts.captureError.message = msg;
    return null;
  }
}

/**
 * 判断 EvoLink 失败信息是否属于「内容审核拦截」（而非鉴权/网络/超时等）。
 * 命中后上层可对**良性人像**附澄清语境（成年、著装得体、本人/已授权编辑肖像）重试一次，降低误杀；
 * 不命中则视为可正常 fallback / 重试的传输类错误。
 */
export function isEvolinkModerationFailure(message: string | undefined): boolean {
  const m = String(message || "").toLowerCase();
  if (!m) return false;
  return (
    m.includes("inappropriate") ||
    m.includes("moderation") ||
    m.includes("content policy") ||
    m.includes("safety") ||
    m.includes("violat") ||
    m.includes("not allowed") ||
    m.includes("敏感") ||
    m.includes("违规") ||
    m.includes("审核")
  );
}
