/**
 * 漫剧云草稿正文存 GCS（方案 A），不再把整包 JSON 塞进 Neon。
 * 对象：manhua-cloud-drafts/user-{userId}.json
 */
import { randomUUID } from "node:crypto";
import {
  downloadGcsObjectVersioned,
  deleteGcsObject,
  createGcsSignedUploadUrl,
  downloadGcsObject,
  uploadBufferToGcs,
  listGcsObjectNamesByPrefix,
} from "./gcs.js";
import {
  MANHUA_CLOUD_DRAFT_MAX_CHARS,
  isManhuaCloudDraftExpired,
  parseManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "../../shared/manhuaCloudDraft.js";

const PREFIX = "manhua-cloud-drafts";

export class ManhuaCloudDraftConflictError extends Error {
  constructor() { super("云端作品已变化或缺少版本凭据，已暂停同步；请先导出本机副本，再读取云端版本。"); }
}
function requireProjectVersion(projectId?: string, expectedGeneration?: string) {
  if (projectId && !/^\d+$/.test(expectedGeneration || "")) throw new ManhuaCloudDraftConflictError();
}
function stagedObjectName(userId: number, projectId: string, uploadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error("暂存编号无效");
  return `${manhuaCloudDraftObjectName(userId, projectId)}.staging/${uploadId}.json`;
}
function projectSummary(projectId: string, payload: ManhuaCloudDraftPayload, updatedAt: string) {
  return { projectId, title: payload.writerSession.writerPack?.seriesTitle || payload.writerSession.topic || "新作品",
    updatedAt, episodeCount: payload.writerSession.episodeCount, phase: payload.writerSession.workflowPhase };
}

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
  generation?: string;
} | null> {
  const gcsUri = manhuaCloudDraftGcsUri(userId, projectId);
  try {
    const object = projectId ? await downloadGcsObjectVersioned({ gcsUri }) : await downloadGcsObject({ gcsUri });
    const { buffer } = object;
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
      generation: "generation" in object ? String(object.generation) : undefined,
      serverUpdatedAt: updatedAt || new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 正文按 generation 读取时的404可能是并发替换，不能当作新作品。
    if (projectId ? /^gcs_stat_failed:404$/.test(msg) : /gcs_download_failed:404/.test(msg)) return null;
    console.warn("[manhuaCloudDraftGcs] read failed:", msg);
    if (projectId) throw e; // A failed read must not look like a new empty project.
    return null;
  }
}

export async function writeManhuaCloudDraftToGcs(opts: {
  userId: number;
  projectId?: string;
  expectedGeneration?: string;
  payload: ManhuaCloudDraftPayload;
}): Promise<{ serverUpdatedAt: string; gcsUri: string; bytes: number; generation?: string }> {
  requireProjectVersion(opts.projectId, opts.expectedGeneration);
  const serverUpdatedAt = new Date().toISOString();
  const envelope: GcsDraftEnvelope = {
    format: "mv-manhua-cloud-draft-gcs-v1", userId: opts.userId,
    clientUpdatedAt: opts.payload.clientUpdatedAt, serverUpdatedAt, payload: opts.payload,
  };
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  // 索引只负责发现作品，先登记再发布正文。并发失败最多留下空登记，不丢成功正文。
  // 列表读取正式正文摘要，不让晚到的旧索引覆盖新标题/阶段。
  if (opts.projectId) {
    try {
      await uploadBufferToGcs({
        objectName: `manhua-project-index/user-${opts.userId}/${opts.projectId}.json`,
        buffer: Buffer.from(JSON.stringify({ projectId: opts.projectId })),
        contentType: "application/json", bucket: draftBucket(), ifGenerationMatch: "0",
      });
    } catch (e) {
      if (!/gcs_upload_failed:412:/.test(String(e))) throw e;
    }
  }
  try {
    const written = await uploadBufferToGcs({
      objectName: manhuaCloudDraftObjectName(opts.userId, opts.projectId), buffer: body,
      contentType: "application/json; charset=utf-8", bucket: draftBucket(),
      ifGenerationMatch: opts.projectId ? opts.expectedGeneration : undefined,
    });
    // 必须返回这一次写入的版本，不能事后stat误取另一个设备的新版本。
    if (opts.projectId && !written.generation) throw new Error("云端保存回执缺少版本，请重新读取确认");
    return { serverUpdatedAt, gcsUri: written.gcsUri, bytes: body.byteLength, generation: written.generation };
  } catch (e) {
    if (/gcs_upload_failed:412:/.test(String(e))) throw new ManhuaCloudDraftConflictError();
    throw e;
  }
}

