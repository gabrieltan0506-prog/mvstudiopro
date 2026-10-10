/** 映客音源：先持久化作品绑定，再调用已有的配音／Suno生产与计费路径。 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { compileCanvasDialogueInput } from "../../shared/canvasDialogueControls";
import {
  codeMotionSoundRequestSchema,
  CODE_MOTION_VOICES,
  type CodeMotionSoundRequest,
} from "../../shared/codeMotionMedia";
import { type CodeMotionProject } from "../../shared/codeMotion";
import {
  codeMotionStorage,
  loadCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import {
  generateCanvasDialogue,
  getCanvasDialogue,
  canvasDialogueDigest,
  type CanvasDialogueInput,
} from "./canvasDialogueOperation";
import { buildScoringRoomBrief } from "./manhuaScoringRoom";
import {
  buildManhuaBgmJobResponse,
  queueManhuaBgm,
} from "./manhuaBgmOperation";
import { getJobByIdStrict } from "../jobs/repository";
import { manhuaBgmBriefSchema, digestManhuaBgmBrief } from "../jobs/manhuaBgmJobInput";
import { codeMotionProductionSlotSchema, reserveCodeMotionProductionSlot } from "./codeMotionProductionGrant";
import { importCodeMotionAudio } from "./codeMotionAudio";
import { recordCodeMotionGeneratedAudio } from "./codeMotionAudioReceipt";

const manifestSchema = z
  .object({
    projectId: z.string().uuid(),
    generation: z.string().regex(/^\d+$/),
    createdAt: z.string().datetime(),
    request: codeMotionSoundRequestSchema,
    bgmBrief: manhuaBgmBriefSchema.optional(),
    productionSlot: codeMotionProductionSlotSchema.optional(),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
export type CodeMotionSoundDeps = {
  storage: CodeMotionStoreDeps;
  speech: typeof generateCanvasDialogue;
  speechStatus: typeof getCanvasDialogue;
  bgm: typeof queueManhuaBgm;
  job: typeof getJobByIdStrict;
  importAudio: typeof importCodeMotionAudio;
  reserveSlot?: typeof reserveCodeMotionProductionSlot;
};
const real: CodeMotionSoundDeps = {
  storage: codeMotionStorage,
  speech: generateCanvasDialogue,
  speechStatus: getCanvasDialogue,
  bgm: queueManhuaBgm,
  job: getJobByIdStrict,
  importAudio: importCodeMotionAudio,
};
function prefix(userId: string, projectId: string) {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("请重新登录");
  z.string().uuid().parse(projectId);
  return `code-motion/u${userId}/sounds/${projectId}/`;
}
function name(userId: string, projectId: string, requestId: string) {
  z.string().uuid().parse(requestId);
  return `${prefix(userId, projectId)}${requestId}.json`;
}
async function read(
  userId: string,
  projectId: string,
  requestId: string,
  deps: CodeMotionSoundDeps
) {
  const file = await deps.storage.read(name(userId, projectId, requestId));
  if (!file) return null;
  const value = manifestSchema.parse(JSON.parse(file.body.toString("utf8")));
  if (value.projectId !== projectId || value.request.requestId !== requestId)
    throw new Error("音源请求身份不一致");
  return value;
}
function speechInput(
  projectId: string,
  r: Extract<CodeMotionSoundRequest, { kind: "speech" }>
): CanvasDialogueInput {
  return {
    billingRequestId: r.requestId,
    input: compileCanvasDialogueInput(r.text, r.emotion || ""),
    voice: CODE_MOTION_VOICES[r.voice],
    speakerZh: `画面${r.sceneIndex + 1}${r.role === "dialogue" ? "对白" : "旁白"}`,
    speakerId: `ink:${projectId}:${r.sceneIndex}${r.role === "dialogue" ? ":dialogue" : ""}`,
    voiceStateZh: r.emotion || "",
  };
}
function assertScene(project: CodeMotionProject, r: CodeMotionSoundRequest) {
  if (!project.plan) throw new Error("请先完成并保存画面安排");
  if (r.kind === "speech") {
    if (r.role === "dialogue" && project.brief.style !== "scenes")
      throw new Error("对白口型请先选择逐镜编排，再生成配音");
    const speech = project.plan.scenes[r.sceneIndex]?.speech;
    if (!speech || speech.text.trim() !== r.text || speech.voice !== r.voice || (speech.emotion || "") !== (r.emotion || "") || (speech.role || "narration") !== (r.role || "narration"))
      throw new Error("旁白已修改，请先保存并核对本次内容");
  }
}
export async function submitCodeMotionSound(
  userId: string,
  projectId: string,
  generation: string,
  raw: CodeMotionSoundRequest,
  deps = real,
  production?: { grantId: string }
) {
  const request = codeMotionSoundRequestSchema.parse(raw);
  let manifest = await read(userId, projectId, request.requestId, deps);
  if (manifest && JSON.stringify(manifest.request) !== JSON.stringify(request))
    throw new Error("原请求编号已用于其他内容，请恢复原任务");
  if (!manifest) {
    const saved = await loadCodeMotion(userId, projectId, deps.storage);
    if (!saved || saved.generation !== generation)
      throw new Error("作品版本已变化，请先保存并重新核对");
    assertScene(saved.project, request);
    manifest = manifestSchema.parse({
      projectId,
      generation,
      request,
      createdAt: new Date().toISOString(),
      ...(request.kind === "bgm"
        ? {
            bgmBrief: buildScoringRoomBrief({
              model: "suno-v6",
              laneZh: "映客代码视频",
              durationSec: saved.project.brief.duration,
              moods: ["蓄力", "冲突", "收束"],
              titleZh: saved.project.brief.title.slice(0, 80),
              styleAnchorZh: request.direction,
              endingZh: "最后两秒渐弱淡出",
            }),
          }
        : {}),
    });
    if (production) {
      manifest.productionSlot = { projectId, grantId: production.grantId, kind: request.kind, index: request.kind === "speech" ? request.sceneIndex : 0,
        requestId: request.requestId, digest: request.kind === "speech" ? canvasDialogueDigest(speechInput(projectId, request)) : digestManhuaBgmBrief(manifest.bgmBrief) };
    }
    try {
      await deps.storage.write(
        name(userId, projectId, request.requestId),
        Buffer.from(JSON.stringify(manifest)),
        "0"
      );
    } catch (error) {
      const existing = await read(userId, projectId, request.requestId, deps);
      if (
        !existing ||
        JSON.stringify(existing.request) !== JSON.stringify(request)
      )
        throw error;
      manifest = existing;
    }
  }
  if (production && !manifest.productionSlot) throw new Error("原音源请求不属于本次制作，请查询原任务");
  if (manifest.productionSlot) await (deps.reserveSlot ?? reserveCodeMotionProductionSlot)(userId, manifest.productionSlot);
  if (request.kind === "speech")
    if (manifest.productionSlot) await deps.speech(Number(userId), speechInput(projectId, request), undefined, manifest.productionSlot);
    else await deps.speech(Number(userId), speechInput(projectId, request));
  else
    await deps.bgm(userId, {
      billingRequestId: request.requestId,
      brief: manifest.bgmBrief!,
      ...(manifest.productionSlot ? { productionSlot: manifest.productionSlot } : {}),
    });
  return getCodeMotionSound(userId, projectId, request.requestId, deps);
}
export async function getCodeMotionSound(
  userId: string,
  projectId: string,
  requestId: string,
  deps = real
) {
  const manifest = await read(userId, projectId, requestId, deps);
  if (!manifest) throw new Error("没有找到这份作品的音源请求");
  const r = manifest.request;
  if (r.kind === "speech") {
    const job = await deps.speechStatus(Number(userId), requestId);
    return {
      ...manifest,
      status: job?.status ?? "not_started",
      message: job?.message,
      canResume: !job || job.canResumeSettlement,
      variants: job?.result
        ? [
            {
              index: 0,
              gcsUri: job.result.gcsUri,
              previewUrl: job.result.audioUrl,
              durationSec: job.result.durationSec ?? null,
            },
          ]
        : [],
    };
  }
  const job = await deps.job(`bgm_${requestId.replace(/-/g, "")}`);
  if (
    job &&
    (String(job.userId) !== userId ||
      job.type !== "audio" ||
      (job.input as { action?: string })?.action !== "manhua_bgm_v55")
  )
    throw new Error("配乐任务不属于当前作品请求");
  const response = job ? buildManhuaBgmJobResponse(job) : null;
  return {
    ...manifest,
    status: response?.status ?? "not_started",
    message: response?.error ?? undefined,
    canResume: !job,
    variants: response?.variants ?? [],
  };
}
export async function listCodeMotionSounds(
  userId: string,
  projectId: string,
  deps = real
) {
  const files = await deps.storage.list(prefix(userId, projectId));
  const rows = [];
  for (const file of files) {
    const requestId = file
      .slice(prefix(userId, projectId).length)
      .replace(/\.json$/, "");
    if (!z.string().uuid().safeParse(requestId).success) continue;
    rows.push(await getCodeMotionSound(userId, projectId, requestId, deps));
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function adoptCodeMotionSound(
  userId: string,
  projectId: string,
  requestId: string,
  index: number,
  deps = real
) {
  const sound = await getCodeMotionSound(userId, projectId, requestId, deps);
  const variant = sound.variants.find(v => v.index === index);
  if (!variant || sound.status !== "succeeded")
    throw new Error("音源尚未完成，请先查询原任务");
  const saved = await loadCodeMotion(userId, projectId, deps.storage);
  if (!saved) throw new Error("作品不存在");
  assertScene(saved.project, sound.request);
  const hex = createHash("sha256")
    .update(`${userId}:${projectId}:${requestId}:${index}`)
    .digest("hex");
  const sourceId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const r = sound.request;
  const source = await deps.importAudio({
    userId,
    projectId,
    sourceId,
    gcsUri: variant.gcsUri,
    name:
      r.kind === "speech"
        ? `画面${r.sceneIndex + 1}${r.role === "dialogue" ? "对白" : "旁白"}.wav`
        : `配乐候选${index + 1}.mp3`,
    generated: {
      requestId,
      kind: r.kind,
      ...(r.kind === "speech"
        ? { sceneIndex: r.sceneIndex, text: r.text, voice: r.voice, ...(r.role ? { role: r.role } : {}), ...(r.emotion ? { emotion: r.emotion } : {}) }
        : {}),
    },
  });
  return recordCodeMotionGeneratedAudio(
    userId,
    projectId,
    source,
    deps.storage
  );
}
