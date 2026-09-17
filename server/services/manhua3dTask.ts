import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  SubmitRejectedError,
  SubmitUnknownError,
} from "./submitOutcomeErrors.js";
import { getGcsBucketName, inspectGcsObjectBounded, rewriteGcsObjectGenerationIfAbsent, signGsUriV4ReadUrl, statGcsObjectVersion, uploadBufferToGcs, downloadGcsObject } from "./gcs";
import { assertValidGlb2, Glb2StreamValidator } from "../../shared/glbValidation.js";
import {
  pollWavespeedTripo3dOnce,
  isWavespeedTripo3dConfigured,
  submitWavespeedTripo3d,
  submitWavespeedTripo3dMultiview,
  type TripoH31Orientation,
  type TripoH31Quality,
  type TripoH31TextureAlignment,
  type WavespeedTripo3dInput,
  type WavespeedTripo3dMultiviewInput,
  type WavespeedTripo3dPollSnapshot,
} from "./wavespeedTripo3d.js";

const PRIMARY_TASK_DIR = "/data/growth/manhua-3d";
const POLL_INTERVAL_MS = Math.max(
  3_000,
  Math.min(Number(process.env.MANHUA_3D_POLL_INTERVAL_MS) || 10_000, 60_000)
);
const MAX_POLL_MS = Math.max(
  5 * 60_000,
  Math.min(
    Number(process.env.MANHUA_3D_MAX_POLL_MS) || 45 * 60_000,
    6 * 60 * 60_000
  )
);
const MAX_GLB_BYTES = 250 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export type Manhua3dTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "reconcile_manual";

export type Manhua3dTaskOptions = {
  texture: boolean;
  pbr: boolean;
  textureQuality: TripoH31Quality;
  geometryQuality: TripoH31Quality;
  textureAlignment: TripoH31TextureAlignment;
  orientation: TripoH31Orientation;
  autoSize: boolean;
  quad: boolean;
};

