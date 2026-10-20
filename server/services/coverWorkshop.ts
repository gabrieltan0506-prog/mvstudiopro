import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { getCredits } from "../credits";
import {
  getJobByIdStrict,
  markJobSucceededWithRetry,
} from "../jobs/repository";
import { codeMotionStorage } from "./codeMotionStore";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import {
  getGcsBucketName,
  signGsUriV4ReadUrl,
  uploadBufferToGcsIfAbsent,
} from "./gcs";
import { registerCanvasImageDeliveryOrThrow } from "./canvasMediaOwnership";
import { postOpenAiGptImage2AndUpload } from "./openaiGptImage2";
import { downloadPhotoMedia } from "./photoMediaInput";
import { postProcessPlatformCover } from "./platformCoverGrade";
import { markSettlementPending, unregisterActiveJob } from "./paidJobLedger";
import {
  buildCoverPrompt,
  coverRequestSchema,
  coverSize,
  COVER_DIRECTIONS,
  type CoverBrief,
  type CoverRequest,
} from "../../shared/coverWorkshop";
import { canvasImageCredits } from "../../shared/canvasGenerationPricing";
import sharp from "sharp";
import { enforceSimplifiedChineseImagePrompt } from "./simplifiedChinese";

export type CoverManifest = {
  version: 1;
  userId: string;
  request: CoverRequest;
  brief: CoverBrief;
  createdAt: string;
  fingerprint: string;
  items: {
    index: number;
    direction: number;
    jobId: string;
    prompt: string;
    refs: string[];
    credits: number;
  }[];
};
type Delivery = { imageUrl: string; originalUrl: string; receiptUrl: string };
const uid = (u: string) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .parse(u);
const prefix = (u: string, id: string) =>
  `cover-workshop/u${uid(u)}/${z.string().uuid().parse(id)}`;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const unknown = (message: string) =>
  Object.assign(Error(message), { kind: "unknown" });
