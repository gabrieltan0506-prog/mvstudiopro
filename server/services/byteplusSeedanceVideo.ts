/**
 * BytePlus ModelArk · Seedance 2.5 成片（画布主路径）。
 * 提交失败由 canvasVideoTask 回落 EvoLink。
 */

import {
  BYTEPLUS_ARK_API_BASE_DEFAULT,
  BYTEPLUS_SEEDANCE_25_MODEL_ID,
  clampByteplusSeedance25Duration,
  normalizeByteplusRatio,
  type ByteplusSeedance25Mode,
} from "../../shared/byteplusSeedanceModels.js";
import {
  clampSeedanceDuration,
  inferSeedanceMode,
  type SeedanceEvolinkMode,
} from "../../shared/seedanceEvolinkModels.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";

const POLL_INTERVAL_MS = 4000;
// 与 EvoLink 同口径：实测 4K 要 968s，900s 默认线会误杀；默认 1500s、帽 3600s
const MAX_POLL_MS = Math.min(
  Math.max(Number(process.env.BYTEPLUS_SEEDANCE_POLL_TIMEOUT_MS) || 1_500_000, 120_000),
  3_600_000,
);

export function getByteplusArkApiKey(): string {
  return (
    String(process.env.BYTEPLUS_ARK_API_KEY || "").trim() ||
    String(process.env.ARK_API_KEY || "").trim()
  );
}

export function getByteplusArkApiBase(): string {
  return String(process.env.BYTEPLUS_ARK_API_BASE || BYTEPLUS_ARK_API_BASE_DEFAULT).replace(
    /\/$/,
    "",
  );
}

export function getByteplusSeedance25ModelId(): string {
  return (
    String(process.env.BYTEPLUS_SEEDANCE_25_MODEL || "").trim() || BYTEPLUS_SEEDANCE_25_MODEL_ID
  );
}

export function isByteplusSeedanceConfigured(): boolean {
  return Boolean(getByteplusArkApiKey());
}

export type ByteplusSeedanceRunInput = {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  /** 480p / 720p / 1080p；缺省交由上游默认 */
  resolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  mode?: SeedanceEvolinkMode | ByteplusSeedance25Mode;
};

type ByteplusTaskJson = {
  id?: string;
  status?: string;
  model?: string;
  content?: { video_url?: string } | Array<{ type?: string; video_url?: string }>;
  video_url?: string;
  error?: { code?: string; message?: string };
  message?: string;
};

function uniqueHttps(urls: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(urls.map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u))),
  );
}

export function extractByteplusVideoUrl(task: ByteplusTaskJson): string {
  if (typeof task.video_url === "string" && /^https?:\/\//i.test(task.video_url)) {
    return task.video_url.trim();
  }
  const content = task.content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const u = String((content as { video_url?: string }).video_url || "").trim();
    if (/^https?:\/\//i.test(u)) return u;
  }
  if (Array.isArray(content)) {
    for (const row of content) {
      const u = String(row?.video_url || "").trim();
      if (/^https?:\/\//i.test(u)) return u;
    }
  }
  return "";
}

/**
 * 将画布素材编成 BytePlus contents/generations content[]。
 * - 图生：首图 first_frame，次图 last_frame
 * - 多模态参考 / 编辑 / 延长：reference_* roles
 */
export function buildByteplusSeedance25SubmitBody(input: ByteplusSeedanceRunInput): {
  body: Record<string, unknown>;
  model: string;
  mode: SeedanceEvolinkMode;
  duration: number;
} {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Seedance 2.5 需要提示词");

  const imageUrls = uniqueHttps([...(input.imageUrls || []), input.imageUrl]);
  const videoUrls = uniqueHttps(input.videoUrls || []);
  const audioUrls = uniqueHttps(input.audioUrls || []);
  const mode: SeedanceEvolinkMode =
    (input.mode as SeedanceEvolinkMode | undefined) ||
    inferSeedanceMode({ imageUrls, videoUrls, audioUrls });

  if (mode === "image_to_video" && imageUrls.length < 1) {
    throw new Error("图生视频需要至少 1 张图片");
  }
  if (mode === "reference_to_video" && imageUrls.length + videoUrls.length + audioUrls.length < 1) {
    throw new Error("多模态参考需要至少 1 个图片、视频或音频素材");
  }
  if ((mode === "video_edit" || mode === "video_extend") && videoUrls.length < 1) {
    throw new Error(mode === "video_edit" ? "视频编辑需要至少 1 条原视频" : "视频延长需要至少 1 条原视频");
  }

  const duration =
    mode === "video_edit"
      ? clampByteplusSeedance25Duration(15)
      : clampByteplusSeedance25Duration(
          input.duration ?? clampSeedanceDuration("2.5", input.duration),
        );

  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];

  if (mode === "image_to_video") {
    const first = imageUrls[0];
    const last = imageUrls[1];
    if (first) {
      content.push({
        type: "image_url",
        image_url: { url: first },
        role: "first_frame",
      });
    }
    if (last) {
      content.push({
        type: "image_url",
        image_url: { url: last },
        role: "last_frame",
      });
    }
  } else if (mode !== "text_to_video") {
    for (const url of imageUrls.slice(0, 30)) {
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
    }
    for (const url of videoUrls.slice(0, 10)) {
      content.push({
        type: "video_url",
        video_url: { url },
        role: "reference_video",
      });
    }
    for (const url of audioUrls.slice(0, 10)) {
      content.push({
        type: "audio_url",
        audio_url: { url },
        role: "reference_audio",
      });
    }
  }

  const model = getByteplusSeedance25ModelId();
  const body: Record<string, unknown> = {
    model,
    content,
    generate_audio: input.generateAudio !== false,
    ratio: normalizeByteplusRatio(input.aspectRatio),
    duration,
    watermark: input.watermark === true,
  };
  const resolution = String(input.resolution || "").trim().toLowerCase();
  if (resolution === "480p" || resolution === "720p" || resolution === "1080p") {
    body.resolution = resolution;
  }

  return { body, model, mode, duration };
}

