/**
 * 场景 3DGS 世界任务（PR-8）：场景参考图 → World Labs Marble → 产物落 Fly 桥（PR-9）→ 归档 GCS。
 *
 * 与 manhua3dTask 同一套状态机与纪律：
 *   - 记录文件在持久卷（/data/growth/manhua-world），排他创建 = 幂等（同人同图同模型同提示词只建一单）
 *   - 出站前先落 reconcile_manual，出站后再写 running；提交 rejected → failed（可重试），unknown → reconcile
 *   - 轮询直到 done；产物（500k spz / 全景 / 碰撞网格 / 缩略图）先写 Fly 卷（稳定地址，中国可达），再归档 gs://
 *   - 视图只回稳定地址与 gs://，不回上游会过期的链接
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ManhuaWorld3dAssets, ManhuaWorld3dModel, ManhuaWorld3dStatus } from "../../shared/manhuaWorld3d.js";
import { validateDepthPanoUploadMeta, type DepthPanoUploadMeta } from "../../shared/manhuaLayoutDepthPano.js";
import { archiveBridgeFileToGcs, bridgeRelPath, buildBridgeMediaUrl, writeBridgeFileFromUrl } from "./flyEditBridge.js";
import { uploadBufferToGcs } from "./gcs.js";
import {
  deleteMarbleWorld,
  isWorldlabsMarbleConfigured,
  pollMarbleDepthToRgbOnce,
  pollMarbleOperationOnce,
  submitMarbleDepthToRgb,
  submitMarbleGenerate,
  uploadMarbleMediaAsset,
  type MarbleDepthToRgbInput,
  type MarbleDepthToRgbSnapshot,
  type MarbleGenerateInput,
  type MarbleOperationCost,
  type MarbleOperationSnapshot,
  type MarbleWorldAssets,
} from "./worldlabsMarble.js";

const PRIMARY_TASK_DIR = "/data/growth/manhua-world";
const POLL_INTERVAL_MS = Math.max(3_000, Math.min(Number(process.env.MANHUA_WORLD_POLL_INTERVAL_MS) || 15_000, 60_000));
const MAX_POLL_MS = Math.max(5 * 60_000, Math.min(Number(process.env.MANHUA_WORLD_MAX_POLL_MS) || 40 * 60_000, 3 * 60 * 60_000));
/** 产物单文件上限：full_res spz 可到几百 MB，先只镜像 500k + 全景 + 碰撞 + 缩略图 */
const MAX_PRODUCT_BYTES = 400 * 1024 * 1024;

export type ManhuaWorldTaskStatus = ManhuaWorld3dStatus;

export type ManhuaWorldPromptRecord =
  | { type: "text"; textPrompt: string }
  | { type: "image"; isPano: boolean | "auto"; textPrompt?: string }
  /**
   * PR-11 布局可控：我们渲的深度全景 → depth_to_rgb 上色 → 再以 is_pano:true 建世界（两步各记 operationId）。
   * WL-D01：depthMeta（zMin/zMax/编码/尺寸）是 API 字段，必须结构化随单走，文件名里的数字不算。
   */
  | { type: "layout"; depthPanoUrl: string; depthPanoGcsUri?: string; depthMeta: DepthPanoUploadMeta; textPrompt: string };

