import { z } from "zod";
import { artMotionStateSchema } from "./artMotion";
import { manhuaPrevisStudioSchema } from "./manhuaPrevis";

export const digitalHumanSceneInputSchema = z
  .object({
    requestId: z.string().uuid(),
    description: z.string().trim().min(4).max(2000),
    aspectRatio: z.enum(["9:16", "16:9"]),
  })
  .strict();
export type DigitalHumanSceneInput = z.infer<
  typeof digitalHumanSceneInputSchema
>;

/** 场景图只负责环境，人像将在视频请求中独立绑定。 */
export function digitalHumanScenePrompt(input: DigitalHumanSceneInput): string {
  return `生成一张用于真人口播视频的场景参考照片，${input.aspectRatio}构图。\n场景要求：${input.description}\n只呈现环境，不出现人物、拼图、字幕、商标或界面。为一位面对镜头的讲述者留出自然站立或坐下的空间，光源方向清楚，尺度可信。`;
}

const mediaSchema = z.object({
  source: z
    .string()
    .regex(/^(gs:\/\/|https:\/\/)/)
    .max(5000),
  name: z.string().max(200),
});
const statusSchema = z.enum([
  "submitted",
  "running",
  "succeeded",
  "failed",
  "unknown",
]);
const dialogueRequestSchema = z.object({
  billingRequestId: z.string().uuid(),
  input: z.string().min(1).max(4000),
  voice: z.string().min(1).max(80),
  speakerZh: z.string(),
  speakerId: z.string(),
  voiceStateZh: z.string(),
});
const audioReceiptSchema = z.object({
  request: dialogueRequestSchema,
  status: statusSchema,
  jobId: z.string().optional(),
  source: z.string().optional(),
  durationSec: z.number().positive().optional(),
  creditsCost: z.number().optional(),
  canResumeSettlement: z.boolean().optional(),
  message: z.string().optional(),
});
const sceneReceiptSchema = z.object({
  request: digitalHumanSceneInputSchema,
  status: statusSchema,
  jobId: z.string().optional(),
  source: z.string().optional(),
  message: z.string().optional(),
});
const referenceSchema = z.object({
  url: z.string(),
  gcsUri: z.string().optional(),
  fileName: z.string().optional(),
  durationSec: z.number().optional(),
  motionGuideZh: z.string().optional(),
  updatedAt: z.string(),
});
const modelSchema = z.object({
  taskId: z.string(),
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "reconcile_manual",
  ]),
  sourceImageUrl: z.string(),
  sourceVersion: z.string(),
  glbUrl: z.string().optional(),
  glbGcsUri: z.string().optional(),
  errorZh: z.string().optional(),
  updatedAt: z.number(),
});
const actorSchema = z.object({
  id: z.string(),
  labelZh: z.string(),
  portrait: mediaSchema,
  model: modelSchema.optional(),
  x: z.number(),
  y: z.number(),
  yaw: z.number(),
});
const upscaleSchema = z.object({
  status: statusSchema,
  taskId: z.string().optional(),
  source: z.string().optional(),
  inputSource: z.string(),
  durationSec: z.number(),
  sourceResolution: z.string(),
  message: z.string().optional(),
});
const videoReceiptSchema = z.object({
  requestId: z.string().uuid(),
  fingerprint: z.string(),
  status: statusSchema,
  taskId: z.string().optional(),
  intentId: z.string().optional(),
  intentStatus: z.string().optional(),
  submissionStarted: z.boolean().optional(),
  source: z.string().optional(),
  message: z.string().optional(),
  upscale: upscaleSchema.optional(),
  extraPortraits: z.array(mediaSchema).default([]),
  stageFrame: mediaSchema.optional(),
  previs: referenceSchema.optional(),
  prompt: z.string(),
  portrait: mediaSchema,
  scene: mediaSchema,
  audioSource: z.string(),
  audioRequestId: z.string(),
  durationSec: z.number().min(4).max(30),
  aspectRatio: z.enum(["9:16", "16:9"]),
});
export const digitalHumanDraftSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  owner: z.string().min(1),
  portrait: mediaSchema.optional(),
  scene: mediaSchema.optional(),
  sceneDescription: z.string().max(2000),
  script: z.string().max(4000),
  voiceId: z.string().max(80),
  aspectRatio: z.enum(["9:16", "16:9"]),
  direction: z.string().max(1500),
  modelRequests: z
    .array(
      z.object({
        assetRef: z.string(),
        sourceVersion: z.string(),
        submittedAt: z.string(),
      })
    )
    .default([]),
  worldRequest: z
    .object({
      sceneRef: z.string(),
      sourceVersion: z.string(),
      model: z.enum([
        "marble-1.1-plus",
        "marble-1.1",
        "marble-1.0",
        "marble-1.0-draft",
      ]),
      textPrompt: z.string(),
      submittedAt: z.string(),
    })
    .optional(),
  mainModel: modelSchema.optional(),
  mainStage: z
    .object({ x: z.number(), y: z.number(), yaw: z.number() })
    .optional(),
  modelHistory: z
    .array(z.object({ assetRef: z.string(), model: modelSchema }))
    .default([]),
  spatialRenders: z
    .array(z.object({ id: z.string(), state: artMotionStateSchema }))
    .default([]),
  actors: z.array(actorSchema).default([]),
  worldTaskId: z.string().optional(),
  stageFrame: z
    .object({ media: mediaSchema, sourceFingerprint: z.string() })
    .optional(),
  spatialRenderCandidate: z
    .object({ reference: referenceSchema, sourceFingerprint: z.string() })
    .optional(),
  previsStudio: manhuaPrevisStudioSchema.optional(),
  previs: z
    .object({
      reference: referenceSchema,
      sourceFingerprint: z.string(),
      reviewed: z.boolean(),
      review: z
        .object({
          notes: z.string(),
          frameCount: z.number().int().positive(),
          reviewedAt: z.string(),
        })
        .optional(),
    })
    .optional(),
  cloneRequest: z
    .object({
      requestId: z.string().uuid(),
      gcsUri: z.string(),
      labelZh: z.string(),
      consent: z.literal(true),
    })
    .optional(),
  approvedAudioRequestId: z.string().optional(),
  audios: z.array(audioReceiptSchema),
  scenes: z.array(sceneReceiptSchema),
  videos: z.array(videoReceiptSchema),
});
export type DigitalHumanDraft = z.infer<typeof digitalHumanDraftSchema>;
export type DigitalHumanMedia = z.infer<typeof mediaSchema>;
export type DigitalHumanAudio = z.infer<typeof audioReceiptSchema>;
export type DigitalHumanVideo = z.infer<typeof videoReceiptSchema>;
export type DigitalHumanScene = z.infer<typeof sceneReceiptSchema>;

