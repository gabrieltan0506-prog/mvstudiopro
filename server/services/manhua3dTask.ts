import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  SubmitRejectedError,
  SubmitUnknownError,
} from "./submitOutcomeErrors.js";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import {
  pollWavespeedTripo3dOnce,
  isWavespeedTripo3dConfigured,
  submitWavespeedTripo3d,
  type TripoH31Orientation,
  type TripoH31Quality,
  type TripoH31TextureAlignment,
  type WavespeedTripo3dInput,
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
>;

type Manhua3dTaskDependencies = {
  isConfigured: () => boolean;
  submit: (input: WavespeedTripo3dInput) => Promise<{ predictionId: string }>;
  poll: (predictionId: string) => Promise<WavespeedTripo3dPollSnapshot>;
  downloadGlb: (url: string) => Promise<Buffer>;
  uploadGlb: typeof uploadBufferToGcs;
  signGlb: typeof signGsUriV4ReadUrl;
  now: () => Date;
};

const productionDependencies: Manhua3dTaskDependencies = {
  isConfigured: isWavespeedTripo3dConfigured,
  submit: submitWavespeedTripo3d,
  poll: pollWavespeedTripo3dOnce,
  downloadGlb: downloadGlb,
  uploadGlb: uploadBufferToGcs,
  signGlb: signGsUriV4ReadUrl,
  now: () => new Date(),
};

let dependencies = productionDependencies;
const inflight = new Set<string>();
let workerTimer: NodeJS.Timeout | null = null;

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
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.userId,
        input.assetRef,
        input.sourceVersion,
        input.options,
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
  await fs.writeFile(temporary, JSON.stringify(record, null, 2));
  await fs.rename(temporary, target);
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
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
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
  if (
    buffer.byteLength < 12 ||
    buffer.subarray(0, 4).toString("ascii") !== "glTF"
  ) {
    throw new Error("invalid_glb_magic");
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (version !== 2 || declaredLength !== buffer.byteLength) {
    throw new Error("invalid_glb_header");
  }
}

async function downloadGlb(url: string): Promise<Buffer> {
  if (!/^https:\/\//i.test(String(url || "")))
    throw new Error("invalid_glb_source_url");
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`glb_download_http_${response.status}`);
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_GLB_BYTES) {
    throw new Error("glb_too_large");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_GLB_BYTES) throw new Error("glb_too_large");
  assertGlbBuffer(buffer);
  return buffer;
}

function glbObjectName(task: Manhua3dTaskRecord): string {
  const versionDigest = createHash("sha256")
    .update(task.sourceVersion)
    .digest("hex")
    .slice(0, 16);
  return `manhua-3d/u${task.userId}/${safePart(task.assetRef)}/${versionDigest}/model.glb`;
}

function toView(record: Manhua3dTaskRecord): Manhua3dTaskView {
  const {
    taskId,
    assetRef,
    sourceVersion,
    sourceImageUrl,
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
      // POST 前先落“待人工对账”。若进程恰在出站后、句柄落盘前退出，重启也绝不重复建单。
      record.status = "reconcile_manual";
      record.errorZh = "提交结果正在确认，为避免重复生成不会自动重试";
      record.startedAt = record.startedAt || isoNow();
      await writeRecord(record);
      try {
        const submitted = await dependencies.submit({
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
}): Promise<Manhua3dTaskView> {
  const assetRef = String(input.assetRef || "").trim();
  const sourceVersion = String(input.sourceVersion || "").trim();
  const sourceImageUrl = String(input.sourceImageUrl || "").trim();
  if (!Number.isInteger(input.userId) || input.userId <= 0)
    throw new Error("invalid_user_id");
  if (!assetRef || !sourceVersion || !/^https:\/\//i.test(sourceImageUrl)) {
    throw new Error("invalid_manhua_3d_task_input");
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
  });
  const taskId = `m3d_${digest.slice(0, 24)}`;
  const now = isoNow();
  const record: Manhua3dTaskRecord = {
    taskId,
    userId: input.userId,
    assetRef,
    sourceVersion,
    sourceImageUrl,
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
}
