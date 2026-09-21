import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { downloadPhotoMedia } from "./photoMediaInput.js";
import { SubmitRejectedError } from "./submitOutcomeErrors.js";

type MediaProbe = {
  streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string; width?: number; height?: number; avg_frame_rate?: string }>;
  format?: { duration?: string; format_name?: string };
};

/** 原始秒数不取整，15.1 秒不能被当成 15 秒放行。 */
export function validateH3MediaProbe(probe: MediaProbe, kind: "audio" | "video"): number {
  const stream = probe.streams?.find(s => s.codec_type === kind);
  const duration = Number(stream?.duration ?? probe.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration < 2 || duration > 15) {
    throw new SubmitRejectedError(`H3 参考${kind === "audio" ? "音频" : "视频"}须为 2–15 秒，当前素材不符合或无法读取`);
  }
  const format = String(probe.format?.format_name || "").split(",");
  if (kind === "audio") {
    if (!format.some(f => ["wav", "mp3"].includes(f))) throw new SubmitRejectedError("H3 参考音频须为 WAV 或 MP3");
  } else {
    if (!format.some(f => ["mov", "mp4"].includes(f)) || !["h264", "hevc"].includes(stream.codec_name || "")) {
      throw new SubmitRejectedError("H3 参考视频须为 MP4/MOV，使用 H.264 或 H.265 编码");
    }
    const width = Number(stream.width), height = Number(stream.height);
    const [n, d = 1] = String(stream.avg_frame_rate || "0").split("/").map(Number);
    const fps = n / d;
    if (!(width >= 256 && width <= 5760 && height >= 256 && height <= 5760 && width / height >= .4 && width / height <= 2.5 && fps >= 23.976 && fps <= 60)) {
      throw new SubmitRejectedError("H3 参考视频尺寸、宽高比或帧率不符合要求");
    }
    if (probe.streams?.some(s => s.codec_type === "audio" && !["aac", "mp3"].includes(s.codec_name || ""))) {
      throw new SubmitRejectedError("H3 视频内嵌音频须为 AAC 或 MP3");
    }
  }
  return duration;
}

/** 公网下载有 DNS/体积保护；ffprobe 仅读临时本地文件，不接受远端播放列表。 */
export async function preflightH3ReferenceMedia(input: { audioUrls?: string[]; videoUrls?: string[] }): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "h3-reference-"));
  try {
    for (const kind of ["audio", "video"] as const) {
      const urls = kind === "audio" ? input.audioUrls || [] : input.videoUrls || [];
      if (urls.length > 3) throw new SubmitRejectedError("H3 单类音视频参考不能超过 3 个");
      let total = 0;
      for (let i = 0; i < urls.length; i++) {
        const file = path.join(dir, `${kind}-${i}`);
        await downloadPhotoMedia(urls[i], (kind === "audio" ? 15 : 50) * 1024 * 1024, file);
        const { stdout } = await promisify(execFile)("ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-show_streams", "-show_format", "-of", "json", file], { timeout: 15_000, maxBuffer: 1024 * 1024 });
        total += validateH3MediaProbe(JSON.parse(stdout), kind);
        if (total > 15) throw new SubmitRejectedError(`H3 参考${kind === "audio" ? "音频" : "视频"}合计超过 15 秒`);
        await rm(file, { force: true });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
