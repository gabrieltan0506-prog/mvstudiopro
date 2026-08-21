/**
 * 后期工坊素材登记约束(授权铁律:客户端可写数据不作授权依据)。
 *
 * 只放行四类素材,其余一律"素材尚未登记"拒绝、不创建任务:
 * 1. gs://<系统桶>/post-prod/<userId>/…       —— 后期任务自己的产物;
 * 2. gs://<系统桶>/uploads/u<userId>/…        —— 本人上传(对象名由服务端按用户前缀
 *    +UUID 生成,客户端不可指定,见 getVideoUploadSignedUrl 收紧口径);
 * 3. gs://<系统桶>/generated/…(登记簿验主)    —— 画布出图权威登记簿;
 * 4. gs://<系统桶>/<其他对象>                 —— 必须出现在该用户 succeeded 任务
 *    output 的**明确产物字段**里(逐字段收集→解析成完整对象名→全等比较;
 *    prompt/outputText 等普通文本字段不计入)。
 * HTTPS 只接受系统生成地址:站内 /api/canvas-media/ 稳定链、或系统桶的
 * storage.googleapis.com 链;核对通过后统一写回规范化 gs:// 地址,
 * 不把 24 小时签名链写入 jobs.input(下载时由服务层现签)。
 */
import { and, eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  CANVAS_MEDIA_OBJECT_RE,
  verifyCanvasMediaOwnership,
} from "./canvasMediaOwnership.js";
import { getGcsBucketName } from "./gcs.js";
import type { PostProdJobInput } from "../jobs/postProdInput";

export function sanitizePostProdUserId(userId: string): string {
  return String(userId).replace(/[^0-9a-zA-Z_-]/g, "");
}

export function postProdOutputPrefix(userId: string): string {
  return `post-prod/${sanitizePostProdUserId(userId)}/`;
}

/** 本人上传前缀(与 getVideoUploadSignedUrl 服务端生成的对象名同构) */
export function userUploadsPrefix(userId: string): string {
  return `uploads/u${sanitizePostProdUserId(userId)}/`;
}

export function parseGsUri(uri: string): { bucket: string; objectName: string } | null {
  const m = String(uri || "").match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const objectName = m[2];
  if (!objectName || objectName.includes("..")) return null;
  return { bucket: m[1], objectName };
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** 对象名规整:去前导斜杠;拒绝空段/./..\\ 等越界形状 */
export function normalizePostProdObjectName(value: string): string | null {
  const objectName = value.replace(/^\/+/, "");
  if (
    !objectName ||
    objectName.includes("\\") ||
    objectName.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }
  return objectName;
}

/** jobs.output 里被认作"产物"的明确字段;普通文本字段(prompt/message/outputText 等)不计入 */
const MEDIA_SCALAR_FIELDS = [
  "gcsUri",
  "url",
  "videoUrl",
  "audioUrl",
  "imageUrl",
  "outputUrl",
  "downloadUrl",
  "streamUrl",
  "finalVideoUrl",
] as const;

const MEDIA_ARRAY_FIELDS = [
  "urls",
  "videoUrls",
  "audioUrls",
  "imageUrls",
  "outputUrls",
] as const;

function parseRecord(value: unknown): Record<string, unknown> | null {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

export function collectDeclaredMediaSources(output: unknown): string[] {
  const record = parseRecord(output);
  if (!record) return [];

  const values: string[] = [];
  for (const field of MEDIA_SCALAR_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) values.push(value.trim());
  }
  for (const field of MEDIA_ARRAY_FIELDS) {
    const value = record[field];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim()) values.push(item.trim());
    }
  }
  return Array.from(new Set(values));
}

/** 把产物地址解析成系统桶内完整对象名;非系统桶/非系统形态返回 null */
export function extractSystemObjectName(source: string, bucket: string): string | null {
  const gs = parseGsUri(source);
  if (gs) {
    return gs.bucket === bucket ? normalizePostProdObjectName(gs.objectName) : null;
  }

  const CANVAS_MEDIA_PREFIX = "/api/canvas-media/";
  try {
    const url = new URL(source);
    if (url.hostname === "storage.googleapis.com") {
      const parts = url.pathname.split("/").filter(Boolean).map(safeDecode);
      const urlBucket = parts.shift();
      if (urlBucket !== bucket || parts.length === 0) return null;
      return normalizePostProdObjectName(parts.join("/"));
    }
    if (url.pathname.startsWith(CANVAS_MEDIA_PREFIX)) {
      return normalizePostProdObjectName(safeDecode(url.pathname.slice(CANVAS_MEDIA_PREFIX.length)));
    }
  } catch {
    if (source.startsWith(CANVAS_MEDIA_PREFIX)) {
      return normalizePostProdObjectName(
        safeDecode(source.slice(CANVAS_MEDIA_PREFIX.length).split("?")[0]),
      );
    }
  }
  return null;
}

