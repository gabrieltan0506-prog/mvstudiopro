/**
 * 素材采用：候选 → 服务端按编号重取上游元数据 → 挑文件 → 有界下载 → 本人永久 GCS
 * → 来源证据 → jobs 表持久回执。
 *
 * 断点恢复合同：
 * - 幂等键 = (userId, requestId)；数据库唯一主键先占位，再访问上游。
 * - 同一 requestId 参数不一致 → conflict；已成功 → 直接返回原资产，不重复下载/入库。
 * - 中途失败（网络/存储）保留 running 回执，同一 requestId 可续做；GCS 写入用 ifAbsent，
 *   对象名由 assetId 决定，重复续做也只会有一个对象。
 * - 明确拒绝（素材下架、超限、主机不在白名单）→ failed，需换新 requestId 重新采用。
 * - 不进入 queued，通用 worker 不消费；本操作不计费（Pexels 免费）。
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { jobs } from "../../../drizzle/schema";
import {
  PEXELS_LICENSE,
  STOCK_PHOTO_MAX_BYTES,
  STOCK_VIDEO_MAX_BYTES,
  isAllowedStockDownloadUrl,
  stockFootageAdoptInputSchema,
  stockFootageAssetSchema,
  type StockFootageAdoptInput,
  type StockFootageAdoptParams,
  type StockFootageAdoptionResponse,
  type StockFootageAsset,
  type StockFootagePurpose,
  type StockFootageSourceEvidence,
} from "../../../shared/stockFootage";
import { getDb } from "../../db";
import { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "../gcs";
import { StockFootageError, getPexelsAsset, pickBestVideoFile, pickPhotoSource } from "./pexelsClient";

export const STOCK_FOOTAGE_JOB_TYPE = "stock_footage";
export const STOCK_FOOTAGE_ACTION = "stock_footage_adopt";
/** 运行中回执多久没有更新就允许同一 requestId 接手续做。 */
export const STOCK_ADOPT_STALE_MS = 3 * 60_000;

export type StockAdoptionStage = "claimed" | "resolved" | "stored" | "done" | "failed";
export type StockAdoptionOutput = {
  stage: StockAdoptionStage;
  evidence?: StockFootageSourceEvidence;
  file?: { url: string; mimeType: string; width: number; height: number; durationSec?: number; maxBytes: number };
  stored?: { gcsUri: string; bytes: number; sha256: string };
  asset?: StockFootageAsset;
  message?: string;
  lastError?: string;
};
export type StockAdoptionRecord = {
  id: string;
  userId: string;
  status: string;
  input: { action: string; digest: string; params: StockFootageAdoptParams };
  output: StockAdoptionOutput | null;
  updatedAt: Date;
};

export function stockFootageAssetId(userId: number, requestId: string): string {
  return `sf_${createHash("sha256").update(`stock:${userId}:${requestId}`).digest("hex").slice(0, 48)}`;
}

