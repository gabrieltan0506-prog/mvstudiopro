import { getJobByIdStrict } from "../jobs/repository";
import { previsTaskId } from "./manhuaPrevisTask";
import { resolveManhuaPrevisMedia } from "./manhuaPrevisMedia";
import { inspectGcsObjectBounded } from "./gcs";
import { manhuaPrevisRequestSchema, manhuaPrevisSpecSchema } from "../../shared/manhuaPrevis";
import { advisorPrevisSpecJson, type AdvisorPrevisTarget } from "../../shared/manhuaAdvisorPrevisEdit";
import { previsPlaybackDuration } from "../../shared/manhuaPrevisPlayback";

/** 只在服务器内读取完整视频字节；有界下载，不向客户端暴露私有位置。 */
async function readAdvisorVideo(gcsUri: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await inspectGcsObjectBounded({ gcsUri, maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000, onChunk: chunk => chunks.push(Buffer.from(chunk)) });
  return Buffer.concat(chunks);
}
/** 浏览器只传任务编号；视频位置由本人成功任务回执解析，拒绝跨片段和错误规格。 */
export async function resolveAdvisorPrevisVideo(userId: number, target: AdvisorPrevisTarget, deps = {
  load: getJobByIdStrict,
  read: readAdvisorVideo,
}) {
  if (!target.previousPreviewRequestId) return null;
  const job = await deps.load(previsTaskId(userId, target.previousPreviewRequestId));
  const media = resolveManhuaPrevisMedia(job, userId, "preview");
  if (!media || !job) throw new Error("所选白模视频尚未完成或无权读取，请恢复本段已生成版本");
  const input = job.input as { params?: unknown };
  const request = manhuaPrevisRequestSchema.parse(input.params);
  const expected = manhuaPrevisSpecSchema.parse(JSON.parse(target.previousPreviewSpecJson || target.specJson));
  if (request.requestId !== target.previousPreviewRequestId || request.clipId !== target.clipId
      || advisorPrevisSpecJson(request.spec) !== advisorPrevisSpecJson(expected)) {
    throw new Error("白模视频与本段修改基线不一致，请重新选择实际试看版本");
  }
  const output = job.output as Record<string, unknown>;
  if (output.requestId !== request.requestId || output.clipId !== request.clipId
      || typeof output.durationSec !== "number" || !Number.isFinite(output.durationSec)
      || Math.abs(output.durationSec - previsPlaybackDuration(request.spec)) > 0.05) throw new Error("白模视频回执不一致，未发送给顾问");
  const bytes = await deps.read(media.gcsUri);
  if (bytes.length < 12 || bytes.length > 32 * 1024 * 1024 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("白模视频文件无效或超过读取范围，未发送给顾问");
  // Z.AI 在 OpenRouter 不接远程视频URL；发送完整MP4的data URL，不删视频或降级为文字。
  return { requestId: request.requestId, url: `data:video/mp4;base64,${bytes.toString("base64")}`, durationSec: output.durationSec };
}