export function newDigitalHumanDraft(
  owner: string,
  id: string
): DigitalHumanDraft {
  return {
    version: 1,
    id,
    owner,
    sceneDescription: "",
    script: "",
    voiceId: "",
    aspectRatio: "9:16",
    direction:
      "面对镜头自然讲述，中景，柔和自然光。按语意停顿与轻微手势，镜头保持稳定。",
    audios: [],
    scenes: [],
    videos: [],
    actors: [],
    spatialRenders: [],
    modelRequests: [],
    modelHistory: [],
  };
}
export function digitalHumanDraftKey(owner: string): string {
  return `mv.digital-human.v1.${owner}`;
}
export function loadDigitalHumanDraft(
  raw: string | null,
  owner: string
): DigitalHumanDraft | null {
  if (!raw) return null;
  const draft = digitalHumanDraftSchema.parse(JSON.parse(raw));
  if (draft.owner !== owner) throw new Error("草稿账号不匹配，已停止恢复");
  return draft;
}
export function currentDigitalHumanAudio(
  draft: DigitalHumanDraft
): DigitalHumanAudio | undefined {
  return [...draft.audios]
    .reverse()
    .find(
      row =>
        row.status === "succeeded" &&
        row.source &&
        row.durationSec &&
        row.request.input === draft.script.trim() &&
        row.request.voice === draft.voiceId
    );
}
export function digitalHumanPending(status: string): boolean {
  return !["succeeded", "failed"].includes(status);
}
export function digitalHumanVideoFingerprint(
  draft: DigitalHumanDraft,
  audio: DigitalHumanAudio
): string {
  return JSON.stringify({
    portrait: draft.portrait?.source,
    scene: draft.scene?.source,
    script: draft.script.trim(),
    voiceId: draft.voiceId,
    audio: audio.source,
    audioRequestId: audio.request.billingRequestId,
    approvedAudioRequestId: draft.approvedAudioRequestId,
    aspectRatio: draft.aspectRatio,
    direction: draft.direction.trim(),
    spatial: digitalHumanSpatialFingerprint(draft),
    stageFrame: draft.stageFrame,
    previs: draft.previs,
  });
}
export function prepareDigitalHumanVideo(
  draft: DigitalHumanDraft,
  requestId: string
): DigitalHumanVideo {
  if (!draft.portrait || !draft.scene) throw new Error("请先选择人像和场景图");
  if (draft.videos.some(row => digitalHumanPending(row.status)))
    throw new Error("请先核对原视频任务，不能重复生成");
  if (2 + draft.actors.length + (draft.stageFrame ? 1 : 0) > 30)
    throw new Error(
      "图片参考超过Seedance2.5的30张上限，请减少同场人物或参考图"
    );
  if (draft.actors.some(a => !a.labelZh.trim()))
    throw new Error("请补全每位同场人物的名称");
  const audio = currentDigitalHumanAudio(draft);
  if (!audio?.source || !audio.durationSec)
    throw new Error("请先用当前文案和所选声音生成配音并试听");
  if (draft.approvedAudioRequestId !== audio.request.billingRequestId)
    throw new Error("请先试听并确认当前配音的声音、读音和完整内容");
  if (audio.durationSec > 30)
    throw new Error(
      "这段配音超过30秒，请缩短文案后重新配音；原音频保留，不会截断"
    );
  const spatialFingerprint = digitalHumanSpatialFingerprint(draft);
  if (
    draft.stageFrame &&
    draft.stageFrame.sourceFingerprint !== spatialFingerprint
  )
    throw new Error("人物或场景已变化，请重新导出3D视角图");
  if (
    draft.previs &&
    (!draft.previs.reviewed ||
      draft.previs.sourceFingerprint !== spatialFingerprint)
  )
    throw new Error("白模输入已变化或尚未审片，请重新审查后采用");
  const durationSec = Math.max(4, Math.ceil(audio.durationSec));
  if (
    draft.previs &&
    (!draft.previs.reference.durationSec ||
      draft.previs.reference.durationSec < durationSec - 0.05 ||
      draft.previs.reference.durationSec > 30)
  )
    throw new Error("已采用预演的时长不能覆盖本次完整配音，请调整后重新审片");
  const prompt = `目标时长：${durationSec}秒。真人数字人口播视频，${draft.aspectRatio}。\n@图片1只用于讲述者身份、五官与服装，不沿用它的背景。@图片2只用于场景和空间光线，${draft.actors.length ? `另有${draft.actors.length}位人物，依次由${draft.actors.map((a, i) => `@图片${i + 3}绑定${a.labelZh}`).join("、")}。保留每位人物身份与在场状态，只有讲述者说话` : "不增加其他人物"}。将讲述者自然置于该场景中，保持真实肤色与身体比例。\n@音频1是本次完整对白，时长${audio.durationSec.toFixed(2)}秒。沿用这段声音的音色、语速、停顿和原话，人物口型对齐对应发音，不另造台词，不换声音，不添加背景音乐或字幕。\n完整文案：${draft.script.trim()}\n表演与镜头：${draft.direction.trim()}\n说完后自然停留至结束，不提前切断尾音。`;
  return {
    requestId,
    fingerprint: digitalHumanVideoFingerprint(draft, audio),
    status: "submitted",
    prompt,
    portrait: draft.portrait,
    scene: draft.scene,
    audioSource: audio.source,
    audioRequestId: audio.request.billingRequestId,
    durationSec,
    aspectRatio: draft.aspectRatio,
    extraPortraits: draft.actors.map(a => a.portrait),
    stageFrame: draft.stageFrame?.media,
    previs: draft.previs?.reference,
  };
}

/** 将空间参考绑定到真实素材、人物站位及白模稿；编辑后不能继续采用旧审片。 */
export function digitalHumanSpatialFingerprint(
  draft: DigitalHumanDraft
): string {
  return JSON.stringify({
    portrait: draft.portrait?.source,
    mainStage: draft.mainStage,
    scene: draft.scene?.source,
    world: draft.worldTaskId,
    actors: draft.actors.map(a => ({
      id: a.id,
      label: a.labelZh,
      portrait: a.portrait.source,
      model: a.model?.taskId,
      x: a.x,
      y: a.y,
      yaw: a.yaw,
    })),
    mainModel: draft.mainModel?.taskId,
    spec: draft.previsStudio?.spec,
    aspect: draft.aspectRatio,
    script: draft.script,
    direction: draft.direction,
  });
}

/** 仅发送前明确终止可释放重试；已发请求始终保留原编号核对。 */
export function digitalHumanVideoFailureStatus(
  row?: Pick<DigitalHumanVideo, "intentStatus" | "submissionStarted" | "taskId">
): "failed" | "unknown" {
  return row?.intentStatus === "settled" &&
    !row.submissionStarted &&
    !row.taskId
    ? "failed"
    : "unknown";
}
