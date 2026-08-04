/**
 * 成片左上角标后期修补（ffmpeg delogo，不裁画面）。
 * 用于国内通道强制角标；非上游「无标导出」。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  computeAiCornerMarkRoiPx,
  formatDelogoFilter,
  type AiCornerMarkRoiPx,
} from "../../shared/aiCornerMarkRoi.js";
import {
  buildGrowthCampVideoObjectName,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
} from "./gcs.js";

const execFileAsync = promisify(execFile);

const MAX_BYTES = 220 * 1024 * 1024;

export type EraseAiCornerMarkInput = {
  videoUrl: string;
};

export type EraseAiCornerMarkResult = {
  videoUrl: string;
  gcsUri: string;
  bytes: number;
  width: number;
  height: number;
  roi: AiCornerMarkRoiPx;
};

async function downloadVideoToTemp(videoUrl: string, destPath: string): Promise<void> {
  const r = await fetch(videoUrl, {
    redirect: "follow",
    headers: { "User-Agent": "mvstudiopro/1.0 (+erase-ai-corner-mark)" },
    signal: AbortSignal.timeout(240_000),
  });
  if (!r.ok) throw new Error(`download_failed:${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1024) throw new Error("download_too_small");
  if (buf.length > MAX_BYTES) throw new Error("video_too_large");
  await fs.writeFile(destPath, buf);
}

async function probeVideoSize(videoPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      videoPath,
    ],
    { timeout: 30_000 },
  );
  const parts = String(stdout || "")
    .trim()
    .split("x")
    .map((n) => Math.floor(Number(n)));
  const width = parts[0] || 0;
  const height = parts[1] || 0;
  if (width < 16 || height < 16) throw new Error("invalid_video_size");
  return { width, height };
}

export async function eraseAiCornerMarkToGcs(
  input: EraseAiCornerMarkInput,
): Promise<EraseAiCornerMarkResult> {
  const videoUrl = String(input.videoUrl || "").trim();
  if (!/^https:\/\//i.test(videoUrl)) {
    throw new Error("video_url_must_be_https");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "erase-corner-"));
  const inPath = path.join(tmpDir, "in.mp4");
  const outPath = path.join(tmpDir, "out.mp4");

  try {
    await downloadVideoToTemp(videoUrl, inPath);
    const { width, height } = await probeVideoSize(inPath);
    const roi = computeAiCornerMarkRoiPx(width, height);
    const vf = formatDelogoFilter(roi);

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inPath,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { timeout: 600_000 },
    );

    const buffer = await fs.readFile(outPath);
    if (buffer.length < 1024) throw new Error("erase_empty_output");

    const objectName = buildGrowthCampVideoObjectName(`erase-corner-${Date.now()}.mp4`);
    const { gcsUri } = await uploadBufferToGcs({
      objectName,
      buffer,
      contentType: "video/mp4",
    });
    const signed = signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
    return {
      videoUrl: signed,
      gcsUri,
      bytes: buffer.length,
      width,
      height,
      roi,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
