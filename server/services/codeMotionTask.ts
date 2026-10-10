import {
  inkFreeSpeechEnabled,
  INK_FREE_SPEECH_UNAVAILABLE,
} from "./inkFreeSpeechConfig";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  compileCodeMotion,
  type CodeMotionProject,
} from "../../shared/codeMotion";
import { artMotionTaskId, queueArtMotion } from "./artMotionTask";
import { resolvePostProdInputSources } from "./postProdMediaSource";
import { getJobByIdStrict } from "../jobs/repository";
import { buildPostProdJobResponse } from "./postProdJobResponse";
import { enqueueInkFree, type InkSource } from "./inkFreeQuota";
import { assertCodeMotionAudioOwnership } from "./codeMotionAudio";

export function codeMotionRenderIdentity(
  userId: string,
  project: CodeMotionProject
) {
  if (!project.plan) throw new Error("请先整理并保存本次内容安排");
  const spec = compileCodeMotion(project.brief, project.plan);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([userId, project.id, spec]))
    .digest("hex");
  const requestId = `${fingerprint.slice(0, 8)}-${fingerprint.slice(8, 12)}-5${fingerprint.slice(13, 16)}-8${fingerprint.slice(17, 20)}-${fingerprint.slice(20, 32)}`;
  return {
    spec,
    fingerprint,
    requestId,
    jobId: artMotionTaskId(userId, requestId),
    scopeKey: `code-motion:${project.id}`,
  };
}
export type CodeMotionTaskDeps = {
  load: typeof getJobByIdStrict;
  resolve: typeof resolvePostProdInputSources;
  queue(
    userId: string,
    input: Parameters<typeof queueArtMotion>[1],
    source?: InkSource
  ): Promise<{ jobId: string; status: string }>;
  view: typeof buildPostProdJobResponse;
  audioOwnership?: typeof assertCodeMotionAudioOwnership;
  speechEnabled?: () => boolean;
};
const real: CodeMotionTaskDeps = {
  load: getJobByIdStrict,
  resolve: resolvePostProdInputSources,
  async queue(userId, raw, source) {
    if (!source) throw new Error("无法确认免费名额来源，未提交任务");
    const { artMotionJobSchema } = await import("../../shared/artMotion");
    const input = artMotionJobSchema.parse(raw);
    return enqueueInkFree(
      {
        id: artMotionTaskId(userId, input.requestId),
        userId,
        input,
        format: "mp4",
        provider: "canvas-art-motion",
        type: "post_prod",
      },
      source
    );
  },
  view: buildPostProdJobResponse,
};
export async function findCodeMotionTask(
  userId: string,
  project: CodeMotionProject,
  deps = real
) {
  const identity = codeMotionRenderIdentity(userId, project);
  const row = await deps.load(identity.jobId);
  if (!row) return null;
  const raw = row.input as {
    action?: unknown;
    scopeKey?: unknown;
    requestId?: unknown;
    params?: unknown;
  };
  if (
    String(row.userId) !== userId ||
    row.type !== "post_prod" ||
    raw.action !== "art_motion" ||
    raw.scopeKey !== identity.scopeKey ||
    raw.requestId !== identity.requestId ||
    !isDeepStrictEqual(raw.params, identity.spec)
  )
    throw new Error("视频任务与本次内容不一致，未采用");
  return deps.view(row);
}
export async function submitCodeMotion(
  userId: string,
  project: CodeMotionProject,
  confirmedFingerprint: string,
  deps = real,
  source?: InkSource
) {
  const identity = codeMotionRenderIdentity(userId, project);
  if (identity.fingerprint !== confirmedFingerprint)
    throw new Error("内容已修改，请重新查看本次安排后再导出");
  // 响应丢失或重进页面时只返回原任务；失败也不自动重复渲染。
  const old = await findCodeMotionTask(userId, project, deps);
  if (old) return { jobId: old.jobId, status: old.status };
  if (
    identity.spec.inkSpeech &&
    !(deps.speechEnabled ?? inkFreeSpeechEnabled)()
  )
    throw new Error(INK_FREE_SPEECH_UNAVAILABLE);
  // 画面已由 compileCodeMotion 校验；无声计划沿同一权限、名额和队列导出。
  if (identity.spec.codeAudio)
    await (deps.audioOwnership ?? assertCodeMotionAudioOwnership)({
      userId,
      projectId: project.id,
      audio: identity.spec.codeAudio,
    });
  const input = await deps.resolve({
    userId,
    input: {
      action: "art_motion",
      scopeKey: identity.scopeKey,
      requestId: identity.requestId,
      params: identity.spec,
    },
  });
  return source ? deps.queue(userId, input, source) : deps.queue(userId, input);
}

/** 改稿后仍可取回同一作品先前的视频，最多展示最近二十条，不删除旧结果。 */
export async function listCodeMotionVideos(userId: string, projectId: string) {
  const { and, desc, eq, sql } = await import("drizzle-orm");
  const { jobs } = await import("../../drizzle/schema");
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("视频记录暂时无法读取，请稍后再试");
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, "post_prod"),
        sql`${jobs.input}->>'scopeKey' = ${`code-motion:${projectId}`}`
      )
    )
    .orderBy(desc(jobs.createdAt))
    .limit(20);
  return rows.map(row => buildPostProdJobResponse(row));
}
