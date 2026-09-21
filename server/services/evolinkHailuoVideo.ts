import { formatEvolinkReferencePrompt } from "../../shared/evolinkReferencePrompt.js";
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors.js";

export const EVOLINK_H3_MODEL = "minimax-h3-reference-to-video";

export type EvolinkH3Input = {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  duration: number;
  resolution: string;
  aspectRatio: string;
};

/** 仅处理供应商已公开的字段；不裁掉参考，也不向 H3 发送 Seedance 专属字段。 */
export function buildEvolinkH3Body(input: EvolinkH3Input): Record<string, unknown> {
  const prompt = formatEvolinkReferencePrompt(input.prompt.trim(), "h3");
  if (!prompt || prompt.length > 7000) throw new SubmitRejectedError("H3 提示词须为 1–7000 字符");
  const arrays = [input.imageUrls || [], input.videoUrls || [], input.audioUrls || []];
  const limits = [9, 3, 3];
  const names = ["图片", "视频", "音频"];
  arrays.forEach((urls, i) => {
    if (urls.length > limits[i]) throw new SubmitRejectedError(`H3 ${names[i]}参考超过 ${limits[i]} 个`);
    if (urls.some(url => !/^https?:\/\/\S+$/i.test(url))) {
      throw new SubmitRejectedError(`H3 ${names[i]}参考须先解析为可访问的 HTTP(S) 地址`);
    }
  });
  const total = arrays.reduce((sum, urls) => sum + urls.length, 0);
  if (total < 1 || total > 12) throw new SubmitRejectedError("H3 参考素材合计须为 1–12 个");
  if (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > 15) {
    throw new SubmitRejectedError("H3 输出时长须为 4–15 秒整数");
  }
  const quality = input.resolution.toLowerCase();
  if (quality !== "768p" && quality !== "2k") throw new SubmitRejectedError("H3 画质仅支持 768p 或 2K");
  if (!["adaptive", "16:9", "21:9", "4:3", "1:1", "3:4", "9:16"].includes(input.aspectRatio)) {
    throw new SubmitRejectedError("H3 画幅不受支持");
  }
  return {
    model: EVOLINK_H3_MODEL, prompt,
    image_urls: [...arrays[0]], video_urls: [...arrays[1]], audio_urls: [...arrays[2]],
    duration: input.duration, quality, aspect_ratio: input.aspectRatio,
  };
}

export function isEvolinkH3Configured(): boolean {
  return Boolean(String(process.env.EVOLINK_API_KEY || "").trim());
}

/** 单次提交；未知回执交由任务层对账，绝不自动重试或换供应商。 */
export async function submitEvolinkH3(input: EvolinkH3Input): Promise<{ evolinkTaskId: string }> {
  const body = buildEvolinkH3Body(input);
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new SubmitRejectedError("H3 参考生成通道未配置");
  const base = String(process.env.EVOLINK_API_BASE || "https://api.evolink.ai").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/v1/videos/generations`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new SubmitUnknownError("H3 提交结果未知，请核对原任务，勿重复生成");
  }
  const json = await response.json().catch(() => ({})) as { id?: unknown };
  if (!response.ok) {
    if ([400, 401, 403, 404, 413, 415, 422].includes(response.status)) {
      throw new SubmitRejectedError(`H3 请求被拒绝（HTTP ${response.status}）`);
    }
    throw new SubmitUnknownError(`H3 提交状态待核对（HTTP ${response.status}）`);
  }
  if (typeof json.id !== "string" || !json.id.trim()) throw new SubmitUnknownError("H3 未返回有效任务编号，请勿重复生成");
  return { evolinkTaskId: json.id.trim() };
}
