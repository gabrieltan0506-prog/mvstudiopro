import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { storagePut } from "./storage";

const execFile = promisify(execFileCb);
const WATERMARK_TEXT = "mvstudiopro.com free";

async function safeRm(filePath: string) {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // noop
  }
}

export async function addVideoWatermarkToUrl(videoUrl: string): Promise<string> {
  const id = randomUUID();
  const inputPath = path.join("/tmp", `video-${id}.mp4`);
  const outputPath = path.join("/tmp", `video-wm-${id}.mp4`);
  const textPath = path.join("/tmp", `video-wm-${id}.txt`);

  try {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);

    const inputBuffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(inputPath, inputBuffer);
    await fs.writeFile(textPath, WATERMARK_TEXT, "utf8");

    const drawTextFilter = `drawtext=textfile='${textPath}':fontcolor=white@0.22:fontsize=min(w\\,h)*0.04:borderw=2:bordercolor=black@0.7:x=w-text_w-20:y=h-text_h-20`;

    await execFile("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      drawTextFilter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    const outputBuffer = await fs.readFile(outputPath);
    const key = `watermarked/videos/${Date.now()}-${id}.mp4`;
    const uploaded = await storagePut(key, outputBuffer, "video/mp4");
    return uploaded.url;
  } finally {
    await safeRm(inputPath);
    await safeRm(outputPath);
    await safeRm(textPath);
  }
}