/** 一次性读取该用户全部 succeeded 任务的产物对象名集合(每次请求只读一次) */
export async function loadSucceededJobOutputObjects(
  userId: string,
  bucket: string,
): Promise<ReadonlySet<string>> {
  const db = await getDb();
  if (!db) throw new Error("数据库暂时不可用,请稍后再试");

  const rows = await db
    .select({ output: jobs.output })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "succeeded")));

  const objects = new Set<string>();
  for (const row of rows) {
    for (const source of collectDeclaredMediaSources(row.output)) {
      const objectName = extractSystemObjectName(source, bucket);
      if (objectName) objects.add(objectName);
    }
  }
  return objects;
}

export type PostProdMediaDeps = {
  getBucket: () => string;
  verifyOwnership: (userId: number, objectPath: string) => Promise<boolean>;
  loadSucceededJobOutputObjects: (userId: string, bucket: string) => Promise<ReadonlySet<string>>;
};

const realDeps: PostProdMediaDeps = {
  getBucket: () => getGcsBucketName(),
  verifyOwnership: (uid, p) => verifyCanvasMediaOwnership(uid, p),
  loadSucceededJobOutputObjects: (uid, bucket) => loadSucceededJobOutputObjects(uid, bucket),
};

const UNREGISTERED_HINT = "素材尚未登记,请从画布/成片里重新选择站内素材";

export type PostProdMediaContext = { jobObjects: ReadonlySet<string> };

async function assertObjectAllowed(
  userId: string,
  objectName: string,
  deps: PostProdMediaDeps,
  context: PostProdMediaContext,
): Promise<void> {
  if (objectName.startsWith(postProdOutputPrefix(userId))) return;
  if (objectName.startsWith(userUploadsPrefix(userId))) return;
  const uidNum = Number(userId);
  if (
    CANVAS_MEDIA_OBJECT_RE.test(objectName) &&
    Number.isFinite(uidNum) &&
    (await deps.verifyOwnership(uidNum, objectName))
  ) {
    return;
  }
  // 完整对象名全等比较,不做子串匹配(abc.mp4 不许命中 abc.mp4.backup)
  if (context.jobObjects.has(objectName)) return;
  throw new Error(UNREGISTERED_HINT);
}

export async function resolveRegisteredPostProdMediaSource(
  input: { userId: string; source: string },
  deps: PostProdMediaDeps = realDeps,
  context?: PostProdMediaContext,
): Promise<string> {
  const source = String(input.source || "").trim();
  const userId = String(input.userId);
  const bucket = deps.getBucket();
  const ctx: PostProdMediaContext =
    context ?? { jobObjects: await deps.loadSucceededJobOutputObjects(userId, bucket) };

  if (source.startsWith("gs://")) {
    const parsed = parseGsUri(source);
    if (!parsed) throw new Error("素材地址格式不正确");
    if (parsed.bucket !== bucket) throw new Error("素材地址不在当前存储范围内");
    const objectName = normalizePostProdObjectName(parsed.objectName);
    if (!objectName) throw new Error("素材地址格式不正确");
    await assertObjectAllowed(userId, objectName, deps, ctx);
    return `gs://${bucket}/${objectName}`;
  }

  // 站内受保护稳定链:/api/canvas-media/<objectPath>(可带主机名)
  const inSite = source.match(/^(?:https?:\/\/[^/]+)?\/api\/canvas-media\/(.+)$/i);
  if (inSite) {
    const objectName = normalizePostProdObjectName(safeDecode(inSite[1].split("?")[0]));
    if (!objectName) throw new Error("素材地址格式不正确");
    await assertObjectAllowed(userId, objectName, deps, ctx);
    // 任务里保存规范化 gs://,不落有效期地址
    return `gs://${bucket}/${objectName}`;
  }

  // 系统桶链接:https://storage.googleapis.com/<bucket>/<object>?…
  const gcsHttp = source.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/([^?]+)(?:\?.*)?$/i);
  if (gcsHttp) {
    if (gcsHttp[1] !== bucket) throw new Error("素材地址不在当前存储范围内");
    const objectName = normalizePostProdObjectName(safeDecode(gcsHttp[2]));
    if (!objectName) throw new Error("素材地址格式不正确");
    await assertObjectAllowed(userId, objectName, deps, ctx);
    return `gs://${bucket}/${objectName}`;
  }

  throw new Error(UNREGISTERED_HINT);
}

/** 三种 action 的素材字段走同一个解析函数;每次请求只读取一次 jobs 记录 */
export async function resolvePostProdInputSources(
  input: { userId: string; input: PostProdJobInput },
  deps: PostProdMediaDeps = realDeps,
): Promise<PostProdJobInput> {
  const userId = String(input.userId);
  const bucket = deps.getBucket();
  const context: PostProdMediaContext = {
    jobObjects: await deps.loadSucceededJobOutputObjects(userId, bucket),
  };
  const resolve = (source: string) =>
    resolveRegisteredPostProdMediaSource({ userId, source }, deps, context);

  const job = input.input;
  if (job.action === "concat") {
    return {
      ...job,
      params: { ...job.params, clips: await Promise.all(job.params.clips.map(resolve)) },
    };
  }
  if (job.action === "bgm_mount") {
    return {
      ...job,
      params: {
        ...job.params,
        videoUri: await resolve(job.params.videoUri),
        bgmUri: await resolve(job.params.bgmUri),
      },
    };
  }
  return {
    ...job,
    params: { ...job.params, videoUri: await resolve(job.params.videoUri) },
  };
}
