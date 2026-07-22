/**
 * 漫剧云草稿正文存 GCS（方案 A），不再把整包 JSON 塞进 Neon。
 * 对象：manhua-cloud-drafts/user-{userId}.json
 */
import {
  createGcsSignedUploadUrl,
  downloadGcsObject,
  uploadBufferToGcs,
} from "./gcs.js";
import {
  isManhuaCloudDraftExpired,
  parseManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "../../shared/manhuaCloudDraft.js";

const PREFIX = "manhua-cloud-drafts";

function draftBucket(): string {
  return String(
    process.env.GCS_BUCKET_NAME ||
      process.env.GROWTH_CAMP_GCS_BUCKET ||
      process.env.VERTEX_GCS_BUCKET ||
      process.env.GOOGLE_CLOUD_STORAGE_BUCKET ||
      "mv-studio-pro-vertex-video-temp",
  ).trim();
}

export function manhuaCloudDraftObjectName(userId: number): string {
  const id = Math.max(1, Math.floor(Number(userId) || 0));
  return `${PREFIX}/user-${id}.json`;
}

export function manhuaCloudDraftGcsUri(userId: number): string {
  return `gs://${draftBucket()}/${manhuaCloudDraftObjectName(userId)}`;
}

type GcsDraftEnvelope = {
  format: "mv-manhua-cloud-draft-gcs-v1";
  userId: number;
  clientUpdatedAt: string;
  serverUpdatedAt: string;
  payload: ManhuaCloudDraftPayload;
};

function parseEnvelope(raw: string): GcsDraftEnvelope | null {
  try {
    const json = JSON.parse(raw) as Partial<GcsDraftEnvelope>;
    if (json?.format !== "mv-manhua-cloud-draft-gcs-v1") return null;
    if (!json.payload || typeof json.userId !== "number") return null;
    const payload = parseManhuaCloudDraftPayload(json.payload);
    if (!payload) return null;
    return {
      format: "mv-manhua-cloud-draft-gcs-v1",
      userId: json.userId,
      clientUpdatedAt: String(json.clientUpdatedAt || payload.clientUpdatedAt || ""),
      serverUpdatedAt: String(json.serverUpdatedAt || ""),
      payload,
    };
  } catch {
    return null;
  }
}

export async function readManhuaCloudDraftFromGcs(userId: number): Promise<{
  payload: ManhuaCloudDraftPayload;
  serverUpdatedAt: string;
} | null> {
  const gcsUri = manhuaCloudDraftGcsUri(userId);
  try {
    const { buffer } = await downloadGcsObject({ gcsUri });
    const env = parseEnvelope(buffer.toString("utf8"));
    if (!env || env.userId !== userId) return null;
    const updatedAt = env.serverUpdatedAt || env.clientUpdatedAt;
    if (updatedAt && isManhuaCloudDraftExpired(new Date(updatedAt))) {
      return null;
    }
    return {
      payload: env.payload,
      serverUpdatedAt: updatedAt || new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/gcs_download_failed:404/.test(msg)) return null;
    console.warn("[manhuaCloudDraftGcs] read failed:", msg);
    return null;
  }
}

export async function writeManhuaCloudDraftToGcs(opts: {
  userId: number;
  payload: ManhuaCloudDraftPayload;
}): Promise<{ serverUpdatedAt: string; gcsUri: string; bytes: number }> {
  const serverUpdatedAt = new Date().toISOString();
  const envelope: GcsDraftEnvelope = {
    format: "mv-manhua-cloud-draft-gcs-v1",
    userId: opts.userId,
    clientUpdatedAt: opts.payload.clientUpdatedAt,
    serverUpdatedAt,
    payload: opts.payload,
  };
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  const objectName = manhuaCloudDraftObjectName(opts.userId);
  const { gcsUri } = await uploadBufferToGcs({
    objectName,
    buffer: body,
    contentType: "application/json; charset=utf-8",
    bucket: draftBucket(),
  });
  return { serverUpdatedAt, gcsUri, bytes: body.byteLength };
}

/** 浏览器直传：避开大 JSON 经 tRPC/Neon 超时 */
export async function createManhuaCloudDraftSignedUpload(userId: number): Promise<{
  uploadUrl: string;
  gcsUri: string;
  objectName: string;
  requiredHeaders?: Record<string, string>;
}> {
  const objectName = manhuaCloudDraftObjectName(userId);
  const signed = await createGcsSignedUploadUrl({
    objectName,
    contentType: "application/json",
    expiresInMinutes: 20,
    bucket: draftBucket(),
  });
  return {
    uploadUrl: signed.uploadUrl,
    gcsUri: signed.gcsUri,
    objectName: signed.objectName,
    requiredHeaders: signed.requiredHeaders,
  };
}

/**
 * 直传完成后：接受信封或裸 payload，统一写回信封并刷新 serverUpdatedAt。
 */
export async function commitManhuaCloudDraftAfterDirectUpload(userId: number): Promise<{
  payload: ManhuaCloudDraftPayload;
  serverUpdatedAt: string;
} | null> {
  const gcsUri = manhuaCloudDraftGcsUri(userId);
  try {
    const { buffer } = await downloadGcsObject({ gcsUri });
    const raw = buffer.toString("utf8");
    const env = parseEnvelope(raw);
    if (env && env.userId === userId) {
      const written = await writeManhuaCloudDraftToGcs({
        userId,
        payload: env.payload,
      });
      return { payload: env.payload, serverUpdatedAt: written.serverUpdatedAt };
    }
    const bare = parseManhuaCloudDraftPayload(raw);
    if (bare) {
      const written = await writeManhuaCloudDraftToGcs({ userId, payload: bare });
      return { payload: bare, serverUpdatedAt: written.serverUpdatedAt };
    }
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/gcs_download_failed:404/.test(msg)) return null;
    console.warn("[manhuaCloudDraftGcs] commit read failed:", msg);
    return null;
  }
}
