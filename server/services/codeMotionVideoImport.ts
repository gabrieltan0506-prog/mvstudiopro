import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codeMotionAudioSourceSchema } from "../../shared/codeMotionAudio";
import { importCodeMotionAudio } from "./codeMotionAudio";
import { codeMotionVideoAssetSchema } from "../../shared/codeMotionVideo";
import { codeMotionStorage, loadCodeMotion } from "./codeMotionStore";
import {
  spatialPrefix,
  readSpatialBytes,
  archiveSpatialBytes,
  writeSpatialRecord,
} from "./codeMotionSpatial";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { runMediaTool } from "./postProduction";

export const videoImportDeps = {
  storage: codeMotionStorage,
  load: loadCodeMotion,
  resolve: resolveRegisteredPostProdMediaSource,
  read: readSpatialBytes,
  archive: archiveSpatialBytes,
  importAudio: importCodeMotionAudio,
  async inspect(bytes: Buffer) {
    const dir = await mkdtemp(path.join(tmpdir(), "ink-video-import-"));
    try {
      const file = path.join(dir, "source.mp4");
      await writeFile(file, bytes);
      const raw = await runMediaTool(
        "ffprobe",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file",
          "-show_format",
          "-show_streams",
          "-of",
          "json",
          file,
        ],
        AbortSignal.timeout(30_000)
      );
      const probe = JSON.parse(raw.stdout);
      const streams = (probe.streams || []).filter(
        (s: { codec_type: string }) => s.codec_type === "video"
      );
      const duration = Number(streams[0]?.duration ?? probe.format?.duration);
      if (
        streams.length !== 1 ||
        !probe.format?.format_name?.split(",").includes("mov") ||
        !Number.isFinite(duration) ||
        duration < 4 ||
        duration > 30.1
      )
        throw Error("请上传含单条视频轨、4至30秒的MP4模型片段");
      await runMediaTool(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-xerror",
          "-protocol_whitelist",
          "file",
          "-i",
          file,
          "-map",
          "0:v:0",
          "-an",
          "-f",
          "null",
          "-",
        ],
        AbortSignal.timeout(90_000)
      );
      const audioTracks = (probe.streams || []).filter(
        (s: { codec_type: string }) => s.codec_type === "audio"
      );
      if (audioTracks.length > 1)
        throw Error("已有片段包含多条音轨，请先选择一条原声，避免错误混音");
      let audio: Buffer | undefined;
      if (audioTracks.length) {
        const audioFile = path.join(dir, "source.wav");
        await runMediaTool(
          "ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-xerror",
            "-protocol_whitelist",
            "file",
            "-i",
            file,
            "-map",
            "0:a:0",
            "-vn",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            "-t",
            String(Math.min(30, duration)),
            audioFile,
          ],
          AbortSignal.timeout(90_000)
        );
        audio = await readFile(audioFile);
      }
      return { duration, audio };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
