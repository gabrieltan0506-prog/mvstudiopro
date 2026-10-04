/**
 * 漫剧云草稿正文存 GCS（方案 A），不再把整包 JSON 塞进 Neon。
 * 对象：manhua-cloud-drafts/user-{userId}.json
 */
import {
  createGcsSignedUploadUrl,
  downloadGcsObject,
  uploadBufferToGcs,
  listGcsObjectNamesByPrefix,
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
      "mv-studio-pro-vertex-video-temp"
  ).trim();
}

export function manhuaCloudDraftObjectName(
  userId: number,
  projectId?: string
): string {
  const id = Math.max(1, Math.floor(Number(userId) || 0));
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId))
    throw new Error("Invalid project ID");
  return projectId
    ? `${PREFIX}/user-${id}/projects/${projectId}.json`
    : `${PREFIX}/user-${id}.json`;
}

export function manhuaCloudDraftGcsUri(
  userId: number,
  projectId?: string
): string {
  return `gs://${draftBucket()}/${manhuaCloudDraftObjectName(userId, projectId)}`;
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
      clientUpdatedAt: String(
        json.clientUpdatedAt || payload.clientUpdatedAt || ""
      ),
      serverUpdatedAt: String(json.serverUpdatedAt || ""),
      payload,
    };
  } catch {
    return null;
  }
}

export async function readManhuaCloudDraftFromGcs(
  userId: number,
  projectId?: string
): Promise<{
  payload: ManhuaCloudDraftPayload;
  serverUpdatedAt: string;
} | null> {
  const gcsUri = manhuaCloudDraftGcsUri(userId, projectId);
  try {
    const { buffer } = await downloadGcsObject({ gcsUri });
    const env = parseEnvelope(buffer.toString("utf8"));
    if (!env || env.userId !== userId) {
      if (projectId) throw new Error("作品云端内容无法校验，未按空作品处理");
      return null;
    }
    const updatedAt = env.serverUpdatedAt || env.clientUpdatedAt;
    if (
      !projectId &&
      updatedAt &&
      isManhuaCloudDraftExpired(new Date(updatedAt))
    ) {
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
    if (projectId) throw e; // A failed read must not look like a new empty project.
    return null;
  }
}

export async function writeManhuaCloudDraftToGcs(opts: {
  userId: number;
  projectId?: string;
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
  const objectName = manhuaCloudDraftObjectName(opts.userId, opts.projectId);
  const { gcsUri } = await uploadBufferToGcs({
    objectName,
    buffer: body,
    contentType: "application/json; charset=utf-8",
    bucket: draftBucket(),
  });
  if (opts.projectId) {
    const summary = {
      projectId: opts.projectId,
      title:
        opts.payload.writerSession.writerPack?.seriesTitle ||
        opts.payload.writerSession.topic ||
        "新作品",
      updatedAt: serverUpdatedAt,
      episodeCount: opts.payload.writerSession.episodeCount,
      phase: opts.payload.writerSession.workflowPhase,
    };
    await uploadBufferToGcs({
      objectName: `manhua-project-index/user-${opts.userId}/${opts.projectId}.json`,
      buffer: Buffer.from(JSON.stringify(summary)),
      contentType: "application/json",
      bucket: draftBucket(),
    });
  }
  return { serverUpdatedAt, gcsUri, bytes: body.byteLength };
}

/** 浏览器直传：避开大 JSON 经 tRPC/Neon 超时 */
export async function createManhuaCloudDraftSignedUpload(
  userId: number,
  projectId?: string
): Promise<{
  uploadUrl: string;
  gcsUri: string;
  objectName: string;
  requiredHeaders?: Record<string, string>;
}> {
  const objectName = manhuaCloudDraftObjectName(userId, projectId);
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
export async function commitManhuaCloudDraftAfterDirectUpload(
  userId: number,
  projectId?: string
): Promise<{
  payload: ManhuaCloudDraftPayload;
  serverUpdatedAt: string;
} | null> {
  const gcsUri = manhuaCloudDraftGcsUri(userId, projectId);
  try {
    const { buffer } = await downloadGcsObject({ gcsUri });
    const raw = buffer.toString("utf8");
    const env = parseEnvelope(raw);
    if (env && env.userId === userId) {
      const written = await writeManhuaCloudDraftToGcs({
        userId,
        projectId,
        payload: env.payload,
      });
      return { payload: env.payload, serverUpdatedAt: written.serverUpdatedAt };
    }
    const bare = parseManhuaCloudDraftPayload(raw);
    if (bare) {
      const written = await writeManhuaCloudDraftToGcs({
        userId,
        projectId,
        payload: bare,
      });
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

export async function listManhuaProjects(userId: number) {
  const prefix = `manhua-project-index/user-${userId}/`;
  const names = await listGcsObjectNamesByPrefix({
    prefix,
    bucket: draftBucket(),
    allPages: true,
  });
  const projects: Array<{
    projectId: string;
    title: string;
    updatedAt: string;
    episodeCount: number;
    phase: string;
  }> = [];
  for (let i = 0; i < names.length; i += 10) {
    const page = await Promise.all(
      names
        .slice(i, i + 10)
        .filter(
          name =>
            name.startsWith(prefix) && /\/[0-9a-f-]{36}\.json$/i.test(name)
        )
        .map(async objectName => {
          const { buffer } = await downloadGcsObject({
            gcsUri: `gs://${draftBucket()}/${objectName}`,
          });
          const item = JSON.parse(buffer.toString("utf8"));
          if (objectName !== `${prefix}${item.projectId}.json`)
            throw new Error("作品索引不一致");
          return {
            projectId: String(item.projectId),
            title: String(item.title),
            updatedAt: String(item.updatedAt),
            episodeCount: Number(item.episodeCount),
            phase: String(item.phase),
          };
        })
    );
    projects.push(...page);
  }
  return {
    projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    hasMore: false,
  };
}
