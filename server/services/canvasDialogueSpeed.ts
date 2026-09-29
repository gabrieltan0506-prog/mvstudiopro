import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CANVAS_DIALOGUE_SPEED_MAX, CANVAS_DIALOGUE_SPEED_MIN, canvasDialogueSpeedObjectName, isCanvasDialogueSpeedDerivedObject } from "../../shared/canvasDialogueSpeed.js";
import { CanvasDialogueError } from "./canvasDialogueOperation";
import { downloadGcsObject, getGcsBucketName, uploadBufferToGcs } from "./gcs";
import { MAX_RESULT_BYTES, probeAudio, runMediaTool } from "./postProduction";

/**
 * 0929：对白长于秒窗时按倍速派生新候选（0.5–2 倍、保持音高）。
 * 不调用 TTS、不扣费；只接受本人 post-prod 对白原件，派生件放回同一目录（播放中转按本人前缀放行）。
 * 同一原件同一倍速的对象名固定，重复请求覆盖为同内容。
 */
type Deps = {
  bucket: () => string;
  download: (gcsUri: string) => Promise<Buffer>;
  stretch: (audio: Buffer, speed: number, signal: AbortSignal) => Promise<{ buffer: Buffer; durationSec: number }>;
  upload: (objectName: string, buffer: Buffer, signal: AbortSignal) => Promise<void>;
};

export async function stretchCanvasDialogueAudio(audio: Buffer, speed: number, signal: AbortSignal) {
  const dir = await mkdtemp(path.join(tmpdir(), "dialogue-speed-"));
  try {
    const source = path.join(dir, "source.wav");
    const output = path.join(dir, "speed.wav");
    await writeFile(source, audio, { signal });
    // atempo 单级支持 0.5–2.0，恰好覆盖本功能区间；与对白规范化同格式（48k 双声道 16bit）
    await runMediaTool("ffmpeg", ["-y", "-nostdin", "-protocol_whitelist", "file", "-i", source,
      "-map", "0:a:0", "-vn", "-filter:a", `atempo=${speed.toFixed(2)}`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", output], signal);
    const durationSec = await probeAudio(output, signal);
    const size = (await stat(output)).size;
    if (size <= 44 || size > MAX_RESULT_BYTES) throw new Error("变速结果体积异常");
    return { buffer: await readFile(output, { signal }), durationSec };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const realDeps: Deps = {
  bucket: getGcsBucketName,
  download: async gcsUri => (await downloadGcsObject({ gcsUri })).buffer,
  stretch: stretchCanvasDialogueAudio,
  upload: async (objectName, buffer, signal) => { await uploadBufferToGcs({ objectName, buffer, contentType: "audio/wav", signal }); },
};

export async function speedCanvasDialogueTake(
  userId: number,
  input: { gcsUri: string; speed: number },
  deps: Deps = realDeps,
): Promise<{ gcsUri: string; durationSec: number; bytes: number; speed: number }> {
  const speed = Math.round(Number(input.speed) * 100) / 100;
  if (!Number.isFinite(speed) || speed < CANVAS_DIALOGUE_SPEED_MIN || speed > CANVAS_DIALOGUE_SPEED_MAX) {
    throw new CanvasDialogueError("conflict", `倍速须在 ${CANVAS_DIALOGUE_SPEED_MIN}–${CANVAS_DIALOGUE_SPEED_MAX} 之间`);
  }
  if (speed === 1) throw new CanvasDialogueError("conflict", "倍速为 1，无需生成");
  const bucket = deps.bucket();
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(String(input.gcsUri || "").trim());
  const prefix = `post-prod/${userId}/dialogue/`;
  const objectName = match?.[2] || "";
  if (!match || match[1] !== bucket || !objectName.startsWith(prefix) || !/\.wav$/i.test(objectName)
    || objectName.includes("..") || objectName.slice(prefix.length).includes("/")) {
    throw new CanvasDialogueError("conflict", "只能对本人的对白候选变速");
  }
  if (isCanvasDialogueSpeedDerivedObject(objectName)) throw new CanvasDialogueError("conflict", "请从原始候选变速，避免倍速叠加");
  const signal = AbortSignal.timeout(120_000);
  const audio = await deps.download(`gs://${bucket}/${objectName}`);
  const stretched = await deps.stretch(audio, speed, signal);
  const target = canvasDialogueSpeedObjectName(objectName, speed);
  await deps.upload(target, stretched.buffer, signal);
  return { gcsUri: `gs://${bucket}/${target}`, durationSec: stretched.durationSec, bytes: stretched.buffer.length, speed };
}