/** 导入既有产物不调用生成、额度预留或扣费。外部任务号只保存为用户提供的来源说明。 */
export async function importCodeMotionExistingVideo(
  userId: string,
  input: {
    projectId: string;
    expectedGeneration: string;
    sceneIndex: number;
    gcsUri: string;
    name: string;
    sourceNote: string;
  },
  deps = videoImportDeps
) {
  const prefix = spatialPrefix(userId, input.projectId).replace(
    /spatial\/$/,
    ""
  );
  const saved = await deps.load(userId, input.projectId, deps.storage);
  if (!saved || saved.generation !== input.expectedGeneration)
    throw Error("作品已变化，请先保存再导入");
  const scene = saved.project.plan?.scenes[input.sceneIndex];
  if (!scene || scene.duration > 30) throw Error("请选择不超过30秒的目标镜头");
  const source = await deps.resolve({ userId, source: input.gcsUri });
  const bytes = await deps.read(source, 100 * 1024 * 1024);
  if (!bytes.length || bytes.length > 100 * 1024 * 1024)
    throw Error("视频为空或超过100 MiB");
  const inspected = await deps.inspect(bytes);
  const actualDuration = inspected.duration;
  // 尾帧容器误差允许向下取整，不允许把短片伪报成长片。
  const duration = Math.floor(Math.min(30, actualDuration) * 30 + 1e-6) / 30;
  if (scene.duration > duration + 1e-6)
    throw Error("已有视频短于本镜，请调整镜长；不会补生成或扣费");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = `import-${sha256}`;
  const videoUri = await deps.archive(
    `${prefix}imported-video/${sha256}.mp4`,
    bytes,
    "video/mp4"
  );
  const receiptName = `${prefix}imported-video/${id}.json`;
  const previous = await deps.storage.read(receiptName);
  const oldAudio = previous
    ? JSON.parse(previous.body.toString()).audioSource
    : undefined;
  let audioSource = oldAudio
    ? codeMotionAudioSourceSchema.parse(oldAudio)
    : undefined;
  if (inspected.audio && !audioSource) {
    const uri = await deps.archive(
      `post-prod/${userId}/code-motion/${input.projectId}/imported-audio/${sha256}.wav`,
      inspected.audio,
      "audio/wav"
    );
    const sourceId = `${sha256.slice(0, 8)}-${sha256.slice(8, 12)}-5${sha256.slice(13, 16)}-8${sha256.slice(17, 20)}-${sha256.slice(20, 32)}`;
    audioSource = await deps.importAudio({
      userId,
      projectId: input.projectId,
      name: `${input.name.slice(0, 145)}-原声.wav`,
      gcsUri: uri,
      sourceId,
    });
  }
  const asset = codeMotionVideoAssetSchema.parse({
    id,
    videoUri,
    sha256,
    durationSec: duration,
    ...(audioSource ? { originalAudioSourceId: audioSource.id } : {}),
  });
  await writeSpatialRecord(
    deps.storage,
    `${prefix}video-sources/${id}.json`,
    asset
  );
  if (!(await deps.storage.read(receiptName)))
    await writeSpatialRecord(deps.storage, receiptName, {
      asset,
      ...(audioSource ? { audioSource } : {}),
      name: input.name,
      sourceNote: input.sourceNote,
      provenance: "user_import",
      platformGenerationVerified: false,
      chargedCredits: 0,
    });
  const at = saved.project
    .plan!.scenes.slice(0, input.sceneIndex)
    .reduce((sum, s) => sum + s.duration, 0);
  return {
    asset,
    ...(audioSource ? { audioSource } : {}),
    clip: {
      assetId: id,
      at,
      duration: scene.duration,
      sourceStartSec: 0,
      fit: "cover" as const,
    },
  };
}

export async function listCodeMotionImportedVideos(
  userId: string,
  projectId: string
) {
  const prefix = spatialPrefix(userId, projectId).replace(
    /spatial\/$/,
    "imported-video/"
  );
  const names = await codeMotionStorage.list(prefix);
  const records = [];
  for (const name of names.filter(n => n.endsWith(".json"))) {
    const raw = await codeMotionStorage.read(name);
    if (!raw) continue;
    const receipt = JSON.parse(raw.body.toString());
    records.push({
      asset: codeMotionVideoAssetSchema.parse(receipt.asset),
      ...(receipt.audioSource
        ? {
            audioSource: codeMotionAudioSourceSchema.parse(receipt.audioSource),
          }
        : {}),
      name: String(receipt.name),
      sourceNote: String(receipt.sourceNote),
      chargedCredits: 0 as const,
      provenance: "user_import" as const,
    });
  }
  return records;
}
export async function adoptCodeMotionImportedVideo(
  userId: string,
  input: {
    projectId: string;
    expectedGeneration: string;
    sceneIndex: number;
    assetId: string;
  }
) {
  const saved = await loadCodeMotion(userId, input.projectId);
  if (!saved || saved.generation !== input.expectedGeneration)
    throw Error("作品版本已变化，请先保存");
  const record = (
    await listCodeMotionImportedVideos(userId, input.projectId)
  ).find(r => r.asset.id === input.assetId);
  const scene = saved.project.plan?.scenes[input.sceneIndex];
  if (!record || !scene || scene.duration > record.asset.durationSec)
    throw Error("已有片段不存在或短于目标镜头，未重新生成");
  return {
    asset: record.asset,
    ...(record.audioSource ? { audioSource: record.audioSource } : {}),
    clip: {
      assetId: record.asset.id,
      at: saved.project
        .plan!.scenes.slice(0, input.sceneIndex)
        .reduce((sum, s) => sum + s.duration, 0),
      duration: scene.duration,
      sourceStartSec: 0,
      fit: "cover" as const,
    },
  };
}