export type ManhuaWorldTaskRecord = {
  taskId: string;
  userId: number;
  /** 场景参考图 ref.id */
  sceneRef: string;
  /** 场景图版本（gs:// 优先） */
  sourceVersion: string;
  /** 场景图 https（签名会轮换，只用于提交；有 gs:// 时提交前重签） */
  sourceImageUrl: string;
  sourceImageGcsUri?: string;
  displayName: string;
  model: ManhuaWorld3dModel;
  prompt: ManhuaWorldPromptRecord;
  status: ManhuaWorldTaskStatus;
  operationId?: string;
  /** layout 第一步（depth_to_rgb）：先把深度 PNG 传成 Marble media asset（钥匙只在 Fly），再提交；操作号与产物分别持久化 */
  depthMediaAssetId?: string;
  depthOperationId?: string;
  depthPanoRgbUrl?: string;
  /** 上游 Operation.cost 原样记账（可空≠零费）；与用户积分不是一份账 */
  depthCost?: MarbleOperationCost;
  worldCost?: MarbleOperationCost;
  worldId?: string;
  /** 上游产物原始链接（会过期；只作镜像来源） */
  upstreamAssets?: MarbleWorldAssets;
  assets?: ManhuaWorld3dAssets;
  errorZh?: string;
  lastTransientError?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type ManhuaWorldTaskView = Pick<
  ManhuaWorldTaskRecord,
  "taskId" | "sceneRef" | "sourceVersion" | "displayName" | "model" | "status" | "worldId" | "assets" | "errorZh" | "createdAt" | "updatedAt" | "finishedAt" | "depthCost" | "worldCost"
>;

type Deps = {
  isConfigured: () => boolean;
  submit: (input: MarbleGenerateInput) => Promise<{ operationId: string; worldId?: string }>;
  poll: (operationId: string) => Promise<MarbleOperationSnapshot>;
  submitDepth: (input: MarbleDepthToRgbInput) => Promise<{ operationId: string }>;
  pollDepth: (operationId: string) => Promise<MarbleDepthToRgbSnapshot>;
  /** 深度 PNG（GCS 签名链）→ 字节：Fly 拉下来再传 Marble media asset */
  fetchSource: (url: string) => Promise<Uint8Array>;
  uploadMedia: (input: { bytes: Uint8Array; contentType: string; fileName: string; kind: "image" | "video"; extension: string }) => Promise<{ mediaAssetId: string }>;
  deleteWorld: (worldId: string) => Promise<boolean>;
  /** 上游产物 → Fly 卷 */
  mirror: (ref: { ns: string; id: string; name: string }, url: string) => Promise<{ relPath: string; bytes: number }>;
  /** Fly 卷 → GCS 归档 */
  archive: (relPath: string, objectName: string) => Promise<{ gcsUri: string }>;
  signSource: (gcsUri: string) => Promise<string>;
  now: () => Date;
};

const productionDeps: Deps = {
  isConfigured: isWorldlabsMarbleConfigured,
  submit: submitMarbleGenerate,
  poll: pollMarbleOperationOnce,
  submitDepth: submitMarbleDepthToRgb,
  pollDepth: pollMarbleDepthToRgbOnce,
  fetchSource: async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`depth_source_http_${response.status}`);
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.length > 32 * 1024 * 1024) throw new Error("depth_source_too_large");
    return buf;
  },
  uploadMedia: uploadMarbleMediaAsset,
  deleteWorld: deleteMarbleWorld,
  mirror: (ref, url) => writeBridgeFileFromUrl(ref, url, { maxBytes: MAX_PRODUCT_BYTES }),
  archive: (relPath, objectName) => archiveBridgeFileToGcs(relPath, objectName, { upload: uploadBufferToGcs }),
  signSource: async (gcsUri) => (await import("./gcs.js")).signGsUriV4ReadUrl(gcsUri, 3 * 3600),
  now: () => new Date(),
};

let deps = productionDeps;
const inflight = new Set<string>();
let workerTimer: NodeJS.Timeout | null = null;

