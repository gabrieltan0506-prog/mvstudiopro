/**
 * 后期工坊素材来源统一核对(授权铁律:客户端可写数据不作授权依据)。
 *
 * 只放行三类素材,其余一律"素材尚未登记"拒绝、不创建任务:
 * 1. gs://<系统桶>/post-prod/<userId>/…       —— 后期任务自己的产物;
 * 2. gs://<系统桶>/generated/…(登记簿验主)    —— 画布出图权威登记簿;
 * 3. gs://<系统桶>/<其他对象>                 —— 必须在该用户 succeeded 任务的
 *    output 里出现过(jobs 表服务端证据,与 backfill 同一证据源)。
 * HTTPS 只接受系统生成地址:站内 /api/canvas-media/ 稳定链、或系统桶的
 * storage.googleapis.com 签名链;二者都折回对象路径按上面三类验,验过重签短期读链。
 */
import { and, eq, like, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  CANVAS_MEDIA_OBJECT_RE,
  verifyCanvasMediaOwnership,
} from "./canvasMediaOwnership.js";
import { getGcsBucketName, signGcsObjectPathV4ReadUrl } from "./gcs.js";
import type { PostProdJobInput } from "../jobs/postProdInput";

export function sanitizePostProdUserId(userId: string): string {
  return String(userId).replace(/[^0-9a-zA-Z_-]/g, "");
}

export function postProdOutputPrefix(userId: string): string {
  return `post-prod/${sanitizePostProdUserId(userId)}/`;
}

export function parseGsUri(uri: string): { bucket: string; objectName: string } | null {
  const m = String(uri || "").match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const objectName = m[2];
  if (!objectName || objectName.includes("..")) return null;
  return { bucket: m[1], objectName };
}

/** 该对象是否出现在此用户任一 succeeded 任务的 output 里(服务端证据,不吃客户端草稿) */
export async function hasSucceededJobOutputEvidence(
  userId: string,
  objectName: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用,暂时无法核对素材,请稍后再试");
  // LIKE 通配符转义:对象名里 % _ 按字面匹配
  const escaped = objectName.replace(/([\\%_])/g, "\\$1");
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.status, "succeeded"),
        like(sql`${jobs.output}::text`, `%${escaped}%`),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export type PostProdMediaDeps = {
  getBucket: () => string;
  verifyOwnership: (userId: number, objectPath: string) => Promise<boolean>;
  hasJobOutputEvidence: (userId: string, objectName: string) => Promise<boolean>;
  signObjectUrl: (bucket: string, objectName: string, expiresSeconds: number) => string;
};

const realDeps: PostProdMediaDeps = {
  getBucket: () => getGcsBucketName(),
  verifyOwnership: (uid, p) => verifyCanvasMediaOwnership(uid, p),
  hasJobOutputEvidence: (uid, obj) => hasSucceededJobOutputEvidence(uid, obj),
  signObjectUrl: (bucket, objectName, expiresSeconds) =>
    signGcsObjectPathV4ReadUrl(bucket, objectName, expiresSeconds),
};

const UNREGISTERED_HINT = "素材尚未登记,请从画布/成片里重新选择站内素材";

async function assertObjectAllowed(
  userId: string,
  objectName: string,
  deps: PostProdMediaDeps,
): Promise<void> {
  if (objectName.startsWith(postProdOutputPrefix(userId))) return;
  const uidNum = Number(userId);
  if (
    CANVAS_MEDIA_OBJECT_RE.test(objectName) &&
    Number.isFinite(uidNum) &&
    (await deps.verifyOwnership(uidNum, objectName))
  ) {
    return;
  }
  if (await deps.hasJobOutputEvidence(userId, objectName)) return;
  throw new Error(UNREGISTERED_HINT);
}

export async function resolveRegisteredPostProdMediaSource(
  input: { userId: string; source: string },
  deps: PostProdMediaDeps = realDeps,
): Promise<string> {
  const source = String(input.source || "").trim();
  const userId = String(input.userId);
  const bucket = deps.getBucket();

  if (source.startsWith("gs://")) {
    const parsed = parseGsUri(source);
    if (!parsed) throw new Error("素材地址格式不正确");
    if (parsed.bucket !== bucket) throw new Error("素材地址不在当前存储范围内");
    await assertObjectAllowed(userId, parsed.objectName, deps);
    return source;
  }

  // 站内受保护稳定链:/api/canvas-media/<objectPath>(可带主机名)
  const inSite = source.match(/^(?:https?:\/\/[^/]+)?\/api\/canvas-media\/(.+)$/i);
  if (inSite) {
    const objectName = safeDecode(inSite[1].split("?")[0]);
    await assertObjectAllowed(userId, objectName, deps);
    return deps.signObjectUrl(bucket, objectName, 24 * 3600);
  }

  // 系统桶签名链:https://storage.googleapis.com/<bucket>/<object>?X-Goog-…
  const gcsHttp = source.match(
    /^https:\/\/storage\.googleapis\.com\/([^/]+)\/([^?]+)(?:\?.*)?$/i,
  );
  if (gcsHttp) {
    if (gcsHttp[1] !== bucket) throw new Error("素材地址不在当前存储范围内");
    const objectName = safeDecode(gcsHttp[2]);
    await assertObjectAllowed(userId, objectName, deps);
    // 旧签名可能已过期/临期,统一重签短期读链
    return deps.signObjectUrl(bucket, objectName, 24 * 3600);
  }

  throw new Error(UNREGISTERED_HINT);
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** 三种 action 的素材字段走同一个解析函数,返回同形状的规整输入 */
export async function resolvePostProdInputSources(
  input: { userId: string; input: PostProdJobInput },
  deps: PostProdMediaDeps = realDeps,
): Promise<PostProdJobInput> {
  const { userId } = input;
  const resolve = (source: string) =>
    resolveRegisteredPostProdMediaSource({ userId, source }, deps);
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