export type Manhua3dTaskRecord = {
  taskId: string;
  userId: number;
  assetRef: string;
  sourceVersion: string;
  sourceImageUrl: string;
  /**
   * 0916 多视角：正交视角图签名 URL，顺序 前/左/后/右（2–4 张）。有它就走 multiview-to-3d。
   * 签名 URL 会轮换：有 gs:// 时提交前重签，不拿过期链接出站。
   */
  multiviewImageUrls?: string[];
  multiviewImageGcsUris?: string[];
  /** 视角图集合的稳定版本（调用方按视角图 gs:// 或内容摘要算），进幂等摘要 */
  multiviewVersion?: string;
  status: Manhua3dTaskStatus;
  options: Manhua3dTaskOptions;
  predictionId?: string;
  sourceGlbUrl?: string;
  glbGcsUri?: string;
  glbUrl?: string;
  glbUrlExpiresAt?: string;
  glbBytes?: number;
  glbSha256?: string;
  errorZh?: string;
  lastTransientError?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type Manhua3dTaskView = Pick<
  Manhua3dTaskRecord,
  | "taskId"
  | "assetRef"
  | "sourceVersion"
  | "sourceImageUrl"
  /** 0916 多视角：前端据此分辨任务类型。只回稳定身份（版本 / gs://）与张数，不回会过期的签名 URL（1469 R2） */
  | "multiviewVersion"
  | "multiviewImageGcsUris"
  | "status"
  | "predictionId"
  | "glbGcsUri"
  | "glbUrl"
  | "glbUrlExpiresAt"
  | "glbBytes"
  | "glbSha256"
  | "errorZh"
  | "createdAt"
  | "updatedAt"
  | "finishedAt"
> & { multiviewImageCount?: number };

type Manhua3dTaskDependencies = {
  /** 0917：回执镜像到 GCS——rig 进程组没有 /data 卷，读不到主机本地回执 */
  mirrorRecord: (objectName: string, buffer: Buffer) => Promise<void>;
  readMirroredRecord: (objectName: string) => Promise<Buffer | null>;
  isConfigured: () => boolean;
  submit: (input: WavespeedTripo3dInput) => Promise<{ predictionId: string }>;
  submitMultiview: (input: WavespeedTripo3dMultiviewInput) => Promise<{ predictionId: string }>;
  poll: (predictionId: string) => Promise<WavespeedTripo3dPollSnapshot>;
  downloadGlb: (url: string) => Promise<Buffer>;
  uploadGlb: typeof uploadBufferToGcs;
  inspectUploadedGlb: (gcsUri: string) => Promise<{
    header: Buffer;
    byteLength: number;
    sha256: string;
    generation: string;
  }>;
  rewriteUploadedGlb: (input: {
    sourceGcsUri: string;
    sourceGeneration: string;
    destinationObjectName: string;
  }) => Promise<{ gcsUri: string }>;
  getBucketName: () => string;
  signGlb: typeof signGsUriV4ReadUrl;
  now: () => Date;
};

const productionDependencies: Manhua3dTaskDependencies = {
  mirrorRecord: async (objectName, buffer) => {
    if (!gcsCredentialsPresent()) return; // 本机/测试无 GCS 凭证：不镜像，本地仍是真源
    await uploadBufferToGcs({ objectName, buffer, contentType: "application/json" });
  },
  readMirroredRecord: async (objectName) => {
    if (!gcsCredentialsPresent()) return null;
    try {
      const { buffer } = await downloadGcsObject({ gcsUri: `gs://${getGcsBucketName()}/${objectName}` });
      return buffer;
    } catch (error) {
      if (/gcs_(?:stat|download)_failed:404|404/.test(error instanceof Error ? error.message : String(error))) return null;
      throw error;
    }
  },
  isConfigured: isWavespeedTripo3dConfigured,
  submit: submitWavespeedTripo3d,
  submitMultiview: submitWavespeedTripo3dMultiview,
  poll: pollWavespeedTripo3dOnce,
  downloadGlb: downloadGlb,
  uploadGlb: uploadBufferToGcs,
  inspectUploadedGlb: async gcsUri => {
    const signal = AbortSignal.timeout(120_000);
    const version = await statGcsObjectVersion({ gcsUri, signal });
    const validator = new Glb2StreamValidator();
    const inspected = await inspectGcsObjectBounded({
      gcsUri,
      maxBytes: MAX_GLB_BYTES,
      headerBytes: 12,
      timeoutMs: 120_000,
      signal,
      generation: version.generation,
      onChunk: chunk => validator.push(chunk),
    });
    validator.finish();
    return { ...inspected, generation: version.generation };
  },
  rewriteUploadedGlb: input =>
    rewriteGcsObjectGenerationIfAbsent({
      ...input,
      timeoutMs: 120_000,
    }),
  getBucketName: getGcsBucketName,
  signGlb: signGsUriV4ReadUrl,
  now: () => new Date(),
};

let dependencies = productionDependencies;
const inflight = new Set<string>();
const importedGlbInflight = new Map<string, Promise<Manhua3dTaskView>>();
const MAX_CONCURRENT_IMPORTED_GLB_INSPECTIONS = 2;
let activeImportedGlbInspections = 0;
let workerTimer: NodeJS.Timeout | null = null;

const RECORD_MIRROR_PREFIX = "manhua-3d/task-records/";
function gcsCredentialsPresent(): boolean {
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}
function recordMirrorObjectName(taskId: string): string {
  return `${RECORD_MIRROR_PREFIX}${String(taskId || "").replace(/[^a-zA-Z0-9_.-]+/g, "_")}.json`;
}

function taskDir(): string {
  return (
    String(process.env.MANHUA_3D_TASK_DIR || PRIMARY_TASK_DIR).trim() ||
    PRIMARY_TASK_DIR
  );
}

function isoNow(): string {
  return dependencies.now().toISOString();
}

function safePart(value: string): string {
  return (
    String(value || "asset")
      .trim()
      .replace(/[^a-zA-Z0-9_.-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .slice(0, 80) || "asset"
  );
}

function idempotencyDigest(input: {
  userId: number;
  assetRef: string;
  sourceVersion: string;
  options: Manhua3dTaskOptions;
  multiviewVersion?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.userId,
        input.assetRef,
        input.sourceVersion,
        input.options,
        // 多视角与单图是不同的任务；不同视角集合也是不同任务
        ...(input.multiviewVersion ? ["multiview", input.multiviewVersion] : []),
      ])
    )
    .digest("hex");
}

function recordPath(taskId: string): string {
  const safeTaskId = String(taskId || "").replace(/[^a-zA-Z0-9_.-]+/g, "_");
  return path.join(taskDir(), `${safeTaskId}.json`);
}

async function ensureTaskStore(): Promise<void> {
  try {
    await fs.mkdir(taskDir(), { recursive: true });
  } catch (error) {
    console.error("[manhua3dTask] persistent task store unavailable", error);
    throw new Error("manhua3d_task_store_unavailable");
  }
}

async function writeRecord(record: Manhua3dTaskRecord): Promise<void> {
  await ensureTaskStore();
  record.updatedAt = isoNow();
  const target = recordPath(record.taskId);
  const temporary = `${target}.tmp.${process.pid}.${randomUUID()}`;
  const body = JSON.stringify(record, null, 2);
  await fs.writeFile(temporary, body);
  await fs.rename(temporary, target);
  // 0917：同步镜像到 GCS，让没有 /data 卷的 rig 机也读得到；镜像失败只警告，本地仍是真源
  try {
    await dependencies.mirrorRecord(recordMirrorObjectName(record.taskId), Buffer.from(body, "utf8"));
  } catch (error) {
    console.warn("[manhua3dTask] record mirror to GCS failed", record.taskId, error instanceof Error ? error.message : String(error));
  }
}

async function createRecordExclusive(
  record: Manhua3dTaskRecord
): Promise<boolean> {
  await ensureTaskStore();
  try {
    await fs.writeFile(
      recordPath(record.taskId),
      JSON.stringify(record, null, 2),
      { flag: "wx" }
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
    throw error;
  }
}

async function readRecord(taskId: string): Promise<Manhua3dTaskRecord | null> {
  await ensureTaskStore();
  try {
    return JSON.parse(
      await fs.readFile(recordPath(taskId), "utf8")
    ) as Manhua3dTaskRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  // 本地没有（rig 机无卷、或换机）→ 读 GCS 镜像，读到就落一份本地缓存
  const mirrored = await dependencies.readMirroredRecord(recordMirrorObjectName(taskId));
  if (!mirrored) return null;
  const record = JSON.parse(mirrored.toString("utf8")) as Manhua3dTaskRecord;
  try {
    const target = recordPath(taskId);
    const temporary = `${target}.tmp.${process.pid}.${randomUUID()}`;
    await fs.writeFile(temporary, mirrored);
    await fs.rename(temporary, target);
  } catch {
    // 本地缓存失败不影响本次读取
  }
  return record;
}

/** app 启动时把本机已有回执补镜像到 GCS（幂等：只补缺的），让 rig 机读得到历史模型。 */
export async function mirrorManhua3dRecordsOnStartup(): Promise<{ mirrored: number; skipped: number }> {
  await ensureTaskStore();
  const names = await fs.readdir(taskDir()).catch(() => [] as string[]);
  let mirrored = 0, skipped = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const taskId = name.slice(0, -5);
    const objectName = recordMirrorObjectName(taskId);
    try {
      if (await dependencies.readMirroredRecord(objectName)) { skipped += 1; continue; }
      await dependencies.mirrorRecord(objectName, await fs.readFile(path.join(taskDir(), name)));
      mirrored += 1;
    } catch (error) {
      console.warn("[manhua3dTask] startup mirror failed", taskId, error instanceof Error ? error.message : String(error));
    }
  }
  return { mirrored, skipped };
}

async function listActiveTaskIds(): Promise<string[]> {
  await ensureTaskStore();
  const names = await fs.readdir(taskDir()).catch(() => [] as string[]);
  const active: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const taskId = name.slice(0, -5);
    const task = await readRecord(taskId).catch(() => null);
    if (task && (task.status === "queued" || task.status === "running"))
      active.push(taskId);
  }
  return active;
}

function normalizeOptions(
  input: Partial<Manhua3dTaskOptions>
): Manhua3dTaskOptions {
  const texture = input.texture !== false;
  return {
    texture,
    pbr: texture && input.pbr !== false,
    textureQuality: input.textureQuality || "standard",
    geometryQuality: input.geometryQuality || "standard",
    textureAlignment: input.textureAlignment || "original_image",
    orientation: input.orientation || "align_image",
    autoSize: input.autoSize === true,
    quad: input.quad === true,
  };
}

export function assertGlbBuffer(buffer: Buffer): void {
  assertValidGlb2(buffer);
}

export async function downloadGlb(
  url: string,
  maxBytes = MAX_GLB_BYTES
): Promise<Buffer> {
  if (!/^https:\/\//i.test(String(url || "")))
    throw new Error("invalid_glb_source_url");
  const signal = AbortSignal.timeout(120_000);
  const byteLimit = Math.max(
    1,
    Math.min(
      MAX_GLB_BYTES,
      Math.floor(Number(maxBytes) || MAX_GLB_BYTES)
    )
  );
  const response = await fetch(url, { signal });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`glb_download_http_${response.status}`);
  }
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > byteLimit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("glb_too_large");
  }
  if (!response.body) throw new Error("glb_download_empty");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  const validator = new Glb2StreamValidator();
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      byteLength += chunk.byteLength;
      if (byteLength > byteLimit) throw new Error("glb_too_large");
      validator.push(chunk);
      chunks.push(chunk);
    }
    validator.finish();
    completed = true;
    return Buffer.concat(chunks, byteLength);
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function glbObjectName(task: Manhua3dTaskRecord): string {
  const versionDigest = createHash("sha256")
    .update(task.sourceVersion)
    .digest("hex")
    .slice(0, 16);
  return `manhua-3d/u${task.userId}/${safePart(task.assetRef)}/${versionDigest}/model.glb`;
}

