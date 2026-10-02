import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadPhotoMedia } from "./photoMediaInput.js";
import { getGcsBucketName, signGcsObjectPathV4ReadUrl } from "./gcs.js";
import { registerCanvasMediaOwner, verifyCanvasMediaOwnership } from "./canvasMediaOwnership.js";
import { submitWavespeedVideoUpscale, pollWavespeedUpscaleOnce } from "./wavespeedVideoUpscale.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";
import { wavespeedUpscaleUsdCost } from "../../shared/wavespeedVideoUpscaleModels.js";
const run = promisify(execFile);
export const MIN_REFERENCE_VIDEO_PIXELS = 407696;
export type ReferenceVideoUpscaleRecord = {
  submissionStartedAt?: string; predictionId?: string; outputObject?: string;
  width?: number; height?: number; duration?: number; factor?: number; costUsd?: number;
};
export class ReferenceVideoPending extends Error {}
export class ReferenceVideoUnknown extends Error {}
export function referenceVideoDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error("白模视频尺寸无法读取");
  const factor = width * height >= MIN_REFERENCE_VIDEO_PIXELS ? 1 : 2 ** Math.ceil(Math.log2(Math.sqrt(MIN_REFERENCE_VIDEO_PIXELS / (width * height))));
  return { width: width * factor, height: height * factor, factor };
}
let probeQueue: Promise<unknown> = Promise.resolve();
export function probeReferenceVideo(url: string) {
  const work = probeQueue.then(() => probeVideo(url));
  probeQueue = work.catch(() => undefined);
  return work;
}
async function probeVideo(url: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "seedance-reference-video-"));
  try {
    const file = path.join(dir, "source.mp4");
    await downloadPhotoMedia(url, 100 * 1024 * 1024, file);
    const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const data = JSON.parse(stdout); const stream = data.streams?.[0];
    const result = { width: Number(stream?.width), height: Number(stream?.height), duration: Number(data.format?.duration) };
    referenceVideoDimensions(result.width, result.height);
    if (!Number.isFinite(result.duration) || result.duration <= 0 || result.duration > 300) throw new Error("白模视频时长无法验证");
    return result;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const defaultDependencies = { probe: probeReferenceVideo, submit: submitWavespeedVideoUpscale, poll: pollWavespeedUpscaleOnce, mirror: mirrorSeedanceMp4ToGcsSignedUrl, register: registerCanvasMediaOwner, verify: verifyCanvasMediaOwnership, sign: signGcsObjectPathV4ReadUrl };
/** 已授权生成入口共用；先持久化放大回执，后续轮询同一单，达标前不提交生成供应商。 */
export async function normalizeSeedanceReferenceVideo(url: string, userId: number, record: ReferenceVideoUpscaleRecord, save: () => Promise<void>, evidenceId: string, deps = defaultDependencies): Promise<string> {
  if (record.outputObject) {
    if (!await deps.verify(userId, record.outputObject)) throw new Error("白模放大产物归属校验失败");
    return deps.sign(getGcsBucketName(), record.outputObject);
  }
  if (!record.width || !record.height || !record.duration) {
    Object.assign(record, await deps.probe(url));
    record.factor = referenceVideoDimensions(record.width!, record.height!).factor;
    await save();
  }
  if (record.width! * record.height! >= MIN_REFERENCE_VIDEO_PIXELS) return url;
  if (!record.predictionId) {
    if (record.submissionStartedAt) throw new ReferenceVideoUnknown("白模高清放大提交结果待核对，不重复收费");
    // 当前WaveSpeed接口只有1080p/2K/4K；1080p为本像素门槛的最低可用档。
    record.costUsd = wavespeedUpscaleUsdCost("1080p", record.duration!);
    record.submissionStartedAt = new Date().toISOString();
    await save();
    try {
      const receipt = await deps.submit({ taskId: evidenceId, videoUrl: url, target: "1080p" });
      record.predictionId = receipt.predictionId;
      await save();
    } catch (error) {
      if ((error as {kind?: string})?.kind === "rejected") { record.submissionStartedAt = undefined; await save(); throw error; }
      throw new ReferenceVideoUnknown("白模高清放大回执待核对，不重复提交或自动退款");
    }
    throw new ReferenceVideoPending("白模视频正在WaveSpeed高清放大");
  }
  const snapshot = await deps.poll(record.predictionId);
  if (snapshot.state === "running") throw new ReferenceVideoPending("白模视频正在WaveSpeed高清放大");
  if (snapshot.state === "failed") throw new Error(`白模高清放大失败：${snapshot.error}`);
  let output: Awaited<ReturnType<typeof probeReferenceVideo>>;
  try { output = await deps.probe(snapshot.sourceUrl); }
  catch { throw new ReferenceVideoPending("白模放大已完成，产物读取暂不可用，继续查询原单"); }
  if (output.width * output.height < MIN_REFERENCE_VIDEO_PIXELS || Math.abs(output.duration - record.duration!) > 0.15 || Math.abs(output.width / output.height - record.width! / record.height!) > 0.02) throw new ReferenceVideoUnknown("白模高清放大输出尺寸、时长或画幅未通过复核，保留原单等待处理");
  let mirrored: string;
  try { mirrored = await deps.mirror(snapshot.sourceUrl); }
  catch { throw new ReferenceVideoPending("白模放大已完成，保存暂不可用，继续查询原单"); }
  const match = mirrored.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/([^?]+)(?:\?.*)?$/i);
  const object = match && match[1] === getGcsBucketName() ? decodeURIComponent(match[2]) : null;
  if (!object) throw new ReferenceVideoUnknown("白模放大产物未取得稳定存储身份");
  const owner = await deps.register({ objectPath: object, ownerUserId: userId, source: "seedance-reference-video-upscale" });
  if (owner !== "created" && owner !== "alreadyOwned") throw new ReferenceVideoUnknown("白模放大产物归属登记失败");
  record.outputObject = object; await save();
  return mirrored;
}
