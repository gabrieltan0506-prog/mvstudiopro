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
  const base = await deps.loadBase(userId, request.baseAssetId);
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