function importedGlbObjectName(input: {
  userId: number;
  assetRef: string;
  sha256: string;
}): string {
  return `manhua-3d/u${input.userId}/imports/${safePart(input.assetRef)}/${input.sha256}/model.glb`;
}

/** 提交前把视角图重签成新鲜读链（有 gs:// 才重签；没有就用记录里的 https） */
async function resolveMultiviewImageUrls(record: Manhua3dTaskRecord): Promise<string[]> {
  const urls = record.multiviewImageUrls || [];
  const gcs = record.multiviewImageGcsUris || [];
  const out: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const gs = gcs[i];
    if (gs && /^gs:\/\//i.test(gs)) {
      out.push(await dependencies.signGlb(gs, 2 * 60 * 60));
    } else {
      out.push(urls[i]!);
    }
  }
  return out;
}

function toView(record: Manhua3dTaskRecord): Manhua3dTaskView {
  const {
    taskId,
    assetRef,
    sourceVersion,
    sourceImageUrl,
    multiviewImageUrls,
    multiviewImageGcsUris,
    multiviewVersion,
    status,
    predictionId,
    glbGcsUri,
    glbUrl,
    glbUrlExpiresAt,
    glbBytes,
    glbSha256,
    errorZh,
    createdAt,
    updatedAt,
    finishedAt,
  } = record;
  return {
    taskId,
    assetRef,
    sourceVersion,
    sourceImageUrl,
    ...(multiviewImageUrls?.length
      ? {
          multiviewImageCount: multiviewImageUrls.length,
          multiviewVersion,
          ...(multiviewImageGcsUris?.length ? { multiviewImageGcsUris: [...multiviewImageGcsUris] } : {}),
        }
      : {}),
    status,
    predictionId,
    glbGcsUri,
    glbUrl,
    glbUrlExpiresAt,
    glbBytes,
    glbSha256,
    errorZh,
    createdAt,
    updatedAt,
    finishedAt,
  };
}