export function stockAdoptDigest(params: StockFootageAdoptParams): string {
  const { requestId: _ignored, ...rest } = params;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

export type StockAdoptionDeps = {
  load: (id: string, userId: number) => Promise<StockAdoptionRecord | null>;
  claim: (record: StockAdoptionRecord) => Promise<boolean>;
  /** 乐观接手：仅当回执仍是 prevUpdatedAt 时成功。 */
  takeover: (id: string, userId: number, prevUpdatedAt: Date) => Promise<boolean>;
  save: (id: string, userId: number, output: StockAdoptionOutput, status?: "succeeded" | "failed") => Promise<void>;
  getAsset: typeof getPexelsAsset;
  download: (url: string, maxBytes: number) => Promise<{ buffer: Buffer; contentType: string | null }>;
  store: (params: { objectName: string; buffer: Buffer; contentType: string }) => Promise<{ gcsUri: string }>;
  sign: (gcsUri: string) => string;
  now: () => Date;
};

async function database() {
  const db = await getDb();
  if (!db) throw new StockFootageError("upstream", "数据库暂不可用");
  return db;
}

export async function downloadBounded(url: string, maxBytes: number, fetcher: typeof fetch = fetch) {
  if (!isAllowedStockDownloadUrl(url)) throw new StockFootageError("invalid", "素材下载地址不在允许范围");
  const response = await fetcher(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
  // 跟随跳转后再核一次最终主机，防止被引到白名单外。
  if (response.url && !isAllowedStockDownloadUrl(response.url)) throw new StockFootageError("invalid", "素材下载被重定向到不允许的地址");
  if (!response.ok) throw new StockFootageError("upstream", `素材下载失败（${response.status}）`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new StockFootageError("too_large", "素材文件超过处理上限");
  const reader = response.body?.getReader();
  if (!reader) throw new StockFootageError("upstream", "素材下载缺少响应流");
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new StockFootageError("too_large", "素材文件超过处理上限");
    }
    chunks.push(Buffer.from(value));
  }
  if (total === 0) throw new StockFootageError("upstream", "素材文件为空");
  return { buffer: Buffer.concat(chunks), contentType: response.headers.get("content-type") };
}

const realDeps: StockAdoptionDeps = {
  async load(id, userId) {
    const db = await database();
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)), eq(jobs.type, STOCK_FOOTAGE_JOB_TYPE)));
    return row ? (row as unknown as StockAdoptionRecord) : null;
  },
  async claim(record) {
    const db = await database();
    const rows = await db
      .insert(jobs)
      .values({ id: record.id, userId: record.userId, type: STOCK_FOOTAGE_JOB_TYPE, provider: "pexels", status: "running", input: record.input, output: record.output, attempts: 1 })
      .onConflictDoNothing({ target: jobs.id })
      .returning({ id: jobs.id });
    return rows.length === 1;
  },
  async takeover(id, userId, prevUpdatedAt) {
    const db = await database();
    const rows = await db
      .update(jobs)
      .set({ updatedAt: new Date(), attempts: sql`${jobs.attempts} + 1` })
      .where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)), eq(jobs.status, "running"), eq(jobs.updatedAt, prevUpdatedAt)))
      .returning({ id: jobs.id });
    return rows.length === 1;
  },
  async save(id, userId, output, status) {
    const db = await database();
    await db
      .update(jobs)
      .set({ output, ...(status ? { status } : {}), ...(status === "failed" ? { error: output.message ?? "failed" } : {}), updatedAt: new Date() })
      // 已成功的回执不可被任何后续写入覆盖。
      .where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)), sql`${jobs.status} <> 'succeeded'`));
  },
  getAsset: getPexelsAsset,
  download: (url, maxBytes) => downloadBounded(url, maxBytes),
  async store({ objectName, buffer, contentType }) {
    await uploadBufferToGcsIfAbsent({ objectName, buffer, contentType });
    return { gcsUri: `gs://${getGcsBucketName()}/${objectName}` };
  },
  sign: uri => signGsUriV4ReadUrl(uri, 7 * 24 * 3600),
  now: () => new Date(),
};

export const stockAdoptionLoader: StockAdoptionDeps["load"] = (id, userId) => realDeps.load(id, userId);
/** 隔离探针用：真实数据库与存储依赖（只读引用，探针可替换上游一环）。 */
export const realStockAdoptionDeps: Readonly<StockAdoptionDeps> = realDeps;

export function stockAdoptionResponseFor(row: StockAdoptionRecord, deps: Pick<StockAdoptionDeps, "sign" | "now"> = realDeps): StockFootageAdoptionResponse {
  const base = { assetId: row.id, requestId: row.input.params.requestId };
  const asset = row.status === "succeeded" ? row.output?.asset : undefined;
  if (asset) return { ...base, status: "succeeded", asset: { ...asset, url: deps.sign(asset.gcsUri) } };
  if (row.status === "failed" || row.output?.stage === "failed")
    return { ...base, status: "failed", message: row.output?.message || "素材未能采用，请换一个素材或重新采用" };
  const stale = deps.now().getTime() - new Date(row.updatedAt).getTime() > STOCK_ADOPT_STALE_MS;
  if (row.output?.lastError || stale)
    return { ...base, status: "reconcile_manual", message: "素材入库未完成，可用同一采用编号继续，不会重复入库" };
  return { ...base, status: "running", message: "素材正在入库" };
}

