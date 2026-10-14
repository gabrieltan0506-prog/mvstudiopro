import { z } from "zod";
import { platformStoryboardCellsSchema } from "./platformStoryboardCells";
import { artMotionStateSchema } from "./artMotion";
import { manhuaPrevisStudioSchema } from "./manhuaPrevis";
import { digitalHumanProductionReceiptSchema, digitalHumanSplitManifestSchema, digitalHumanVoiceSpaceSchema, digitalHumanMixTrackSchema, type DigitalHumanSplitManifest } from "./digitalHumanProduction";

/** 平台正式稿到数字人制作的来源合同；原文与逐镜信息一并保留。 */
export const digitalHumanSourceSchema = z.object({
  owner: z.string().min(1), blueprintId: z.string().min(1).max(160),
  version: z.string().min(1), title: z.string().max(200),
  platform: z.enum(["xiaohongshu", "douyin"]), aspectRatio: z.enum(["9:16", "16:9"]),
  script: z.string().trim().min(1).max(4000),
  detailedScript: z.string().max(20000),
  sceneDescription: z.string().max(2000), direction: z.string().max(1500),
  shots: platformStoryboardCellsSchema,
}).strict();
export type DigitalHumanSource = z.infer<typeof digitalHumanSourceSchema>;

export function adoptDigitalHumanSource(draft: DigitalHumanDraft, raw: DigitalHumanSource): DigitalHumanDraft {
  const source = digitalHumanSourceSchema.parse(raw);
  if (source.owner !== draft.owner) throw new Error("稿件账号不匹配，未采用");
  if (draft.videos.some(v => digitalHumanPending(v.status)) || draft.audios.some(a => digitalHumanPending(a.status)))
    throw new Error("原制作任务待核对，请先查询原任务");
  return digitalHumanDraftSchema.parse({ ...draft, source, script: source.script,
    aspectRatio: source.aspectRatio, sceneDescription: source.sceneDescription,
    direction: source.direction || draft.direction, approvedAudioRequestId: undefined });
}

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
  segment: z.object({ planRequestId: z.string().uuid(), index: z.number().int().min(0), startSec: z.number().min(0), endSec: z.number().positive() }).optional(),
  continuityFrame: mediaSchema.optional(),
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
  source: digitalHumanSourceSchema.optional(),
  advisorStorage: z.record(z.string(), z.string()).default({}),
  postProdStorage: z.record(z.string(), z.string()).default({}),
  productions: z.array(digitalHumanProductionReceiptSchema).default([]),
  mix: z.object({ voice: digitalHumanVoiceSpaceSchema, tracks: z.array(digitalHumanMixTrackSchema).max(12) }).default({ voice: { pan: 0, room: "dry", volume: 1 }, tracks: [] }),
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
    advisorStorage: {},
    postProdStorage: {},
    productions: [],
    mix: { voice: { pan: 0, room: "dry", volume: 1 }, tracks: [] },
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
    source: draft.source,
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
  requestId: string,
  part?: { manifest: DigitalHumanSplitManifest; planRequestId: string; index: number; continuityFrame?: DigitalHumanMedia; useReviewedPrevis?: boolean }
): DigitalHumanVideo {
  if (!draft.portrait || !draft.scene) throw new Error("请先选择人像和场景图");
  if (draft.videos.some(row => digitalHumanPending(row.status)))
    throw new Error("请先核对原视频任务，不能重复生成");
  if (2 + draft.actors.length + (draft.stageFrame ? 1 : 0) + (part?.continuityFrame ? 1 : 0) > 30)
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
  let audioSource = audio.source;
  let audioDuration = audio.durationSec;
  let segment: DigitalHumanVideo["segment"];
  if (part) {
    const manifest = digitalHumanSplitManifestSchema.parse(part.manifest);
    if (manifest.audioRequestId !== audio.request.billingRequestId || manifest.script !== draft.script.trim() || manifest.audioUri !== audio.source || Math.abs(manifest.durationSec - audio.durationSec) > 0.05)
      throw new Error("分段清单与当前完整配音不一致，请核对原任务");
    const plan = draft.productions.find(p => p.request.requestId === part.planRequestId && p.status === "succeeded");
    if (!plan?.manifest || JSON.stringify(plan.manifest) !== JSON.stringify(manifest)) throw new Error("未找到已保存的分段任务回执");
    const selected = manifest.segments[part.index];
    if (!selected) throw new Error("所选配音分段不存在");
    if (part.index > 0 && !part.continuityFrame) throw new Error("请先生成前段并导出衔接尾帧");
    audioSource = selected.audioUri; audioDuration = selected.endSec - selected.startSec;
    segment = { planRequestId: part.planRequestId, index: part.index, startSec: selected.startSec, endSec: selected.endSec };
  }
  if (audioDuration > 30.001)
    throw new Error(
      "这段配音超过30秒，请先按停顿分段，再逐段核对生成；原文与声音完整保留"
    );
  const selectedPrevis = part ? (part.useReviewedPrevis ? draft.previs : undefined) : draft.previs;
  if (part && draft.previs && part.useReviewedPrevis === undefined) throw new Error("请明确选择本段是否使用已审预演，不能自动忽略已采用的导演动作");
  const spatialFingerprint = digitalHumanSpatialFingerprint(draft);
  if (
    draft.stageFrame &&
    draft.stageFrame.sourceFingerprint !== spatialFingerprint
  )
    throw new Error("人物或场景已变化，请重新导出3D视角图");
  if (
    selectedPrevis &&
    (!selectedPrevis.reviewed ||
      selectedPrevis.sourceFingerprint !== spatialFingerprint)
  )
    throw new Error("白模输入已变化或尚未审片，请重新审查后采用");
  const durationSec = Math.max(4, Math.min(30, Math.ceil(audioDuration)));
  if (
    selectedPrevis &&
    (!selectedPrevis.reference.durationSec ||
      selectedPrevis.reference.durationSec < durationSec - 0.05 ||
      selectedPrevis.reference.durationSec > 30)
  )
    throw new Error("已采用预演的时长不能覆盖本次完整配音，请调整后重新审片");
  const prompt = `目标时长：${durationSec}秒。真人数字人口播视频，${draft.aspectRatio}。\n@图片1只用于讲述者身份、五官与服装，不沿用它的背景。@图片2只用于场景和空间光线，${draft.actors.length ? `另有${draft.actors.length}位人物，依次由${draft.actors.map((a, i) => `@图片${i + 3}绑定${a.labelZh}`).join("、")}。保留每位人物身份与在场状态，只有讲述者说话` : "不增加其他人物"}。将讲述者自然置于该场景中，保持真实肤色与身体比例。\n@音频1是本次完整对白，时长${audio.durationSec.toFixed(2)}秒。沿用这段声音的音色、语速、停顿和原话，人物口型对齐对应发音，不另造台词，不换声音，不添加背景音乐或字幕。\n完整文案：${draft.script.trim()}\n表演与镜头：${draft.direction.trim()}\n原分镜上下文：${draft.source?.shots.map(s => JSON.stringify(s)).join("\n") || "以当前人物和镜头要求为准"}\n说完后自然停留至结束，不提前切断尾音。`;
  return {
    requestId,
    fingerprint: digitalHumanVideoFingerprint(draft, audio),
    status: "submitted",
    prompt,
    portrait: draft.portrait,
    scene: draft.scene,
    audioSource,
    audioRequestId: audio.request.billingRequestId,
    durationSec,
    aspectRatio: draft.aspectRatio,
    extraPortraits: draft.actors.map(a => a.portrait),
    stageFrame: draft.stageFrame?.media,
    previs: selectedPrevis?.reference,
    ...(segment ? { segment, continuityFrame: part?.continuityFrame,
      fingerprint: digitalHumanSegmentFingerprint(draft, audio, segment, part?.continuityFrame, selectedPrevis?.reference),
      prompt: `目标时长：${durationSec}秒。真人数字人口播视频，${draft.aspectRatio}。这是完整口播第${part!.index + 1}段，覆盖原声${segment.startSec.toFixed(3)}–${segment.endSec.toFixed(3)}秒。\n@图片1绑定讲述者身份、服装与五官；@图片2绑定场景。${draft.actors.map((a, i) => `@图片${i + 3}绑定同场人物${a.labelZh}，保持在场但不说话。`).join("")}\n@音频1仅包含本段需要讲述的原声。口型、语速与停顿严格对应该音频，不重复其他段落，不改词，不换声音，不添加背景音乐或字幕。结束后保持自然动作。\n全文只作语境，不要完整重念：${draft.script.trim()}\n导演要求：${draft.direction.trim()}\n原分镜上下文：${draft.source?.shots.map(s => JSON.stringify(s)).join("\n") || "以当前人物和镜头要求为准"}`,
    } : {}),
  };
}