async function refreshSignedUrl(
  record: Manhua3dTaskRecord
): Promise<Manhua3dTaskRecord> {
  if (!record.glbGcsUri) return record;
  const expiresMs = Date.parse(record.glbUrlExpiresAt || "");
  if (
    record.glbUrl &&
    Number.isFinite(expiresMs) &&
    expiresMs - dependencies.now().getTime() > 60_000
  ) {
    return record;
  }
  record.glbUrl = undefined;
  record.glbUrlExpiresAt = undefined;
  try {
    record.glbUrl = dependencies.signGlb(
      record.glbGcsUri,
      SIGNED_URL_TTL_SECONDS
    );
    record.glbUrlExpiresAt = new Date(
      dependencies.now().getTime() + SIGNED_URL_TTL_SECONDS * 1_000
    ).toISOString();
    record.lastTransientError = undefined;
    await writeRecord(record);
  } catch (error) {
    record.lastTransientError =
      `sign_failed:${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        280
      );
    await writeRecord(record);
  }
  return record;
}

async function markReconcile(
  record: Manhua3dTaskRecord,
  errorZh: string,
  internal?: unknown
) {
  record.status = "reconcile_manual";
  record.errorZh = errorZh;
  record.lastTransientError =
    internal == null
      ? undefined
      : String(internal instanceof Error ? internal.message : internal).slice(
          0,
          280
        );
  record.finishedAt = isoNow();
  await writeRecord(record);
  return record;
}

async function markFailed(
  record: Manhua3dTaskRecord,
  errorZh: string,
  internal?: unknown
) {
  record.status = "failed";
  record.errorZh = errorZh;
  record.lastTransientError =
    internal == null
      ? undefined
      : String(internal instanceof Error ? internal.message : internal).slice(
          0,
          280
        );
  record.finishedAt = isoNow();
  await writeRecord(record);
  return record;
}

export async function advanceManhua3dTask(
  taskId: string
): Promise<Manhua3dTaskRecord | null> {
  if (inflight.has(taskId)) return readRecord(taskId);
  inflight.add(taskId);
  try {
    const record = await readRecord(taskId);
    if (!record) return null;
    if (["succeeded", "failed", "reconcile_manual"].includes(record.status)) {
      return refreshSignedUrl(record);
    }

    if (!record.predictionId) {
      // 1469 R2：视角图重签是**本地**动作，放在预落 reconcile_manual 之前——签名失败没有任何出站，
      // 必须是可重试的 failed，而不是「提交结果不确定」的人工对账（那会把任务卡死、连 retry 都被禁）。
      let multiviewImages: string[] | null = null;
      if (record.multiviewImageUrls?.length) {
        try {
          multiviewImages = await resolveMultiviewImageUrls(record);
        } catch (error) {
          return markFailed(record, "视角图签名失败，未提交上游，可重试", error);
        }
      }
      // POST 前先落“待人工对账”。若进程恰在出站后、句柄落盘前退出，重启也绝不重复建单。
      record.status = "reconcile_manual";
      record.errorZh = "提交结果正在确认，为避免重复生成不会自动重试";
      record.startedAt = record.startedAt || isoNow();
      await writeRecord(record);
      try {
        const submitted = multiviewImages
          ? await dependencies.submitMultiview({
              images: multiviewImages,
              ...record.options,
            })
          : await dependencies.submit({
              image: record.sourceImageUrl,
              ...record.options,
            });
        record.predictionId = submitted.predictionId;
        record.status = "running";
        record.errorZh = undefined;
        record.lastTransientError = undefined;
        await writeRecord(record);
      } catch (error) {
        if (
          error instanceof SubmitRejectedError ||
          (error as { kind?: string } | null)?.kind === "rejected"
        ) {
          return markFailed(record, "三维资产任务未能创建", error);
        }
        if (
          error instanceof SubmitUnknownError ||
          (error as { kind?: string } | null)?.kind === "unknown"
        ) {
          return markReconcile(
            record,
            "提交结果无法确认，为避免重复生成已停止自动重试",
            error
          );
        }
        return markReconcile(
          record,
          "提交过程异常，为避免重复生成已停止自动重试",
          error
        );
      }
    }

    if (
      dependencies.now().getTime() - Date.parse(record.createdAt) >
      MAX_POLL_MS
    ) {
      return markReconcile(record, "三维资产任务长时间没有终态，已转人工对账");
    }

    const snapshot = await dependencies.poll(record.predictionId);
    if (snapshot.state === "reconcile") {
      return markReconcile(record, snapshot.error);
    }
    if (snapshot.state === "failed") {
      return markFailed(record, "三维资产生成失败", snapshot.error);
    }
    if (snapshot.state === "running") {
      record.status = "running";
      record.lastTransientError = snapshot.status.slice(0, 280);
      await writeRecord(record);
      return record;
    }

    record.sourceGlbUrl = snapshot.sourceGlbUrl;
    let buffer: Buffer;
    try {
      buffer = await dependencies.downloadGlb(snapshot.sourceGlbUrl);
      // 测试依赖也必须经过同一验真，禁止 mock 绕过 glTF magic。
      assertGlbBuffer(buffer);
    } catch (error) {
      if (
        /invalid_glb|glb_too_large/i.test(
          error instanceof Error ? error.message : String(error)
        )
      ) {
        return markFailed(record, "生成结果不是有效的 GLB 模型", error);
      }
      record.lastTransientError =
        `mirror_download_failed:${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          280
        );
      await writeRecord(record);
      return record;
    }

    try {
      const uploaded = await dependencies.uploadGlb({
        objectName: glbObjectName(record),
        buffer,
        contentType: "model/gltf-binary",
      });
      record.glbGcsUri = uploaded.gcsUri;
      record.glbBytes = buffer.byteLength;
      record.glbSha256 = createHash("sha256").update(buffer).digest("hex");
      record.status = "succeeded";
      record.errorZh = undefined;
      record.finishedAt = isoNow();
      await writeRecord(record);
      return refreshSignedUrl(record);
    } catch (error) {
      record.lastTransientError =
        `mirror_upload_failed:${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          280
        );
      await writeRecord(record);
      return record;
    }
  } finally {
    inflight.delete(taskId);
  }
}

export async function createManhua3dTask(input: {
  userId: number;
  assetRef: string;
  sourceVersion: string;
  sourceImageUrl: string;
  options?: Partial<Manhua3dTaskOptions>;
  /** 0916 多视角：2–4 张 https，顺序 前/左/后/右；给了就走 multiview-to-3d */
  multiviewImageUrls?: string[];
  multiviewImageGcsUris?: string[];
  multiviewVersion?: string;
}): Promise<Manhua3dTaskView> {
  const assetRef = String(input.assetRef || "").trim();
  const sourceVersion = String(input.sourceVersion || "").trim();
  const sourceImageUrl = String(input.sourceImageUrl || "").trim();
  if (!Number.isInteger(input.userId) || input.userId <= 0)
    throw new Error("invalid_user_id");
  if (!assetRef || !sourceVersion || !/^https:\/\//i.test(sourceImageUrl)) {
    throw new Error("invalid_manhua_3d_task_input");
  }
  const multiviewImageUrls = (input.multiviewImageUrls || []).map(u => String(u || "").trim());
  const multiviewImageGcsUris = (input.multiviewImageGcsUris || []).map(u => String(u || "").trim());
  const multiviewVersion = String(input.multiviewVersion || "").trim();
  if (multiviewImageUrls.length) {
    if (
      multiviewImageUrls.length < 2 ||
      multiviewImageUrls.length > 4 ||
      multiviewImageUrls.some(u => !/^https:\/\//i.test(u)) ||
      (multiviewImageGcsUris.length && multiviewImageGcsUris.length !== multiviewImageUrls.length) ||
      !multiviewVersion
    ) {
      // 视角集合没有稳定版本就没法幂等：不猜，直接拒
      throw new Error("invalid_manhua_3d_multiview_input");
    }
  }
  if (!dependencies.isConfigured()) {
    // 缺凭证时上游明确没有出站可能，必须在建任务前失败；不能伪装成“结果未知”。
    throw new Error("manhua3d_service_unavailable");
  }

  const options = normalizeOptions(input.options || {});
  const digest = idempotencyDigest({
    userId: input.userId,
    assetRef,
    sourceVersion,
    options,
    ...(multiviewImageUrls.length ? { multiviewVersion } : {}),
  });
  const taskId = `m3d_${digest.slice(0, 24)}`;
  const now = isoNow();
  const record: Manhua3dTaskRecord = {
    taskId,
    userId: input.userId,
    assetRef,
    sourceVersion,
    sourceImageUrl,
    ...(multiviewImageUrls.length
      ? {
          multiviewImageUrls,
          ...(multiviewImageGcsUris.length ? { multiviewImageGcsUris } : {}),
          multiviewVersion,
        }
      : {}),
    status: "queued",
    options,
    createdAt: now,
    updatedAt: now,
  };
  const created = await createRecordExclusive(record);
  if (!created) {
    const existing = await readRecord(taskId);
    if (!existing) throw new Error("manhua3d_idempotency_record_missing");
    // sourceImageUrl 常为同一 GCS 对象的短期签名地址，刷新后字符串会变化；
    // 幂等真源是 sourceVersion，不能因签名 URL 轮换而重复建单或误报冲突。
    return toView(await refreshSignedUrl(existing));
  }

  const advanced = (await advanceManhua3dTask(taskId)) || record;
  ensureManhua3dWorker();
  return toView(advanced);
}

/**
 * 把用户已经拥有的 GLB 绑定到当前人物图版本。
 * 文件先走用户隔离的 GCS 直传，再由服务端重新读取并验真；此路径不调用建模上游。
 */
export async function importExistingManhua3dAsset(input: {
  userId: number;
  assetRef: string;
  sourceVersion: string;
  sourceImageUrl: string;
  glbGcsUri: string;
}): Promise<Manhua3dTaskView> {
  const assetRef = String(input.assetRef || "").trim();
  const sourceVersion = String(input.sourceVersion || "").trim();
  const sourceImageUrl = String(input.sourceImageUrl || "").trim();
  const glbGcsUri = String(input.glbGcsUri || "").trim();
  if (!Number.isInteger(input.userId) || input.userId <= 0)
    throw new Error("invalid_user_id");
  if (!assetRef || !sourceVersion || !/^https:\/\//i.test(sourceImageUrl)) {
    throw new Error("invalid_manhua_3d_task_input");
  }
  const ownedPrefix = `gs://${dependencies.getBucketName()}/uploads/u${input.userId}/`;
  if (!glbGcsUri.startsWith(ownedPrefix)) {
    throw new Error("manhua3d_glb_forbidden");
  }

  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "existing-glb",
        input.userId,
        assetRef,
        sourceVersion,
        glbGcsUri,
      ])
    )
    .digest("hex");
  const taskId = `m3d_import_${digest.slice(0, 20)}`;
  const persisted = await readRecord(taskId);
  if (persisted) {
    if (persisted.userId !== input.userId || persisted.status !== "succeeded") {
      throw new Error("manhua3d_idempotency_record_missing");
    }
    return toView(await refreshSignedUrl(persisted));
  }
  const inProgress = importedGlbInflight.get(taskId);
  if (inProgress) return inProgress;
  if (activeImportedGlbInspections >= MAX_CONCURRENT_IMPORTED_GLB_INSPECTIONS) {
    throw new Error("manhua3d_glb_import_busy");
  }

  const operation = (async () => {
    activeImportedGlbInspections += 1;
    try {
      let inspection: Awaited<
        ReturnType<Manhua3dTaskDependencies["inspectUploadedGlb"]>
      >;
      try {
        inspection = await dependencies.inspectUploadedGlb(glbGcsUri);
      } catch (error) {
        if (
          (error instanceof Error ? error.message : String(error)) ===
          "gcs_download_too_large"
        ) {
          throw new Error("glb_too_large");
        }
        throw error;
      }
      if (inspection.byteLength > MAX_GLB_BYTES)
        throw new Error("glb_too_large");
      if (!/^\d+$/.test(inspection.generation)) {
        throw new Error("invalid_gcs_generation");
      }
      const immutable = await dependencies.rewriteUploadedGlb({
        sourceGcsUri: glbGcsUri,
        sourceGeneration: inspection.generation,
        destinationObjectName: importedGlbObjectName({
          userId: input.userId,
          assetRef,
          sha256: inspection.sha256,
        }),
      });

      const now = isoNow();
      const record: Manhua3dTaskRecord = {
        taskId,
        userId: input.userId,
        assetRef,
        sourceVersion,
        sourceImageUrl,
        status: "succeeded",
        options: normalizeOptions({}),
        sourceGlbUrl: glbGcsUri,
        glbGcsUri: immutable.gcsUri,
        glbBytes: inspection.byteLength,
        glbSha256: inspection.sha256,
        createdAt: now,
        updatedAt: now,
        finishedAt: now,
      };
      const created = await createRecordExclusive(record);
      const stored = created ? record : await readRecord(taskId);
      if (
        !stored ||
        stored.userId !== input.userId ||
        stored.status !== "succeeded"
      ) {
        throw new Error("manhua3d_idempotency_record_missing");
      }
      return toView(await refreshSignedUrl(stored));
    } finally {
      activeImportedGlbInspections -= 1;
    }
  })();
  importedGlbInflight.set(taskId, operation);
  try {
    return await operation;
  } finally {
    if (importedGlbInflight.get(taskId) === operation) {
      importedGlbInflight.delete(taskId);
    }
  }
}

