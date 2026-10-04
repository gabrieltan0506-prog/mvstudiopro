import { createHash, randomUUID } from "node:crypto";
import {
  uploadBufferToGcs,
  downloadGcsObject,
  listGcsObjectNamesByPrefix,
} from "./gcs";
import { novelWorkspaceStateSchema } from "../../shared/novelWorkspaceState";
import { parseNovelDraft } from "../../shared/manhuaNovelSource";
const bucket = () =>
  String(
    process.env.GCS_BUCKET_NAME ||
      process.env.GROWTH_CAMP_GCS_BUCKET ||
      process.env.VERTEX_GCS_BUCKET ||
      process.env.GOOGLE_CLOUD_STORAGE_BUCKET ||
      "mv-studio-pro-vertex-video-temp"
  ).trim();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const prefix = (userId: number) => `novel-workspace-backups/user-${userId}/`;
export function validateNovelBackup(workspaceJson: string) {
  const state = novelWorkspaceStateSchema.parse(JSON.parse(workspaceJson));
  if (state.source !== null && !parseNovelDraft(state.source))
    throw new Error("底本数据损坏，未覆盖任何版本");
  return state;
}
export async function writeNovelWorkspaceBackup(
  userId: number,
  workspaceJson: string
) {
  const state = validateNovelBackup(workspaceJson),
    backupId = randomUUID();
  const metadata = {
    backupId,
    roundId: state.roundId,
    title: state.topic || "小说改编草稿",
    season: state.season || 1,
    createdAt: new Date().toISOString(),
    bytes: Buffer.byteLength(workspaceJson),
    sha256: sha(workspaceJson),
  };
  // Immutable full text first; only after successful storage is it listed as restorable.
  const objectName = `${prefix(userId)}${backupId}.json`;
  await uploadBufferToGcs({
    bucket: bucket(),
    objectName,
    buffer: Buffer.from(workspaceJson),
    contentType: "application/json; charset=utf-8",
  });
  const check = await downloadGcsObject({
    gcsUri: `gs://${bucket()}/${objectName}`,
  });
  if (sha(check.buffer.toString("utf8")) !== metadata.sha256)
    throw new Error("备份完整性核对失败，原稿仍保留");
  await uploadBufferToGcs({
    bucket: bucket(),
    objectName: `${prefix(userId)}index/${backupId}.json`,
    buffer: Buffer.from(JSON.stringify(metadata)),
    contentType: "application/json",
  });
  return metadata;
}
export async function listNovelWorkspaceBackups(userId: number) {
  const dir = `${prefix(userId)}index/`,
    names = await listGcsObjectNamesByPrefix({
      bucket: bucket(),
      prefix: dir,
      allPages: true,
    });
  const rows: Array<{
    backupId: string;
    roundId: string;
    title: string;
    season: number;
    createdAt: string;
    bytes: number;
    sha256: string;
  }> = [];
  for (let i = 0; i < names.length; i += 10)
    rows.push(
      ...(await Promise.all(
        names.slice(i, i + 10).map(async name => {
          const { buffer } = await downloadGcsObject({
            gcsUri: `gs://${bucket()}/${name}`,
          });
          const row = JSON.parse(buffer.toString("utf8"));
          if (!uuid.test(row.backupId) || name !== `${dir}${row.backupId}.json`)
            throw new Error("备份索引无效");
          return row;
        })
      ))
    );
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function readNovelWorkspaceBackup(
  userId: number,
  backupId: string
) {
  if (!uuid.test(backupId)) throw new Error("备份编号无效");
  const meta = await downloadGcsObject({
    gcsUri: `gs://${bucket()}/${prefix(userId)}index/${backupId}.json`,
  });
  const metadata = JSON.parse(meta.buffer.toString("utf8"));
  const { buffer } = await downloadGcsObject({
    gcsUri: `gs://${bucket()}/${prefix(userId)}${backupId}.json`,
  });
  const workspaceJson = buffer.toString("utf8");
  if (
    metadata.backupId !== backupId ||
    metadata.bytes !== buffer.byteLength ||
    metadata.sha256 !== sha(workspaceJson)
  )
    throw new Error("备份完整性校验失败，未回填");
  const state = validateNovelBackup(workspaceJson);
  if (state.roundId !== metadata.roundId) throw new Error("备份作品身份不一致");
  return { metadata, workspaceJson };
}