export type ByteplusVideoPollSnapshot =
  | { state: "completed"; sourceUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string };

export async function pollByteplusVideoTaskOnce(
  taskId: string,
  label = "Seedance 2.5",
): Promise<ByteplusVideoPollSnapshot> {
  const apiKey = getByteplusArkApiKey();
  if (!apiKey) return { state: "failed", error: "BYTEPLUS_ARK_API_KEY 未配置" };

  // 查询接口自身故障（网络 / 限流 / 5xx）≠ 任务失败：当终态会「假失败真退分」。
  // 视作仍在跑，等下一轮；终态只认 2xx 响应体里的 failed/cancelled。
  let r: Response;
  try {
    r = await fetch(
      `${getByteplusArkApiBase()}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch (e) {
    return {
      state: "running",
      status: `transient_fetch_error:${e instanceof Error ? e.name : "unknown"}`,
    };
  }
  const json = (await r.json().catch(() => ({}))) as ByteplusTaskJson;
  if (!r.ok) {
    return { state: "running", status: `transient_http_${r.status}` };
  }

  const status = String(json.status || "").toLowerCase();
  if (status === "succeeded" || status === "success" || status === "completed") {
    const url = extractByteplusVideoUrl(json);
    if (!url) return { state: "failed", error: `${label} 任务完成但未返回视频 URL` };
    return { state: "completed", sourceUrl: url };
  }
  if (status === "failed" || status === "cancelled" || status === "canceled") {
    return {
      state: "failed",
      error: json.error?.message || json.message || `${label} 视频生成失败`,
    };
  }
  return { state: "running", status: status || "processing" };
}

/** 上游可回落 EvoLink 的错误（账号/配额/服务侧）；参数契约错误不回落。 */
export function isByteplusFallbackableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || "");
  if (!msg) return true;
  if (/需要提示词|需要至少|需要 1|无效|请填写/i.test(msg)) return false;
  return true;
}

export async function submitByteplusSeedance25Video(
  input: ByteplusSeedanceRunInput,
): Promise<{
  model: string;
  mode: SeedanceEvolinkMode;
  byteplusTaskId: string;
  immediateSourceUrl?: string;
}> {
  const apiKey = getByteplusArkApiKey();
  if (!apiKey) throw new Error("BYTEPLUS_ARK_API_KEY 未配置，无法使用 BytePlus Seedance 2.5");

  const built = buildByteplusSeedance25SubmitBody(input);
  const createRes = await fetch(`${getByteplusArkApiBase()}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(built.body),
    signal: AbortSignal.timeout(60_000),
  });
  const createJson = (await createRes.json().catch(() => ({}))) as ByteplusTaskJson;
  if (!createRes.ok) {
    throw new Error(
      createJson.error?.message ||
        createJson.message ||
        `BytePlus 创建任务失败 (${createRes.status})`,
    );
  }

  const taskId = String(createJson.id || "").trim();
  if (!taskId) throw new Error("BytePlus 未返回任务 ID");

  const status = String(createJson.status || "").toLowerCase();
  const immediateUrl = extractByteplusVideoUrl(createJson);
  if (immediateUrl && (status === "succeeded" || status === "completed" || status === "success")) {
    return {
      model: built.model,
      mode: built.mode,
      byteplusTaskId: taskId,
      immediateSourceUrl: immediateUrl,
    };
  }

  return { model: built.model, mode: built.mode, byteplusTaskId: taskId };
}

export async function runByteplusSeedance25Video(
  input: ByteplusSeedanceRunInput,
): Promise<{
  videoUrl: string;
  model: string;
  provider: "byteplus";
  mode: SeedanceEvolinkMode;
}> {
  const submitted = await submitByteplusSeedance25Video(input);
  let sourceUrl = submitted.immediateSourceUrl;
  if (!sourceUrl) {
    const started = Date.now();
    while (Date.now() - started < MAX_POLL_MS) {
      const snap = await pollByteplusVideoTaskOnce(submitted.byteplusTaskId);
      if (snap.state === "completed") {
        sourceUrl = snap.sourceUrl;
        break;
      }
      if (snap.state === "failed") throw new Error(snap.error);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!sourceUrl) {
      throw new Error(`Seedance 2.5 任务超时（${Math.round(MAX_POLL_MS / 60_000)} 分钟）`);
    }
  }
  const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(sourceUrl);
  return {
    videoUrl,
    model: submitted.model,
    provider: "byteplus",
    mode: submitted.mode,
  };
}

export {
  POLL_INTERVAL_MS as BYTEPLUS_SEEDANCE_POLL_INTERVAL_MS,
  MAX_POLL_MS as BYTEPLUS_SEEDANCE_MAX_POLL_MS,
};