/**
 * 只允许对“明确失败”的任务重试。新任务 id 由上一次 taskId 派生：
 * 同一次重试请求保持幂等，而连续失败后仍可从最新 taskId 发起下一次重试。
 * reconcile_manual 代表上游是否建单未知，绝不能据此再提交。
 */
export async function retryManhua3dTask(
  taskId: string,
  userId: number
): Promise<Manhua3dTaskView | null> {
  const previous = await readRecord(String(taskId || "").trim());
  if (!previous || previous.userId !== userId) return null;
  if (previous.status === "reconcile_manual") {
    throw new Error("manhua3d_retry_reconcile_forbidden");
  }
  if (previous.status !== "failed") {
    throw new Error("manhua3d_retry_not_failed");
  }
  if (!dependencies.isConfigured()) {
    throw new Error("manhua3d_service_unavailable");
  }

  const retryDigest = createHash("sha256")
    .update(JSON.stringify(["retry", previous.taskId]))
    .digest("hex");
  const nextTaskId = `m3d_${retryDigest.slice(0, 24)}`;
  const now = isoNow();
  const next: Manhua3dTaskRecord = {
    taskId: nextTaskId,
    userId,
    assetRef: previous.assetRef,
    sourceVersion: previous.sourceVersion,
    sourceImageUrl: previous.sourceImageUrl,
    // 1469 R1：多视角任务重试必须仍是多视角（原先只抄单图字段 → 重试静默退回单图生成）
    ...(previous.multiviewImageUrls?.length
      ? {
          multiviewImageUrls: [...previous.multiviewImageUrls],
          ...(previous.multiviewImageGcsUris?.length ? { multiviewImageGcsUris: [...previous.multiviewImageGcsUris] } : {}),
          ...(previous.multiviewVersion ? { multiviewVersion: previous.multiviewVersion } : {}),
        }
      : {}),
    status: "queued",
    options: previous.options,
    createdAt: now,
    updatedAt: now,
  };
  const created = await createRecordExclusive(next);
  if (!created) {
    const existing = await readRecord(nextTaskId);
    if (!existing) throw new Error("manhua3d_idempotency_record_missing");
    return toView(await refreshSignedUrl(existing));
  }

  const advanced = (await advanceManhua3dTask(nextTaskId)) || next;
  ensureManhua3dWorker();
  return toView(advanced);
}

