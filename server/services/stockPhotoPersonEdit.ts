/**
 * 实拍照「放入人物重绘」入队（1109）：以本人已采用的图库照片为底图，GPT Image 2.6 Sunburst edit 放入男主/女主。
 * 只做归属核对 + 幂等入队；出图、扣费、退款仍由画布出图 worker（canvas_gpt_image2）负责，按现有画布出图单价结算。
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { buildCanvasGptImage2JobInput } from "../../shared/canvasGptImage2JobInput";
import {
  buildStockPhotoPersonEditPrompt,
  stockPhotoPersonEditInputSchema,
  stockPhotoPersonEditReferenceOrder,
  type StockPhotoPersonEditInput,
} from "../../shared/stockPhotoPersonEdit";
import {
  MV_SCENE_SIGNATURE_SIZE,
  judgeMvSceneConsistency,
  mvSceneSignatureFromGray,
  type MvSceneConsistencyReport,
  type MvSceneSignature,
} from "../../shared/canvasMusicMvSceneLock";

/** 已核对归属的参考（规范化 gs://）。 */
export type StockPhotoPersonEditResolved = { baseGcsUri: string; providerAssetId?: string; peopleSources: string[] };

export type StockPhotoPersonEditDeps = {
  loadBase: (userId: number, assetId: string) => Promise<{ gcsUri: string; providerAssetId?: string }>;
  resolvePerson: (userId: number, source: string) => Promise<string>;
};

const realDeps: StockPhotoPersonEditDeps = {
  loadBase: async (userId, assetId) => {
    const { loadOwnedStockAsset } = await import("./stockFootage/ownership");
    const asset = await loadOwnedStockAsset(userId, assetId, { kind: "photo" });
    return { gcsUri: asset.gcsUri, providerAssetId: asset.source.providerAssetId };
  },
  resolvePerson: async (userId, source) => {
    const { resolveRegisteredPostProdMediaSource } = await import("./postProdMediaSource");
    return resolveRegisteredPostProdMediaSource({ userId: String(userId), source });
  },
};

export function stockPhotoPersonEditJobId(userId: number, requestId: string) {
  return `spedit_${createHash("sha256").update(`${userId}:${requestId}`).digest("hex").slice(0, 48)}`;
}

/** 纯函数：同一请求 + 同一归属核对结果 → 同一任务载荷（runner 侧据此复核，防旁路改规格）。 */
export function stockPhotoPersonEditJob(userId: number, raw: StockPhotoPersonEditInput, resolved: StockPhotoPersonEditResolved) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("需要有效登录账号");
  const request = stockPhotoPersonEditInputSchema.parse(raw);
  if (resolved.peopleSources.length !== request.people.length) throw new Error("人物参考与核对结果数量不一致");
  const id = stockPhotoPersonEditJobId(userId, request.requestId);
  const digest = createHash("sha256").update(JSON.stringify({ request, resolved })).digest("hex");
  const people = request.people.map((p, i) => ({ ...p, source: resolved.peopleSources[i]! }));
  const input = buildCanvasGptImage2JobInput({
    prompt: buildStockPhotoPersonEditPrompt({ ...request, people }),
    aspectRatio: request.aspectRatio,
    referenceImageUrls: stockPhotoPersonEditReferenceOrder(resolved.baseGcsUri, people),
    generalImageEdit: true,
    openaiImageVariant: "sunburst",
    requireImageVariant: true,
    providerOverride: "openai",
    imageLane: "asset",
    gcsSubdir: "stock-photo-person-edit",
  });
  return { id, digest, request, input: { ...input, params: { ...input.params, stockPhotoPersonEdit: { request, resolved, digest } } } };
}

/** 入队前核对：底图必须是本人已采用完成的图库照片；人物图必须是本人上传或本人任务产物。 */
export async function resolveStockPhotoPersonEdit(userId: number, raw: StockPhotoPersonEditInput, deps: StockPhotoPersonEditDeps = realDeps): Promise<StockPhotoPersonEditResolved> {
  const request = stockPhotoPersonEditInputSchema.parse(raw);
  const base = request.baseAssetId
    ? await deps.loadBase(userId, request.baseAssetId)
    : { gcsUri: await deps.resolvePerson(userId, request.baseSource!) };
  const peopleSources: string[] = [];
  for (const p of request.people) peopleSources.push(await deps.resolvePerson(userId, p.source));
  return { baseGcsUri: base.gcsUri, ...(base.providerAssetId ? { providerAssetId: base.providerAssetId } : {}), peopleSources };
}

/** 幂等入队：同一 requestId 只建一单；同编号换输入直接拒绝。 */
export async function queueStockPhotoPersonEdit(userId: number, raw: StockPhotoPersonEditInput, deps: StockPhotoPersonEditDeps = realDeps) {
  const resolved = await resolveStockPhotoPersonEdit(userId, raw, deps);
  const task = stockPhotoPersonEditJob(userId, raw, resolved);
  const db = await getDb();
  if (!db) throw new Error("重绘任务记录暂不可用，未提交生成");
  await db.insert(jobs).values({ id: task.id, userId: String(userId), type: "image", provider: "openai-gpt-image-2", status: "queued", attempts: 0, input: task.input }).onConflictDoNothing({ target: jobs.id });
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, task.id), eq(jobs.userId, String(userId))));
  const saved = row?.input as typeof task.input | undefined;
  if (!row || saved?.params.stockPhotoPersonEdit?.digest !== task.digest) throw new Error("重绘请求编号已绑定另一份输入，请查询原任务");
  return { jobId: task.id, status: row.status };
}

