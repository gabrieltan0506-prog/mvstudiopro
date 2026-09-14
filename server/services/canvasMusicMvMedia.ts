/** MV 素材权限按各自生产者查账，不把用户输入的 URL 当作授权。 */
import { getJobByIdStrict } from "../jobs/repository";
import { peekCanvasVideoTask } from "./canvasVideoTask";
import { getGcsBucketName } from "./gcs";
import {
  extractSystemObjectName,
  resolveRegisteredPostProdMediaSource,
} from "./postProdMediaSource";
import type { CanvasMusicCandidate } from "../../shared/canvasMusicMv";

type MediaDeps = {
  bucket: typeof getGcsBucketName;
  job: typeof getJobByIdStrict;
  video: typeof peekCanvasVideoTask;
  registered: typeof resolveRegisteredPostProdMediaSource;
};
const real: MediaDeps = {
  bucket: getGcsBucketName,
  job: getJobByIdStrict,
  video: peekCanvasVideoTask,
  registered: resolveRegisteredPostProdMediaSource,
};
function systemSource(source: string, d: MediaDeps): string | null {
  const objectName = extractSystemObjectName(source, d.bucket());
  return objectName ? `gs://${d.bucket()}/${objectName}` : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function resolveCanvasMusicMvVideo(
  userId: number,
  clip: { url: string; taskId?: string },
  d: MediaDeps = real
): Promise<string> {
  if (!clip.taskId)
    return d.registered({ userId: String(userId), source: clip.url });
  // peek 只读取已持久化记录；合成权限检查绝不推进上游，也不触发新任务。
  const task = await d.video(clip.taskId, userId);
  if (
    !task ||
    task.taskId !== clip.taskId ||
    task.userId !== userId ||
    task.status !== "succeeded" ||
    !task.videoUrl
  )
    throw new Error("视频任务尚未成功或不属于本人");
  const actual = systemSource(task.videoUrl, d);
  const requested = systemSource(clip.url, d);
  if (!actual || actual !== requested)
    throw new Error("所选视频与任务产物不一致");
  return actual;
}

export async function resolveCanvasMusicMvAudio(
  userId: number,
  audio: CanvasMusicCandidate,
  musicJobId?: string,
  d: MediaDeps = real
): Promise<string> {
  // 音乐导入的候选 ID 由现有 UI 生成 jobId:index；历史候选不随当前音乐任务号漂移。
  const generated = audio.id.match(/^(bgm_[a-zA-Z0-9_-]+):(\d+)$/);
  const taskId = musicJobId || generated?.[1];
  if (!taskId)
    return d.registered({
      userId: String(userId),
      source: audio.gcsUri || audio.url,
    });
  if (!generated || generated[1] !== taskId)
    throw new Error("音乐候选与生成任务编号不一致");
  const job = await d.job(taskId);
  if (
    !job ||
    String(job.userId) !== String(userId) ||
    job.type !== "audio" ||
    job.status !== "succeeded" ||
    record(job.input).action !== "manhua_bgm_v55"
  )
    throw new Error("音乐任务尚未成功或不属于本人");
  const output = record(job.output);
  const terminal = output.terminalOutput
    ? record(output.terminalOutput)
    : output;
  const variant = (Array.isArray(terminal.variants) ? terminal.variants : [])
    .map(record)
    .find(row => row.index === Number(generated[2]));
  if (
    !variant ||
    typeof variant.gcsUri !== "string" ||
    Number(variant.bytes) <= 0
  )
    throw new Error("音乐变体不存在或内容为空");
  const actual = systemSource(variant.gcsUri, d);
  const requested = systemSource(audio.gcsUri || audio.url, d);
  if (!actual || actual !== requested)
    throw new Error("所选音乐与生成变体不一致");
  // 新生产者持久化的是 ffprobe 实测 durationSec；旧任务无此字段时保持已有客户端实测路径。
  const duration = Number(variant.durationSec);
  if (
    Number.isFinite(duration) &&
    duration > 0 &&
    Math.abs(duration - audio.durationSec) > 0.001
  )
    throw new Error("音乐时长与实际生成回执不一致");
  return actual;
}