export async function getManhua3dTask(
  taskId: string,
  userId: number
): Promise<Manhua3dTaskView | null> {
  const record = await readRecord(String(taskId || "").trim());
  if (!record || record.userId !== userId) return null;
  const advanced =
    record.status === "queued" || record.status === "running"
      ? await advanceManhua3dTask(record.taskId)
      : await refreshSignedUrl(record);
  ensureManhua3dWorker();
  return advanced ? toView(advanced) : null;
}

/** 白模只读消费已成功的本人模型；不推进任务、不签URL、不启动轮询或新生成。 */
export async function getCompletedManhua3dSource(taskId: string, userId: number, assetRef: string) {
  if (!/^m3d_[a-zA-Z0-9_.-]{1,150}$/.test(taskId) || !Number.isSafeInteger(userId) || userId <= 0)
    throw new Error("角色模型身份无效");
  const record = await readRecord(taskId);
  if (!record || record.taskId !== taskId || record.userId !== userId ||
      record.assetRef !== assetRef || record.status !== "succeeded" ||
      !record.glbGcsUri?.startsWith(`gs://${dependencies.getBucketName()}/`) ||
      !record.glbSha256 || !/^[a-f0-9]{64}$/.test(record.glbSha256) ||
      !Number.isSafeInteger(record.glbBytes) || record.glbBytes! < 20)
    throw new Error("本人已完成角色模型或完整来源回执不存在");
  return { taskId, assetRef, gcsUri:record.glbGcsUri, sha256:record.glbSha256, bytes:record.glbBytes! };
}

