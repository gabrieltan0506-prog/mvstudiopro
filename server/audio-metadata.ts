import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { storagePut } from "./storage";

const execFile = promisify(execFileCb);
const GENERATED_BY_TAG = "mvstudiopro_free";

async function safeRm(filePath: string) {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // noop
  }
}

export async function addGeneratedByMetadataToAudioUrl(audioUrl: string): Promise<string> {
  const id = randomUUID();
  const inputPath = path.join("/tmp", `audio-${id}.mp3`);
  const outputPath = path.join("/tmp", `audio-meta-${id}.mp3`);

  try {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);

    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const inputBuffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(inputPath, inputBuffer);

    await execFile("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-map_metadata",
      "0",
      "-c",
      "copy",
      "-metadata",
      `generated_by=${GENERATED_BY_TAG}`,
      outputPath,
    ]);

    const outputBuffer = await fs.readFile(outputPath);
    const key = `watermarked/audio/${Date.now()}-${id}.mp3`;
    const uploaded = await storagePut(key, outputBuffer, contentType);
    return uploaded.url;
  } finally {
    await safeRm(inputPath);
    await safeRm(outputPath);
  }
}