function extFor(mimeType: string, kind: "video" | "photo") {
  if (kind === "video") return "mp4";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

async function resolveUpstream(params: StockFootageAdoptParams, deps: StockAdoptionDeps, now: Date): Promise<Pick<StockAdoptionOutput, "evidence" | "file">> {
  const meta = await deps.getAsset(params.kind, params.providerAssetId);
  if (meta.kind === "video") {
    const file = pickBestVideoFile(meta.video.video_files, params.orientation);
    if (!file) throw new StockFootageError("not_found", "该视频没有可用的 mp4 文件");
    if (!isAllowedStockDownloadUrl(file.link)) throw new StockFootageError("invalid", "素材下载地址不在允许范围");
    return {
      evidence: {
        provider: "pexels",
        providerAssetId: params.providerAssetId,
        pageUrl: meta.video.url,
        author: { name: (meta.video.user?.name || "Pexels").slice(0, 300), ...(meta.video.user?.url ? { url: meta.video.user.url } : {}) },
        license: { ...PEXELS_LICENSE },
        downloadedFrom: file.link,
        providerFileId: String(file.id),
        retrievedAt: now.toISOString(),
      },
      file: { url: file.link, mimeType: "video/mp4", width: file.width!, height: file.height!, durationSec: meta.video.duration > 0 ? meta.video.duration : undefined, maxBytes: STOCK_VIDEO_MAX_BYTES },
    };
  }
  const picked = pickPhotoSource(meta.photo);
  if (!picked) throw new StockFootageError("not_found", "该照片没有可用文件");
  if (!isAllowedStockDownloadUrl(picked.url)) throw new StockFootageError("invalid", "素材下载地址不在允许范围");
  // large2x 为等比缩放，尺寸以原图比例推算；原图直接用元数据尺寸。
  const scale = picked.key === "large2x" ? Math.min(1, 1880 / Math.max(1, meta.photo.width)) : 1;
  return {
    evidence: {
      provider: "pexels",
      providerAssetId: params.providerAssetId,
      pageUrl: meta.photo.url,
      author: { name: (meta.photo.photographer || "Pexels").slice(0, 300), ...(meta.photo.photographer_url ? { url: meta.photo.photographer_url } : {}) },
      license: { ...PEXELS_LICENSE },
      downloadedFrom: picked.url,
      providerFileId: picked.key,
      retrievedAt: now.toISOString(),
    },
    file: {
      url: picked.url,
      mimeType: "image/jpeg",
      width: Math.max(1, Math.round(meta.photo.width * scale)),
      height: Math.max(1, Math.round(meta.photo.height * scale)),
      maxBytes: STOCK_PHOTO_MAX_BYTES,
    },
  };
}

const PERMANENT: ReadonlySet<StockFootageError["kind"]> = new Set<StockFootageError["kind"]>(["not_found", "invalid", "too_large"]);

export async function adoptStockFootage(
  userId: number,
  rawInput: StockFootageAdoptInput,
  deps: StockAdoptionDeps = realDeps
): Promise<StockFootageAdoptionResponse> {
  const params = stockFootageAdoptInputSchema.parse(rawInput);
  const id = stockFootageAssetId(userId, params.requestId);
  const digest = stockAdoptDigest(params);
  let row = await deps.load(id, userId);

  if (row) {
    if (row.input.digest !== digest) throw new StockFootageError("conflict", "该采用编号已用于其他素材，请重新发起采用");
    const current = stockAdoptionResponseFor(row, deps);
    if (current.status === "succeeded" || current.status === "failed" || current.status === "running") return current;
    if (!(await deps.takeover(id, userId, new Date(row.updatedAt)))) {
      const latest = await deps.load(id, userId);
      return latest ? stockAdoptionResponseFor(latest, deps) : current;
    }
  } else {
    const record: StockAdoptionRecord = {
      id,
      userId: String(userId),
      status: "running",
      input: { action: STOCK_FOOTAGE_ACTION, digest, params },
      output: { stage: "claimed" },
      updatedAt: deps.now(),
    };
    if (!(await deps.claim(record))) {
      const latest = await deps.load(id, userId);
      if (!latest) throw new StockFootageError("upstream", "采用回执尚未保存，请稍后用同一编号查询");
      if (latest.input.digest !== digest) throw new StockFootageError("conflict", "该采用编号已用于其他素材，请重新发起采用");
      return stockAdoptionResponseFor(latest, deps);
    }
    row = record;
  }

  let output: StockAdoptionOutput = { ...(row.output ?? { stage: "claimed" }), lastError: undefined };
  try {
    if (!output.evidence || !output.file) {
      output = { ...output, ...(await resolveUpstream(params, deps, deps.now())), stage: "resolved" };
      await deps.save(id, userId, output);
    }
    if (!output.stored) {
      const { buffer, contentType } = await deps.download(output.file!.url, output.file!.maxBytes);
      const mimeType = output.file!.mimeType;
      if (output.file!.mimeType === "video/mp4" && contentType && !/video\/|octet-stream/.test(contentType))
        throw new StockFootageError("invalid", "素材下载结果不是视频");
      if (output.file!.mimeType.startsWith("image/") && contentType && !/image\/|octet-stream/.test(contentType))
        throw new StockFootageError("invalid", "素材下载结果不是图片");
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const objectName = `stock-footage/${userId}/${id}.${extFor(mimeType, params.kind)}`;
      const { gcsUri } = await deps.store({ objectName, buffer, contentType: mimeType });
      output = { ...output, stage: "stored", stored: { gcsUri, bytes: buffer.byteLength, sha256 } };
      await deps.save(id, userId, output);
    }
    const asset = stockFootageAssetSchema.parse({
      assetId: id,
      requestId: params.requestId,
      kind: params.kind,
      purpose: params.purpose,
      usage: params.usage,
      gcsUri: output.stored!.gcsUri,
      mimeType: output.file!.mimeType,
      bytes: output.stored!.bytes,
      sha256: output.stored!.sha256,
      width: output.file!.width,
      height: output.file!.height,
      ...(output.file!.durationSec ? { durationSec: output.file!.durationSec } : {}),
      source: output.evidence!,
      context: params.context,
      adoptedAt: deps.now().toISOString(),
    } satisfies StockFootageAsset);
    output = { ...output, stage: "done", asset };
    await deps.save(id, userId, output, "succeeded");
    return { assetId: id, requestId: params.requestId, status: "succeeded", asset: { ...asset, url: deps.sign(asset.gcsUri) } };
  } catch (error) {
    if (error instanceof StockFootageError && PERMANENT.has(error.kind)) {
      await deps.save(id, userId, { ...output, stage: "failed", message: error.message }, "failed").catch(() => {});
      return { assetId: id, requestId: params.requestId, status: "failed", message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    await deps.save(id, userId, { ...output, lastError: message.slice(0, 500) }).catch(() => {});
    if (error instanceof StockFootageError && (error.kind === "not_configured" || error.kind === "rate_limited")) throw error;
    return { assetId: id, requestId: params.requestId, status: "reconcile_manual", message: "素材入库未完成，可用同一采用编号继续，不会重复入库" };
  }
}

export async function getStockAdoption(userId: number, requestId: string, deps: StockAdoptionDeps = realDeps) {
  const row = await deps.load(stockFootageAssetId(userId, requestId), userId);
  if (!row) throw new StockFootageError("not_found", "没有找到该采用记录");
  return stockAdoptionResponseFor(row, deps);
}

export async function listStockAdoptions(
  userId: number,
  filter: { purpose?: StockFootagePurpose; projectId?: string; limit: number },
  deps: Pick<StockAdoptionDeps, "sign"> = realDeps
) {
  const db = await database();
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, String(userId)),
        eq(jobs.type, STOCK_FOOTAGE_JOB_TYPE),
        eq(jobs.status, "succeeded"),
        filter.purpose ? sql`${jobs.input}::jsonb->'params'->>'purpose' = ${filter.purpose}` : undefined,
        filter.projectId ? sql`${jobs.input}::jsonb->'params'->'context'->>'projectId' = ${filter.projectId}` : undefined
      )
    )
    .orderBy(desc(jobs.updatedAt))
    .limit(filter.limit);
  return rows
    .map(r => stockFootageAssetSchema.safeParse((r.output as StockAdoptionOutput | null)?.asset))
    .filter(p => p.success)
    .map(p => ({ ...p.data!, url: deps.sign(p.data!.gcsUri) }));
}