export function ensureManhua3dWorker(): void {
  if (workerTimer || process.env.NODE_ENV === "test") return;
  workerTimer = setInterval(() => {
    void listActiveTaskIds()
      .then(async ids => {
        for (const taskId of ids) {
          await advanceManhua3dTask(taskId).catch(error => {
            console.warn("[manhua3dTask] worker tick failed", taskId, error);
          });
        }
      })
      .catch(error => console.warn("[manhua3dTask] worker scan failed", error));
  }, POLL_INTERVAL_MS);
  workerTimer.unref?.();
}

export async function resumeManhua3dTasksOnStartup(): Promise<void> {
  ensureManhua3dWorker();
  const ids = await listActiveTaskIds();
  for (const taskId of ids) {
    await advanceManhua3dTask(taskId).catch(error => {
      console.warn("[manhua3dTask] startup resume failed", taskId, error);
    });
  }
}

/** 仅供 Vitest 注入虚构依赖；生产代码不得调用。 */
export function setManhua3dTaskDependenciesForTests(
  overrides: Partial<Manhua3dTaskDependencies>
): void {
  if (process.env.NODE_ENV !== "test")
    throw new Error("test_dependencies_only");
  dependencies = { ...productionDependencies, ...overrides };
}

export function resetManhua3dTaskDependenciesForTests(): void {
  if (process.env.NODE_ENV !== "test")
    throw new Error("test_dependencies_only");
  dependencies = productionDependencies;
  inflight.clear();
  importedGlbInflight.clear();
  activeImportedGlbInspections = 0;
}
