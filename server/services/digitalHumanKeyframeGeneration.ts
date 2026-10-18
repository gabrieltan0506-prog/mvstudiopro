import { getGcsBucketName } from "./gcs";
import { parseGsUri, resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  digitalHumanKeyframeGenerationInputSchema,
  digitalHumanKeyframeGenerationPrompt,
  type DigitalHumanKeyframeGenerationInput,
} from "../../shared/digitalHumanKeyframeGeneration";
import { buildCanvasGptImage2JobInput } from "../../shared/canvasGptImage2JobInput";

export function digitalHumanKeyframeGenerationJob(
  userId: number,
  raw: DigitalHumanKeyframeGenerationInput
) {
  if (!Number.isSafeInteger(userId) || userId <= 0)
    throw new Error("需要有效登录账号");
  const request = digitalHumanKeyframeGenerationInputSchema.parse(raw);
  for (const portrait of request.portraits) {
    const parsed = parseGsUri(portrait.source);
    if (!parsed || parsed.bucket !== getGcsBucketName() || !parsed.objectName.startsWith(`uploads/u${userId}/`))
      throw new Error("只允许当前账号上传的人像原文件，不能引用他人素材或生成任务产物");
  }
  if (request.scene) {
    const parsed = parseGsUri(request.scene.source);
    if (!parsed || parsed.bucket !== getGcsBucketName()) throw new Error("场景参考地址无效");
  }
  const id = `dhkeyframe_${createHash("sha256").update(`${userId}:${request.requestId}`).digest("hex").slice(0, 48)}`;
  const digest = createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
  const input = buildCanvasGptImage2JobInput({
    prompt: digitalHumanKeyframeGenerationPrompt(request),
    aspectRatio: request.aspectRatio,
    referenceImageUrls: [...request.portraits.map(p => p.source), ...(request.scene ? [request.scene.source] : [])],
    openaiImageVariant: "sunburst",
    requireImageVariant: true,
    providerOverride: "openai",
    imageLane: "asset",
  });
  return {
    id,
    digest,
    request,
    input: {
      ...input,
      params: { ...input.params, digitalHumanKeyframeGeneration: { request, digest } },
    },
  };
}

/** 新入口仅做幂等入队；图片生产、所有权、扣费与退款仍由原worker负责。 */
export async function queueDigitalHumanKeyframeGeneration(
  userId: number,
  raw: DigitalHumanKeyframeGenerationInput
) {
  const task = digitalHumanKeyframeGenerationJob(userId, raw);
  if (task.request.scene && await resolveRegisteredPostProdMediaSource({ userId: String(userId), source: task.request.scene.source }) !== task.request.scene.source)
    throw new Error("场景参考身份不一致，未提交");
  const db = await getDb();
  if (!db) throw new Error("关键分镜任务记录暂不可用，未提交生成");
  await db
    .insert(jobs)
    .values({
      id: task.id,
      userId: String(userId),
      type: "image",
      provider: "openai-gpt-image-2",
      status: "queued",
      attempts: 0,
      input: task.input,
    })
    .onConflictDoNothing({ target: jobs.id });
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, task.id), eq(jobs.userId, String(userId))));
  const saved = row?.input as typeof task.input | undefined;
  if (!row || saved?.params.digitalHumanKeyframeGeneration?.digest !== task.digest)
    throw new Error("关键分镜请求编号已绑定另一份输入，请查询原任务");
  return { jobId: task.id, status: row.status };
}

/** 防止旁路伪造标记改变其他画布图片的规格；不改原价和退款策略。 */
export function assertDigitalHumanKeyframeGenerationJob(
  userId: number,
  jobId: string,
  input: unknown
) {
  const actual = input as ReturnType<typeof digitalHumanKeyframeGenerationJob>["input"];
  const expected = digitalHumanKeyframeGenerationJob(
    userId,
    actual?.params?.digitalHumanKeyframeGeneration?.request
  );
  if (expected.id !== jobId || !isDeepStrictEqual(expected.input, actual))
    throw new Error("数字人关键分镜任务参数与已确认输入不一致");
  return {
    exactSunburst: true,
    qualityOverride: "medium" as const,
    evolinkResolution: "2K" as const,
    openaiSize:
      expected.request.aspectRatio === "9:16" ? "1152x2048" : "2048x1152",
  };
}

/** 只读恢复同一请求；找不到时不创建新单。 */
export async function getDigitalHumanKeyframeGeneration(userId: number, requestId: string) {
  const id = `dhkeyframe_${createHash("sha256").update(`${userId}:${requestId}`).digest("hex").slice(0, 48)}`;
  const db = await getDb();
  if (!db) throw new Error("关键分镜任务记录暂不可用");
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, String(userId))));
  return row
    ? {
        jobId: row.id,
        status: row.status,
        output: row.output,
        error: row.error,
      }
    : null;
}
