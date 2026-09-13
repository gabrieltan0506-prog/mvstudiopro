import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  homePhotoVideoImageLimits,
  type HomePhotoVideoModel,
} from "../../shared/homePhotoTools.js";
import { downloadPhotoMedia } from "./photoMediaInput.js";
import {
  SubmitRejectedError,
  SubmitUnknownError,
} from "./submitOutcomeErrors.js";

export function isHomePhotoVideoConfigured() {
  return Boolean(process.env.EVOLINK_API_KEY?.trim());
}

/** 只校验原图，不缩图、不重新编码；在扣费前调用。 */
export async function validateHomePhotoVideoImage(
  imageUrl: string,
  model: HomePhotoVideoModel
) {
  const limits = homePhotoVideoImageLimits(model);
  let buffer: Buffer;
  try {
    buffer = await downloadPhotoMedia(imageUrl, limits.maxBytes);
  } catch (e) {
    if (e instanceof Error && e.message === "image_too_large") {
      throw new Error(
        `所选模型输入图片不能超过 ${limits.maxBytes / 1_000_000}MB，请选择其他照片或模型；原图不会自动压缩`
      );
    }
    throw new Error("无法读取照片，请重新上传后再试");
  }
  const info = await sharp(buffer, { limitInputPixels: 64_000_000 }).metadata();
  const width = info.width || 0,
    height = info.height || 0;
  if (
    !["jpeg", "png", "webp"].includes(info.format || "") ||
    (info.pages || 1) > 1
  ) {
    throw new Error("请使用单张 JPG、PNG 或 WebP 照片");
  }
  if (
    Math.min(width, height) < limits.minEdge ||
    Math.max(width, height) > limits.maxEdge ||
    Math.max(width / height, height / width) > limits.maxRatio
  ) {
    throw new Error(
      `所选模型要求图片每边 ${limits.minEdge}–${limits.maxEdge} 像素，长短边比不超过 ${limits.maxRatio}；请选择其他照片或模型`
    );
  }
  if (
    model === "wan-3.0" &&
    info.hasAlpha &&
    !(await sharp(buffer).stats()).isOpaque
  ) {
    throw new Error("所选模型不支持透明图片，请选择不含透明区域的照片");
  }
  return {
    bytes: buffer.length,
    width,
    height,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function buildHomePhotoVideoRequest(input: {
  modelChoice: HomePhotoVideoModel;
  imageUrl: string;
  prompt: string;
  duration: number;
}) {
  const common = {
    prompt: input.prompt,
    duration: input.duration,
    quality: "720p",
    generate_audio: true,
  };
  return input.modelChoice === "wan-3.0"
    ? { ...common, model: "wan3.0-image-to-video", image_start: input.imageUrl }
    : {
        ...common,
        model: "seedance-2.0-image-to-video",
        aspect_ratio: "adaptive",
        image_urls: [input.imageUrl],
      };
}

async function persistEvidence(taskId: string, name: string, value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) throw new Error("invalid_task_id");
  const dir = path.join(
    process.env.HOME_PHOTO_VIDEO_EVIDENCE_DIR ||
      "/data/growth/home-photo-video-evidence",
    taskId
  );
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, value, { flag: "wx" });
  await fs.writeFile(
    file + ".receipt.json",
    JSON.stringify({
      file: name,
      bytes: Buffer.byteLength(value),
      sha256: createHash("sha256").update(value).digest("hex"),
    })
  );
}

/** 本单只提交一次；不确定是否建单时必须进入对账，不能换模型或重投。 */
export async function submitHomePhotoVideo(input: {
  taskId: string;
  modelChoice: HomePhotoVideoModel;
  imageUrl: string;
  prompt: string;
  duration: number;
}) {
  const key = process.env.EVOLINK_API_KEY?.trim();
  if (!key) throw new SubmitRejectedError("照片动画服务暂不可用");
  const body = buildHomePhotoVideoRequest(input);
  try {
    await persistEvidence(input.taskId, "request.json", JSON.stringify(body));
  } catch {
    throw new SubmitRejectedError("提交前保存记录失败，未发送生成请求");
  }
  try {
    const base = (
      process.env.EVOLINK_API_BASE || "https://api.evolink.ai"
    ).replace(/\/$/, "");
    const r = await fetch(`${base}/v1/videos/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await r.text();
    await persistEvidence(input.taskId, "submit-raw.json", raw);
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      json = { unparsed: true, httpStatus: r.status };
    }
    await persistEvidence(
      input.taskId,
      "submit-parsed.json",
      JSON.stringify(json)
    );
    if (!r.ok) {
      if ([400, 401, 403, 404, 413, 415, 422].includes(r.status)) {
        throw new SubmitRejectedError(
          "照片动画请求未被接受，请检查图片和描述后重试"
        );
      }
      throw new SubmitUnknownError("照片动画提交结果尚未确认");
    }
    if (!json.id) throw new SubmitUnknownError("照片动画未返回任务编号");
    return { evolinkTaskId: String(json.id), model: body.model };
  } catch (e) {
    if (e instanceof SubmitRejectedError || e instanceof SubmitUnknownError)
      throw e;
    throw new SubmitUnknownError("照片动画提交结果尚未确认");
  }
}

export async function pollHomePhotoVideo(taskId: string, upstreamId: string) {
  const key = process.env.EVOLINK_API_KEY?.trim();
  if (!key) throw new Error("照片动画查询暂不可用");
  const base = (
    process.env.EVOLINK_API_BASE || "https://api.evolink.ai"
  ).replace(/\/$/, "");
  const r = await fetch(`${base}/v1/tasks/${encodeURIComponent(upstreamId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60_000),
  });
  const stamp = `${Date.now()}-${randomUUID()}`;
  const raw = await r.text();
  await persistEvidence(taskId, `poll-${stamp}-raw.json`, raw);
  const json = JSON.parse(raw);
  await persistEvidence(
    taskId,
    `poll-${stamp}-parsed.json`,
    JSON.stringify(json)
  );
  if (!r.ok) throw new Error("照片动画状态查询暂不可用");
  const status = String(json.status).toLowerCase();
  if (status === "failed" || status === "cancelled")
    return {
      state: "failed" as const,
      error: "照片动画生成失败，本次积分将按原路径退回",
    };
  if (["completed", "succeeded", "success"].includes(status)) {
    const sourceUrl =
      json.results?.[0] || json.result?.video_url || json.output?.video_url;
    if (typeof sourceUrl !== "string" || !/^https?:\/\//.test(sourceUrl))
      throw new Error("成片下载地址尚未取得");
    return { state: "completed" as const, sourceUrl };
  }
  return { state: "running" as const };
}