/** 浏览器直传：避开大 JSON 经 tRPC/Neon 超时 */
export async function createManhuaCloudDraftSignedUpload(
  userId: number, projectId?: string, expectedGeneration?: string
) {
  requireProjectVersion(projectId, expectedGeneration);
  const uploadId = projectId ? randomUUID() : undefined;
  const objectName = projectId
    ? stagedObjectName(userId, projectId, uploadId!)
    : manhuaCloudDraftObjectName(userId);
  const signed = await createGcsSignedUploadUrl({ objectName, contentType: "application/json", expiresInMinutes: 20, bucket: draftBucket() });
  return { uploadUrl: signed.uploadUrl, gcsUri: signed.gcsUri, objectName: signed.objectName,
    requiredHeaders: signed.requiredHeaders, uploadId };
}

/** 直传只能写暂存对象；正式正文在此处执行原子版本条件写。 */
export async function commitManhuaCloudDraftAfterDirectUpload(
  userId: number, projectId?: string, expectedGeneration?: string, uploadId?: string
): Promise<{ payload: ManhuaCloudDraftPayload; serverUpdatedAt: string; generation?: string } | null> {
  requireProjectVersion(projectId, expectedGeneration);
  if (projectId && !uploadId) throw new Error("缺少草稿暂存编号，请刷新页面");
  const gcsUri = projectId
    ? `gs://${draftBucket()}/${stagedObjectName(userId, projectId, uploadId!)}`
    : manhuaCloudDraftGcsUri(userId);
  try {
    const stage = projectId ? await downloadGcsObjectVersioned({ gcsUri }) : await downloadGcsObject({ gcsUri });
    const { buffer } = stage;
    const raw = buffer.toString("utf8");
    if (raw.length > MANHUA_CLOUD_DRAFT_MAX_CHARS + 2048) throw new Error("暂存草稿超过容量限制");
    const env = parseEnvelope(raw);
    if (env && env.userId !== userId) throw new Error("草稿账号不匹配");
    const payload = env?.payload || parseManhuaCloudDraftPayload(raw);
    if (!payload) return null;
    const written = await writeManhuaCloudDraftToGcs({ userId, projectId, expectedGeneration, payload });
    if (projectId && "generation" in stage) {
      // 只清理本次已发布的暂存版本；失败不撤销正文回执，不触碰原稿或其他在途上传。
      await deleteGcsObject({ bucket: draftBucket(), objectName: stagedObjectName(userId, projectId, uploadId!),
        ifGenerationMatch: String(stage.generation) }).catch(() => console.warn("[manhuaCloudDraftGcs] 本次暂存清理未完成"));
    }
    return { payload, serverUpdatedAt: written.serverUpdatedAt, generation: written.generation };
  } catch (e) {
    if (projectId ? /^Error: gcs_stat_failed:404$/.test(String(e)) : /gcs_download_failed:404/.test(String(e))) return null;
    throw e;
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
          const projectId = objectName.slice(prefix.length, -5);
          const hit = await readManhuaCloudDraftFromGcs(userId, projectId);
          return hit ? projectSummary(projectId, hit.payload, hit.serverUpdatedAt) : null;
        })
    );
    projects.push(...page.filter((item): item is NonNullable<typeof item> => item !== null));
  }
  return {
    projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    hasMore: false,
  };
}