export function digitalHumanSegmentFingerprint(draft: DigitalHumanDraft, audio: DigitalHumanAudio, segment: NonNullable<DigitalHumanVideo["segment"]>, frame?: DigitalHumanMedia, previs?: DigitalHumanVideo["previs"]) {
  return JSON.stringify({ source: digitalHumanVideoFingerprint(draft, audio), segment, frame, previs });
}
export function digitalHumanVideoIsCurrent(draft: DigitalHumanDraft, row: DigitalHumanVideo): boolean {
  const audio = currentDigitalHumanAudio(draft);
  if (!audio) return false;
  if (!row.segment) return row.fingerprint === digitalHumanVideoFingerprint(draft, audio);
  const plan = draft.productions.find(p => p.request.requestId === row.segment!.planRequestId && p.status === "succeeded");
  const part = plan?.manifest?.segments[row.segment.index];
  if (!(part && part.audioUri === row.audioSource && part.startSec === row.segment.startSec && part.endSec === row.segment.endSec && row.fingerprint === digitalHumanSegmentFingerprint(draft, audio, row.segment, row.continuityFrame, row.previs))) return false;
  if (row.segment.index === 0) return true;
  const previous = [...draft.videos].reverse().find(v => v.status === "succeeded" && v.source && v.segment?.planRequestId === row.segment!.planRequestId && v.segment.index === row.segment!.index - 1 && digitalHumanVideoIsCurrent(draft, v));
  return Boolean(previous?.segment && row.continuityFrame && draft.productions.some(p => p.status === "succeeded" && p.source === row.continuityFrame!.source && p.request.input.action === "digital_human_continuity_frame" && p.request.input.params.videoUri === previous.source && Math.abs(p.request.input.params.atSec - (previous.segment!.endSec - previous.segment!.startSec)) < 1 / 48000));
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
    source: draft.source,
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
