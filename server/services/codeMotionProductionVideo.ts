import { codeMotionVideoDurationMatches } from "./codeMotionVideoDuration";
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
import { formatPromptForEngine, hasBlockingFormatIssues } from "../../shared/promptFormatLayer";
import {
  codeMotionVideoAssetSchema,
  type CodeMotionVideo,
} from "../../shared/codeMotionVideo";
import { canvasVideoClipCredits } from "../../shared/canvasGenerationPricing";
import {
  codeMotionStorage,
  loadCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import { assertCodeMotionImageSource } from "./codeMotionImport";
import { assertCodeMotionAudioOwnership } from "./codeMotionAudio";
import { inkSource } from "./inkFreeQuota";
import {
  ensureCodeMotionProductionGrant,
  reserveCodeMotionProductionSlot,
  assertCodeMotionProductionSlot,
  getCodeMotionProductionGrant,
  resolveCodeMotionProductionTier,
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
import {
  buildByteplusSeedance25SubmitBody,
  isByteplusSeedanceConfigured,
} from "./byteplusSeedanceVideo";
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
  version: "2.0-mini" | "2.0" | "2.5";
  resolution: "480p" | "720p";
  mode: "image_to_video" | "reference_to_video" | "video_edit";
  editSource?: import("./codeMotionRevisionEdit").CodeMotionEditSource;
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
    const dialogue = scene.speech?.role === "dialogue" && !!scene.speech.text.trim();
    if (production?.motion !== "natural" && !dialogue) continue;
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
    const videoUrls = (production?.referenceVideoIds || []).map(id => {
      const asset = project.plan!.codeVideo?.assets.find(a => a.id === id);
      if (!asset) throw new Error("参考视频尚未保存或已移除");
      return asset.videoUri;
    });
    const sourceIds = new Set(
      (project.plan.audioTimeline || [])
        .filter(c => c.at < at && c.at + c.duration > start && c.volume > 0)
        .map(c => c.sourceId)
    );
    const audioUrls = (project.brief.audios || [])
      .filter(source => sourceIds.has(source.id))
      .map(source => source.gcsUri);
    const duration = scene.duration;
    const maximumDuration = tier === "paid" ? 30 : 5;
    if (!Number.isInteger(duration) || duration < 4 || duration > maximumDuration)
      throw new Error(
        `画面${sceneIndex + 1}${dialogue ? "对白口型" : "自然动作"}需要4–${maximumDuration}秒，请调整本镜时长${dialogue ? "并保留完整对白" : "，短镜可改为代码画面"}`
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
          source.generated.text === scene.speech!.text.trim() &&
          source.generated.voice === scene.speech!.voice &&
          (source.generated.emotion || "") === (scene.speech!.emotion || "") &&
          (source.generated.role || "narration") === (scene.speech!.role || "narration") &&
          (project.plan!.audioTimeline || []).some(clip =>
            clip.sourceId === source.id &&
            clip.role === (scene.speech!.role || "narration") &&
            Math.abs(clip.at - start) < 1e-6 && clip.trimStart === 0 &&
            Math.abs(clip.duration - source.duration) < 1e-6 &&
            clip.duration <= duration + 1e-6 && clip.volume > 0
          )
      )
    )
      missing.push(`请先生成并采用本镜${dialogue ? "对白" : "旁白"}`);
    const policy = planInkGeneratedShot({
      tier,
      duration,
      imageCount: Math.max(1, imageUrls.length),
      videoCount: videoUrls.length,
      audioCount: audioUrls.length,
    });
    let prompt = production?.videoPrompt || `${scene.heading}。${scene.body}。${scene.direction || ""}`;
    if (dialogue) {
      // The worker submits one actual window mix in audio_urls; never put its URL in <>.
      // Preserve the spoken words and use the existing Seedance dialect/limit validator.
      const formatted = formatPromptForEngine([
        prompt.replace(/【([^【】]*)】/g, "$1"),
        `本镜为画面内对白。分镜指定的唯一说话者使用${scene.speech!.voice === "female" ? "女声" : "男声"}；保持原分镜的说话者、听者、站位和视线对象，听者不张嘴抢话。`,
        `0秒至${duration}秒，@音频1 的人声只属于该说话者，台词原文：{${scene.speech!.text.trim()}}。逐字口型与参考中对白的实际起止同步，原句、音色、情绪、顺序不得交换、改词、截断或重复；说完后保留反应停顿。`,
        "(沿用 @音频1 中已有的配乐，不新增或覆盖配乐；对白时配乐压低，句尾恢复)",
        "不把画外旁白、配乐或音效当成对白，不重新合成或覆盖参考对白。无字幕、无画面文字；字幕由后期制作。",
      ].join("\n"), policy.version === "2.5" ? "seedance-2.5" : "seedance-2.0-mini", {
        durationSec: duration, imageRefCount: imageUrls.length, videoRefCount: videoUrls.length,
        // A missing voice blocks submission below; this is the planned single mixed reference.
        audioRefCount: 1, applyCensorReplacements: false,
      });
      if (hasBlockingFormatIssues(formatted.issues)) throw Error(formatted.issues.map(issue => issue.detailZh).join("；"));
      prompt = formatted.text;
    }
    shots.push({
      sceneIndex,
      at: start,
      duration,
      prompt,
      model: policy.model,
      version: policy.version,
      resolution: policy.resolution,
      mode: dialogue ? "reference_to_video" : policy.mode,
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
  /** Absent on historical EvoLink manifests: preserve their original intent identity. */
  providerRoute?: "byteplus-first" | "evolink-edit";
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
  const tier = grant?.tier ?? await resolveCodeMotionProductionTier(userId, saved.project);
  let shots: CodeMotionProductionVideoShot[];
  if (grant?.revision?.mode === "video_edit") {
    const { getCodeMotionRevisionPrice } = await import("./codeMotionRevision");
    const quote = await getCodeMotionRevisionPrice(userId, input.projectId);
    const scene = quote && saved.project.plan?.scenes[quote.shot.sceneIndex];
    if (
      !quote?.shot.editSource ||
      !scene ||
      scene.duration !== quote.shot.duration ||
      scene.production?.videoPrompt !== quote.shot.prompt
    )
      throw Error("原片修改已超出确认范围，请恢复原版本");
    shots = [quote.shot];
  } else shots = planCodeMotionProductionVideo(saved.project, tier);
  if (tier === "free" && shots.length > 2)
    throw new Error(
      "免费作品最多生成2个各不超过5秒的动作镜头，请先将其余对白改为画外旁白或代码画面"
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
    videoPreviews: shots.flatMap(s =>
      s.editSource
        ? [
            {
              sceneIndex: s.sceneIndex,
              url: signGsUriV4ReadUrl(s.editSource.providerReference?.videoUri ?? s.editSource.asset.videoUri, 3600),
            },
          ]
        : []
    ),
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
  let manifest = await readManifest(userId, input.projectId);
  const editing = prepared.grant?.revision?.mode === "video_edit";
  const byteplusFirst = manifest
    ? manifest.providerRoute === "byteplus-first"
    : !editing;
  if (byteplusFirst && prepared.grant?.revision?.mode === "paid_video")
    throw new Error(
      "本次局部动作修改须先核定BytePlus及回落通道成本，尚未提交、未扣费；已有EvoLink任务可继续恢复"
    );
  if (
    byteplusFirst
      ? !isByteplusSeedanceConfigured()
      : !isEvolinkSeedanceConfigured()
  )
    throw new Error(
      byteplusFirst
        ? "BytePlus视频服务暂不可用，未提交、未扣费；仅上游明确拒绝后才回落EvoLink"
        : "原EvoLink任务服务暂不可用，请稍后恢复原任务"
    );
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
  if (manifest && manifest.fingerprint !== prepared.fingerprint)
    throw new Error("视频制作已提交，请恢复原任务；不重复生成");
  if (!manifest) {
    manifest = {
      providerRoute: editing ? "evolink-edit" : "byteplus-first",
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
    if (shot.editSource) {
      const { verifyCodeMotionEditSource } = await import(
        "./codeMotionRevisionEdit"
      );
      await verifyCodeMotionEditSource(userId, shot.editSource);
    }
    const providerAudioUrls = await prepareCodeMotionProductionAudio(
      userId,
      saved.project,
      shot
    );
    // Build the existing BytePlus request against owned, server-signed references; worker resolves them again.
    const useByteplus = manifest.providerRoute === "byteplus-first";
    if (useByteplus) {
      if (shot.version === "2.0") throw new Error("标准2.0原片编辑必须使用已确认的EvoLink通道");
      if (!isByteplusSeedanceConfigured())
        throw new Error("BytePlus视频服务暂不可用，未提交、未扣费");
      const signed = (uri: string) =>
        uri.startsWith("gs://") ? signGsUriV4ReadUrl(uri, 3600) : uri;
      buildByteplusSeedance25SubmitBody({
        version: shot.version,
        prompt: shot.prompt,
        imageUrls: shot.imageUrls.map(signed),
        videoUrls: shot.videoUrls.map(signed),
        audioUrls: providerAudioUrls.map(signed),
        mode: shot.mode,
        duration: shot.duration,
        resolution: shot.resolution,
        aspectRatio:
          saved.project.brief.orientation === "portrait" ? "9:16" : "16:9",
        generateAudio: true,
        watermark: false,
      });
    } else
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
      engine: useByteplus
        ? shot.version === "2.5"
          ? ("seedance25-byteplus" as const)
          : ("seedance-mini-byteplus" as const)
        : shot.version === "2.5"
          ? ("seedance25-evolink" as const)
          : shot.version === "2.0"
            ? ("seedance20-evolink" as const)
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
      ...(shot.version === "2.0-mini" || shot.version === "2.0"
        ? { seedanceVersion: shot.version }
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
            ...(["paid_video", "video_edit"].includes(
              grant.revision?.mode || ""
            )
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
    const costFile=shot.editSource ? await codeMotionStorage.read(`${prefix(userId,projectId)}video-evidence/${shot.sceneIndex}/cost-settlement.json`) : null;
    const cost=costFile?JSON.parse(costFile.body.toString()):null;
    shots.push({
      ...shot,
      costStatus:cost?.taskId===taskId?String(cost.status):undefined,
      settledCredits:cost?.taskId===taskId?Number(cost.creditsCharged):undefined,
      creditsRefunded:cost?.taskId===taskId?Number(cost.creditsRefunded):undefined,
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
    const videoStream = probe.streams?.find(
      (s: { codec_type: string }) => s.codec_type === "video"
    );
    const duration = Number(videoStream?.duration ?? probe.format?.duration);
    if (!videoStream) throw new Error("视频缺少可解码的视频轨");
    if (shot.editSource) {
      const { adoptCodeMotionEditedVideo } = await import(
        "./codeMotionRevisionEditSettlement"
      );
      const asset = await adoptCodeMotionEditedVideo(
        userId,
        projectId,
        shot.taskId,
        videoUri,
        file,
        duration,
        shot.duration,
        dir
      );
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
    }
    if (
      !videoStream ||
      !codeMotionVideoDurationMatches(duration, shot.duration)
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
  if (["paid_video", "video_edit"].includes(grant.revision?.mode || "")) {
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
  const legacyEngine =
    grant.tier === "free" ? "seedance-mini-evolink" : "seedance25-evolink";
  const primaryEngine =
    grant.tier === "free" ? "seedance-mini-byteplus" : "seedance25-byteplus";
  const engineAllowed =
    manifest?.providerRoute === "evolink-edit"
      ? !!shot.editSource &&
        task.engine ===
          (grant.tier === "free" ? "seedance20-evolink" : "seedance25-evolink")
      : manifest?.providerRoute === "byteplus-first"
        ? task.engine === primaryEngine ||
          (task.engine === legacyEngine && !!task.fallbackReason)
        : task.engine === legacyEngine;
  if (
    !engineAllowed ||
    (shot.editSource && shot.version === "2.0" && task.seedanceVersion !== "2.0") ||
    task.duration !== shot.duration ||
    task.resolution !== shot.resolution ||
    task.prompt !== shot.prompt ||
    task.workMode !== shot.mode ||
    JSON.stringify(task.imageUrls || []) !== JSON.stringify(shot.imageUrls) ||
    JSON.stringify(task.videoUrls || []) !== JSON.stringify(shot.videoUrls) ||
    JSON.stringify(task.audioUrls || []) !==
      JSON.stringify(audio ? [audio.uri] : []) ||
    (grant.tier === "free" && task.creditsCharged !== 0) ||
    (["paid_video", "video_edit"].includes(grant.revision?.mode || "") &&
      task.creditsCharged !== shot.credits)
  )
    throw new Error("视频制作参数或账务与本次授权不一致");
}