async function readJson<T>(name: string): Promise<T | null> {
  const row = await codeMotionStorage.read(name);
  return row ? (JSON.parse(row.body.toString("utf8")) as T) : null;
}
async function writeJson(name: string, data: unknown) {
  await codeMotionStorage.write(name, Buffer.from(JSON.stringify(data)), "0");
}
export async function loadCoverManifest(userId: string, id: string) {
  const m = await readJson<CoverManifest>(
    `${prefix(userId, id)}/manifest.json`
  );
  if (!m || m.userId !== userId || m.request.id !== id)
    throw Error("封面记录不存在或无权访问");
  return m;
}
export function coverJobInput(m: CoverManifest, i: number) {
  const item = m.items[i];
  if (!item) throw Error("封面候选不存在");
  return {
    action: "canvas_gpt_image2",
    params: {
      prompt: item.prompt,
      aspectRatio: m.brief.aspectRatio,
      referenceImageUrls: item.refs,
      providerOverride: "openai",
      openaiImageVariant: m.request.stage === "draft" ? "flare" : "sunburst",
      requireImageVariant: true,
      imageLane: "keyart",
      batchIndex: i,
      gcsSubdir: "cover-workshop",
      coverWorkshop: { id: m.request.id, index: i, fingerprint: m.fingerprint },
    },
  };
}
/** 先冻结设计供用户查看；此阶段不入队、不调用图片模型。 */
export async function prepareCover(userId: string, raw: unknown) {
  const request = coverRequestSchema.parse(raw);
  const base = prefix(userId, request.id);
  const old = await readJson<CoverManifest>(`${base}/manifest.json`);
  if (old) {
    if (!isDeepStrictEqual(old.request, request))
      throw Error("此请求已有不同设计，请保留旧稿并新建版本");
    return old;
  }
  let brief: CoverBrief,
    refs: string[],
    directions: number[],
    changes: string | undefined;
  if (request.stage === "draft") {
    brief = request.brief;
    refs = await Promise.all(
      brief.references.map(source =>
        resolveRegisteredPostProdMediaSource({ userId, source })
      )
    );
    directions = [0, 1, 2];
  } else {
    const batch = await loadCoverManifest(userId, request.batchId);
    if (batch.request.stage !== "draft")
      throw Error("只能从初稿中选择成稿方向");
    const selected = batch.items[request.candidate];
    const job = await getJobByIdStrict(selected.jobId);
    if (job?.userId !== userId || job.status !== "succeeded")
      throw Error("所选初稿尚未成功，未生成成稿");
    const delivery = await readJson<Delivery>(
      `${prefix(userId, request.batchId)}/${request.candidate}/delivery.json`
    );
    if (!delivery?.imageUrl) throw Error("所选初稿缺少永久图片回执");
    brief = batch.brief;
    refs = await Promise.all(
      [delivery.imageUrl, ...brief.references].map(source =>
        resolveRegisteredPostProdMediaSource({ userId, source })
      )
    );
    directions = [request.candidate];
    changes = request.changes;
  }
  // 在确认和扣费前核验真实参考内容；登记过的视频或伪扩展名不能当图片送上游。
  for (const ref of refs) {
    const bytes = await downloadPhotoMedia(
      signGsUriV4ReadUrl(ref),
      20 * 1024 * 1024
    );
    const meta = await sharp(bytes, {
      limitInputPixels: 20_000_000,
    }).metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      !meta.width ||
      !meta.height ||
      (meta.pages || 1) > 1
    )
      throw Error("参考必须是有效的静态PNG、JPEG或WebP图片");
  }
  const items = directions.map((direction, index) => ({
    index,
    direction,
    jobId: `cover_${hash([userId, request.id, index]).slice(0, 48)}`,
    prompt: enforceSimplifiedChineseImagePrompt(
      buildCoverPrompt(brief, direction, changes)
    ),
    refs,
    credits: canvasImageCredits(index),
  }));
  const m: CoverManifest = {
    version: 1,
    userId,
    request,
    brief,
    items,
    createdAt: new Date().toISOString(),
    fingerprint: hash({ request, brief, items }),
  };
  try {
    await writeJson(`${base}/manifest.json`, m);
  } catch (e) {
    const saved = await readJson<CoverManifest>(`${base}/manifest.json`);
    if (!saved || saved.fingerprint !== m.fingerprint) throw e;
    return saved;
  }
  return m;
}
/** 三张任务同一SQL原子入队；同一身份永不重建失败/运行任务。 */
export async function submitCover(
  userId: string,
  id: string,
  fingerprint: string
) {
  const m = await loadCoverManifest(userId, id);
  if (fingerprint !== m.fingerprint)
    throw Error("设计版本已变化，请重新查看后确认");
  for (const ref of m.items[0].refs)
    await resolveRegisteredPostProdMediaSource({ userId, source: ref });
  const db = await getDb();
  if (!db) throw Error("封面任务记录暂不可用");
  const existing = await Promise.all(
    m.items.map(item => getJobByIdStrict(item.jobId))
  );
  const due = m.items.reduce(
    (sum, item, index) => sum + (existing[index] ? 0 : item.credits),
    0
  );
  if (due > 0 && (await getCredits(Number(userId))).totalAvailable < due)
    throw Error(`本次需要${due}积分，余额不足，未提交新图片`);
  await db
    .insert(jobs)
    .values(
      m.items.map((item, i) => ({
        id: item.jobId,
        userId,
        type: "image" as const,
        provider: "openai-gpt-image-2",
        status: "queued" as const,
        attempts: 0,
        input: coverJobInput(m, i),
      }))
    )
    .onConflictDoNothing({ target: jobs.id });
  for (const [i, item] of Array.from(m.items.entries())) {
    const saved = await getJobByIdStrict(item.jobId);
    if (
      !saved ||
      saved.userId !== userId ||
      !isDeepStrictEqual(saved.input, coverJobInput(m, i))
    )
      throw Error("封面任务确认失败，请查询原记录，勿重新购买");
  }
  return { id };
}
export async function resolveCoverWorkerPolicy(
  userId: string,
  jobId: string,
  input: unknown
) {
  const c = z
    .object({
      id: z.string().uuid(),
      index: z.number().int().min(0).max(2),
      fingerprint: z.string(),
    })
    .parse(
      (input as { params?: { coverWorkshop?: unknown } })?.params?.coverWorkshop
    );
  const m = await loadCoverManifest(userId, c.id);
  if (
    m.fingerprint !== c.fingerprint ||
    m.items[c.index]?.jobId !== jobId ||
    !isDeepStrictEqual(coverJobInput(m, c.index), input)
  )
    throw Error("封面生产凭据不一致，未调用图片服务");
  return { m, item: m.items[c.index], credits: m.items[c.index].credits };
}
export async function assertCoverPixels(bytes: Buffer, size: string) {
  const meta = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
  const [width, height] = size.split("x").map(Number);
  if (meta.width !== width || meta.height !== height)
    throw Object.assign(
      Error(
        `图片像素不符合本稿要求：收到${meta.width}×${meta.height}，要求${width}×${height}；原图保留，未降格交付`
      ),
      { kind: "invalid_output" }
    );
}
async function originalFromReceipt(base: string) {
  const original = await readJson<{ url: string }>(`${base}/original.json`);
  if (original) return original;
  const response = await readJson<{ status: number }>(`${base}/response.json`);
  if (!response || response.status < 200 || response.status >= 300) return null;
  const bytes = await downloadPhotoMedia(
    signGsUriV4ReadUrl(`gs://${getGcsBucketName()}/${base}/provider.json`),
    45 * 1024 * 1024
  );
  const b64 = JSON.parse(bytes.toString("utf8"))?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64)
    throw Error("原始图片回执缺少图片，需核对供应商结果；未重新生成");
  await uploadBufferToGcsIfAbsent({
    objectName: `${base}/original.png`,
    buffer: Buffer.from(b64, "base64"),
    contentType: "image/png",
  });
  const result = { url: `gs://${getGcsBucketName()}/${base}/original.png` };
  try {
    await writeJson(`${base}/original.json`, result);
  } catch (e) {
    if (!(await readJson(`${base}/original.json`))) throw e;
  }
  return result;
}
async function finishCover(m: CoverManifest, index: number): Promise<Delivery> {
  const base = `${prefix(m.userId, m.request.id)}/${index}`;
  const saved = await readJson<Delivery>(`${base}/delivery.json`);
  if (saved) return saved;
  const raw = await originalFromReceipt(base);
  if (!raw) throw unknown("图片回执尚未确认，请保留原任务等待核对，未重新生成");
  const source = await downloadPhotoMedia(
    signGsUriV4ReadUrl(raw.url),
    30 * 1024 * 1024
  );
  await assertCoverPixels(source, coverSize(m.brief.aspectRatio));
  const result = await postProcessPlatformCover(
    raw.url,
    Number(m.userId),
    COVER_DIRECTIONS[m.items[index].direction].grade
  );
  await registerCanvasImageDeliveryOrThrow({
    imageUrl: result.imageUrl,
    ownerUserId: Number(m.userId),
    source: "cover-workshop",
  });
  try {
    await writeJson(`${base}/delivery.json`, result);
  } catch (e) {
    const concurrent = await readJson<Delivery>(`${base}/delivery.json`);
    if (!concurrent) throw e;
    return concurrent;
  }
  return result;
}
/** 提交前永久占位；即使进程退出、队列重跑，也不再次调用供应商。 */
export async function generateCoverImage(
  policy: Awaited<ReturnType<typeof resolveCoverWorkerPolicy>>
) {
  const { m, item } = policy;
  const base = `${prefix(m.userId, m.request.id)}/${item.index}`;
  if (
    (await readJson(`${base}/original.json`)) ||
    (await readJson(`${base}/response.json`))
  ) {
    try {
      return (await finishCover(m, item.index)).imageUrl;
    } catch (e) {
      if ((e as { kind?: string })?.kind === "invalid_output") throw e;
      throw unknown(e instanceof Error ? e.message : String(e));
    }
  }
  if (await readJson(`${base}/attempt.json`))
    throw unknown("此封面已经提交，结果尚待核对；已阻止重复生成");
  const refs = await Promise.all(
    item.refs.map(async source =>
      signGsUriV4ReadUrl(
        await resolveRegisteredPostProdMediaSource({
          userId: m.userId,
          source,
        }),
        3600
      )
    )
  );
  try {
    await writeJson(`${base}/attempt.json`, {
      jobId: item.jobId,
      startedAt: new Date().toISOString(),
    });
  } catch {
    throw unknown("封面提交占位未能确认，已停止重复提交");
  }
  const error: { message?: string } = {};
  const result = await postOpenAiGptImage2AndUpload(
    item.prompt,
    "cover-workshop",
    {
      exactModel:
        m.request.stage === "draft"
          ? "gpt-image-2.5-flare"
          : "gpt-image-2.5-sunburst",
      aspectRatio: m.brief.aspectRatio,
      size: coverSize(m.brief.aspectRatio),
      quality: m.request.stage === "draft" ? "medium" : "high",
      imageUrls: refs,
      strictRequest: true,
      lane: "keyart",
      captureError: error,
      persistResponse: async response => {
        await uploadBufferToGcsIfAbsent({
          objectName: `${base}/provider.json`,
          buffer: Buffer.from(response.body),
          contentType: "application/json",
        });
        await writeJson(`${base}/response.json`, { status: response.status });
        if (response.status < 200 || response.status >= 300) return;
        const parsed = JSON.parse(response.body);
        const b64 = parsed?.data?.[0]?.b64_json;
        if (typeof b64 !== "string" || !b64)
          throw unknown("供应商未返回可永久保存的图片，已保留回执待核对");
        const bytes = Buffer.from(b64, "base64");
        await uploadBufferToGcsIfAbsent({
          objectName: `${base}/original.png`,
          buffer: bytes,
          contentType: "image/png",
        });
        const url = `gs://${getGcsBucketName()}/${base}/original.png`;
        await writeJson(`${base}/original.json`, {
          url,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          status: response.status,
        });
      },
    }
  );
  if (!result) throw Error(error.message || "图片生成失败，未交付空图");
  try {
    return (await finishCover(m, item.index)).imageUrl;
  } catch (e) {
    if ((e as { kind?: string })?.kind === "invalid_output") throw e;
    throw unknown(
      `原图已保留，精修尚未交付：${e instanceof Error ? e.message : String(e)}`
    );
  }
}
export async function getCover(userId: string, id: string) {
  const m = await loadCoverManifest(userId, id);
  const items = await Promise.all(
    m.items.map(async item => {
      const job = await getJobByIdStrict(item.jobId);
      const base = `${prefix(userId, id)}/${item.index}`;
      const delivery = await readJson<Delivery>(`${base}/delivery.json`);
      const raw = await readJson<{ url: string }>(`${base}/original.json`);
      const response = await readJson<{ status: number }>(
        `${base}/response.json`
      );
      return {
        index: item.index,
        direction: item.direction,
        jobId: item.jobId,
        prompt: item.prompt,
        credits: item.credits,
        status: job?.status || "prepared",
        error: job?.error || null,
        canRecover:
          job?.status === "failed" &&
          (Boolean(raw) ||
            Boolean(
              response && response.status >= 200 && response.status < 300
            )) &&
          !String(job.error).includes("图片像素不符合"),
        imageUrl:
          delivery && job?.status === "succeeded"
            ? signGsUriV4ReadUrl(delivery.imageUrl, 3600)
            : null,
        originalUrl: raw ? signGsUriV4ReadUrl(raw.url, 3600) : null,
        receiptUrl: delivery
          ? signGsUriV4ReadUrl(delivery.receiptUrl, 3600)
          : null,
      };
    })
  );
  return {
    id,
    stage: m.request.stage,
    brief: m.brief,
    request: m.request,
    fingerprint: m.fingerprint,
    createdAt: m.createdAt,
    totalCredits: m.items.reduce((n, item) => n + item.credits, 0),
    referencePreviews: m.items[0].refs.map(r => signGsUriV4ReadUrl(r, 3600)),
    items,
  };
}
export async function listCovers(userId: string) {
  const names = await codeMotionStorage.list(`cover-workshop/u${uid(userId)}/`);
  const rows = [];
  for (const name of names.filter(n => n.endsWith("/manifest.json"))) {
    const m = await readJson<CoverManifest>(name);
    if (m)
      rows.push({
        id: m.request.id,
        stage: m.request.stage,
        title: m.brief.headline || m.brief.description || "图片封面",
        createdAt: m.createdAt,
      });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/** 只完成已保存原图的后期，不调用模型、不重建任务、不再次计费。 */
export async function recoverCover(userId: string, id: string, index: number) {
  const m = await loadCoverManifest(userId, id);
  const item = m.items[index];
  if (!item) throw Error("候选不存在");
  const job = await getJobByIdStrict(item.jobId);
  if (!job || job.userId !== userId || job.status !== "failed")
    throw Error("仅可恢复已中断的原图后期，请先刷新状态");
  const delivery = await finishCover(m, index);
  const output = {
    imageUrl: delivery.imageUrl,
    imageUrls: [delivery.imageUrl],
  };
  if (
    !(await markJobSucceededWithRetry(item.jobId, output, "openai-gpt-image-2"))
  )
    throw Error("结果状态未保存，请查询原任务");
  if (!(await markSettlementPending(item.jobId, "canvasGptImage2")))
    throw Error("图片已恢复，计费结算待核对");
  const settled = await unregisterActiveJob(
    item.jobId,
    "canvasGptImage2",
    "settled"
  );
  if (!settled.ok) throw Error("图片已恢复，计费结算待核对");
  return { id };
}
