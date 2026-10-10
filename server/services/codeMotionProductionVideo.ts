import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Request } from "express";
import type { VercelRequest } from "@vercel/node";
import {
  planInkGeneratedShot,
  type InkProductionTier,
} from "../../shared/inkVideoProductionPolicy";
import type { CodeMotionProject } from "../../shared/codeMotion";
import {
  codeMotionVideoAssetSchema,
  type CodeMotionVideo,
} from "../../shared/codeMotionVideo";
import { canvasVideoClipCredits } from "../../shared/canvasGenerationPricing";
import { canUsePaidVideoByPlan } from "../../shared/paidVideoAccess";
import {
  codeMotionStorage,
  loadCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import { getUserPlan } from "../credits";
import { assertCodeMotionImageSource } from "./codeMotionImport";
import { assertCodeMotionAudioOwnership } from "./codeMotionAudio";
import { inkSource } from "./inkFreeQuota";
import {
  ensureCodeMotionProductionGrant,
  reserveCodeMotionProductionSlot,
  assertCodeMotionProductionSlot,
  getCodeMotionProductionGrant,
  codeMotionProductionId,
  codeMotionProductionDigest,
  type CodeMotionProductionSlot,
} from "./codeMotionProductionGrant";
import {
  createCanvasVideoTask,
  peekCanvasVideoTask,
  getCanvasVideoTask,
  type CanvasVideoTaskRecord,
} from "./canvasVideoTask";
import {
  buildEvolinkSeedanceRequest,
  isEvolinkSeedanceConfigured,
} from "./evolinkSeedanceVideo";
import { fetchPostProdSourceToFile, runMediaTool } from "./postProduction";
import { getGcsBucketName, signGsUriV4ReadUrl } from "./gcs";
import {
  codeMotionProductionAudioFingerprint,
  prepareCodeMotionProductionAudio,
  getCodeMotionProductionAudio,
} from "./codeMotionProductionAudio";
import { normalizePostProdObjectName } from "./postProdMediaSource";
import {
  gateCanvasIntentBeforeCharge,
  canvasIntentStepReply,
  markCanvasIntentStage,
  releaseCanvasIntentAfterChargeFailure,
  chargeCanvasVideoCredits,
  refundCanvasChargeOnCreateFail,
} from "../../api/jobs";

export type CodeMotionProductionVideoShot = {
  sceneIndex: number;
  at: number;
  duration: number;
  prompt: string;
  model: string;
  version: "2.0-mini" | "2.5";
  resolution: "480p" | "720p";
  mode: "image_to_video" | "reference_to_video";
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
  audioFingerprint?: string;
  credits: number;
  missing: string[];
};
export function planCodeMotionProductionVideo(
  project: CodeMotionProject,
  tier: InkProductionTier
) {
  if (!project.plan) throw new Error("请先保存分镜");
  let at = 0;
  const shots: CodeMotionProductionVideoShot[] = [];
  for (
    let sceneIndex = 0;
    sceneIndex < project.plan.scenes.length;
    sceneIndex++
  ) {
    const scene = project.plan.scenes[sceneIndex];
    const start = at;
    at += scene.duration;
    const production = scene.production;
    if (production?.motion !== "natural") continue;
    const selectedIds = scene.imageId
      ? [scene.imageId]
      : Array.from(
          new Set(
            (scene.composition?.elements || []).flatMap(element =>
              element.type === "image" ? [element.imageId] : []
            )
          )
        );
    const imageUrls = selectedIds
      .map(id => project.brief.images.find(image => image.id === id)?.gcsUri)
      .filter((uri): uri is string => !!uri);
    const videoUrls = (production.referenceVideoIds || []).map(id => {
      const asset = project.plan!.codeVideo?.assets.find(a => a.id === id);
      if (!asset) throw new Error("参考视频尚未保存或已移除");
      return asset.videoUri;
    });
    const sourceIds = new Set(
      (project.plan.audioTimeline || [])
        .filter(c => c.at < at && c.at + c.duration > start)
        .map(c => c.sourceId)
    );
    const audioUrls = (project.brief.audios || [])
      .filter(source => sourceIds.has(source.id))
      .map(source => source.gcsUri);
    const duration = scene.duration;
    if (!Number.isInteger(duration) || duration < 4 || duration > 5)
      throw new Error(
        `画面${sceneIndex + 1}自然动作需要4–5秒，短镜请改为代码画面`
      );
    const missing: string[] = [];
    if (!imageUrls.length && !videoUrls.length)
      missing.push("请先生成并采用本镜场景图");
    if (
      scene.speech?.text &&
      !(project.brief.audios || []).some(
        source =>
          sourceIds.has(source.id) &&
          source.generated?.kind === "speech" &&
          source.generated.sceneIndex === sceneIndex &&
          source.generated.text === scene.speech!.text &&
          source.generated.voice === scene.speech!.voice
      )
    )
      missing.push("请先生成并采用本镜旁白");
    const policy = planInkGeneratedShot({
      tier,
      duration,
      imageCount: Math.max(1, imageUrls.length),
      videoCount: videoUrls.length,
      audioCount: audioUrls.length,
    });
    shots.push({
      sceneIndex,
      at: start,
      duration,
      prompt:
        production.videoPrompt ||
        `${scene.heading}。${scene.body}。${scene.direction || ""}`,
      model: policy.model,
      version: policy.version,
      resolution: policy.resolution,
      mode: policy.mode,
      imageUrls,
      videoUrls,
      audioUrls,
      ...(audioUrls.length
        ? {
            audioFingerprint: codeMotionProductionAudioFingerprint(
              project,
              start,
              duration
            ),
          }
        : {}),
      credits:
        tier === "free"
          ? 0
          : canvasVideoClipCredits({
              durationSec: duration,
              resolution: policy.resolution,
              videoModel: policy.model,
            }),
      missing,
    });
  }
  return shots;
}
type Manifest = {
  projectId: string;
  grantId: string;
  fingerprint: string;
  shots: CodeMotionProductionVideoShot[];
  createdAt: string;
};
function prefix(userId: string, projectId: string) {
  return `code-motion/u${userId}/production/${projectId}/`;
}
const manifestName = (u: string, p: string) =>
  `${prefix(u, p)}video-manifest.json`;
async function readManifest(
  userId: string,
  projectId: string,
  storage = codeMotionStorage
) {
  const object = await storage.read(manifestName(userId, projectId));
  return object ? (JSON.parse(object.body.toString()) as Manifest) : null;
}
const intentId = (grantId: string, index: number) =>
  `ink_video_${codeMotionProductionId(`${grantId}:video:${index}`)}`;
export async function prepareCodeMotionProductionVideo(
  userId: string,
  input: { projectId: string; expectedGeneration: string },
  storage = codeMotionStorage
) {
  const saved = await loadCodeMotion(userId, input.projectId, storage);
  if (!saved || saved.generation !== input.expectedGeneration)
    throw new Error("作品版本已变化，请先保存");
  const grant = await getCodeMotionProductionGrant(userId, input.projectId);
  const tier =
    grant?.tier ||
    (canUsePaidVideoByPlan(await getUserPlan(Number(userId)))
      ? "paid"
      : "free");
  let shots = planCodeMotionProductionVideo(saved.project, tier);
  if (tier === "free" && shots.length > 2)
    throw new Error(
      "免费作品最多生成2个各不超过5秒的动作镜头，请先将其余镜头改为代码画面"
    );
  if (grant?.revision) {
    shots = shots.filter(s =>
      grant.revision!.sceneIndexes.includes(s.sceneIndex)
    );
    if (grant.revision.mode === "paid_video") {
      const { getCodeMotionRevisionPrice } = await import(
        "./codeMotionRevision"
      );
      const quote = await getCodeMotionRevisionPrice(userId, input.projectId);
      if (!quote || shots.length !== 1) throw new Error("局部修改报价无法恢复");
      shots[0].credits = quote.credits;
      if (
        codeMotionProductionDigest(shots[0]) !==
        codeMotionProductionDigest(quote.shot)
      )
        throw new Error("动作修改内容已超出确认报价，请恢复原版本");
    }
  }
  const fingerprint = codeMotionProductionDigest({
    projectId: input.projectId,
    shots,
  });
  return {
    grant,
    tier,
    shots,
    totalCredits: shots.reduce((n, s) => n + s.credits, 0),
    fingerprint,
  };
}
/** Real production entry: durable immutable manifest → fixed budget slot → existing intent/charge/task worker. */
export async function submitCodeMotionProductionVideo(
  userId: string,
  input: {
    projectId: string;
    expectedGeneration: string;
    confirmedFingerprint: string;
  },
  req: Request
) {
  const prepared = await prepareCodeMotionProductionVideo(userId, input);
  if (prepared.fingerprint !== input.confirmedFingerprint)
    throw new Error("生成内容已变化，请重新查看本次安排");
  if (prepared.shots.some(s => s.missing.length))
    throw new Error(prepared.shots.flatMap(s => s.missing).join("；"));
  if (!prepared.shots.length) return { grant: prepared.grant, shots: [] };
  if (!isEvolinkSeedanceConfigured())
    throw new Error("视频服务暂不可用，未提交、未扣费");
  const saved = (await loadCodeMotion(userId, input.projectId))!;
  for (const image of saved.project.brief.images)
    await assertCodeMotionImageSource(userId, image.gcsUri);
  if (saved.project.brief.audios?.length)
    await assertCodeMotionAudioOwnership({
      userId,
      projectId: input.projectId,
      audio: {
        sources: saved.project.brief.audios,
        audioTimeline: saved.project.plan!.audioTimeline || [],
      },
    });
  if (saved.project.plan?.codeVideo)
    await assertCodeMotionProductionVideos(
      userId,
      input.projectId,
      saved.project.plan.codeVideo
    );
  const grant = await ensureCodeMotionProductionGrant(userId, {
    ...input,
    source: inkSource(req),
  });
  let manifest = await readManifest(userId, input.projectId);
  if (manifest && manifest.fingerprint !== prepared.fingerprint)
    throw new Error("视频制作已提交，请恢复原任务；不重复生成");
  if (!manifest) {
    manifest = {
      projectId: input.projectId,
      grantId: grant.id,
      fingerprint: prepared.fingerprint,
      shots: prepared.shots,
      createdAt: new Date().toISOString(),
    };
    try {
      await codeMotionStorage.write(
        manifestName(userId, input.projectId),
        Buffer.from(JSON.stringify(manifest)),
        "0"
      );
    } catch (error) {
      const old = await readManifest(userId, input.projectId);
      if (!old || old.fingerprint !== manifest.fingerprint) throw error;
      manifest = old;
    }
  }
  for (const shot of manifest.shots) {
    const requestId = intentId(grant.id, shot.sceneIndex);
    const slot: CodeMotionProductionSlot = {
      projectId: input.projectId,
      grantId: grant.id,
      kind: "video",
      index: shot.sceneIndex,
      requestId,
      digest: codeMotionProductionDigest(shot),
    };
    await reserveCodeMotionProductionSlot(userId, slot);
    await assertCodeMotionProductionSlot(userId, slot);
    const providerAudioUrls = await prepareCodeMotionProductionAudio(
      userId,
      saved.project,
      shot
    );
    // A build-only preflight preserves all three media arrays. No reference silently downgraded to image-only.
    buildEvolinkSeedanceRequest({
      version: shot.version,
      prompt: shot.prompt,
      imageUrls: shot.imageUrls,
      videoUrls: shot.videoUrls,
      audioUrls: providerAudioUrls,
      mode: shot.mode,
      duration: shot.duration,
      quality: shot.resolution,
      generateAudio: true,
    });
    const taskInput = {
      engine:
        shot.version === "2.5"
          ? ("seedance25-evolink" as const)
          : ("seedance-mini-evolink" as const),
      label: `映客画面${shot.sceneIndex + 1}`,
      prompt: shot.prompt,
      imageUrls: shot.imageUrls,
      videoUrls: shot.videoUrls,
      audioUrls: providerAudioUrls,
      aspectRatio:
        saved.project.brief.orientation === "portrait" ? "9:16" : "16:9",
      duration: shot.duration,
      resolution: shot.resolution,
      generateAudio: true,
      workMode: shot.mode,
      ...(shot.version === "2.0-mini"
        ? { seedanceVersion: "2.0-mini" as const }
        : {}),
    };
    const gate = await gateCanvasIntentBeforeCharge({
      userId: Number(userId),
      intentId: requestId,
      operation: "inkVideoProduction",
      taskInput,
    });
    const reply = await canvasIntentStepReply(gate.step, Number(userId));
    if (reply) {
      if (reply.status >= 400)
        throw new Error(String(reply.body.error || "原任务待核对"));
      continue;
    }
    const charged =
      grant.tier === "free"
        ? {
            ok: true as const,
            userId: Number(userId),
            credits: 0,
            deduct: undefined,
            chargeKey: undefined,
          }
        : await chargeCanvasVideoCredits(req as unknown as VercelRequest, {
            idempotencyKey: requestId,
            durationSec: shot.duration,
            resolution: shot.resolution,
            videoModel: shot.model,
            label: taskInput.label,
            ...(grant.revision?.mode === "paid_video"
              ? {
                  pricingMode: "inkRevisionVideo" as const,
                  inkRevisionSlot: slot,
                }
              : {}),
          });
    if (!charged.ok) {
      await releaseCanvasIntentAfterChargeFailure({
        userId: Number(userId),
        intentId: requestId,
        holderId: gate.holderId,
      });
      throw new Error(charged.error);
    }
    if (
      !(await markCanvasIntentStage({
        userId: Number(userId),
        intentId: requestId,
        holderId: gate.holderId,
        stage: "charged",
        chargeKey: charged.chargeKey,
      }))
    )
      continue;
    try {
      await createCanvasVideoTask({
        ...taskInput,
        inkProduction: slot,
        taskId: gate.taskId,
        userId: Number(userId),
        creditsCharged: charged.credits,
        deduct: charged.deduct,
        idempotencyKey: requestId,
      });
      await markCanvasIntentStage({
        userId: Number(userId),
        intentId: requestId,
        holderId: gate.holderId,
        stage: "task_created",
      });
    } catch (error) {
      const existing = await peekCanvasVideoTask(gate.taskId, Number(userId));
      if (
        !existing ||
        (error instanceof Error &&
          error.message === "paid_job_ledger_register_failed")
      )
        await refundCanvasChargeOnCreateFail(charged, taskInput.label);
      throw error;
    }
  }
  return listCodeMotionProductionVideo(userId, input.projectId);
}
export async function listCodeMotionProductionVideo(
  userId: string,
  projectId: string
) {
  const manifest = await readManifest(userId, projectId);
  const grant = await getCodeMotionProductionGrant(userId, projectId);
  if (!manifest) return { grant, shots: [] };
  const { lookupCanvasIntent } = await import("./canvasGenerationIntent");
  const shots = [];
  for (const shot of manifest.shots) {
    const intent = await lookupCanvasIntent({
      userId: Number(userId),
      intentId: intentId(manifest.grantId, shot.sceneIndex),
    });
    const taskId = intent.kind === "ok" ? intent.record.taskId : undefined;
    const task = taskId
      ? await getCanvasVideoTask(taskId, Number(userId))
      : null;
    shots.push({
      ...shot,
      taskId,
      status:
        task?.status ||
        (intent.kind === "unreadable"
          ? "reconcile_manual"
          : intent.kind === "ok"
            ? "creating"
            : "not_started"),
      videoUrl: task?.videoUrl
        ? (() => {
            const object = extractSystemGcsObjectPath(task.videoUrl!);
            return object
              ? signGsUriV4ReadUrl(`gs://${getGcsBucketName()}/${object}`, 3600)
              : task.videoUrl;
          })()
        : undefined,
      error:
        task?.error ||
        (intent.kind === "unreadable" ? intent.reasonZh : undefined),
    });
  }
  return { grant, shots };
}
const assetName = (userId: string, projectId: string, id: string) =>
  `${prefix(userId, projectId)}video-sources/${id}.json`;
export async function adoptCodeMotionProductionVideo(
  userId: string,
  projectId: string,
  sceneIndex: number
) {
  const result = await listCodeMotionProductionVideo(userId, projectId);
  const shot = result.shots.find(s => s.sceneIndex === sceneIndex);
  if (!shot || shot.status !== "succeeded" || !shot.videoUrl || !shot.taskId)
    throw new Error("本镜视频尚未成功，不能采用");
  const existing = await codeMotionStorage.read(
    assetName(userId, projectId, shot.taskId)
  );
  if (existing) {
    const asset = codeMotionVideoAssetSchema.parse(
      JSON.parse(existing.body.toString())
    );
    return {
      asset,
      clip: {
        assetId: asset.id,
        at: shot.at,
        duration: shot.duration,
        sourceStartSec: 0,
        fit: "cover" as const,
      },
    };
  }
  const object = extractSystemGcsObjectPath(shot.videoUrl);
  if (!object) throw new Error("视频尚未永久归档，不能采用");
  const videoUri = `gs://${getGcsBucketName()}/${object}`;
  const dir = await mkdtemp(path.join(tmpdir(), "ink-video-"));
  const file = path.join(dir, "source.mp4");
  try {
    await fetchPostProdSourceToFile(videoUri, file, {
      signal: AbortSignal.timeout(90_000),
      maxBytes: 150_000_000,
    });
    const raw = await runMediaTool(
      "ffprobe",
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
      AbortSignal.timeout(30_000)
    );
    const probe = JSON.parse(raw.stdout);
    const duration = Number(probe.format?.duration);
    if (
      !probe.streams?.some(
        (s: { codec_type: string }) => s.codec_type === "video"
      ) ||
      !Number.isFinite(duration) ||
      Math.abs(duration - shot.duration) > 0.08
    )
      throw new Error("视频实际时长与本镜回执不一致");
    const asset = codeMotionVideoAssetSchema.parse({
      id: shot.taskId,
      videoUri,
      sha256: createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
      durationSec: shot.duration,
    });
    await codeMotionStorage.write(
      assetName(userId, projectId, asset.id),
      Buffer.from(JSON.stringify(asset)),
      "0"
    );
    return {
      asset,
      clip: {
        assetId: asset.id,
        at: shot.at,
        duration: shot.duration,
        sourceStartSec: 0,
        fit: "cover" as const,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function assertCodeMotionProductionVideos(
  userId: string,
  projectId: string,
  video: CodeMotionVideo,
  storage: CodeMotionStoreDeps = codeMotionStorage
) {
  for (const asset of video.assets) {
    let old = await storage.read(assetName(userId, projectId, asset.id));
    if (!old) {
      const { codeMotionRevisionAssetParent } = await import(
        "./codeMotionRevision"
      );
      const parent = await codeMotionRevisionAssetParent(
        userId,
        projectId,
        "video",
        asset,
        storage
      );
      if (parent) old = await storage.read(assetName(userId, parent, asset.id));
    }
    if (
      !old ||
      codeMotionProductionDigest(JSON.parse(old.body.toString())) !==
        codeMotionProductionDigest(asset)
    )
      throw new Error("视频素材元数据与本作品生产回执不一致");
  }
}

function extractSystemGcsObjectPath(source: string): string | null {
  const bucket = getGcsBucketName();
  const gs = source.match(/^gs:\/\/([^/]+)\/(.+)$/i);
  if (gs) return gs[1] === bucket ? normalizePostProdObjectName(gs[2]) : null;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com")
      return null;
    const parts = url.pathname.slice(1).split("/");
    return decodeURIComponent(parts.shift() || "") === bucket
      ? normalizePostProdObjectName(decodeURIComponent(parts.join("/")))
      : null;
  } catch {
    return null;
  }
}

/** Worker rechecks the immutable manifest, complete media arrays and budget before any costly submission. */
export async function assertCodeMotionProductionVideoTask(
  task: CanvasVideoTaskRecord
) {
  const slot = task.inkProduction;
  if (!slot) return;
  const grant = await assertCodeMotionProductionSlot(String(task.userId), slot);
  if (grant.revision?.mode === "paid_video") {
    const { codeMotionRevisionCharge } = await import(
      "./codeMotionRevisionPricing"
    );
    if (
      task.creditsCharged !==
      (await codeMotionRevisionCharge(String(task.userId), slot))
    )
      throw new Error("局部修改扣费未匹配报价，未提交供应商");
  }
  const manifest = await readManifest(String(task.userId), slot.projectId);
  const shot = manifest?.shots.find(s => s.sceneIndex === slot.index);
  if (
    !shot ||
    slot.kind !== "video" ||
    codeMotionProductionDigest(shot) !== slot.digest ||
    slot.requestId !== task.idempotencyKey
  )
    throw new Error("视频制作回执不一致，未提交供应商");
  const audio = shot.audioFingerprint
    ? await getCodeMotionProductionAudio(
        String(task.userId),
        slot.projectId,
        shot.audioFingerprint
      )
    : null;
  if (shot.audioFingerprint && !audio) throw new Error("本镜参考音频尚未归档");
  const expectedEngine =
    grant.tier === "free" ? "seedance-mini-evolink" : "seedance25-evolink";
  if (
    task.engine !== expectedEngine ||
    task.duration !== shot.duration ||
    task.resolution !== shot.resolution ||
    task.prompt !== shot.prompt ||
    task.workMode !== shot.mode ||
    JSON.stringify(task.imageUrls || []) !== JSON.stringify(shot.imageUrls) ||
    JSON.stringify(task.videoUrls || []) !== JSON.stringify(shot.videoUrls) ||
    JSON.stringify(task.audioUrls || []) !==
      JSON.stringify(audio ? [audio.uri] : []) ||
    (grant.tier === "free" && task.creditsCharged !== 0) ||
    (grant.revision?.mode === "paid_video" &&
      task.creditsCharged !== shot.credits)
  )
    throw new Error("视频制作参数或账务与本次授权不一致");
}
