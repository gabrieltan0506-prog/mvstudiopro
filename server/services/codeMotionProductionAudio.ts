/** Reference audio is the exact selected scene window of the final mix, never an entire Suno song. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CodeMotionProject } from "../../shared/codeMotion";
import { codeMotionStorage } from "./codeMotionStore";
import { codeMotionProductionDigest } from "./codeMotionProductionGrant";
import { renderCodeMotionAudio } from "./codeMotionAudio";
import { runMediaTool, probeAudio } from "./postProduction";
import { getGcsBucketName, uploadBufferToGcsIfAbsent } from "./gcs";
export function codeMotionProductionAudioFingerprint(
  project: CodeMotionProject,
  at: number,
  duration: number
) {
  return codeMotionProductionDigest({
    sources: project.brief.audios || [],
    audioTimeline: project.plan?.audioTimeline || [],
    at,
    duration,
    fullDuration: project.brief.duration,
  });
}
function receiptName(userId: string, projectId: string, fingerprint: string) {
  return `code-motion/u${userId}/production/${projectId}/audio-references/${fingerprint}.json`;
}
export async function getCodeMotionProductionAudio(
  userId: string,
  projectId: string,
  fingerprint: string
) {
  const file = await codeMotionStorage.read(
    receiptName(userId, projectId, fingerprint)
  );
  if (!file) return null;
  const result = JSON.parse(file.body.toString()) as {
    fingerprint: string;
    uri: string;
    sha256: string;
    durationSec: number;
  };
  if (
    result.fingerprint !== fingerprint ||
    !result.uri.startsWith(
      `gs://${getGcsBucketName()}/post-prod/${userId}/code-motion/${projectId}/reference-audio/`
    )
  )
    throw new Error("镜头参考音频回执不一致");
  return result;
}
export async function prepareCodeMotionProductionAudio(
  userId: string,
  project: CodeMotionProject,
  shot: { at: number; duration: number; audioFingerprint?: string }
) {
  if (!shot.audioFingerprint) return [];
  if (
    codeMotionProductionAudioFingerprint(project, shot.at, shot.duration) !==
    shot.audioFingerprint
  )
    throw new Error("参考音频时间窗已变化");
  const old = await getCodeMotionProductionAudio(
    userId,
    project.id,
    shot.audioFingerprint
  );
  if (old) return [old.uri];
  const root = await mkdtemp(path.join(tmpdir(), "ink-shot-audio-"));
  const signal = AbortSignal.timeout(180_000);
  try {
    const mixed = await renderCodeMotionAudio({
      userId,
      projectId: project.id,
      audio: {
        sources: project.brief.audios!,
        audioTimeline: project.plan!.audioTimeline!,
      },
      duration: project.brief.duration,
      root,
      signal,
    });
    const output = path.join(root, "shot.wav");
    await runMediaTool(
      "ffmpeg",
      [
        "-y",
        "-nostdin",
        "-i",
        mixed.output,
        "-af",
        `atrim=start_sample=${Math.round(shot.at * 48000)}:end_sample=${Math.round((shot.at + shot.duration) * 48000)},asetpts=PTS-STARTPTS`,
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      signal
    );
    const duration = await probeAudio(output, signal);
    if (Math.abs(duration - shot.duration) > 1 / 48000 + 1e-6)
      throw new Error("镜头参考音频实际时长不符");
    const bytes = await readFile(output),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectName = `post-prod/${userId}/code-motion/${project.id}/reference-audio/${sha256}.wav`;
    await uploadBufferToGcsIfAbsent({
      objectName,
      buffer: bytes,
      contentType: "audio/wav",
      signal,
    });
    const receipt = {
      fingerprint: shot.audioFingerprint,
      uri: `gs://${getGcsBucketName()}/${objectName}`,
      sha256,
      durationSec: duration,
      at: shot.at,
      sourceReceipt: mixed.receipt,
    };
    try {
      await codeMotionStorage.write(
        receiptName(userId, project.id, shot.audioFingerprint),
        Buffer.from(JSON.stringify(receipt)),
        "0"
      );
    } catch (error) {
      const winner = await getCodeMotionProductionAudio(
        userId,
        project.id,
        shot.audioFingerprint
      );
      if (!winner || winner.sha256 !== sha256) throw error;
    }
    return [receipt.uri];
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