/** runner 复核：载荷必须与已确认输入逐字段一致；返回本功能固定的模型档位。 */
export function assertStockPhotoPersonEditJob(userId: number, jobId: string, input: unknown) {
  const actual = input as ReturnType<typeof stockPhotoPersonEditJob>["input"];
  const meta = actual?.params?.stockPhotoPersonEdit;
  const expected = stockPhotoPersonEditJob(userId, meta?.request, meta?.resolved);
  if (expected.id !== jobId || !isDeepStrictEqual(expected.input, actual)) throw new Error("实拍照放入人物任务参数与已确认输入不一致");
  return { imageModelVersion: "2.6" as const, openaiImageVariant: "sunburst" as const, requireImageVariant: true, qualityOverride: "high" as const };
}

/** 只读恢复同一请求；找不到时不创建新单。 */
export async function getStockPhotoPersonEdit(userId: number, requestId: string) {
  const db = await getDb();
  if (!db) throw new Error("重绘任务记录暂不可用");
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, stockPhotoPersonEditJobId(userId, requestId)), eq(jobs.userId, String(userId))));
  if (!row) return null;
  const output = (row.output || {}) as { imageUrl?: string };
  return { jobId: row.id, status: row.status, imageUrl: typeof output.imageUrl === "string" ? output.imageUrl : undefined, error: row.error ?? undefined };
}

/* ---------------- 1109 场景连续性锁：出视频前同地点一致性预检（只读、不调用付费模型） ---------------- */

export type MvSceneLockCheckGroup = { locationZh: string; masterGcsUri: string; masterAssetId?: string; items: Array<{ shotId: string; shotLabel?: string; gcsUri: string; assetId?: string }> };

export type MvSceneLockCheckDeps = {
  /** 归属核对：sf_ 图库编号按采用回执取图；其余按本人上传/任务产物核对（与人物参考同一核对）→ 规范化 gs://。 */
  resolveImage: (userId: number, source: string) => Promise<string>;
  /** 读取图片字节（服务端 GCS）。 */
  download: (gcsUri: string) => Promise<Buffer>;
  /** 字节 → 签名（默认 sharp 缩成 32×32 灰度）。 */
  signature?: (buffer: Buffer) => Promise<MvSceneSignature>;
};

export async function mvSceneSignatureFromBuffer(buffer: Buffer): Promise<MvSceneSignature> {
  const sharp = (await import("sharp")).default;
  const size = MV_SCENE_SIGNATURE_SIZE;
  const gray = await sharp(buffer, { failOn: "none" }).rotate().grayscale().resize(size, size, { fit: "fill" }).raw().toBuffer();
  return mvSceneSignatureFromGray(gray, size, size);
}

const realCheckDeps: MvSceneLockCheckDeps = {
  resolveImage: async (userId, source) => (/^sf_[0-9a-f]{48}$/.test(source) ? (await realDeps.loadBase(userId, source)).gcsUri : realDeps.resolvePerson(userId, source)),
  download: async gcsUri => (await (await import("./gcs")).downloadGcsObject({ gcsUri })).buffer,
};

/** 同地点场景图 vs 母版：明显不一致的给软提示（可继续出片）；读图失败的镜头记为未检查，不拦。 */
export async function checkMvSceneLockConsistency(userId: number, groups: ReadonlyArray<MvSceneLockCheckGroup>, deps: MvSceneLockCheckDeps = realCheckDeps) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("需要有效登录账号");
  const sign = deps.signature ?? mvSceneSignatureFromBuffer;
  const cache = new Map<string, Promise<MvSceneSignature>>();
  const sig = (source: string) => {
    if (!cache.has(source)) cache.set(source, deps.resolveImage(userId, source).then(deps.download).then(sign));
    return cache.get(source)!;
  };
  const reports: MvSceneConsistencyReport[] = [];
  const uncheckedZh: string[] = [];
  for (const g of groups) {
    let master: MvSceneSignature;
    try { master = await sig(g.masterAssetId ?? g.masterGcsUri); } catch { uncheckedZh.push(`「${g.locationZh}」母版场景图读取失败，未检查`); continue; }
    const others: Array<{ shotId: string; shotLabel?: string; gcsUri: string; signature: MvSceneSignature }> = [];
    for (const it of g.items) {
      try { others.push({ shotId: it.shotId, gcsUri: it.gcsUri, ...(it.shotLabel ? { shotLabel: it.shotLabel } : {}), signature: await sig(it.assetId ?? it.gcsUri) }); } catch { uncheckedZh.push(`${it.shotLabel || it.shotId} 的场景图读取失败，未检查`); }
    }
    reports.push(judgeMvSceneConsistency(g.locationZh, g.masterGcsUri, master, others));
  }
  return { reports, warningsZh: reports.flatMap(r => r.warningsZh), uncheckedZh };
}
