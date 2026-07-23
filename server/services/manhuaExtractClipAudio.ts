/**
 * 从成片视频抠参考音色 mp3（Seedance 参考音频：单段 ≤15s）。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildGrowthCampVideoObjectName,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
} from "./gcs.js";

const execFileAsync = promisify(execFile);

export type ManhuaExtractClipAudioInput = {
  videoUrl: string;
  /** 起点秒，默认 0 */
  startSec?: number;
  /** 时长秒，默认 8，钳制到 [2, 15] */
  durationSec?: number;
};

export type ManhuaExtractClipAudioResult = {
  audioUrl: string;
  gcsUri: string;
  startSec: number;
  durationSec: number;
  bytes: number;
};

function clampDuration(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 8;
  return Math.min(15, Math.max(2, Math.round(v)));
}

function clampStart(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(600, v);
}

async function downloadVideoToTemp(videoUrl: string, destPath: string): Promise<void> {
  const r = await fetch(videoUrl, {
    redirect: "follow",
    headers: { "User-Agent": "mvstudiopro/1.0 (+extract-clip-audio)" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) {
    throw new Error(`download_failed:${r.status}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1024) throw new Error("download_too_small");
  await fs.writeFile(destPath, buf);
}

export async function extractManhuaClipAudioToGcs(
  input: ManhuaExtractClipAudioInput,
): Promise<ManhuaExtractClipAudioResult> {
  const videoUrl = String(input.videoUrl || "").trim();
  if (!/^https:\/\//i.test(videoUrl)) {
    throw new Error("video_url_must_be_https");
  }
  const startSec = clampStart(input.startSec);
  const durationSec = clampDuration(input.durationSec);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "manhua-voice-"));
  const videoPath = path.join(tmpDir, "clip.mp4");
  const audioPath = path.join(tmpDir, "voice.mp3");

  try {
    await downloadVideoToTemp(videoUrl, videoPath);
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(startSec),
        "-t",
        String(durationSec),
        "-i",
        videoPath,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-ar",
        "44100",
        "-ac",
        "1",
        "-b:a",
        "128k",
        audioPath,
      ],
      { timeout: 120_000 },
    );
    const buffer = await fs.readFile(audioPath);
    if (buffer.length < 256) throw new Error("extract_empty_audio");
    if (buffer.length > 15 * 1024 * 1024) throw new Error("audio_too_large");

    const objectName = buildGrowthCampVideoObjectName(`manhua-voice-${Date.now()}.mp3`);
    const { gcsUri } = await uploadBufferToGcs({
      objectName,
      buffer,
      contentType: "audio/mpeg",
    });
    const audioUrl = signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
    return {
      audioUrl,
      gcsUri,
      startSec,
      durationSec,
      bytes: buffer.length,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