function taskDir(): string {
  return String(process.env.MANHUA_WORLD_TASK_DIR || PRIMARY_TASK_DIR).trim() || PRIMARY_TASK_DIR;
}
function isoNow(): string {
  return deps.now().toISOString();
}
function recordPath(taskId: string): string {
  return path.join(taskDir(), `${String(taskId || "").replace(/[^a-zA-Z0-9_.-]+/g, "_")}.json`);
}
async function ensureStore(): Promise<void> {
  try {
    await fs.mkdir(taskDir(), { recursive: true });
  } catch (error) {
    console.error("[manhuaWorldTask] persistent task store unavailable", error);
    throw new Error("manhua_world_task_store_unavailable");
  }
}
async function writeRecord(record: ManhuaWorldTaskRecord): Promise<void> {
  await ensureStore();
  record.updatedAt = isoNow();
  const target = recordPath(record.taskId);
  const temporary = `${target}.tmp.${process.pid}.${randomUUID()}`;
  await fs.writeFile(temporary, JSON.stringify(record, null, 2));
  await fs.rename(temporary, target);
}
async function createRecordExclusive(record: ManhuaWorldTaskRecord): Promise<boolean> {
  await ensureStore();
  try {
    await fs.writeFile(recordPath(record.taskId), JSON.stringify(record, null, 2), { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
    throw error;
  }
}
async function readRecord(taskId: string): Promise<ManhuaWorldTaskRecord | null> {
  await ensureStore();
  try {
    return JSON.parse(await fs.readFile(recordPath(taskId), "utf8")) as ManhuaWorldTaskRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}
async function listRecords(): Promise<ManhuaWorldTaskRecord[]> {
  await ensureStore();
  const names = await fs.readdir(taskDir()).catch(() => [] as string[]);
  const out: ManhuaWorldTaskRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rec = await readRecord(name.slice(0, -5)).catch(() => null);
    if (rec) out.push(rec);
  }
  return out;
}

export function toManhuaWorldTaskView(record: ManhuaWorldTaskRecord): ManhuaWorldTaskView {
  return {
    taskId: record.taskId,
    sceneRef: record.sceneRef,
    sourceVersion: record.sourceVersion,
    displayName: record.displayName,
    model: record.model,
    status: record.status,
    ...(record.worldId ? { worldId: record.worldId } : {}),
    ...(record.assets ? { assets: record.assets } : {}),
    ...(record.errorZh ? { errorZh: record.errorZh } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
  };
}

function idempotencyDigest(input: { userId: number; sceneRef: string; sourceVersion: string; model: string; prompt: ManhuaWorldPromptRecord }): string {
  return createHash("sha256").update(JSON.stringify([input.userId, input.sceneRef, input.sourceVersion, input.model, input.prompt])).digest("hex");
}

async function markFailed(record: ManhuaWorldTaskRecord, errorZh: string, internal?: unknown) {
  record.status = "failed";
  record.errorZh = errorZh;
  record.lastTransientError = internal == null ? undefined : String(internal instanceof Error ? internal.message : internal).slice(0, 280);
  record.finishedAt = isoNow();
  await writeRecord(record);
  return record;
}
async function markReconcile(record: ManhuaWorldTaskRecord, errorZh: string, internal?: unknown) {
  record.status = "reconcile_manual";
  record.errorZh = errorZh;
  record.lastTransientError = internal == null ? undefined : String(internal instanceof Error ? internal.message : internal).slice(0, 280);
  record.finishedAt = isoNow();
  await writeRecord(record);
  return record;
}

/** 镜像清单：文件名固定，前端按名取；full_res 不镜像（太大，需要时再按 gs:// 拉） */
const MIRROR_PLAN: Array<{ name: string; pick: (a: MarbleWorldAssets) => string | undefined; url: keyof ManhuaWorld3dAssets; gcs: keyof ManhuaWorld3dAssets; required: boolean }> = [
  { name: "scene-500k.spz", pick: (a) => a.spzUrls["500k"] || a.spzUrls.full_res || a.spzUrls["100k"], url: "spz500kUrl", gcs: "spz500kGcsUri", required: true },
  { name: "pano.jpg", pick: (a) => a.panoUrl, url: "panoUrl", gcs: "panoGcsUri", required: false },
  { name: "collider.glb", pick: (a) => a.colliderMeshUrl, url: "colliderGlbUrl", gcs: "colliderGlbGcsUri", required: false },
  { name: "thumb.jpg", pick: (a) => a.thumbnailUrl, url: "thumbnailUrl", gcs: "thumbnailUrl", required: false },
];

function archiveObjectName(record: ManhuaWorldTaskRecord, name: string): string {
  return `manhua-world/u${record.userId}/${record.taskId}/${name}`;
}

/** 把上游产物镜像到 Fly 桥并归档；部分失败保留 lastTransientError 下轮再补，不丢已成的 */
async function mirrorProducts(record: ManhuaWorldTaskRecord, upstream: MarbleWorldAssets): Promise<{ done: boolean; assets: ManhuaWorld3dAssets }> {
  const assets: ManhuaWorld3dAssets = { ...(record.assets || {}) };
  if (typeof upstream.metricScaleFactor === "number") assets.metricScaleFactor = upstream.metricScaleFactor;
  if (typeof upstream.groundPlaneOffset === "number") assets.groundPlaneOffset = upstream.groundPlaneOffset;
  if (upstream.caption) assets.caption = upstream.caption;
  if (upstream.worldMarbleUrl) assets.worldMarbleUrl = upstream.worldMarbleUrl;
  let done = true;
  for (const item of MIRROR_PLAN) {
    if (assets[item.url]) {
      // 已镜像但归档没成：按确定性相对路径补归档（不重新下载）
      if (item.gcs !== item.url && !assets[item.gcs]) {
        try {
          const archived = await deps.archive(bridgeRelPath({ ns: "world", id: record.taskId, name: item.name }), archiveObjectName(record, item.name));
          (assets as Record<string, unknown>)[item.gcs] = archived.gcsUri;
        } catch (error) {
          record.lastTransientError = `archive_failed:${item.name}:${error instanceof Error ? error.message : String(error)}`.slice(0, 280);
          done = false;
        }
      }
      continue;
    }
    const src = item.pick(upstream);
    if (!src) {
      if (item.required) done = false;
      continue;
    }
    try {
      const mirrored = await deps.mirror({ ns: "world", id: record.taskId, name: item.name }, src);
      (assets as Record<string, unknown>)[item.url] = buildBridgeMediaUrl(mirrored.relPath);
      if (item.gcs !== item.url) {
        try {
          const archived = await deps.archive(mirrored.relPath, archiveObjectName(record, item.name));
          (assets as Record<string, unknown>)[item.gcs] = archived.gcsUri;
        } catch (error) {
          // 归档失败不挡使用：Fly 副本已可看；下轮 advance 再补归档
          record.lastTransientError = `archive_failed:${item.name}:${error instanceof Error ? error.message : String(error)}`.slice(0, 280);
          done = false;
        }
      }
    } catch (error) {
      record.lastTransientError = `mirror_failed:${item.name}:${error instanceof Error ? error.message : String(error)}`.slice(0, 280);
      if (item.required) done = false;
    }
  }
  return { done, assets };
}

export async function advanceManhuaWorldTask(taskId: string): Promise<ManhuaWorldTaskRecord | null> {
  if (inflight.has(taskId)) return readRecord(taskId);
  inflight.add(taskId);
  try {
    const record = await readRecord(taskId);
    if (!record) return null;
    if (record.status === "succeeded" || record.status === "failed" || record.status === "reconcile_manual") {
      // 已成功但归档没补齐：静默补一次（不改状态）
      if (record.status === "succeeded" && record.upstreamAssets && record.assets && !record.assets.spz500kGcsUri) {
        const { assets } = await mirrorProducts(record, record.upstreamAssets);
        record.assets = assets;
        await writeRecord(record);
      }
      return record;
    }

    if (!record.operationId && record.prompt.type === "layout") {
      // 第一步：深度全景 → RGB 全景。上传/提交被拒 → failed（可重试）；提交不确定 → reconcile；
      // 第一步产物（media asset / operationId / pano_url）各自持久化，重试只补缺的那一步，不重付。
      const metaCheck = validateDepthPanoUploadMeta(record.prompt.depthMeta);
      if (!metaCheck.ok) return markFailed(record, `深度元数据不合格：${metaCheck.reasonZh}`);
      if (!record.depthMediaAssetId) {
        // 签名 url 会过期：有 gs:// 就重新签；签不动/拉不动/传不上 → failed，不占上游（没有付费动作）
        let depthPanoUrl = record.prompt.depthPanoUrl;
        if (record.prompt.depthPanoGcsUri) {
          try {
            depthPanoUrl = await deps.signSource(record.prompt.depthPanoGcsUri);
          } catch (error) {
            return markFailed(record, "深度全景签名失败，未提交上游，可重试", error);
          }
        }
        let bytes: Uint8Array;
        try {
          bytes = await deps.fetchSource(depthPanoUrl);
        } catch (error) {
          return markFailed(record, "深度全景拉取失败，未提交上游，可重试", error);
        }
        try {
          const uploaded = await deps.uploadMedia({ bytes, contentType: "image/png", fileName: `depth-${record.taskId}.png`, kind: "image", extension: "png" });
          record.depthMediaAssetId = uploaded.mediaAssetId;
          record.startedAt = record.startedAt || isoNow();
          await writeRecord(record);
        } catch (error) {
          return markFailed(record, "深度全景上传到上游素材库失败，未提交上色，可重试", error);
        }
      }
      if (!record.depthOperationId) {
        record.status = "reconcile_manual";
        record.errorZh = "提交结果正在确认，为避免重复生成不会自动重试";
        record.startedAt = record.startedAt || isoNow();
        await writeRecord(record);
        try {
          const submitted = await deps.submitDepth({
            depth: { source: "media_asset", mediaAssetId: record.depthMediaAssetId! },
            textPrompt: record.prompt.textPrompt,
            zMin: metaCheck.meta.zMin,
            zMax: metaCheck.meta.zMax,
          });
          record.depthOperationId = submitted.operationId;
          record.status = "running";
          record.errorZh = undefined;
          record.lastTransientError = undefined;
          await writeRecord(record);
        } catch (error) {
          const kind = (error as { kind?: string } | null)?.kind;
          if (kind === "rejected") return markFailed(record, "深度全景上色任务未能创建（上游拒绝）", error);
          return markReconcile(record, "提交结果无法确认，为避免重复生成已停止自动重试", error);
        }
      }
      if (!record.depthPanoRgbUrl) {
        if (deps.now().getTime() - Date.parse(record.createdAt) > MAX_POLL_MS) {
          return markReconcile(record, "深度全景上色长时间没有终态，已转人工对账");
        }
        const depth = await deps.pollDepth(record.depthOperationId!);
        if (depth.state === "reconcile") return markReconcile(record, depth.error);
        if (depth.state === "failed") return markFailed(record, "深度全景上色失败", depth.error);
        if (depth.state === "running") {
          record.status = "running";
          record.lastTransientError = `depth:${depth.status}`.slice(0, 280);
          await writeRecord(record);
          return record;
        }
        record.depthPanoRgbUrl = depth.panoUrl;
        if (depth.cost) record.depthCost = depth.cost;
        record.lastTransientError = undefined;
        await writeRecord(record);
      }
    }

    if (!record.operationId) {
      let imageUrl = record.sourceImageUrl;
      if (record.prompt.type === "image" && record.sourceImageGcsUri) {
        try {
          imageUrl = await deps.signSource(record.sourceImageGcsUri);
        } catch (error) {
          return markFailed(record, "场景图签名失败，未提交上游，可重试", error);
        }
      }
      record.status = "reconcile_manual";
      record.errorZh = "提交结果正在确认，为避免重复生成不会自动重试";
      record.startedAt = record.startedAt || isoNow();
      await writeRecord(record);
      try {
        const submitted = await deps.submit({
          displayName: record.displayName,
          model: record.model,
          prompt:
            record.prompt.type === "text"
              ? { type: "text", textPrompt: record.prompt.textPrompt }
              : record.prompt.type === "layout"
                ? { type: "image", imageUrl: record.depthPanoRgbUrl!, isPano: true, textPrompt: record.prompt.textPrompt }
                : { type: "image", imageUrl, isPano: record.prompt.isPano, ...(record.prompt.textPrompt ? { textPrompt: record.prompt.textPrompt } : {}) },
        });
        record.operationId = submitted.operationId;
        if (submitted.worldId) record.worldId = submitted.worldId;
        record.status = "running";
        record.errorZh = undefined;
        record.lastTransientError = undefined;
        await writeRecord(record);
      } catch (error) {
        const kind = (error as { kind?: string } | null)?.kind;
        if (kind === "rejected") return markFailed(record, "3D 世界任务未能创建（上游拒绝）", error);
        return markReconcile(record, "提交结果无法确认，为避免重复生成已停止自动重试", error);
      }
    }

    if (deps.now().getTime() - Date.parse(record.createdAt) > MAX_POLL_MS) {
      return markReconcile(record, "3D 世界任务长时间没有终态，已转人工对账");
    }

    const snapshot = await deps.poll(record.operationId!);
    if (snapshot.state === "reconcile") return markReconcile(record, snapshot.error);
    if (snapshot.state === "failed") return markFailed(record, "3D 世界生成失败", snapshot.error);
    if (snapshot.state === "running") {
      record.status = "running";
      if (snapshot.worldId) record.worldId = snapshot.worldId;
      record.lastTransientError = snapshot.status.slice(0, 280);
      await writeRecord(record);
      return record;
    }

    record.worldId = snapshot.worldId;
    record.upstreamAssets = snapshot.assets;
    if (snapshot.cost) record.worldCost = snapshot.cost;
    const { done, assets } = await mirrorProducts(record, snapshot.assets);
    record.assets = assets;
    if (!assets.spz500kUrl) {
      // 主产物没镜像下来：保持 running 让下一轮重试（上游链接短期有效）
      record.status = "running";
      await writeRecord(record);
      return record;
    }
    record.status = "succeeded";
    record.errorZh = undefined;
    if (done) record.lastTransientError = undefined;
    record.finishedAt = isoNow();
    await writeRecord(record);
    return record;
  } finally {
    inflight.delete(taskId);
  }
}

export async function createManhuaWorldTask(input: {
  userId: number;
  sceneRef: string;
  sourceVersion: string;
  sourceImageUrl: string;
  sourceImageGcsUri?: string;
  displayName: string;
  model: ManhuaWorld3dModel;
  prompt: ManhuaWorldPromptRecord;
}): Promise<ManhuaWorldTaskView> {
  const sceneRef = String(input.sceneRef || "").trim();
  const sourceVersion = String(input.sourceVersion || "").trim();
  const sourceImageUrl = String(input.sourceImageUrl || "").trim();
  const displayName = String(input.displayName || "").trim().slice(0, 120) || sceneRef;
  if (!Number.isInteger(input.userId) || input.userId <= 0) throw new Error("invalid_user_id");
  if (!sceneRef || !sourceVersion || !/^https:\/\//i.test(sourceImageUrl)) throw new Error("invalid_manhua_world_task_input");
  if (input.prompt.type === "text" && !String(input.prompt.textPrompt || "").trim()) throw new Error("invalid_manhua_world_task_input");
  if (input.prompt.type === "layout" && (!String(input.prompt.textPrompt || "").trim() || !/^https:\/\//i.test(String(input.prompt.depthPanoUrl || "")))) {
    throw new Error("invalid_manhua_world_task_input");
  }
  // WL-D01：缺/坏深度元数据在建单前就拒，零上游调用
  const depthMeta = input.prompt.type === "layout" ? validateDepthPanoUploadMeta(input.prompt.depthMeta) : null;
  if (depthMeta && !depthMeta.ok) throw new Error(`invalid_manhua_world_depth_meta:${depthMeta.reasonZh}`);
  if (!deps.isConfigured()) throw new Error("manhua_world_service_unavailable");

  const prompt: ManhuaWorldPromptRecord =
    input.prompt.type === "text"
      ? { type: "text", textPrompt: String(input.prompt.textPrompt).trim().slice(0, 2_000) }
      : input.prompt.type === "layout"
        ? {
            type: "layout",
            depthPanoUrl: String(input.prompt.depthPanoUrl).trim().slice(0, 4_096),
            ...(input.prompt.depthPanoGcsUri && /^gs:\/\//i.test(input.prompt.depthPanoGcsUri) ? { depthPanoGcsUri: String(input.prompt.depthPanoGcsUri).trim().slice(0, 2_048) } : {}),
            depthMeta: (depthMeta as { ok: true; meta: DepthPanoUploadMeta }).meta,
            textPrompt: String(input.prompt.textPrompt).trim().slice(0, 2_000),
          }
        : { type: "image", isPano: input.prompt.isPano, ...(input.prompt.textPrompt?.trim() ? { textPrompt: input.prompt.textPrompt.trim().slice(0, 2_000) } : {}) };
  const digest = idempotencyDigest({ userId: input.userId, sceneRef, sourceVersion, model: input.model, prompt });
  const taskId = `mw_${digest.slice(0, 24)}`;
  const now = isoNow();
  const record: ManhuaWorldTaskRecord = {
    taskId,
    userId: input.userId,
    sceneRef,
    sourceVersion,
    sourceImageUrl,
    ...(input.sourceImageGcsUri && /^gs:\/\//i.test(input.sourceImageGcsUri) ? { sourceImageGcsUri: input.sourceImageGcsUri } : {}),
    displayName,
    model: input.model,
    prompt,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  const created = await createRecordExclusive(record);
  if (!created) {
    const existing = await readRecord(taskId);
    if (!existing) throw new Error("manhua_world_idempotency_record_missing");
    return toManhuaWorldTaskView(existing);
  }
  const advanced = (await advanceManhuaWorldTask(taskId)) || record;
  ensureManhuaWorldWorker();
  return toManhuaWorldTaskView(advanced);
}

export async function retryManhuaWorldTask(taskId: string, userId: number): Promise<ManhuaWorldTaskView | null> {
  const record = await readRecord(taskId);
  if (!record || record.userId !== userId) return null;
  if (record.status === "reconcile_manual") throw new Error("manhua_world_retry_reconcile_forbidden");
  if (record.status !== "failed") throw new Error("manhua_world_retry_not_failed");
  const now = isoNow();
  // 1472 R1：重试号只由上一次 taskId 派生（与 manhua3dTask 同口径）——同一失败任务连点两次不会向 Marble 提交两单；
  // 重试再失败后，新失败任务号又能派生下一次。原先掺入时间戳，每次点击都是新任务 = 重复扣上游 credits。
  // layout 两步：第一步（上色）已有产物就只重做第二步，绝不重付第一步；已传好的 media asset 也留用
  const keepDepth = record.prompt.type === "layout" && Boolean(record.depthPanoRgbUrl);
  const retried: ManhuaWorldTaskRecord = {
    ...record,
    taskId: `mw_${createHash("sha256").update(JSON.stringify(["retry", record.taskId])).digest("hex").slice(0, 24)}`,
    status: "queued",
    operationId: undefined,
    depthMediaAssetId: record.depthMediaAssetId,
    depthOperationId: keepDepth ? record.depthOperationId : undefined,
    depthPanoRgbUrl: keepDepth ? record.depthPanoRgbUrl : undefined,
    depthCost: keepDepth ? record.depthCost : undefined,
    worldCost: undefined,
    worldId: undefined,
    upstreamAssets: undefined,
    assets: undefined,
    errorZh: undefined,
    lastTransientError: undefined,
    finishedAt: undefined,
    startedAt: undefined,
    createdAt: now,
    updatedAt: now,
  };
  const created = await createRecordExclusive(retried);
  if (!created) {
    const existing = await readRecord(retried.taskId);
    if (!existing) throw new Error("manhua_world_idempotency_record_missing");
    return toManhuaWorldTaskView(existing);
  }
  const advanced = (await advanceManhuaWorldTask(retried.taskId)) || retried;
  ensureManhuaWorldWorker();
  return toManhuaWorldTaskView(advanced);
}

export async function getManhuaWorldTask(taskId: string, userId: number): Promise<ManhuaWorldTaskView | null> {
  const record = await readRecord(taskId);
  if (!record || record.userId !== userId || record.deletedAt) return null;
  return toManhuaWorldTaskView(record);
}

export async function listManhuaWorldTasks(userId: number, limit = 50): Promise<ManhuaWorldTaskView[]> {
  const all = await listRecords();
  return all
    .filter((r) => r.userId === userId && !r.deletedAt)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 200)))
    .map(toManhuaWorldTaskView);
}

/** 删除：上游世界删掉（省 Marble 存储），本地记录标记删除；Fly/GCS 产物保留（归档不删） */
export async function deleteManhuaWorldTask(taskId: string, userId: number): Promise<boolean> {
  const record = await readRecord(taskId);
  if (!record || record.userId !== userId) return false;
  if (record.status === "queued" || record.status === "running") throw new Error("manhua_world_delete_busy");
  if (record.worldId) {
    const ok = await deps.deleteWorld(record.worldId).catch(() => false);
    if (!ok) record.lastTransientError = "upstream_delete_failed";
  }
  record.deletedAt = isoNow();
  await writeRecord(record);
  return true;
}

/**
 * worker 该不该推进这条记录：排队/运行中，或已成功但主产物归档还没补上（1472 R3：原先 worker 只看 queued/running，
 * 「归档失败下轮补」实际永远不会发生）。补归档只读 Fly 副本再上传，不碰上游。
 */
export const ARCHIVE_RETRY_MS = 5 * 60_000;
export function shouldManhuaWorldWorkerTouch(
  r: Pick<ManhuaWorldTaskRecord, "status" | "upstreamAssets" | "assets" | "deletedAt" | "updatedAt">,
  nowMs: number = deps.now().getTime(),
): boolean {
  if (r.deletedAt) return false;
  if (r.status === "queued" || r.status === "running") return true;
  if (r.status !== "succeeded" || !r.upstreamAssets || !r.assets || r.assets.spz500kGcsUri) return false;
  // 补归档每次失败都会 writeRecord 刷新 updatedAt：按 5 分钟退避，GCS 长期不可用时不至于每 15s 打一次
  const last = Date.parse(r.updatedAt || "");
  return !Number.isFinite(last) || nowMs - last >= ARCHIVE_RETRY_MS;
}

export function ensureManhuaWorldWorker(): void {
  if (workerTimer || process.env.NODE_ENV === "test") return;
  workerTimer = setInterval(() => {
    void listRecords()
      .then(async (records) => {
        for (const r of records) {
          if (!shouldManhuaWorldWorkerTouch(r)) continue;
          await advanceManhuaWorldTask(r.taskId).catch((error) => console.warn("[manhuaWorldTask] worker tick failed", r.taskId, error));
        }
      })
      .catch((error) => console.warn("[manhuaWorldTask] worker scan failed", error));
  }, POLL_INTERVAL_MS);
  workerTimer.unref?.();
}

export async function resumeManhuaWorldTasksOnStartup(): Promise<void> {
  ensureManhuaWorldWorker();
  const records = await listRecords();
  for (const r of records) {
    if (!shouldManhuaWorldWorkerTouch(r)) continue;
    await advanceManhuaWorldTask(r.taskId).catch((error) => console.warn("[manhuaWorldTask] startup resume failed", r.taskId, error));
  }
}

/** 仅供 Vitest 注入虚构依赖 */
export function setManhuaWorldTaskDependenciesForTests(overrides: Partial<Deps>): void {
  if (process.env.NODE_ENV !== "test") throw new Error("test_dependencies_only");
  deps = { ...productionDeps, ...overrides };
}
export function resetManhuaWorldTaskDependenciesForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("test_dependencies_only");
  deps = productionDeps;
  inflight.clear();
}
